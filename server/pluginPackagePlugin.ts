import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { PluginPackageStore } from './pluginPackageStore.ts';
import { PLUGIN_PACKAGE_LIMIT } from './pluginPackageArchive.ts';

const prefix = '/api/mewiki/plugins';
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
class PluginRequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function authorize(request: IncomingMessage) {
  const host = new URL(`http://${request.headers.host ?? 'invalid'}`);
  if (!loopback.has(host.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
    throw new PluginRequestError('插件管理接口仅允许本机访问。', 403);
  }
  if (request.headers.origin && request.headers.origin !== host.origin) throw new PluginRequestError('插件管理接口只接受当前 MeWiki 的请求。', 403);
  if (request.method !== 'GET' && request.headers['x-mewiki-request'] !== 'plugins') throw new PluginRequestError('插件管理请求来源无效。', 403);
}
async function body(request: IncomingMessage) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > PLUGIN_PACKAGE_LIMIT) { request.resume(); throw new PluginRequestError('插件包超过 1 MiB。', 413); }
  return new Promise<Buffer>((resolve, reject) => {
    let total = 0; const chunks: Buffer[] = [];
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); };
    const error = (cause: Error) => { cleanup(); reject(cause); };
    const aborted = () => error(new PluginRequestError('插件上传已中止。'));
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const data = (value: Buffer) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value); total += chunk.length;
      if (total > PLUGIN_PACKAGE_LIMIT) {
        cleanup(); request.resume(); reject(new PluginRequestError('插件包超过 1 MiB。', 413)); return;
      }
      chunks.push(chunk);
    };
    request.on('data', data); request.on('end', end); request.on('error', error); request.on('aborted', aborted);
  });
}
async function controlBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new PluginRequestError('插件管理请求需要 JSON。', 415);
  try {
    const value: unknown = JSON.parse((await body(request)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof PluginRequestError) throw cause;
    throw new PluginRequestError('插件管理请求不是有效的 JSON。');
  }
}

export function createPluginPackageMiddleware(store: PluginPackageStore) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const route = request.url?.split('?')[0] ?? '';
    if (route !== prefix && !route.startsWith(prefix + '/')) { next(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      authorize(request);
      let result: unknown;
      if (route !== prefix && route !== prefix + '/inspect') throw new PluginRequestError('插件管理接口不存在。', 404);
      if (request.method === 'GET' && route === prefix) result = { plugins: await store.list() };
      else if (request.method === 'POST') {
        const contentType = request.headers['content-type']?.split(';')[0].trim();
        if (!['application/octet-stream', 'application/zip', 'application/json'].includes(contentType ?? '')) throw new PluginRequestError('请选择 JSON 或 ZIP 插件包。', 415);
        const bytes = await body(request);
        result = route.endsWith('/inspect') ? await store.inspect(bytes) : { plugin: await store.install(bytes) };
      } else if (request.method === 'PUT' && route === prefix) {
        const value = await controlBody(request);
        if (typeof value.id !== 'string' || typeof value.version !== 'string') throw new PluginRequestError('缺少插件身份或版本。');
        result = { plugin: await store.activate(value.id, value.version) };
      } else if (request.method === 'DELETE' && route === prefix) {
        const value = await controlBody(request);
        if (typeof value.id !== 'string') throw new PluginRequestError('缺少插件身份。');
        await store.uninstall(value.id); result = { removed: true };
      } else throw new PluginRequestError('插件管理接口不支持此操作。', 405);
      response.end(JSON.stringify(result));
    } catch (cause) {
      response.statusCode = cause instanceof PluginRequestError ? cause.status : 400;
      response.end(JSON.stringify({ error: cause instanceof Error ? cause.message : '插件管理失败。' }));
    }
  };
}

async function bundledIds(root: string) {
  const directory = path.join(root, 'plugins');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; }
  const ids = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    try {
      const manifest: unknown = JSON.parse(await readFile(path.join(directory, entry.name, 'manifest.json'), 'utf8'));
      return manifest && typeof manifest === 'object' && 'id' in manifest && typeof manifest.id === 'string' ? manifest.id : null;
    } catch { return null; }
  }));
  return ids.filter((id): id is string => id !== null);
}
export function pluginPackagesPlugin(): Plugin {
  let root = process.cwd(); let middleware: ReturnType<typeof createPluginPackageMiddleware>;
  const handler = async () => {
    const settings = process.env.MEWIKI_RESEARCH_SETTINGS;
    const directory = process.env.MEWIKI_PLUGIN_DIRECTORY ?? (settings ? path.resolve(settings) + '.plugins' : path.join(root, '.mewiki', 'plugins'));
    return middleware ??= createPluginPackageMiddleware(new PluginPackageStore(directory, await bundledIds(root)));
  };
  return {
    name: 'mewiki-plugin-packages',
    configResolved(config) { root = config.root; },
    async configureServer(server) { server.middlewares.use(await handler()); },
    async configurePreviewServer(server) { server.middlewares.use(await handler()); },
  };
}
