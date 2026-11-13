import { describe, expect, it } from 'vitest';
import { interfaceFontPreferenceKey, readInterfaceFontPreference, saveInterfaceFontPreference } from './interfaceFonts.ts';

const fontId = 'a'.repeat(64);
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('library interface font preferences', () => {
  it('restores the selected font per stable library and resets to the built-in default', () => {
    const saved = storage();
    const first = crypto.randomUUID(), second = crypto.randomUUID();
    saveInterfaceFontPreference(first, fontId, saved);
    expect(readInterfaceFontPreference(first, saved)).toBe(fontId);
    expect(readInterfaceFontPreference(second, saved)).toBeNull();
    expect(saved.getItem(interfaceFontPreferenceKey(first))).toBe(fontId);
    saveInterfaceFontPreference(first, null, saved);
    expect(readInterfaceFontPreference(first, saved)).toBeNull();
  });
  it('rejects arbitrary font names or CSS in preferences and tolerates corrupt saved values', () => {
    const saved = storage(), library = crypto.randomUUID();
    saved.setItem(interfaceFontPreferenceKey(library), 'url(https://example.com/font.ttf)');
    expect(readInterfaceFontPreference(library, saved)).toBeNull();
    expect(() => saveInterfaceFontPreference(library, 'unsafe;font-family:serif', saved)).toThrow(/字体/);
    expect(() => saveInterfaceFontPreference(library, 'A'.repeat(64), saved)).toThrow(/字体/);
  });
  it('keeps a window-session preference when browser storage is unavailable', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const library = crypto.randomUUID();
    expect(readInterfaceFontPreference(library, blocked)).toBeNull();
    saveInterfaceFontPreference(library, fontId, blocked);
    expect(readInterfaceFontPreference(library, blocked)).toBe(fontId);
    saveInterfaceFontPreference(library, null, blocked);
    expect(readInterfaceFontPreference(library, blocked)).toBeNull();
  });
});
