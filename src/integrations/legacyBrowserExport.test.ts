import { describe, expect, it } from 'vitest';
import { readLegacyNotebook } from './legacyBrowserExport.ts';
import { createMeWikiNotebook } from '../domain/meWikiWorkspace.ts';
describe('read-only legacy browser export', () => {
  it('reads and normalizes old browser notes without changing or replacing them', () => {
    const notebook = createMeWikiNotebook(); const raw = JSON.stringify(notebook); let reads = 0;
    const storage = { getItem(key: string) { reads++; return key === 'cislunar:research-notebook' ? raw : null; } };
    expect(readLegacyNotebook(storage)).toEqual(notebook); expect(reads).toBe(1);
  });
  it('does not invent initial research notes when no old data exists', () => {
    expect(() => readLegacyNotebook({ getItem: () => null })).toThrow(/没有/);
    expect(() => readLegacyNotebook({ getItem: () => '{bad' })).toThrow();
    expect(() => readLegacyNotebook({ getItem: () => JSON.stringify({ version: 99, notes: [] }) })).toThrow(/格式/);
  });
});
