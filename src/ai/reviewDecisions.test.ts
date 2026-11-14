import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createNoteProposal, applyAiProposal, undoAiChange } from './proposals.ts';
import { createNativeProposal } from './nativeProposals.ts';
import { reviseAiProposal, rebaseAiReviewProposals, aiReviewLocation } from './reviewDecisions.ts';
import { applyAiProposalGroup } from './proposalGroup.ts';
import { createAiSession, readAiSession, writeAiSession } from './session.ts';

describe('inline AI review decisions', () => {
  it('adjusts pending text while retaining identity and the captured original, then safely applies and undoes it', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: `${id}:text`, content: 'AI 的建议。' });
    const original = structuredClone(proposal), source = structuredClone(state);
    const adjusted = reviseAiProposal(state, proposal, { content: '**用户进一步修改**。' }, 'a');
    expect(adjusted).toMatchObject({ id: proposal.id, targetId: id, before: proposal.before, content: '**用户进一步修改**。' });
    expect(proposal).toEqual(original); expect(state).toEqual(source);
    const accepted = applyAiProposalGroup(state, [adjusted], 'a');
    expect(JSON.stringify(accepted.state.notes.find(note => note.id === id))).toContain('用户进一步修改');
    expect(undoAiChange(accepted.state, accepted.changes[0], 'a').notes).toEqual(state.notes);
    state.notes.find(note => note.id === id)!.title = '批准前的手动变化';
    expect(() => reviseAiProposal(state, proposal, { content: '允许调整。' }, 'a')).not.toThrow();
    state.notes.find(note => note.id === id)!.blocks[0] = { id: `${id}:text`, type: 'paragraph', text: '同字段的手动变化' };
    expect(() => reviseAiProposal(state, proposal, { content: '不能覆盖。' }, 'a')).toThrow(/变化/);
    expect(() => reviseAiProposal(source, proposal, { content: '跨库。' }, 'b')).toThrow(/资料库/);
  });

  it('adjusts native fields and inserted content without replacing their frozen IDs or widening the operation', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    const proposal = createNativeProposal(state, 'a', { action: 'block-insert', noteId: id, blockType: 'paragraph', fields: { text: 'AI 新段落' } });
    const adjusted = reviseAiProposal(state, proposal, { fields: { text: '调整的新段落' } }, 'a');
    expect(adjusted.kind).toBe('native');
    if (adjusted.kind !== 'native') throw new Error('Expected native proposal');
    expect(adjusted.edit).toMatchObject({ generatedId: proposal.edit.generatedId, generatedAt: proposal.edit.generatedAt, block: { id: proposal.edit.generatedId, text: '调整的新段落' } });
    expect(() => reviseAiProposal(state, proposal, { fields: { privatePayload: 'forbidden' } }, 'a')).toThrow(/字段/);
    expect(aiReviewLocation(adjusted)).toEqual({ kind: 'block', blockId: proposal.edit.generatedId });
  });

  it('keeps independent pending changes reviewable after a single approval without rebasing overlapping text or later manual edits', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    state.notes.find(note => note.id === id)!.blocks = [{ id: 'head', type: 'heading', level: 2, text: '旧标题' },
      { id: 'tabs', type: 'examples', tabs: [{ id: 'a', title: '第一页', blocks: [] }, { id: 'b', title: '第二页', blocks: [] }] }];
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: 'head', content: '同意的标题' });
    const pending = [createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: 'head', fields: { level: 3 } }),
      createNativeProposal(state, 'a', { action: 'tab-delete', noteId: id, blockId: 'tabs', tabId: 'b' }),
      createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: 'head', content: '重叠改写' })];
    const accepted = applyAiProposalGroup(state, [first], 'a');
    const rebased = rebaseAiReviewProposals(state, accepted.state, pending, 'a');
    expect(() => applyAiProposalGroup(accepted.state, rebased.slice(0, 2), 'a', accepted.changes)).not.toThrow();
    expect(() => applyAiProposal(accepted.state, rebased[2], 'a', accepted.changes)).toThrow(/变化/);
    const manuallyEdited = structuredClone(state); manuallyEdited.notes.find(note => note.id === id)!.blocks = [];
    expect(rebaseAiReviewProposals(manuallyEdited, accepted.state, pending, 'a')).toEqual(pending);
  });

  it('restores rejected suggestions independently from approvals, ignores invalid IDs and stays library-scoped', () => {
    const state = createNotebookFixture(), proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: 'fixture-definition', content: '待拒绝' });
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    writeAiSession({ ...createAiSession('a'), proposals: [proposal], rejectedIds: [proposal.id, proposal.id, 'unknown'] }, storage);
    expect(readAiSession('a', storage).rejectedIds).toEqual([proposal.id]);
    expect(readAiSession('b', storage).rejectedIds ?? []).toEqual([]);
    writeAiSession({ ...createAiSession('a'), proposals: [proposal], appliedIds: [proposal.id], rejectedIds: [proposal.id] }, storage);
    expect(readAiSession('a', storage).rejectedIds).toEqual([proposal.id]);
    const approved = applyAiProposalGroup(state, [proposal], 'a');
    writeAiSession({ ...createAiSession('a'), proposals: [proposal], appliedIds: [proposal.id], rejectedIds: [proposal.id], changes: approved.changes }, storage);
    expect(readAiSession('a', storage).rejectedIds).toEqual([]);
  });

  it('keeps rebased pending proposals valid across refresh and undo without changing approved baselines', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: `${id}:text`, content: '已批准的正文' });
    const second = createNativeProposal(state, 'a', { action: 'note-update', noteId: id, fields: { title: '接着审阅的标题' } });
    const approved = applyAiProposalGroup(state, [first], 'a');
    const [rebased] = rebaseAiReviewProposals(state, approved.state, [second], 'a');
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    writeAiSession({ ...createAiSession('a'), proposals: [first, rebased], appliedIds: [first.id], changes: approved.changes }, storage);
    const restored = readAiSession('a', storage);
    expect(restored.proposals).toHaveLength(2);
    expect(restored.proposals[0].before).toEqual(first.before);
    const undone = undoAiChange(approved.state, restored.changes[0], 'a');
    const [afterUndo] = rebaseAiReviewProposals(approved.state, undone, [restored.proposals[1]], 'a', approved.changes);
    expect(applyAiProposal(undone, afterUndo, 'a').state.notes.find(note => note.id === id)?.title).toBe('接着审阅的标题');
  });

  it('does not rebase overlapping custom metadata or revive a suggestion whose block was deleted', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    state.notes.find(note => note.id === id)!.frontmatter = { source: 'original' };
    const first = createNativeProposal(state, 'a', { action: 'note-update', noteId: id, fields: { frontmatter: { source: 'accepted' } } });
    const pending = createNativeProposal(state, 'a', { action: 'note-update', noteId: id, fields: { frontmatter: { source: 'pending' } } });
    const accepted = applyAiProposalGroup(state, [first], 'a');
    expect(rebaseAiReviewProposals(state, accepted.state, [pending], 'a')[0]).toBe(pending);
    expect(() => applyAiProposal(accepted.state, pending, 'a', accepted.changes)).toThrow(/变化/);
    const deletion = createNativeProposal(state, 'a', { action: 'block-delete', noteId: id, blockId: `${id}:text` });
    const replace = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: `${id}:text`, content: '目标已删' });
    const removed = applyAiProposalGroup(state, [deletion], 'a');
    expect(rebaseAiReviewProposals(state, removed.state, [replace], 'a')[0]).toBe(replace);
    expect(() => applyAiProposal(removed.state, replace, 'a', removed.changes)).toThrow();
  });

  it('keeps a moved selection and implicit formula dependencies conflicted after another approval', () => {
    const state = createNotebookFixture(), id = 'fixture-definition', note = state.notes.find(note => note.id === id)!;
    note.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 'a', title: 'A', blocks: [{ id: 'inside', type: 'paragraph', text: '原文' }] }, { id: 'b', title: 'B', blocks: [] }] },
      { id: 'formula', type: 'formula', tex: 'x', parts: [{ type: 'latex', tex: 'x' }] }];
    const pending = [createNoteProposal(state, 'a', { operation: 'replace-text', noteId: id, blockId: 'inside', content: '修改' }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: 'inside', fields: { text: '原生修改' } }),
      createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: 'formula', fields: { tex: 'y' } })];
    const movement = createNativeProposal(state, 'a', { action: 'block-move', noteId: id, blockId: 'inside', container: { exampleBlockId: 'tabs', tabId: 'b' } });
    const formulaParts = createNativeProposal(state, 'a', { action: 'block-update', noteId: id, blockId: 'formula', fields: { parts: [{ type: 'latex', tex: 'z' }] } });
    const accepted = applyAiProposalGroup(state, [movement, formulaParts], 'a');
    const rebased = rebaseAiReviewProposals(state, accepted.state, pending, 'a');
    for (let index = 0; index < pending.length; index++) {
      expect(() => applyAiProposal(accepted.state, rebased[index], 'a', accepted.changes)).toThrow(/变化/);
      expect(rebased[index]).toBe(pending[index]);
    }
  });
  it('keeps a nested insertion reviewable after approving only the tab title', () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    state.notes.find(note => note.id === id)!.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 'a', title: '原标题', blocks: [{ id: 'inside', type: 'paragraph', text: '保留原文' }] }] }];
    const rename = createNativeProposal(state, 'a', { action: 'tab-update', noteId: id, blockId: 'tabs', tabId: 'a', title: '新标题' });
    const insert = createNativeProposal(state, 'a', { action: 'block-insert', noteId: id, container: { exampleBlockId: 'tabs', tabId: 'a' }, blockType: 'paragraph', fields: { text: '新段落' } });
    const approved = applyAiProposalGroup(state, [rename], 'a');
    const [rebased] = rebaseAiReviewProposals(state, approved.state, [insert], 'a');
    expect(() => reviseAiProposal(approved.state, rebased, { fields: { text: '调整后新段落' } }, 'a', approved.changes)).not.toThrow();
    const changedStructure = structuredClone(approved.state), tabs = changedStructure.notes.find(note => note.id === id)!.blocks[0];
    if (tabs.type !== 'examples') throw new Error('fixture');
    tabs.tabs[0].blocks = [];
    expect(() => applyAiProposal(changedStructure, insert, 'a')).toThrow(/变化/);
  });
});
