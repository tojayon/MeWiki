import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiToolContext, executeAiTool } from './tools.ts';

describe('paginated scoped note retrieval', () => {
  function fixture() {
    const state = createNotebookFixture(), seed = state.notes[0];
    state.notes = Array.from({ length: 85 }, (_, index) => ({ ...structuredClone(seed), id: `note-${String(index).padStart(3, '0')}`, title: index === 80 ? '引力' : `示例${index}`, tags: [], blocks: [{ id: `block-${index}`, type: 'paragraph' as const, text: `引力的虚构正文 ${index}` }] }));
    return createAiToolContext(state, 'fixture', state.notes.slice(0, 84).map(note => note.id));
  }
  it('lists every authorized note with stable pages and an exact total', () => {
    const context = fixture();
    const first = executeAiTool(context, 'list_notes', {}) as { items: { id: string }[]; total: number; nextOffset: number };
    expect(first).toMatchObject({ total: 84, offset: 0, limit: 50, nextOffset: 50 });
    const second = executeAiTool(context, 'list_notes', { offset: first.nextOffset }) as typeof first;
    expect(second).toMatchObject({ total: 84, nextOffset: null });
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(84);
  });
  it('ranks titles above body matches and locates results without granting read permission', () => {
    const context = fixture();
    const first = executeAiTool(context, 'search_notes', { query: '引力', limit: 5 }) as { items: { id: string; score: number; matches: { blockId: string; excerpt: string }[] }[] };
    expect(first.items).toHaveLength(5);
    expect(first.items[0]).toMatchObject({ id: 'note-080', matches: [{ blockId: 'block-80', excerpt: expect.stringContaining('引力') }] });
    expect(context.readNoteIds.size).toBe(0);
    const tail = executeAiTool(context, 'search_notes', { query: '引力', offset: 80 }) as { items: unknown[]; total: number; nextOffset: null };
    expect(tail).toMatchObject({ total: 84, nextOffset: null });
    expect(tail.items).toHaveLength(4);
    expect([...context.sourceIds]).not.toContain('note-084');
  });
  it('finds hidden tab and condition content with stable paths and no private payload', () => {
    const context = fixture(), note = context.state.notes[0];
    note.blocks = [{ id: 'tabs', type: 'examples', title: '示例', tabs: [{ id: 't', title: '条件页', blocks: [{ id: 'condition', type: 'paragraph', text: '可定位条件', section: 'given' }] }] }];
    const result = executeAiTool(context, 'search_notes', { query: '可定位条件' });
    expect(result).toMatchObject({ items: [{ id: note.id, matches: [{ blockId: 'condition', path: [{ exampleBlockId: 'tabs', tabId: 't', title: '条件页' }] }] }] });
    const before = context.readCharacters;
    expect(() => executeAiTool(context, 'search_notes', { query: '条件', offset: -1 })).toThrow();
    expect(context.readCharacters).toBe(before);
  });
});
