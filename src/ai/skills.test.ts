import { describe, expect, it } from 'vitest';
import {
  createAiLibraryGuidance, exportAiSkillMarkdown, importAiSkillMarkdown, readAiLibraryGuidance,
  resolveAiGuidance, restoreAiGuidanceSnapshot, suggestAiSkills, writeAiLibraryGuidance,
  type AiLibraryGuidance, type AiSkill,
} from './skills.ts';

const skill = (id: string, overrides: Partial<AiSkill> = {}): AiSkill => ({
  id, name: `技能 ${id}`, description: '用于校对符号和公式', instructions: '保留符号词典的正体角标。',
  keywords: ['符号', '公式'], modules: ['symbols'], enabled: true, defaultEnabled: false, ...overrides,
});
const guidance = (...skills: AiSkill[]): AiLibraryGuidance => ({ ...createAiLibraryGuidance('fixture'), instructions: '使用简体中文。', skills });
function storageFixture() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, text: string) => { values.set(key, text); } };
}

describe('library guidance storage', () => {
  it('starts empty and isolates settings by stable library ID', () => {
    const storage = storageFixture();
    expect(readAiLibraryGuidance('fixture', storage)).toEqual({ version: 1, libraryId: 'fixture', instructions: '', skills: [] });
    const value = guidance(skill('notation'));
    writeAiLibraryGuidance(value, storage);
    expect(readAiLibraryGuidance('fixture', storage)).toEqual(value);
    expect(readAiLibraryGuidance('other', storage).skills).toEqual([]);
    expect([...storage.values.keys()]).toEqual(['mewiki:library:fixture:ai-guidance:v1']);
  });

  it('encodes unusual stable IDs without mixing libraries', () => {
    const storage = storageFixture(), value = { ...guidance(), libraryId: 'demo/a:b 中文' };
    writeAiLibraryGuidance(value, storage);
    expect(readAiLibraryGuidance(value.libraryId, storage)).toEqual(value);
    expect(readAiLibraryGuidance('demo', storage).instructions).toBe('');
  });

  it.each([
    '{broken', JSON.stringify({ version: 2, libraryId: 'fixture', instructions: '', skills: [] }),
    JSON.stringify({ version: 1, libraryId: 'other', instructions: '', skills: [] }),
    JSON.stringify({ ...guidance(skill('duplicate'), skill('duplicate')) }),
    JSON.stringify({ ...guidance(), instructions: 'x'.repeat(4001) }),
  ])('reports damaged saved configuration without replacing it', text => {
    const storage = storageFixture(); storage.values.set('mewiki:library:fixture:ai-guidance:v1', text);
    expect(() => readAiLibraryGuidance('fixture', storage)).toThrow(/未能读取/);
    expect(storage.values.get('mewiki:library:fixture:ai-guidance:v1')).toBe(text);
  });

  it('reports unavailable reads and failed writes while leaving the source value intact', () => {
    const value = guidance(skill('notation')), before = structuredClone(value);
    expect(() => readAiLibraryGuidance('fixture', { getItem() { throw new Error('blocked'); } })).toThrow(/未能读取/);
    expect(() => writeAiLibraryGuidance(value, { setItem() { throw new Error('quota'); } })).toThrow(/未能保存/);
    expect(value).toEqual(before);
  });

  it('validates skill fields, aggregate size and default activation before writing', () => {
    const storage = storageFixture();
    expect(() => writeAiLibraryGuidance(guidance(skill('empty', { instructions: '' })), storage)).toThrow();
    expect(() => writeAiLibraryGuidance(guidance(skill('module', { modules: ['missing'] })), storage)).toThrow();
    expect(() => writeAiLibraryGuidance(guidance(skill('large', { instructions: 'x'.repeat(12001) })), storage)).toThrow(/12000/);
    expect(() => writeAiLibraryGuidance(guidance(...Array.from({ length: 41 }, (_, index) => skill(`s${index}`))), storage)).toThrow(/40/);
    expect(() => writeAiLibraryGuidance(guidance(...Array.from({ length: 14 }, (_, index) => skill(`s${index}`, { instructions: 'x'.repeat(12000) }))), storage)).toThrow(/160000/);
    expect(() => writeAiLibraryGuidance(guidance(...Array.from({ length: 7 }, (_, index) => skill(`s${index}`, { defaultEnabled: true }))), storage)).toThrow(/6/);
    expect(storage.values.size).toBe(0);
  });
});

