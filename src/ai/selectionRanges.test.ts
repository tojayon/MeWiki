import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { aiTextSelectionError, createAiTextSelection, restoreAiTextSelection } from './textSelection.ts';
import { createAiToolContext, executeAiTool } from './tools.ts';
import { createAiDraft } from './drafts.ts';

const fixture = () => {
  const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
  note.blocks = [{ id: 'text', type: 'paragraph', text: '前文。系统**始终**稳定。后文。' }];
  return { state, note };
};
describe('exact rendered selection boundaries', () => {
  it('accepts a word replacement while rejecting changes to unselected words and formatting', () => {
    const { state, note } = fixture(), selection = createAiTextSelection(state, 'a', note.id, ['text'], '始终');
    const ctx = createAiToolContext(state, 'a', [note.id], selection);
    executeAiTool(ctx, 'read_note', { noteId: note.id });
    const args = { operation: 'replace-text', noteId: note.id, blockId: 'text', content: '前文。系统**局部**稳定。后文。' };
    expect(() => executeAiTool(ctx, 'propose_note', args)).not.toThrow();
    for (const content of ['整段全部重写。', '更改前文。系统**局部**稳定。后文。', '前文。系统局部稳定。后文。']) {
      expect(() => executeAiTool(ctx, 'propose_note', { ...args, content })).toThrow(/选区/);
    }
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'text' });
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId: note.id, blockId: 'text', fields: { text: '全部重写。' } })).toThrow(/选区/);
  });
  it('protects unselected list items and text on either side of a selected phrase', () => {
    const { state, note } = fixture();
    note.blocks = [{ id: 'list', type: 'list', items: ['保留开头，修改这里，保留末尾。', '另一项不变。'] }];
    const ctx = createAiToolContext(state, 'a', [note.id], createAiTextSelection(state, 'a', note.id, ['list'], '修改这里'));
    executeAiTool(ctx, 'read_block', { noteId: note.id, blockId: 'list' });
    const args = { action: 'block-update', noteId: note.id, blockId: 'list', fields: { items: ['保留开头，精确修改，保留末尾。', '另一项不变。'] } };
    expect(() => executeAiTool(ctx, 'propose_edit', args)).not.toThrow();
    expect(() => executeAiTool(ctx, 'propose_edit', { ...args, fields: { items: [args.fields.items[0], '偷偷改另一项。'] } })).toThrow(/选区/);
  });
  it('protects both unselected ends of a selection spanning two blocks', () => {
    const { state, note } = fixture();
    note.blocks = [{ id: 'first', type: 'paragraph', text: '第一段尾部' }, { id: 'second', type: 'paragraph', text: '头部第二段' }];
    const ctx = createAiToolContext(state, 'a', [note.id], createAiTextSelection(state, 'a', note.id, ['first', 'second'], '尾部\n头部'));
    executeAiTool(ctx, 'read_note', { noteId: note.id });
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'first', content: '第一段新尾部' })).not.toThrow();
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'second', content: '整块替换' })).toThrow(/选区/);
  });
  it('keeps the protected suffix visible during a valid streamed replacement', () => {
    const { state, note } = fixture(); note.blocks = [{ id: 'text', type: 'paragraph', text: '前文。旧词。后文。' }];
    const ctx = createAiToolContext(state, 'a', [note.id], createAiTextSelection(state, 'a', note.id, ['text'], '旧词'));
    executeAiTool(ctx, 'read_note', { noteId: note.id });
    const prefix = '{"operation":"replace-text","noteId":"fixture-definition","blockId":"text","content":"';
    expect(createAiDraft(ctx, { name: 'propose_note', arguments: prefix + '越界前文' }, 'draft')).toBeNull();
    expect(createAiDraft(ctx, { name: 'propose_note', arguments: prefix + '前文。新' }, 'draft')).toMatchObject({ content: '前文。新。后文。' });
    expect(createAiDraft(ctx, { name: 'propose_note', arguments: prefix + '前文。新词。错误后文。"}' }, 'draft')).toBeNull();
  });
  it('maps rendered emphasis back to source while preserving surrounding text', () => {
    const { state, note } = fixture();
    const ctx = createAiToolContext(state, 'a', [note.id], createAiTextSelection(state, 'a', note.id, ['text'], '系统始终稳定'));
    executeAiTool(ctx, 'read_note', { noteId: note.id });
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'text', content: '前文。系统**局部**稳定。后文。' })).not.toThrow();
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'text', content: '系统**局部**稳定。后文。' })).toThrow(/选区/);
  });
  it('uses DOM prefix hints to distinguish repeated words, including the first occurrence', () => {
    const { state, note } = fixture(); note.blocks = [{ id: 'text', type: 'paragraph', text: '重复。重复。' }];
    expect(() => createAiTextSelection(state, 'a', note.id, ['text'], '重复')).toThrow(/定位/);
    const first = createAiTextSelection(state, 'a', note.id, ['text'], '重复', [{ id: 'text', text: '重复', prefix: '' }]);
    const second = createAiTextSelection(state, 'a', note.id, ['text'], '重复', [{ id: 'text', text: '重复', prefix: '重复。' }]);
    expect(first.blocks[0].ranges).toEqual([{ field: 'text', start: 0, end: 2 }]);
    expect(second.blocks[0].ranges).toEqual([{ field: 'text', start: 3, end: 5 }]);
    expect(restoreAiTextSelection(second, 'a')).toEqual(second);
  });
  it('maps emoji, Markdown escapes and entities without splitting their source tokens', () => {
    const { state, note } = fixture(); note.blocks = [{ id: 'text', type: 'paragraph', text: '保留😀\\* &amp; 后文' }];
    const selection = createAiTextSelection(state, 'a', note.id, ['text'], '😀* &');
    expect(selection.blocks[0].ranges).toEqual([{ field: 'text', start: 2, end: 12 }]);
    expect(aiTextSelectionError(state, 'a', selection)).toBe('');
  });
  it('resolves old v1 quotes conservatively and rejects ambiguous references', () => {
    const { state, note } = fixture(); note.blocks = [{ id: 'text', type: 'paragraph', text: '前文。旧词。后文。' }];
    const selection = createAiTextSelection(state, 'a', note.id, ['text'], '旧词');
    delete selection.blocks[0].ranges;
    const ctx = createAiToolContext(state, 'a', [note.id], selection);
    executeAiTool(ctx, 'read_note', { noteId: note.id });
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'text', content: '前文。新词。后文。' })).not.toThrow();
    const invalid = createAiTextSelection(state, 'a', note.id, ['text'], '旧词');
    invalid.blocks[0].ranges = [{ field: 'text', start: 0, end: 9 }];
    expect(aiTextSelectionError(state, 'a', invalid)).toContain('定位');
    note.blocks[0] = { id: 'text', type: 'paragraph', text: '旧词。旧词。' };
    const ambiguous = createAiTextSelection(state, 'a', note.id, ['text'], '旧词', [{ id: 'text', text: '旧词', prefix: '' }]);
    delete ambiguous.blocks[0].ranges;
    expect(aiTextSelectionError(state, 'a', ambiguous)).toContain('定位');
  });
  it('does not include hidden Markdown outside a whole visible phrase selection', () => {
    const { state, note } = fixture();
    for (const text of ['**始终**', '始终 ![必须保留的图片](https://example.invalid/test.png)', '[始终](https://example.invalid/keep)']) {
      note.blocks = [{ id: 'text', type: 'paragraph', text }];
      const selection = createAiTextSelection(state, 'a', note.id, ['text'], '始终');
      const ctx = createAiToolContext(state, 'a', [note.id], selection);
      executeAiTool(ctx, 'read_note', { noteId: note.id });
      expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'text', content: '局部' })).toThrow(/选区/);
      expect(() => executeAiTool(ctx, 'propose_note', { operation: 'replace-text', noteId: note.id, blockId: 'text', content: text.replace('始终', '局部') })).not.toThrow();
      selection.blocks[0].ranges = [{ field: 'text', start: 0, end: text.length }];
      expect(aiTextSelectionError(state, 'a', selection)).toContain('定位');
    }
  });
});
