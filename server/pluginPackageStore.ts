import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { PluginManifest } from '../src/plugins/sdk/types.ts';
import { inspectPluginPackage } from './pluginPackageArchive.ts';

interface StoredVersion { sha256: string }
interface StoredPlugin { current: string; versions: Record<string, StoredVersion> }
interface Registry { version: 1; plugins: Record<string, StoredPlugin> }
export interface InstalledPlugin { manifest: PluginManifest; versions: string[] }
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const digest = /^[a-f0-9]{64}$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validKey = (value: string) => identifier.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function checkRegistry(value: unknown): Registry {
  if (!object(value) || value.version !== 1 || !object(value.plugins)) throw new Error('插件登记文件格式无效。');
  for (const [id, plugin] of Object.entries(value.plugins)) {
    if (!validKey(id) || !object(plugin) || typeof plugin.current !== 'string' || !object(plugin.versions) || !Object.hasOwn(plugin.versions, plugin.current)) throw new Error('插件登记身份或当前版本无效。');
    for (const [version, entry] of Object.entries(plugin.versions)) {
      if (version.length > 100 || !semver.test(version) || !object(entry) || typeof entry.sha256 !== 'string' || !digest.test(entry.sha256)) throw new Error('插件版本登记无效。');
    }
  }
  return value as unknown as Registry;
}

