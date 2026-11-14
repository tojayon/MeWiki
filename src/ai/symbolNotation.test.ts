import { describe, expect, it } from 'vitest';
import { createSymbolEntry } from '../domain/researchDictionary.ts';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { dictionaryReferenceMarkdown } from '../domain/researchTerms.ts';
import { buildAiSystemPrompt, createAiToolContext, executeAiTool } from './tools.ts';
import { applyAiProposal, undoAiChange } from './proposals.ts';
import { createAiTextSelection } from './textSelection.ts';

const noteId = 'fixture-definition', blockId = `${noteId}:text`;
const target = (notation = 'v_{\\mathrm T}', id = 'fixture-target') => createSymbolEntry({ name: '受控目标节点', notation, meaning: '用于虚构测试的节点。', aliases: ['目标节点'], category: 'custom', slots: [] }, id);
function fixture(text = '通用内容。', symbols = [target()]) {
  const state = createNotebookFixture();
  state.symbols = symbols;
  state.notes.find(note => note.id === noteId)!.blocks = [{ id: blockId, type: 'paragraph', text }];
  const ctx = createAiToolContext(state, 'fixture-library', [noteId]);
  return { state, ctx };
}
const replace = (content: string) => ({ operation: 'replace-text', noteId, blockId, content });

