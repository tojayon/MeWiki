import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AiProviderStore } from './aiProviderStore.ts';
import { createAiServiceMiddleware } from './aiServicePlugin.ts';
import type { AiStreamEvent } from '../src/ai/types.ts';

const resources: { root: string; server: Server; upstream: Server }[] = [];
const marker = { 'Content-Type': 'application/json', 'X-MeWiki-Request': 'ai' };
async function fixture(options: { keepStreamOpen?: boolean; onClose?: () => void; onChat?: (response: ServerResponse) => void; upstreamStatus?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-ai-http-'));
  const upstream = createServer((request, response) => {
    if (options.upstreamStatus) { response.writeHead(options.upstreamStatus, { 'Retry-After': '3' }); response.end('PRIVATE_UPSTREAM_BODY'); return; }
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fake-model' }] })); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (options.onChat) { options.onChat(response); return; }
    if (options.keepStreamOpen) {
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '虚构流式内容。'.repeat(20) } }] }) + '\n\n');
      response.on('close', () => options.onClose?.()); return;
    }
    response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '这是虚构笔记的回答。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 3 } }) + '\n\n');
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const store = new AiProviderStore(path.join(root, 'ai.json'), { protect: async v => Buffer.from(v).toString('base64'), unprotect: async v => Buffer.from(v, 'base64').toString() });
  const middleware = createAiServiceMiddleware(store);
  const server = createServer((request, response) => void middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); resources.push({ root, server, upstream });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const baseUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`;
  return { url: origin + '/api/mewiki/ai', baseUrl };
}
afterEach(async () => {
  for (const { root, server, upstream } of resources.splice(0)) {
    for (const item of [server, upstream]) { item.closeAllConnections(); await new Promise<void>(resolve => item.close(() => resolve())); }
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('mewiki-ai-http-')) throw new Error('Unsafe cleanup path');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  }
});
describe('local AI service API', () => {
  it('forwards typed rate-limit recovery over NDJSON and request validation over JSON', async () => {
    const { url, baseUrl } = await fixture({ upstreamStatus: 429 });
    const settings = await (await fetch(url + '/settings', { headers: marker })).json();
    await fetch(url + '/settings', { method: 'PUT', headers: marker, body: JSON.stringify({ revision: settings.revision, defaultProviderId: 'fake', providers: [{ id: 'fake', name: '虚构服务', baseUrl, model: 'fixture', protocol: 'openai-chat' }] }) });
    const result = await fetch(url + '/chat', { method: 'POST', headers: marker, body: JSON.stringify({ providerId: 'fake', messages: [{ role: 'user', content: '只读虚构资料' }] }) });
    const text = await result.text(), event = JSON.parse(text.trim());
    expect(event).toMatchObject({ type: 'error', failure: { kind: 'rate-limit', recovery: 'retry', status: 429, retryAt: expect.any(Number) } });
    expect(text).not.toContain('PRIVATE_UPSTREAM_BODY');
    const bad = await fetch(url + '/chat', { method: 'POST', headers: marker, body: JSON.stringify({ providerId: 'fake', messages: [] }) });
    expect(await bad.json()).toMatchObject({ failure: { kind: 'request', recovery: 'revise' } });
  });
  it('protects every route with local same-origin checks and a request marker, including reads', async () => {
    const { url } = await fixture();
    expect((await fetch(url + '/settings')).status).toBe(403);
    for (const origin of ['null', 'https://foreign.example', 'http://localhost:5280']) {
      const response = await fetch(url + '/settings', { headers: { ...marker, Origin: origin } });
      expect(response.status).toBe(403); expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    const good = await fetch(url + '/settings', { headers: marker });
    expect(good.status).toBe(200); expect(good.headers.get('cache-control')).toBe('no-store');
  });
  it('saves a provider without returning credentials, fetches models and transports normalized text and usage', async () => {
    const { url, baseUrl } = await fixture();
    const empty = await (await fetch(url + '/settings', { headers: marker })).json();
    const savedResponse = await fetch(url + '/settings', { method: 'PUT', headers: marker, body: JSON.stringify({ revision: empty.revision, defaultProviderId: 'fake', providers: [{ id: 'fake', name: '虚构服务', baseUrl, model: 'fake-model', protocol: 'openai-chat', apiKey: 'fictional-only-secret' }] }) });
    expect(savedResponse.status).toBe(200); const saved = await savedResponse.text(); expect(saved).not.toContain('fictional-only-secret'); expect(JSON.parse(saved).providers[0].hasApiKey).toBe(true);
    const models = await fetch(url + '/models', { method: 'POST', headers: marker, body: JSON.stringify({ providerId: 'fake' }) }); expect(await models.json()).toEqual({ models: ['fake-model'] });
    const chat = await fetch(url + '/chat', { method: 'POST', headers: marker, body: JSON.stringify({ providerId: 'fake', messages: [{ role: 'user', content: '只读取虚构内容' }] }) });
    expect(chat.headers.get('content-type')).toContain('ndjson');
    const events = (await chat.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.type === 'text').map(event => event.text).join('')).toBe('这是虚构笔记的回答。');
    expect(events.at(-1)).toMatchObject({ type: 'done', result: { message: { content: '这是虚构笔记的回答。' }, usage: { inputTokens: 11, outputTokens: 3 } } });
    const probe = await fetch(url + '/test', { method: 'POST', headers: marker, body: JSON.stringify({ providerId: 'fake' }) }); expect(await probe.json()).toMatchObject({ response: true, stream: true, tools: false });
    expect((await fetch(url + '/settings', { method: 'PUT', headers: marker, body: JSON.stringify({ revision: empty.revision, defaultProviderId: null, providers: [] }) })).status).toBe(409);
  });
  it('rejects invalid methods, invalid request content and oversized bodies before invoking a model', async () => {
    const { url } = await fixture();
    expect((await fetch(url + '/missing', { headers: marker })).status).toBe(404);
    expect((await fetch(url + '/settings', { method: 'PATCH', headers: marker, body: '{}' })).status).toBe(405);
    expect((await fetch(url + '/chat', { method: 'POST', headers: marker, body: '{' })).status).toBe(400);
    expect((await fetch(url + '/chat', { method: 'POST', headers: marker, body: JSON.stringify({ providerId: 'fake', messages: [] }) })).status).toBe(400);
    expect((await fetch(url + '/chat', { method: 'POST', headers: marker, body: 'x'.repeat(1024 * 1024 + 1) })).status).toBe(413);
  });
  it('forwards successive tool deltas over HTTP while the model stream is still open', async () => {
    const fragments = ['{"content":"第一段', '，第二段', '"}'];
    const event = (delta: unknown, finish_reason?: string) => 'data: ' + JSON.stringify({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] }) + '\n\n';
    let upstreamResponse!: ServerResponse;
    const { url, baseUrl } = await fixture({ onChat: response => {
      upstreamResponse = response;
      response.write(event({ tool_calls: [{ index: 0, id: 'fictional-call', function: { name: 'propose_note', arguments: fragments[0] } }] }));
    } });
    const empty = await (await fetch(url + '/settings', { headers: marker })).json();
    await fetch(url + '/settings', { method: 'PUT', headers: marker, body: JSON.stringify({ revision: empty.revision, defaultProviderId: 'live', providers: [{ id: 'live', name: '实时测试', baseUrl, model: 'fictional', protocol: 'openai-chat', apiKey: '' }] }) });
    const abort = new AbortController();
    const response = await fetch(url + '/chat', { method: 'POST', headers: marker, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]), body: JSON.stringify({ providerId: 'live', messages: [{ role: 'user', content: '虚构修改测试' }] }) });
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    const events: AiStreamEvent[] = []; let pending = '';
    const read = async () => {
      const chunk = await reader.read();
      if (chunk.done) return false;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) if (line) events.push(JSON.parse(line));
      return true;
    };
    try {
      while (events.length < 1 && await read()) { /* Wait for the first NDJSON event. */ }
      expect(events).toEqual([{ type: 'tool', update: { key: '0', name: 'propose_note', arguments: fragments[0] } }]);
      expect(upstreamResponse.writableEnded).toBe(false);
      upstreamResponse.write(event({ tool_calls: [{ index: 0, function: { arguments: fragments[1] } }] }));
      while (events.length < 2 && await read()) { /* Wait for the next independent update. */ }
      expect(events[1]).toEqual({ type: 'tool', update: { key: '0', name: 'propose_note', arguments: fragments[1] } });
      expect(upstreamResponse.writableEnded).toBe(false);
      expect(events.some(value => value.type === 'done')).toBe(false);
      upstreamResponse.end(event({ tool_calls: [{ index: 0, function: { arguments: fragments[2] } }] }, 'tool_calls') + 'data: [DONE]\n\n');
      while (await read()) { /* Drain the completed response. */ }
      expect(events.at(-1)).toMatchObject({ type: 'done', result: { message: { toolCalls: [{ id: 'fictional-call', name: 'propose_note', arguments: fragments.join('') }] } } });
    } finally { abort.abort(); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  });
  it('propagates browser cancellation through the HTTP API to the actual model stream', async () => {
    let closed!: () => void; const upstreamClosed = new Promise<void>(resolve => { closed = resolve; });
    const { url, baseUrl } = await fixture({ keepStreamOpen: true, onClose: closed });
    const empty = await (await fetch(url + '/settings', { headers: marker })).json();
    await fetch(url + '/settings', { method: 'PUT', headers: marker, body: JSON.stringify({ revision: empty.revision, defaultProviderId: 'cancel', providers: [{ id: 'cancel', name: '取消测试', baseUrl, model: 'fictional', protocol: 'openai-chat', apiKey: '' }] }) });
    const controller = new AbortController();
    const response = await fetch(url + '/chat', { method: 'POST', headers: marker, signal: controller.signal, body: JSON.stringify({ providerId: 'cancel', messages: [{ role: 'user', content: '虚构取消测试' }] }) });
    const reader = response.body!.getReader(); expect((await reader.read()).value?.byteLength).toBeGreaterThan(0); controller.abort();
    await Promise.race([upstreamClosed, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('HTTP cancellation did not reach upstream')), 1000))]);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  });
});