export class PluginPackageStore {
  readonly directory: string;
  private readonly reservedIds: ReadonlySet<string>;
  constructor(directory: string, reservedIds: readonly string[] = []) {
    this.directory = path.resolve(directory); this.reservedIds = new Set(reservedIds);
  }
  private get registryFile() { return path.join(this.directory, 'registry.json'); }
  private packageFile(sha256: string) {
    if (!digest.test(sha256)) throw new Error('插件包摘要无效。');
    return path.join(this.directory, 'packages', sha256 + '.bin');
  }
  private async readRegistry(): Promise<Registry> {
    try { return checkRegistry(JSON.parse(await readFile(this.registryFile, 'utf8'))); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, plugins: {} };
      throw cause;
    }
  }
  private async withLock<T>(run: () => Promise<T>): Promise<T> {
    // A unique claim per operation avoids deleting a replacement owner's lock
    // while several processes reclaim a crashed writer. Empty claims are the
    // bakery algorithm's choosing phase; the PID is already in the filename.
    const directory = path.join(this.directory, 'registry.locks');
    await mkdir(directory, { recursive: true });
    const name = `${process.pid}-${randomUUID()}.lock`;
    const file = path.join(directory, name), ticketFile = file + '.ticket', temporary = file + '.tmp';
    const started = Date.now();
    const claim = await open(file, 'wx');
    try {
      await claim.close();
      const contenders = async () => {
        const result: { name: string; ticket: number }[] = [];
        for (const entry of await readdir(directory)) {
          const match = /^([1-9]\d*)-[0-9a-f-]{36}\.lock$/.exec(entry);
          if (!match || entry === name) continue;
          const contender = path.join(directory, entry);
          try { process.kill(Number(match[1]), 0); }
          catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'ESRCH') {
              await removeClaimFile(contender + '.ticket'); await removeClaimFile(contender); continue;
            }
            if ((cause as NodeJS.ErrnoException).code !== 'EPERM') throw cause;
          }
          let source: string;
          try { source = await readFile(contender + '.ticket', 'utf8'); }
          catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'ENOENT') { result.push({ name: entry, ticket: 0 }); continue; }
            throw cause;
          }
          let ticket: unknown;
          try { ticket = JSON.parse(source); }
          catch { result.push({ name: entry, ticket: 0 }); continue; }
          if (!Number.isSafeInteger(ticket) || Number(ticket) < 1) throw new Error('插件锁元信息无效。');
          result.push({ name: entry, ticket: Number(ticket) });
        }
        return result;
      };
      const maximum = (await contenders()).reduce((value, item) => Math.max(value, item.ticket), 0);
      if (maximum >= Number.MAX_SAFE_INTEGER) throw new Error('插件锁元信息无效。');
      const ticket = maximum + 1;
      await writeAtomicFile(temporary, JSON.stringify(ticket));
      await rename(temporary, ticketFile);
      // Re-enumerate after publishing: a contender absent from the first scan
      // may have chosen the same ticket and must participate in the tie break.
      while ((await contenders()).some(item => item.ticket === 0 || item.ticket < ticket || item.ticket === ticket && item.name < name)) {
        if (Date.now() - started > 10000) throw new Error('插件管理正在其他窗口执行，请稍后重试。');
        await pause(20);
      }
      return await run();
    } finally {
      await claim.close();
      await removeClaimFile(temporary);
      await removeClaimFile(ticketFile);
      await removeClaimFile(file);
    }
  }
  private async writeRegistry(registry: Registry) {
    const temporary = this.registryFile + '.' + randomUUID() + '.tmp';
    try {
      await writeAtomicFile(temporary, JSON.stringify(registry));
      await retryFileOperation(() => rename(temporary, this.registryFile));
    } finally { await rm(temporary, { force: true }); }
  }
  private async readManifest(id: string, version: string, entry: StoredVersion): Promise<PluginManifest> {
    const bytes = await readFile(this.packageFile(entry.sha256));
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('已安装的插件包校验失败。');
    const manifest = (await inspectPluginPackage(bytes)).manifest;
    if (manifest.id !== id || manifest.version !== version) throw new Error('插件包与登记的身份或版本不一致。');
    return manifest;
  }
  private async describe(id: string, plugin: StoredPlugin): Promise<InstalledPlugin> {
    const manifest = await this.readManifest(id, plugin.current, plugin.versions[plugin.current]);
    return { manifest, versions: Object.keys(plugin.versions) };
  }
  private async assertIdentity(manifest: PluginManifest, registry: Registry) {
    if (this.reservedIds.has(manifest.id)) throw new Error('此插件标识已由随附插件使用。');
    const suffix = manifest.id.split('.').at(-1)!;
    const legacyKey = `mewiki:plugins:${suffix}:connection:v1`;
    const usesLegacy = manifest.contentTypes.some(type => type.picker?.connectionStorageKey === legacyKey);
    if (usesLegacy && [...this.reservedIds, ...Object.keys(registry.plugins)].some(id => id !== manifest.id && id.split('.').at(-1) === suffix)) {
      throw new Error('插件旧连接偏好别名与已有插件冲突。');
    }
    for (const [id, plugin] of Object.entries(registry.plugins)) {
      if (id === manifest.id || id.split('.').at(-1) !== suffix) continue;
      const installed = await this.readManifest(id, plugin.current, plugin.versions[plugin.current]);
      if (installed.contentTypes.some(type => type.picker?.connectionStorageKey === legacyKey)) throw new Error('插件身份与已有插件的旧连接偏好别名冲突。');
    }
  }
  private async writePackage(sha256: string, bytes: Buffer): Promise<boolean> {
    const file = this.packageFile(sha256); let existed = true;
    try { if ((await readFile(file)).equals(bytes)) return false; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; existed = false; }
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { await writeAtomicFile(temporary, bytes); await retryFileOperation(() => rename(temporary, file)); }
    finally { await rm(temporary, { force: true }); }
    return !existed;
  }
  async list(): Promise<InstalledPlugin[]> {
    return this.withLock(async () => {
      const registry = await this.readRegistry();
      return Promise.all(Object.entries(registry.plugins).map(([id, plugin]) => this.describe(id, plugin)));
    });
  }
  async inspect(bytes: Uint8Array) {
    const inspected = await inspectPluginPackage(bytes);
    await this.assertIdentity(inspected.manifest, await this.readRegistry());
    return inspected;
  }
  async install(value: Uint8Array): Promise<InstalledPlugin> {
    const bytes = Buffer.from(value); const { manifest, sha256 } = await this.inspect(bytes);
    return this.withLock(async () => {
      const registry = await this.readRegistry();
      await this.assertIdentity(manifest, registry);
      const plugin = registry.plugins[manifest.id] ?? { current: manifest.version, versions: {} };
      const existing = plugin.versions[manifest.version];
      if (existing && existing.sha256 !== sha256) throw new Error('同一插件版本不能被不同内容覆盖。');
      await mkdir(path.join(this.directory, 'packages'), { recursive: true });
      const file = this.packageFile(sha256);
      let created = false;
      try {
        created = await this.writePackage(sha256, bytes);
        plugin.versions[manifest.version] = { sha256 }; plugin.current = manifest.version; registry.plugins[manifest.id] = plugin;
        await this.writeRegistry(registry);
      } catch (cause) { if (created) await rm(file, { force: true }); throw cause; }
      return { manifest, versions: Object.keys(plugin.versions) };
    });
  }
  async activate(id: string, version: string): Promise<InstalledPlugin> {
    if (!validKey(id) || version.length > 100 || !semver.test(version)) throw new Error('插件身份或版本无效。');
    return this.withLock(async () => {
      const registry = await this.readRegistry(); const plugin = registry.plugins[id];
      if (!plugin || !Object.hasOwn(plugin.versions, version)) throw new Error('没有安装指定的插件版本。');
      const manifest = await this.readManifest(id, version, plugin.versions[version]);
      await this.assertIdentity(manifest, registry);
      plugin.current = version; await this.writeRegistry(registry);
      return { manifest, versions: Object.keys(plugin.versions) };
    });
  }
  async uninstall(id: string): Promise<void> {
    if (!validKey(id)) throw new Error('插件身份无效。');
    await this.withLock(async () => {
      const registry = await this.readRegistry();
      if (!Object.hasOwn(registry.plugins, id)) return;
      const removed = registry.plugins[id]; delete registry.plugins[id]; await this.writeRegistry(registry);
      const referenced = new Set(Object.values(registry.plugins).flatMap(plugin => Object.values(plugin.versions).map(entry => entry.sha256)));
      for (const entry of Object.values(removed.versions)) {
        if (!referenced.has(entry.sha256)) await rm(this.packageFile(entry.sha256), { force: true }).catch(() => {});
      }
    });
  }
}

async function removeClaimFile(file: string) {
  await retryFileOperation(() => rm(file, { force: true }));
}

async function retryFileOperation(operation: () => Promise<void>) {
  const started = Date.now();
  while (true) {
    try { await operation(); return; }
    catch (cause) {
      // Windows readers can briefly block an atomic rename or claim cleanup.
      if (!['EPERM', 'EACCES', 'EBUSY'].includes((cause as NodeJS.ErrnoException).code ?? '') || Date.now() - started > 10000) throw cause;
      await pause(20);
    }
  }
}

async function writeAtomicFile(file: string, bytes: string | Uint8Array) {
  const handle = await open(file, 'wx');
  let complete = false;
  try { await handle.writeFile(bytes); await handle.sync(); complete = true; }
  finally { await handle.close(); if (!complete) await rm(file, { force: true }); }
}
