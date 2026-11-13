import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseImageDesigns, parsePersonalStickers, type ImageWorkspaceCollection } from '../src/domain/imageWorkspace.ts';
import { validatePublicationImage } from './publicationHtml.ts';
import { withExportProfileLock } from './exportProfileLock.ts';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export class ImageWorkspaceStore {
  private directory: string;
  constructor(directory: string) { this.directory = directory; }
  private folder(library: string, plugin: string) {
    if (![library, plugin].every(value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value))) throw new Error('图片创作所属资料库或插件无效。');
    return path.join(this.directory, hash(JSON.stringify([library, plugin])));
  }
  async read(library: string, plugin: string): Promise<ImageWorkspaceCollection> {
    let source = '{"designs":[],"stickers":[]}';
    try { source = await readFile(path.join(this.folder(library, plugin), 'index.json'), 'utf8'); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    const value = JSON.parse(source);
    return { revision: hash(source), designs: parseImageDesigns(value.designs), stickers: parsePersonalStickers(value.stickers) };
  }
  async asset(library: string, plugin: string, id: string): Promise<string> {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('图片创作素材标识无效。');
    try {
      const data = await readFile(path.join(this.folder(library, plugin), id + '.image'));
      if (hash(data) !== id) throw new Error();
      return `data:image/${data[0] === 137 ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
    } catch { throw new Error('图片创作素材缺失或损坏，请从作品备份恢复。'); }
  }
  async putAsset(library: string, plugin: string, dataUrl: string): Promise<string> {
    await validatePublicationImage(dataUrl);
    const data = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'), id = hash(data), folder = this.folder(library, plugin);
    await mkdir(folder, { recursive: true });
    return withExportProfileLock(path.join(folder, 'asset.locks'), async () => {
      const filename = path.join(folder, id + '.image');
      try { const existing = await readFile(filename); if (hash(existing) === id) return id; throw new Error('图片创作素材校验失败。'); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
      const files = (await readdir(folder)).filter(name => /^[a-f0-9]{64}\.image$/.test(name));
      let used = 0; for (const name of files) used += (await stat(path.join(folder, name))).size;
      if (used + data.length > 1024 * 1024 * 1024) throw new Error('当前资料库图片创作素材超过 1 GiB，请先备份并整理设计。');
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, data, { flag: 'wx' }); await rename(temporary, filename); }
      finally { await rm(temporary, { force: true }); }
      return id;
    });
  }
  async write(library: string, plugin: string, revision: string, designs: unknown, stickers: unknown): Promise<ImageWorkspaceCollection> {
    const checked = { designs: parseImageDesigns(designs), stickers: parsePersonalStickers(stickers) }, source = JSON.stringify(checked);
    if (Buffer.byteLength(source) > 32 * 1024 * 1024) throw new Error('图片设计配置超过 32 MiB，请减少装饰图片或备份后整理。');
    const folder = this.folder(library, plugin);
    await mkdir(folder, { recursive: true });
    return withExportProfileLock(path.join(folder, 'index.locks'), async () => {
      if ((await this.read(library, plugin)).revision !== revision) throw new Error('图片设计已在其他窗口更新，请重新打开设计列表后再保存。');
      const ids = new Set([...checked.designs.flatMap(design => design.items.map(item => item.assetId)), ...checked.stickers.map(sticker => sticker.assetId)]);
      for (const id of ids) {
        try { await stat(path.join(folder, id + '.image')); }
        catch { throw new Error('图片创作素材缺失，请重新选择图片后保存。'); }
      }
      const temporary = path.join(folder, 'index.' + randomUUID() + '.tmp');
      try { await writeFile(temporary, source, { flag: 'wx' }); await rename(temporary, path.join(folder, 'index.json')); }
      finally { await rm(temporary, { force: true }); }
      return { revision: hash(source), ...checked };
    });
  }
}
export function createImageWorkspaceMiddleware(store: ImageWorkspaceStore) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const route = request.url?.split('?')[0];
    if (route !== '/api/mewiki/image-workspace' && route !== '/api/mewiki/image-workspace/assets') { next(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const host = new URL(`http://${request.headers.host ?? 'invalid'}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') || request.headers.origin && request.headers.origin !== host.origin || request.headers['x-mewiki-request'] !== 'image-workspace') { response.statusCode = 403; throw new Error('图片创作接口只接受本机当前页面的请求。'); }
      const query = new URL(request.url!, host).searchParams, library = query.get('library') ?? '', plugin = query.get('plugin') ?? '';
      let result: unknown;
      if (request.method === 'GET') result = route.endsWith('/assets') ? { dataUrl: await store.asset(library, plugin, query.get('id') ?? '') } : await store.read(library, plugin);
      else if (request.method === 'PUT' && !route.endsWith('/assets') || request.method === 'POST' && route.endsWith('/assets')) {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('图片创作请求需要 JSON。');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 33 * 1024 * 1024) { request.resume(); throw new Error('图片创作保存请求过大，请减少装饰图片。'); } chunks.push(Buffer.from(chunk)); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        result = route.endsWith('/assets') ? { id: await store.putAsset(library, plugin, body.dataUrl) } : await store.write(library, plugin, body.revision, body.designs, body.stickers);
      } else { response.statusCode = 405; throw new Error('图片创作接口不支持此操作。'); }
      response.end(JSON.stringify(result));
    } catch (cause) { if (response.statusCode === 200) response.statusCode = 400; response.end(JSON.stringify({ error: cause instanceof Error ? cause.message : '图片设计保存失败。' })); }
  };
}
export function imageWorkspacePlugin(): Plugin {
  let root = process.cwd();
  const attach = (server: { middlewares: { use: (handler: ReturnType<typeof createImageWorkspaceMiddleware>) => unknown } }) => {
    const settings = process.env.MEWIKI_RESEARCH_SETTINGS;
    server.middlewares.use(createImageWorkspaceMiddleware(new ImageWorkspaceStore(settings ? path.resolve(settings) + '.image-workspace' : path.join(root, '.mewiki', 'image-workspace'))));
  };
  return { name: 'mewiki-image-workspace', configResolved(config) { root = config.root; }, configureServer: attach, configurePreviewServer: attach };
}
