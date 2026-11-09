import type { ResearchNote, ResearchNotebookBlock } from './researchNotebook.ts';
import { findResearchBlock, flattenResearchBlocks } from './researchBlockTree.ts';

export interface ResearchNoteEmbedBlock {
  id: string;
  type: 'noteEmbed';
  sourceNoteId: string;
  blockIds: string[];
  sourceTitle?: string;
}
export const NOTE_EMBED_MAX_SELECTION = 200;
export const NOTE_EMBED_MAX_DEPTH = 8;
const MAX_EXPANDED_BLOCKS = 1000;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !Array.from(value).some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127);

export function normalizeNoteEmbed(value: unknown): ResearchNoteEmbedBlock {
  const block = value as Partial<ResearchNoteEmbedBlock> | null;
  if (!block || block.type !== 'noteEmbed' || !identifier(block.id) || !identifier(block.sourceNoteId) || !Array.isArray(block.blockIds) || !block.blockIds.length || block.blockIds.length > NOTE_EMBED_MAX_SELECTION || !block.blockIds.every(identifier))
    throw new Error('笔记内容引用无效，请重新选择来源和内容。');
  return { id: block.id, type: 'noteEmbed', sourceNoteId: block.sourceNoteId, blockIds: [...new Set(block.blockIds)], ...(typeof block.sourceTitle === 'string' ? { sourceTitle: block.sourceTitle.slice(0, 1000) } : {}) };
}

/** Ancestors contain their children already; display selected blocks in the source's current order. */
export function orderedNoteEmbedIds(note: ResearchNote, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  return flattenResearchBlocks(note.blocks).filter(block => selected.has(block.id) && !findResearchBlock(note.blocks, block.id)!.path.some(owner => selected.has(owner.exampleBlockId))).map(block => block.id);
}
export function resolveNoteEmbed(notes: readonly ResearchNote[], reference: ResearchNoteEmbedBlock) {
  const note = notes.find(item => item.id === reference.sourceNoteId);
  const currentIds = note ? orderedNoteEmbedIds(note, reference.blockIds) : [];
  const missing = reference.blockIds.filter(id => !note || !findResearchBlock(note.blocks, id));
  return { note, items: [...currentIds, ...missing].map(id => ({ id, block: note ? findResearchBlock(note.blocks, id)?.block : undefined })) };
}

/** Bound the actual expanded graph, not just the number of unique nodes. */
export function noteEmbedSelectionError(notes: readonly ResearchNote[], owner: { noteId: string; blockId: string }, reference: Pick<ResearchNoteEmbedBlock, 'sourceNoteId' | 'blockIds'>, requireExisting = true): string | null {
  const index = new Map(notes.map(note => [note.id, note]));
  const selectedNote = index.get(reference.sourceNoteId);
  if (requireExisting && (!selectedNote || reference.blockIds.some(id => !findResearchBlock(selectedNote.blocks, id)))) return '来源笔记或所选内容已删除，请重新选择。';
  if (!reference.blockIds.length || reference.blockIds.length > NOTE_EMBED_MAX_SELECTION) return `请选择 1 至 ${NOTE_EMBED_MAX_SELECTION} 个内容块。`;
  const stack = new Set([JSON.stringify([owner.noteId, owner.blockId])]);
  let remaining = MAX_EXPANDED_BLOCKS;
  const visit = (noteId: string, block: ResearchNotebookBlock, depth: number): string | null => {
    if (--remaining < 0) return '引用展开的内容过多，请缩小引用范围。';
    const address = JSON.stringify([noteId, block.id]);
    if (stack.has(address)) return '此选择会形成循环引用，请选择其他内容。';
    if (depth > NOTE_EMBED_MAX_DEPTH) return '引用层数过多，请直接选择原始内容。';
    stack.add(address);
    let error: string | null = null;
    if (block.type === 'noteEmbed') {
      const source = index.get(block.sourceNoteId);
      if (source) for (const id of orderedNoteEmbedIds(source, block.blockIds)) {
        error = visit(source.id, findResearchBlock(source.blocks, id)!.block, depth + 1);
        if (error) break;
      }
    } else if (block.type === 'examples') {
      for (const child of block.tabs.flatMap(tab => tab.blocks)) { error = visit(noteId, child, depth); if (error) break; }
    }
    stack.delete(address);
    return error;
  };
  if (selectedNote) for (const id of orderedNoteEmbedIds(selectedNote, reference.blockIds)) {
    const error = visit(selectedNote.id, findResearchBlock(selectedNote.blocks, id)!.block, 1);
    if (error) return error;
  }
  return null;
}

/** Resource exports follow only visible selections; never include unrelated source attachments. */
export function expandNoteEmbedBlocks(notes: readonly ResearchNote[], blocks: ResearchNotebookBlock[], ownerNoteId: string): ResearchNotebookBlock[] {
  const expand = (items: ResearchNotebookBlock[], noteId: string, path: string[]): ResearchNotebookBlock[] => items.flatMap(block => {
    if (block.type === 'examples') return [{ ...block, tabs: block.tabs.map(tab => ({ ...tab, blocks: expand(tab.blocks, noteId, path) })) }];
    if (block.type !== 'noteEmbed') return [block];
    const address = JSON.stringify([noteId, block.id]);
    if (path.includes(address) || noteEmbedSelectionError(notes, { noteId, blockId: block.id }, block, false)) return [];
    const { note, items } = resolveNoteEmbed(notes, block);
    return note ? expand(items.flatMap(item => item.block ? [item.block] : []), note.id, [...path, address]) : [];
  });
  return expand(blocks, ownerNoteId, []);
}

export function noteEmbedBlockLabel(block: ResearchNotebookBlock): string {
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'markdown') return block.text;
  if (block.type === 'list') return block.items.join('\n');
  if (block.type === 'formula') return [block.caption, block.tex].filter(Boolean).join(' · ');
  if (block.type === 'callout') return [block.title, block.text].filter(Boolean).join(' · ');
  if (block.type === 'media') return [block.alt, block.caption].filter(Boolean).join(' · ') || ({ image: '图片', audio: '音频', video: '视频', pdf: 'PDF 文档', file: '附件' })[block.kind];
  if (block.type === 'noteEmbed') return `引用笔记内容 · ${block.sourceTitle || '来源笔记'}`;
  if (block.type === 'examples') return block.title || '标签页';
  if (block.type === 'bookmark') return block.title || block.url || '网页链接';
  if (block.type === 'citation') return [block.title, block.authors].filter(Boolean).join(' · ') || '文献引用';
  if (block.type === 'dataset') return block.title || '数据与图表';
  if (block.type === 'diagram') return block.title || '绘图与流程图';
  if (block.type === 'external') return block.title;
  return block.runTitle;
}
