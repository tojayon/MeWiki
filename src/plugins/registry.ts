import { bundledPlugins } from './bundled.ts';
import { parsePluginManifest, pluginIdentifier } from './sdk/manifest.ts';
import type { PluginManifest } from './sdk/types.ts';
export function createPluginRegistry(values: readonly unknown[]): readonly PluginManifest[] {
  const ids = new Set<string>();
  return values.map(value => {
    const plugin = parsePluginManifest(value);
    if (ids.has(plugin.id)) throw new Error('插件标识重复。');
    ids.add(plugin.id); return plugin;
  });
}
export const availablePlugins = createPluginRegistry(bundledPlugins);
export type PluginStatus = 'available' | 'enabled' | 'disabled';
export type PluginState = Record<string, 'enabled' | 'disabled'>;
export const PLUGIN_STORAGE_KEY = 'mewiki:plugins:v1';
export function pluginStatus(state: PluginState, id: string): PluginStatus { return Object.hasOwn(state, id) ? state[id] : 'available'; }
export function updatePluginState(state: PluginState, id: string, status: PluginStatus, catalog: readonly PluginManifest[] = availablePlugins): PluginState {
  if (!catalog.some(plugin => plugin.id === id)) throw new Error('未知插件。');
  const next = { ...state };
  if (status === 'available') delete next[id]; else next[id] = status;
  return next;
}
export function loadPluginState(storage?: Pick<Storage, 'getItem'>): PluginState {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PLUGIN_STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([id, status]) => pluginIdentifier.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id) && (status === 'enabled' || status === 'disabled'))) as PluginState;
  } catch { return {}; }
}
