import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from './manifest.ts';
import { buildPluginSourceUrl, createPluginContent, parsePluginContent, pluginViewFields, readPluginValue, parsePluginCatalog } from './runtime.ts';

export function measurementManifest() {
  return { manifestVersion: 1, apiVersion: 1, id: 'org.example.instrument', name: '测量记录', version: '1.0.0', description: '通用测量插件',
    capabilities: ['context.read', 'content.open'], workspace: { name: '测量程序' },
    contentTypes: [{ id: 'measurement', schemaVersion: 1, insertionLabel: '插入测量',
      schema: { type: 'object', required: ['recordId', 'value', 'origin'], properties: {
        recordId: { type: 'string', minLength: 1, maxLength: 80 }, value: { type: 'number', minimum: 0 }, origin: { type: 'string', format: 'local-origin' },
      } },
      view: [{ label: '读数', path: 'data.value', unit: 'mm', digits: 2 }],
      source: { origin: { path: 'data.origin' }, pathname: '/record', query: { id: { path: 'data.recordId' } } },
      picker: { title: '插入测量', fields: [{ key: 'recordId', label: '记录', type: 'text', required: true }, { key: 'value', label: '读数', type: 'number', required: true }],
        connection: [{ key: 'origin', label: '来源地址', default: 'http://127.0.0.1:7777' }],
        content: { title: { path: 'fields.recordId' }, summary: { literal: '通用测量' }, data: {
          recordId: { path: 'fields.recordId' }, value: { path: 'fields.value' }, origin: { path: 'connection.origin' },
        } } },
    }],
  };
}
const content = { provider: 'org.example.instrument', contentType: 'measurement', schemaVersion: 1, title: '测试记录',
  data: { recordId: 'record/1', value: 12.5, origin: 'http://127.0.0.1:7777', extra: { retained: true } } };

describe('MeWiki declarative plugin API v1', () => {
  it('accepts an independent plugin without registering its identity in core code', () => {
    const manifest = parsePluginManifest(measurementManifest());
    expect(manifest.id).toBe('org.example.instrument');
    expect(manifest.workspace?.name).toBe('测量程序');
    expect(parsePluginContent(manifest, content)).toEqual(content);
  });
  it('rejects executable entries, unknown capabilities, foreign API versions and remote schemas', () => {
    for (const patch of [{ apiVersion: 2 }, { entry: 'evil.js' }, { capabilities: ['library.read'] }, { id: '__proto__' }, { version: 'latest' }]) {
      expect(() => parsePluginManifest({ ...measurementManifest(), ...patch })).toThrow();
    }
    const remote = measurementManifest();
    Object.assign(remote.contentTypes[0].schema, { $ref: 'https://example.com/schema' });
    expect(() => parsePluginManifest(remote)).toThrow();
  });
  it('rejects unsafe paths and excessive schema depth or view precision', () => {
    const bad = measurementManifest(); bad.contentTypes[0].view[0].path = 'data.__proto__.x';
    expect(() => parsePluginManifest(bad)).toThrow();
    const precision = measurementManifest(); precision.contentTypes[0].view[0].digits = 999;
    expect(() => parsePluginManifest(precision)).toThrow();
    let schema: object = { type: 'string' };
    for (let i = 0; i < 24; i++) schema = { type: 'object', properties: { nested: schema } };
    const deep = measurementManifest(); Object.assign(deep.contentTypes[0], { schema });
    expect(() => parsePluginManifest(deep)).toThrow();
  });
  it('validates content identity and schema without deleting unknown data fields', () => {
    const manifest = parsePluginManifest(measurementManifest());
    for (const patch of [{ provider: 'org.other' }, { schemaVersion: 2 }, { data: { ...content.data, value: -1 } }, { data: { ...content.data, origin: 'javascript:alert(1)' } }]) {
      expect(() => parsePluginContent(manifest, { ...content, ...patch })).toThrow();
    }
    expect(parsePluginContent(manifest, content).data.extra).toEqual({ retained: true });
  });
  it('checks each content type against its own version and schema', () => {
    const first = measurementManifest();
    const next = structuredClone(first.contentTypes[0]);
    next.id = 'calibration'; next.schemaVersion = 2;
    Object.assign(next.schema.properties.value, { minimum: 10 });
    first.contentTypes.push(next);
    const manifest = parsePluginManifest(first);
    expect(parsePluginContent(manifest, { ...content, contentType: 'calibration', schemaVersion: 2 })).toMatchObject({ contentType: 'calibration', schemaVersion: 2 });
    for (const patch of [{ contentType: 'calibration' }, { contentType: 'unknown' }, { contentType: 'calibration', schemaVersion: 2, data: { ...content.data, value: 3 } }]) {
      expect(() => parsePluginContent(manifest, { ...content, ...patch })).toThrow();
    }
  });
  it('builds source URLs and views using bounded field references', () => {
    const manifest = parsePluginManifest(measurementManifest());
    const url = new URL(buildPluginSourceUrl(manifest, content));
    expect(url.origin).toBe('http://127.0.0.1:7777'); expect(url.pathname).toBe('/record');
    expect(url.searchParams.get('id')).toBe('record/1');
    expect(pluginViewFields(manifest, content)).toEqual([{ label: '读数', value: '12.50 mm' }]);
    expect(readPluginValue({ path: 'data.extra.retained' }, { data: content.data })).toBe(true);
  });
  it('creates content only from declared fields, connection and catalog selection', () => {
    const manifest = parsePluginManifest(measurementManifest());
    expect(createPluginContent(manifest, 'measurement', { fields: { recordId: 'record-2', value: 3 }, connection: { origin: 'http://127.0.0.1:7777' } })).toMatchObject({
      provider: manifest.id, contentType: 'measurement', title: 'record-2', data: { recordId: 'record-2', value: 3, origin: 'http://127.0.0.1:7777' },
    });
    expect(() => createPluginContent(manifest, 'measurement', { fields: { recordId: '', value: 3 }, connection: { origin: 'http://127.0.0.1:7777' } })).toThrow();
  });
  it('rejects duplicate catalog identities rather than selecting the wrong record', () => {
    const descriptor = { connection: 'origin', pathname: '/records', label: '记录', refreshLabel: '刷新', loadingText: '读取中', emptyText: '为空', itemsPath: 'items', idPath: 'id', labelPath: 'title',
      itemSchema: { type: 'object' as const, required: ['id'], properties: { id: { type: 'string' as const, minLength: 1 } } } };
    expect(() => parsePluginCatalog(descriptor, { items: [{ id: 'same' }, { id: 'same' }] })).toThrow();
    expect(parsePluginCatalog(descriptor, { items: [{ id: 'one', title: '一' }] })).toEqual([{ id: 'one', title: '一' }]);
  });
  it('validates zero-valued selections against the current record options', () => {
    const source = measurementManifest();
    Object.assign(source.contentTypes[0].picker.fields[1], { type: 'select', options: { path: 'selected.values' } });
    const manifest = parsePluginManifest(source);
    const scope = { fields: { recordId: 'zero', value: 0 }, connection: { origin: 'http://127.0.0.1:7777' }, selected: { values: [1, 2] } };
    expect(() => createPluginContent(manifest, 'measurement', scope)).toThrow('所选选项不属于当前记录');
    scope.selected.values.push(0);
    expect(createPluginContent(manifest, 'measurement', scope).data.value).toBe(0);
  });
});
