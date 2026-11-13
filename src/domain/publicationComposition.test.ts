import { expect, it } from 'vitest';
import { defaultComposition, newCompositionLayer, parseComposition, resolveComposition, compositionLayerMarkup, compositionLayerRect, compositionFontIds, sharedComposition } from './publicationComposition.ts';
import { defaultPublicationOptions, parsePublicationOptions, parsePublicationRequest } from './publicationTypes.ts';
import { publicationImagePages } from './publicationImagePages.ts';

const image = 'data:image/png;base64,AAAA';
it('omits per-image-only layers from reusable templates and makes ownership immutable', () => {
  const scene = { ...defaultComposition(), layers: [newCompositionLayer('text', 'shared'), { ...newCompositionLayer('text', 'one-off'), localOnly: true, hidden: true }] };
  expect(sharedComposition(scene).layers.map(layer => layer.id)).toEqual(['shared']);
  expect(parseComposition(scene).layers[1].localOnly).toBe(true);
  expect(() => resolveComposition(scene, { layers: { 'one-off': { localOnly: false } } })).toThrow();
});
it('has no separate canvas size and strictly rejects executable or unbounded layers', () => {
  const composition = defaultComposition();
  expect(parseComposition(composition)).toEqual(composition);
  expect(() => parseComposition({ ...composition, width: 900 })).toThrow(/画布/);
  const layer = newCompositionLayer('text', 'title');
  expect(() => parseComposition({ ...composition, layers: [{ ...layer, html: '<script>' }] })).toThrow();
  expect(() => parseComposition({ ...composition, layers: [{ ...layer, x: NaN }] })).toThrow();
  expect(() => parseComposition({ ...composition, layers: Array.from({ length: 41 }, (_, i) => ({ ...layer, id: String(i) })) })).toThrow(/40/);
  expect(() => parseComposition({ ...composition, layers: [layer, layer] })).toThrow(/标识/);
});
it('merges per-image properties without losing shared edits and rejects unknown override identities', () => {
  const scene = { ...defaultComposition(), layers: [newCompositionLayer('text', 'title')] };
  const patch = { layers: { title: { x: 25 } } };
  const changed = { ...scene, layers: scene.layers.map(layer => ({ ...layer, color: '#aa1122' })) };
  expect(resolveComposition(changed, patch).layers[0]).toMatchObject({ x: 25, color: '#aa1122' });
  expect(scene.layers[0].x).not.toBe(25);
  expect(() => resolveComposition(scene, { layers: { unknown: { x: 3 } } })).toThrow(/图层/);
  expect(() => resolveComposition(scene, { layers: { title: { type: 'image' } } })).toThrow();
});
it('uses the left output canvas as geometry at every clarity and escapes literal and variable text', () => {
  const text = { ...newCompositionLayer('text', 'title'), text: '{{index}}/{{total}} <script>{{title}}</script>', x: 10, y: 20, width: 80, height: 12 };
  const small = compositionLayerRect(text, 720, 960), large = compositionLayerRect(text, 1080, 1440);
  expect(large.left).toBe(small.left * 1.5); expect(large.top).toBe(small.top * 1.5);
  const markup = compositionLayerMarkup(text, 720, 960, { title: '<img onerror=alert(1)>', name: 'x', subtitle: '', index: 3, total: 8 });
  expect(markup).toContain('3/8 &lt;script&gt;&lt;img onerror=alert(1)&gt;&lt;/script&gt;');
  expect(markup).not.toContain('<script>');
  const tiny = compositionLayerMarkup({ ...text, fontSize: .5 }, 720, 960, { title: '', name: '', subtitle: '', index: 1, total: 1 });
  expect(tiny).toContain('data-min-font="1.8"');
});
it('preserves new optional scene data and legacy images without adding a second set of dimensions', () => {
  const legacy = { ...defaultPublicationOptions(), imageMode: { fit: 'contain' as const } };
  expect(parsePublicationOptions(legacy)).not.toHaveProperty('composition');
  const options = { ...legacy, composition: { ...defaultComposition(), layers: [newCompositionLayer('text', 'title')] } };
  const checked = parsePublicationOptions(options);
  expect(checked.composition).toEqual(options.composition);
  const input = parsePublicationRequest({ options, document: { title: '', text: '', blocks: [{ id: 'picture', kind: 'image', content: image, imageData: { title: '第一张', subtitle: '', name: 'example', index: 1, total: 2, overrides: { layers: { title: { text: '单图说明' } } } } }] } });
  const html = publicationImagePages(input.document, input.options).html;
  expect(html).toContain('单图说明'); expect(html).toContain('data-composition-layer="title"');
  expect(html).not.toContain('contenteditable');
  expect(() => parsePublicationOptions({ ...defaultPublicationOptions(), composition: defaultComposition() })).toThrow(/图片/);
});
it('collects only fonts used by text layers and renders host-owned stickers without external sources', () => {
  const layer = { ...newCompositionLayer('text', 'title'), fontAssetId: 'a'.repeat(64) };
  expect(compositionFontIds({ ...defaultComposition(), layers: [layer] })).toEqual(['a'.repeat(64)]);
  const sticker = { ...newCompositionLayer('sticker', 'arrow'), sticker: 'arrow' as const };
  const markup = compositionLayerMarkup(sticker, 720, 960, { title: '', name: '', subtitle: '', index: 1, total: 1 });
  expect(markup).toContain('<svg'); expect(markup).not.toMatch(/(?:href|src)=|<script|<foreignObject/);
});
