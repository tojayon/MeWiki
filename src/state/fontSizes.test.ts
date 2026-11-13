import { describe, expect, it } from 'vitest';
import { fontSizesKey, readFontSizes, saveFontSize } from './fontSizes.ts';

function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe('library font sizes', () => {
  it('changes and resets each size independently without crossing libraries', () => {
    const saved = storage(), first = crypto.randomUUID(), second = crypto.randomUUID();
    expect(readFontSizes(first, saved)).toEqual({ interface: 14, document: 15 });
    saveFontSize(first, 'interface', 18, saved);
    expect(readFontSizes(first, saved)).toEqual({ interface: 18, document: 15 });
    saveFontSize(first, 'document', 24, saved);
    expect(readFontSizes(first, saved)).toEqual({ interface: 18, document: 24 });
    expect(readFontSizes(second, saved)).toEqual({ interface: 14, document: 15 });
    saveFontSize(first, 'interface', 14, saved);
    expect(readFontSizes(first, saved)).toEqual({ interface: 14, document: 24 });
    expect(JSON.parse(saved.getItem(fontSizesKey(first))!)).toEqual({ interface: 14, document: 24 });
  });
  it('reads the latest saved values when another window changes the other size', () => {
    const saved = storage(), library = crypto.randomUUID();
    saveFontSize(library, 'document', 20, saved);
    saved.setItem(fontSizesKey(library), JSON.stringify({ interface: 19, document: 20 }));
    saveFontSize(library, 'document', 22, saved);
    expect(readFontSizes(library, saved)).toEqual({ interface: 19, document: 22 });
  });
  it('validates each saved field independently and tolerates corrupt storage', () => {
    const saved = storage(), library = crypto.randomUUID();
    for (const value of ['{', 'null', '[]', '"large"']) {
      saved.setItem(fontSizesKey(library), value);
      expect(readFontSizes(library, saved)).toEqual({ interface: 14, document: 15 });
    }
    saved.setItem(fontSizesKey(library), JSON.stringify({ interface: '18', document: 32 }));
    expect(readFontSizes(library, saved)).toEqual({ interface: 14, document: 32 });
    saved.setItem(fontSizesKey(library), JSON.stringify({ interface: 12, document: 99 }));
    expect(readFontSizes(library, saved)).toEqual({ interface: 12, document: 15 });
  });
  it('accepts inclusive bounds and rejects invalid or fractional sizes without changing saved preferences', () => {
    const saved = storage(), library = crypto.randomUUID();
    saveFontSize(library, 'interface', 12, saved);
    saveFontSize(library, 'document', 32, saved);
    for (const value of [11, 21, 14.5, NaN, Infinity]) expect(() => saveFontSize(library, 'interface', value, saved)).toThrow(/字号/);
    for (const value of [11, 33, 15.5, NaN, Infinity]) expect(() => saveFontSize(library, 'document', value, saved)).toThrow(/字号/);
    expect(readFontSizes(library, saved)).toEqual({ interface: 12, document: 32 });
  });
  it('retains both session choices when storage is blocked or a write fails', () => {
    const saved = storage(), library = crypto.randomUUID();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    saveFontSize(library, 'document', 28, saved);
    saveFontSize(library, 'interface', 20, blocked);
    expect(readFontSizes(library, blocked)).toEqual({ interface: 20, document: 28 });
    expect(readFontSizes(library, saved)).toEqual({ interface: 20, document: 28 });
    saveFontSize(library, 'document', 15, blocked);
    expect(readFontSizes(library)).toEqual({ interface: 20, document: 15 });
  });
});
