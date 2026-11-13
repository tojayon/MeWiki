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
    const manuallyEdited = structuredClone(state); manuallyEdited.notes.find(note => note.id === id)!.title = '之前手动变化';
    expect(rebaseAiReviewProposals(manuallyEdited, accepted.state, pending, 'a')).toEqual(pending);
  });

  it('restores rejected suggestions independently from approvals, ignores invalid IDs and stays library-scoped', () => {
    const state = createNotebookFixture(), proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: 'fixture-definition', content: '待拒绝' });
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    writeAiSession({ ...createAiSession('a'), proposals: [proposal], rejectedIds: [proposal.id, proposal.id, 'unknown'] }, storage);
    expect(readAiSession('a', storage).rejectedIds).toEqual([proposal.id]);
    expect(readAiSession('b', storage).rejectedIds ?? []).toEqual([]);
    writeAiSession({ ...createAiSession('a'), proposals: [proposal], appliedIds: [proposal.id], rejectedIds: [proposal.id] }, storage);
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
});
