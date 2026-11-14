import { createResearchNote, normalizeResearchBlock, removeResearchBlock, updateResearchNote, type ResearchNote, type ResearchNotebookState } from '../domain/researchNotebook.ts';
import { findResearchBlock, updateResearchBlockTree } from '../domain/researchBlockTree.ts';
import { parseMarkdownBlocks } from '../domain/researchMarkdown.ts';
import { addTermEntry, createTermEntry, deleteTermEntry, listTermUses, termEntryError, updateTermEntry, type ResearchTermEntry } from '../domain/researchTerms.ts';
import { applyNativeProposal, type AiNativeProposal } from './nativeProposals.ts';
import { nativeEditEffects, nativeEntity, nativeFingerprint, restoreNativeEffects, type AiNativeEffect, type AiNativeEntity, type AiNativeTarget } from './nativeEdits.ts';
import { noteEditDependenciesUnchanged } from './editDependencies.ts';

export const AI_MAX_CONTENT = 40000;
const newId = () => crypto.randomUUID();
export type AiProposal = {
  id: string; libraryId: string; kind: 'create' | 'append' | 'replace-text' | 'delete-text'; targetId: string;
  title: string; content: string; blockId?: string; before: ResearchNote | null;
} | {
  id: string; libraryId: string; kind: 'term'; targetId: string;
  title: string; content: string; term: ResearchTermEntry; before: ResearchTermEntry | null;
} | AiNativeProposal;
export interface AiChange {
  proposalId: string; libraryId: string; target: AiNativeTarget; targetId: string;
  before: AiNativeEntity | null; after: string; baseline?: string; effects?: AiNativeEffect[];
}
export function aiText(value: unknown, max = AI_MAX_CONTENT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('AI 内容为空或超过允许长度。');
  return value.trim();
}
export function createNoteProposal(state: ResearchNotebookState, libraryId: string, input: {
  operation: string; noteId?: string; blockId?: string; title?: string; content: string;
}): AiProposal {
  if (!['create', 'append', 'replace-text', 'delete-text'].includes(input.operation)) throw new Error('AI 修改操作无效。');
  const validated = input.operation === 'delete-text' && input.content === '' ? '' : aiText(input.content);
  const content = input.operation === 'replace-text' ? input.content : validated;
  if (input.operation === 'delete-text' && content !== '') throw new Error('删除文字块的建议内容必须为空。');
  const before = input.operation === 'create' ? null : state.notes.find(note => note.id === input.noteId);
  if (before === undefined) throw new Error('目标笔记已不存在。');
  if (input.operation === 'replace-text' || input.operation === 'delete-text') {
    const block = findResearchBlock(before!.blocks, input.blockId ?? '')?.block;
    if (!block || !['paragraph', 'heading', 'markdown'].includes(block.type)) throw new Error('只能修改现有文字内容块。');
  }
  return { id: newId(), libraryId, kind: input.operation as 'create' | 'append' | 'replace-text' | 'delete-text',
    targetId: before?.id ?? newId(), title: aiText(input.operation === 'create' ? input.title : before!.title || '未命名笔记', 300),
    content, ...(input.blockId ? { blockId: input.blockId } : {}), before: before ? structuredClone(before) : null };
}
export function createTermProposal(state: ResearchNotebookState, libraryId: string, input: {
  termId?: string; name: string; meaning: string; englishName?: string;
}): AiProposal {
  const before = input.termId ? state.terms?.find(term => term.id === input.termId) : null;
  if (before === undefined) throw new Error('目标术语已不存在。');
  const name = aiText(input.name, 300), meaning = aiText(input.meaning);
  const term = createTermEntry({ ...(before ?? { aliases: [] }), name, meaning,
    ...(input.englishName !== undefined ? { englishName: aiText(input.englishName, 300) } : {}) }, before?.id ?? newId());
  const error = termEntryError(term, state.terms ?? []);
  if (error) throw new Error(error);
  return { id: newId(), libraryId, kind: 'term', targetId: term.id, title: name, content: meaning, term, before: before ? structuredClone(before) : null };
}
function checkBaseline(current: unknown, baseline: unknown) {
  if (JSON.stringify(current ?? null) !== JSON.stringify(baseline)) throw new Error('目标内容已变化，请重新生成建议。');
}
function fingerprint(value: ResearchNote | ResearchTermEntry | undefined): string {
  if (value && 'updatedAt' in value) {
    const { updatedAt: _stamp, ...content } = value;
    return JSON.stringify(content);
  }
  return JSON.stringify(value);
}
export function applyAiProposal(state: ResearchNotebookState, proposal: AiProposal, libraryId: string, approvedChanges: AiChange[] = []): { state: ResearchNotebookState; change: AiChange } {
  if (proposal.kind === 'native') return applyNativeProposal(state, proposal, libraryId, approvedChanges);
  if (proposal.libraryId !== libraryId) throw new Error('AI 建议属于其他资料库。');
  if (proposal.kind === 'delete-text') {
    if (proposal.content !== '') throw new Error('删除文字块的建议内容必须为空。');
  } else aiText(proposal.content);
  let next: ResearchNotebookState;
  let before = proposal.before;
  if (proposal.kind === 'term') {
    checkBaseline(state.terms?.find(term => term.id === proposal.targetId), proposal.before);
    const error = termEntryError(proposal.term, state.terms ?? []);
    if (error) throw new Error(error);
    next = proposal.before ? updateTermEntry(state, proposal.term) : addTermEntry(state, proposal.term);
  } else {
    const current = state.notes.find(note => note.id === proposal.targetId);
    if (nativeFingerprint(current) !== nativeFingerprint(proposal.before)) {
      const independent = current && proposal.before && proposal.kind !== 'create' && (proposal.kind === 'append'
        ? nativeFingerprint(current.blocks) === nativeFingerprint(proposal.before.blocks) && current.library === proposal.before.library
        : noteEditDependenciesUnchanged(proposal.before, current, { action: proposal.kind === 'replace-text' ? 'block-update' : 'block-delete', blockId: proposal.blockId, fields: { text: proposal.content } }));
      if (!independent) throw new Error('目标内容已变化，请重新生成建议。');
    }
    before = current ? structuredClone(current) : null;
    if (proposal.kind === 'replace-text' || proposal.kind === 'delete-text') {
      const block = current && findResearchBlock(current.blocks, proposal.blockId ?? '')?.block;
      if (!block || !['paragraph', 'heading', 'markdown'].includes(block.type)) throw new Error('只能修改现有文字内容块。');
      next = proposal.kind === 'delete-text' ? removeResearchBlock(state, proposal.targetId, block.id)
        : updateResearchNote(state, proposal.targetId, { blocks: updateResearchBlockTree(current!.blocks, block.id, item => ({ ...item, text: proposal.content } as typeof item)) });
    } else {
      const blocks = parseMarkdownBlocks(proposal.content, '', newId, normalizeResearchBlock, false);
      if (!blocks.length || blocks.length > 250) throw new Error('AI 建议的内容块数量无效。');
      if (proposal.kind === 'create') {
        const note = { ...createResearchNote(aiText(proposal.title, 300)), id: proposal.targetId, blocks };
        next = { ...state, notes: [...state.notes, note] };
      } else next = updateResearchNote(state, proposal.targetId, { blocks: [...current!.blocks, ...blocks] });
    }
  }
  const result = proposal.kind === 'term' ? next.terms?.find(term => term.id === proposal.targetId) : next.notes.find(note => note.id === proposal.targetId);
  return { state: next, change: { proposalId: proposal.id, libraryId, target: proposal.kind === 'term' ? 'term' : 'note', targetId: proposal.targetId, before, after: fingerprint(result), baseline: JSON.stringify(proposal.before), effects: nativeEditEffects(state, next) } };
}

