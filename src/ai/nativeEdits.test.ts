import { describe, expect, it, vi } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { defaultTabsAppearance } from '../domain/researchExamples.ts';
import { createTermEntry } from '../domain/researchTerms.ts';
import { prepareNativeEdit, runNativeEdit, nativeEditEffects, restoreNativeEffects } from './nativeEdits.ts';
import { applyNativeProposal, createNativeProposal } from './nativeProposals.ts';
import { renderedFormulaTex } from '../domain/researchNotebook.ts';

function fixture() {
  const state = createNotebookFixture();
  state.notes.find(note => note.id === 'fixture-definition')!.blocks = [{ id: 'tabs', type: 'examples', title: '通信事件', appearance: { ...defaultTabsAppearance }, tabs: [
    { id: 'tab-a', title: '事件说明', blocks: [{ id: 'inside', type: 'paragraph', text: '原来的说明。' }] },
    { id: 'tab-b', title: '补充说明', blocks: [] },
  ] }];
  state.terms = [createTermEntry({ name: '闭环', meaning: '反馈结构', aliases: [], englishName: 'Closed loop' }, 'closed-loop')];
  return state;
}

describe('Agent native domain edits', () => {
  it('updates nested rendered content and tab names without replacing sibling IDs', () => {
    const state = fixture(), saved = JSON.stringify(state);
    const edit = prepareNativeEdit(state, { action: 'block-update', noteId: 'fixture-definition', blockId: 'inside', fields: { text: '改后的事件说明。' } });
    const changed = runNativeEdit(state, edit);
    const renamed = runNativeEdit(changed, prepareNativeEdit(changed, { action: 'tab-update', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'tab-a', title: '控制闭环通信事件' }));
    expect(renamed.notes.find(note => note.id === 'fixture-definition')!.blocks[0]).toMatchObject({ id: 'tabs', tabs: [
      { id: 'tab-a', title: '控制闭环通信事件', blocks: [{ id: 'inside', text: '改后的事件说明。' }] }, { id: 'tab-b', blocks: [] },
    ] });
    expect(JSON.stringify(state)).toBe(saved);
  });

  it('inserts and moves blocks into a named tab and preserves generated IDs on replay', () => {
    const state = fixture();
    const edit = prepareNativeEdit(state, { action: 'block-insert', noteId: 'fixture-definition', blockType: 'formula', fields: { tex: 'E = mc^2' }, container: { exampleBlockId: 'tabs', tabId: 'tab-b' } });
    const first = runNativeEdit(state, edit), second = runNativeEdit(state, edit);
    expect(first.notes.find(note => note.id === 'fixture-definition')!.blocks).toEqual(second.notes.find(note => note.id === 'fixture-definition')!.blocks);
    const moved = runNativeEdit(first, prepareNativeEdit(first, { action: 'block-move', noteId: 'fixture-definition', blockId: 'inside', container: { exampleBlockId: 'tabs', tabId: 'tab-b' } }));
    expect(moved.notes.find(note => note.id === 'fixture-definition')!.blocks[0]).toMatchObject({ tabs: [{ blocks: [] }, { blocks: [{ type: 'formula' }, { id: 'inside' }] }] });
  });

  it('edits full symbol fields with native rename aliases and review invalidation', () => {
    const state = fixture();
    state.notes.find(note => note.id === 'fixture-application')!.reviewStatus = 'reviewed';
    const edit = prepareNativeEdit(state, { action: 'symbol-save', entryId: 'example-matrix', fields: { name: '映射算子', meaning: '更新后的含义', aliases: ['映射矩阵'], unit: '无量纲', scope: '线性系统', tags: ['数学/线性'] } });
    const next = runNativeEdit(state, edit);
    expect(next.symbols.find(symbol => symbol.id === 'example-matrix')).toMatchObject({ id: 'example-matrix', name: '映射算子', aliases: ['映射矩阵', '线性映射矩阵'], unit: '无量纲', scope: '线性系统', tags: ['数学/线性'] });
    expect(next.notes.find(note => note.id === 'fixture-application')!.reviewStatus).toBe('pending');
    const restored = restoreNativeEffects(next, nativeEditEffects(state, next));
    expect(restored.symbols).toEqual(state.symbols);
    expect(restored.notes).toEqual(state.notes);
  });

  it('edits every term field while preserving stable alias IDs and clearing optional fields', () => {
    const state = fixture();
    const next = runNativeEdit(state, prepareNativeEdit(state, { action: 'term-save', entryId: 'closed-loop', fields: { englishName: '', englishAbbreviation: 'CL', chineseAbbreviation: '闭环', aliasEntries: [{ id: 'alias-1', name: '反馈环路' }], atoms: [{ id: 'atom-1', text: '闭', meaning: '闭合' }, { id: 'atom-2', text: '环', meaning: '环路' }], scope: '控制系统', tags: ['控制'], status: 'deprecated' } }));
    expect(next.terms![0]).toMatchObject({ id: 'closed-loop', englishAbbreviation: 'CL', chineseAbbreviation: '闭环', aliases: ['反馈环路'], aliasEntries: [{ id: 'alias-1', name: '反馈环路' }], atoms: [{ id: 'atom-1' }, { id: 'atom-2' }], scope: '控制系统', status: 'deprecated' });
    expect(next.terms![0].englishName).toBeUndefined();
    expect(() => prepareNativeEdit(state, { action: 'term-save', entryId: 'closed-loop', fields: { atoms: [{ text: '反馈', meaning: '不覆盖名称' }] } })).toThrow(/完整覆盖/);
  });

  it('uses native metadata validation and preserves custom attributes and block contents', () => {
    const state = fixture();
    state.notes.find(note => note.id === 'fixture-definition')!.frontmatter = { custom: '保留' };
    const next = runNativeEdit(state, prepareNativeEdit(state, { action: 'note-update', noteId: 'fixture-definition', fields: { title: '事件笔记', tags: ['系统/事件'], reviewStatus: 'reviewing', researchType: 'derivation' } }));
    expect(next.notes.find(note => note.id === 'fixture-definition')).toMatchObject({ title: '事件笔记', tags: ['系统/事件'], reviewStatus: 'reviewing', researchType: 'derivation', frontmatter: { custom: '保留' } });
    expect(next.notes.find(note => note.id === 'fixture-definition')!.blocks).toEqual(state.notes.find(note => note.id === 'fixture-definition')!.blocks);
    expect(() => prepareNativeEdit(state, { action: 'note-update', noteId: 'fixture-definition', fields: { id: 'different' } })).toThrow();
  });

  it('rejects invalid fields, broken containers, private plugin payloads and referenced deletions', () => {
    const state = fixture();
    expect(() => prepareNativeEdit(state, { action: 'symbol-delete', entryId: 'example-matrix' })).toThrow(/引用/);
    expect(() => prepareNativeEdit(state, { action: 'block-update', noteId: 'fixture-definition', blockId: 'inside', fields: { tex: 'x' } })).toThrow();
    expect(() => prepareNativeEdit(state, { action: 'block-insert', noteId: 'fixture-definition', blockType: 'external', fields: { data: { secret: true } } })).toThrow();
    expect(() => prepareNativeEdit(state, { action: 'block-insert', noteId: 'fixture-definition', blockType: 'paragraph', fields: { text: '追加' }, container: { exampleBlockId: 'tabs', tabId: 'missing' } })).toThrow();
    state.notes.find(note => note.id === 'fixture-summary')!.blocks.push({ id: 'ref', type: 'paragraph', text: '[闭环](mewiki-term:closed-loop)' });
    expect(() => prepareNativeEdit(state, { action: 'term-delete', entryId: 'closed-loop' })).toThrow(/引用/);
  });

  it('does not undo side effects over later user edits', () => {
    const state = fixture();
    state.notes.find(note => note.id === 'fixture-application')!.reviewStatus = 'reviewed';
    const next = runNativeEdit(state, prepareNativeEdit(state, { action: 'symbol-save', entryId: 'example-matrix', fields: { meaning: '新定义' } }));
    const effects = nativeEditEffects(state, next);
    next.notes.find(note => note.id === 'fixture-application')!.title = '用户后来修改';
    expect(() => restoreNativeEffects(next, effects)).toThrow(/变化|撤回/);
  });

  it('creates symbols, terms, tabs, content references and theory maps with stable IDs', () => {
    const state = fixture();
    for (const input of [
      { action: 'symbol-save', fields: { name: '速度', notation: 'v', meaning: '单位时间的位移', unit: 'm/s' } },
      { action: 'term-save', fields: { name: '采样', meaning: '离散观测', aliases: ['定时观测'] } },
      { action: 'tab-insert', noteId: 'fixture-definition', blockId: 'tabs', title: '新标签' },
      { action: 'block-insert', noteId: 'fixture-definition', blockType: 'noteEmbed', fields: { sourceNoteId: 'fixture-summary', blockIds: ['fixture-summary:text'] } },
      { action: 'map-create', fields: { title: '控制系统', noteIds: ['fixture-definition', 'fixture-summary'] } },
    ]) {
      const edit = prepareNativeEdit(state, input), first = runNativeEdit(state, edit), second = runNativeEdit(state, edit);
      expect(nativeEditEffects(state, first).length).toBeGreaterThan(0);
      expect(JSON.stringify(first)).toContain(edit.generatedId);
      expect(JSON.stringify(second)).toContain(edit.generatedId);
    }
  });

  it('rejects deleting or changing formula results that have consumers', () => {
    const state = fixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'producer', type: 'formula', tex: 'x', outputs: [{ id: 'out', entryId: 'example-matrix', bindings: {} }] });
    state.notes.find(note => note.id === 'fixture-summary')!.blocks.push({ id: 'consumer', type: 'formula', tex: '', parts: [{ type: 'symbol', entryId: 'example-matrix', bindings: {}, source: { noteId: 'fixture-definition', formulaId: 'producer', outputId: 'out' } }] });
    expect(() => prepareNativeEdit(state, { action: 'block-delete', noteId: 'fixture-definition', blockId: 'producer' })).toThrow(/引用/);
    expect(() => prepareNativeEdit(state, { action: 'block-update', noteId: 'fixture-definition', blockId: 'producer', fields: { outputs: [{ id: 'out', entryId: 'example-input', bindings: {} }] } })).toThrow(/引用/);
  });

  it('validates inserted formula output identities and source symbol compatibility', () => {
    const state = fixture();
    state.notes[0].blocks.push({ id: 'producer', type: 'formula', tex: 'x', outputs: [{ id: 'out', entryId: 'example-matrix', bindings: {} }] });
    const insert = { action: 'block-insert', noteId: 'fixture-definition', blockType: 'formula' };
    expect(() => prepareNativeEdit(state, { ...insert, fields: { tex: 'x', outputs: [
      { id: 'same', entryId: 'example-matrix', bindings: {} }, { id: 'same', entryId: 'example-input', bindings: {} },
    ] } })).toThrow(/标识|重复/);
    expect(() => prepareNativeEdit(state, { ...insert, fields: { tex: '', parts: [{ type: 'symbol', entryId: 'example-input', bindings: {}, source: { noteId: state.notes[0].id, formulaId: 'producer', outputId: 'out' } }] } })).toThrow(/符号|一致/);
  });

  it('uses a TeX update as the displayed formula with omitted or explicitly empty parts', () => {
    const state = fixture();
    for (const fields of [{ tex: 'E=mc^2' }, { tex: 'E=mc^2', parts: [] }]) {
      const next = runNativeEdit(state, prepareNativeEdit(state, { action: 'block-update', noteId: 'fixture-application', blockId: 'fixture-application:formula', fields }));
      const block = next.notes.find(note => note.id === 'fixture-application')!.blocks.find(block => block.id === 'fixture-application:formula')!;
      expect(block.type).toBe('formula');
      if (block.type === 'formula') {
        expect(block.parts).toBeUndefined();
        expect(renderedFormulaTex(block, next.symbols).tex).toBe('E=mc^2');
      }
    }
  });

  it('freezes map creation IDs and timestamps across review, approval and repeated replay', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime('2026-11-12T00:00:00.000Z');
      const state = fixture(), proposal = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '稳定地图', noteIds: ['fixture-definition'] } });
      const preview = runNativeEdit(state, proposal.edit);
      vi.setSystemTime('2026-11-12T02:00:00.000Z');
      const applied = applyNativeProposal(state, proposal, 'a');
      expect(applied.state.theoryMaps).toEqual(preview.theoryMaps);
      expect(applied.state.theoryMaps!.documents.find(map => map.id === proposal.targetId)).toMatchObject({ createdAt: '2026-11-12T00:00:00.000Z' });
      expect(() => prepareNativeEdit(state, { action: 'map-create', mapId: 'global', fields: { title: '另一个地图' } })).toThrow(/字段|目标/);
    } finally { vi.useRealTimers(); }
  });

  it('preserves a renamed term as an alias and keeps references pending for review', () => {
    const state = fixture();
    state.notes[1].reviewStatus = 'reviewed';
    state.notes[1].blocks.push({ id: 'term-link', type: 'paragraph', text: '[闭环](mewiki-term:closed-loop)' });
    const edit = prepareNativeEdit(state, { action: 'term-save', entryId: 'closed-loop', fields: { name: '闭环系统' } });
    const next = runNativeEdit(state, edit);
    expect(next.terms![0]).toMatchObject({ id: 'closed-loop', name: '闭环系统', aliases: ['闭环'], aliasEntries: [{ name: '闭环' }] });
    expect(next.notes[1].reviewStatus).toBe('pending');
    expect(runNativeEdit(state, edit).terms).toEqual(next.terms);
    state.terms!.push(createTermEntry({ name: '反馈系统', meaning: '另一个术语', aliases: [] }, 'other'));
    expect(() => prepareNativeEdit(state, { action: 'term-save', entryId: 'closed-loop', fields: { name: '反馈系统' } })).toThrow(/已存在/);
  });

  it('protects block selections in content references and theory maps from deletion', () => {
    const state = fixture();
    state.notes[1].blocks.push({ id: 'selection', type: 'noteEmbed', sourceNoteId: 'fixture-definition', blockIds: ['inside'] });
    expect(() => prepareNativeEdit(state, { action: 'block-delete', noteId: 'fixture-definition', blockId: 'inside' })).toThrow(/引用/);
    expect(() => prepareNativeEdit(state, { action: 'tab-delete', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'tab-a' })).toThrow(/引用/);
    state.notes[1].blocks.pop();
    const mapped = runNativeEdit(state, prepareNativeEdit(state, { action: 'map-create', fields: { title: '引用地图', noteIds: ['fixture-definition'], annotations: [{ ref: { noteId: 'fixture-definition', blockId: 'inside' }, role: 'model' }] } }));
    expect(() => prepareNativeEdit(mapped, { action: 'block-delete', noteId: 'fixture-definition', blockId: 'inside' })).toThrow(/引用/);
    expect(() => prepareNativeEdit(mapped, { action: 'note-delete', noteId: 'fixture-definition' })).toThrow(/引用/);
  });

  it('refuses to undo a new formula once another note consumes its output', () => {
    const state = fixture();
    const edit = prepareNativeEdit(state, { action: 'block-insert', noteId: 'fixture-definition', blockType: 'formula', fields: { tex: 'x', outputs: [{ id: 'result', entryId: 'example-matrix', bindings: {} }] } });
    const next = runNativeEdit(state, edit), effects = nativeEditEffects(state, next);
    next.notes.find(note => note.id === 'fixture-summary')!.blocks.push({ id: 'new-consumer', type: 'formula', tex: '', parts: [{ type: 'symbol', entryId: 'example-matrix', bindings: {}, source: { noteId: 'fixture-definition', formulaId: edit.generatedId, outputId: 'result' } }] });
    expect(() => restoreNativeEffects(next, effects)).toThrow(/引用|撤回/);
  });

  it('chains a tab rename after an approved nested edit without accepting later user changes', () => {
    const state = fixture();
    const text = createNativeProposal(state, 'a', { action: 'block-update', noteId: 'fixture-definition', blockId: 'inside', fields: { text: '批准的新内容' } });
    const tab = createNativeProposal(state, 'a', { action: 'tab-update', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'tab-a', title: '批准的新标题' });
    const first = applyNativeProposal(state, text, 'a');
    const second = applyNativeProposal(first.state, tab, 'a', [first.change]);
    expect(second.state.notes.find(note => note.id === 'fixture-definition')!.blocks[0]).toMatchObject({ tabs: [{ title: '批准的新标题', blocks: [{ text: '批准的新内容' }] }, { id: 'tab-b' }] });
    const user = structuredClone(first.state); user.notes.find(note => note.id === 'fixture-definition')!.title = '用户编辑';
    expect(() => applyNativeProposal(user, tab, 'a', [first.change])).toThrow(/变化/);
    const rename = createNativeProposal(state, 'a', { action: 'tab-update', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'tab-a', title: '另一建议先改名' });
    const renamed = applyNativeProposal(state, rename, 'a');
    expect(() => applyNativeProposal(renamed.state, tab, 'a', [renamed.change])).toThrow(/变化/);
  });

  it('supports the three editable symbol positions and rejects fields fixed by the native editor', () => {
    const state = fixture();
    const slots = ['x1', 'x2', 'x3'].map(key => ({ key, defaultValue: key === 'x2' ? 'j' : '', description: `位置 ${key}` }));
    const next = runNativeEdit(state, prepareNativeEdit(state, { action: 'symbol-save', entryId: 'example-matrix', fields: { slots } }));
    expect(next.symbols.find(symbol => symbol.id === 'example-matrix')!.slots).toMatchObject(slots);
    for (const fixed of [{ label: '自定义' }, { domain: 'loop' }, { optional: false }, { examples: ['示例'] }, { placement: 'inline' }]) {
      expect(() => prepareNativeEdit(state, { action: 'symbol-save', entryId: 'example-matrix', fields: { slots: slots.map((slot, index) => index === 0 ? { ...slot, ...fixed } : slot) } })).toThrow(/字段/);
    }
  });

  it('rejects duplicate stable term records instead of dropping requested fields', () => {
    const state = fixture();
    expect(() => prepareNativeEdit(state, { action: 'term-save', entryId: 'closed-loop', fields: { aliasEntries: [{ id: 'duplicate', name: '环路' }, { id: 'duplicate', name: '反馈结构' }] } })).toThrow(/标识|重复/);
    expect(() => prepareNativeEdit(state, { action: 'term-save', entryId: 'closed-loop', fields: { atoms: [{ id: 'duplicate', text: '闭', meaning: '闭合' }, { id: 'duplicate', text: '环', meaning: '环路' }] } })).toThrow(/标识|重复/);
  });

  it('undoes map content after navigation while preserving current navigation and protecting later content', () => {
    let state = fixture();
    const added = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '原始地图' } });
    state = applyNativeProposal(state, added, 'a').state;
    const edit = prepareNativeEdit(state, { action: 'map-update', mapId: added.targetId, fields: { title: 'AI 修改地图' } });
    const next = runNativeEdit(state, edit), effects = nativeEditEffects(state, next);
    next.theoryMaps!.activeMapId = 'global'; next.theoryMaps!.noteViewOpen = true;
    next.theoryMaps!.noteViews['fixture-definition'] = { expandedNoteIds: ['fixture-definition'], showAllBlocks: true, depth: 3, selectedNodeId: 'selected', layout: { positions: {}, viewport: { x: 12, y: 34, zoom: 2 } } };
    const document = next.theoryMaps!.documents.find(map => map.id === added.targetId)!;
    document.view = { ...document.view, expandedNoteIds: ['fixture-summary'], selectedNodeId: 'user-selection', showAllBlocks: true, layout: { ...document.view.layout, viewport: { x: 5, y: 9, zoom: 1.5 } } };
    const restored = restoreNativeEffects(next, effects);
    expect(restored.theoryMaps).toMatchObject({ activeMapId: 'global', noteViewOpen: true, noteViews: next.theoryMaps!.noteViews });
    expect(restored.theoryMaps!.documents.find(map => map.id === added.targetId)).toMatchObject({ title: '原始地图', view: document.view });
    const later = structuredClone(next); later.theoryMaps!.documents.find(map => map.id === added.targetId)!.title = '用户后来改名';
    expect(() => restoreNativeEffects(later, effects)).toThrow(/变化/);
    expect(nativeEditEffects(state, { ...state, theoryMaps: { ...state.theoryMaps!, activeMapId: 'global', noteViewOpen: true } })).toEqual([]);
  });

  it('protects and restores view paths explicitly changed by AI without rolling back unrelated navigation', () => {
    let state = fixture();
    const added = createNativeProposal(state, 'a', { action: 'map-create', fields: { title: '地图' } });
    state = applyNativeProposal(state, added, 'a').state;
    const next = runNativeEdit(state, prepareNativeEdit(state, { action: 'map-update', mapId: added.targetId, fields: { view: { expandedNoteIds: ['fixture-definition'], layout: { positions: {}, viewport: { x: 7, y: 8, zoom: 2 } } } } }));
    const effects = nativeEditEffects(state, next); expect(effects.length).toBeGreaterThan(0);
    next.theoryMaps!.documents.find(map => map.id === added.targetId)!.view.selectedNodeId = 'user-selected';
    const restored = restoreNativeEffects(next, effects);
    expect(restored.theoryMaps!.documents.find(map => map.id === added.targetId)!.view).toMatchObject({ expandedNoteIds: [], selectedNodeId: 'user-selected' });
    expect(restored.theoryMaps!.documents.find(map => map.id === added.targetId)!.view.layout.viewport).toBeUndefined();
    next.theoryMaps!.documents.find(map => map.id === added.targetId)!.view.expandedNoteIds = ['fixture-summary'];
    expect(() => restoreNativeEffects(next, effects)).toThrow(/变化/);
  });

  it('uses stable initialization when reviewing and approving an uninitialized global map', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime('2026-11-12T00:00:00.000Z');
      const state = fixture(); delete state.theoryMaps; delete state.theoryMap;
      const proposal = createNativeProposal(state, 'a', { action: 'map-update', mapId: 'global', fields: { title: '新全局地图' } });
      vi.setSystemTime('2026-11-12T03:00:00.000Z');
      const applied = applyNativeProposal(state, proposal, 'a');
      expect(applied.state.theoryMaps!.documents.find(map => map.id === 'global')!.title).toBe('新全局地图');
    } finally { vi.useRealTimers(); }
  });

  it('keeps the service-managed updatedAt timestamp outside the editable note contract', () => {
    expect(() => prepareNativeEdit(fixture(), { action: 'note-update', noteId: 'fixture-definition', fields: { updatedAt: '2026-11-12T00:00:00.000Z' } })).toThrow(/字段/);
  });

  it('deletes exact unreferenced IDs despite ordinary titles and dictionary ID prefixes', () => {
    const state = fixture();
    state.notes.push({ id: 'isolated', title: '单独笔记', createdAt: '2025-01-01', updatedAt: '2025-01-01', blocks: [] });
    state.notes[0].title = 'isolated example';
    state.terms!.push(createTermEntry({ name: '闭环扩展', meaning: '另一个词条', aliases: [] }, 'closed-loop-extra'));
    state.notes[0].blocks.push({ id: 'other-reference', type: 'paragraph', text: '[另一术语](mewiki-term:closed-loop-extra)' });
    expect(runNativeEdit(state, prepareNativeEdit(state, { action: 'note-delete', noteId: 'isolated' })).notes.some(note => note.id === 'isolated')).toBe(false);
    expect(runNativeEdit(state, prepareNativeEdit(state, { action: 'term-delete', entryId: 'closed-loop' })).terms!.some(term => term.id === 'closed-loop')).toBe(false);
    state.notes[0].blocks.push({ id: 'real-ref', type: 'paragraph', text: '[真实引用](#research-note/isolated)' });
    expect(() => prepareNativeEdit(state, { action: 'note-delete', noteId: 'isolated' })).toThrow(/引用/);
    state.notes[0].blocks.push({ id: 'real-term-ref', type: 'paragraph', text: '[真实术语][term]\n\n[term]: mewiki-term:closed-loop' });
    expect(() => prepareNativeEdit(state, { action: 'term-delete', entryId: 'closed-loop' })).toThrow(/引用/);
  });

  it('protects exact nested IDs in unknown plugin data without treating the root block ID as a reference', () => {
    const state = fixture();
    state.notes.push({ id: 'isolated', title: '单独笔记', createdAt: '2025-01-01', updatedAt: '2025-01-01', blocks: [] });
    const block = { id: 'isolated', type: 'external' as const, provider: 'unknown', contentType: 'record', schemaVersion: 99, title: '保留', summary: '摘要', data: { related: { id: 'another' } } };
    state.notes[0].blocks.push(block);
    expect(() => prepareNativeEdit(state, { action: 'note-delete', noteId: 'isolated' })).not.toThrow();
    block.data.related.id = 'isolated';
    expect(() => prepareNativeEdit(state, { action: 'note-delete', noteId: 'isolated' })).toThrow(/引用/);
    block.data.related.id = 'closed-loop';
    expect(() => prepareNativeEdit(state, { action: 'term-delete', entryId: 'closed-loop' })).toThrow(/引用/);
  });
});
