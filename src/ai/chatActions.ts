import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { aiHistoryContextKey, createAiSession, type AiConversationMessage, type AiSession } from './session.ts';
import { aiRequestScopeKey, aiScopeDigest, aiTextSelectionError, type AiTextSelection } from './textSelection.ts';
import { ensureAiTheoryMaps, nativeFingerprint } from './nativeEdits.ts';
import type { AiProvider } from './types.ts';
import { selectAiMaterials, type AiMaterial } from './materials.ts';
import { restoreAiTaskCheckpoint, type AiTaskCheckpoint } from './checkpoint.ts';
import { AI_CHAT_MESSAGE_LIMIT, scopedAiHistory } from './memory.ts';
import { aiTaskNoteIds, freezeAiTaskSupport, type AiTaskSupport } from './taskSupport.ts';
import { aiReferenceContext, combineAiReferences, type AiObjectReference } from './references.ts';
import { restoreAiInlineReferences, type AiInlineReference } from './inlineReferences.ts';
import { t } from '../i18n/locale.ts';

export interface AiChatRequestRecord {
  messageId: string; providerId: string; model: string; noteIds: string[]; contextKey: string; scopeKey: string; baseline: string;
  memoryInstructions?: string;
  support?: AiTaskSupport;
  inlineReferences?: AiInlineReference[];
}
export interface AiChatTask {
  session: AiSession; prompt: string; noteIds: string[]; history: AiConversationMessage[]; memoryInstructions?: string;
  provider: AiProvider; model: string; selection?: AiTextSelection;
  materials: AiMaterial[];
  checkpoint?: AiTaskCheckpoint;
  support?: AiTaskSupport;
  inlineReferences?: AiInlineReference[];
}
function assistant(provider: AiProvider, model: string, contextKey: string): AiConversationMessage {
  return { role: 'assistant', id: crypto.randomUUID(), content: '', status: 'running', contextKey, providerName: provider.name, model, activity: { tools: [], proposalIds: [] } };
}
function runningSession(previous: AiSession, history: AiConversationMessage[], request: AiChatRequestRecord, provider: AiProvider): AiSession {
  if (history.length > AI_CHAT_MESSAGE_LIMIT) throw new Error('本对话已达到 2000 条消息，请复制留存后新建对话。');
  return { ...previous, status: 'running', output: '', tools: [], steps: [], phase: 'thinking', metrics: undefined, usage: { inputTokens: 0, outputTokens: 0 }, history,
    lastRequest: request, contextKey: request.contextKey, error: '', failure: undefined, providerName: provider.name, model: request.model };
}
const taskBaseline = (state: ResearchNotebookState, ids: string[]) => aiScopeDigest([
  state.notes.filter(note => ids.includes(note.id)).sort((a, b) => a.id.localeCompare(b.id)).map(nativeFingerprint),
  state.symbols.map(nativeFingerprint), (state.terms ?? []).map(nativeFingerprint),
  ensureAiTheoryMaps(state).theoryMaps?.documents.map(({ id, title, kind, noteIds, annotations, relations, view }) => ({ id, title, kind, noteIds, annotations, relations, positions: view.layout.positions })),
  state.theoryMaps?.deletedMapIds ?? [],
]);
export function beginAiChatTask(previous: AiSession, provider: AiProvider, model: string, prompt: string, noteIds: string[], state: ResearchNotebookState, input?: AiTaskSupport): AiChatTask {
  const selection = previous.selection;
  const inlineReferences = restoreAiInlineReferences(previous.inlineReferences ?? [], prompt);
  if (!inlineReferences || previous.inlineReferencesInvalid) throw new Error('句内引用已失效，请检查引用文字后重新选择。');
  const references = combineAiReferences(input?.references ?? previous.references ?? [], inlineReferences.map(item => item.reference));
  const support = freezeAiTaskSupport(state, input || references.length ? { references, guidance: input?.guidance ?? { instructions: '', skills: [] }, ...(input?.scope ? { scope: input.scope } : {}) } : undefined);
  const pinnedReferences = combineAiReferences(previous.references ?? [], (input?.references ?? []).filter(reference => !inlineReferences.some(item => item.reference.kind === reference.kind && item.reference.id === reference.id)));
  const referencedNotes = support?.references.filter(item => item.kind === 'note').map(item => item.id) ?? [];
  if (selection && (support?.scope === 'library' || referencedNotes.some(id => id !== selection.noteId))) throw new Error('当前任务限定在选区，请先移除其他笔记引用，或取消选区后发送。');
  // Unified callers derive authorization from the displayed references. Older callers retain v1 behavior.
  const baseIds = support?.scope === 'library' ? aiTaskNoteIds(state, 'library') : support?.scope === 'references' ? [] : noteIds;
  const ids = selection ? [selection.noteId] : [...new Set([...baseIds, ...referencedNotes])];
  const materials = selectAiMaterials(previous.materials ?? [], previous.activeMaterialIds ?? []);
  const contextKey = aiHistoryContextKey(provider, model, ids, selection, materials, support);
  const user: AiConversationMessage = { role: 'user', id: crypto.randomUUID(), content: prompt, contextKey, ...(selection ? { selection } : {}), ...(support?.scope ? { libraryScope: support.scope === 'library' } : {}), ...(materials.length ? { materialIds: materials.map(item => item.id) } : {}), ...(inlineReferences.length ? { inlineReferences } : {}), ...(support ? { references: support.references, pinnedReferences, referenceNames: aiReferenceContext(state, support.references).map(item => item.label), skillIds: support.guidance.skills.map(item => item.id), skillNames: support.guidance.skills.map(item => item.name), libraryGuidance: !!support.guidance.instructions } : {}) };
  const record: AiChatRequestRecord = { messageId: user.id!, providerId: provider.id, model, noteIds: ids, contextKey, scopeKey: aiRequestScopeKey(ids, selection), baseline: taskBaseline(state, ids), memoryInstructions: previous.memoryInstructions, ...(support ? { support } : {}), ...(inlineReferences.length ? { inlineReferences } : {}) };
  return { session: { ...runningSession(previous, [...previous.history, user, assistant(provider, model, contextKey)], record, provider), draft: '', selection: undefined, references: support?.scope ? structuredClone(previous.references ?? []) : [], libraryScope: support?.scope === 'library' || undefined, inlineReferences: [], inlineReferencesInvalid: undefined, checkpoint: undefined, finishReason: undefined },
    provider, model, prompt, noteIds: ids, selection, materials, memoryInstructions: previous.memoryInstructions, support, inlineReferences,
    history: scopedAiHistory(previous.history, contextKey) };
}
function resumeAiChatTask(previous: AiSession, providers: AiProvider[], state: ResearchNotebookState, continuing: boolean): AiChatTask {
  const record = previous.lastRequest;
  if (!record || !(continuing ? previous.status === 'partial' : ['error', 'cancelled', 'interrupted'].includes(previous.status))) throw new Error('此任务无法直接重试，请重新发送要求。');
  const checkpoint = continuing ? restoreAiTaskCheckpoint(previous.checkpoint, previous.libraryId, record, previous.proposals.map(item => item.id)) : undefined;
  if (continuing && !checkpoint) throw new Error('任务接续记录已失效，请重新发送要求。');
  const index = previous.history.findIndex(message => message.id === record.messageId && message.role === 'user');
  const user = previous.history[index], provider = providers.find(item => item.id === record.providerId);
  if (index < 0 || previous.history.slice(index + 1).some(message => message.role === 'user')) throw new Error('此任务无法直接重试，请重新发送要求。');
  const materials = selectAiMaterials(previous.materials ?? [], user.materialIds ?? []);
  const support = freezeAiTaskSupport(state, record.support);
  const inlineReferences = restoreAiInlineReferences(record.inlineReferences ?? [], user.content);
  const messageReferences = restoreAiInlineReferences(user.inlineReferences ?? [], user.content);
  if (!inlineReferences || !messageReferences || JSON.stringify(inlineReferences) !== JSON.stringify(messageReferences)
    || inlineReferences.some(item => !support?.references.some(reference => reference.kind === item.reference.kind && reference.id === item.reference.id))) throw new Error('句内引用已失效，请检查引用文字后重新选择。');
  if (!provider || aiHistoryContextKey(provider, record.model, record.noteIds, user.selection, materials, support) !== record.contextKey) throw new Error('原任务的 AI 服务配置已变化，请检查服务并重新发送要求。');
  if (record.scopeKey !== aiRequestScopeKey(record.noteIds, user.selection) || record.noteIds.some(id => !state.notes.some(note => note.id === id))) throw new Error('原任务的参考笔记已变化，请重新选择范围后发送。');
  const reason = user.selection && aiTextSelectionError(state, previous.libraryId, user.selection);
  if (reason) throw new Error(reason);
  if (record.baseline !== taskBaseline(state, record.noteIds)) throw new Error('原任务的原文或词典已变化，请保留已有结果并重新发送要求。');
  return { session: { ...runningSession(previous, [...previous.history, assistant(provider, record.model, record.contextKey)], record, provider), checkpoint, finishReason: undefined }, checkpoint,
    prompt: user.content, noteIds: [...record.noteIds], selection: user.selection, materials, provider, model: record.model,
    memoryInstructions: record.memoryInstructions, support, inlineReferences,
    history: scopedAiHistory(previous.history.slice(0, index), record.contextKey) };
}
export function retryAiChatTask(previous: AiSession, providers: AiProvider[], state: ResearchNotebookState): AiChatTask {
  return resumeAiChatTask(previous, providers, state, false);
}
export function continueAiChatTask(previous: AiSession, providers: AiProvider[], state: ResearchNotebookState): AiChatTask {
  return resumeAiChatTask(previous, providers, state, true);
}
export function copyAiConversationText(history: AiConversationMessage[], userLabel: string, assistantLabel = 'MeWiki'): string {
  return history.filter(message => ['user', 'assistant'].includes(message.role) && (message.content || message.selection)).map(message => {
    const quote = message.selection ? `${message.selection.noteTitle}\n${message.selection.text.split('\n').map(line => `> ${line}`).join('\n')}\n\n` : '';
    const context = [...(message.libraryScope ? [`@${t('整库检索')}`] : []), ...(message.referenceNames ?? []).flatMap((name, index) => {
      const reference = message.references?.[index];
      return reference && message.inlineReferences?.some(item => item.reference.kind === reference.kind && item.reference.id === reference.id) ? [] : [`@${name}`];
    }), ...(message.skillNames ?? [])].join(' · ');
    return `${message.role === 'user' ? userLabel : assistantLabel}\n\n${context ? context + '\n\n' : ''}${quote}${message.content}`;
  }).join('\n\n---\n\n');
}

