import { describe, expect, it, vi } from 'vitest';
import { buildPublicationDocument } from './publication.ts';
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from './researchNotebook.ts';

const note = (id: string, blocks: ResearchNotebookBlock[], title = id): ResearchNote => ({ id, blocks, title, createdAt: '2026-11-11', updatedAt: '2026-11-11' });
const state = (...notes: ResearchNote[]): ResearchNotebookState => ({ version: 8, open: true, view: 'notes', activeNoteId: notes[0].id, activeSymbolId: '', symbols: [], notes });
const options = () => ({ resolveImage: vi.fn(async () => 'data:image/png;base64,AA=='), renderVisual: vi.fn(async () => 'data:image/png;base64,AQ==') });
describe('publication snapshots', () => {
  it('exports only the chosen content and never copies private external data', async () => {
    const input = state(note('n', [{ id: 'a', type: 'paragraph', text: '公开正文' }, { id: 'x', type: 'external', provider: 'private', contentType: 'trace', schemaVersion: 1, title: '卡片', summary: '摘要', note: '备注', data: { secret: 'TOKEN' } }, { id: 'b', type: 'paragraph', text: '未选择' }]));
    const snapshot = await buildPublicationDocument(input, 'n', ['a', 'x'], options());
    expect(snapshot.blocks.every(block => block.id.startsWith('a:') || block.id.startsWith('x:'))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('TOKEN');
    expect(snapshot.text).not.toContain('未选择');
    expect(snapshot.blocks.filter(block => block.id.startsWith('x:')).map(block => block.content).join('\n')).toContain('备注');
  });
  it('resolves current dictionary forms and note titles while preserving code literals', async () => {
    const input = state(note('n', [{ id: 'a', type: 'paragraph', text: '[旧名](mewiki-term:t?display=full) [旧标题](#research-note/other) `[原样](mewiki-term:t)`' }]), note('other', [], '新标题'));
    input.terms = [{ id: 't', name: '新术语', englishName: 'New term', englishAbbreviation: 'NT', meaning: '说明', aliases: [], status: 'active', tags: [] }];
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks[0].content).toContain('新术语（New term, NT）');
    expect(snapshot.blocks[0].content).toContain('新标题');
    expect(snapshot.blocks[0].content).toContain('`[原样](mewiki-term:t)`');
    expect(snapshot.blocks[0].content).not.toContain('[旧名]');
  });
  it('expands only selected references and keeps stable unique root-prefixed identities', async () => {
    const input = state(note('n', [{ id: 'e1', type: 'noteEmbed', sourceNoteId: 'other', blockIds: ['p'] }, { id: 'e2', type: 'noteEmbed', sourceNoteId: 'other', blockIds: ['p'] }]), note('other', [{ id: 'p', type: 'paragraph', text: '需要的段落' }, { id: 'secret', type: 'paragraph', text: '其他内容' }]));
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks).toHaveLength(2);
    expect(snapshot.blocks[0].id.startsWith('e1')).toBe(true);
    expect(snapshot.blocks[1].id.startsWith('e2')).toBe(true);
    expect(snapshot.blocks.map(block => block.sourceId)).toEqual(['e1', 'e2']);
    expect(new Set(snapshot.blocks.map(block => block.id)).size).toBe(2);
    expect(snapshot.text).not.toContain('其他内容');
  });
  it('keeps the selected container as the source of every flattened nested item', async () => {
    const input = state(note('n', [{ id: 'tabs:original', type: 'examples', title: '示例', tabs: [{ id: 'tab', title: '页签', blocks: [{ id: 'child', type: 'paragraph', text: '正文\n\n另一段' }] }] }]));
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks).toHaveLength(3);
    expect(snapshot.blocks.every(block => block.sourceId === 'tabs:original')).toBe(true);
  });
  it('rejects circular and missing sources instead of silently dropping content', async () => {
    const input = state(note('n', [{ id: 'e', type: 'noteEmbed', sourceNoteId: 'n', blockIds: ['e'] }]));
    await expect(buildPublicationDocument(input, 'n', undefined, options())).rejects.toThrow('循环');
    input.notes[0].blocks = [{ id: 'e', type: 'noteEmbed', sourceNoteId: 'missing', blockIds: ['p'] }];
    await expect(buildPublicationDocument(input, 'n', undefined, options())).rejects.toThrow('来源');
  });
  it('uses the selected tab and offers explicit all-tab expansion', async () => {
    const input = state(note('n', [{ id: 'tabs', type: 'examples', title: '例子', tabs: [{ id: 'first', title: '第一项', blocks: [{ id: 'a', type: 'paragraph', text: '甲' }] }, { id: 'second', title: '第二项', blocks: [{ id: 'b', type: 'paragraph', text: '乙' }] }] }]));
    const selected = await buildPublicationDocument(input, 'n', undefined, { ...options(), selectedTabs: { tabs: 'second' } });
    expect(selected.text).toContain('乙'); expect(selected.text).not.toContain('甲');
    const all = await buildPublicationDocument(input, 'n', undefined, { ...options(), allTabs: true });
    expect(all.text).toContain('甲'); expect(all.text).toContain('乙');
  });
  it('extracts local Markdown images but ignores image-looking code and hidden metadata', async () => {
    const assetId = 'a'.repeat(64);
    const input = state(note('n', [{ id: 'p', type: 'markdown', kind: 'markdown', text: `第一段\n\n![说明](webbench-asset:${assetId})\n\n<!-- private TOKEN -->\n\n\`![代码](https://example.com/x.png)\`` }]));
    const callbacks = options();
    const snapshot = await buildPublicationDocument(input, 'n', undefined, callbacks);
    expect(snapshot.blocks.map(block => block.kind)).toEqual(['markdown', 'image', 'markdown']);
    expect(callbacks.resolveImage).toHaveBeenCalledExactlyOnceWith({ type: 'asset', assetId });
    expect(snapshot.text).not.toContain('TOKEN');
    expect(snapshot.blocks[2].content).toContain('![代码]');
  });
  it('refuses network images before calling the local image resolver', async () => {
    const input = state(note('n', [{ id: 'p', type: 'media', kind: 'image', source: { type: 'url', url: 'https://example.com/image.png' } }]));
    const callbacks = options();
    await expect(buildPublicationDocument(input, 'n', undefined, callbacks)).rejects.toThrow('本地');
    expect(callbacks.resolveImage).not.toHaveBeenCalled();
  });
  it('keeps linked local images readable without overlapping reference replacements', async () => {
    const assetId = 'b'.repeat(64);
    const input = state(note('n', [{ id: 'p', type: 'paragraph', text: `查看 [![示意图](webbench-asset:${assetId})](#research-note/source)` }]), note('source', [], '当前来源标题'));
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.blocks[0].content).toBe('查看 ![示意图](data:image/png;base64,AA==)');
    expect(snapshot.text).not.toContain('webbench-asset:');
  });
  it('preserves text and image order within an ordinary paragraph', async () => {
    const assetId = 'a'.repeat(64);
    const input = state(note('n', [{ id: 'p', type: 'paragraph', text: `前文 ![第一张](webbench-asset:${assetId}) 中间 ![第二张](webbench-asset:${assetId}) 后文` }]));
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks.map(block => block.kind)).toEqual(['markdown', 'image', 'markdown', 'image', 'markdown']);
    expect(snapshot.blocks.filter(block => block.kind === 'markdown').map(block => block.content)).toEqual(['前文', '中间', '后文']);
    expect(snapshot.blocks.filter(block => block.kind === 'image').map(block => block.caption)).toEqual(['第一张', '第二张']);
  });
  it('keeps localized images in their list items and table cells', async () => {
    const assetId = 'c'.repeat(64);
    const input = state(note('n', [{ id: 'list', type: 'markdown', kind: 'markdown', text: `- 第一项\n- ![列表配图](webbench-asset:${assetId})\n- 第三项` }, { id: 'table', type: 'markdown', kind: 'table', text: `| 内容 | 图片 |\n| --- | --- |\n| 第一行 | ![单元格配图](webbench-asset:${assetId}) |\n| 第二行 | 无 |` }]));
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks).toHaveLength(2);
    expect(snapshot.blocks[0].content).toBe('- 第一项\n- ![列表配图](data:image/png;base64,AA==)\n- 第三项');
    expect(snapshot.blocks[1].content).toContain('| 第一行 | ![单元格配图](data:image/png;base64,AA==) |');
    expect(snapshot.blocks[1].content).toContain('| 第二行 | 无 |');
  });
  it('preserves formatted text around inline reference-style images', async () => {
    const assetId = 'd'.repeat(64);
    const input = state(note('n', [{ id: 'p', type: 'paragraph', text: `**前文 ![配图][img] 后文**\n\n[img]: webbench-asset:${assetId}` }]));
    const snapshot = await buildPublicationDocument(input, 'n', undefined, options());
    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.blocks[0].content).toBe('**前文 ![配图](data:image/png;base64,AA==) 后文**');
  });
  it('does not localize image-looking text in code or stripped HTML', async () => {
    const input = state(note('n', [{ id: 'p', type: 'markdown', kind: 'markdown', text: '`![代码](https://example.com/a.png)`\n\n```md\n![代码块](https://example.com/b.png)\n```\n\n<!-- ![注释](https://example.com/c.png) -->\n\n<div>![HTML](https://example.com/d.png)</div>' }]));
    const callbacks = options();
    const snapshot = await buildPublicationDocument(input, 'n', undefined, callbacks);
    expect(callbacks.resolveImage).not.toHaveBeenCalled();
    expect(snapshot.blocks).toHaveLength(2);
    expect(snapshot.text).toContain('![代码块]');
    expect(snapshot.text).not.toContain('注释');
    expect(snapshot.text).not.toContain('HTML');
  });
  it('reports oversized nested images instead of moving them out of their structure', async () => {
    const assetId = 'e'.repeat(64);
    const input = state(note('n', [{ id: 'p', type: 'markdown', kind: 'markdown', text: `- ![较大配图](webbench-asset:${assetId})` }]));
    await expect(buildPublicationDocument(input, 'n', undefined, { ...options(), resolveImage: async () => `data:image/png;base64,${'A'.repeat(200000)}` })).rejects.toThrow('独立图片');
  });
  it('renders diagram and chart pixels while preserving all selected dataset rows', async () => {
    const input = state(note('n', [{ id: 'd', type: 'diagram', mode: 'mermaid', code: 'flowchart LR\n A-->B', strokes: [], title: '流程' }, { id: 'data', type: 'dataset', columns: ['x', 'y'], rows: [['0', '1'], ['1', '2']], chart: { kind: 'line', x: 0, ys: [1] } }]));
    const callbacks = options();
    const snapshot = await buildPublicationDocument(input, 'n', undefined, callbacks);
    expect(snapshot.blocks.map(block => block.kind)).toEqual(['image', 'image', 'markdown']);
    expect(snapshot.blocks[2].content).toContain('| 1 | 2 |');
    expect(callbacks.renderVisual).toHaveBeenCalledTimes(2);
  });
});
