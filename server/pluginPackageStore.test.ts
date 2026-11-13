import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZipFile } from 'yazl';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PluginPackageStore } from './pluginPackageStore.ts';

const roots: string[] = [];
const runNode = promisify(execFile);
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('mewiki-plugin-store-')) throw new Error('Unsafe cleanup path');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
function manifest(version = '1.0.0', id = 'org.example.instrument') {
  return { manifestVersion: 1, apiVersion: 1, id, name: '测量记录', version, description: '通用测量卡片',
    capabilities: ['context.read', 'content.open'], contentTypes: [{ id: 'measurement', schemaVersion: 1, insertionLabel: '插入测量', schema: { type: 'object' }, view: [] }] };
}
const bytes = (version = '1.0.0', id = 'org.example.instrument') => Buffer.from(JSON.stringify(manifest(version, id)));
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-plugin-store-')); roots.push(root);
  return { root, store: new PluginPackageStore(path.join(root, 'plugins')) };
}
async function zip(files: { name: string; data: Buffer; mode?: number }[]) {
  const archive = new ZipFile(); const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on('data', chunk => chunks.push(chunk));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks))); archive.outputStream.on('error', reject);
  });
  for (const file of files) archive.addBuffer(file.data, file.name, { mode: file.mode, compress: false });
  archive.end(); return output;
}

