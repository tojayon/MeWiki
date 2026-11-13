import { describe, expect, it, vi } from 'vitest';
import manifest from '../../plugins/webbench/manifest.json';
import { parsePluginManifest } from './sdk/manifest.ts';
import { createPluginContent, fetchPluginCatalog, parsePluginCatalog } from './sdk/runtime.ts';
const plugin = parsePluginManifest(manifest);
const catalog = plugin.contentTypes[0].picker!.catalog!;
const parseReplayCatalog = (value: unknown) => parsePluginCatalog(catalog, value);
const createReplayReference = (selected: Record<string, unknown>, connection: Record<string, string>, time: number, loopId = '') => createPluginContent(plugin, 'replay-position', { selected, connection, fields: { time, loopId } });
const fetchReplayCatalog = (serviceBase: string, signal: AbortSignal, fetcher?: typeof fetch) => fetchPluginCatalog(catalog, { serviceBase }, signal, fetcher);

const item = {
  id: 'indexed-record', file: 'examples/experiment.replay.sqlite',
  manifest: {
    format: 'cislunar-replay-sqlite/v2', sealed: true,
    run: { id: 'experiment-1', title: '真实实验' },
    recordDigest: 'a'.repeat(64),
    timeBase: { unit: 's', origin: 'scenario', start: 0.1, end: 0.8 },
    loopIds: ['loop-1', 'loop-2'],
  },
};
const connection = { serviceBase: 'http://127.0.0.1:8766', webbenchOrigin: 'http://127.0.0.1:4173' };

describe('standalone WebBench replay selection', () => {
  it('reads real replay identities and accepts an empty catalog', () => {
    expect(parseReplayCatalog({ items: [item] })).toEqual([item]);
    expect(parseReplayCatalog({ items: [] })).toEqual([]);
  });
  it('rejects incomplete, unsealed or invalid records instead of making references', () => {
    for (const invalid of [null, {}, { items: [{}] }, { items: [{ ...item, id: '' }] },
      { items: [{ ...item, manifest: { ...item.manifest, sealed: false } }] },
      { items: [{ ...item, manifest: { ...item.manifest, recordDigest: '' } }] },
      { items: [{ ...item, manifest: { ...item.manifest, timeBase: { ...item.manifest.timeBase, end: -1 } } }] },
    ]) expect(() => parseReplayCatalog(invalid)).toThrow();
  });
  it('keeps the exact identity, service, physical time and optional loop', () => {
    const [entry] = parseReplayCatalog({ items: [item] });
    const reference = createReplayReference(entry, connection, 0.125, 'loop-2');
    expect(reference).toMatchObject({ provider: 'org.mewiki.webbench', contentType: 'replay-position', title: '真实实验',
      data: { runId: 'experiment-1', replayId: item.id, recordDigest: item.manifest.recordDigest, ...connection, time: 0.125, loopId: 'loop-2' } });
    expect(createReplayReference(entry, connection, 0.1).data.loopId).toBeUndefined();
    expect(createReplayReference(entry, connection, 0.8).data.time).toBe(0.8);
    for (const time of [0, 0.81, NaN, Infinity]) expect(() => createReplayReference(entry, connection, time)).toThrow(/时间/);
    expect(() => createReplayReference(entry, connection, 0.125, 'unknown')).toThrow(/选项/);
    expect(() => createReplayReference(entry, { ...connection, serviceBase: 'https://example.com' }, 0.125)).toThrow();
  });
  it('queries only the selected local service with cancellation and reports failed responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [item] })));
    const controller = new AbortController();
    expect(await fetchReplayCatalog(connection.serviceBase, controller.signal, fetcher)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(new URL(`${connection.serviceBase}/api/replays`), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await expect(fetchReplayCatalog('https://example.com', controller.signal, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response('', { status: 503 }));
    await expect(fetchReplayCatalog(connection.serviceBase, controller.signal, fetcher)).rejects.toThrow(/503/);
  });
});
