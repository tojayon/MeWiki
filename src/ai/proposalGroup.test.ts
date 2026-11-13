import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createNoteProposal, undoAiChange } from './proposals.ts';
import { createNativeProposal } from './nativeProposals.ts';
import { applyAiProposalGroup } from './proposalGroup.ts';
import { createAiSession, readAiSession, writeAiSession } from './session.ts';

describe('one-note proposal composition', () => {
  it('combines legacy text and native edits on different tabs without changing the source', () => {
    const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.blocks = [{ id: 'tabs', type: 'examples', tabs: [
      { id: 'a', title: '第一页', blocks: [{ id: 'one', type: 'paragraph', text: '原文一' }] },
      { id: 'b', title: '第二页', blocks: [{ id: 'two', type: 'paragraph', text: '原文二' }] },
    ] }];
    const saved = structuredClone(state);
    const proposals = [createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'one', content: '新文一' }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: note.id, blockId: 'two', fields: { text: '新文二' } })];
    const result = applyAiProposalGroup(state, proposals, 'a');
    expect(JSON.stringify(result.state.notes.find(item => item.id === note.id))).toContain('新文一');
    expect(JSON.stringify(result.state.notes.find(item => item.id === note.id))).toContain('新文二');
    expect(result.changes).toHaveLength(2);
    expect(result.mergedIds).toEqual([]);
    expect(state).toEqual(saved);
    const cache = new Map<string, string>();
    const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value); } };
    writeAiSession({ ...createAiSession('a'), proposals, appliedIds: proposals.map(item => item.id), changes: result.changes }, storage);
    expect(readAiSession('a', storage).changes).toEqual(result.changes);
    let restored = result.state;
    for (const change of result.changes.toReversed()) restored = undoAiChange(restored, change, 'a');
    expect(restored.notes).toEqual(state.notes);
  });

  it('keeps the final text once while combining another field on the same block', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    state.notes.find(note => note.id === id)!.blocks = [{ id: 'head', type: 'heading', level: 2, text: '旧标题' }];
    const proposals = [createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: 'head', content: '新标题' }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: 'head', fields: { level: 3 } }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: 'head', fields: { text: '新标题' } })];
    const result = applyAiProposalGroup(state, proposals, 'a');
    expect(result.state.notes.find(note => note.id === id)!.blocks).toEqual([{ id: 'head', type: 'heading', level: 3, text: '新标题' }]);
    expect(result.changes).toHaveLength(2);
    expect(result.mergedIds).toEqual([proposals[2].id]);
    const store = { getItem: () => JSON.stringify({ ...createAiSession('a'), proposals, changes: result.changes,
      appliedIds: proposals.map(item => item.id), mergedIds: result.mergedIds }) };
    expect(readAiSession('a', store).mergedIds).toEqual([proposals[2].id]);
  });

  it('preflights every proposal and refuses to overwrite a later manual edit', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    const proposals = [createNoteProposal(state, 'a', { operation: 'append', noteId: id, content: '新增内容' }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: `${id}:text`, fields: { text: '改写内容' } })];
    state.notes.find(note => note.id === id)!.blocks[0] = { id: `${id}:text`, type: 'paragraph', text: '用户手工修改' };
    const saved = structuredClone(state);
    expect(() => applyAiProposalGroup(state, proposals, 'a')).toThrow(/变化/);
    expect(state).toEqual(saved);
  });

  it('does not return partial results for incompatible delete and update operations', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    const proposals = [createNoteProposal(state, 'a', { operation: 'delete-text', noteId: id, blockId: `${id}:text`, content: '' }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: `${id}:text`, fields: { text: '随后修改' } })];
    const saved = structuredClone(state);
    expect(() => applyAiProposalGroup(state, proposals, 'a')).toThrow();
    expect(state).toEqual(saved);
    expect(() => applyAiProposalGroup(state, proposals, 'other')).toThrow(/资料库/);
  });
});
