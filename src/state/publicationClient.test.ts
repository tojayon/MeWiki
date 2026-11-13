import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePublication } from './publicationClient.ts';
import type { PublicationRequest } from '../domain/publicationTypes.ts';

afterEach(() => vi.unstubAllGlobals());

describe('publication job lifecycle', () => {
  it('preserves known content diagnostics on a failed job and releases it', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
    const id = 'publication-test-diagnostics';
    const diagnostics = [{ blockId: 'source:native', code: 'horizontal-overflow' }];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method ? { id } : {
      id, status: 'error', completed: 0, total: 0, error: '正文中有超宽或超高的滚动内容。', diagnostics: [
        ...diagnostics, ...diagnostics, { blockId: 'unselected:native', code: 'vertical-overflow' }, { blockId: 'source:native', code: 'unknown' }, null,
      ],
    }));
    vi.stubGlobal('fetch', fetcher);
    await expect(generatePublication({ document: { blocks: [{ id: 'source:native' }] } } as PublicationRequest, new AbortController().signal, () => {})).rejects.toMatchObject({
      message: '正文中有超宽或超高的滚动内容。', diagnostics,
    });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
  it('releases the job immediately on page exit and sends only one cleanup request', async () => {
    const events = new EventTarget();
    vi.stubGlobal('window', Object.assign(events, { setTimeout, clearTimeout }));
    const id = 'publication-test-close-123456';
    let polled!: () => void;
    const polling = new Promise<void>(resolve => { polled = resolve; });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) polled();
      return Response.json({ id, status: 'running', completed: 0, total: 1 });
    });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const operation = generatePublication({} as PublicationRequest, controller.signal, () => {});
    const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await polling;
    try {
      events.dispatchEvent(new Event('pagehide'));
      const cleanup = fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE');
      expect(cleanup).toHaveLength(1);
      expect(cleanup[0][1]).toMatchObject({ keepalive: true });
    } finally {
      controller.abort();
      await rejected;
    }
    events.dispatchEvent(new Event('pagehide'));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
});
