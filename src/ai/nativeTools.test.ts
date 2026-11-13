import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiToolContext, executeAiTool } from './tools.ts';
import { applyAiProposal, undoAiChange } from './proposals.ts';
import { createAiSession, readAiSession, writeAiSession } from './session.ts';
import { ensureTheoryMaps } from '../domain/researchTheoryMap.ts';
import { assertNativeEditAccess } from './nativeTools.ts';

describe('native Agent tool contract and review lifecycle', () => {
  it('treats library scope as ordinary notes while retaining explicit manual-reference protection', () => {
    const original = createNotebookFixture();
    original.notes.push({ ...structuredClone(original.notes[0]), id: 'mewiki-manual-index', title: 'PRIVATE_MANUAL_TITLE', blocks: [] });
    const state = ensureTheoryMaps(original), noteIds = state.notes.filter(note => !note.id.startsWith('mewiki-manual-')).map(note => note.id);
    const ctx = createAiToolContext(state, 'a', noteIds);
    for (const noteId of noteIds) executeAiTool(ctx, 'read_note', { noteId });
    const result = executeAiTool(ctx, 'read_theory_maps', { mapId: 'global' });
    expect(result).toMatchObject({ scopeComplete: true });
    expect(JSON.stringify(result)).not.toContain('mewiki-manual-index');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MANUAL_TITLE');
    expect(executeAiTool(ctx, 'propose_edit', { action: 'map-update', mapId: 'global', fields: { title: '普通资料的全局地图' } })).toMatchObject({ status: '等待用户审阅' });

    state.theoryMaps!.documents.find(map => map.id === 'global')!.annotations.push({ ref: { noteId: 'mewiki-manual-index' }, role: 'model' });
    const referenced = createAiToolContext(state, 'a', noteIds);
    expect(executeAiTool(referenced, 'read_theory_maps', { mapId: 'global' })).toMatchObject({ scopeComplete: false });
    expect(() => executeAiTool(referenced, 'propose_edit', { action: 'map-update', mapId: 'global', fields: { title: '越过手册引用' } })).toThrow(/范围/);
  });

  it('keeps the block type in schema lookup and publishes executable update parameters', () => {
    const state = createNotebookFixture(), ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const contract = executeAiTool(ctx, 'get_edit_schema', { action: 'block-update', blockType: 'paragraph' }) as { parameters: { properties: Record<string, unknown> } };
    expect(contract.parameters.properties).not.toHaveProperty('blockType');
    executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'fixture-definition:text' });
    const input = { action: 'block-update', noteId: 'fixture-definition', blockId: 'fixture-definition:text', fields: { text: '精确契约下的更新' } };
    expect(() => executeAiTool(ctx, 'propose_edit', { ...input, blockType: 'paragraph' })).toThrow(/字段/);
    expect(executeAiTool(ctx, 'propose_edit', input)).toMatchObject({ status: '等待用户审阅' });
  });

  it('locates tabs by path and requires a scoped block read before proposing an edit', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 'event', title: '通信事件', blocks: [{ id: 'nested', type: 'paragraph', text: '原来的说明' }] }] }];
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const args = { action: 'block-update', noteId: 'fixture-definition', blockId: 'nested', fields: { text: '更新后的说明' } };
    expect(() => executeAiTool(ctx, 'propose_edit', args)).toThrow(/读取/);
    const note = executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    expect(note).toMatchObject({ blocks: [{ id: 'tabs', operations: expect.arrayContaining(['tab-update']) }, { id: 'nested', path: [{ exampleBlockId: 'tabs', tabId: 'event', title: '通信事件' }] }] });
    executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'nested' });
    expect(executeAiTool(ctx, 'propose_edit', args)).toMatchObject({ status: '等待用户审阅' });
    expect(ctx.proposals).toHaveLength(1);
    expect(ctx.state).toEqual(state);
    expect(() => executeAiTool(ctx, 'propose_edit', { ...args, noteId: 'fixture-summary' })).toThrow(/范围/);
  });

  it('paginates block locations and never sends plugin private data', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks = Array.from({ length: 170 }, (_, i) => ({ id: `block-${i}`, type: 'paragraph', text: `段落 ${i}` }));
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'plugin', type: 'external', provider: 'unknown', contentType: 'record', schemaVersion: 1, title: '公开标题', summary: '公开摘要', data: { secret: 'DO_NOT_SEND' }, note: '用户备注' });
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    expect(executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition', blockOffset: 150 })).toMatchObject({ blocks: expect.arrayContaining([expect.objectContaining({ id: 'block-160' })]) });
    const external = executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'plugin' });
    expect(JSON.stringify(external)).toContain('公开摘要');
    expect(JSON.stringify(external)).not.toContain('DO_NOT_SEND');
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId: 'fixture-definition', blockId: 'plugin', fields: { data: {} } })).toThrow();
  });

  it('supports reviewed symbol updates and restores them after refreshing a session', () => {
    const state = createNotebookFixture(), ctx = createAiToolContext(state, 'a', ['fixture-application']);
    const args = { action: 'symbol-save', entryId: 'example-matrix', fields: { meaning: '由 AI 建议的新含义', unit: '无量纲' } };
    expect(() => executeAiTool(ctx, 'propose_edit', args)).toThrow(/读取/);
    executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'example-matrix' });
    executeAiTool(ctx, 'propose_edit', args);
    const proposal = ctx.proposals[0], applied = applyAiProposal(state, proposal, 'a');
    expect(applied.state.symbols.find(entry => entry.id === 'example-matrix')!.meaning).toBe('由 AI 建议的新含义');
    const session = { ...createAiSession('a'), proposals: [proposal], changes: [applied.change], appliedIds: [proposal.id] };
    let saved = '';
    writeAiSession(session, { setItem: (_key, value) => { saved = value; } });
    const recovered = readAiSession('a', { getItem: () => saved });
    expect(recovered.proposals).toHaveLength(1);
    expect(recovered.changes).toHaveLength(1);
    expect(undoAiChange(applied.state, recovered.changes[0], 'a').symbols).toEqual(state.symbols);
    expect(() => applyAiProposal(state, recovered.proposals[0], 'different')).toThrow(/资料库/);
    const modified = structuredClone(state); modified.symbols.find(entry => entry.id === 'example-matrix')!.unit = '用户后来更改';
    expect(() => applyAiProposal(modified, proposal, 'a')).toThrow(/变化/);
  });

  it('chains approved native edits to different blocks but rejects later user changes', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'second', type: 'paragraph', text: '第二段' });
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    for (const [blockId, text] of [['fixture-definition:text', '修改第一段'], ['second', '修改第二段']]) {
      executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId });
      executeAiTool(ctx, 'propose_edit', { action: 'block-update', noteId: 'fixture-definition', blockId, fields: { text } });
    }
    const first = applyAiProposal(state, ctx.proposals[0], 'a');
    const second = applyAiProposal(first.state, ctx.proposals[1], 'a', [first.change]);
    expect(second.state.notes.find(note => note.id === 'fixture-definition')!.blocks).toMatchObject([{ text: '修改第一段' }, { text: '修改第二段' }]);
    const user = structuredClone(first.state); user.notes.find(note => note.id === 'fixture-definition')!.title = '用户后来更改';
    expect(() => applyAiProposal(user, ctx.proposals[1], 'a', [first.change])).toThrow(/变化/);
  });

  it('requires complete paginated note reads for whole-note operations', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks[0] = { id: 'long', type: 'paragraph', text: '文'.repeat(15000) };
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'long' });
    const edit = { action: 'note-update', noteId: 'fixture-definition', fields: { title: '更新标题' } };
    expect(() => executeAiTool(ctx, 'propose_edit', edit)).toThrow(/完整.*读取|完整.*分页|完整.*笔记/);
    const first = executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' }) as { nextOffset: number };
    expect(() => executeAiTool(ctx, 'propose_edit', edit)).toThrow(/完整/);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition', offset: first.nextOffset });
    expect(executeAiTool(ctx, 'propose_edit', edit)).toMatchObject({ status: '等待用户审阅' });
  });

  it('paginates large note attributes without losing complete-read requirements', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.frontmatter = { details: '属'.repeat(24000) };
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    const edit = { action: 'note-update', noteId: 'fixture-definition', fields: { title: '新标题' } };
    const first = executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' }) as { nextMetadataOffset: number; metadataJson: string };
    expect(first.nextMetadataOffset).toBeGreaterThan(0);
    expect(first.metadataJson.length).toBeLessThan(12000);
    expect(() => executeAiTool(ctx, 'propose_edit', edit)).toThrow(/完整/);
    let next: number | null = first.nextMetadataOffset;
    while (next !== null) next = (executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition', metadataOffset: next }) as { nextMetadataOffset: number | null }).nextMetadataOffset;
    expect(executeAiTool(ctx, 'propose_edit', edit)).toMatchObject({ status: '等待用户审阅' });
    expect(ctx.readCharacters).toBeLessThanOrEqual(100000);
  });

  it('does not expose unknown nested block or dictionary fields', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'media', type: 'media', kind: 'image', source: Object.assign({ type: 'url' as const, url: 'https://example.test/image.png' }, { private: 'PRIVATE_NESTED_FIELD' }) });
    Object.assign(state.symbols.find(entry => entry.id === 'example-matrix')!.slots[0], { private: 'PRIVATE_DICTIONARY_FIELD' });
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    expect(JSON.stringify(executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'media' }))).not.toContain('PRIVATE_NESTED_FIELD');
    expect(JSON.stringify(executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'example-matrix' }))).not.toContain('PRIVATE_DICTIONARY_FIELD');
  });

  it('does not accept plugin payloads as evidence of known attachments', () => {
    const state = createNotebookFixture(), assetId = 'a'.repeat(64);
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'plugin', type: 'external', provider: 'unknown', contentType: 'record', schemaVersion: 1, title: '公开', summary: '', data: { resource: { type: 'asset', assetId } } });
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'block-insert', noteId: 'fixture-definition', blockType: 'media', fields: { kind: 'image', source: { type: 'asset', assetId } } })).toThrow(/附件/);
  });

  it('hides unauthorized map selection and disallows editing a global map through a partial scope', () => {
    const state = ensureTheoryMaps(createNotebookFixture());
    state.theoryMaps!.documents.find(doc => doc.id === 'global')!.view.selectedNodeId = JSON.stringify(['fixture-summary', null]);
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    const result = executeAiTool(ctx, 'read_theory_maps', { mapId: 'global' });
    expect(JSON.stringify(result)).not.toContain('fixture-summary');
    expect(() => executeAiTool(ctx, 'propose_edit', { action: 'map-update', mapId: 'global', fields: { title: '局部修改全局' } })).toThrow(/范围/);
  });

  it('requires dictionary reads before introducing formula symbol references', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_note', { noteId: 'fixture-definition' });
    const edit = { action: 'block-insert', noteId: 'fixture-definition', blockType: 'formula', fields: { tex: 'K', parts: [{ type: 'symbol', entryId: 'example-matrix', bindings: {} }] } };
    expect(() => executeAiTool(ctx, 'propose_edit', edit)).toThrow(/词条|符号.*读取|读取.*符号/);
    executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'example-matrix' });
    expect(executeAiTool(ctx, 'propose_edit', edit)).toMatchObject({ status: '等待用户审阅' });
  });

  it('returns action-specific schemas instead of advertising content fields for deletion', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', []);
    const schema = executeAiTool(ctx, 'get_edit_schema', { action: 'symbol-delete' }) as { fields: { properties: object }; parameters: { properties: object } };
    expect(schema.fields.properties).toEqual({});
    expect(Object.keys(schema.parameters.properties)).toEqual(expect.arrayContaining(['action', 'entryId']));
    expect(schema.parameters.properties).not.toHaveProperty('noteId');
    expect(() => executeAiTool(ctx, 'get_edit_schema', { action: 'block-update' })).toThrow(/类型/);
  });

  it('returns all declared symbol snapshot fields while keeping private extensions out', () => {
    const state = createNotebookFixture();
    const original = state.symbols.find(entry => entry.id === 'example-matrix')!.slots[0];
    const ctx = createAiToolContext(state, 'a', []);
    const result = executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'example-matrix' }) as { entry: { slots: object[] } };
    expect(result.entry.slots[0]).toMatchObject({ label: original.label, domain: original.domain });
  });

  it('does not browse or read unrelated theory map titles through a partial note scope', () => {
    const state = ensureTheoryMaps(createNotebookFixture());
    const global = state.theoryMaps!.documents.find(doc => doc.id === 'global')!;
    state.theoryMaps!.documents.push({ ...structuredClone(global), id: 'private-map', kind: 'topic', title: 'PRIVATE_MAP_TITLE', noteIds: ['fixture-summary'] });
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    expect(JSON.stringify(executeAiTool(ctx, 'read_theory_maps', {}))).not.toContain('PRIVATE_MAP_TITLE');
    expect(() => executeAiTool(ctx, 'read_theory_maps', { mapId: 'private-map' })).toThrow(/范围/);
  });

  it('describes mandatory map membership and complete relation fields in precise schemas', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', []);
    const map = executeAiTool(ctx, 'get_edit_schema', { action: 'map-create' }) as { fields: { required: string[] } };
    expect(map.fields.required).toContain('noteIds');
    const relation = executeAiTool(ctx, 'get_edit_schema', { action: 'relation-save' }) as { fields: { required: string[] } };
    expect(relation.fields.required).toEqual(expect.arrayContaining(['source', 'target', 'kind', 'description']));
  });

  it('cannot use one colon-delimited block address to authorize a different note and block', () => {
    const state = createNotebookFixture(), template = state.notes.find(note => note.id === 'fixture-definition')!;
    state.notes.push({ ...template, id: 'a:b', blocks: [{ id: 'c', type: 'paragraph', text: '甲' }] }, { ...template, id: 'a', blocks: [{ id: 'b:c', type: 'paragraph', text: '乙' }] });
    const ctx = createAiToolContext(state, 'a', ['a:b', 'a']);
    executeAiTool(ctx, 'read_note', { noteId: 'a' });
    executeAiTool(ctx, 'read_block', { noteId: 'a:b', blockId: 'c' });
    expect(() => assertNativeEditAccess(ctx, { action: 'block-update', noteId: 'a', blockId: 'b:c', fields: { text: '越界改写' } })).toThrow(/读取/);
  });

  it('requires complete child reads before removing a populated tab and keeps permission checks pure', () => {
    const state = createNotebookFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 'a', title: '甲', blocks: [{ id: 'child', type: 'paragraph', text: '用户内容' }] }, { id: 'b', title: '乙', blocks: [] }] }];
    const ctx = createAiToolContext(state, 'a', ['fixture-definition']);
    executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'tabs' });
    const edit = { action: 'tab-delete', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'a' };
    expect(() => assertNativeEditAccess(ctx, edit)).toThrow(/读取/);
    executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'child' });
    const before = structuredClone(ctx);
    assertNativeEditAccess(ctx, edit);
    expect(ctx).toEqual(before);
    expect(executeAiTool(ctx, 'propose_edit', edit)).toMatchObject({ status: '等待用户审阅' });
  });

  it('does not grant a full block or dictionary read when the budget rejects the response', () => {
    const ctx = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']); ctx.readCharacters = 99999;
    expect(() => executeAiTool(ctx, 'read_block', { noteId: 'fixture-definition', blockId: 'fixture-definition:text' })).toThrow(/上限/);
    expect(() => executeAiTool(ctx, 'read_dictionary_entry', { kind: 'symbol', entryId: 'example-matrix' })).toThrow(/上限/);
    expect([...ctx.readBlockIds, ...ctx.readDictionaryIds, ...ctx.sourceIds]).toEqual([]);
    expect(ctx.readCharacters).toBe(99999);
  });
});
