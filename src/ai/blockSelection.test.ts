import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiBlockSelection, createAiTextSelection, restoreAiTextSelection, aiTextSelectionError, aiRequestScopeKey } from './textSelection.ts';
import { buildAiSystemPrompt, createAiToolContext, executeAiTool } from './tools.ts';
import { createAiDraft } from './drafts.ts';
import { applyAiProposal, undoAiChange } from './proposals.ts';
import { createAiSession, readAiSession } from './session.ts';
import { beginAiChatTask, retryAiChatTask } from './chatActions.ts';

function fixture() {
  const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
  note.blocks = [
    { id: 'text', type: 'paragraph', text: '本行全部内容。\n保留这一句。' },
    { id: 'formula', type: 'formula', section: 'given', tex: 'x = 1', caption: '初始条件' },
    { id: 'tabs', type: 'examples', tabs: [
      { id: 'tab-a', title: '第一页', blocks: [{ id: 'child-a', type: 'paragraph', text: '页签中的原文' }] },
      { id: 'tab-b', title: '第二页', blocks: [{ id: 'child-b', type: 'formula', tex: 'y = 2' }] },
    ] },
  ];
  return { state, note };
}

describe('AI block menu references', () => {
  it('attaches the whole actual block without selecting text and preserves its baseline across session restore', () => {
    const { state, note } = fixture();
    const selection = createAiBlockSelection(state, 'a', note.id, 'text');
    expect(selection).toMatchObject({ kind: 'block', noteId: note.id, text: '本行全部内容。\n保留这一句。', blocks: [{ id: 'text' }] });
    expect(aiTextSelectionError(state, 'a', selection)).toBe('');
    const session = { ...createAiSession('a'), draft: '已有要求', selection, history: [{ role: 'user' as const, content: '解释这一行', selection }] };
    const restored = readAiSession('a', { getItem: () => JSON.stringify(session) });
    expect(restored.selection).toEqual(selection); expect(restored.history[0].selection).toEqual(selection);
    expect(restored.draft).toBe('已有要求');
    expect(aiRequestScopeKey([note.id], selection)).not.toBe(aiRequestScopeKey([note.id], createAiTextSelection(state, 'a', note.id, ['text'], selection.text)));
    expect(restoreAiTextSelection({ ...selection, kind: 'unknown' }, 'a')).toBeUndefined();
    expect(restoreAiTextSelection({ ...selection, blocks: [...selection.blocks, { ...selection.blocks[0], id: 'formula' }] }, 'a')).toBeUndefined();
    expect(restoreAiTextSelection(selection, 'b')).toBeUndefined();
    note.blocks[0] = { id: 'text', type: 'paragraph', text: '更新后的内容' };
    expect(aiTextSelectionError(state, 'a', selection)).toContain('变化');
    expect(() => createAiBlockSelection(state, 'a', note.id, 'absent')).toThrow();
  });

  it('uses a bounded readable summary without inline attachment data or comments', () => {
    const { state, note } = fixture();
    note.blocks[0] = { id: 'text', type: 'paragraph', text: '<!--隐藏注释-->![图片](data:image/png;base64,PRIVATE_IMAGE)\n' + '长文字'.repeat(2000) };
    const selection = createAiBlockSelection(state, 'a', note.id, 'text');
    expect(selection.text.length).toBeLessThanOrEqual(4000);
    expect(selection.text).not.toContain('PRIVATE_IMAGE'); expect(selection.text).not.toContain('隐藏注释');
    expect(selection.text).toContain('摘要已截断');
    expect(aiTextSelectionError(state, 'a', selection)).toBe('');
    expect(buildAiSystemPrompt(createAiToolContext(state, 'a', [note.id], selection))).toContain('read_block');
    note.blocks[0] = { id: 'text', type: 'paragraph', text: '' };
    expect(createAiBlockSelection(state, 'a', note.id, 'text').text.trim()).not.toBe('');
  });

  it('supports native formula suggestions and streaming previews, then approval and undo, without widening targets', () => {
    const { state, note } = fixture(), original = structuredClone(state);
    const selection = createAiBlockSelection(state, 'a', note.id, 'formula');
    expect(selection.text).toContain('x = 1');
    const ctx = createAiToolContext(state, 'a', state.notes.map(item => item.id), selection);
    const args = { action: 'block-update', noteId: note.id, blockId: 'formula', fields: { tex: 'x = 2', caption: '修正后的条件' } };
    expect(() => executeAiTool(ctx, 'read_note', { noteId: 'fixture-summary' })).toThrow(/范围/);
    expect(() => executeAiTool(ctx, 'propose_edit', args)).toThrow(/读取/);
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'formula' });
    expect(createAiDraft(ctx, { name: 'propose_edit', arguments: JSON.stringify(args) }, 'live')).not.toBeNull();
    for (const bad of [
      { ...args, blockId: 'text', fields: { text: '越界' } },
      { ...args, fields: { section: 'conclusion' } },
      { ...args, action: 'block-delete', fields: undefined },
      { action: 'note-update', noteId: note.id, fields: { title: '越界' } },
      { ...args, fields: { privateData: '越界' } },
    ]) {
      expect(() => executeAiTool(ctx, 'propose_edit', bad)).toThrow();
      expect(createAiDraft(ctx, { name: 'propose_edit', arguments: JSON.stringify(bad) }, 'bad')).toBeNull();
    }
    executeAiTool(ctx, 'propose_edit', args);
    expect(state).toEqual(original);
    const { state: applied, change } = applyAiProposal(state, ctx.proposals[0], 'a');
    expect(applied.notes.find(item => item.id === note.id)!.blocks[1]).toMatchObject({ ...args.fields, section: 'given' });
    expect(undoAiChange(applied, change, 'a').notes.find(item => item.id === note.id)).toEqual(note);
  });

  it('derives container children from the current tree and keeps a child reference restricted to that child', () => {
    const { state, note } = fixture();
    const root = createAiBlockSelection(state, 'a', note.id, 'tabs');
    expect(root.text).toContain('第一页'); expect(root.text).toContain('y = 2');
    const ctx = createAiToolContext(state, 'a', [note.id], root);
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'child-b' });
    const args = { action: 'block-update', noteId: note.id, blockId: 'child-b', fields: { tex: 'y = 3' } };
    executeAiTool(ctx, 'propose_edit', args);
    expect(() => executeAiTool(ctx, 'propose_edit', { ...args, blockId: 'formula' })).toThrow();
    const child = createAiToolContext(state, 'a', [note.id], createAiBlockSelection(state, 'a', note.id, 'child-a'));
    expect(() => executeAiTool(child, 'propose_edit', args)).toThrow();
    expect(() => executeAiTool(child, 'propose_term', { name: '越界', meaning: '越界' })).toThrow();
    const tabs = note.blocks[2];
    if (tabs.type === 'examples') tabs.tabs[1].blocks[0] = { id: 'child-b', type: 'formula', tex: 'y = 9' };
    expect(aiTextSelectionError(state, 'a', root)).toContain('变化');
  });

  it('keeps the original block reference and draft when a failed task is restored and retried', () => {
    const { state, note } = fixture();
    const provider = { id: 'test', name: '测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'test', hasApiKey: false };
    const selection = createAiBlockSelection(state, 'a', note.id, 'formula');
    const task = beginAiChatTask({ ...createAiSession('a'), selection }, provider, 'test', '修正这一行公式', state.notes.map(item => item.id), state);
    const restored = readAiSession('a', { getItem: () => JSON.stringify({ ...task.session, status: 'error', draft: '下一条问题' }) });
    const retried = retryAiChatTask(restored, [provider], state);
    expect(retried.selection).toEqual(selection); expect(retried.noteIds).toEqual([note.id]);
    expect(retried.session.draft).toBe('下一条问题');
    expect(retried.session.history.filter(item => item.role === 'user')).toHaveLength(1);
    note.blocks[1] = { id: 'formula', type: 'formula', tex: 'x = 9' };
    expect(() => retryAiChatTask(restored, [provider], state)).toThrow(/变化/);
  });
});
