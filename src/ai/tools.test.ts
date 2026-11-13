import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { aiTools, buildAiSystemPrompt, createAiToolContext, executeAiTool } from './tools.ts';

describe('MeWiki native AI tools', () => {
  it('offers reviewed text deletion only after a scoped read and tells the model to edit in place', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const args = { operation: 'delete-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '' };
    expect(() => executeAiTool(ctx, 'propose_note', args)).toThrow(/先读取/);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    expect(executeAiTool(ctx, 'propose_note', args)).toMatchObject({ status: '等待用户审阅' });
    expect(ctx.state.notes.find(note => note.id === args.noteId)!.blocks).toHaveLength(1);
    expect(ctx.proposals[0]).toMatchObject({ kind: 'delete-text', content: '', blockId: args.blockId });
    expect(buildAiSystemPrompt(ctx)).toContain('优先使用 replace-text');
  });
  it('keeps note reads, searches and embedded sources within the explicitly chosen scope', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'embed', type: 'noteEmbed', sourceNoteId: 'fixture-summary', blockIds: ['fixture-summary:text'] });
    state.notes.find(note => note.id === 'fixture-summary')!.blocks = [{ id: 'fixture-summary:text', type: 'paragraph', text: '范围之外的秘密资料' }];
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const result = executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    expect(JSON.stringify(result)).not.toContain('范围之外的秘密资料');
    expect(() => executeAiTool(ctx, 'read_note', { noteId: 'fixture-summary' })).toThrow(/范围/);
    expect(JSON.stringify(executeAiTool(ctx, 'search_notes', { query: '秘密资料' }))).not.toContain('fixture-summary');
    expect([...ctx.sourceIds]).toEqual(['fixture-definition']);
  });

  it('creates review proposals without mutating the frozen notebook or exposing save tools', () => {
    const state = createNotebookFixture();
    const before = JSON.stringify(state);
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    executeAiTool(ctx, 'propose_note', { operation: 'append', noteId: 'fixture-definition', title: '定义', content: '建议补充' });
    expect(ctx.proposals).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
    expect(aiTools.some(tool => /save|delete|apply/.test(tool.name))).toBe(false);
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'append', noteId: 'fixture-summary', content: '越界' })).toThrow(/范围/);
  });

  it('generates advertised capabilities from the executable registry and rejects unknown tools', () => {
    const state = createNotebookFixture();
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const prompt = buildAiSystemPrompt(ctx);
    for (const tool of aiTools) expect(prompt).toContain(tool.name);
    expect(() => executeAiTool(ctx, 'arbitrary_shell', {})).toThrow(/工具/);
    expect(() => executeAiTool(ctx, 'read_note', { noteId: '__proto__' })).toThrow();
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'create', title: '太长', content: '文'.repeat(50000) })).toThrow(/长度/);
  });

  it('projects readable content without exchange snapshots, private plugin payloads or inline media', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'external', type: 'external', provider: 'unknown', contentType: 'record', schemaVersion: 1, title: '公开标题', summary: '可读摘要', data: { internal: 'DO_NOT_SEND_PRIVATE_PLUGIN_DATA' } });
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'inline', type: 'paragraph', text: '![图片](data:image/png;base64,DO_NOT_SEND_IMAGE_BYTES)' });
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const result = JSON.stringify(executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' }));
    expect(result).toContain('可读摘要');
    expect(result).not.toContain('DO_NOT_SEND');
    expect(result).not.toContain('webbench-blocks');
  });

  it('requires a real read before editing, even after a search finds the note', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    executeAiTool(ctx, 'search_notes', { query: '通用内容' });
    expect(() => executeAiTool(ctx, 'propose_note', { operation: 'append', noteId: 'fixture-definition', content: '补充内容' })).toThrow(/先读取/);
  });
  it('projects literal and dictionary-backed formulas as readable LaTeX', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-application')!.blocks.push({ id: 'literal', type: 'formula', tex: 'E = mc^2' });
    const ctx = createAiToolContext(state, 'a', ['fixture-application']);
    const result = JSON.stringify(executeAiTool(ctx, 'read_note', { noteId: 'fixture-application' }));
    expect(result).toContain('E = mc^2');
    expect(result).toContain('boldsymbol');
    expect(result).not.toContain('[object Object]');
  });

  it('counts metadata and block locations against the same transactional read budget', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.frontmatter = { details: '属性'.repeat(500) };
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const result = executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    expect(ctx.readCharacters).toBe(JSON.stringify(result).length);
    const blocked = createAiToolContext(state, 'a', ['fixture-definition']); blocked.readCharacters = 99999;
    expect(() => executeAiTool(blocked, 'read_note', { noteId: 'fixture-definition' })).toThrow(/上限/);
    expect(blocked.readCharacters).toBe(99999);
    expect([...blocked.readNoteIds, ...blocked.sourceIds]).toEqual([]);
  });

  it.each(['list_notes', 'search_notes', 'search_dictionary'])('budgets readable data from %s', name => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const result = executeAiTool(ctx, name, { query: name === 'search_notes' ? '通用内容' : '' });
    expect(ctx.readCharacters).toBe(JSON.stringify(result).length);
  });

  it('rejects undeclared parameters and invalid pagination before reading', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    expect(() => executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition', unrestricted: true })).toThrow(/字段|参数/);
    expect(() => executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition', offset: -1 })).toThrow(/字段|参数/);
    expect(ctx.readCharacters).toBe(0);
    expect(aiTools.map(tool => tool.name).length).toBe(new Set(aiTools.map(tool => tool.name)).size);
  });

  it('reads note relationship IDs through the bounded metadata document', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.theory = { annotations: [], relations: [{ id: 'relation-a', source: Object.assign({ noteId: 'fixture-summary' }, { private: 'PRIVATE_RELATION_FIELD' }), target: { noteId: note.id }, kind: 'adaptation', description: '关系原文' }] };
    const ctx = createAiToolContext(state, 'a', [note.id]);
    const result = executeAiTool(ctx, 'read_note', { noteId: note.id });
    expect(result).toMatchObject({ theory: { relations: [{ id: 'relation-a', description: '关系原文' }] } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RELATION_FIELD');
    note.frontmatter = { details: '属'.repeat(9000) };
    const paged = createAiToolContext(state, 'a', [note.id]);
    let metadataOffset: number | null = 0, document = '';
    while (metadataOffset !== null) {
      const page = executeAiTool(paged, 'read_note', { noteId: note.id, metadataOffset }) as { metadataJson: string; nextMetadataOffset: number | null };
      document += page.metadataJson; metadataOffset = page.nextMetadataOffset;
    }
    expect(JSON.parse(document)).toMatchObject({ metadata: { title: note.title }, theory: { relations: [{ id: 'relation-a' }] } });
    expect(paged.readFullNoteIds.has(note.id)).toBe(true);
  });
});
