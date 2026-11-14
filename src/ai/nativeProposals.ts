import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { nativeEditEffects, nativeEditTarget, nativeEntity, nativeFingerprint, prepareNativeEdit, runNativeEdit, type AiNativeEdit, type AiNativeEffect, type AiNativeEntity, type AiNativeTarget } from './nativeEdits.ts';
import { noteEditDependenciesUnchanged } from './editDependencies.ts';

export interface AiNativeProposal {
  id: string; libraryId: string; kind: 'native'; targetId: string; title: string; content: string;
  before: AiNativeEntity | null; edit: AiNativeEdit; target: AiNativeTarget;
}
export interface AiNativeApprovedChange {
  proposalId: string; libraryId: string; target: string; targetId: string; before: unknown; after: string; baseline?: string; effects?: AiNativeEffect[];
}
export function createNativeProposal(state: ResearchNotebookState, libraryId: string, input: unknown): AiNativeProposal {
  const edit = prepareNativeEdit(state, input), { target, id } = nativeEditTarget(edit);
  const before = nativeEntity(state, target, id), after = nativeEntity(runNativeEdit(state, edit), target, id);
  const title = before && 'title' in before ? before.title : before && 'name' in before ? before.name : after && 'title' in after ? after.title : after && 'name' in after ? after.name : '内容修改';
  return { id: crypto.randomUUID(), libraryId, kind: 'native', targetId: id, title: title.slice(0, 300) || '内容修改', content: edit.action, before: structuredClone(before), edit, target };
}
function canRebase(proposal: AiNativeProposal, current: AiNativeEntity | null): boolean {
  if (proposal.target !== 'note' || !proposal.before || !('blocks' in proposal.before) || !current || !('blocks' in current)) return false;
  if (!['note-update', 'block-update', 'block-delete', 'block-insert', 'tab-update'].includes(proposal.edit.action)) return false;
  return noteEditDependenciesUnchanged(proposal.before, current, proposal.edit);
}
export function applyNativeProposal(state: ResearchNotebookState, proposal: AiNativeProposal, libraryId: string, _changes: AiNativeApprovedChange[] = []) {
  if (proposal.libraryId !== libraryId) throw new Error('AI 建议属于其他资料库。');
  const target = nativeEditTarget(proposal.edit);
  if (target.target !== proposal.target || target.id !== proposal.targetId) throw new Error('AI 建议目标无效。');
  const current = nativeEntity(state, proposal.target, proposal.targetId);
  if (nativeFingerprint(current) !== nativeFingerprint(proposal.before) && !canRebase(proposal, current)) throw new Error('目标内容已变化，请重新生成建议。');
  const next = runNativeEdit(state, proposal.edit), effects = nativeEditEffects(state, next);
  if (!effects.length) throw new Error('此操作没有产生内容变化。');
  const change = { proposalId: proposal.id, libraryId, target: proposal.target, targetId: proposal.targetId, before: structuredClone(current),
    after: nativeFingerprint(nativeEntity(next, proposal.target, proposal.targetId)), baseline: nativeFingerprint(proposal.before), effects };
  return { state: next, change };
}
