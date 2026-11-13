import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { applyAiProposal, type AiChange, type AiProposal } from './proposals.ts';
import { nativeEditEffects, nativeEntity, nativeFingerprint, runNativeEdit, type AiNativeTarget } from './nativeEdits.ts';

export const aiProposalTarget = (proposal: AiProposal): AiNativeTarget => proposal.kind === 'native' ? proposal.target : proposal.kind === 'term' ? 'term' : 'note';
export const aiProposalTargetKey = (proposal: AiProposal) => JSON.stringify([aiProposalTarget(proposal), proposal.targetId]);

/** Preflight every original baseline before composing; rebasing is local to this reviewed group. */
export function applyAiProposalGroup(state: ResearchNotebookState, proposals: AiProposal[], libraryId: string, approvedChanges: AiChange[] = []) {
  for (const proposal of proposals) applyAiProposal(state, proposal, libraryId, approvedChanges);
  let current = state;
  const changes: AiChange[] = [];
  const mergedIds: string[] = [];
  for (const proposal of proposals) {
    const target = aiProposalTarget(proposal);
    const before = nativeEntity(current, target, proposal.targetId);
    const next = proposal.kind === 'native' ? runNativeEdit(current, proposal.edit)
      : applyAiProposal(current, { ...proposal, before: before as typeof proposal.before } as AiProposal, libraryId).state;
    const effects = nativeEditEffects(current, next);
    if (effects.length) changes.push({ proposalId: proposal.id, libraryId, target, targetId: proposal.targetId, before: structuredClone(before),
      after: nativeFingerprint(nativeEntity(next, target, proposal.targetId)), baseline: nativeFingerprint(proposal.before), effects });
    else mergedIds.push(proposal.id);
    current = next;
  }
  return { state: current, changes, mergedIds };
}
