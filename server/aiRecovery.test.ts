import { describe, expect, it, vi } from 'vitest';
import { completeAi } from './aiTransport.ts';

const provider = { id: 'fixture', name: '虚构服务', baseUrl: 'http://127.0.0.1:9876/v1', protocol: 'openai-chat' as const, model: 'fixture', apiKey: '' };
const input = { messages: [{ role: 'user' as const, content: '虚构任务' }] };

describe('typed AI failures and streaming deadlines', () => {
  it('preserves rate-limit status and a bounded Retry-After without upstream text', async () => {
    const now = Date.now();
    const result = completeAi(provider, input, { fetch: async () => new Response('PRIVATE_UPSTREAM_BODY', { status: 429, headers: { 'Retry-After': '3' } }) });
    await expect(result).rejects.toMatchObject({ status: 429, failure: { kind: 'rate-limit', recovery: 'retry', retryAt: expect.any(Number) } });
    await result.catch(error => { expect(error.failure.retryAt).toBeGreaterThanOrEqual(now + 3000); expect(error.message).not.toContain('PRIVATE'); });
  });
  it.each([401, 403, 404, 400])('classifies HTTP %s as a configuration problem', async status => {
    await expect(completeAi(provider, input, { fetch: async () => new Response('', { status }) })).rejects.toMatchObject({ failure: { kind: 'configuration', recovery: 'settings' } });
  });
  it('classifies network failures without exposing thrown secrets', async () => {
    await expect(completeAi(provider, input, { fetch: async () => { throw new Error('PRIVATE_SECRET'); } })).rejects.toMatchObject({ failure: { kind: 'network', recovery: 'retry' } });
  });
  it('classifies truncated output as a task revision rather than a configuration failure', async () => {
    const body = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '未完成' }, finish_reason: 'length' }] }) + '\n\ndata: [DONE]\n\n';
    await expect(completeAi(provider, input, { fetch: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) })).rejects.toMatchObject({ failure: { kind: 'request', recovery: 'revise' } });
  });
  it('accepts an actively streaming reply past one idle interval', async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const encode = (value: unknown) => new TextEncoder().encode('data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n\n');
    const promise = completeAi(provider, input, { idleTimeoutMs: 100, timeoutMs: 1000, fetch: async () => new Response(new ReadableStream({ start(value) { stream = value; } }), { headers: { 'Content-Type': 'text/event-stream' } }) });
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (let index = 0; index < 4; index++) { await vi.advanceTimersByTimeAsync(70); stream.enqueue(encode({ choices: [{ delta: { content: '虚构' } }] })); await vi.advanceTimersByTimeAsync(0); }
      stream.enqueue(encode('[DONE]')); stream.close();
      await expect(promise).resolves.toMatchObject({ message: { content: '虚构虚构虚构虚构' } });
    } finally { vi.useRealTimers(); }
  });
  it('ends a silent stream on the idle deadline even if the mock ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const promise = completeAi(provider, input, { idleTimeoutMs: 100, timeoutMs: 1000, fetch: async () => new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } }) });
    const assertion = expect(promise).rejects.toMatchObject({ failure: { kind: 'timeout', recovery: 'retry' } });
    try { await vi.advanceTimersByTimeAsync(101); await assertion; } finally { vi.useRealTimers(); }
  });
  it('does not extend the total deadline with keepalive chunks', async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const promise = completeAi(provider, input, { idleTimeoutMs: 100, timeoutMs: 180, fetch: async () => new Response(new ReadableStream({ start(value) { stream = value; } }), { headers: { 'Content-Type': 'text/event-stream' } }) });
    const assertion = expect(promise).rejects.toMatchObject({ failure: { kind: 'timeout', recovery: 'retry' } });
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (let index = 0; index < 2; index++) { await vi.advanceTimersByTimeAsync(70); stream.enqueue(new TextEncoder().encode(': ping\n\n')); await vi.advanceTimersByTimeAsync(0); }
      await vi.advanceTimersByTimeAsync(41); await assertion;
    } finally { vi.useRealTimers(); }
  });
  it('accepts HTTP-date retry hints and ignores invalid ones', async () => {
    for (const retryAfter of [new Date(Date.now() + 5000).toUTCString(), 'invalid', '-1']) {
      const result = completeAi(provider, input, { fetch: async () => new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }) });
      await expect(result).rejects.toMatchObject({ failure: { kind: 'rate-limit', recovery: 'retry' } });
      await result.catch(error => { if (retryAfter.includes('GMT')) expect(error.failure.retryAt).toBeGreaterThan(Date.now()); else expect(error.failure.retryAt).toBeUndefined(); });
    }
  });
});
