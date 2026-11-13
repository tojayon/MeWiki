/** Public, data-only MeWiki plugin API. No application component or storage access. */
import type { PluginExporter } from './exportTypes.ts';
export type { PluginExporter, PluginExportTemplate, PluginExportPreset } from './exportTypes.ts';
export type PluginCapability = 'context.read' | 'content.open';
export type PluginValue = { path: string; optional?: boolean; json?: boolean; prefix?: string; suffix?: string } | { literal: string | number | boolean | null };
export interface PluginSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  required?: string[];
  properties?: Record<string, PluginSchema>;
  items?: PluginSchema;
  const?: string | number | boolean | null;
  enum?: (string | number | boolean | null)[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  format?: 'local-origin' | 'http-origin';
}
export interface PluginViewField { label: string; path: string; unit?: string; digits?: number }
export interface PluginSource { origin: PluginValue; pathname: string; query: Record<string, PluginValue> }
export interface PluginField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required?: boolean;
  default?: string | number;
  min?: number | PluginValue;
  max?: number | PluginValue;
  options?: PluginValue;
  optionsLabelPath?: string;
  initial?: PluginValue;
  emptyLabel?: string;
}
export interface PluginCatalog {
  connection: string;
  pathname: string;
  label: string;
  refreshLabel: string;
  loadingText: string;
  emptyText: string;
  itemsPath: string;
  idPath: string;
  labelPath: string;
  itemSchema: PluginSchema;
}
export interface PluginPicker {
  title: string;
  fields: PluginField[];
  connection?: { key: string; label: string; default: string }[];
  connectionStorageKey?: string;
  catalog?: PluginCatalog;
  content: { title: PluginValue; summary?: PluginValue; data: Record<string, PluginValue> };
}
export interface PluginContentType {
  id: string;
  schemaVersion: number;
  insertionLabel: string;
  schema: PluginSchema;
  view: PluginViewField[];
  source?: PluginSource;
  picker?: PluginPicker;
}
interface PluginManifestBase {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapability[];
  workspace?: { name: string };
  contentTypes: PluginContentType[];
}
export type PluginManifest = PluginManifestBase & (
  | { manifestVersion: 1; apiVersion: 1; exporters?: never }
  | { manifestVersion: 2; apiVersion: 2; exporters?: PluginExporter[] }
);
