import type { PluginManifest, PluginSchema } from './types.ts';
import { parsePluginExporters } from './exportTypes.ts';

export const PLUGIN_API_VERSION = 2;
export const PLUGIN_SUPPORTED_API_VERSIONS = [1, 2] as const;
export const PLUGIN_MANIFEST_LIMIT = 256 * 1024;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
export const pluginIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function fail(): never { throw new Error('插件清单不符合受支持的 MeWiki 插件 API。'); }
export function pluginPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && value.split('.').length <= 16 && value.split('.').every(part => /^[A-Za-z0-9_-]+$/.test(part) && !reserved.has(part));
}
function text(value: unknown, max = 1000): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max; }
function identifier(value: unknown): value is string { return typeof value === 'string' && pluginIdentifier.test(value) && !reserved.has(value); }
function obj(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => !allowed.includes(key) || reserved.has(key)) || required.some(key => !Object.hasOwn(object, key))) fail();
  return object;
}
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) fail(); return value; }
function scalar(value: unknown): boolean { return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value); }
function valueRule(value: unknown) {
  const rule = obj(value, ['path', 'literal', 'optional', 'json', 'prefix', 'suffix']);
  if (Object.hasOwn(rule, 'literal')) { if (Object.keys(rule).length !== 1 || !scalar(rule.literal)) fail(); return; }
  if (!pluginPath(rule.path) || !['content', 'data', 'fields', 'connection', 'selected'].includes(String(rule.path).split('.')[0])) fail();
  for (const key of ['optional', 'json']) if (rule[key] !== undefined && typeof rule[key] !== 'boolean') fail();
  for (const key of ['prefix', 'suffix']) if (rule[key] !== undefined && (typeof rule[key] !== 'string' || String(rule[key]).length > 1000)) fail();
}
function schemaRule(value: unknown, depth = 0) {
  if (depth > 8) fail();
  const schema = obj(value, ['type', 'required', 'properties', 'items', 'const', 'enum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'format'], ['type']);
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(String(schema.type))) fail();
  if (schema.required !== undefined && (!list(schema.required, 64).every(identifier) || new Set(schema.required as string[]).size !== (schema.required as string[]).length)) fail();
  if (schema.properties !== undefined) {
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties) || Object.getPrototypeOf(properties) !== Object.prototype || Object.keys(properties).length > 64) fail();
    for (const [key, child] of Object.entries(properties)) { if (!identifier(key)) fail(); schemaRule(child, depth + 1); }
  }
  if (schema.items !== undefined) schemaRule(schema.items, depth + 1);
  if (Object.hasOwn(schema, 'const') && !scalar(schema.const)) fail();
  if (schema.enum !== undefined && !list(schema.enum, 128).every(scalar)) fail();
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || Number(schema[key]) < 0 || Number(schema[key]) > 262144)) fail();
  for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) fail();
  if (schema.format !== undefined && !['local-origin', 'http-origin'].includes(String(schema.format))) fail();
}
function pathname(value: unknown) { if (!text(value, 1000) || !String(value).startsWith('/') || String(value).startsWith('//') || /[\\?#]/.test(String(value)) || [...String(value)].some(character => character.charCodeAt(0) <= 32) || String(value).split('/').includes('..')) fail(); }

export function parsePluginManifest(value: unknown): PluginManifest {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { return fail(); }
  if (!encoded || encoded.length > PLUGIN_MANIFEST_LIMIT) fail();
  const plugin = obj(value, ['manifestVersion', 'apiVersion', 'id', 'name', 'version', 'description', 'capabilities', 'workspace', 'contentTypes', 'exporters'], ['manifestVersion', 'apiVersion', 'id', 'name', 'version', 'description', 'capabilities', 'contentTypes']);
  if ((plugin.apiVersion !== 1 && plugin.apiVersion !== 2) || plugin.manifestVersion !== plugin.apiVersion || !identifier(plugin.id) || !text(plugin.name, 100) || !text(plugin.description, 4000) || !text(plugin.version, 100) || !semver.test(plugin.version)) fail();
  if (Object.hasOwn(plugin, 'exporters')) {
    if (plugin.apiVersion !== 2) fail();
    parsePluginExporters(plugin.exporters);
  }
  const capabilities = list(plugin.capabilities, 2);
  if (!capabilities.every(cap => ['context.read', 'content.open'].includes(String(cap))) || new Set(capabilities).size !== capabilities.length) fail();
  if (plugin.workspace !== undefined) { const workspace = obj(plugin.workspace, ['name'], ['name']); if (!text(workspace.name, 100)) fail(); }
  const types = list(plugin.contentTypes, 16);
  if (!types.length && !Object.hasOwn(plugin, 'exporters')) fail();
  const ids = new Set<string>();
  for (const type of types) {
    const item = obj(type, ['id', 'schemaVersion', 'insertionLabel', 'schema', 'view', 'source', 'picker'], ['id', 'schemaVersion', 'insertionLabel', 'schema', 'view']);
    if (!identifier(item.id) || ids.has(item.id) || !Number.isSafeInteger(item.schemaVersion) || Number(item.schemaVersion) < 1 || !text(item.insertionLabel, 100)) fail();
    ids.add(item.id); schemaRule(item.schema);
    if ((item.schema as PluginSchema).type !== 'object') fail();
    for (const raw of list(item.view, 32)) {
      const field = obj(raw, ['label', 'path', 'unit', 'digits'], ['label', 'path']);
      if (!text(field.label, 100) || !pluginPath(field.path) || !String(field.path).startsWith('data.')) fail();
      if (field.unit !== undefined && (typeof field.unit !== 'string' || field.unit.length > 100)) fail();
      if (field.digits !== undefined && (!Number.isSafeInteger(field.digits) || Number(field.digits) < 0 || Number(field.digits) > 12)) fail();
    }
    if (item.source !== undefined) {
      if (!capabilities.includes('content.open')) fail();
      const source = obj(item.source, ['origin', 'pathname', 'query'], ['origin', 'pathname', 'query']); valueRule(source.origin); pathname(source.pathname);
      const query = obj(source.query, Object.keys(source.query as object));
      if (Object.keys(query).length > 32) fail();
      for (const [key, rule] of Object.entries(query)) { if (!identifier(key)) fail(); valueRule(rule); }
    }
    if (item.picker !== undefined) {
      const picker = obj(item.picker, ['title', 'fields', 'connection', 'connectionStorageKey', 'catalog', 'content'], ['title', 'fields', 'content']);
      if (!text(picker.title, 100)) fail();
      const fieldKeys = new Set<string>();
      for (const raw of list(picker.fields, 32)) {
        const field = obj(raw, ['key', 'label', 'type', 'required', 'default', 'min', 'max', 'options', 'optionsLabelPath', 'initial', 'emptyLabel'], ['key', 'label', 'type']);
        if (!identifier(field.key) || fieldKeys.has(field.key) || !text(field.label, 100) || !['text', 'number', 'select'].includes(String(field.type))) fail(); fieldKeys.add(field.key);
        if (field.required !== undefined && typeof field.required !== 'boolean') fail();
        if (field.default !== undefined && typeof field.default !== 'string' && !(typeof field.default === 'number' && Number.isFinite(field.default))) fail();
        for (const key of ['min', 'max']) if (field[key] !== undefined) { if (typeof field[key] === 'number') { if (!Number.isFinite(field[key])) fail(); } else valueRule(field[key]); }
        for (const key of ['options', 'initial']) if (field[key] !== undefined) valueRule(field[key]);
        if (field.optionsLabelPath !== undefined && !pluginPath(field.optionsLabelPath)) fail();
        if (field.emptyLabel !== undefined && !text(field.emptyLabel, 100)) fail();
      }
      const connectionKeys = new Set<string>();
      for (const raw of picker.connection === undefined ? [] : list(picker.connection, 8)) {
        const connection = obj(raw, ['key', 'label', 'default'], ['key', 'label', 'default']);
        if (!identifier(connection.key) || connectionKeys.has(connection.key) || !text(connection.label, 100) || !text(connection.default, 2000)) fail(); connectionKeys.add(connection.key);
        validatePluginOrigin(connection.default, true);
      }
      if (picker.connectionStorageKey !== undefined && ![`mewiki:plugins:${plugin.id}:connection:v1`, `mewiki:plugins:${String(plugin.id).split('.').at(-1)}:connection:v1`].includes(String(picker.connectionStorageKey))) fail();
      if (picker.catalog !== undefined) {
        const catalog = obj(picker.catalog, ['connection', 'pathname', 'label', 'refreshLabel', 'loadingText', 'emptyText', 'itemsPath', 'idPath', 'labelPath', 'itemSchema'], ['connection', 'pathname', 'label', 'refreshLabel', 'loadingText', 'emptyText', 'itemsPath', 'idPath', 'labelPath', 'itemSchema']);
        if (!connectionKeys.has(String(catalog.connection))) fail(); pathname(catalog.pathname);
        for (const key of ['label', 'refreshLabel', 'loadingText', 'emptyText']) if (!text(catalog[key], 1000)) fail();
        for (const key of ['itemsPath', 'idPath', 'labelPath']) if (!pluginPath(catalog[key])) fail();
        schemaRule(catalog.itemSchema);
      }
      const content = obj(picker.content, ['title', 'summary', 'data'], ['title', 'data']); valueRule(content.title);
      if (content.summary !== undefined) valueRule(content.summary);
      if (!content.data || typeof content.data !== 'object' || Array.isArray(content.data) || Object.keys(content.data).length > 64) fail();
      for (const [key, rule] of Object.entries(content.data)) { if (!identifier(key)) fail(); valueRule(rule); }
    }
  }
  return JSON.parse(encoded) as PluginManifest;
}

export function validatePluginOrigin(value: unknown, localOnly = false): string {
  if (typeof value !== 'string') throw new Error('缺少有效的程序地址。');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || localOnly && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('程序地址必须是允许的 HTTP 或 HTTPS 来源。');
  return url.origin;
}
