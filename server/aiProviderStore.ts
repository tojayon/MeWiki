import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AiProvider, AiProviderInput, AiSettings, AiSettingsInput } from '../src/ai/types.ts';
import { withExportProfileLock } from './exportProfileLock.ts';

export class AiServiceError extends Error {
  readonly status: number;
  readonly failure?: import('../src/ai/failures.ts').AiFailure;
  constructor(message: string, status = 400, failure?: import('../src/ai/failures.ts').AiFailure) { super(message); this.status = status; this.failure = failure; }
}
export interface AiSecretProtector {
  protect: (value: string) => Promise<string>;
  unprotect: (value: string) => Promise<string>;
}
export interface AiProviderPersistence {
  read: () => Promise<string>;
  /** Atomically read, transform and save; return the committed source. */
  update: (change: (source: string) => Promise<string>) => Promise<string>;
}
export type AiProviderSecret = Omit<AiProvider, 'hasApiKey'> & { apiKey: string };
interface StoredProvider extends Omit<AiProvider, 'hasApiKey'> { secret: string }
interface StoredSettings { version: 1; defaultProviderId: string | null; providers: StoredProvider[] }
const digest = (source: string) => createHash('sha256').update(source).digest('hex');
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function dpapi(value: string, decrypt: boolean): Promise<string> {
  // Credentials are sent only through stdin, never through command arguments or stderr.
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const command = `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[System.Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; let settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); }
      else resolve(output.trim());
    };
    const timer = setTimeout(() => finish(new AiServiceError('系统凭据保护超时，请重试。')), 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 65536) finish(new AiServiceError('系统凭据保护失败。')); });
    child.on('error', () => finish(new AiServiceError('无法使用系统凭据保护，请检查本机服务运行环境。')));
    child.on('close', code => finish(code === 0 && output.trim() ? undefined : new AiServiceError('系统凭据无法读取，请重新输入 API Key。')));
    child.stdin.on('error', () => finish(new AiServiceError('系统凭据保护失败。')));
    child.stdin.end(value);
  });
}
export function systemAiSecretProtector(): AiSecretProtector {
  if (process.platform === 'win32') return {
    protect: async value => 'dpapi:' + await dpapi(Buffer.from(value, 'utf8').toString('base64'), false),
    unprotect: async value => {
      if (!value.startsWith('dpapi:')) throw new AiServiceError('密钥存储与当前系统不兼容，请重新输入 API Key。');
      return Buffer.from(await dpapi(value.slice(6), true), 'base64').toString('utf8');
    },
  };
  // POSIX fallback is explicitly owner-only storage, not OS credential encryption.
  return {
    protect: async value => 'owner-file:' + Buffer.from(value, 'utf8').toString('base64'),
    unprotect: async value => {
      if (!value.startsWith('owner-file:')) throw new AiServiceError('密钥存储与当前系统不兼容，请重新输入 API Key。');
      return Buffer.from(value.slice(11), 'base64').toString('utf8');
    },
  };
}

function text(value: unknown, label: string, limit: number, optional = false): string {
  if (typeof value !== 'string' || value.length > limit || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || (!optional && !value.trim())) throw new AiServiceError(`${label}无效。`);
  return value.trim();
}
export function normalizeAiBaseUrl(value: unknown): string {
  const source = text(value, 'API 地址', 2048);
  let url: URL;
  try { url = new URL(source); } catch { throw new AiServiceError('API 地址需要完整的 HTTP 或 HTTPS 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AiServiceError('API 地址只允许 HTTP 或 HTTPS，不能包含账号、密码、查询或片段。');
  return url.href.replace(/\/+$/, '');
}
function checkedProvider(value: unknown): AiProviderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AiServiceError('AI 服务配置无效。');
  const item = value as Record<string, unknown>;
  const id = text(item.id, '服务标识', 128);
  if (!identifier.test(id) || forbidden.has(id)) throw new AiServiceError('服务标识无效。');
  if (!['openai-chat', 'openai-responses', 'anthropic'].includes(item.protocol as string)) throw new AiServiceError('请选择支持的 AI 接口类型。');
  const result: AiProviderInput = { id, name: text(item.name, '服务名称', 120), baseUrl: normalizeAiBaseUrl(item.baseUrl), protocol: item.protocol as AiProvider['protocol'], model: text(item.model, '模型名称', 256) };
  if (Object.hasOwn(item, 'apiKey')) result.apiKey = text(item.apiKey, 'API Key', 8192, true);
  return result;
}
function publicSettings(stored: StoredSettings, revision: string): AiSettings {
  return { revision, defaultProviderId: stored.defaultProviderId, providers: stored.providers.map(provider => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, protocol: provider.protocol, model: provider.model, hasApiKey: provider.secret.length > 0 })) };
}

export class AiProviderStore {
  readonly filename: string;
  private protector: AiSecretProtector;
  private persistence?: AiProviderPersistence;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(target: string | AiProviderPersistence, protector = systemAiSecretProtector()) {
    this.filename = typeof target === 'string' ? path.resolve(target) : '';
    this.persistence = typeof target === 'string' ? undefined : target;
    this.protector = protector;
  }
  private async source(): Promise<string> {
    if (this.persistence) return this.persistence.read();
    try { return await readFile(this.filename, 'utf8'); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw new AiServiceError('无法读取 AI 服务配置。'); return ''; }
  }
  private async load(input?: string): Promise<{ stored: StoredSettings; revision: string }> {
    const source = input ?? await this.source();
    if (!source) return { stored: { version: 1, defaultProviderId: null, providers: [] }, revision: digest('') };
    try {
      if (Buffer.byteLength(source) > 512 * 1024) throw new Error();
      const stored = JSON.parse(source) as StoredSettings;
      if (stored.version !== 1 || !Array.isArray(stored.providers) || stored.providers.length > 20 || !(stored.defaultProviderId === null || typeof stored.defaultProviderId === 'string')) throw new Error();
      const ids = new Set<string>();
      for (const provider of stored.providers) {
        checkedProvider(provider);
        if (ids.has(provider.id) || typeof provider.secret !== 'string' || provider.secret.length > 32768) throw new Error();
        ids.add(provider.id);
      }
      if (stored.defaultProviderId !== null && !ids.has(stored.defaultProviderId)) throw new Error();
      return { stored, revision: digest(source) };
    } catch { throw new AiServiceError('AI 服务配置损坏或版本不受支持，请保留原文件并重新配置。'); }
  }
  async read(): Promise<AiSettings> { const { stored, revision } = await this.load(); return publicSettings(stored, revision); }
  async resolve(id: string): Promise<AiProviderSecret> {
    const { stored } = await this.load(); const found = stored.providers.find(provider => provider.id === id);
    if (!found) throw new AiServiceError('AI 服务不存在，请重新选择。', 404);
    return { id: found.id, name: found.name, baseUrl: found.baseUrl, protocol: found.protocol, model: found.model, apiKey: found.secret ? await this.protector.unprotect(found.secret) : '' };
  }
  async write(value: AiSettingsInput): Promise<AiSettings> {
    if (!value || typeof value !== 'object' || typeof value.revision !== 'string' || !Array.isArray(value.providers) || value.providers.length > 20) throw new AiServiceError('AI 服务配置无效，最多保存 20 项。');
    const providers = value.providers.map(checkedProvider); const ids = new Set(providers.map(provider => provider.id));
    if (ids.size !== providers.length || value.defaultProviderId !== null && !ids.has(value.defaultProviderId)) throw new AiServiceError('默认服务无效或服务标识重复。');
    const action = this.queue.catch(() => {}).then(async () => {
      const prepare = async (original: string) => {
        const current = await this.load(original);
        if (current.revision !== value.revision) throw new AiServiceError('AI 服务已在其他窗口更新，请重新加载后再保存。', 409);
        const storedProviders: StoredProvider[] = [];
        for (const input of providers) {
          const previous = current.stored.providers.find(provider => provider.id === input.id);
          if (previous?.secret && input.apiKey === undefined && new URL(previous.baseUrl).origin !== new URL(input.baseUrl).origin) throw new AiServiceError('更换服务地址后请重新输入 API Key，或显式清除密钥。');
          const { apiKey, ...provider } = input;
          const secret = apiKey === undefined ? previous?.secret ?? '' : apiKey ? await this.protector.protect(apiKey) : '';
          storedProviders.push({ ...provider, secret });
        }
        const stored: StoredSettings = { version: 1, defaultProviderId: value.defaultProviderId, providers: storedProviders };
        const source = JSON.stringify(stored); const temporary = this.filename + '.' + randomUUID() + '.tmp';
        if (Buffer.byteLength(source) > 512 * 1024) throw new AiServiceError('AI 服务配置过大，请减少服务配置或密钥长度。');
        if (this.persistence) return source;
        try {
          await writeFile(temporary, source, { flag: 'wx', mode: 0o600 });
          for (let attempt = 0; ; attempt++) {
            try { await rename(temporary, this.filename); break; }
            catch (cause) { if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause; await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); }
          }
          if (process.platform !== 'win32') await chmod(this.filename, 0o600);
        } catch (cause) { if (cause instanceof AiServiceError) throw cause; throw new AiServiceError('AI 服务配置保存失败，请检查本机文件权限。'); }
        finally { await rm(temporary, { force: true }); }
        return source;
      };
      let source: string;
      if (this.persistence) source = await this.persistence.update(prepare);
      else {
        await mkdir(path.dirname(this.filename), { recursive: true });
        source = await withExportProfileLock(this.filename + '.locks', async () => prepare(await this.source()));
      }
      return publicSettings((await this.load(source)).stored, digest(source));
    });
    this.queue = action; return action;
  }
}
