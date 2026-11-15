import { describe, expect, it } from 'vitest';
import { aiProductModuleId, aiProductModuleUrl, aiProductModules, findAiProductModules, type AiProductModuleId } from './productCatalog.ts';

describe('AI product module catalog', () => {
  it('keeps the standard names and common aliases in one static catalog', () => {
    expect(aiProductModules.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'symbols', name: '符号词典' },
      { id: 'terms', name: '术语词典' },
      { id: 'foundations', name: '基础理论' },
      { id: 'notes', name: '研究记录' },
      { id: 'maps', name: '理论地图' },
      { id: 'library', name: '资料库' },
      { id: 'manual', name: '使用手册' },
    ]);
    for (const [query, id] of [
      ['符号库', 'symbols'], ['符号表', 'symbols'], ['术语库', 'terms'], ['术语表', 'terms'],
      ['理论笔记', 'foundations'], ['研究笔记', 'notes'], ['知识地图', 'maps'], ['关系图', 'maps'],
    ]) expect(findAiProductModules(query)[0]?.id).toBe(id);
    expect(aiProductModules.find(module => module.id === 'symbols')?.view).toBe('dictionary');
    expect(aiProductModules.find(module => module.id === 'terms')?.view).toBe('dictionary');
  });

  it('finds English names and multiple space-separated keywords without changing display names', () => {
    expect(findAiProductModules('  SYMBOL   DICTIONARY\t').map(module => module.id)).toEqual(['symbols']);
    expect(findAiProductModules('term dictionary').map(module => module.id)).toEqual(['terms']);
    expect(findAiProductModules('knowledge map')[0]).toMatchObject({ id: 'maps', name: '理论地图', englishName: 'Knowledge map' });
    expect(findAiProductModules('theory map')[0]?.id).toBe('maps');
    expect(findAiProductModules('术语库 符号库')).toEqual([]);
    expect(findAiProductModules('没有这个模块')).toEqual([]);
    expect(findAiProductModules('  ')).toEqual(aiProductModules);
  });

  it('only advertises supported Agent actions and requires review for changes', () => {
    for (const module of aiProductModules) {
      expect(module.description.trim()).not.toBe('');
      expect(module.actions.length).toBeGreaterThan(0);
      expect(module.actions.join(' ')).not.toMatch(/联网|导出|安装插件|修改设置|直接保存/);
    }
    expect(aiProductModules.find(module => module.id === 'symbols')?.actions.join(' ')).toContain('建议');
    expect(aiProductModules.find(module => module.id === 'notes')?.actions.join(' ')).toContain('建议');
  });

  it('round-trips whitelisted module links without interpreting extra URL content', () => {
    for (const module of aiProductModules) {
      expect(aiProductModuleUrl(module.id)).toBe(`mewiki-module:${module.id}`);
      expect(aiProductModuleId(aiProductModuleUrl(module.id))).toBe(module.id);
    }
    for (const url of [
      '', 'symbols', 'https://example.invalid/symbols', 'mewiki-symbol:symbols', 'mewiki-module:unknown',
      'MEWIKI-MODULE:symbols', 'mewiki-module:SYMBOLS', 'mewiki-module:%73ymbols',
      'mewiki-module://symbols', 'mewiki-module:symbols/', 'mewiki-module:symbols?x=1',
      'mewiki-module:symbols#part', 'mewiki-module:symbols:notes', ' mewiki-module:symbols',
      'mewiki-module:symbols ', 'mewiki-module:symbols\n',
    ]) expect(aiProductModuleId(url), url).toBeNull();
    expect(() => aiProductModuleUrl('unknown' as AiProductModuleId)).toThrow();
  });
});
