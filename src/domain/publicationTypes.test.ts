import { describe, expect, it } from 'vitest';
import { defaultPublicationOptions, parsePublicationOptions, parsePublicationRequest } from './publicationTypes.ts';
import { defaultPublicationTexture } from './publicationTextures.ts';

const request = () => ({ document: { title: '知识分享', text: '正文', blocks: [{ id: 'a', kind: 'markdown', content: '正文' }] }, options: defaultPublicationOptions() });
describe('image-only publication requests', () => {
  const imageRequest = () => ({ document: { title: '', text: '', blocks: [{ id: 'image-1', kind: 'image', content: 'data:image/png;base64,AAAA' }] }, options: { ...defaultPublicationOptions(), imageMode: { fit: 'contain' } } });
  it('keeps old templates unchanged and normalizes hidden document settings for image templates', () => {
    expect(parsePublicationOptions(defaultPublicationOptions())).not.toHaveProperty('imageMode');
    const value = imageRequest();
    const options = { ...value.options, width: 480, height: 480, margin: 200, fontSize: 80, lineHeight: 2.4, fontAssetId: 'a'.repeat(64), logo: 'unavailable', cover: true, mode: 'long', frame: { id: 'phone', background: '#eeeeee', scale: 60, shadow: 0, contentScale: 125 } };
    const parsed = parsePublicationRequest({ ...value, options });
    expect(parsed.options).toMatchObject({ width: 480, height: 480, mode: 'pages', imageMode: { fit: 'contain' }, cover: false, logo: '' });
    expect(parsed.options).not.toHaveProperty('fontAssetId');
    expect(options.cover).toBe(true);
    expect(parsePublicationOptions(parsed.options)).toEqual(parsed.options);
    expect(parsePublicationOptions({ ...options, textureLayers: [{ ...defaultPublicationTexture('paper'), scope: 'margins' }] }).textureLayers![0].scope).toBe('all');
  });
  it('validates crop per image with exact item context, and rejects crop on ordinary content', () => {
    const value = imageRequest();
    const block = { ...value.document.blocks[0], crop: { x: 25, y: 75, zoom: 150 } };
    expect(parsePublicationRequest({ ...value, document: { ...value.document, blocks: [block] } }).document.blocks[0]).toEqual(block);
    for (const crop of [{ x: -1, y: 50, zoom: 100 }, { x: 50, y: 50, zoom: 301 }, { x: 50, y: 50, zoom: 100, css: 'none' }]) {
      expect(() => parsePublicationRequest({ ...value, document: { ...value.document, blocks: [value.document.blocks[0], { ...block, id: 'b', crop }] } })).toThrow(/第 2 项.*图片取景/);
    }
    expect(() => parsePublicationRequest({ ...request(), document: { ...request().document, blocks: [block] } })).toThrow(/图片取景/);
  });
  it('accepts only image blocks and bounds the whole group before rendering', () => {
    const value = imageRequest();
    expect(() => parsePublicationRequest({ ...value, document: request().document })).toThrow(/第 1 项.*图片导出.*图片/);
    expect(() => parsePublicationRequest({ ...value, options: { ...value.options, imageMode: { fit: 'stretch' } } })).toThrow(/图片适配/);
    const blocks = Array.from({ length: 51 }, (_, i) => ({ ...value.document.blocks[0], id: String(i) }));
    expect(() => parsePublicationRequest({ ...value, document: { ...value.document, blocks } })).toThrow(/50/);
    expect(() => parsePublicationRequest({ ...value, options: { ...value.options, width: 2160, height: 2160 }, document: { ...value.document, blocks: blocks.slice(0, 18) } })).toThrow(/8000 万像素/);
  });
});
describe('publication requests', () => {
  it('keeps optional source identities without requiring them in existing requests', () => {
    const value = request();
    expect(parsePublicationRequest(value).document.blocks[0]).not.toHaveProperty('sourceId');
    const source = { ...value.document.blocks[0], sourceId: 'source:with:colons' };
    expect(parsePublicationRequest({ ...value, document: { ...value.document, blocks: [source] } }).document.blocks[0]).toEqual(source);
    for (const sourceId of ['', 10, 'a'.repeat(1001)]) expect(() => parsePublicationRequest({ ...value, document: { ...value.document, blocks: [{ ...source, sourceId }] } })).toThrow(/第 1 项/);
  });
  it.each([
    [{ width: 320 }, ['画幅 → 输出宽度', '320', '480', '2160']],
    [{ height: 12001 }, ['画幅 → 输出高度', '12001', '480', '12000']],
    [{ mode: 'long', height: 12001 }, ['画幅 → 长图最大高度', '12001', '12000']],
    [{ margin: 201 }, ['样式 → 页面留白', '201', '16', '200']],
    [{ fontSize: 15 }, ['样式 → 正文字号', '15', '16', '80']],
    [{ lineHeight: 3 }, ['样式 → 正文行距', '3', '1.2', '2.4']],
    [{ quality: 30 }, ['样式 → JPEG 质量', '30', '40', '100']],
    [{ background: 'red' }, ['样式 → 背景颜色', '#RRGGBB']],
    [{ author: 'a'.repeat(201) }, ['内容 → 作者署名', '201', '200']],
    [{ logo: 'https://example.com/private-avatar.png' }, ['内容 → 作者头像或 Logo', 'PNG', 'JPEG']],
    [{ format: 'webp' }, ['画幅 → 图片格式', '重新选择']],
  ])('identifies the invalid setting and its limits without exposing resource contents: %j', (patch, fragments) => {
    let message = '';
    try { parsePublicationOptions({ ...defaultPublicationOptions(), ...patch }); } catch (cause) { message = (cause as Error).message; }
    for (const fragment of fragments) expect(message).toContain(fragment);
    expect(message).not.toContain('private-avatar.png');
    expect(message).not.toContain('导出参数或内容无效');
  });
  it('distinguishes the pixel budget from insufficient width and height after margins', () => {
    const cases = [
      [{ width: 2160, height: 12000 }, ['画幅', '1600 万像素', '2160', '12000']],
      [{ width: 480, margin: 200, fontSize: 80 }, ['正文宽度', '页面留白', '字号']],
      [{ height: 480, margin: 100, fontSize: 80 }, ['正文高度', '页面留白', '行距']],
    ] as const;
    for (const [patch, fragments] of cases) {
      let message = '';
      try { parsePublicationOptions({ ...defaultPublicationOptions(), ...patch }); } catch (cause) { message = (cause as Error).message; }
      for (const fragment of fragments) expect(message).toContain(fragment);
    }
  });
  it('identifies a failing texture layer and device control', () => {
    expect(() => parsePublicationOptions({ ...defaultPublicationOptions(), textureLayers: [defaultPublicationTexture('paper'), { ...defaultPublicationTexture('grid'), opacity: 51 }] })).toThrow(/第 2 层.*纹理强度.*51.*50/);
    expect(() => parsePublicationOptions({ ...defaultPublicationOptions(), frame: { id: 'phone', background: '#edf0f4', scale: 100, shadow: 40, contentScale: 126 } })).toThrow(/设备边框.*屏幕内容缩放.*126.*125/);
  });
  it('identifies invalid exported content by order and type', () => {
    const value = request();
    expect(() => parsePublicationRequest({ ...value, document: { ...value.document, blocks: [...value.document.blocks, { id: 'b', kind: 'image', content: 'file:///private-image.png' }] } })).toThrow(/第 2 项.*图片.*PNG.*JPEG/);
    expect(() => parsePublicationRequest({ ...value, options: { ...value.options, style: 'document' }, document: { ...value.document, blocks: [{ id: 'native', kind: 'native', content: 'invalid JSON' }] } })).toThrow(/第 1 项.*原生.*重新生成/);
    expect(() => parsePublicationRequest({ ...value, document: { ...value.document, blocks: [] } })).toThrow(/选择内容.*至少/);
  });
  it('accepts a bounded static document without changing the input', () => {
    const value = request();
    expect(parsePublicationRequest(value)).toEqual(value);
    expect(parsePublicationRequest(value)).not.toBe(value);
  });
  it('preserves the document style reference without adding it to old requests', () => {
    const value = request();
    expect(parsePublicationRequest(value).options).not.toHaveProperty('style');
    expect(parsePublicationRequest({ ...value, options: { ...value.options, style: 'document' } }).options).toMatchObject({ style: 'document' });
    for (const style of ['arbitrary', ['document'], null]) expect(() => parsePublicationRequest({ ...value, options: { ...value.options, style } })).toThrow();
  });
  it('accepts a device frame without adding one to old requests or changing the output size', () => {
    const value = request();
    expect(parsePublicationRequest(value).options).not.toHaveProperty('frame');
    for (const id of ['phone', 'phone-landscape', 'laptop', 'browser']) {
      const frame = { id, background: '#edf0f4', scale: 100, shadow: 40, contentScale: 100 };
      const parsed = parsePublicationRequest({ ...value, options: { ...value.options, frame } });
      expect(parsed.options).toMatchObject({ width: 1080, height: 1440, frame });
      expect(parsed.options.frame).not.toBe(frame);
    }
  });
  it('retains the selected frame for a later return from continuous images to pages', () => {
    const frame = { id: 'phone', background: '#edf0f4', scale: 90, shadow: 0, contentScale: 110 };
    expect(parsePublicationRequest({ ...request(), options: { ...defaultPublicationOptions(), mode: 'long', frame } }).options).toMatchObject({ mode: 'long', frame });
  });
  it('rejects untrusted frame shapes, resources, colors and out-of-range settings', () => {
    const valid = { id: 'phone', background: '#edf0f4', scale: 100, shadow: 40, contentScale: 100 };
    const invalid = [null, [], {}, { ...valid, id: 'custom' }, { ...valid, id: ['phone'] }, { ...valid, url: 'https://example.com/frame.svg' }, { ...valid, css: 'display:none' }, { ...valid, background: 'red' }, { ...valid, scale: 59 }, { ...valid, scale: 101 }, { ...valid, shadow: -1 }, { ...valid, shadow: 101 }, { ...valid, contentScale: 74 }, { ...valid, contentScale: 126 }, { ...valid, scale: 90.5 }];
    for (const frame of invalid) expect(() => parsePublicationRequest({ ...request(), options: { ...defaultPublicationOptions(), frame } })).toThrow();
  });
  it('rejects injected styles, unknown fields and excessive image dimensions', () => {
    expect(() => parsePublicationRequest({ ...request(), options: { ...defaultPublicationOptions(), background: 'red;display:none' } })).toThrow();
    expect(() => parsePublicationRequest({ ...request(), directory: 'D:/private' })).toThrow();
    expect(() => parsePublicationRequest({ ...request(), options: { ...defaultPublicationOptions(), width: 2160, height: 12000 } })).toThrow();
  });
  it('rejects external images and executable image data', () => {
    for (const content of ['https://example.com/image.png', 'file:///private', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      expect(() => parsePublicationRequest({ ...request(), document: { ...request().document, blocks: [{ id: 'a', kind: 'image', content }] } })).toThrow();
    }
  });
  it('rejects duplicate block identities and impossible content margins', () => {
    const value = request();
    expect(() => parsePublicationRequest({ ...value, document: { ...value.document, blocks: [...value.document.blocks, ...value.document.blocks] } })).toThrow();
    expect(() => parsePublicationRequest({ ...value, options: { ...value.options, width: 480, margin: 200, fontSize: 80 } })).toThrow();
  });
  it('rejects enum-shaped arrays instead of coercing them to supported values', () => {
    for (const [key, value] of [['fontFamily', ['sans']], ['mode', ['pages']], ['format', ['png']]]) {
      expect(() => parsePublicationRequest({ ...request(), options: { ...defaultPublicationOptions(), [key as string]: value } })).toThrow();
    }
    expect(() => parsePublicationRequest({ ...request(), document: { ...request().document, blocks: [{ id: 'a', kind: ['markdown'], content: '正文' }] } })).toThrow();
  });
});
