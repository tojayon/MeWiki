import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from 'vitest';
import { createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown, type ResearchNotebookBlock } from './researchNotebook.ts';
import { createResearchLibraryFile, parseResearchLibraryFile } from '../state/researchLibraryFile.ts';
import { buildResearchNoteBacklinks } from './researchNoteLinks.ts';
import { expandNoteEmbedBlocks, normalizeNoteEmbed, noteEmbedSelectionError, orderedNoteEmbedIds, resolveNoteEmbed, type ResearchNoteEmbedBlock } from './researchNoteEmbed.ts';

const reference = { id: 'embed-a', type: 'noteEmbed', sourceNoteId: 'note-b', blockIds: ['b-text', 'b-formula'], sourceTitle: '来源 B' } as unknown as ResearchNotebookBlock;
function fixture() {
  const a = { ...createResearchNote('笔记 A'), id: 'note-a', blocks: [reference] };
  const b = { ...createResearchNote('来源 B'), id: 'note-b', blocks: [
    { id: 'b-text', type: 'paragraph', text: '始终从 B 读取的内容' },
    { id: 'b-formula', type: 'formula', tex: 'x+y=z', caption: '来源公式' },
  ] as ResearchNotebookBlock[] };
  const state = { ...createResearchNotebook(), notes: [a, b], activeNoteId: a.id, view: 'notes' as const };
  return { a, b, state };
}
describe('live note content reference persistence', () => {
  it('preserves stable references when normalizing existing notebooks', () => {
    const { state } = fixture();
    const loaded = normalizeResearchNotebook(state);
    expect(loaded.notes.find(note => note.id === 'note-a')!.blocks).toEqual([reference]);
  });
  it('round trips references in complete backups without copying the source content', async () => {
    const { state } = fixture();
    const file = await createResearchLibraryFile(state);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook.notes[0].blocks).toEqual([reference]);
    expect(JSON.stringify(restored.notebook.notes[0])).not.toContain('始终从 B 读取的内容');
  });
  it('exports readable latest content and retains reference metadata through Markdown import', () => {
    const { state, a, b } = fixture();
    b.blocks[0] = { ...b.blocks[0], type: 'paragraph', text: 'B 中更新后的正文' };
    const markdown = serializeResearchMarkdown(a, state.symbols, state.notes);
    expect(markdown).toContain('B 中更新后的正文');
    expect(markdown).toContain('x+y=z');
    expect(parseResearchMarkdown(markdown).blocks).toEqual([reference]);
  });
  it('shows embedding notes in the source note backlinks', () => {
    const { state } = fixture();
    expect(buildResearchNoteBacklinks(state.notes, 'note-b')).toEqual([
      expect.objectContaining({ noteId: 'note-a', blockId: 'embed-a' }),
    ]);
  });
  it('keeps references to other blocks in the same note attached to the imported copy', () => {
    const { state, b } = fixture();
    b.blocks.push({ id: 'self-ref', type: 'noteEmbed', sourceNoteId: b.id, blockIds: ['b-text'] });
    const imported = parseResearchMarkdown(serializeResearchMarkdown(b, state.symbols, [b]));
    const ref = imported.blocks.at(-1) as ResearchNoteEmbedBlock;
    expect(ref.sourceNoteId).toBe(imported.id);
    expect(resolveNoteEmbed([imported], ref).items[0].block).toMatchObject({ id: 'b-text' });
  });
});

describe('live content resolution and safety', () => {
  it('resolves the current block after edits, insertions and moves by identity', () => {
    const { state, b } = fixture();
    const ref = reference as ResearchNoteEmbedBlock;
    b.blocks = [b.blocks[1], { id: 'new', type: 'paragraph', text: '新插入' }, { id: 'b-text', type: 'paragraph', text: '已修改' }];
    expect(resolveNoteEmbed(state.notes, ref).items.map(item => item.id)).toEqual(['b-formula', 'b-text']);
    expect(resolveNoteEmbed(state.notes, ref).items.at(-1)!.block).toMatchObject({ text: '已修改' });
  });
  it('keeps missing references explicit instead of matching similar text or names', () => {
    const { state, b } = fixture();
    b.blocks = [{ id: 'replacement', type: 'paragraph', text: '始终从 B 读取的内容' }];
    expect(resolveNoteEmbed(state.notes, reference as ResearchNoteEmbedBlock).items).toEqual([{ id: 'b-text', block: undefined }, { id: 'b-formula', block: undefined }]);
    expect(resolveNoteEmbed([], reference as ResearchNoteEmbedBlock).note).toBeUndefined();
  });
  it('includes a selected nested child without duplicating it when its tab group is selected', () => {
    const { b } = fixture();
    b.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 't', title: '细节', blocks: b.blocks }] }];
    expect(orderedNoteEmbedIds(b, ['b-text'])).toEqual(['b-text']);
    expect(orderedNoteEmbedIds(b, ['b-text', 'tabs'])).toEqual(['tabs']);
  });
  it('rejects indirect cycles and self-containing tab selections', () => {
    const { state, a, b } = fixture();
    b.blocks.push({ id: 'reverse', type: 'noteEmbed', sourceNoteId: a.id, blockIds: ['embed-a'] });
    expect(noteEmbedSelectionError(state.notes, { noteId: a.id, blockId: 'embed-a' }, { sourceNoteId: b.id, blockIds: ['reverse'] })).toContain('循环');
    a.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 't', title: 'T', blocks: [reference] }] }];
    expect(noteEmbedSelectionError(state.notes, { noteId: a.id, blockId: 'embed-a' }, { sourceNoteId: a.id, blockIds: ['tabs'] })).toContain('循环');
  });
  it('limits large repeated expansion and excessive reference depth', () => {
    const { state } = fixture();
    const b = state.notes[1];
    for (let index = 0; index < 10; index++) b.blocks.push({ id: `e${index}`, type: 'noteEmbed', sourceNoteId: b.id, blockIds: index ? [`e${index - 1}`] : ['b-text'] });
    expect(noteEmbedSelectionError(state.notes, { noteId: 'note-a', blockId: 'new' }, { sourceNoteId: b.id, blockIds: ['e9'] })).toContain('层数');
    expect(() => serializeResearchMarkdown(state.notes[0], state.symbols, state.notes)).not.toThrow();
  });
  it('validates reference fields and expands only chosen resources', () => {
    const { state, a } = fixture();
    expect(() => normalizeNoteEmbed({ ...reference, blockIds: [] })).toThrow();
    expect(() => normalizeNoteEmbed({ ...reference, sourceNoteId: '' })).toThrow();
    expect(normalizeNoteEmbed({ ...reference, blockIds: ['b-text', 'b-text'] }).blockIds).toEqual(['b-text']);
    expect(expandNoteEmbedBlocks(state.notes, a.blocks, a.id).map(item => item.id)).toEqual(['b-text', 'b-formula']);
  });
});
