import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import type { AiSession } from './session.ts';
import { aiCurrentReference, combineAiReferences, type AiObjectReference } from './references.ts';
import { aiTaskNoteIds, type AiReadingScope } from './taskSupport.ts';

export interface AiComposerContext {
  references: AiObjectReference[];
  noteIds: string[];
  scope: AiReadingScope;
  implicit: boolean;
}

/** The visible references are the only source of note authorization in the composer. */
export function resolveAiComposerContext(state: ResearchNotebookState, draft: Pick<AiSession, 'references' | 'inlineReferences' | 'inlineReferencesInvalid' | 'referenceMode' | 'libraryScope' | 'selection'>): AiComposerContext {
  const explicit = combineAiReferences(draft.references ?? [], (draft.inlineReferences ?? []).map(item => item.reference));
  const current = !draft.selection && !draft.libraryScope && draft.referenceMode !== 'explicit' && !draft.inlineReferencesInvalid && !explicit.length ? aiCurrentReference(state) : undefined;
  const references = current ? [current] : explicit;
  if (draft.selection && (draft.libraryScope || references.some(item => item.kind === 'note' && item.id !== draft.selection!.noteId))) {
    throw new Error('当前任务限定在选区，请先移除其他笔记引用，或取消选区后发送。');
  }
  const scope = draft.libraryScope ? 'library' : 'references';
  const noteIds = draft.selection ? [draft.selection.noteId] : [...new Set([
    ...(scope === 'library' ? aiTaskNoteIds(state, 'library') : []),
    ...references.filter(item => item.kind === 'note').map(item => item.id),
  ])];
  return { references, noteIds, scope, implicit: !!current };
}
