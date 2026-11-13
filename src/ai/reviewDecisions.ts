import { findResearchBlock } from '../domain/researchBlockTree.ts';
import type { ResearchNote, ResearchNotebookState } from '../domain/researchNotebook.ts';
import { getResearchNoteMetadata } from '../domain/researchFrontmatter.ts';
import { ensureTheoryMaps } from '../domain/researchTheoryMap.ts';
import { applyAiProposal, createNoteProposal, createTermProposal, type AiChange, type AiProposal } from './proposals.ts';
import { nativeEntity, nativeFingerprint, prepareNativeEdit, runNativeEdit } from './nativeEdits.ts';
import { aiProposalTarget } from './proposalGroup.ts';

export interface AiReviewLocation { kind: 'page' | 'block' | 'tab' | 'field'; blockId?: string; tabId?: string; field?: string }
export interface AiProposalAdjustment { content?: string; title?: string; fields?: Record<string, unknown> }
export const aiReviewLocationKey = (location: AiReviewLocation) => JSON.stringify([location.kind, location.blockId, location.tabId, location.field]);

export function aiReviewLocation(proposal: AiProposal, change?: AiChange): AiReviewLocation {
  if (proposal.kind !== 'native') {
    if (proposal.kind === 'term') return { kind: 'page' };
    if (proposal.blockId) return { kind: 'block', blockId: proposal.blockId };
    if (proposal.kind === 'append' && change) {
      const before = change.before as ResearchNote | null, after = JSON.parse(change.after) as ResearchNote;
      const added = after.blocks.find(block => !before?.blocks.some(previous => previous.id === block.id));
      if (added) return { kind: 'block', blockId: added.id };
    }
    return { kind: 'page' };
  }
  const edit = proposal.edit;
  if (edit.action.startsWith('tab-')) return { kind: 'tab', blockId: edit.blockId, tabId: edit.action === 'tab-insert' ? edit.generatedId : edit.tabId };
  if (edit.action.startsWith('block-')) return { kind: 'block', blockId: edit.action === 'block-insert' ? edit.generatedId : edit.blockId };
  if (edit.action.endsWith('-delete')) return { kind: 'page' };
  const field = edit.action.startsWith('relation-') ? 'relations' : Object.keys(edit.fields)[0];
  return field ? { kind: 'field', field } : { kind: 'page' };
}

export function canAdjustAiProposal(proposal: AiProposal): boolean {
  return proposal.kind !== 'delete-text' && (proposal.kind !== 'native' ||
    !proposal.edit.action.endsWith('-delete') && !proposal.edit.action.endsWith('-move'));
}

function capturedState(state: ResearchNotebookState, proposal: AiProposal): ResearchNotebookState {
  const target = aiProposalTarget(proposal), before = proposal.before;
  const replace = <T extends { id: string }>(items: T[]) => [...items.filter(item => item.id !== proposal.targetId), ...(before ? [before as unknown as T] : [])];
  if (target === 'note') return { ...state, notes: replace(state.notes) };
  if (target === 'term') return { ...state, terms: replace(state.terms ?? []) };
  if (target === 'symbol') return { ...state, symbols: replace(state.symbols) };
  const maps = ensureTheoryMaps(state).theoryMaps!;
  return { ...state, theoryMaps: { ...maps, documents: replace(maps.documents) } };
}

/** Adjust content only: the approved scope, original baseline and stable identities cannot change. */
export function reviseAiProposal(state: ResearchNotebookState, proposal: AiProposal, adjustment: AiProposalAdjustment, libraryId: string, changes: AiChange[] = []): AiProposal {
  applyAiProposal(state, proposal, libraryId, changes);
  if (!canAdjustAiProposal(proposal)) throw new Error('此项修改不包含可调整的内容。');
  const base = capturedState(state, proposal);
  let adjusted: AiProposal;
  if (proposal.kind === 'native') {
    const { generatedId, generatedAt, block, ...input } = proposal.edit;
    const edit = prepareNativeEdit(base, { ...input, ...(adjustment.title !== undefined ? { title: adjustment.title } : {}), fields: { ...input.fields, ...adjustment.fields } });
    edit.generatedId = generatedId; edit.generatedAt = generatedAt;
    if (block) edit.block = { ...block, ...edit.fields, id: generatedId } as typeof block;
    runNativeEdit(base, edit);
    adjusted = { ...proposal, edit };
  } else if (proposal.kind === 'term') {
    const next = createTermProposal(base, libraryId, { termId: proposal.before ? proposal.targetId : undefined,
      name: typeof adjustment.fields?.name === 'string' ? adjustment.fields.name : proposal.term.name,
      meaning: typeof adjustment.fields?.meaning === 'string' ? adjustment.fields.meaning : proposal.term.meaning,
      englishName: typeof adjustment.fields?.englishName === 'string' ? adjustment.fields.englishName : proposal.term.englishName });
    if (next.kind !== 'term') throw new Error('AI 建议目标无效。');
    adjusted = { ...proposal, term: { ...next.term, id: proposal.targetId }, title: next.title, content: next.content };
  } else {
    const next = createNoteProposal(base, libraryId, { operation: proposal.kind, noteId: proposal.targetId, blockId: proposal.blockId,
      title: adjustment.title ?? proposal.title, content: adjustment.content ?? proposal.content });
    adjusted = { ...proposal, content: next.content, title: next.title };
  }
  applyAiProposal(state, adjusted, libraryId, changes);
  return adjusted;
}

