import { webbenchPlugin } from './webbench.ts';
import WebBenchReplayPicker from './WebBenchReplayPicker.tsx';
export const availablePlugins = [{ ...webbenchPlugin, ContentPicker: WebBenchReplayPicker }];
export type PluginStatus = 'available' | 'enabled' | 'disabled';
export type PluginState = Record<string, 'enabled' | 'disabled'>;
export const PLUGIN_STORAGE_KEY = 'mewiki:plugins:v1';
export function pluginStatus(state: PluginState, id: string): PluginStatus { return state[id] ?? 'available'; }
export function updatePluginState(state: PluginState, id: string, status: PluginStatus): PluginState {
  if (!availablePlugins.some(plugin => plugin.id === id)) throw new Error('未知插件。');
  const next = { ...state };
  if (status === 'available') delete next[id]; else next[id] = status;
  return next;
}
export function loadPluginState(storage?: Pick<Storage, 'getItem'>): PluginState {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PLUGIN_STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(availablePlugins.flatMap(plugin => {
      const state = (raw as PluginState)[plugin.id];
      return state === 'enabled' || state === 'disabled' ? [[plugin.id, state]] : [];
    })) as PluginState;
  } catch { return {}; }
}