describe('resolved guidance and frozen snapshots', () => {
  it('combines defaults with explicit activation and deduplicates IDs', () => {
    const value = guidance(skill('default', { defaultEnabled: true }), skill('manual'), skill('disabled', { enabled: false, defaultEnabled: true }));
    expect(resolveAiGuidance(value, ['manual', 'default', 'manual']).skills.map(item => item.id)).toEqual(['default', 'manual']);
    expect(resolveAiGuidance(value, []).instructions).toBe('使用简体中文。');
  });

  it('rejects removed and disabled selected skills instead of silently changing the task', () => {
    const value = guidance(skill('off', { enabled: false }));
    expect(() => resolveAiGuidance(value, ['missing'])).toThrow(/不可用/);
    expect(() => resolveAiGuidance(value, ['off'])).toThrow(/已停用/);
  });

  it('limits the actual selection by count and total instruction length', () => {
    expect(() => resolveAiGuidance(guidance(...Array.from({ length: 7 }, (_, index) => skill(`s${index}`))), Array.from({ length: 7 }, (_, index) => `s${index}`))).toThrow(/6/);
    expect(() => resolveAiGuidance(guidance(skill('a', { instructions: 'a'.repeat(12000) }), skill('b', { instructions: 'b'.repeat(12000) }), skill('c')), ['a', 'b', 'c'])).toThrow(/24000/);
  });

  it('freezes independent allowlisted data for task retries', () => {
    const value = guidance(skill('notation', { defaultEnabled: true }));
    const snapshot = resolveAiGuidance(value, []);
    value.instructions = 'later'; value.skills[0].name = 'later'; value.skills[0].instructions = 'later';
    expect(snapshot).toEqual({ instructions: '使用简体中文。', skills: [{ id: 'notation', name: '技能 notation', description: '用于校对符号和公式', instructions: '保留符号词典的正体角标。' }] });
    const restored = restoreAiGuidanceSnapshot({ ...snapshot, privatePath: 'DO_NOT_KEEP', skills: snapshot.skills.map(item => ({ ...item, commands: ['DO_NOT_KEEP'] })) });
    expect(restored).toEqual(snapshot);
    restored!.skills[0].instructions = 'changed';
    expect(snapshot.skills[0].instructions).toBe('保留符号词典的正体角标。');
    expect(JSON.stringify(restored)).not.toContain('DO_NOT_KEEP');
  });

  it.each([null, {}, { instructions: '', skills: [{ id: 'missing' }] }, { instructions: 'x'.repeat(4001), skills: [] }])('rejects invalid recovered snapshots', value => {
    expect(restoreAiGuidanceSnapshot(value)).toBeUndefined();
  });
});

describe('skill recommendations and Markdown interchange', () => {
  it('recommends enabled skills by keyword or module without activating them', () => {
    const value = guidance(skill('notation'), skill('proof', { keywords: ['证明'], modules: ['foundations'] }), skill('off', { enabled: false }));
    const before = structuredClone(value);
    expect(suggestAiSkills(value, '请核对公式')).toEqual([value.skills[0]]);
    expect(suggestAiSkills(value, '润色', 'foundations').map(item => item.id)).toEqual(['proof']);
    expect(resolveAiGuidance(value, []).skills).toEqual([]);
    expect(value).toEqual(before);
  });

  it('imports common frontmatter as an inactive unsaved draft', () => {
    const imported = importAiSkillMarkdown('\uFEFF---\r\nname: 符号核对\r\ndescription: 核对词典符号\r\nkeywords: [符号, formula]\r\nmodules:\r\n  - symbols\r\nallowed-tools: [shell]\r\nscripts: C:\\secret\\run.ps1\r\n---\r\n先读取符号词典，再生成修改建议。\r\n');
    expect(imported).toMatchObject({ name: '符号核对', description: '核对词典符号', keywords: ['符号', 'formula'], modules: ['symbols'], instructions: '先读取符号词典，再生成修改建议。', enabled: false, defaultEnabled: false });
    expect(imported.id).toBeTruthy();
    expect(JSON.stringify(imported)).not.toContain('secret');
    expect(JSON.stringify(imported)).not.toContain('shell');
  });

  it('exports complete instructions and useful metadata without machine identity or activation', () => {
    const original = skill('local-id', { name: 'A: 符号 #1', description: '两行\n描述', instructions: '第一步。\n\n```sh\necho 只作为文字保留\n```', defaultEnabled: true });
    const markdown = exportAiSkillMarkdown(original), imported = importAiSkillMarkdown(markdown);
    expect(markdown).not.toContain('local-id'); expect(markdown).not.toContain('defaultEnabled');
    expect(imported).toMatchObject({ name: original.name, description: original.description, instructions: original.instructions, keywords: original.keywords, modules: original.modules, enabled: false, defaultEnabled: false });
    expect(imported.id).not.toBe(original.id);
  });

  it.each([
    '没有 frontmatter', '---\nname: missing-description\n---\n正文',
    '---\nname: first\nname: second\ndescription: duplicate\n---\n正文',
    '---\nname: [list]\ndescription: wrong-type\n---\n正文',
    '---\nname: too-big\ndescription: large\n---\n' + 'x'.repeat(12001),
    '---\nname: alias\ndescription: &desc example\nkeywords: [*desc]\n---\n正文',
  ])('rejects malformed or excessive imports', text => {
    expect(() => importAiSkillMarkdown(text)).toThrow();
  });
});
