/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fontHeaderInfo, MAX_USER_FONT_BYTES, parsePublicationFont, publicationFontFamily } from './researchFonts.ts';
import { defaultPublicationOptions, parsePublicationRequest } from './publicationTypes.ts';
import { publicationMarkup } from './publicationMarkup.ts';

const fixture = async (extension = 'woff2') => {
  const bytes = await readFile(extension === 'otf' ? 'node_modules/katex/src/fonts/lib/Extra.otf' : `node_modules/katex/dist/fonts/KaTeX_Main-Regular.${extension}`);
  return { bytes, resource: { id: createHash('sha256').update(bytes).digest('hex'), name: `示例字体.${extension}`, dataUrl: `data:font/${extension};base64,${bytes.toString('base64')}` } };
};
describe('portable user fonts', () => {
  it.each(['ttf', 'otf', 'woff', 'woff2'])('validates a local %s original and its bounded table headers', async extension => {
    const { bytes, resource } = await fixture(extension);
    expect(fontHeaderInfo(bytes)).toBe(`font/${extension}`);
    expect(parsePublicationFont(resource)).toEqual(resource);
    expect(() => fontHeaderInfo(bytes.subarray(0, 10))).toThrow(/字体/);
  });
  it('rejects disguised files, oversized fonts, mismatched types and hashes', async () => {
    const { bytes, resource } = await fixture();
    expect(() => fontHeaderInfo(new TextEncoder().encode('<html>font</html>'))).toThrow(/字体/);
    expect(MAX_USER_FONT_BYTES).toBe(100 * 1024 * 1024);
    expect(() => fontHeaderInfo(bytes, MAX_USER_FONT_BYTES + 1)).toThrow(/100 MiB/);
    for (const bad of [{ ...resource, id: 'a'.repeat(64) }, { ...resource, dataUrl: resource.dataUrl.replace('font/woff2', 'font/ttf') }, { ...resource, dataUrl: 'https://example.com/font.woff2' }, { ...resource, css: 'body{display:none}' }]) expect(() => parsePublicationFont(bad)).toThrow(/字体/);
  });
  it('requires the selected font and keeps old requests unchanged', async () => {
    const { resource } = await fixture();
    const legacy = { document: { title: '字体示例', text: 'Sample', blocks: [{ id: 'a', kind: 'markdown', content: '**Sample**' }] }, options: defaultPublicationOptions() };
    expect(parsePublicationRequest(legacy)).toEqual(legacy);
    const options = { ...legacy.options, fontAssetId: resource.id };
    expect(() => parsePublicationRequest({ ...legacy, options })).toThrow(/字体/);
    expect(() => parsePublicationRequest({ ...legacy, font: resource })).toThrow(/字体/);
    const request = parsePublicationRequest({ ...legacy, options, font: resource });
    expect(request.font).toEqual(resource);
    const { html } = await publicationMarkup(request);
    expect(html).toContain(resource.dataUrl);
    expect(html).toContain(publicationFontFamily(resource.id));
    expect(html).toContain('font-synthesis:weight');
    expect(html).toContain("font-src https://mewiki-publication.invalid data:");
  });
});
