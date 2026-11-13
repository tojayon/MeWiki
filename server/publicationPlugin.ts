import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parsePublicationRequest, PUBLICATION_MAX_REQUEST_BYTES, type PublicationJob, type PublicationRequest, type PublicationResult } from '../src/domain/publicationTypes.ts';
import { renderPublication, type PublicationProgress } from './publicationRenderer.ts';
import { collectPublicationStyles, publicationStylesFilename } from './publicationStyles.ts';
import { PublicationContentError } from '../src/domain/publicationDiagnostics.ts';

const prefix = '/api/mewiki/publications/jobs';
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
class PublicationRequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
type Renderer = (request: PublicationRequest, signal?: AbortSignal, progress?: (progress: PublicationProgress) => void) => Promise<PublicationResult>;
interface JobEntry { value: PublicationJob; controller: AbortController; createdAt: number }
export class PublicationJobs {
  private entries = new Map<string, JobEntry>();
  private active: string | undefined;
  private readonly renderer: Renderer;
  private readonly cleanup: ReturnType<typeof setInterval>;
  constructor(renderer: Renderer = renderPublication) {
    this.renderer = renderer;
    this.cleanup = setInterval(() => this.expire(), 30000); this.cleanup.unref();
  }
  private expire() {
    const cutoff = Date.now() - 5 * 60000;
    for (const [id, entry] of this.entries) if (entry.createdAt < cutoff) this.remove(id);
  }
  create(input: unknown): string {
    const request = parsePublicationRequest(input);
    this.expire();
    if (this.active) throw new PublicationRequestError('另一个图片导出正在进行，请完成或取消后重试。', 429);
    // Keep at most two finished results, never cache document snapshots on disk.
    while (this.entries.size >= 2) this.remove(this.entries.keys().next().value!);
    const id = randomUUID();
    const entry: JobEntry = { value: { id, status: 'running', completed: 0, total: 0 }, controller: new AbortController(), createdAt: Date.now() };
    this.entries.set(id, entry); this.active = id;
    void this.renderer(request, entry.controller.signal, progress => {
      if (!entry.controller.signal.aborted) { entry.value.completed = progress.completed; entry.value.total = progress.total; }
    }).then(result => {
      if (entry.controller.signal.aborted || !this.entries.has(id)) return;
      entry.value = { id, status: 'complete', completed: result.pages.length, total: result.pages.length, result };
    }).catch(cause => {
      if (entry.controller.signal.aborted || !this.entries.has(id)) return;
      entry.value = { ...entry.value, status: 'error', error: cause instanceof Error ? cause.message : '图片导出失败，请调整内容后重试。', ...(cause instanceof PublicationContentError && cause.diagnostics.length ? { diagnostics: cause.diagnostics } : {}) };
    }).finally(() => { if (this.active === id) this.active = undefined; });
    return id;
  }
  get(id: string): PublicationJob {
    this.expire(); const entry = this.entries.get(id);
    if (!entry) throw new PublicationRequestError('图片导出任务已取消或过期，请重新生成。', 404);
    return entry.value;
  }
  remove(id: string): void {
    const entry = this.entries.get(id); if (!entry) return;
    entry.controller.abort(); this.entries.delete(id);
    // The active slot remains held until browser cleanup has actually finished.
  }
  close(): void { clearInterval(this.cleanup); for (const id of this.entries.keys()) this.remove(id); }
}
function authorize(request: IncomingMessage) {
  const host = new URL(`http://${request.headers.host ?? 'invalid'}`);
  if (!loopback.has(host.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) throw new PublicationRequestError('图片导出接口仅允许本机访问。', 403);
  if (request.headers.origin && request.headers.origin !== host.origin) throw new PublicationRequestError('图片导出接口只接受当前 MeWiki 的请求。', 403);
  if (request.headers['x-mewiki-request'] !== 'publications') throw new PublicationRequestError('图片导出请求来源无效。', 403);
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new PublicationRequestError('图片导出请求需要 JSON。', 415);
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > PUBLICATION_MAX_REQUEST_BYTES) { request.resume(); throw new PublicationRequestError('图片导出请求过大，请减少字体或内容。', 413); }
  const data: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > PUBLICATION_MAX_REQUEST_BYTES) { request.resume(); throw new PublicationRequestError('图片导出请求过大，请减少字体或内容。', 413); }
    data.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(data).toString('utf8')); }
  catch { throw new PublicationRequestError('图片导出请求不是有效的 JSON。'); }
}
export function createPublicationMiddleware(jobs: PublicationJobs) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const route = request.url?.split('?')[0] ?? '';
    if (route !== prefix && !route.startsWith(prefix + '/')) { next(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      authorize(request); let result: unknown;
      if (route === prefix && request.method === 'POST') {
        const id = jobs.create(await body(request));
        response.once('close', () => { if (!response.writableFinished) jobs.remove(id); });
        result = { id };
      } else if (route.startsWith(prefix + '/')) {
        const id = route.slice(prefix.length + 1);
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) throw new PublicationRequestError('图片导出任务不存在。', 404);
        if (request.method === 'GET') result = jobs.get(id);
        else if (request.method === 'DELETE') { jobs.remove(id); result = { removed: true }; }
        else throw new PublicationRequestError('图片导出接口不支持此操作。', 405);
      } else throw new PublicationRequestError('图片导出接口不支持此操作。', 405);
      response.end(JSON.stringify(result));
    } catch (cause) {
      response.statusCode = cause instanceof PublicationRequestError ? cause.status : 400;
      response.end(JSON.stringify({ error: cause instanceof Error ? cause.message : '图片导出失败，请重试。' }));
    }
  };
}
export function publicationPlugin(): Plugin {
  let root = process.cwd(), outDir = 'dist'; let jobs: PublicationJobs | undefined;
  const handler = () => {
    jobs ??= new PublicationJobs((request, signal, progress) => renderPublication(request, signal, progress, root, outDir));
    return createPublicationMiddleware(jobs);
  };
  return {
    name: 'mewiki-publication',
    configResolved(config) { root = config.root; outDir = config.build.outDir; },
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle).filter(item => item.type === 'asset' && item.fileName.endsWith('.css'));
      this.emitFile({ type: 'asset', fileName: publicationStylesFilename, source: collectPublicationStyles(assets.map(asset => ({ name: asset.fileName, css: String(asset.type === 'asset' ? asset.source : '') }))) });
    },
    configureServer(server) { server.middlewares.use(handler()); server.httpServer?.once('close', () => jobs?.close()); },
    configurePreviewServer(server) { server.middlewares.use(handler()); server.httpServer.once('close', () => jobs?.close()); },
    closeBundle() { jobs?.close(); },
  };
}
