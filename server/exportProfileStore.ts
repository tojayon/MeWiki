import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseExportProfiles, type ExportProfileCollection } from '../src/state/exportProfiles.ts';
import { withExportProfileLock } from './exportProfileLock.ts';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class ExportProfileStore {
  private queue: Promise<unknown> = Promise.resolve();
  private directory: string;
  constructor(directory: string) { this.directory = directory; }
  private filename(library: string, plugin: string) {
    if (![library, plugin].every(value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value))) throw new Error('个人模板所属资料库或插件无效。');
    return path.join(this.directory, digest(JSON.stringify([library, plugin])) + '.json');
  }
  async read(library: string, plugin: string): Promise<ExportProfileCollection> {
    const filename = this.filename(library, plugin);
    let source = '[]';
    try { source = await readFile(filename, 'utf8'); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    return { revision: digest(source), profiles: parseExportProfiles(JSON.parse(source)) };
  }
  async write(library: string, plugin: string, revision: string, profiles: unknown): Promise<ExportProfileCollection> {
    const checked = parseExportProfiles(profiles);
    const source = JSON.stringify(checked);
    if (Buffer.byteLength(source) > 32 * 1024 * 1024) throw new Error('个人模板总大小超过 32 MiB，请减少图片或导出后清理。');
    const filename = this.filename(library, plugin);
    const action = this.queue.catch(() => {}).then(() => withExportProfileLock(path.join(this.directory, 'write.locks'), async () => {
      const current = await this.read(library, plugin);
      if (revision !== current.revision) throw new Error('模板已在其他窗口更新，请重新打开导出窗口后再保存。');
      await mkdir(this.directory, { recursive: true });
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, source, { flag: 'wx' });
        for (let attempt = 0; ; attempt++) {
          try { await rename(temporary, filename); break; }
          catch (cause) { if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause; await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); }
        }
      } finally { await rm(temporary, { force: true }); }
      return { revision: digest(source), profiles: checked };
    }));
    this.queue = action;
    return action;
  }
}
export function createExportProfileMiddleware(store: ExportProfileStore) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.split('?')[0] !== '/api/mewiki/export-profiles') { next(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = new URL(`http://${request.headers.host ?? 'invalid'}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') || request.headers.origin && request.headers.origin !== host.origin || request.headers['x-mewiki-request'] !== 'export-profiles') {
        response.statusCode = 403; throw new Error('个人模板接口只接受本机当前页面的请求。');
      }
      let value: ExportProfileCollection;
      if (request.method === 'GET') {
        const query = new URL(request.url!, host).searchParams;
        value = await store.read(query.get('library') ?? '', query.get('plugin') ?? '');
      } else if (request.method === 'PUT') {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('个人模板请求需要 JSON。');
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw new Error('个人模板总大小超过 32 MiB，请减少图片或导出后清理。'); chunks.push(Buffer.from(chunk)); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        value = await store.write(body.libraryId, body.pluginId, body.revision, body.profiles);
      } else { response.statusCode = 405; throw new Error('个人模板接口不支持此操作。'); }
      response.end(JSON.stringify(value));
    } catch (cause) { if (response.statusCode === 200) response.statusCode = 400; response.end(JSON.stringify({ error: cause instanceof Error ? cause.message : '个人模板保存失败。' })); }
  };
}
export function exportProfilesPlugin(): Plugin {
  let root = process.cwd();
  const attach = (server: { middlewares: { use: (handler: ReturnType<typeof createExportProfileMiddleware>) => unknown } }) => {
    const settings = process.env.MEWIKI_RESEARCH_SETTINGS;
    server.middlewares.use(createExportProfileMiddleware(new ExportProfileStore(settings ? path.resolve(settings) + '.export-profiles' : path.join(root, '.mewiki', 'export-profiles'))));
  };
  return { name: 'mewiki-export-profiles', configResolved(config) { root = config.root; }, configureServer: attach, configurePreviewServer: attach };
}
