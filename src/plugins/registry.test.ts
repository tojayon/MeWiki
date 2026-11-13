import { describe, expect, it } from 'vitest';
import { loadPluginState, updatePluginState, createPluginRegistry } from './registry.ts';

describe('uniform plugin registry', () => {
  it('retains unknown valid enablement preferences while changing a known plugin', () => {
    const storage = { getItem: () => JSON.stringify({ 'org.community.future': 'disabled', 'org.mewiki.webbench': 'enabled', invalid: 'run' }) };
    const state = loadPluginState(storage);
    expect(state['org.community.future']).toBe('disabled');
    expect(updatePluginState(state, 'org.mewiki.webbench', 'disabled')['org.community.future']).toBe('disabled');
  });
  it('registers content types for arbitrary providers and refuses duplicate identities', () => {
    const plugin = { manifestVersion: 1, apiVersion: 1, id: 'org.community.simple', name: 'Simple', version: '1.0.0', description: 'Simple', capabilities: ['context.read'],
      contentTypes: [{ id: 'example', schemaVersion: 1, insertionLabel: 'Insert', schema: { type: 'object' }, view: [] }] };
    const registry = createPluginRegistry([plugin]);
    expect(registry[0].id).toBe(plugin.id);
    expect(() => createPluginRegistry([plugin, plugin])).toThrow();
    expect(updatePluginState({}, plugin.id, 'enabled', registry)[plugin.id]).toBe('enabled');
    expect(() => updatePluginState({}, 'org.missing', 'enabled', registry)).toThrow();
  });
});
