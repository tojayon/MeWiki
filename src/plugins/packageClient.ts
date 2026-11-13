import { parsePluginManifest } from './sdk/manifest.ts';
import type { PluginManifest } from './sdk/types.ts';

export interface InstalledPlugin { manifest: PluginManifest; versions: string[] }
export const PLUGIN_PACKAGES_EVENT = 'mewiki:plugin-packages:changed';
export const PLUGIN_PACKAGES_STORAGE_KEY = 'mewiki:plugin-packages:revision';
async function request(method: string, suffix = '', body?: BodyInit): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/mewiki/plugins${suffix}`, { method, headers: {
    'X-MeWiki-Request': 'plugins', 'Content-Type': body instanceof Blob ? 'application/octet-stream' : 'application/json',
  }, body, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '插件管理失败。');
  return result;
}
export async function listPluginPackages(): Promise<InstalledPlugin[]> {
  const result = await request('GET');
  if (!Array.isArray(result.plugins)) throw new Error('插件列表格式无效。');
  return result.plugins.map(item => ({ manifest: parsePluginManifest(item.manifest), versions: Array.isArray(item.versions) ? item.versions.filter((version: unknown): version is string => typeof version === 'string') : [] }));
}
export async function inspectPluginPackage(file: Blob): Promise<{ manifest: PluginManifest; sha256: string }> {
  if (file.size > 1024 * 1024) throw new Error('插件包超过 1 MiB。');
  const result = await request('POST', '/inspect', file);
  if (typeof result.sha256 !== 'string') throw new Error('插件包摘要无效。');
  return { manifest: parsePluginManifest(result.manifest), sha256: result.sha256 };
}
export async function installPluginPackage(file: Blob) { await request('POST', '', file); }
export async function uninstallPluginPackage(id: string) { await request('DELETE', '', JSON.stringify({ id })); }
export async function activatePluginVersion(id: string, version: string) { await request('PUT', '', JSON.stringify({ id, version })); }
export function notifyPluginPackagesChanged() {
  window.dispatchEvent(new Event(PLUGIN_PACKAGES_EVENT));
  try { localStorage.setItem(PLUGIN_PACKAGES_STORAGE_KEY, crypto.randomUUID()); } catch { /* Same-window refresh still runs. */ }
}
