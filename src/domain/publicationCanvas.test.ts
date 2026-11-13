import { describe, expect, it } from 'vitest';
import { defaultPublicationOptions, parsePublicationOptions } from './publicationTypes.ts';
import { publicationAspect, publicationClarity, setPublicationAspect, setPublicationClarity, supportsPublicationClarity } from './publicationCanvas.ts';

describe('publication aspect and clarity', () => {
  it('recognizes existing dimensions without rewriting personal templates', () => {
    const options = defaultPublicationOptions();
    expect(publicationAspect(options)).toBe('3:4');
    expect(publicationClarity(options)).toBe(1080);
    expect(publicationAspect({ ...options, width: 1600, height: 900 })).toBe('16:9');
    expect(publicationClarity({ ...options, width: 1600, height: 900 })).toBe(0);
    expect(publicationAspect({ ...options, width: 997, height: 1229 })).toBe('custom');
  });
  it('changes clarity while scaling text and margins to retain composition', () => {
    const options = { ...defaultPublicationOptions(), fontSize: 36, margin: 72 };
    const result = setPublicationClarity(options, 720);
    expect(result).toMatchObject({ width: 720, height: 960, fontSize: 24, margin: 48 });
    expect(parsePublicationOptions(result)).toEqual(result);
    expect(setPublicationClarity(result, 1080)).toEqual(options);
  });
  it('changes aspect with a familiar short-edge clarity and respects image limits', () => {
    const options = defaultPublicationOptions();
    const result = setPublicationAspect(options, '16:9');
    expect(result).toMatchObject({ width: 1920, height: 1080 });
    expect(publicationClarity(result)).toBe(1080);
    expect(supportsPublicationClarity(result, 1440)).toBe(false);
    expect(supportsPublicationClarity({ ...options, width: 1080, height: 1920 }, 1440)).toBe(true);
    expect(() => setPublicationClarity(result, 1440)).toThrow();
    expect(parsePublicationOptions(result)).toEqual(result);
  });
  it('keeps continuous images content-driven and preserves custom dimensions', () => {
    const options = { ...defaultPublicationOptions(), mode: 'long' as const, height: 12000 };
    expect(publicationAspect(options)).toBe('long');
    expect(publicationClarity(options)).toBe(1080);
    const result = setPublicationClarity(options, 1440);
    expect(result).toMatchObject({ width: 1440, height: 11111 });
    expect(parsePublicationOptions(result)).toEqual(result);
    const custom = { ...defaultPublicationOptions(), width: 997, height: 1229 };
    const changed = setPublicationClarity(custom, 720);
    expect(changed.width).toBe(720);
    expect(changed.height / changed.width).toBeCloseTo(custom.height / custom.width, 2);
  });
  it('uses the highest supported clarity when changing from ultra-clear portrait to landscape', () => {
    const portrait = setPublicationClarity(defaultPublicationOptions(), 1440);
    const landscape = setPublicationAspect(portrait, '16:9');
    expect(landscape).toMatchObject({ width: 1920, height: 1080 });
    expect(parsePublicationOptions(landscape)).toEqual(landscape);
  });
});
