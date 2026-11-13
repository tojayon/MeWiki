import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from './manifest.ts';
import { availablePlugins, pluginStatus } from '../registry.ts';

function contentManifest() {
  return { manifestVersion: 1, apiVersion: 1, id: 'org.example.content', name: '内容', version: '1.0.0', description: '独立内容插件', capabilities: [],
    contentTypes: [{ id: 'text', schemaVersion: 1, insertionLabel: '插入内容', schema: { type: 'object' }, view: [] }] };
}

export function exportManifest() {
  return {
    manifestVersion: 2, apiVersion: 2, id: 'org.example.publish', name: '发布模板', version: '1.0.0', description: '独立图文模板',
    capabilities: [], contentTypes: [],
    exporters: [{
      id: 'images', label: '导出知识卡片', description: '将用户选择排成图片。',
      templates: [{ id: 'paper', name: '简洁', background: '#FFFFFF', textColor: '#172033', headingColor: '#111827', accentColor: '#2255AA', fontFamily: 'sans', fontSize: 32, lineHeight: 1.6 }],
      presets: [{ id: 'portrait', name: '纵向卡片', width: 1080, height: 1440 }],
    }],
  };
}

describe('declarative export plugin API v2', () => {
  it('discovers the bundled exporter without enabling it or replacing existing plugins', () => {
    const plugin = availablePlugins.find(item => item.id === 'org.mewiki.social-export');
    expect(plugin?.exporters?.[0].templates).toHaveLength(4);
    expect(plugin?.exporters?.[0].templates[0]).toEqual({ id: 'mewiki', name: 'MeWiki 原生', style: 'document' });
    expect(plugin?.exporters?.[0].presets).toHaveLength(4);
    expect(plugin?.capabilities).toEqual([]);
    expect(pluginStatus({}, plugin!.id)).toBe('available');
    expect(availablePlugins.some(item => item.id === 'org.mewiki.webbench' && item.apiVersion === 1)).toBe(true);
  });

  it('accepts a standalone exporter without granting external context or fabricating content types', () => {
    const source = exportManifest();
    expect(parsePluginManifest(source)).toEqual(source);
  });

  it('accepts the shared document style in an independent exporter and rejects arbitrary styles', () => {
    const source = exportManifest();
    const native = { id: 'native', name: '文档原样', style: 'document' };
    const withTemplate = (template: unknown) => ({ ...source, exporters: [{ ...source.exporters[0], templates: [template] }] });
    expect(parsePluginManifest(withTemplate(native)).exporters?.[0].templates).toEqual([native]);
    for (const template of [{ ...native, style: 'custom-css' }, { ...native, style: ['document'] }, { ...native, css: 'body{}' }, { ...native, background: '#ffffff' }]) {
      expect(() => parsePluginManifest(withTemplate(template))).toThrow();
    }
  });

  it('keeps API v1 strict and requires matching manifest/API versions', () => {
    const old = contentManifest();
    expect(parsePluginManifest(old).apiVersion).toBe(1);
    for (const patch of [{ exporters: exportManifest().exporters }, { manifestVersion: 2 }, { apiVersion: 2 }]) {
      expect(() => parsePluginManifest({ ...old, ...patch })).toThrow();
    }
    expect(() => parsePluginManifest({ ...exportManifest(), manifestVersion: 1 })).toThrow();
  });

  it('allows v2 content alongside exporters and rejects plugins without any contribution', () => {
    const source = exportManifest();
    expect(parsePluginManifest({ ...source, contentTypes: contentManifest().contentTypes }).contentTypes).toHaveLength(1);
    expect(() => parsePluginManifest({ ...source, exporters: [] })).toThrow();
    const { exporters: _exporters, ...withoutExporters } = source;
    expect(() => parsePluginManifest(withoutExporters)).toThrow();
    expect(parsePluginManifest({ ...withoutExporters, contentTypes: contentManifest().contentTypes }).apiVersion).toBe(2);
  });

  it('rejects executable, unknown and prototype-based template fields', () => {
    for (const patch of [{ css: 'body { display:none }' }, { background: 'url(file:///secret)' }, { accentColor: '#FFF' }, { fontFamily: 'remote-font' }, { fontFamily: { toString: () => 'sans' } }, { constructor: {} }]) {
      const source = exportManifest();
      Object.assign(source.exporters[0].templates[0], patch);
      expect(() => parsePluginManifest(source)).toThrow();
    }
    const source = exportManifest();
    Object.setPrototypeOf(source.exporters[0].templates[0], { injected: true });
    expect(() => parsePluginManifest(source)).toThrow();
  });

  it('bounds dimensions and typography using finite numbers', () => {
    for (const patch of [{ width: 479 }, { width: 2161 }, { width: 1080.5 }, { height: 12001 }, { height: NaN }, { width: Infinity }]) {
      const source = exportManifest(); Object.assign(source.exporters[0].presets[0], patch);
      expect(() => parsePluginManifest(source)).toThrow();
    }
    for (const patch of [{ fontSize: 15 }, { fontSize: 81 }, { fontSize: 32.5 }, { fontSize: NaN }, { lineHeight: 1.19 }, { lineHeight: 2.41 }, { lineHeight: Infinity }]) {
      const source = exportManifest(); Object.assign(source.exporters[0].templates[0], patch);
      expect(() => parsePluginManifest(source)).toThrow();
    }
  });

  it('rejects missing, excessive and duplicate export contributions', () => {
    for (const field of ['templates', 'presets'] as const) {
      const source = exportManifest();
      Object.assign(source.exporters[0], { [field]: [] });
      expect(() => parsePluginManifest(source)).toThrow();
      const duplicated = exportManifest();
      Object.assign(duplicated.exporters[0], { [field]: [duplicated.exporters[0][field][0], duplicated.exporters[0][field][0]] });
      expect(() => parsePluginManifest(duplicated)).toThrow();
    }
    const source = exportManifest();
    source.exporters.push(structuredClone(source.exporters[0]));
    expect(() => parsePluginManifest(source)).toThrow();
    expect(() => parsePluginManifest({ ...exportManifest(), exporters: Array.from({ length: 17 }, (_, index) => ({ ...exportManifest().exporters[0], id: `export-${index}` })) })).toThrow();
  });
});
