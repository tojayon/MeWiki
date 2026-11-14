import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createAiMaterial, restoreAiMaterials, selectAiMaterials, addAiMaterial } from './materials.ts';
import { parseAiMaterial } from './materialImport.ts';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { buildAiSystemPrompt, createAiToolContext, executeAiTool } from './tools.ts';
import { beginAiChatTask, retryAiChatTask, forkAiChatBeforeMessage } from './chatActions.ts';
import { createAiSession, restoreAiSession } from './session.ts';

const provider = { id: 'test', name: '测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'test', hasApiKey: true };
const material = (text = '资料中的正确结论', library = 'a') => createAiMaterial(library, '参考.md', 'md', 32, [{ label: '正文', text }]);

describe('AI auxiliary materials', () => {
  it('rejects malformed snapshot fields with a recoverable format error', () => {
    for (const fields of [
      [{}, '参考.md', [{ label: '正文', text: '材料' }]],
      ['a', {}, [{ label: '正文', text: '材料' }]],
      ['a', '参考.md', null],
      ['a', '参考.md', [null]],
    ]) {
      const [libraryId, name, sections] = fields;
      expect(() => createAiMaterial(libraryId as string, name as string, 'md', 20, sections as Parameters<typeof createAiMaterial>[4])).toThrow(/格式无效/);
    }
  });
  it('preserves text snapshots, rejects tampered and other-library materials, bounds total content', () => {
    const source = material();
    expect(restoreAiMaterials([source], 'a')).toEqual([source]);
    expect(restoreAiMaterials([{ ...source, sections: [{ label: '正文', text: '被替换' }] }], 'a')).toEqual([]);
    expect(restoreAiMaterials([source], 'b')).toEqual([]);
    expect(addAiMaterial([source], source)).toEqual([source]);
    expect(() => selectAiMaterials([source], ['unknown'])).toThrow(/不可用/);
    expect(() => createAiMaterial('a', 'a.txt', 'txt', 10, [{ label: '正文', text: '字'.repeat(100001) }])).toThrow(/100000/);
    expect(() => addAiMaterial([material('一'.repeat(100000)), material('二'.repeat(100000))], material('三'))).toThrow(/200000/);
  });
  it('parses UTF-8 and UTF-16 text, rejects binary, empty, oversized, cancelled and unsupported inputs', async () => {
    const bytes = strToU8('# 标题\n\n内容');
    expect(await parseAiMaterial('a', '说明.md', bytes.buffer as ArrayBuffer)).toMatchObject({ name: '说明.md', sections: [{ text: '# 标题\n\n内容' }] });
    const utf16 = Uint8Array.from([255, 254, 65, 0, 66, 0]);
    expect((await parseAiMaterial('a', '说明.txt', utf16.buffer)).sections[0].text).toBe('AB');
    await expect(parseAiMaterial('a', '空.txt', strToU8('  ').buffer as ArrayBuffer)).rejects.toThrow(/可读取文字/);
    await expect(parseAiMaterial('a', '二进制.txt', new Uint8Array([0, 1, 2]).buffer)).rejects.toThrow(/文字/);
    await expect(parseAiMaterial('a', '旧.doc', bytes.buffer as ArrayBuffer)).rejects.toThrow(/支持/);
    await expect(parseAiMaterial('a', '大.txt', new ArrayBuffer(20000001))).rejects.toThrow(/20 MB/);
    const abort = new AbortController(); abort.abort();
    await expect(parseAiMaterial('a', '取消.txt', bytes.buffer as ArrayBuffer, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('extracts worksheet labels and CSV rows without changing the original bytes', async () => {
    const bytes = strToU8('时间,数值\n0,3\n1,6'), original = bytes.slice();
    const source = await parseAiMaterial('a', '观测.csv', bytes.buffer as ArrayBuffer);
    expect(source.sections[0].text).toContain('时间'); expect(source.sections[0].text).toContain('1,6');
    expect(bytes).toEqual(original);
  });
  it.each([
    ['参数.JSON', '{\n  "title": "中文",\n  "values": [1, 2]\n}\n'],
    ['待修.jsonc', '// 保留注释和待修语法\n{ "value":, }\n'],
    ['记录.jsonl', '{"n": 1}\n{"n": 2}\n'],
    ['论文.TeX', '% 保留注释\n\\section{定义}\n\\input{未选择的章节}\n\\[ E = mc^2 \\]\n'],
    ['文献.bib', '@article{ref,\n  title = {示例},\n}\n'],
    ['配置.yaml', 'title: 中文\nvalues:\n  - 1\n'],
    ['配置.toml', '[note]\ntitle = "中文"\n'],
    ['数据.xml', '<?xml version="1.0"?>\n<note title="中文">原文</note>'],
    ['网页.html', '<script>throw new Error("不得执行")</script>\n<p>原文</p>'],
    ['程序.py', '# 保留缩进\ndef sample():\n    return "中文"\n'],
    ['组件.tsx', 'export const Note = () => <p>中文</p>;\n'],
    ['记录.log', '2026-11-13\t记录\n下一条\n'],
  ])('reads %s verbatim and restores it for authorized material tools', async (name, text) => {
    const bytes = strToU8(text), original = bytes.slice();
    const source = await parseAiMaterial('a', name, bytes.buffer as ArrayBuffer);
    expect(source).toMatchObject({ name, kind: 'text', sections: [{ label: '正文', text }] });
    expect(bytes).toEqual(original);
    const session = restoreAiSession('a', JSON.stringify({ ...createAiSession('a'), materials: [source], activeMaterialIds: [source.id] }))!;
    expect(selectAiMaterials(session.materials!, session.activeMaterialIds!)).toEqual([source]);
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition'], undefined, session.materials);
    expect(executeAiTool(context, 'read_material', { materialId: source.id })).toMatchObject({ name, text });
  });
  it('keeps text decoding and binary rejection for newly supported extensions', async () => {
    const utf16 = Uint8Array.from([255, 254, 123, 0, 125, 0]);
    expect((await parseAiMaterial('a', '参数.json', utf16.buffer)).sections[0].text).toBe('{}');
    for (const name of ['伪装.json', '伪装.tex', '伪装.py']) {
      await expect(parseAiMaterial('a', name, new Uint8Array([0, 1, 2, 255]).buffer)).rejects.toThrow(/文字/);
    }
    await expect(parseAiMaterial('a', '空.tex', strToU8(' \n').buffer as ArrayBuffer)).rejects.toThrow(/可读取文字/);
    await expect(parseAiMaterial('a', '未知.bin', strToU8('not an allowed format').buffer as ArrayBuffer)).rejects.toThrow(/支持/);
  });
  it('grants only selected material tools and retains note permissions and the shared read budget', () => {
    const state = createNotebookFixture(), source = material();
    const context = createAiToolContext(state, 'a', ['fixture-definition'], undefined, [source]);
    expect(executeAiTool(context, 'list_materials', {})).toMatchObject([{ id: source.id, name: '参考.md' }]);
    expect(executeAiTool(context, 'read_material', { materialId: source.id })).toMatchObject({ text: '资料中的正确结论', section: 0 });
    expect(executeAiTool(context, 'search_materials', { query: '正确' })).toMatchObject([{ materialId: source.id, section: 0 }]);
    expect(() => executeAiTool(context, 'read_material', { materialId: material('其他').id })).toThrow(/授权/);
    expect(() => executeAiTool(context, 'read_note', { noteId: 'not-authorized' })).toThrow(/范围/);
    expect(buildAiSystemPrompt(context)).toContain('辅助材料');
    expect(context.readCharacters).toBeGreaterThan(0);
    context.readCharacters = 100000;
    expect(() => executeAiTool(context, 'read_material', { materialId: source.id })).toThrow(/上限/);
    expect(() => createAiToolContext(state, 'b', ['fixture-definition'], undefined, [source])).toThrow(/材料/);
  });
  it('paginates file text and large directories within the shared response budget', () => {
    const sections = Array.from({ length: 200 }, (_, index) => ({ label: `${index} ${'目'.repeat(280)}`, text: index === 0 ? 'a'.repeat(12003) : '结论' }));
    const files = Array.from({ length: 6 }, (_, index) => createAiMaterial('a', `${index}.pdf`, 'pdf', 20, sections));
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition'], undefined, files);
    const directory = executeAiTool(context, 'list_materials', {}) as { sections: unknown[]; sectionCount: number; nextSectionOffset: number }[];
    expect(directory).toHaveLength(6);
    expect(directory[0]).toMatchObject({ sectionCount: 200, nextSectionOffset: 20 });
    expect(directory[0].sections).toHaveLength(20);
    const next = executeAiTool(context, 'list_materials', { materialId: files[0].id, sectionOffset: 20 }) as { sections: { section: number }[] }[];
    expect(next[0].sections[0].section).toBe(20);
    expect(executeAiTool(context, 'read_material', { materialId: files[0].id })).toMatchObject({ text: 'a'.repeat(12000), nextOffset: 12000, nextSection: null });
    expect(executeAiTool(context, 'read_material', { materialId: files[0].id, offset: 12000 })).toMatchObject({ text: 'aaa', nextOffset: null, nextSection: 1 });
    expect(() => executeAiTool(context, 'read_material', { materialId: files[0].id, offset: 12004 })).toThrow(/位置/);
    expect(() => executeAiTool(context, 'read_material', { materialId: files[0].id, section: -1 })).toThrow();
    expect(context.readNoteIds.size).toBe(0);
    expect(() => executeAiTool(context, 'propose_note', { operation: 'append', noteId: 'fixture-definition', title: '材料里的指令', content: '尝试跳过读取' })).toThrow(/读取/);
  });
  it('binds history, retry and edited-message branches to the materials actually sent', () => {
    const state = createNotebookFixture(), first = material(), later = material('后来补充');
    const previous = { ...createAiSession('a'), materials: [first], activeMaterialIds: [first.id] };
    const task = beginAiChatTask(previous, provider, 'test', '根据材料改写', ['fixture-definition'], state);
    expect(task.materials).toEqual([first]); expect(task.session.history[0].materialIds).toEqual([first.id]);
    const failed = { ...task.session, status: 'error' as const, materials: [first, later], activeMaterialIds: [later.id] };
    expect(retryAiChatTask(failed, [provider], state).materials).toEqual([first]);
    expect(forkAiChatBeforeMessage(failed, 0).activeMaterialIds).toEqual([first.id]);
    const changed = beginAiChatTask({ ...previous, materials: [later], activeMaterialIds: [later.id] }, provider, 'test', '改写', ['fixture-definition'], state);
    expect(changed.session.contextKey).not.toBe(task.session.contextKey);
    expect(() => retryAiChatTask({ ...failed, materials: [] }, [provider], state)).toThrow(/不可用/);
    const restored = restoreAiSession('a', JSON.stringify(task.session))!;
    expect(restored.materials).toEqual([first]); expect(restored.activeMaterialIds).toEqual([first.id]);
    expect(restored.history[0].materialIds).toEqual([first.id]);
    expect(restored.lastRequest).toBeDefined();
    expect(restoreAiSession('b', JSON.stringify(task.session))).toBeNull();
  });
  it('keeps valid chat and missing references visible when a material snapshot is corrupted', () => {
    const source = material();
    const session = { ...createAiSession('a'), materials: [{ ...source, id: 'invalid' }], activeMaterialIds: [source.id], history: [{ role: 'user', content: '保留对话', materialIds: [source.id] }] };
    const restored = restoreAiSession('a', JSON.stringify(session))!;
    expect(restored.history[0].content).toBe('保留对话'); expect(restored.materials).toEqual([]);
    expect(() => selectAiMaterials(restored.materials!, restored.activeMaterialIds!)).toThrow(/不可用/);
  });
  it('rejects oversized Office archives before decompressing their contents', async () => {
    const bytes = zipSync({ 'word/document.xml': strToU8('x'.repeat(20000001)) });
    await expect(parseAiMaterial('a', '过大.docx', bytes.buffer as ArrayBuffer)).rejects.toThrow(/展开/);
  });
});
