import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { applyAiProposal, createNoteProposal, undoAiChange } from './proposals.ts';
import { createNativeProposal } from './nativeProposals.ts';
import { previewAiProposal } from './proposals.ts';
import { applyAiProposalGroup } from './proposalGroup.ts';
import { defaultCalloutAppearance } from '../domain/researchCallout.ts';

describe('independent manual and Agent edits', () => {
  const fixture = () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks = [{ id: 'target', type: 'paragraph', text: '原文。' }, { id: 'manual', type: 'paragraph', text: '手动段落。' }];
    return { state, note };
  };
  it('previews, applies and undoes a text edit without losing an independent manual edit', () => {
    const { state, note } = fixture();
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'target', content: 'AI 修改。' });
    const current = structuredClone(state), manual = current.notes.find(item => item.id === note.id)!;
    manual.title = '用户的新标题'; manual.blocks[1] = { id: 'manual', type: 'paragraph', text: '用户已经补充。' };
    expect(() => previewAiProposal(current, proposal, 'a')).not.toThrow();
    const result = applyAiProposal(current, proposal, 'a');
    expect(result.state.notes.find(item => item.id === note.id)).toMatchObject({ title: '用户的新标题', blocks: [{ text: 'AI 修改。' }, { text: '用户已经补充。' }] });
    expect(undoAiChange(result.state, result.change, 'a').notes.find(item => item.id === note.id)).toEqual(manual);
  });
  it('allows independent fields in one block but still rejects the same field', () => {
    const { state, note } = fixture();
    note.blocks[0] = { id: 'target', type: 'callout', text: '原结论。', title: '原标题', appearance: defaultCalloutAppearance };
    const proposal = createNativeProposal(state, 'a', { action: 'block-update', noteId: note.id, blockId: 'target', fields: { text: 'AI 结论。' } });
    const current = structuredClone(state), block = current.notes.find(item => item.id === note.id)!.blocks[0];
    if (block.type !== 'callout') throw new Error('fixture');
    block.title = '用户修改标题';
    const result = applyAiProposal(current, proposal, 'a');
    expect(result.state.notes.find(item => item.id === note.id)!.blocks[0]).toMatchObject({ title: '用户修改标题', text: 'AI 结论。' });
    block.text = '用户修改正文';
    expect(() => applyAiProposal(current, proposal, 'a')).toThrow(/变化|冲突/);
  });
  it('keeps group approval atomic after unrelated manual changes', () => {
    const { state, note } = fixture();
    const proposals = ['target', 'manual'].map(blockId => createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId, content: `AI ${blockId}` }));
    const current = structuredClone(state); current.notes.find(item => item.id === note.id)!.title = '新标题';
    expect(applyAiProposalGroup(current, proposals, 'a').state.notes.find(item => item.id === note.id)).toMatchObject({ title: '新标题', blocks: [{ text: 'AI target' }, { text: 'AI manual' }] });
    current.notes.find(item => item.id === note.id)!.blocks[1] = { id: 'manual', type: 'paragraph', text: '已经变化' };
    const before = JSON.stringify(current);
    expect(() => applyAiProposalGroup(current, proposals, 'a')).toThrow(/变化|冲突/);
    expect(JSON.stringify(current)).toBe(before);
  });
  it('retains manual edits on another tab but rejects a changed container or formula dependency', () => {
    const { state, note } = fixture();
    note.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 'a', title: 'A', blocks: [{ id: 'target', type: 'paragraph', text: '原文。' }] }, { id: 'b', title: 'B', blocks: [] }] }];
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'target', content: 'AI 修改。' });
    const current = structuredClone(state), tabs = current.notes.find(item => item.id === note.id)!.blocks[0];
    if (tabs.type !== 'examples') throw new Error('fixture');
    tabs.tabs[1].blocks.push({ id: 'manual', type: 'paragraph', text: '用户手改另一页' });
    expect(JSON.stringify(applyAiProposal(current, proposal, 'a').state)).toContain('用户手改另一页');
    tabs.tabs[1].blocks.push(tabs.tabs[0].blocks.pop()!);
    expect(() => applyAiProposal(current, proposal, 'a')).toThrow(/变化/);
    note.blocks = [{ id: 'formula', type: 'formula', tex: 'x', parts: [{ type: 'latex', tex: 'x' }] }];
    const formula = createNativeProposal(state, 'a', { action: 'block-update', noteId: note.id, blockId: 'formula', fields: { tex: 'y' } });
    const edited = structuredClone(state), block = edited.notes.find(item => item.id === note.id)!.blocks[0];
    if (block.type !== 'formula') throw new Error('fixture');
    block.parts = [{ type: 'latex', tex: 'z' }];
    expect(() => applyAiProposal(edited, formula, 'a')).toThrow(/变化/);
  });
});
