export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface ExternalContent {
  provider: string;
  contentType: string;
  schemaVersion: number;
  title: string;
  summary?: string;
  data: { [key: string]: JsonValue };
}
export interface ExternalContentBlock extends ExternalContent { id: string; type: 'external'; note?: string }
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function validJson(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => validJson(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && validJson(item, depth + 1));
}
export function parseExternalContent(value: unknown): ExternalContent {
  if (!value || typeof value !== 'object') throw new Error('外部内容格式无效。');
  const input = value as Record<string, unknown>;
  if (typeof input.provider !== 'string' || !identifier.test(input.provider) || typeof input.contentType !== 'string' || !identifier.test(input.contentType) || !Number.isSafeInteger(input.schemaVersion) || Number(input.schemaVersion) < 1 || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 1000 || (input.summary !== undefined && (typeof input.summary !== 'string' || input.summary.length > 8000)) || !input.data || Array.isArray(input.data) || typeof input.data !== 'object' || !validJson(input.data)) throw new Error('外部内容字段或版本无效。');
  const content = { provider: input.provider, contentType: input.contentType, schemaVersion: Number(input.schemaVersion), title: input.title, ...(typeof input.summary === 'string' ? { summary: input.summary } : {}), data: input.data as ExternalContent['data'] };
  if (JSON.stringify(content).length > 256 * 1024) throw new Error('外部内容超过 256 KB，请传递引用或附件。');
  return JSON.parse(JSON.stringify(content)) as ExternalContent;
}
export function normalizeExternalBlock(value: Record<string, unknown>): ExternalContentBlock {
  if (typeof value.id !== 'string' || !value.id) throw new Error('缺少外部内容标识。');
  return { id: value.id, type: 'external', ...parseExternalContent(value), ...(typeof value.note === 'string' ? { note: value.note } : {}) };
}
export function externalContentText(block: ExternalContentBlock): string {
  return [block.title, block.summary, block.note].filter(Boolean).join('\n');
}
