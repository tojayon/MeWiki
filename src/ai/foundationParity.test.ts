import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { defaultCalloutAppearance } from '../domain/researchCallout.ts';
import { createAiTextSelection } from './textSelection.ts';
import { buildAiSystemPrompt, createAiToolContext, executeAiTool } from './tools.ts';
import { applyAiProposal, undoAiChange } from './proposals.ts';
import { createAiDraft } from './drafts.ts';

function fixture(library: 'foundation' | 'research') {
  const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
  note.library = library; state.view = library === 'foundation' ? 'foundations' : 'notes'; state.activeNoteId = note.id;
  note.blocks = [
    { id: 'given-list', type: 'list', section: 'given', items: ['修改这条条件', '保留另一条条件'] },
    { id: 'conclusion-callout', type: 'callout', section: 'conclusion', title: '结论', text: '修改这段结论', appearance: { ...defaultCalloutAppearance } },
  ];
  return { state, note };
}

describe.each(['foundation', 'research'] as const)('%s AI selection parity', library => {
  it('reads selected condition lists and proposes only their items, preserving the section, IDs and library', () => {
    const { state, note } = fixture(library), original = structuredClone(state);
    const selection = createAiTextSelection(state, 'a', note.id, ['given-list'], '修改这条条件');
    const ctx = createAiToolContext(state, 'a', state.notes.map(note => note.id), selection);
    const args = { action: 'block-update', noteId: note.id, blockId: 'given-list', fields: { items: ['经确认的条件', '保留另一条条件'] } };
    expect(() => executeAiTool(ctx, 'read_note', { noteId: 'fixture-summary' })).toThrow(/范围/);
    expect(() => executeAiTool(ctx, 'propose_edit', args)).toThrow(/读取/);
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'given-list' });
    expect(() => executeAiTool(ctx, 'propose_edit', { ...args, fields: { section: 'conclusion' } })).toThrow(/选区/);
    expect(() => executeAiTool(ctx, 'propose_edit', { ...args, blockId: 'conclusion-callout', fields: { text: '越界' } })).toThrow(/选区/);
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'given-list', content: '不能改成段落' })).toThrow();
    executeAiTool(ctx, 'propose_edit', args);
    expect(state).toEqual(original); expect(ctx.state).toEqual(original);
    const { state: applied, change } = applyAiProposal(state, ctx.proposals[0], 'a');
    expect(applied.notes.find(item => item.id === note.id)!.blocks[0]).toEqual({ ...note.blocks[0], items: args.fields.items });
    expect(applied.view).toBe(state.view); expect(applied.notes.find(item => item.id === note.id)!.library).toBe(library);
    expect(undoAiChange(applied, change, 'a').notes.find(item => item.id === note.id)).toEqual(note);
  });
  it('keeps conclusion callout text and streamed drafts within the same selected-field boundary', () => {
    const { state, note } = fixture(library);
    const selection = createAiTextSelection(state, 'a', note.id, ['conclusion-callout'], '修改这段结论');
    const ctx = createAiToolContext(state, 'a', [note.id], selection);
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'conclusion-callout' });
    const args = { action: 'block-update', noteId: note.id, blockId: 'conclusion-callout', fields: { text: '更准确的结论' } };
    expect(createAiDraft(ctx, { name: 'propose_edit', arguments: JSON.stringify(args) }, 'live')).not.toBeNull();
    expect(createAiDraft(ctx, { name: 'propose_edit', arguments: JSON.stringify({ ...args, fields: { title: '不允许改变标签' } }) }, 'bad')).toBeNull();
    expect(() => executeAiTool(ctx, 'propose_edit', { ...args, fields: { text: '新结论', appearance: defaultCalloutAppearance } })).toThrow(/选区/);
    executeAiTool(ctx, 'propose_edit', args);
    const { state: applied, change } = applyAiProposal(state, ctx.proposals[0], 'a');
    expect(applied.notes.find(item => item.id === note.id)!.blocks[1]).toEqual({ ...note.blocks[1], text: args.fields.text });
    expect(undoAiChange(applied, change, 'a').notes.find(item => item.id === note.id)).toEqual(note);
    expect(buildAiSystemPrompt(ctx)).toContain('items');
  });
  it('reads current-note and library scopes and reviews native formula changes equally', () => {
    const { state, note } = fixture(library);
    note.blocks.push({ id: 'conclusion-formula', type: 'formula', section: 'conclusion', tex: 'x = 1', conditions: 'x 为实数' });
    const current = createAiToolContext(state, 'a', [note.id]);
    expect(executeAiTool(current, 'list_notes', {})).toMatchObject({ items: [{ id: note.id }] });
    expect(executeAiTool(current, 'search_notes', { query: '修改这条条件' })).toMatchObject({ items: [{ id: note.id }] });
    expect(executeAiTool(current, 'read_note', { noteId: note.id })).toMatchObject({ metadata: { library }, markdown: expect.stringContaining('x = 1') });
    expect(() => executeAiTool(current, 'read_note', { noteId: 'fixture-summary' })).toThrow(/范围/);
    const wholeLibrary = createAiToolContext(state, 'a', state.notes.map(item => item.id));
    for (const noteId of [note.id, 'fixture-summary']) expect(executeAiTool(wholeLibrary, 'read_note', { noteId })).toMatchObject({ id: noteId });
    expect(executeAiTool(current, 'read_block', { noteId: note.id, blockId: 'conclusion-formula' })).toMatchObject({ fields: { section: 'conclusion', tex: 'x = 1', conditions: 'x 为实数' } });
    executeAiTool(current, 'propose_edit', { action: 'block-update', noteId: note.id, blockId: 'conclusion-formula', fields: { tex: 'x = 2' } });
    const { state: applied, change } = applyAiProposal(state, current.proposals[0], 'a');
    expect(applied.notes.find(item => item.id === note.id)!.blocks.at(-1)).toEqual({ ...note.blocks.at(-1), tex: 'x = 2' });
    expect(applied.view).toBe(state.view);
    expect(applied.notes.find(item => item.id === note.id)!.library).toBe(library);
    expect(undoAiChange(applied, change, 'a').notes.find(item => item.id === note.id)).toEqual(note);
  });
});
