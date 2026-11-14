import { sha256 } from '@noble/hashes/sha2.js';
import { findResearchBlock, flattenResearchBlocks } from '../domain/researchBlockTree.ts';
import type { ResearchNotebookBlock, ResearchNotebookState } from '../domain/researchNotebook.ts';
import { nativeFingerprint } from './nativeEdits.ts';
import { readableAiNote } from './readable.ts';
import { aiBlockFields } from './nativeSchema.ts';
import { assertAiSelectedText, assertAiSelectionRangesMatch, locateAiSelection, validAiSelectionRanges, type AiSelectionRange, type AiSelectionHint } from './selectionRanges.ts';

export interface AiTextSelection {
  /** Absent on existing rendered text selections; block references cover one native subtree. */
  kind?: 'block';
  libraryId: string; noteId: string; noteTitle: string; text: string;
  blocks: { id: string; baseline: string; ranges?: AiSelectionRange[] }[];
}
export const aiScopeDigest = (value: unknown): string => [...sha256(new TextEncoder().encode(nativeFingerprint(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const invalid = '请选择同一篇笔记中的文字内容，最多 4000 字。';
// Derive editable fields from the current block, never from stored selection metadata.
export function aiSelectionTextFields(block: ResearchNotebookBlock | undefined): string[] {
  if (!block) return [];
  if (['paragraph', 'heading', 'markdown', 'callout'].includes(block.type)) return ['text'];
  return block.type === 'list' ? ['items'] : [];
}
export function restoreAiTextSelection(value: unknown, libraryId: string): AiTextSelection | undefined {
  if (!value || typeof value !== 'object') return;
  const selection = value as AiTextSelection;
  if ((selection.kind !== undefined && selection.kind !== 'block') || selection.libraryId !== libraryId || typeof selection.noteId !== 'string' || !selection.noteId || selection.noteId.length > 1000 ||
    typeof selection.noteTitle !== 'string' || selection.noteTitle.length > 300 || typeof selection.text !== 'string' || !selection.text.trim() || selection.text.length > 4000 ||
    !Array.isArray(selection.blocks) || !selection.blocks.length || selection.blocks.length > 20 ||
    (selection.kind === 'block' && selection.blocks.length !== 1) ||
    selection.blocks.some(block => !block || typeof block.id !== 'string' || !block.id || block.id.length > 1000 || typeof block.baseline !== 'string' || !/^[a-f0-9]{64}$/.test(block.baseline) || block.ranges !== undefined && !validAiSelectionRanges(block.ranges)) ||
    new Set(selection.blocks.map(block => block.id)).size !== selection.blocks.length) return;
  return { ...(selection.kind === 'block' ? { kind: 'block' as const } : {}), libraryId, noteId: selection.noteId, noteTitle: selection.noteTitle, text: selection.text, blocks: selection.blocks.map(block => ({ id: block.id, baseline: block.baseline, ...(block.ranges ? { ranges: structuredClone(block.ranges) } : {}) })) };
}
export function createAiBlockSelection(state: ResearchNotebookState, libraryId: string, noteId: string, blockId: string): AiTextSelection {
  const note = state.notes.find(note => note.id === noteId);
  const block = note && findResearchBlock(note.blocks, blockId)?.block;
  if (!note || !block) throw new Error('本行内容已变化，请重新打开内容块菜单。');
  // Project only this block. Linked notes, attachment bytes and plugin-private fields stay outside the quote.
  const readable = readableAiNote({ ...note, title: '', blocks: [block] }, [], state.symbols).trim() || '（请读取原内容块查看详细字段。）';
  const text = readable.length > 4000 ? readable.slice(0, 3900) + '\n…（摘要已截断，请读取原内容块获取完整内容。）' : readable;
  return { kind: 'block', libraryId, noteId, noteTitle: note.title.slice(0, 300), text, blocks: [{ id: blockId, baseline: aiScopeDigest(block) }] };
}
export function createAiTextSelection(state: ResearchNotebookState, libraryId: string, noteId: string, blockIds: string[], text: string, hints?: AiSelectionHint[]): AiTextSelection {
  const note = state.notes.find(note => note.id === noteId);
  if (!note || !text.trim() || text.length > 4000 || !blockIds.length || blockIds.length > 20) throw new Error(invalid);
  const source = [...new Set(blockIds)].map(id => {
    const block = findResearchBlock(note.blocks, id)?.block;
    if (!aiSelectionTextFields(block).length) throw new Error(invalid);
    return block!;
  });
  const ranges = locateAiSelection(source, text, hints);
  const blocks = source.map(block => ({ id: block.id, baseline: aiScopeDigest(block), ranges: ranges.get(block.id)! }));
  return { libraryId, noteId, noteTitle: note.title.slice(0, 300), text: text.trim(), blocks };
}
export function aiTextSelectionError(state: ResearchNotebookState, libraryId: string, selection: AiTextSelection): string {
  if (!restoreAiTextSelection(selection, libraryId)) return selection.kind === 'block' ? '本行引用属于其他资料库或已失效，请重新附加。' : '选中文字属于其他资料库或已失效，请重新选择。';
  const note = state.notes.find(note => note.id === selection.noteId);
  if (!note || selection.blocks.some(item => {
    const block = findResearchBlock(note.blocks, item.id)?.block;
    return !block || aiScopeDigest(block) !== item.baseline;
  })) return selection.kind === 'block' ? '本行内容已变化，请重新附加或移除引用后发送。' : '选区原文已变化，请重新选择或移除引用后发送。';
  if (selection.kind !== 'block') {
    try {
      assertAiSelectionRangesMatch(selection.blocks.map(item => ({ block: findResearchBlock(note!.blocks, item.id)!.block, ranges: aiSelectionRanges(state, selection, item.id) })), selection.text);
    } catch { return '选区无法准确定位，请重新选择文字，或使用本行内容菜单。'; }
  }
  return '';
}
export const aiRequestScopeKey = (noteIds: string[], selection?: AiTextSelection) => aiScopeDigest([[...new Set(noteIds)].sort(), selection ?? null]);

export function aiSelectionRanges(state: ResearchNotebookState, selection: AiTextSelection, blockId: string): AiSelectionRange[] {
  const saved = selection.blocks.find(item => item.id === blockId);
  if (!saved) throw new Error(invalid);
  const note = state.notes.find(note => note.id === selection.noteId);
  const blocks = selection.blocks.map(item => note && findResearchBlock(note.blocks, item.id)?.block);
  if (blocks.some(block => !block)) throw new Error(invalid);
  return saved.ranges ?? locateAiSelection(blocks as ResearchNotebookBlock[], selection.text).get(blockId)!;
}

/** Completed proposals and streamed drafts use exactly the same selection boundary. */
export function assertAiSelectionEdit(state: ResearchNotebookState, selection: AiTextSelection | undefined, name: string, fields: Record<string, unknown>): void {
  if (!selection || !['propose_note', 'propose_edit', 'propose_term'].includes(name)) return;
  const note = state.notes.find(note => note.id === selection.noteId);
  const block = note && typeof fields.blockId === 'string' ? findResearchBlock(note.blocks, fields.blockId)?.block : undefined;
  const root = selection.kind === 'block' && note ? findResearchBlock(note.blocks, selection.blocks[0]?.id)?.block : undefined;
  const allowedIds = root ? flattenResearchBlocks([root]).map(item => item.id) : selection.blocks.map(item => item.id);
  const allowedFields = selection.kind === 'block' && block ? Object.keys(aiBlockFields[block.type]).filter(key => key !== 'section') : aiSelectionTextFields(block);
  const allowed = fields.noteId === selection.noteId && allowedIds.includes(fields.blockId as string) &&
    (name === 'propose_note' && fields.operation === 'replace-text' && !!block && ['paragraph', 'heading', 'markdown'].includes(block.type) ||
      name === 'propose_edit' && fields.action === 'block-update' && !!fields.fields && typeof fields.fields === 'object' &&
      Object.keys(fields.fields).every(key => allowedFields.includes(key)));
  if (!allowed) throw new Error(selection.kind === 'block' ? '此任务仅允许更新本行内容及其子块，请保留其他内容。' : '此任务仅允许修改选区所属的文字块，请保留其他内容。');
  if (selection.kind !== 'block' && block) {
    assertAiSelectedText(block, aiSelectionRanges(state, selection, block.id), name === 'propose_note' ? { text: fields.content } : fields.fields as Record<string, unknown>);
  }
}
