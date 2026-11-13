/** Data-only export contributions. The host owns content access, layout and downloads. */
export interface PluginCustomExportTemplate {
  id: string;
  name: string;
  background: string;
  textColor: string;
  headingColor: string;
  accentColor: string;
  fontFamily: 'sans' | 'serif';
  fontSize: number;
  lineHeight: number;
}

export type PluginExportTemplate = PluginCustomExportTemplate | { id: string; name: string; style: 'document' };

export interface PluginExportPreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface PluginExporter {
  id: string;
  label: string;
  description: string;
  templates: PluginExportTemplate[];
  presets: PluginExportPreset[];
}

const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const colorPattern = /^#[a-fA-F0-9]{6}$/;
function fail(): never { throw new Error('插件导出模板不符合 MeWiki 插件 API v2。'); }
function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= maximum;
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  if (Object.keys(value).some(key => !fields.includes(key) || reserved.has(key)) || fields.some(key => !Object.hasOwn(value, key))) fail();
  return value as Record<string, unknown>;
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value) && !reserved.has(value);
}
function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function entries(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) fail();
  return value;
}
function identities<T extends { id: string }>(values: unknown[], parse: (value: unknown) => T): T[] {
  const seen = new Set<string>();
  return values.map(value => {
    const result = parse(value);
    if (seen.has(result.id)) fail();
    seen.add(result.id);
    return result;
  });
}

export function parsePluginExportTemplate(value: unknown): PluginExportTemplate {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'style')) {
    const template = object(value, ['id', 'name', 'style']);
    if (!identity(template.id) || !text(template.name, 100) || template.style !== 'document') fail();
    return { id: template.id, name: template.name, style: 'document' };
  }
  const template = object(value, ['id', 'name', 'background', 'textColor', 'headingColor', 'accentColor', 'fontFamily', 'fontSize', 'lineHeight']);
  if (!identity(template.id) || !text(template.name, 100)) fail();
  for (const field of ['background', 'textColor', 'headingColor', 'accentColor']) {
    if (typeof template[field] !== 'string' || !colorPattern.test(template[field])) fail();
  }
  if (typeof template.fontFamily !== 'string' || !['sans', 'serif'].includes(template.fontFamily) || !finite(template.fontSize, 16, 80) || !Number.isInteger(template.fontSize) || !finite(template.lineHeight, 1.2, 2.4)) fail();
  return { ...template } as unknown as PluginExportTemplate;
}

export function parsePluginExporters(value: unknown): PluginExporter[] {
  return identities(entries(value), raw => {
    const exporter = object(raw, ['id', 'label', 'description', 'templates', 'presets']);
    if (!identity(exporter.id) || !text(exporter.label, 100) || !text(exporter.description, 4000)) fail();
    const templates = identities(entries(exporter.templates), parsePluginExportTemplate);
    const presets = identities(entries(exporter.presets), rawPreset => {
      const preset = object(rawPreset, ['id', 'name', 'width', 'height']);
      if (!identity(preset.id) || !text(preset.name, 100) || !finite(preset.width, 480, 2160) || !finite(preset.height, 480, 12000) || !Number.isInteger(preset.width) || !Number.isInteger(preset.height)) fail();
      return { ...preset } as unknown as PluginExportPreset;
    });
    return { id: exporter.id, label: exporter.label, description: exporter.description, templates, presets } as PluginExporter;
  });
}
