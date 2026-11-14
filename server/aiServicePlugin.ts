import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { AiSettingsInput, AiStreamEvent } from '../src/ai/types.ts';
import { AiProviderStore, AiServiceError } from './aiProviderStore.ts';
import { checkedAiChatInput, completeAi, listAiModels, testAiConnection } from './aiTransport.ts';
import { aiHttpFailure, type AiFailure } from '../src/ai/failures.ts';

const prefix = '/api/mewiki/ai';
const MAX_BODY_BYTES = 1024 * 1024;
function authorize(request: IncomingMessage) {
  let host: URL;
  try { host = new URL(`http://${request.headers.host ?? 'invalid'}`); }
  catch { throw new AiServiceError('AI 接口只接受本机当前页面的请求。', 403); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || host.username || host.password || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') || request.headers.origin && request.headers.origin !== host.origin || request.headers['x-mewiki-request'] !== 'ai') throw new AiServiceError('AI 接口只接受本机当前页面的请求。', 403);
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new AiServiceError('AI 请求需要 JSON。', 415);
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) { request.resume(); throw new AiServiceError('AI 请求超过 1 MiB，请缩小任务范围。', 413); }
  const source = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); };
    const error = () => { cleanup(); reject(new AiServiceError('AI 请求读取失败或已取消。')); };
    const aborted = () => error();
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const data = (input: Buffer) => {
      const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input); bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { cleanup(); request.resume(); reject(new AiServiceError('AI 请求超过 1 MiB，请缩小任务范围。', 413)); return; }
      chunks.push(chunk);
    };
    const timer = setTimeout(() => { cleanup(); request.resume(); reject(new AiServiceError('AI 请求读取超时。', 408)); }, 15000);
    request.on('data', data); request.on('end', end); request.on('error', error); request.on('aborted', aborted);
  });
  try {
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AiServiceError('AI 请求不是有效的 JSON。'); }
}
function safeError(cause: unknown): { status: number; error: string; failure: AiFailure } {
  return cause instanceof AiServiceError ? { status: cause.status, error: cause.message, failure: cause.failure ?? (cause.status === 400 ? { kind: 'request', recovery: 'revise', status: 400 } : aiHttpFailure(cause.status)) } : { status: 500, error: 'AI 服务操作失败，请稍后重试。', failure: aiHttpFailure(500) };
}

export function createAiServiceMiddleware(store: AiProviderStore) {
  let active = 0;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const route = request.url?.split('?')[0] ?? '';
    if (route !== prefix && !route.startsWith(prefix + '/')) { next(); return; }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    let controller: AbortController | undefined; let allocated = false;
    const abort = () => { if (!response.writableFinished) controller?.abort(); };
    try {
      authorize(request);
      if (route === prefix + '/settings') {
        if (request.method === 'GET') response.end(JSON.stringify(await store.read()));
        else if (request.method === 'PUT') response.end(JSON.stringify(await store.write(await body(request) as unknown as AiSettingsInput)));
        else throw new AiServiceError('AI 服务接口不支持此操作。', 405);
        return;
      }
      if (![prefix + '/models', prefix + '/test', prefix + '/chat'].includes(route)) throw new AiServiceError('AI 服务接口不存在。', 404);
      if (request.method !== 'POST') throw new AiServiceError('AI 服务接口不支持此操作。', 405);
      const value = await body(request);
      if (typeof value.providerId !== 'string' || value.providerId.length > 128) throw new AiServiceError('请选择已保存的 AI 服务。');
      const chat = route.endsWith('/chat') ? checkedAiChatInput(value) : null;
      if (active >= 4) throw new AiServiceError('AI 请求过多，请等待现有任务完成。', 429, { kind: 'rate-limit', recovery: 'retry', status: 429, retryAt: Date.now() + 1000 });
      allocated = true; active++;
      controller = new AbortController();
      request.on('aborted', abort); response.on('close', abort);
      const provider = await store.resolve(value.providerId).catch(cause => {
        if (cause instanceof AiServiceError) throw new AiServiceError(cause.message, cause.status, { kind: 'configuration', recovery: 'settings', status: cause.status });
        throw cause;
      });
      if (controller.signal.aborted || response.destroyed) return;
      const options = { signal: controller.signal };
      if (route.endsWith('/models')) response.end(JSON.stringify({ models: await listAiModels(provider, options) }));
      else if (route.endsWith('/test')) response.end(JSON.stringify(await testAiConnection(provider, options)));
      else {
        response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        response.flushHeaders();
        const send = (event: AiStreamEvent) => { if (!response.destroyed && !controller!.signal.aborted) response.write(JSON.stringify(event) + '\n'); };
        try {
          const result = await completeAi(provider, chat!, { ...options, onText: text => send({ type: 'text', text }), onTool: update => send({ type: 'tool', update }) });
          send({ type: 'done', result });
        } catch (cause) { const failure = safeError(cause); send({ type: 'error', error: failure.error, failure: failure.failure }); }
        response.end();
      }
    } catch (cause) {
      if (!response.destroyed && !response.writableEnded) {
        const failure = safeError(cause);
        if (!response.headersSent) {
          response.statusCode = failure.status;
          if (failure.failure.retryAt) response.setHeader('Retry-After', Math.max(0, Math.ceil((failure.failure.retryAt - Date.now()) / 1000)));
          response.end(JSON.stringify({ error: failure.error, failure: failure.failure }));
        }
        else response.end(JSON.stringify({ type: 'error', error: failure.error, failure: failure.failure }) + '\n');
      }
    } finally {
      request.off('aborted', abort); response.off('close', abort);
      if (allocated) active--;
    }
  };
}

export function aiServicePlugin(): Plugin {
  let root = process.cwd();
  const attach = (server: { middlewares: { use: (handler: ReturnType<typeof createAiServiceMiddleware>) => unknown } }) => {
    const settings = process.env.MEWIKI_RESEARCH_SETTINGS;
    const filename = settings ? path.resolve(settings) + '.ai-services.json' : path.join(root, '.mewiki', 'ai-services.json');
    server.middlewares.use(createAiServiceMiddleware(new AiProviderStore(filename)));
  };
  return { name: 'mewiki-ai-service', configResolved(config) { root = config.root; }, configureServer: attach, configurePreviewServer: attach };
}
