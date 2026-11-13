import { afterEach, expect, it } from 'vitest';
import { defaultPublicationOptions, parsePublicationOptions } from '../domain/publicationTypes.ts';
import { defaultPublicationTexture } from '../domain/publicationTextures.ts';
import { publicationFields } from '../domain/publicationValidation.ts';
import { setLocale } from './locale.ts';
import { localizePublicationError } from './publicationError.ts';

afterEach(() => setLocale('zh-CN'));
it('localizes image composition paths without translating user text', () => {
  setLocale('en');
  expect(localizePublicationError('图片创作 → 第 3 张 → 第 2 个图层：图层超出画布或设备屏幕，请调整位置或大小。')).toBe('Image creation → Image 3 → Layer 2: The layer extends outside the canvas or device screen. Adjust its position or size.');
  expect(localizePublicationError('图片创作 → 画布 → 第 1 个图层 → 文字：请重新选择。')).not.toMatch(/[\u4e00-\u9fff]/);
});
it('localizes only system setting paths and limits at display time', () => {
  let source = '';
  try { parsePublicationOptions({ ...defaultPublicationOptions(), textureLayers: [defaultPublicationTexture('paper'), { ...defaultPublicationTexture('grid'), opacity: 51 }] }); }
  catch (cause) { source = (cause as Error).message; }
  expect(source).toContain('第 2 层');
  setLocale('en');
  expect(localizePublicationError(source)).toBe('Style → Note background texture → Layer 2 → Texture strength: Current value: 51. Enter an integer between 0 and 50.');
  for (const field of Object.values(publicationFields)) expect(localizePublicationError(field + '：请重新选择。')).not.toMatch(/[\u4e00-\u9fff]/);
  const unknown = '用户自定义内容：页面留白';
  expect(localizePublicationError(unknown)).toBe(unknown);
  setLocale('zh-CN');
  expect(localizePublicationError(source)).toBe(source);
});