describe('AI dictionary symbol notation', () => {
  it('returns resolved default notation and a ready-to-copy stable reference on search and full read', () => {
    const { ctx } = fixture();
    const resolved = { tex: 'v_{\\mathrm T}', bindings: { x1: '', x2: '\\mathrm T', x3: '' }, markdown: expect.stringContaining('mewiki-symbol:fixture-target') };
    const search = executeAiTool(ctx, 'search_dictionary', { query: '目标节点' });
    expect(search).toMatchObject({ symbols: [{ id: 'fixture-target', resolved }] });
    expect(ctx.readDictionaryIds.size).toBe(0);
    expect(executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'fixture-target' })).toMatchObject({ entry: { resolved } });
    expect(ctx.readDictionaryIds.has('symbol:fixture-target')).toBe(true);
  });

  it('finds symbols by resolved notation and aliases without case-folding the returned TeX', () => {
    const { ctx } = fixture();
    for (const query of ['v_{\\mathrm T}', '目标节点']) {
      expect(executeAiTool(ctx, 'search_dictionary', { query })).toMatchObject({ symbols: [{ id: 'fixture-target', resolved: { tex: 'v_{\\mathrm T}' } }] });
    }
  });

  it('includes bounded relevant conventions in note and block reads under the same read budget', () => {
    const { ctx } = fixture('受控目标节点为 $v_T$。');
    const result = executeAiTool(ctx, 'read_note', { noteId });
    expect(result).toMatchObject({ symbolConventions: { symbols: [{ id: 'fixture-target', resolved: { tex: 'v_{\\mathrm T}' } }], hasMore: false } });
    expect(ctx.readCharacters).toBe(JSON.stringify(result).length);
    const before = ctx.readCharacters;
    const block = executeAiTool(ctx, 'read_block', { noteId, blockId });
    expect(block).toMatchObject({ symbolConventions: { symbols: [{ id: 'fixture-target' }] } });
    expect(ctx.readCharacters - before).toBe(JSON.stringify(block).length);
    expect(ctx.readDictionaryIds.size).toBe(0);
    const blocked = fixture('受控目标节点').ctx; blocked.readCharacters = 99999;
    expect(() => executeAiTool(blocked, 'read_block', { noteId, blockId })).toThrow(/上限/);
    expect(blocked.readBlockIds.size).toBe(0);
  });

  it('sets the dictionary as the authority for mathematical typography in replies and edits', () => {
    const { ctx } = fixture();
    const prompt = buildAiSystemPrompt(ctx);
    expect(prompt).toContain('正体、斜体、粗体、大小写、上下标');
    expect(prompt).toContain('resolved.markdown');
    expect(prompt).toContain('不得简写');
  });

  it.each(['$v_T$', '$v_{T}$', '$v_{ T }$', '$v_T+v_T$'])('rejects newly introduced default font loss %s before registering a legacy proposal', content => {
    const { state, ctx } = fixture();
    const before = JSON.stringify(state);
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace(content))).toThrow(/符号书写.*fixture-target.*v_\{\\mathrm T\}/);
    expect(ctx.proposals).toHaveLength(0);
    expect(ctx.state).toEqual(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(['$v_{\\mathrm T}$', '$v_{\\mathrm{T}}$', '$v_i$', '$v_{T,i}$', '$v_T^2$', '$v_{ab}$', '`$v_T$`', '```tex\n$v_T$\n```', '$\\text{v_T}$', 'https://example.invalid/v_T'])('preserves canonical notation, real bindings and literal content %s', content => {
    const { ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    expect(executeAiTool(ctx, 'propose_note', replace(content))).toMatchObject({ status: '等待用户审阅' });
  });

  it('accepts a valid plain entry or an ambiguous dictionary instead of guessing the intended symbol', () => {
    for (const extra of [target('v_T', 'plain-target'), target('v_{\\mathsf T}', 'sans-target')]) {
      const { ctx } = fixture('通用内容。', [target(), extra]);
      executeAiTool(ctx, 'read_note', { noteId });
      expect(executeAiTool(ctx, 'propose_note', replace('$v_T$'))).toMatchObject({ status: '等待用户审阅' });
    }
  });

  it('preserves grouping, accents and command boundaries when matching font loss', () => {
    const { ctx } = fixture('通用内容。', [target('v_{\\mathrm{ab}}')]);
    executeAiTool(ctx, 'read_note', { noteId });
    expect(executeAiTool(ctx, 'propose_note', replace('$v_ab + \\hat{v}_{ab} + \\text{v_{ab}}$'))).toBeDefined();
    expect(() => executeAiTool(ctx, 'propose_note', replace('$v_{ab}$'))).toThrow(/符号书写/);
  });

  it('checks a missing base font as well as a missing index font', () => {
    const { ctx } = fixture('通用内容。', [target('\\boldsymbol{q}_{\\mathrm T}')]);
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace('$q_T$'))).toThrow(/符号书写/);
    expect(executeAiTool(ctx, 'propose_note', replace('$\\boldsymbol{q}_{\\mathrm T}$'))).toBeDefined();
  });

  it('allows unrelated edits that retain existing mistakes but rejects adding another occurrence', () => {
    const { ctx } = fixture('旧文 $v_T$，待完善。');
    executeAiTool(ctx, 'read_note', { noteId });
    expect(executeAiTool(ctx, 'propose_note', replace('旧文 $v_T$，补充说明。'))).toBeDefined();
    expect(() => executeAiTool(ctx, 'propose_note', replace('旧文 $v_T$，新增 $v_T$。'))).toThrow(/符号书写/);
    expect(ctx.proposals).toHaveLength(1);
  });

  it('checks append and create suggestions without borrowing old mistakes from another block', () => {
    const { ctx } = fixture('旧文 $v_T$。');
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'append', noteId, content: '$v_T$' })).toThrow(/符号书写/);
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'create', title: '虚构笔记', content: '$v_T$' })).toThrow(/符号书写/);
    expect(ctx.proposals).toHaveLength(0);
  });

  it('checks native text and formula edits, then retains normal approval and undo', () => {
    const { state, ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    executeAiTool(ctx, 'read_block', { noteId, blockId });
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId, blockId, fields: { text: '$v_T$' } })).toThrow(/符号书写/);
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'block-insert', noteId, blockType: 'formula', fields: { tex: 'v_T' } })).toThrow(/符号书写/);
    expect(ctx.proposals).toHaveLength(0);
    executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId, blockId, fields: { text: '$v_{\\mathrm T}$' } });
    const approved = applyAiProposal(state, ctx.proposals[0], ctx.libraryId);
    expect(approved.state.notes.find(note => note.id === noteId)!.blocks[0]).toMatchObject({ text: '$v_{\\mathrm T}$' });
    expect(undoAiChange(approved.state, approved.change, ctx.libraryId).notes).toEqual(state.notes);
  });

  it('checks a stable symbol reference by its actual bindings rather than its label', () => {
    const { ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    const incorrect = dictionaryReferenceMarkdown('symbol', target(), '$v_{\\mathrm T}$', { x2: 'T' });
    expect(() => executeAiTool(ctx, 'propose_note', replace(incorrect))).toThrow(/符号书写/);
    const correct = dictionaryReferenceMarkdown('symbol', target(), '$v_T$', { x2: '\\mathrm T' });
    expect(executeAiTool(ctx, 'propose_note', replace(correct))).toBeDefined();
  });

  it('checks native formula updates and dictionary-backed bindings against what is actually rendered', () => {
    const { state } = fixture();
    state.notes.find(note => note.id === noteId)!.blocks = [{ id: blockId, type: 'formula', tex: 'v_{\\mathrm T}' }];
    const ctx = createAiToolContext(state, 'fixture-library', [noteId]);
    executeAiTool(ctx, 'read_block', { noteId, blockId });
    executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'fixture-target' });
    for (const fields of [{ tex: 'v_T' }, { parts: [{ type: 'symbol', entryId: 'fixture-target', bindings: { x2: 'T' } }] }]) {
      expect(() => executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId, blockId, fields })).toThrow(/符号书写/);
    }
    expect(executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId, blockId, fields: { parts: [{ type: 'symbol', entryId: 'fixture-target', bindings: { x2: '\\mathrm T' } }] } })).toBeDefined();
    expect(ctx.proposals).toHaveLength(1);
  });

  it('does not inspect source URLs or Mermaid code as mathematical prose', () => {
    const { ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    expect(executeAiTool(ctx, 'propose_edit', { action: 'block-insert', noteId, blockType: 'bookmark', fields: { title: '虚构链接', url: 'https://example.invalid/$v_T$' } })).toBeDefined();
    expect(executeAiTool(ctx, 'propose_edit', { action: 'block-insert', noteId, blockType: 'diagram', fields: { mode: 'mermaid', code: 'flowchart LR\nA["$v_T$"]-->B["代码"]' } })).toBeDefined();
  });

  it('enforces the same notation on native and legacy term meanings but permits deliberate dictionary editing', () => {
    const { ctx } = fixture();
    expect(() => executeAiTool(ctx, 'propose_term', { name: '虚构术语', meaning: '定义为 $v_T$。' })).toThrow(/符号书写/);
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'term-save', fields: { name: '虚构术语', meaning: '定义为 $v_T$。' } })).toThrow(/符号书写/);
    executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'fixture-target' });
    expect(executeAiTool(ctx, 'propose_edit', { action: 'symbol-save', entryId: 'fixture-target', fields: { notation: 'v^{[x1]}_{[x2]}[x3]', slots: [{ key: 'x1', defaultValue: '' }, { key: 'x2', defaultValue: 'T' }, { key: 'x3', defaultValue: '' }] } })).toBeDefined();
  });

  it('keeps notation correction inside the authorized text selection', () => {
    const { state } = fixture('前文。受控目标节点。后文。');
    const selection = createAiTextSelection(state, 'fixture-library', noteId, [blockId], '受控目标节点');
    const ctx = createAiToolContext(state, 'fixture-library', [noteId], selection);
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace('前文。$v_T$。后文。'))).toThrow(/符号书写/);
    expect(() => executeAiTool(ctx, 'propose_note', replace('修改前文。$v_{\\mathrm T}$。后文。'))).toThrow(/选区|范围/);
    expect(executeAiTool(ctx, 'propose_note', replace('前文。$v_{\\mathrm T}$。后文。'))).toBeDefined();
    expect(ctx.proposals).toHaveLength(1);
  });

  it('caps related conventions and preserves the remaining dictionary lookup path', () => {
    const symbols = Array.from({ length: 18 }, (_, index) => target(`v_{\\mathrm{T${index}}}`, `fixture-${index}`));
    const { ctx } = fixture('受控目标节点', symbols);
    const read = executeAiTool(ctx, 'read_note', { noteId }) as { symbolConventions: { symbols: unknown[]; hasMore: boolean } };
    expect(read.symbolConventions.symbols).toHaveLength(12);
    expect(read.symbolConventions.hasMore).toBe(true);
    expect(executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'fixture-17' })).toMatchObject({ entry: { resolved: { tex: 'v_{\\mathrm{T17}}' } } });
  });

  it('bounds convention characters so a large entry does not prevent reading an otherwise small note', () => {
    const { ctx } = fixture('受控目标节点', [target(`v_{\\mathrm{${'T'.repeat(9000)}}}`)]);
    const result = executeAiTool(ctx, 'read_note', { noteId }) as { symbolConventions: { symbols: unknown[]; hasMore: boolean } };
    expect(JSON.stringify(result.symbolConventions).length).toBeLessThanOrEqual(8000);
    expect(result.symbolConventions.hasMore).toBe(true);
    expect(ctx.readFullNoteIds.has(noteId)).toBe(true);
  });

  it('does not treat a different old font mistake as permission to introduce a new one', () => {
    const { ctx } = fixture('旧文 $v_{\\mathsf T}$。');
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace('新文 $v_T$。'))).toThrow(/符号书写/);
  });

  it.each(['$\\mathit{v}_T$', '$\\mathrm{v}_T$', '$\\mathit v_T$', '$\\mathit{v_{T}}$'])('checks explicit base font substitutions %s', content => {
    const { ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace(content))).toThrow(/符号书写/);
  });

  it('resolves reference-style symbol links before checking their bindings', () => {
    const { ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    const content = '[$v_{\\mathrm T}$][target]\n\n[target]: mewiki-symbol:fixture-target?x2=T';
    expect(() => executeAiTool(ctx, 'propose_note', replace(content))).toThrow(/符号书写/);
  });

  it('accepts equivalent inherited font scopes and explicit default italic bases', () => {
    for (const [notation, content] of [['v_{\\mathrm T}', '$\\mathit{v}_{\\mathrm T}$'], ['\\mathrm{v}_{\\mathrm T}', '$\\mathrm{v_T}$'], ['\\boldsymbol{q}_{T}', '$\\mathit{\\boldsymbol{q}_{T}}$']]) {
      const { ctx } = fixture('通用内容。', [target(notation)]);
      executeAiTool(ctx, 'read_note', { noteId });
      expect(executeAiTool(ctx, 'propose_note', replace(content))).toBeDefined();
    }
  });

  it('uses the first Markdown definition even when a later duplicate suggests a different binding', () => {
    const { ctx } = fixture();
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace('[$v_{\\mathrm T}$][target]\n\n[target]: mewiki-symbol:fixture-target?x2=T\n\n[target]: mewiki-symbol:fixture-target?x2=%5Cmathrm+T'))).toThrow(/符号书写/);
  });

  it.each([['\\boldsymbol{\\theta}', '$\\theta$'], ['\\boldsymbol{θ}', '$θ$'], ['\\boldsymbol{q}_{\\mathrm{TR}}', '$q_{TR}$']])('preserves a bold Greek variable or multi-letter label in %s', (notation, content) => {
    const { ctx } = fixture('通用内容。', [target(notation)]);
    executeAiTool(ctx, 'read_note', { noteId });
    expect(() => executeAiTool(ctx, 'propose_note', replace(content))).toThrow(/符号书写/);
  });
});