/** Recover legacy targets only from a matching request, never from the current page. */
export function aiMessageContextForEdit(previous: AiSession, index: number): { references: AiObjectReference[]; libraryScope?: boolean } {
  const message = previous.history[index];
  if (!Number.isInteger(index) || index < 0 || message?.role !== 'user') throw new Error('此消息无法编辑，请复制内容后重新发送。');
  const references = message.pinnedReferences ?? message.references?.filter(reference => !message.inlineReferences?.some(item => item.reference.kind === reference.kind && item.reference.id === reference.id)) ?? [];
  if (typeof message.libraryScope === 'boolean' || message.selection) return { references, libraryScope: message.libraryScope };
  // Earlier v1 messages stored the note scope only in the matching lastRequest.
  const request = message.id && previous.lastRequest?.messageId === message.id ? previous.lastRequest : undefined;
  const recoveryError = '旧消息的资料范围无法完整恢复，请取消编辑，通过 @ 重新引用资料后发送。';
  if (!request && message.contextKey) throw new Error(recoveryError);
  const alreadyReferenced = new Set([...(message.references ?? []), ...(message.inlineReferences ?? []).map(item => item.reference)].filter(item => item.kind === 'note').map(item => item.id));
  try {
    const pinned = combineAiReferences(references, (request?.noteIds ?? []).filter(id => !alreadyReferenced.has(id)).map(id => ({ kind: 'note', id })));
    combineAiReferences(pinned, (message.inlineReferences ?? []).map(item => item.reference));
    return { references: pinned };
  } catch { throw new Error(recoveryError); }
}
/** The original conversation is archived by the caller before this branch becomes active. */
export function forkAiChatBeforeMessage(previous: AiSession, index: number): AiSession {
  const message = previous.history[index];
  if (!Number.isInteger(index) || index < 0 || message?.role !== 'user' || message.content.length > 12000) throw new Error('此消息无法编辑，请复制内容后重新发送。');
  const context = aiMessageContextForEdit(previous, index);
  const history = previous.history.slice(0, index), ids = new Set(history.flatMap(item => item.activity?.proposalIds ?? []));
  return { ...createAiSession(previous.libraryId), history, draft: previous.draft, selection: message.selection, memoryInstructions: previous.memoryInstructions,
    materials: previous.materials, activeMaterialIds: message.materialIds ?? [], references: context.references, referenceMode: 'explicit', libraryScope: context.libraryScope, inlineReferences: message.inlineReferences, inlineReferencesInvalid: message.inlineReferencesInvalid, skillIds: previous.skillIds,
    proposals: previous.proposals.filter(item => ids.has(item.id)), changes: previous.changes.filter(item => ids.has(item.proposalId)),
    appliedIds: previous.appliedIds.filter(id => ids.has(id)), rejectedIds: previous.rejectedIds?.filter(id => ids.has(id)), mergedIds: previous.mergedIds?.filter(id => ids.has(id)),
    sourceIds: [...previous.sourceIds],
  };
}
