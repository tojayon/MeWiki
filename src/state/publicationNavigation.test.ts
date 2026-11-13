import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { readPublicationTab, withPublicationPdfPages, type PublicationTabSnapshot } from './publicationNavigation.ts';

const id = 'ae21e75b-1db7-4945-a341-a1a9286c351b';
const url = (library = 'library-a') => new URL(`http://127.0.0.1:5280/?publication=${id}&library=${library}`);
const fixture = (): PublicationTabSnapshot => {
  const snapshot = createNotebookFixture();
  return { version: 1, libraryId: 'library-a', directory: null, pluginId: 'org.mewiki.social-export', pluginVersion: '1.1.0', exporterId: 'image', snapshot, noteId: snapshot.activeNoteId, selectedTabs: { tabs: 'second' } };
};

describe('export tab snapshots', () => {
  it('freezes temporary PDF pages without changing saved blocks or another note', () => {
    const state = createNotebookFixture();
    const note = state.notes[0];
    note.blocks = [{ id: 'pdf', type: 'media', kind: 'pdf', document: { page: 1 } }, { id: 'text', type: 'paragraph', text: '不修改正文' }];
    const original = structuredClone(state);
    const snapshot = withPublicationPdfPages(state, note.id, { pdf: 2, text: 4 });
    expect(snapshot.notes[0].blocks[0]).toMatchObject({ document: { page: 2 } });
    expect(snapshot.notes[0].blocks[1]).toEqual(note.blocks[1]);
    expect(state).toEqual(original);
    expect(withPublicationPdfPages(state, note.id, { pdf: -1 })).toEqual(state);
    if (state.notes[1]) expect(snapshot.notes[1]).toBe(state.notes[1]);
  });
  it('reads the original snapshot without adopting a different active note', () => {
    const value = fixture();
    const serialized = JSON.stringify(value);
    const storage = { getItem: (key: string) => key === `mewiki:publication:${id}` ? serialized : null };
    const first = readPublicationTab(url(), storage);
    first.snapshot.notes[0].title = 'later edit';
    expect(readPublicationTab(url(), storage)).toEqual(value);
    expect(readPublicationTab(url(), storage).selectedTabs).toEqual({ tabs: 'second' });
  });

  it('rejects a copied URL, a changed library and an invalid notebook', () => {
    const value = fixture();
    expect(() => readPublicationTab(url(), { getItem: () => null })).toThrow('导出内容已失效');
    expect(() => readPublicationTab(url('library-b'), { getItem: () => JSON.stringify(value) })).toThrow('导出内容已失效');
    expect(() => readPublicationTab(url(), { getItem: () => JSON.stringify({ ...value, snapshot: {} }) })).toThrow('导出内容已失效');
    expect(() => readPublicationTab(url(), { getItem: () => JSON.stringify({ ...value, noteId: 'missing-note' }) })).toThrow('导出内容已失效');
    expect(() => readPublicationTab(url(), { getItem: () => JSON.stringify({ ...value, selectedTabs: ['second'] }) })).toThrow('导出内容已失效');
  });
});
