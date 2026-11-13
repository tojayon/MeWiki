import { describe, expect, it } from 'vitest';
import { defaultPublicationOptions, parsePublicationOptions } from './publicationTypes.ts';
import { defaultPublicationTexture, publicationTexturePresets, publicationTextureBackground, publicationTextureCss, withPublicationTextureLayers } from './publicationTextures.ts';
import { publicationMarkup } from './publicationMarkup.ts';
import { exportProfileFile, importExportProfile } from '../state/exportProfiles.ts';

describe('publication background textures', () => {
  it('accepts a margins-only single texture and preserves it in old-shaped personal templates', () => {
    const options = { ...defaultPublicationOptions(), texture: { ...defaultPublicationTexture('dots'), scope: 'margins' as const } };
    expect(parsePublicationOptions(options)).toEqual(options);
    const profile = { id: 'margins', name: '四周点阵', templateId: 'mewiki', templateVersion: '0.1.0', options };
    expect(importExportProfile(exportProfileFile(profile))).toEqual(profile);
  });
  it('round trips independently configured layers without adding a legacy single texture', () => {
    const options = { ...defaultPublicationOptions(), textureLayers: [{ ...defaultPublicationTexture('watercolor'), scope: 'margins' as const }, { ...defaultPublicationTexture('paper'), opacity: 12 }] };
    expect(parsePublicationOptions(options)).toEqual(options);
    expect(parsePublicationOptions(options)).not.toHaveProperty('texture');
    const profile = { id: 'layered', name: '叠加纸纹', templateId: 'mewiki', templateVersion: '0.1.0', options };
    expect(importExportProfile(exportProfileFile(profile))).toEqual(profile);
    expect(parsePublicationOptions({ ...defaultPublicationOptions(), textureLayers: [] })).toHaveProperty('textureLayers', []);
  });
  it('rejects ambiguous or excessive layers and validates every layer independently', () => {
    const valid = defaultPublicationTexture('paper');
    for (const extra of [
      { texture: valid, textureLayers: [valid] },
      { textureLayers: Array.from({ length: 7 }, () => valid) },
      { textureLayers: { 0: valid } },
      { textureLayers: [valid, { ...valid, opacity: 70 }] },
      { textureLayers: [valid, { ...valid, image: 'https://example.com/private.png', kind: 'custom' }] },
      { textureLayers: [valid, null] },
    ]) expect(() => parsePublicationOptions({ ...defaultPublicationOptions(), ...extra })).toThrow();
  });
  it('switches between zero, single and multiple layers without retaining stale competing fields', () => {
    const old = { ...defaultPublicationOptions(), author: '署名', texture: defaultPublicationTexture('dots') };
    const layered = withPublicationTextureLayers(old, [defaultPublicationTexture('paper'), old.texture]);
    expect(layered).not.toHaveProperty('texture'); expect(layered.textureLayers).toHaveLength(2);
    const single = withPublicationTextureLayers(layered, [old.texture]);
    expect(single).toEqual(old); expect(single).not.toHaveProperty('textureLayers');
    const empty = withPublicationTextureLayers(single, []);
    expect(empty).not.toHaveProperty('texture'); expect(empty).not.toHaveProperty('textureLayers');
    expect(empty.author).toBe('署名'); expect(old.texture.kind).toBe('dots');
  });
  it('shares layered background markup, clips the margin ring and validates images in all layers', async () => {
    const first = { ...defaultPublicationTexture('custom'), image: 'data:image/png;base64,Zmlyc3Q=', scope: 'margins' as const };
    const second = { ...defaultPublicationTexture('custom'), image: 'data:image/png;base64,c2Vjb25k', scope: 'body' as const };
    const { html, images } = await publicationMarkup({ document: { title: '图层', text: '正文', blocks: [{ id: 'a', kind: 'markdown', content: '正文' }] }, options: { ...defaultPublicationOptions(), margin: 60, textureLayers: [first, second] } });
    expect(images).toEqual([first.image, second.image]);
    expect(html).toContain('id="publication-texture-layers"');
    expect(html).toContain('clip-path:polygon(evenodd');
    expect(html).toContain('60px');
    const template = html.slice(html.indexOf('<template id="publication-texture-layers"'));
    expect(template.indexOf('data-texture-layer="1"')).toBeLessThan(template.indexOf('data-texture-layer="0"'));
  });
  it('preserves old options without adding texture and round trips a saved texture', () => {
    const old = defaultPublicationOptions();
    expect(parsePublicationOptions(old)).toEqual(old);
    expect(parsePublicationOptions(old)).not.toHaveProperty('texture');
    const options = { ...old, texture: defaultPublicationTexture('fiber') };
    expect(parsePublicationOptions(options)).toEqual(options);
    const profile = { id: 'texture-template', name: '纸纹', templateId: 'mewiki', templateVersion: '0.1.0', options };
    expect(importExportProfile(exportProfileFile(profile))).toEqual(profile);
  });
  it('rejects unbounded parameters, unknown fields and external or executable images', () => {
    for (const patch of [{ kind: 'script' }, { seed: -1 }, { seed: 1.2 }, { opacity: 51 }, { scale: 900 }, { rotation: Infinity }, { scope: ['all'] }, { script: 'alert(1)' }, { color: 'red;display:none' }, { image: 'https://example.com/a.png', kind: 'custom' }, { image: 'data:image/svg+xml;base64,PHN2Zz4=', kind: 'custom' }, { image: '', kind: 'custom' }]) {
      expect(() => parsePublicationOptions({ ...defaultPublicationOptions(), texture: { ...defaultPublicationTexture('paper'), ...patch } })).toThrow();
    }
  });
  it('generates all eight bounded presets deterministically and changes the variant only with the seed', () => {
    expect(publicationTexturePresets).toHaveLength(8);
    for (const { id } of publicationTexturePresets) {
      const texture = defaultPublicationTexture(id);
      const first = publicationTextureBackground(texture);
      expect(first).toEqual(publicationTextureBackground(structuredClone(texture)));
      expect(first.backgroundImage.length).toBeLessThan(150000);
      expect(first.backgroundImage).not.toMatch(/https?:|<script/);
      expect(first.backgroundImage).not.toEqual(publicationTextureBackground({ ...texture, seed: texture.seed + 1 }).backgroundImage);
    }
    expect(publicationTextureCss(undefined)).toBe('');
    expect(publicationTextureCss(defaultPublicationTexture('none'))).toBe('');
  });
  it('puts texture behind content, restricts its page scope and validates custom images with other image assets', async () => {
    const texture = { ...defaultPublicationTexture('custom'), image: 'data:image/png;base64,aW52YWxpZA==', scope: 'body' as const };
    const request = { document: { title: '纹理', text: '正文', blocks: [{ id: 'text', kind: 'markdown' as const, content: '正文' }] }, options: { ...defaultPublicationOptions(), texture } };
    const { html, images } = await publicationMarkup(request);
    expect(images).toContain(texture.image);
    expect(html).toContain('.publication-page:has(.cover-body) .publication-texture-layer[data-texture-scope="body"]');
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('z-index:1');
    expect(html).toContain('正文');
  });
  it('keeps full-page textures covering the canvas when adjusting the cloud size', () => {
    for (const kind of ['mist', 'watercolor'] as const) {
      const base = defaultPublicationTexture(kind), small = publicationTextureBackground({ ...base, scale: 50 });
      expect(small.backgroundSize).toBe('100% 100%');
      expect(small.backgroundImage).not.toBe(publicationTextureBackground(base).backgroundImage);
    }
  });
});
