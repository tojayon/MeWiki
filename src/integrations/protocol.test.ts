import { describe, expect, it, vi } from 'vitest';
import { createMessagePeer, integrationUrl, PROTOCOL } from '../../public/integration/mewiki-host.js';

function fixture() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const self = { addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn), removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn) };
  const sent: unknown[] = [];
  const target = { postMessage: (value: unknown, origin: string) => sent.push({ value, origin }) };
  const peer = createMessagePeer({ self, target, origin: 'http://127.0.0.1:4173', session: 'session-12345678901234567890', timeout: 30 });
  const message = (value: unknown, origin = 'http://127.0.0.1:4173', source: unknown = target) => { for (const fn of listeners) fn({ data: value, origin, source } as MessageEvent); };
  const envelope = (extra: object) => ({ protocol: PROTOCOL, version: 1, session: 'session-12345678901234567890', ...extra });
  return { peer, target, sent, listeners, message, envelope };
}
describe('MeWiki integration v1', () => {
  it('ignores foreign origins, frames, sessions and protocol versions', async () => {
    const f = fixture(); const action = vi.fn(); f.peer.handle('context.set', action);
    const msg = f.envelope({ id: '1', method: 'context.set', params: {} });
    f.message(msg, 'https://evil.example'); f.message(msg, undefined, {}); f.message({ ...msg, session: 'wrong' }); f.message({ ...msg, version: 2 });
    await Promise.resolve(); expect(action).not.toHaveBeenCalled(); f.peer.dispose();
  });
  it('deduplicates requests and returns a matching response to the exact origin', async () => {
    const f = fixture(); const action = vi.fn(() => ({ accepted: true })); f.peer.handle('context.set', action);
    const msg = f.envelope({ id: 'request-1', method: 'context.set', params: {} }); f.message(msg); f.message(msg);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(action).toHaveBeenCalledTimes(1);
    expect(f.sent).toContainEqual({ origin: 'http://127.0.0.1:4173', value: f.envelope({ replyTo: 'request-1', result: { accepted: true } }) }); f.peer.dispose();
  });
  it('reports unsupported actions and times out or disposes pending requests', async () => {
    const f = fixture(); f.message(f.envelope({ id: 'missing', method: 'not.allowed' }));
    await vi.waitFor(() => expect(JSON.stringify(f.sent)).toContain('unsupported_method'));
    await expect(f.peer.request('never')).rejects.toThrow(/超时/);
    const pending = f.peer.request('pending'); f.peer.dispose(); await expect(pending).rejects.toThrow(/关闭/); expect(f.listeners.size).toBe(0);
  });
  it('resolves only the matching response and limits payload size', async () => {
    const f = fixture(); const pending = f.peer.request('ping', {});
    const sent = (f.sent[0] as { value: { id: string } }).value;
    f.message(f.envelope({ replyTo: 'other', result: 'wrong' })); f.message(f.envelope({ replyTo: sent.id, result: 'ok' }));
    await expect(pending).resolves.toBe('ok');
    await expect(f.peer.request('large', { value: 'x'.repeat(300000) })).rejects.toThrow(/过大/); f.peer.dispose();
  });
  it('builds exact embedded origin and session without accepting wildcard origins', () => {
    const url = new URL(integrationUrl('http://127.0.0.1:5280', { hostOrigin: 'http://127.0.0.1:4173', session: 'session-12345678901234567890' }));
    expect(url.searchParams.get('hostOrigin')).toBe('http://127.0.0.1:4173');
    expect(() => integrationUrl('http://127.0.0.1:5280', { hostOrigin: '*', session: 'session-12345678901234567890' })).toThrow();
  });
});
