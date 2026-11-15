import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { aiReferenceContext, aiReferenceError, aiCurrentReference, quickAiPrompts, resolveAiReference, restoreAiReferences, searchAiReferences } from './references.ts';

function notebook() {
  const state = createNotebookFixture();
  state.activeNoteId = 'fixture-definition';
  state.view = 'notes';
  state.notes.find(note => note.id === 'fixture-definition')!.tags = ['示例/定义'];
  state.symbols.find(symbol => symbol.id === 'example-vector')!.aliases = ['State vector'];
  state.terms = [{ id: 'term-vector', name: '状态空间', englishName: 'State space', englishAbbreviation: 'SS', aliases: ['向量空间'], meaning: '仅用于测试的定义。', tags: ['数学/空间'] }];
  state.theoryMaps = {
    version: 1, activeMapId: 'map-vector', deletedMapIds: [], noteViewOpen: false, noteViews: {},
    documents: [{ id: 'map-vector', title: '状态关系图', kind: 'topic', createdAt: '', updatedAt: '', noteIds: ['fixture-definition'], annotations: [], relations: [], view: { expandedNoteIds: [], showAllBlocks: false, layout: { positions: {} } } }],
  };
  return state;
}

describe('AI stable object references', () => {
  it('restores stable identities, deduplicates and discards display metadata', () => {
    expect(restoreAiReferences([{ kind: 'note', id: 'a', label: '旧标题' }, { kind: 'note', id: 'a' }, { kind: 'symbol', id: 'a' }])).toEqual([{ kind: 'note', id: 'a' }, { kind: 'symbol', id: 'a' }]);
    expect(restoreAiReferences([])).toEqual([]);
  });

  it('rejects damaged and unbounded reference lists instead of silently widening the scope', () => {
    for (const value of [undefined, null, {}, [{ kind: 'file', id: 'a' }], [{ kind: 'note', id: '' }], [{ kind: 'note', id: ' '.repeat(2) }], [{ kind: 'note', id: 'x'.repeat(1001) }], [{ kind: 'note', id: 1 }], [{ kind: 'note', id: 'a' }, null], Array.from({ length: 13 }, (_, id) => ({ kind: 'note', id: String(id) }))]) {
      expect(restoreAiReferences(value)).toBeUndefined();
    }
  });

  it('uses the page kind and never borrows an earlier note from a dictionary or map page', () => {
    const state = notebook();
    expect(aiCurrentReference(state)).toEqual({ kind: 'note', id: 'fixture-definition' });
    state.view = 'dictionary'; state.activeSymbolId = 'example-vector';
    expect(aiCurrentReference(state)).toEqual({ kind: 'symbol', id: 'example-vector' });
    state.activeTermId = 'term-vector';
    expect(aiCurrentReference(state)).toEqual({ kind: 'term', id: 'term-vector' });
    state.activeTermId = 'removed';
    expect(aiCurrentReference(state)).toBeUndefined();
    state.view = 'maps';
    expect(aiCurrentReference(state)).toEqual({ kind: 'map', id: 'map-vector' });
    state.theoryMaps!.activeMapId = 'removed';
    expect(aiCurrentReference(state)).toBeUndefined();
  });

  it('does not treat a stale research selection as the current foundation page', () => {
    const state = notebook(); state.view = 'foundations';
    expect(aiCurrentReference(state)).toBeUndefined();
    state.notes.find(note => note.id === state.activeNoteId)!.library = 'foundation';
    expect(aiCurrentReference(state)).toEqual({ kind: 'note', id: 'fixture-definition' });
  });

  it('finds modules by aliases and English without reading note text', () => {
    const state = notebook();
    expect(searchAiReferences(state, '符号库')[0]).toMatchObject({ kind: 'module', id: 'symbols', label: '符号词典' });
    expect(searchAiReferences(state, 'term dictionary').some(item => item.kind === 'module' && item.id === 'terms')).toBe(true);
    state.notes[0].blocks = [{ id: 'private', type: 'paragraph', text: '不可从引用名称搜索中读取的正文' }];
    expect(searchAiReferences(state, '不可从引用名称搜索中读取的正文')).toEqual([]);
  });

  it('searches aliases, complete default notation and term abbreviations', () => {
    const state = notebook();
    expect(searchAiReferences(state, 'STATE VECTOR')[0]).toMatchObject({ kind: 'symbol', id: 'example-vector' });
    expect(searchAiReferences(state, '\\boldsymbol{x}(t)')[0]).toMatchObject({ kind: 'symbol', id: 'example-vector' });
    expect(searchAiReferences(state, 'SS')[0]).toMatchObject({ kind: 'term', id: 'term-vector' });
    expect(searchAiReferences(state, '向量空间')[0]).toMatchObject({ kind: 'term', id: 'term-vector' });
    expect(searchAiReferences(state, '状态关系图')[0]).toMatchObject({ kind: 'map', id: 'map-vector' });
  });

  it('ranks exact names before partial names and distinguishes same-name note paths', () => {
    const state = notebook(), sample = state.notes.find(note => note.id === 'fixture-definition')!;
    state.notes.push({ ...sample, id: 'foundation-definition', library: 'foundation', tags: ['理论/基本概念'] });
    state.notes.push({ ...sample, id: 'partial', title: '关系定义补充' });
    const found = searchAiReferences(state, '关系定义');
    expect(found.slice(0, 2).map(item => item.id).sort()).toEqual(['fixture-definition', 'foundation-definition']);
    expect(found[0].detail).not.toBe(found[1].detail);
    expect(found.find(item => item.id === 'fixture-definition')?.detail).toContain('示例/定义');
    expect(found.find(item => item.id === 'foundation-definition')?.detail).toContain('基础理论');
  });

  it('disambiguates same-name objects in the same path using their stable identity', () => {
    const state = notebook(), sample = state.notes.find(note => note.id === 'fixture-definition')!;
    state.notes.push({ ...sample, id: 'copy-definition' });
    const found = searchAiReferences(state, '关系定义');
    expect(found).toHaveLength(2);
    expect(found[0].detail).toContain('fixture-definition');
    expect(found[1].detail).toContain('copy-definition');
  });

  it('bounds result counts and display text', () => {
    const state = notebook(), sample = state.notes[0];
    state.notes = Array.from({ length: 200 }, (_, index) => ({ ...sample, id: String(index), title: '查找' + '文'.repeat(2000), tags: ['分类/'.repeat(500)] }));
    const found = searchAiReferences(state, '查找');
    expect(found.length).toBeGreaterThan(0); expect(found.length).toBeLessThanOrEqual(30);
    expect(found.every(item => item.label.length <= 180 && (item.detail?.length ?? 0) <= 320)).toBe(true);
  });

  it('projects only identities and current display metadata, reporting removed targets clearly', () => {
    const state = notebook(), refs = [{ kind: 'note' as const, id: 'fixture-definition' }, { kind: 'module' as const, id: 'terms' }];
    const context = aiReferenceContext(state, refs);
    expect(context).toHaveLength(2); expect(context[0]).toMatchObject({ kind: 'note', id: 'fixture-definition', label: '关系定义' });
    expect(JSON.stringify(context)).not.toContain('通用内容');
    expect(context.every(item => Object.keys(item).every(key => ['kind', 'id', 'label', 'detail'].includes(key)))).toBe(true);
    expect(aiReferenceError(state, refs)).toBe('');
    state.notes = state.notes.filter(note => note.id !== 'fixture-definition');
    expect(resolveAiReference(state, refs[0])).toBeUndefined();
    expect(aiReferenceError(state, refs)).toContain('fixture-definition');
  });

  it('offers prompts for the current object kind without promising unsupported operations', () => {
    const state = notebook();
    expect(quickAiPrompts(state, { kind: 'symbol', id: 'example-vector' }).map(item => item.label)).toEqual(['解释角标', '查找引用', '检查书写']);
    expect(quickAiPrompts(state, { kind: 'term', id: 'term-vector' }).map(item => item.label)).toEqual(['完善定义', '核对别名']);
    expect(quickAiPrompts(state, { kind: 'map', id: 'map-vector' }).map(item => item.label)).toEqual(['解释关系', '检查关联']);
    expect(quickAiPrompts(state, { kind: 'term', id: 'removed' })).toEqual([]);
  });
});
