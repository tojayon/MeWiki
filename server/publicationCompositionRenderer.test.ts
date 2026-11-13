import { expect, it } from 'vitest';
import sharp from 'sharp';
import { defaultComposition, newCompositionLayer } from '../src/domain/publicationComposition.ts';
import { defaultPublicationOptions, parsePublicationRequest, type PublicationRequest } from '../src/domain/publicationTypes.ts';
import { defaultPublicationFrame } from '../src/domain/publicationFrames.ts';
import { renderPublication } from './publicationRenderer.ts';

async function fixture(): Promise<PublicationRequest> {
  const image = 'data:image/png;base64,' + (await sharp({ create: { width: 400, height: 200, channels: 3, background: '#eeeeee' } }).png().toBuffer()).toString('base64');
  return { options: { ...defaultPublicationOptions(), width: 600, height: 800, imageMode: { fit: 'cover' }, frame: defaultPublicationFrame('phone'), composition: defaultComposition() }, document: { title: '', text: '', blocks: [{ id: 'main', kind: 'image', content: image, imageData: { title: 'Launch', subtitle: '', name: 'demo', index: 1, total: 1 } }] } };
}
it('renders canvas and screen layers in actual Edge output with a transformed device', async () => {
  const request = await fixture();
  request.options.composition!.subject = { ...request.options.composition!.subject, scale: 85, rotation: 8 };
  request.options.composition!.layers = [
    { ...newCompositionLayer('text', 'title'), text: 'MeWiki {{index}} / {{total}}', color: '#116633', background: '#11cc44' },
    { ...newCompositionLayer('sticker', 'badge'), space: 'screen', sticker: 'badge', x: 40, y: 45, color: '#ef2929' },
  ];
  const result = await renderPublication(parsePublicationRequest(request));
  expect(result.pages[0]).toMatchObject({ width: 600, height: 800 });
  const data = await sharp(Buffer.from(result.pages[0].dataUrl.split(',')[1], 'base64')).removeAlpha().raw().toBuffer();
  let red = 0, green = 0;
  for (let n = 0; n < data.length; n += 3) { if (data[n] === 239 && data[n + 1] === 41 && data[n + 2] === 41) red++; if (data[n] === 17 && data[n + 1] === 204 && data[n + 2] === 68) green++; }
  expect(red).toBeGreaterThan(100); expect(green).toBeGreaterThan(100);
}, 45000);
it('reports original stable layer order across canvas and screen spaces, and rejects overflowing copy', async () => {
  const request = await fixture();
  request.options.composition!.layers = [
    { ...newCompositionLayer('text', 'canvas-title'), text: 'Valid' },
    { ...newCompositionLayer('sticker', 'bad-screen'), space: 'screen', x: 98 },
  ];
  await expect(renderPublication(parsePublicationRequest(request))).rejects.toThrow(/图片创作 → 第 1 张 → 第 2 个图层：图层超出/);
  request.options.composition!.layers = [{ ...newCompositionLayer('text', 'overflow'), text: 'Long copy '.repeat(300), width: 5, height: 5 }];
  await expect(renderPublication(parsePublicationRequest(request))).rejects.toThrow(/图片创作 → 第 1 张 → 第 1 个图层：文字超出/);
}, 45000);
