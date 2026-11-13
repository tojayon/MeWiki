/// <reference types="node" />
import { expect, it } from 'vitest';
import { defaultPublicationOptions } from '../domain/publicationTypes.ts';
import { parseExportProfiles, exportProfileFile, importExportProfile, importExportProfileFile } from './exportProfiles.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defaultComposition, newCompositionLayer } from '../domain/publicationComposition.ts';
const profile = { id: 'personal-1', name: '我的知识卡', templateId: 'clear', templateVersion: '0.1.0', options: defaultPublicationOptions() };
it('exports a versioned composition template including all required layer fonts but no batch images', async () => {
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  const font = { id: createHash('sha256').update(bytes).digest('hex'), name: '标题.woff2', dataUrl: `data:font/woff2;base64,${bytes.toString('base64')}` };
  const layer = { ...newCompositionLayer('text', 'title'), text: '{{title}}', fontAssetId: font.id };
  const creative = { ...profile, options: { ...profile.options, imageMode: { fit: 'contain' as const }, composition: { ...defaultComposition(), layers: [layer] } } };
  expect(() => exportProfileFile(creative)).toThrow(/字体/);
  const file = exportProfileFile(creative, undefined, [font]);
  expect(JSON.parse(file).version).toBe(2);
  expect(importExportProfileFile(file)).toEqual({ profile: creative, fonts: [font] });
  expect(file).not.toContain('imageData');
});
it('round trips a personal template without notebook content', () => {
  const file = exportProfileFile(profile);
  expect(importExportProfile(file)).toEqual(profile);
  expect(file).not.toContain('blocks');
});
it('saves image fit and shared device settings without source images, crops or unused document assets', () => {
  const image = { ...profile, options: { ...profile.options, imageMode: { fit: 'cover' as const }, logo: 'unavailable', coverImage: 'unavailable', fontAssetId: 'a'.repeat(64), frame: { id: 'phone' as const, background: '#eeeeee', scale: 90, shadow: 25, contentScale: 100 } } };
  const serialized = exportProfileFile(image);
  const restored = importExportProfile(serialized);
  expect(restored.options).toMatchObject({ imageMode: { fit: 'cover' }, frame: image.options.frame, logo: '', coverImage: '' });
  expect(restored.options).not.toHaveProperty('fontAssetId');
  expect(serialized).not.toMatch(/unavailable|crop|blocks|data:image/);
  expect(parseExportProfiles([restored])[0]).toEqual(restored);
});
it('preserves a document-based personal template with its explicitly saved colors and author', () => {
  const native = { ...profile, templateId: 'mewiki', options: { ...profile.options, style: 'document' as const, textColor: '#123456', author: '个人署名' } };
  expect(importExportProfile(exportProfileFile(native))).toEqual(native);
});
it('round trips device settings through personal template storage and a portable template', () => {
  const framed = { ...profile, options: { ...profile.options, frame: { id: 'laptop' as const, background: '#dfe6ed', scale: 85, shadow: 25, contentScale: 110 } } };
  expect(parseExportProfiles([framed])[0]).toEqual(framed);
  expect(importExportProfile(exportProfileFile(framed))).toEqual(framed);
  expect(exportProfileFile(framed)).not.toContain('<svg');
});
it('rejects duplicate profile identities and unknown executable properties', () => {
  expect(() => parseExportProfiles([profile, profile])).toThrow();
  expect(() => importExportProfile(JSON.stringify({ format: 'mewiki-export-template', version: 1, profile: { ...profile, script: 'alert(1)' } }))).toThrow();
});
it('carries a user font with a portable template while keeping saved options as a reference', async () => {
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  const font = { id: createHash('sha256').update(bytes).digest('hex'), name: '用户字体.woff2', dataUrl: `data:font/woff2;base64,${bytes.toString('base64')}` };
  const selected = { ...profile, options: { ...profile.options, fontAssetId: font.id } };
  expect(parseExportProfiles([selected])[0]).toEqual(selected);
  expect(() => exportProfileFile(selected)).toThrow(/字体/);
  const file = exportProfileFile(selected, font);
  expect(importExportProfileFile(file)).toEqual({ profile: selected, font });
  expect(importExportProfile(file)).toEqual(selected);
  expect(() => importExportProfileFile(file.replace(font.id, 'a'.repeat(64)))).toThrow(/字体/);
});