describe('declarative plugin package store', () => {
  it('installs v2 exporter packages through the same JSON/ZIP and immutable-version flow as v1 content', async () => {
    const { store } = await fixture();
    const source = JSON.parse(await readFile(new URL('../examples/plugins/publication/manifest.json', import.meta.url), 'utf8'));
    const original = Buffer.from(JSON.stringify(source));
    expect((await store.inspect(original)).manifest).toMatchObject({ apiVersion: 2, contentTypes: [], exporters: [{ id: 'cards' }] });
    await store.install(original);
    const updated = { ...source, version: '1.1.0', description: '更新后的独立图文模板' };
    await store.install(await zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(updated)) }]));
    await store.install(bytes());
    const exporter = (await store.list()).find(item => item.manifest.id === source.id)!;
    expect(exporter).toMatchObject({ manifest: { apiVersion: 2, version: '1.1.0', exporters: [{ id: 'cards' }] }, versions: ['1.0.0', '1.1.0'] });
    expect((await store.activate(source.id, '1.0.0')).manifest).toEqual(source);
    expect((await store.list()).find(item => item.manifest.id === 'org.example.instrument')?.manifest.apiVersion).toBe(1);
  });
  it('rejects malformed v2 templates without replacing the installed exporter or legacy content plugin', async () => {
    const { store } = await fixture();
    const source = JSON.parse(await readFile(new URL('../examples/plugins/publication/manifest.json', import.meta.url), 'utf8'));
    await store.install(Buffer.from(JSON.stringify(source))); await store.install(bytes());
    const invalid = structuredClone(source);
    invalid.version = '1.1.0'; invalid.exporters[0].templates[0].background = 'url(file:///outside)';
    await expect(store.install(Buffer.from(JSON.stringify(invalid)))).rejects.toThrow();
    await expect(store.install(Buffer.from(JSON.stringify({ ...manifest('1.1.0'), exporters: source.exporters })))).rejects.toThrow();
    const installed = await store.list();
    expect(installed.find(item => item.manifest.id === source.id)).toMatchObject({ manifest: source, versions: ['1.0.0'] });
    expect(installed.find(item => item.manifest.id === 'org.example.instrument')?.manifest.version).toBe('1.0.0');
  });
  it('inspects without creating files and installs a JSON manifest without executing code', async () => {
    const { root, store } = await fixture();
    const inspected = await store.inspect(bytes());
    expect(inspected.manifest.id).toBe('org.example.instrument'); expect(inspected.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readdir(root)).toEqual([]);
    expect((await store.install(bytes())).versions).toEqual(['1.0.0']);
    expect((await store.list())[0].manifest).toEqual(inspected.manifest);
  });
  it('retains immutable versions, selects a rollback, and refuses rewriting the same version', async () => {
    const { store } = await fixture();
    await store.install(bytes()); await store.install(bytes('1.1.0'));
    expect((await store.list())[0]).toMatchObject({ manifest: { version: '1.1.0' }, versions: ['1.0.0', '1.1.0'] });
    expect((await store.activate('org.example.instrument', '1.0.0')).manifest.version).toBe('1.0.0');
    await expect(store.install(Buffer.from(JSON.stringify({ ...manifest(), description: '被替换的说明' })))).rejects.toThrow();
    expect((await store.list())[0].manifest.version).toBe('1.0.0');
  });
  it('handles repeated identical installs without duplicating versions', async () => {
    const { store } = await fixture(); await store.install(bytes()); await store.install(bytes());
    expect((await store.list())[0].versions).toEqual(['1.0.0']);
  });
  it('retains SemVer build and prerelease labels as version identity', async () => {
    const { store } = await fixture(); await store.install(bytes('1.0.0-beta.1+build.2'));
    expect((await store.list())[0].versions).toEqual(['1.0.0-beta.1+build.2']);
    expect((await store.activate('org.example.instrument', '1.0.0-beta.1+build.2')).manifest.version).toBe('1.0.0-beta.1+build.2');
  });
  it('serializes concurrent mutations across store instances', async () => {
    const { root, store } = await fixture(); const other = new PluginPackageStore(path.join(root, 'plugins'));
    await Promise.all([store.install(bytes()), other.install(bytes('1.0.0', 'org.example.other'))]);
    expect((await store.list()).map(item => item.manifest.id).sort()).toEqual(['org.example.instrument', 'org.example.other']);
  });
  it('serializes separate processes and recovers an interrupted writer lock', async () => {
    const { root, store } = await fixture();
    const script = 'const {PluginPackageStore}=await import(process.argv[1]); await new PluginPackageStore(process.argv[2]).install(Buffer.from(process.argv[3])); process.stdout.write(String(process.pid));';
    const args = ['--experimental-strip-types', '--input-type=module', '--eval', script, new URL('./pluginPackageStore.ts', import.meta.url).href, path.join(root, 'plugins')];
    const children = await Promise.all([
      runNode(process.execPath, [...args, JSON.stringify(manifest())]),
      runNode(process.execPath, [...args, JSON.stringify(manifest('1.0.0', 'org.example.other'))]),
    ]);
    const abandoned = path.join(root, 'plugins', 'registry.locks', `${Number(children[0].stdout)}-${randomUUID()}.lock`);
    await writeFile(abandoned, ''); await writeFile(abandoned + '.ticket', '1');
    expect((await store.list()).map(item => item.manifest.id).sort()).toEqual(['org.example.instrument', 'org.example.other']);
  });
  it('does not allow packages to replace a bundled identity', async () => {
    const { root } = await fixture(); const store = new PluginPackageStore(path.join(root, 'plugins'), ['org.example.instrument']);
    await expect(store.install(bytes())).rejects.toThrow(); expect(await store.list()).toEqual([]);
  });
  it('recovers an abandoned empty lock without losing installed versions', async () => {
    const { root, store } = await fixture(); await store.install(bytes());
    const child = await runNode(process.execPath, ['--eval', 'process.stdout.write(String(process.pid))']);
    await mkdir(path.join(root, 'plugins', 'registry.locks'), { recursive: true });
    await writeFile(path.join(root, 'plugins', 'registry.locks', `${Number(child.stdout)}-${randomUUID()}.lock`), '');
    const lock = path.join(root, 'plugins', 'registry.lock');
    await writeFile(lock, ''); await utimes(lock, new Date(0), new Date(0));
    await store.install(bytes('1.1.0'));
    expect((await store.list())[0].versions).toEqual(['1.0.0', '1.1.0']);
  }, 15000);
  it('preserves every registration when separate processes reclaim one abandoned lock', async () => {
    const { root, store } = await fixture(); await store.install(bytes());
    const script = 'const {PluginPackageStore}=await import(process.argv[1]); await new PluginPackageStore(process.argv[2]).install(Buffer.from(process.argv[3])); process.stdout.write(String(process.pid));';
    const args = ['--experimental-strip-types', '--input-type=module', '--eval', script, new URL('./pluginPackageStore.ts', import.meta.url).href, path.join(root, 'plugins')];
    const previous = await runNode(process.execPath, [...args, JSON.stringify(manifest())]);
    const abandoned = path.join(root, 'plugins', 'registry.locks', `${Number(previous.stdout)}-${randomUUID()}.lock`);
    await writeFile(abandoned, ''); await writeFile(abandoned + '.ticket', '1');
    const ids = Array.from({ length: 6 }, (_, index) => `org.example.concurrent${index}`);
    await Promise.all(ids.map(id => runNode(process.execPath, [...args, JSON.stringify(manifest('1.0.0', id))])));
    expect((await store.list()).map(item => item.manifest.id).sort()).toEqual([...ids, 'org.example.instrument'].sort());
  });
  it('prevents legacy connection aliases from reading a bundled or another installed plugin preference', async () => {
    const { root, store } = await fixture(); await store.install(bytes());
    const aliased = (id: string) => {
      const value = manifest('1.0.0', id);
      const contentType = value.contentTypes[0];
      return Buffer.from(JSON.stringify({ ...value, contentTypes: [{ ...contentType, picker: {
        title: '插入测量', fields: [], connectionStorageKey: 'mewiki:plugins:instrument:connection:v1',
        content: { title: { literal: '测量' }, data: {} },
      } }] }));
    };
    await expect(store.inspect(aliased('net.other.instrument'))).rejects.toThrow(/连接/);
    await expect(store.install(aliased('net.other.instrument'))).rejects.toThrow(/连接/);
    const reserved = new PluginPackageStore(path.join(root, 'reserved'), ['org.official.instrument']);
    await expect(reserved.inspect(aliased('net.other.instrument'))).rejects.toThrow(/连接/);
    expect((await store.list()).map(item => item.manifest.id)).toEqual(['org.example.instrument']);
  });
  it('keeps unrelated user data when uninstalling a package', async () => {
    const { root, store } = await fixture(); await writeFile(path.join(root, 'notes.json'), '用户内容'); await store.install(bytes());
    await store.uninstall('org.example.instrument'); expect(await store.list()).toEqual([]);
    expect(await readFile(path.join(root, 'notes.json'), 'utf8')).toBe('用户内容');
  });
  it('refuses unknown rollbacks and invalid identities without changing installed state', async () => {
    const { store } = await fixture(); await store.install(bytes());
    await expect(store.activate('org.example.instrument', '../../bad')).rejects.toThrow();
    await expect(store.uninstall('../outside')).rejects.toThrow(); expect((await store.list())[0].manifest.version).toBe('1.0.0');
  });
  it('accepts a bounded manifest-only ZIP and optional plain documentation', async () => {
    const { store } = await fixture(); const packed = await zip([{ name: 'manifest.json', data: bytes() }, { name: 'README.md', data: Buffer.from('使用说明') }]);
    expect((await store.install(packed)).manifest.id).toBe('org.example.instrument');
  });
  it('rejects executable, duplicate, case-conflicting and symlink ZIP entries', async () => {
    const { store } = await fixture();
    for (const files of [
      [{ name: 'manifest.json', data: bytes() }, { name: 'main.js', data: Buffer.from('throw 0') }],
      [{ name: 'manifest.json', data: bytes() }, { name: 'manifest.json', data: bytes() }],
      [{ name: 'manifest.json', data: bytes() }, { name: 'MANIFEST.JSON', data: bytes() }],
      [{ name: 'manifest.json', data: bytes(), mode: 0o120777 }],
    ]) await expect(store.install(await zip(files))).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });
  it('rejects malformed or oversized packages before changing an installed version', async () => {
    const { store } = await fixture(); await store.install(bytes());
    for (const input of [Buffer.from('{'), Buffer.alloc(1024 * 1024 + 1), Buffer.from('not a plugin'), await zip([{ name: 'README.md', data: Buffer.alloc(64 * 1024 + 1) }])]) {
      await expect(store.install(input)).rejects.toThrow();
    }
    expect((await store.list())[0].manifest.version).toBe('1.0.0');
  });
  it('does not follow untrusted registry file paths', async () => {
    const { root, store } = await fixture(); await store.install(bytes());
    await writeFile(path.join(root, 'plugins', 'registry.json'), JSON.stringify({ version: 1, plugins: { 'org.example.instrument': { current: '1.0.0', versions: { '1.0.0': { sha256: '../../outside' } } } } }));
    await expect(store.list()).rejects.toThrow();
  });
  it('does not commit a damaged package or erase a previous version when disk registration fails', async () => {
    const { root, store } = await fixture(); await store.install(bytes());
    const registry = await readFile(path.join(root, 'plugins', 'registry.json'), 'utf8');
    await writeFile(path.join(root, 'plugins', 'registry.json'), '{');
    await expect(store.install(bytes('1.1.0'))).rejects.toThrow();
    await writeFile(path.join(root, 'plugins', 'registry.json'), registry);
    expect((await store.list())[0].manifest.version).toBe('1.0.0');
  });
  it('can repair a partially written package by reinstalling the exact validated bytes', async () => {
    const { root, store } = await fixture(); await store.install(bytes());
    const packages = path.join(root, 'plugins', 'packages'); const [file] = await readdir(packages);
    await writeFile(path.join(packages, file), 'interrupted');
    await expect(store.list()).rejects.toThrow(/校验/);
    await store.install(bytes()); expect((await store.list())[0].manifest.version).toBe('1.0.0');
  });
});
