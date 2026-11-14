import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { aiHistoryContextKey, createAiSession, type AiConversationMessage, type AiSession } from './session.ts';
import { aiRequestScopeKey, aiScopeDigest, aiTextSelectionError, type AiTextSelection } from './textSelection.ts';
import { ensureAiTheoryMaps, nativeFingerprint } from './nativeEdits.ts';
import type { AiProvider } from './types.ts';
import { selectAiMaterials, type AiMaterial } from './materials.ts';
import { restoreAiTaskCheckpoint, type AiTaskCheckpoint } from './checkpoint.ts';
import { AI_CHAT_MESSAGE_LIMIT, scopedAiHistory } from './memory.ts';

export interface AiChatRequestRecord {
  messageId: string; providerId: string; model: string; noteIds: string[]; contextKey: string; scopeKey: string; baseline: string;
  memoryInstructions?: string;
}
export interface AiChatTask {
  session: AiSession; prompt: string; noteIds: string[]; history: AiConversationMessage[]; memoryInstructions?: string;
  provider: AiProvider; model: string; selection?: AiTextSelection;
  materials: AiMaterial[];
  checkpoint?: AiTaskCheckpoint;
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
export function beginAiChatTask(previous: AiSession, provider: AiProvider, model: string, prompt: string, noteIds: string[], state: ResearchNotebookState): AiChatTask {
  const selection = previous.selection;
  const ids = selection ? [selection.noteId] : [...new Set(noteIds)];
  const materials = selectAiMaterials(previous.materials ?? [], previous.activeMaterialIds ?? []);
  const contextKey = aiHistoryContextKey(provider, model, ids, selection, materials);
  const user: AiConversationMessage = { role: 'user', id: crypto.randomUUID(), content: prompt, contextKey, ...(selection ? { selection } : {}), ...(materials.length ? { materialIds: materials.map(item => item.id) } : {}) };
  const request: AiChatRequestRecord = { messageId: user.id!, providerId: provider.id, model, noteIds: ids, contextKey, scopeKey: aiRequestScopeKey(ids, selection), baseline: taskBaseline(state, ids), memoryInstructions: previous.memoryInstructions };
  return { session: { ...runningSession(previous, [...previous.history, user, assistant(provider, model, contextKey)], request, provider), draft: '', selection: undefined, checkpoint: undefined, finishReason: undefined },
    provider, model, prompt, noteIds: ids, selection, materials, memoryInstructions: previous.memoryInstructions,
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
  if (!provider || aiHistoryContextKey(provider, record.model, record.noteIds, user.selection, materials) !== record.contextKey) throw new Error('原任务的 AI 服务配置已变化，请检查服务并重新发送要求。');
  if (record.scopeKey !== aiRequestScopeKey(record.noteIds, user.selection) || record.noteIds.some(id => !state.notes.some(note => note.id === id))) throw new Error('原任务的参考笔记已变化，请重新选择范围后发送。');
  const reason = user.selection && aiTextSelectionError(state, previous.libraryId, user.selection);
  if (reason) throw new Error(reason);
  if (record.baseline !== taskBaseline(state, record.noteIds)) throw new Error('原任务的原文或词典已变化，请保留已有结果并重新发送要求。');
  return { session: { ...runningSession(previous, [...previous.history, assistant(provider, record.model, record.contextKey)], record, provider), checkpoint, finishReason: undefined }, checkpoint,
    prompt: user.content, noteIds: [...record.noteIds], selection: user.selection, materials, provider, model: record.model,
    memoryInstructions: record.memoryInstructions,
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
    return `${message.role === 'user' ? userLabel : assistantLabel}\n\n${quote}${message.content}`;
  }).join('\n\n---\n\n');
}

/** The original conversation is archived by the caller before this branch becomes active. */
export function forkAiChatBeforeMessage(previous: AiSession, index: number): AiSession {
  const message = previous.history[index];
  if (!Number.isInteger(index) || index < 0 || message?.role !== 'user' || message.content.length > 12000) throw new Error('此消息无法编辑，请复制内容后重新发送。');
  const history = previous.history.slice(0, index), ids = new Set(history.flatMap(item => item.activity?.proposalIds ?? []));
  return { ...createAiSession(previous.libraryId), history, draft: previous.draft, selection: message.selection, memoryInstructions: previous.memoryInstructions,
    materials: previous.materials, activeMaterialIds: message.materialIds ?? [],
    proposals: previous.proposals.filter(item => ids.has(item.id)), changes: previous.changes.filter(item => ids.has(item.proposalId)),
    appliedIds: previous.appliedIds.filter(id => ids.has(id)), rejectedIds: previous.rejectedIds?.filter(id => ids.has(id)), mergedIds: previous.mergedIds?.filter(id => ids.has(id)),
    sourceIds: [...previous.sourceIds],
  };
}
