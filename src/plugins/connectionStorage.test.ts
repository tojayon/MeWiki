import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from './sdk/manifest.ts';

describe('plugin storage ownership', () => {
  it('rejects a connection key belonging to another plugin', () => {
    const manifest = { manifestVersion: 1, apiVersion: 1, id: 'org.example.instrument', name: '示例', version: '1.0.0', description: '示例', capabilities: ['context.read'], contentTypes: [{ id: 'record', schemaVersion: 1, insertionLabel: '插入', schema: { type: 'object' }, view: [], picker: { title: '插入', fields: [], content: { title: { literal: '示例' }, data: {} }, connectionStorageKey: 'mewiki:plugins:org.other.secret:connection:v1' } }] };
    expect(() => parsePluginManifest(manifest)).toThrow();
  });
});
