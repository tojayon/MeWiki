import { expect, it } from 'vitest';
import { collectPublicationImages } from './publicationImages.ts';
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from './researchNotebook.ts';

const assetId = 'a'.repeat(64), otherId = 'b'.repeat(64);
const note = (id: string, blocks: ResearchNotebookBlock[]): ResearchNote => ({ id, title: id, blocks, createdAt: '2026-11-12', updatedAt: '2026-11-12' });
const state = (...notes: ResearchNote[]): ResearchNotebookState => ({ version: 8, open: true, view: 'notes', activeNoteId: 'n', activeSymbolId: '', symbols: [], notes });
it('collects local image occurrences in notebook order, including hidden tabs and resolved references', () => {
  const value = state(note('n', [
    { id: 'm', type: 'media', kind: 'image', source: { type: 'asset', assetId }, alt: '主图' },
    { id: 'p', type: 'markdown', kind: 'markdown', text: `![内联](webbench-asset:${otherId})\n\n![定义][photo]\n\n[photo]: webbench-asset:${assetId}\n\n\`![代码](webbench-asset:${assetId})\`\n\n\`\`\`md\n![代码块](webbench-asset:${assetId})\n\`\`\`\n\n![网络](https://example.com/a.png)` },
    { id: 'tabs', type: 'examples', title: '标签页', tabs: [{ id: 'hidden', title: '另一个标签页', blocks: [{ id: 'nested', type: 'paragraph', text: `![嵌套](webbench-asset:${assetId})` }] }] },
    { id: 'ref', type: 'noteEmbed', sourceNoteId: 'other', blockIds: ['included'] },
    { id: 'private', type: 'external', provider: 'test', contentType: 'private', schemaVersion: 1, title: '卡片', summary: '', data: { text: `![私有](webbench-asset:${otherId})` } },
  ]), note('other', [{ id: 'included', type: 'media', kind: 'image', source: { type: 'asset', assetId: otherId }, caption: '引用' }, { id: 'secret', type: 'media', kind: 'image', source: { type: 'asset', assetId } }]));
  const frozen = JSON.stringify(value);
  const images = collectPublicationImages(value, 'n');
  expect(images.map(image => image.name)).toEqual(['主图', '内联', '定义', '嵌套', '引用']);
  expect(images.map(image => image.source.assetId)).toEqual([assetId, otherId, assetId, assetId, otherId]);
  expect(images[3].location).toContain('另一个标签页');
  expect(new Set(images.map(image => image.id)).size).toBe(5);
  expect(collectPublicationImages(value, 'n')).toEqual(images);
  expect(JSON.stringify(value)).toBe(frozen);
});
it('bounds circular references and never scans other notes or arbitrary attachment links', () => {
  const value = state(note('n', [
    { id: 'loop', type: 'noteEmbed', sourceNoteId: 'n', blockIds: ['loop'] },
    { id: 'link', type: 'paragraph', text: `[文件](webbench-asset:${assetId}) ![无效](webbench-asset:bad)` },
    { id: 'pdf', type: 'media', kind: 'pdf', source: { type: 'asset', assetId } },
  ]), note('other', [{ id: 'unused', type: 'media', kind: 'image', source: { type: 'asset', assetId } }]));
  expect(collectPublicationImages(value, 'n')).toEqual([]);
});
it('uses bounded occurrence identities even when valid notebook block identifiers are long', () => {
  const value = state(note('n', [{ id: 'x'.repeat(1000), type: 'media', kind: 'image', source: { type: 'asset', assetId } }]));
  expect(collectPublicationImages(value, 'n')[0].id.length).toBeLessThanOrEqual(1000);
});
