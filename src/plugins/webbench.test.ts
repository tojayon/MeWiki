import { describe, expect, it } from 'vitest';
import { webbenchPlugin, parseReplayReference, replayDeepLink } from './webbench.ts';
import { availablePlugins, pluginStatus, updatePluginState } from './registry.ts';
const data = { runId: 'experiment-1', replayId: 'replay-1', recordDigest: 'abc123', serviceBase: 'http://127.0.0.1:8766', webbenchOrigin: 'http://127.0.0.1:4173', time: 5.125, loopId: 'loop-1', packetId: 'packet-42' };
const content = { provider: 'org.mewiki.webbench', contentType: 'replay-position', schemaVersion: 1, title: '实验一', summary: 't = 5.125 s', data };
describe('WebBench plugin contract', () => {
  it('is available for installation but does not enable itself on an external message', () => {
    expect(availablePlugins[0].id).toBe(webbenchPlugin.id);
    expect(pluginStatus({}, webbenchPlugin.id)).toBe('available');
    const installed = updatePluginState({}, webbenchPlugin.id, 'enabled');
    expect(pluginStatus(installed, webbenchPlugin.id)).toBe('enabled');
    expect(pluginStatus(updatePluginState(installed, webbenchPlugin.id, 'disabled'), webbenchPlugin.id)).toBe('disabled');
  });
  it('validates identity, physical time and only local return URLs', () => {
    expect(parseReplayReference(content).data).toEqual(data);
    for (const patch of [{ time: -1 }, { time: Infinity }, { runId: '' }, { recordDigest: '' }, { webbenchOrigin: 'javascript:alert(1)' }, { serviceBase: 'https://example.com' }]) {
      expect(() => parseReplayReference({ ...content, data: { ...data, ...patch } })).toThrow();
    }
    expect(() => parseReplayReference({ ...content, schemaVersion: 2 })).toThrow(/版本/);
  });
  it('builds a portable link with the full experiment address and time', () => {
    const url = new URL(replayDeepLink(parseReplayReference(content)));
    const address = JSON.parse(url.searchParams.get('mewikiReplay')!);
    expect(address).toEqual(data);
    expect(url.origin).toBe(data.webbenchOrigin);
    expect(url.searchParams.has('page')).toBe(false);
  });
});
