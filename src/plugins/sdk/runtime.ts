import { parseExternalContent, type ExternalContent, type JsonValue } from '../../integrations/externalContent.ts';
import { pluginPath, validatePluginOrigin } from './manifest.ts';
import type { PluginCatalog, PluginContentType, PluginManifest, PluginSchema, PluginValue } from './types.ts';

function atPath(value: unknown, path: string): unknown {
  if (!pluginPath(path)) throw new Error('插件字段路径无效。');
  let current = value;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export function readPluginValue(rule: PluginValue, scope: Record<string, unknown>): unknown {
  if ('literal' in rule) return rule.literal;
  let value = atPath(scope, rule.path);
  if (value === undefined || value === null || rule.optional && value === '') { if (rule.optional) return undefined; throw new Error('插件需要的内容字段缺失。'); }
  if (rule.json) value = JSON.stringify(value);
  if (rule.prefix !== undefined || rule.suffix !== undefined) value = `${rule.prefix ?? ''}${String(value)}${rule.suffix ?? ''}`;
  return value;
}
export function assertPluginSchema(schema: PluginSchema, value: unknown, depth = 0): void {
  const fail = () => { throw new Error('内容不符合插件声明的数据结构。'); };
  if (depth > 20) fail();
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value as never)) fail();
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(object, key)) fail();
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(object, key)) assertPluginSchema(child, object[key], depth + 1);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10000)) fail();
    if (schema.items) for (const item of value as unknown[]) assertPluginSchema(schema.items, item, depth + 1);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 262144)) fail();
    if (schema.format) validatePluginOrigin(value, schema.format === 'local-origin');
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isSafeInteger(value) || Number(value) < (schema.minimum ?? -Infinity) || Number(value) > (schema.maximum ?? Infinity)) fail();
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail();
}
export function pluginContentType(plugin: PluginManifest, contentType?: string): PluginContentType {
  const type = plugin.contentTypes.find(item => !contentType || item.id === contentType);
  if (!type) throw new Error('插件不支持此内容类型。');
  return type;
}
export function parsePluginContent(plugin: PluginManifest, value: unknown): ExternalContent {
  const content = parseExternalContent(value);
  const type = pluginContentType(plugin, content.contentType);
  if (content.provider !== plugin.id || content.schemaVersion !== type.schemaVersion) throw new Error('此插件尚不支持该内容版本。');
  assertPluginSchema(type.schema, content.data);
  return content;
}
export function buildPluginSourceUrl(plugin: PluginManifest, value: unknown): string {
  const content = parsePluginContent(plugin, value), type = pluginContentType(plugin, content.contentType);
  if (!plugin.capabilities.includes('content.open') || !type.source) throw new Error('插件未提供来源打开接口。');
  const scope = { content, data: content.data };
  const url = new URL(type.source.pathname, validatePluginOrigin(readPluginValue(type.source.origin, scope)));
  for (const [key, rule] of Object.entries(type.source.query)) { const item = readPluginValue(rule, scope); if (item !== undefined) url.searchParams.set(key, String(item)); }
  return url.href;
}
export function pluginViewFields(plugin: PluginManifest, value: unknown): { label: string; value: string }[] {
  const content = parsePluginContent(plugin, value), type = pluginContentType(plugin, content.contentType);
  return type.view.flatMap(field => {
    const item = atPath({ data: content.data }, field.path);
    if (item === undefined || item === null) return [];
    const formatted = typeof item === 'number' && field.digits !== undefined ? item.toFixed(field.digits) : typeof item === 'object' ? JSON.stringify(item) : String(item);
    return [{ label: field.label, value: formatted + (field.unit ? ` ${field.unit}` : '') }];
  });
}
export function createPluginContent(plugin: PluginManifest, contentType: string, scope: Record<string, unknown>): ExternalContent {
  const type = pluginContentType(plugin, contentType), picker = type.picker;
  if (!picker) throw new Error('插件未提供内容选择接口。');
  const fields = (scope.fields ?? {}) as Record<string, unknown>;
  for (const field of picker.fields) {
    const value = fields[field.key];
    if (field.required && (value === undefined || value === '' || value === null)) throw new Error('请填写必需的插件字段。');
    if (field.type === 'number' && value !== '' && value !== undefined) {
      const min = typeof field.min === 'object' ? readPluginValue(field.min, scope) : field.min;
      const max = typeof field.max === 'object' ? readPluginValue(field.max, scope) : field.max;
      if (typeof value !== 'number' || !Number.isFinite(value) || typeof min === 'number' && value < min || typeof max === 'number' && value > max) throw new Error(`${field.label}：数值超出允许范围。`);
    }
    if (field.type === 'select' && field.options && value !== '' && value !== undefined && value !== null) {
      const choices = readPluginValue(field.options, scope);
      if (!Array.isArray(choices) || !choices.some(choice => (typeof choice === 'object' && choice ? (choice as Record<string, unknown>).id : choice) === value)) throw new Error('所选选项不属于当前记录。');
    }
  }
  const data: Record<string, JsonValue> = {};
  for (const [key, rule] of Object.entries(picker.content.data)) { const item = readPluginValue(rule, scope); if (item !== undefined) data[key] = item as JsonValue; }
  const summary = picker.content.summary ? readPluginValue(picker.content.summary, scope) : undefined;
  return parsePluginContent(plugin, { provider: plugin.id, contentType: type.id, schemaVersion: type.schemaVersion,
    title: readPluginValue(picker.content.title, scope), ...(summary === undefined ? {} : { summary }), data });
}
export function parsePluginCatalog(catalog: PluginCatalog, value: unknown): Record<string, unknown>[] {
  const items = atPath(value, catalog.itemsPath);
  if (!Array.isArray(items) || items.length > 10000) throw new Error('插件目录服务返回的内容无效。');
  const ids = new Set<string>();
  return items.map(item => {
    assertPluginSchema(catalog.itemSchema, item);
    const id = atPath(item, catalog.idPath);
    if (typeof id !== 'string' || !id || id.length > 512 || ids.has(id)) throw new Error('插件目录包含无效或重复的记录身份。');
    ids.add(id); return item as Record<string, unknown>;
  });
}
export function pluginCatalogValue(item: unknown, path: string) { return atPath(item, path); }
export async function fetchPluginCatalog(catalog: PluginCatalog, connection: Record<string, string>, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const url = new URL(catalog.pathname, validatePluginOrigin(connection[catalog.connection], true));
  const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error(`读取插件目录失败（${response.status}）。`);
  const source = await response.text();
  if (source.length > 2 * 1024 * 1024) throw new Error('插件目录响应过大。');
  return parsePluginCatalog(catalog, JSON.parse(source));
}
