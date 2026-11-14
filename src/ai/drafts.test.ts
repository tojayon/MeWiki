import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiToolContext, executeAiTool } from './tools.ts';
import { createAiDraft } from './drafts.ts';
import { createAiTextSelection } from './textSelection.ts';

const context = () => createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
const draft = (ctx: ReturnType<typeof context>, args: string, name = 'propose_note') => createAiDraft(ctx, { name, arguments: args }, 'draft-1');

describe('in-memory streaming AI drafts', () => {
  it('withholds out-of-selection incremental proposals just like final tool execution', () => {
    const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.blocks.push({ id: 'outside', type: 'paragraph', text: '选择范围外' });
    const selection = createAiTextSelection(state, 'a', note.id, [note.blocks[0].id], '通用');
    const ctx = createAiToolContext(state, 'a', [note.id], selection);
    executeAiTool(ctx, 'read_note', { noteId: note.id });
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'outside' });
    expect(draft(ctx, '{"operation":"replace-text","noteId":"fixture-definition","blockId":"outside","content":"不能预览')).toBeNull();
    expect(draft(ctx, '{"operation":"replace-text","noteId":"fixture-definition","blockId":"fixture-definition:text","content":"允许预览')).toMatchObject({ content: '允许预览内容。' });
    expect(draft(ctx, '{"action":"block-update","noteId":"fixture-definition","blockId":"outside","fields":{"text":"不能预览', 'propose_edit')).toBeNull();
  });
  it('previews incomplete content after authorized target metadata without executing a tool or saving', () => {
    const ctx = context();
    const args = '{"operation":"replace-text","noteId":"fixture-definition","blockId":"fixture-definition:text","content":"正在写 **解释**';
    expect(draft(ctx, args)).toBeNull();
    ctx.readNoteIds.add('fixture-definition');
    const before = structuredClone(ctx.state);
    expect(draft(ctx, args)).toMatchObject({ id: 'draft-1', libraryId: 'a', kind: 'replace-text', content: '正在写 **解释**', blockId: 'fixture-definition:text' });
    expect(ctx.state).toEqual(before);
    expect(ctx.proposals).toEqual([]);
    expect(ctx.sourceIds.size).toBe(0);
  });

  it('decodes escaped quotes, newlines and Unicode while withholding incomplete escape sequences', () => {
    const ctx = context();
    const prefix = '{"operation":"create","title":"草稿","content":"';
    expect(draft(ctx, prefix + '第一行\\n\\"引号\\"\\u4e2d\\u')).toMatchObject({ content: '第一行\n"引号"中' });
    expect(draft(ctx, prefix + '成员\\uD83D')).toMatchObject({ content: '成员' });
    expect(draft(ctx, prefix + '成员\\uD83D\\uDC69')).toMatchObject({ content: '成员👩' });
  });

  it('requires closed metadata and rejects duplicate fields, invalid JSON and non-string values', () => {
    const ctx = context();
    for (const args of [
      '{"operation":"create","title":"尚未闭合',
      '{"operation":"create","title":"草稿","content":"文字","content":"重写"}',
      '{"operation":"create","title":"草稿","content":"文字"} trailing',
      '{"operation":"create","title":"草稿","content":{"text":"文字"}}',
      '{"operation":"create","title":"草稿","content":"无效\\x"}',
      '{"operation":"create","title":"草稿","content":"文字",}',
    ]) expect(draft(ctx, args)).toBeNull();
  });

  it('rejects unread or out-of-scope notes and unsupported blocks or operations', () => {
    const ctx = context(); ctx.readNoteIds.add('fixture-summary'); ctx.readNoteIds.add('fixture-definition');
    for (const args of [
      { operation: 'append', noteId: 'fixture-summary', content: '范围外' },
      { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'missing', content: '不存在' },
      { operation: 'delete-note', noteId: 'fixture-definition', content: '' },
    ]) expect(draft(ctx, JSON.stringify(args))).toBeNull();
    expect(draft(ctx, JSON.stringify({ operation: 'create', title: '过长', content: '字'.repeat(40001) }))).toBeNull();
  });

  it('uses stable transient identifiers and keeps current term aliases while drafting rendered definitions', () => {
    const ctx = context();
    const first = draft(ctx, '{"operation":"create","title":"新笔记","content":"第一');
    const next = draft(ctx, '{"operation":"create","title":"新笔记","content":"第一段');
    expect(next?.targetId).toBe(first?.targetId);
    ctx.state.terms = [{ id: 'term', name: '稳定性', meaning: '原定义', aliases: ['稳定'] }];
    expect(draft(ctx, '{"termId":"term","name":"稳定性","meaning":"新的 **定义**', 'propose_term')).toMatchObject({ id: 'draft-1', kind: 'term', term: { id: 'term', meaning: '新的 **定义**', aliases: ['稳定'] } });
    expect(draft(ctx, '{"termId":"other","name":"稳定性","meaning":"新的定义', 'propose_term')).toBeNull();
  });

  it('streams a native text field only after the same block authorization as the final tool', () => {
    const ctx = context();
    const args = '{"action":"block-update","noteId":"fixture-definition","blockId":"fixture-definition:text","fields":{"text":"逐步 **修改**';
    expect(draft(ctx, args, 'propose_edit')).toBeNull();
    executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'fixture-definition:text' });
    const snapshot = JSON.stringify(ctx);
    const proposal = draft(ctx, args, 'propose_edit');
    expect(proposal).toMatchObject({ id: 'draft-1', kind: 'native', target: 'note', edit: { action: 'block-update', fields: { text: '逐步 **修改**' } } });
    expect(JSON.stringify(ctx)).toBe(snapshot);
    expect(draft(ctx, args + '。', 'propose_edit')?.id).toBe(proposal?.id);
    for (const invalid of [
      args.replace('fixture-definition:text', 'missing'),
      args.replace('"text":', '"data":'),
      args + '","text":"重复',
      args + '"},"noteId":"fixture-summary"}',
      args.replace('"fields":{', '"fields":{"unknown":{"text":"'),
    ]) expect(draft(ctx, invalid, 'propose_edit')).toBeNull();
  });
});
