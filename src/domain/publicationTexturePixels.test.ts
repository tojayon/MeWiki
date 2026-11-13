import { expect, it } from 'vitest';
import { textureCrop, processTexturePixels, mirrorTexturePixels } from './publicationTexturePixels.ts';

it('keeps crop squares within a landscape or portrait source even at the edges', () => {
  expect(textureCrop(800, 400, 50, 100, 0)).toEqual({ x: 600, y: 0, size: 200 });
  expect(textureCrop(400, 800, 100, 50, 100)).toEqual({ x: 0, y: 400, size: 400 });
  expect(() => textureCrop(0, 10, 100, 0, 0)).toThrow();
});
it('creates bounded, distinct grayscale and tinted candidates without mutating the source', () => {
  const source = new Uint8ClampedArray([100, 60, 20, 255, 200, 180, 100, 128, 80, 130, 180, 255, 160, 190, 220, 0]);
  const original = source.slice();
  const gray = processTexturePixels(source, 2, 2, 'gray', '#ddeeff', false);
  const tint = processTexturePixels(source, 2, 2, 'tint', '#ddeeff', false);
  expect(source).toEqual(original);
  expect(gray[0]).toBe(gray[1]); expect(gray[1]).toBe(gray[2]);
  expect(tint.slice(0, 3)).toEqual(new Uint8ClampedArray([144, 155, 166]));
  expect(gray[15]).toBe(0); expect(tint[15]).toBe(0);
  expect(() => processTexturePixels(source, 10000, 2, 'gray', '#ffffff', true)).toThrow();
});
it('removes gradual lighting without erasing local texture and mirrors opposite edges for seamless tiles', () => {
  const source = Uint8ClampedArray.from(Array.from({ length: 16 * 16 * 4 }, (_, i) => i % 4 === 3 ? 255 : 40 + Math.floor(i / 4) % 16 * 10));
  const flat = processTexturePixels(source, 16, 16, 'gray', '#ffffff', true);
  expect(Math.abs(flat[(8 * 16 + 4) * 4] - flat[(8 * 16 + 12) * 4])).toBeLessThan(40);
  const mirrored = mirrorTexturePixels(source, 16, 16);
  expect(mirrored.length).toBe(32 * 32 * 4);
  for (let y = 0; y < 32; y++) expect(mirrored.slice(y * 32 * 4, y * 32 * 4 + 4)).toEqual(mirrored.slice((y * 32 + 31) * 4, (y * 32 + 32) * 4));
  expect(mirrored.slice(0, 32 * 4)).toEqual(mirrored.slice(31 * 32 * 4));
});
