import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { createTermEntry, type ResearchTermEntry } from '../domain/researchTerms.ts';
import { positionSlots, symbolPositionSuffix } from '../domain/researchSymbolPositions.ts';
import { createAiToolContext } from './tools.ts';
import { aiSymbolNotation } from './symbolNotation.ts';
import { searchAiDictionary } from './dictionarySearch.ts';

const symbol = (id: string, fields: Partial<Omit<ResearchSymbolEntry, 'id'>> = {}) => createSymbolEntry({ name: `测试符号 ${id}`, notation: 'q', meaning: '虚构符号定义。', category: 'custom', slots: [], ...fields }, id);
const term = (id: string, fields: Partial<Omit<ResearchTermEntry, 'id'>> = {}) => createTermEntry({ name: `测试术语 ${id}`, aliases: [], meaning: '虚构术语定义。', ...fields }, id);
function context(symbols: ResearchSymbolEntry[] = [], terms: ResearchTermEntry[] = []) {
  const state = createNotebookFixture();
  state.symbols = symbols; state.terms = terms;
  return createAiToolContext(state, 'fixture-dictionary', []);
}

describe('paginated AI dictionary search', () => {
  it('browses every entry on stable pages with independent totals and cursors', () => {
    const symbols = Array.from({ length: 47 }, (_, index) => symbol(`s-${String(index).padStart(3, '0')}`));
    const terms = Array.from({ length: 26 }, (_, index) => term(`t-${String(index).padStart(3, '0')}`));
    const ctx = context(symbols.toReversed(), terms.toReversed());
    const first = searchAiDictionary(ctx, {});
    expect(first).toMatchObject({ termsTotal: 26, symbolsTotal: 47, offset: 0, limit: 20, termsNextOffset: 20, symbolsNextOffset: 20 });
    expect(first.terms).toHaveLength(20); expect(first.symbols).toHaveLength(20);
    const second = searchAiDictionary(ctx, { offset: 20 });
    expect(second).toMatchObject({ termsTotal: 26, symbolsTotal: 47, termsNextOffset: null, symbolsNextOffset: 40 });
    const third = searchAiDictionary(ctx, { offset: 40 });
    expect(third).toMatchObject({ termsNextOffset: null, symbolsNextOffset: null });
    expect(third.terms).toEqual([]);
    expect([...first.symbols, ...second.symbols, ...third.symbols].map(entry => entry.id)).toEqual(symbols.map(entry => entry.id));
    expect([...first.terms, ...second.terms].map(entry => entry.id)).toEqual(terms.map(entry => entry.id));
    expect(searchAiDictionary(ctx, { offset: 100 })).toMatchObject({ terms: [], symbols: [], termsTotal: 26, symbolsTotal: 47, termsNextOffset: null, symbolsNextOffset: null });
  });

  it('filters a dictionary kind without reading the other kind', () => {
    const ctx = context([symbol('symbol')], [term('term')]);
    expect(searchAiDictionary(ctx, { kind: 'symbol', limit: 1 })).toMatchObject({ symbols: [{ id: 'symbol' }], terms: [], symbolsTotal: 1, termsTotal: 0, symbolsNextOffset: null, termsNextOffset: null, limit: 1 });
    expect(searchAiDictionary(ctx, { kind: 'term' })).toMatchObject({ symbols: [], terms: [{ id: 'term' }], symbolsTotal: 0, termsTotal: 1 });
    expect(searchAiDictionary(context(), {})).toMatchObject({ symbols: [], terms: [], symbolsTotal: 0, termsTotal: 0, symbolsNextOffset: null, termsNextOffset: null });
  });

  it('matches all keywords across names, aliases, meanings and English term fields', () => {
    const ctx = context([
      symbol('target', { name: '受控节点', aliases: ['Target Node'], meaning: '受控的虚构对象。' }),
      symbol('other', { aliases: ['Node'], meaning: '其他对象。' }),
    ], [term('term', { englishName: 'Controlled Node', englishAbbreviation: 'CN', chineseAbbreviation: '控节', aliases: ['Target'], meaning: '受控的虚构对象。' })]);
    expect(searchAiDictionary(ctx, { query: '  NODE\t 受控  ' })).toMatchObject({ symbols: [{ id: 'target' }], terms: [{ id: 'term' }], symbolsTotal: 1, termsTotal: 1 });
    for (const query of ['cn', '控节', 'CONTROLLED', 'target']) expect(searchAiDictionary(ctx, { kind: 'term', query }).terms.map(entry => entry.id)).toEqual(['term']);
    expect(searchAiDictionary(ctx, { query: 'node 不存在' })).toMatchObject({ symbols: [], terms: [] });
  });

  it('uses stable term aliases and retains the existing result fields', () => {
    const entry = term('term / 中文', { name: '受控节点', englishName: 'Controlled Node', englishAbbreviation: 'CN', chineseAbbreviation: '控节', aliasEntries: [{ id: 'alias-1', name: '目标端点' }], meaning: '虚构含义。' });
    const result = searchAiDictionary(context([], [entry]), { query: '目标端点' });
    expect(result.terms).toEqual([{ id: entry.id, name: entry.name, englishName: entry.englishName, englishAbbreviation: 'CN', chineseAbbreviation: '控节', aliases: ['目标端点'], meaning: entry.meaning, url: `mewiki-term:${encodeURIComponent(entry.id)}` }]);
  });

  it('ranks exact names and aliases ahead of definition fragments', () => {
    const ctx = context([], [
      term('a-body', { name: '有关记录', meaning: '标尺的虚构观察。' }),
      term('y-alias', { name: '量度', aliases: ['标尺'] }),
      term('z-name', { name: '标尺' }),
    ]);
    const first = searchAiDictionary(ctx, { query: '标尺', limit: 2 });
    expect(first.terms.map(entry => entry.id)).toEqual(['z-name', 'y-alias']);
    expect(first).toMatchObject({ termsTotal: 3, termsNextOffset: 2 });
    expect(searchAiDictionary(ctx, { query: '标尺', offset: 2, limit: 2 }).terms.map(entry => entry.id)).toEqual(['a-body']);
  });

  it('finds and prioritizes the resolved notation while preserving fonts and case', () => {
    const target = symbol('z-tex / 中文', { name: 'TargetNode', notation: 'v' + symbolPositionSuffix, slots: positionSlots({ x2: '\\mathrm T' }) });
    const resolved = aiSymbolNotation(target);
    const ctx = context([symbol('a-body', { meaning: `这是 ${resolved.tex} 的解释。` }), target]);
    const result = searchAiDictionary(ctx, { query: resolved.tex.toLowerCase() });
    expect(result.symbols.map(entry => entry.id)).toEqual([target.id, 'a-body']);
    expect(result.symbols[0]).toMatchObject({ name: 'TargetNode', notation: target.notation, resolved, url: `mewiki-symbol:${encodeURIComponent(target.id)}` });
    expect(result.symbols[0].resolved.tex).toBe('v_{\\mathrm T}');
    expect(searchAiDictionary(ctx, { query: target.notation, kind: 'symbol' }).symbols[0]?.id).toBe(target.id);
  });

  it('only spends the shared read budget and does not grant dictionary edit permission', () => {
    const ctx = context([symbol('s')], [term('t')]);
    const state = structuredClone(ctx.state);
    const result = searchAiDictionary(ctx, {});
    expect(ctx.readCharacters).toBe(JSON.stringify(result).length);
    expect(ctx.state).toEqual(state);
    for (const values of [ctx.noteIds, ctx.sourceIds, ctx.readNoteIds, ctx.readBlockIds, ctx.readDictionaryIds, ctx.readMapIds, ctx.readFullNoteIds]) expect(values.size).toBe(0);
    expect(ctx.proposals).toEqual([]); expect(ctx.noteReadRanges.size).toBe(0);
  });

  it('cleans inline attachment data through the shared budget before returning results', () => {
    const ctx = context([], [term('t', { meaning: '虚构 data:image/png;base64,abc 说明。' })]);
    const result = searchAiDictionary(ctx, {});
    expect(result.terms[0].meaning).toBe('虚构 [内联附件已省略] 说明。');
    expect(ctx.readCharacters).toBe(JSON.stringify(result).length);
  });

  it('rejects reads over the shared budget without consuming it', () => {
    const ctx = context([symbol('s')]);
    ctx.readCharacters = 99990;
    expect(() => searchAiDictionary(ctx, {})).toThrow('本次资料读取已达到上限');
    expect(ctx.readCharacters).toBe(99990);
    const large = context([], Array.from({ length: 20 }, (_, index) => term(`t${index}`, { meaning: '字'.repeat(3000) })));
    expect(() => searchAiDictionary(large, {})).toThrow('本次资料读取已达到上限');
    expect(large.readCharacters).toBe(0);
  });

  it.each([
    { offset: -1 }, { offset: 1.5 }, { offset: Number.NaN }, { offset: Infinity }, { offset: 1000001 }, { offset: '1' },
    { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: Infinity }, { limit: null },
    { kind: 'note' }, { kind: null }, { query: 1 },
  ])('rejects invalid direct input before spending budget: %j', args => {
    const ctx = context([symbol('s')]);
    expect(() => searchAiDictionary(ctx, args)).toThrow();
    expect(ctx.readCharacters).toBe(0);
  });
});
