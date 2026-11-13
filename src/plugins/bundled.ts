import { parsePluginManifest } from './sdk/manifest.ts';
const sources = import.meta.glob('../../plugins/*/manifest.json', { eager: true, import: 'default' });
/** Official packages use the same manifest parser and runtime as user-installed packages. */
export const bundledPlugins = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => parsePluginManifest(value));