const equal = (a: unknown, b: unknown) => nativeFingerprint(a) === nativeFingerprint(b);
const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Called only around a controller-approved transition; unrelated manual changes are never rebased. */
export function rebaseAiReviewProposals(before: ResearchNotebookState, after: ResearchNotebookState, proposals: AiProposal[], libraryId: string, changes: AiChange[] = []): AiProposal[] {
  return proposals.map(proposal => {
    try {
      applyAiProposal(before, proposal, libraryId, changes);
      const target = aiProposalTarget(proposal), left = nativeEntity(before, target, proposal.targetId), right = nativeEntity(after, target, proposal.targetId);
      if (equal(left, right)) return proposal;
      if (!left || !right) return proposal;
      let independent = false;
      if (proposal.kind === 'native') {
        const edit = proposal.edit;
        const fieldsEqual = (a: unknown, b: unknown) => Object.keys(edit.fields).every(key => equal(record(a)[key], record(b)[key]));
        if (edit.action === 'block-update' || edit.action === 'block-delete' || edit.action === 'block-move') {
          const a = findResearchBlock((left as ResearchNote).blocks, edit.blockId!)?.block, b = findResearchBlock((right as ResearchNote).blocks, edit.blockId!)?.block;
          independent = !!a && !!b && a.type === b.type && (edit.action === 'block-update' ? fieldsEqual(a, b) : equal(a, b));
        } else if (edit.action.startsWith('tab-')) {
          const a = findResearchBlock((left as ResearchNote).blocks, edit.blockId!)?.block, b = findResearchBlock((right as ResearchNote).blocks, edit.blockId!)?.block;
          if (a?.type === 'examples' && b?.type === 'examples') {
            const x = a.tabs.find(tab => tab.id === edit.tabId), y = b.tabs.find(tab => tab.id === edit.tabId);
            independent = edit.action === 'tab-insert' ? true : !!x && !!y && (edit.action === 'tab-update' ? x.title === y.title : equal(x, y));
          }
        } else if (edit.action === 'block-insert') {
          if (!edit.container) independent = true;
          else {
            const a = findResearchBlock((left as ResearchNote).blocks, edit.container.exampleBlockId)?.block, b = findResearchBlock((right as ResearchNote).blocks, edit.container.exampleBlockId)?.block;
            independent = a?.type === 'examples' && b?.type === 'examples' && a.tabs.some(tab => tab.id === edit.container!.tabId) && b.tabs.some(tab => tab.id === edit.container!.tabId);
          }
        } else if (edit.action === 'note-update') independent = fieldsEqual({ ...getResearchNoteMetadata(left as ResearchNote), frontmatter: (left as ResearchNote).frontmatter }, { ...getResearchNoteMetadata(right as ResearchNote), frontmatter: (right as ResearchNote).frontmatter });
        else if (edit.action.endsWith('-save') || edit.action === 'map-update') independent = edit.action === 'relation-save'
          ? equal(record(left).relations, record(right).relations) && equal(record(left).theory, record(right).theory) : fieldsEqual(left, right);
      } else if (proposal.kind === 'append') independent = true;
      else if (proposal.kind === 'replace-text' || proposal.kind === 'delete-text') {
        const a = findResearchBlock((left as ResearchNote).blocks, proposal.blockId!)?.block, b = findResearchBlock((right as ResearchNote).blocks, proposal.blockId!)?.block;
        independent = !!a && !!b && a.type === b.type && (proposal.kind === 'delete-text' ? equal(a, b) : equal(record(a).text, record(b).text));
      }
      if (!independent) return proposal;
      const rebased = { ...proposal, before: structuredClone(right) } as AiProposal;
      applyAiProposal(after, rebased, libraryId);
      return rebased;
    } catch { return proposal; }
  });
}
