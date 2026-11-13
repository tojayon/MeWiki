import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeAi } from './client.ts';

afterEach(() => vi.unstubAllGlobals());
describe('AI streaming client', () => {
  it('forwards validated tool deltas and refuses malformed, oversized and late events', async () => {
    const update = { key: 'call-0', name: 'propose_note', arguments: '{"content":"草稿' };
    const done = { type: 'done', result: { message: { role: 'assistant', content: '' }, usage: { inputTokens: 1, outputTokens: 1 } } };
    const request = { providerId: 'a', messages: [] };
    const updates: unknown[] = [];
    vi.stubGlobal('fetch', async () => new Response([JSON.stringify({ type: 'tool', update }), JSON.stringify(done)].join('\n')));
    await completeAi(request, { onTool: value => updates.push(value) });
    expect(updates).toEqual([update]);
    for (const invalid of [{ ...update, key: '' }, { ...update, key: '\u0000' }, { ...update, key: '\u007f' }, { ...update, name: 'bad tool' }, { ...update, arguments: 4 }, { ...update, reset: 'yes' }, { ...update, arguments: 'x'.repeat(262145) }]) {
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ type: 'tool', update: invalid }) + '\n' + JSON.stringify(done)));
      await expect(completeAi(request)).rejects.toThrow(/格式|长度/);
    }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(done) + '\n' + JSON.stringify({ type: 'tool', update })));
    await expect(completeAi(request)).rejects.toThrow(/格式/);
  });
  it('does not forward tool deltas after cancellation', async () => {
    const abort = new AbortController(), updates: unknown[] = [];
    const update = { key: '0', name: 'propose_note', arguments: 'partial' };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ type: 'text', text: '开始' }) + '\n' + JSON.stringify({ type: 'tool', update }) + '\n'));
    await expect(completeAi({ providerId: 'a', messages: [] }, { signal: abort.signal, onText: () => abort.abort(), onTool: value => updates.push(value) })).rejects.toThrow();
    expect(updates).toEqual([]);
  });
  it('bounds accumulated tool arguments and honors replacement resets', async () => {
    const request = { providerId: 'a', messages: [] };
    const done = { type: 'done', result: { message: { role: 'assistant', content: '' }, usage: { inputTokens: 0, outputTokens: 0 } } };
    const update = { key: '0', name: 'propose_note', arguments: 'x'.repeat(131072) };
    const response = (updates: unknown[]) => new Response([...updates.map(value => ({ type: 'tool', update: value })), done].map(value => JSON.stringify(value)).join('\n'));
    vi.stubGlobal('fetch', async () => response([update, update, { ...update, arguments: 'x' }]));
    await expect(completeAi(request)).rejects.toThrow(/长度/);
    vi.stubGlobal('fetch', async () => response([update, { ...update, reset: true }, update]));
    const updates: unknown[] = [];
    await completeAi(request, { onTool: value => updates.push(value) });
    expect(updates).toEqual([update, { ...update, reset: true }, update]);
    vi.stubGlobal('fetch', async () => response(Array.from({ length: 21 }, (_, index) => ({ ...update, key: String(index), arguments: '' }))));
    await expect(completeAi(request)).rejects.toThrow(/长度/);
  });
  it('decodes split UTF-8 NDJSON and requires an explicit completed result', async () => {
    const encoded = new TextEncoder().encode('{"type":"text","text":"中文"}\n{"type":"done","result":{"message":{"role":"assistant","content":"中文"},"usage":{"inputTokens":3,"outputTokens":2}}}\n');
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      expect(init.headers['X-MeWiki-Request']).toBe('ai');
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i += 2) controller.enqueue(encoded.slice(i, i + 2)); controller.close(); } }));
    }));
    const text: string[] = [];
    const result = await completeAi({ providerId: 'a', messages: [{ role: 'user', content: '你好' }] }, { onText: value => text.push(value) });
    expect(text.join('')).toBe('中文'); expect(result.usage.inputTokens).toBe(3);
    vi.stubGlobal('fetch', async () => new Response('{"type":"text","text":"半截"}\n'));
    await expect(completeAi({ providerId: 'a', messages: [] })).rejects.toThrow(/中断/);
  });
});