export type AiProposalPreview = {
  target: 'note'; before: ResearchNote | null; after: ResearchNote; state: ResearchNotebookState;
} | {
  target: 'term'; before: ResearchTermEntry | null; after: ResearchTermEntry; state: ResearchNotebookState;
} | {
  target: 'native'; before: AiNativeEntity | null; after: AiNativeEntity | null; state: ResearchNotebookState;
};
/** Pure review projection, using the exact validation and transformation used on approval. */
export function previewAiProposal(state: ResearchNotebookState, proposal: AiProposal, libraryId: string, approvedChanges: AiChange[] = []): AiProposalPreview {
  const result = applyAiProposal(state, proposal, libraryId, approvedChanges);
  if (proposal.kind === 'native') return { target: 'native', before: result.change.before, after: nativeEntity(result.state, proposal.target, proposal.targetId), state: result.state };
  return proposal.kind === 'term'
    ? { target: 'term', before: result.change.before as ResearchTermEntry | null, after: result.state.terms!.find(term => term.id === proposal.targetId)!, state: result.state }
    : { target: 'note', before: result.change.before as ResearchNote | null, after: result.state.notes.find(note => note.id === proposal.targetId)!, state: result.state };
}
export function undoAiChange(state: ResearchNotebookState, change: AiChange, libraryId: string): ResearchNotebookState {
  if (change.libraryId !== libraryId) throw new Error('AI 修改属于其他资料库。');
  if (change.effects) return restoreNativeEffects(state, change.effects);
  const current = change.target === 'note' ? state.notes.find(note => note.id === change.targetId) : state.terms?.find(term => term.id === change.targetId);
  if (!current || fingerprint(current) !== change.after) throw new Error('目标内容已变化，无法安全撤回。');
  if (change.target === 'term') {
    if (change.before) {
      const error = termEntryError(change.before as ResearchTermEntry, state.terms ?? []);
      if (error) throw new Error(error);
      return updateTermEntry(state, change.before as ResearchTermEntry);
    }
    if (listTermUses(state.notes, change.targetId).length) throw new Error('术语已有引用，无法撤回创建。');
    return deleteTermEntry(state, change.targetId);
  }
  if (change.before) {
    const note = change.before as ResearchNote;
    return updateResearchNote(state, change.targetId, { title: note.title, blocks: note.blocks });
  }
  if (state.notes.some(note => note.id !== change.targetId && JSON.stringify(note).includes(change.targetId))) throw new Error('笔记已有引用，无法撤回创建。');
  const notes = state.notes.filter(note => note.id !== change.targetId);
  return { ...state, notes, activeNoteId: state.activeNoteId === change.targetId ? notes[0]?.id ?? '' : state.activeNoteId };
}
