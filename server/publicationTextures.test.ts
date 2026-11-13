import { expect, it } from 'vitest';
import sharp from 'sharp';
import { publicationHtml } from './publicationHtml.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';
import { defaultPublicationTexture } from '../src/domain/publicationTextures.ts';
import { exportProfileFile, importExportProfile } from '../src/state/exportProfiles.ts';

it('checks the binary of custom texture images and carries the image through personal template backup', async () => {
  const request = { document: { title: '纹理', text: '正文', blocks: [{ id: 'a', kind: 'markdown' as const, content: '正文' }] }, options: { ...defaultPublicationOptions(), texture: { ...defaultPublicationTexture('custom'), image: 'data:image/png;base64,aW52YWxpZA==' } } };
  await expect(publicationHtml(request)).rejects.toThrow('有效的静态 PNG');
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  request.options.texture.image = `data:image/png;base64,${bytes.toString('base64')}`;
  const saved = importExportProfile(exportProfileFile({ id: 'custom-texture', name: '自定义纸纹', templateId: 'clear', templateVersion: '0.1.0', options: request.options }));
  expect(saved.options.texture).toEqual(request.options.texture);
  expect(await publicationHtml(request)).toContain(request.options.texture.image);
});

it('checks every texture layer, including an invalid image hidden below a valid upper layer', async () => {
  const request = { document: { title: '图层', text: '正文', blocks: [{ id: 'a', kind: 'markdown' as const, content: '正文' }] }, options: { ...defaultPublicationOptions(), textureLayers: [defaultPublicationTexture('paper'), { ...defaultPublicationTexture('custom'), image: 'data:image/png;base64,aW52YWxpZA==' }] } };
  await expect(publicationHtml(request)).rejects.toThrow('有效的静态 PNG');
});
