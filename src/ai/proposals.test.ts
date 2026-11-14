import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { applyAiProposal, createNoteProposal, createTermProposal, previewAiProposal, undoAiChange } from './proposals.ts';
import { createNativeProposal } from './nativeProposals.ts';

describe('AI review transactions', () => {
  it('previews the same content as applying without changing the notebook, including unknown blocks', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks.push({ id: 'keep', type: 'external', provider: 'unknown', contentType: 'record', schemaVersion: 99, title: '保留', summary: '摘要', data: { private: true } });
    const before = structuredClone(state);
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: note.blocks[0].id, content: '更明确的定义。' });
    const preview = previewAiProposal(state, proposal, 'a');
    expect(preview.target).toBe('note');
    expect(preview.before).toEqual(note);
    const applied = applyAiProposal(state, proposal, 'a').state.notes.find(item => item.id === note.id)!;
    expect(preview.after).toEqual({ ...applied, updatedAt: preview.target === 'note' ? preview.after.updatedAt : undefined });
    expect(state).toEqual(before);
    const changed = structuredClone(state); changed.notes.find(item => item.id === note.id)!.title = '手工改过';
    expect(previewAiProposal(changed, proposal, 'a').before).toMatchObject({ title: '手工改过' });
    expect(() => previewAiProposal(state, proposal, 'b')).toThrow(/资料库/);
  });

  it('previews appended native blocks and new notes without adding them to the source', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(item => item.id === 'fixture-definition')!;
    const proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: note.id, content: '## 新标题\n\n新段落' });
    const preview = previewAiProposal(state, proposal, 'a');
    expect(preview.target === 'note' && preview.after.blocks.slice(note.blocks.length)).toMatchObject([{ type: 'heading', text: '新标题' }, { type: 'paragraph', text: '新段落' }]);
    expect(note.blocks).toHaveLength(1);
    const created = createNoteProposal(state, 'a', { operation: 'create', title: '新笔记', content: '新建正文' });
    expect(previewAiProposal(state, created, 'a')).toMatchObject({ target: 'note', before: null, after: { id: created.targetId, title: '新笔记' } });
    expect(state.notes.some(item => item.id === created.targetId)).toBe(false);
  });

  it('deletes only an explicitly selected text block, including nested text, and safely restores it', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks.push({ id: 'examples', type: 'examples', title: '例子', tabs: [{ id: 'tab', title: '标签页', blocks: [{ id: 'nested', type: 'paragraph', text: '过时的内容' }, { id: 'formula', type: 'formula', tex: 'x=1' }] }] });
    const proposal = createNoteProposal(state, 'a', { operation: 'delete-text', noteId: note.id, blockId: 'nested', content: '' });
    const preview = previewAiProposal(state, proposal, 'a');
    const applied = applyAiProposal(state, proposal, 'a');
    expect(preview.target === 'note' && preview.after.blocks).toEqual(applied.state.notes.find(item => item.id === note.id)!.blocks);
    expect(JSON.stringify(preview.after)).not.toContain('过时的内容');
    expect(JSON.stringify(preview.after)).toContain('x=1');
    expect(undoAiChange(applied.state, applied.change, 'a').notes.find(item => item.id === note.id)!.blocks).toEqual(note.blocks);
    expect(() => createNoteProposal(state, 'a', { operation: 'delete-text', noteId: note.id, blockId: 'formula', content: '' })).toThrow(/文字/);
    expect(() => createNoteProposal(state, 'a', { operation: 'delete-text', noteId: note.id, blockId: 'examples', content: '' })).toThrow(/文字/);
  });

  it('uses the current approved context in preview while rejecting intervening manual edits', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks.push({ id: 'next', type: 'paragraph', text: '待删除' });
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: note.blocks[0].id, content: '已应用的新定义' });
    const second = createNoteProposal(state, 'a', { operation: 'delete-text', noteId: note.id, blockId: 'next', content: '' });
    const applied = applyAiProposal(state, first, 'a');
    const preview = previewAiProposal(applied.state, second, 'a', [applied.change]);
    expect(preview.before).toEqual(applied.state.notes.find(item => item.id === note.id));
    expect(JSON.stringify(preview.after)).toContain('已应用的新定义');
    const changed = structuredClone(applied.state); changed.notes.find(item => item.id === note.id)!.blocks[1] = { id: 'next', type: 'paragraph', text: '用户修改' };
    expect(() => previewAiProposal(changed, second, 'a', [applied.change])).toThrow(/已变化/);
  });
  it('preserves unknown blocks and stable IDs while replacing an explicitly selected text block', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks.push({ id: 'unknown-plugin', type: 'external', provider: 'unknown', contentType: 'record', schemaVersion: 99, title: '保留', summary: '原始资料', data: { keep: [1, 2, 3] } });
    const proposal = createNoteProposal(state, 'library-a', { operation: 'replace-text', noteId: note.id, blockId: note.blocks[0].id, content: '经过审阅的新定义。', title: note.title });
    expect(note.blocks[0]).toMatchObject({ text: '通用内容。' });
    const { state: next, change } = applyAiProposal(state, proposal, 'library-a');
    expect(next.notes.find(item => item.id === note.id)!.blocks[0]).toMatchObject({ id: note.blocks[0].id, text: '经过审阅的新定义。' });
    expect(next.notes.find(item => item.id === note.id)!.blocks[1]).toEqual(note.blocks[1]);
    expect(undoAiChange(next, change, 'library-a').notes.find(item => item.id === note.id)!.blocks).toEqual(note.blocks);
  });

  it('rejects another library, changed baselines and overwriting a later edit on undo', () => {
    const state = createNotebookFixture();
    const note = state.notes[0];
    const proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: note.id, content: '补充内容。', title: note.title });
    expect(() => applyAiProposal(state, proposal, 'b')).toThrow(/资料库/);
    const changed = structuredClone(state); changed.notes[0].title = '用户刚修改的标题';
    expect(() => applyAiProposal(changed, proposal, 'a')).not.toThrow();
    changed.notes[0].blocks.push({ id: 'manual-tail', type: 'paragraph', text: '用户改变了追加位置' });
    expect(() => applyAiProposal(changed, proposal, 'a')).toThrow(/已变化/);
    const applied = applyAiProposal(state, proposal, 'a');
    const later = structuredClone(applied.state); later.notes[0].title = '应用之后的编辑';
    expect(() => undoAiChange(later, applied.change, 'a')).toThrow(/已变化/);
  });

  it('creates native Markdown blocks and undo preserves edits to unrelated notes', () => {
    const state = createNotebookFixture();
    const proposal = createNoteProposal(state, 'a', { operation: 'create', title: '阶段综述', content: '# 摘要\n\n带有[原始定义](#research-note/fixture-definition)的内容。' });
    const applied = applyAiProposal(state, proposal, 'a');
    const note = applied.state.notes.find(item => item.title === '阶段综述')!;
    expect(note.blocks.some(block => block.type === 'paragraph' || block.type === 'markdown')).toBe(true);
    const later = structuredClone(applied.state); later.notes[0].title = '其他笔记的编辑';
    const undone = undoAiChange(later, applied.change, 'a');
    expect(undone.notes.some(item => item.id === note.id)).toBe(false);
    expect(undone.notes[0].title).toBe('其他笔记的编辑');
  });

  it('requires valid term data and preserves existing aliases when updating a meaning', () => {
    const state = createNotebookFixture();
    state.terms = [{ id: 'term-1', name: '稳定性', meaning: '原定义', aliases: ['稳定'], aliasEntries: [{ id: 'alias-1', name: '稳定' }] }];
    const proposal = createTermProposal(state, 'a', { termId: 'term-1', name: '稳定性', meaning: '新的定义' });
    const applied = applyAiProposal(state, proposal, 'a');
    expect(applied.state.terms![0]).toMatchObject({ meaning: '新的定义', aliasEntries: [{ id: 'alias-1', name: '稳定' }] });
    expect(undoAiChange(applied.state, applied.change, 'a').terms![0].meaning).toBe('原定义');
    expect(() => createTermProposal(state, 'a', { name: '', meaning: '' })).toThrow();
  });

  it('allows independent suggestions after approved changes and unrelated manual edits', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks.push({ id: 'second', type: 'paragraph', text: '第二段。' });
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: note.blocks[0].id, content: '第一段修改。' });
    const second = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'second', content: '第二段修改。' });
    const one = applyAiProposal(state, first, 'a');
    const two = applyAiProposal(one.state, second, 'a', [one.change]);
    expect(two.state.notes.find(item => item.id === note.id)!.blocks[1]).toMatchObject({ text: '第二段修改。' });
    const edited = structuredClone(one.state); edited.notes.find(item => item.id === note.id)!.title = '用户并发编辑';
    expect(applyAiProposal(edited, second, 'a', [one.change]).state.notes.find(item => item.id === note.id)!.title).toBe('用户并发编辑');
  });

  it.each(['text-first', 'tab-first'])('chains legacy text and native tab edits in %s order and undoes in reverse', order => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks = [{ id: 'tabs', type: 'examples', title: '案例', tabs: [{ id: 'tab-a', title: '原标签', blocks: [{ id: 'inside', type: 'paragraph', text: '原说明' }] }] }];
    const text = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'inside', content: '批准的新说明' });
    const tab = createNativeProposal(state, 'a', { action: 'tab-update', noteId: note.id, blockId: 'tabs', tabId: 'tab-a', title: '新标签' });
    const first = order === 'text-first' ? text : tab, second = order === 'text-first' ? tab : text;
    const one = applyAiProposal(state, first, 'a');
    const user = structuredClone(one.state); user.notes.find(item => item.id === note.id)!.title = '后续用户修改';
    expect(() => applyAiProposal(user, second, 'a', [one.change])).not.toThrow();
    expect(() => applyAiProposal(one.state, second, 'a')).not.toThrow();
    // Approval no longer needs history to establish field independence.
    expect(() => applyAiProposal(one.state, second, 'a', [{ ...one.change, baseline: '{invalid' }])).not.toThrow();
    expect(() => applyAiProposal(one.state, second, 'a', [{ ...one.change, after: '{invalid' }])).not.toThrow();
    const two = applyAiProposal(one.state, second, 'a', [one.change]);
    expect(two.state.notes.find(item => item.id === note.id)!.blocks[0]).toMatchObject({ tabs: [{ title: '新标签', blocks: [{ text: '批准的新说明' }] }] });
    const secondUndone = undoAiChange(two.state, two.change, 'a');
    expect(secondUndone.notes.find(item => item.id === note.id)!.blocks).toEqual(one.state.notes.find(item => item.id === note.id)!.blocks);
    const restored = undoAiChange(secondUndone, one.change, 'a');
    expect(restored.notes.find(item => item.id === note.id)!.blocks).toEqual(note.blocks);
    const late = structuredClone(two.state); late.notes.find(item => item.id === note.id)!.title = '批准后用户修改';
    expect(() => undoAiChange(late, two.change, 'a')).toThrow(/变化/);
  });

  it('reports term undo conflicts instead of silently claiming success', () => {
    const state = createNotebookFixture(); state.terms = [{ id: 'term', name: '旧名称', meaning: '定义', aliases: [] }];
    const proposal = createTermProposal(state, 'a', { termId: 'term', name: '新名称', meaning: '定义' });
    const applied = applyAiProposal(state, proposal, 'a');
    applied.state.terms!.push({ id: 'other', name: '旧名称', meaning: '其他定义', aliases: [] });
    expect(() => undoAiChange(applied.state, applied.change, 'a')).toThrow(/已存在/);
  });
});
