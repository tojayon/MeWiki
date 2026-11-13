import { expect, it } from 'vitest';
import { publicationMarkup } from './publicationMarkup.ts';
import { defaultPublicationOptions, type PublicationRequest } from './publicationTypes.ts';
import { defaultPublicationFrame } from './publicationFrames.ts';
import { defaultPublicationTexture } from './publicationTextures.ts';

it('renders one source image per page with the shared frame and no notebook chrome', async () => {
  const options = { ...defaultPublicationOptions(), imageMode: { fit: 'cover' as const }, frame: defaultPublicationFrame('phone'), textureLayers: [defaultPublicationTexture('grid')] };
  const request: PublicationRequest = { options, document: { title: '<private>', text: '', blocks: [
    { id: 'a', kind: 'image', content: 'data:image/png;base64,AAAA', crop: { x: 20, y: 70, zoom: 150 } },
    { id: 'b', kind: 'image', content: 'data:image/jpeg;base64,BBBB' },
  ] } };
  const { html, images, imageContexts } = await publicationMarkup(request);
  expect(html.match(/class="publication-page"/g)).toHaveLength(2);
  expect(html).toContain('data-image-index="0"');
  expect(html).toContain('object-position:20% 70%');
  expect(html).toContain('transform:scale(1.5)');
  expect(html).toContain('corner-shape:superellipse(1.6)');
  expect(html.match(/data-device-frame="phone"/g)).toHaveLength(2);
  expect(html).toContain('publication-texture-background');
  expect(html).not.toContain('class="page-header"');
  expect(html).not.toContain('<private>');
  expect(images).toEqual(['data:image/png;base64,AAAA', 'data:image/jpeg;base64,BBBB']);
  expect(imageContexts.get(images[1])).toContain('第 2 项');
});

it('uses full-image fit without an unrelated text margin or crop zoom', async () => {
  const { html } = await publicationMarkup({ options: { ...defaultPublicationOptions(), imageMode: { fit: 'contain' } }, document: { title: '', text: '', blocks: [{ id: 'a', kind: 'image', content: 'data:image/png;base64,AAAA', crop: { x: 0, y: 0, zoom: 300 } }] } });
  expect(html).toContain('object-fit:contain');
  expect(html).toContain('object-position:50% 50%');
  expect(html).toContain('transform:scale(1)');
  expect(html).not.toContain('page-body');
});
