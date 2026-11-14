import { restoreAiSession, writeAiSession, type AiSession } from './session.ts';

const key = (libraryId: string) => `mewiki:library:${encodeURIComponent(libraryId)}:ai-conversations:v1`;
const maxHistory = 50;
const maxSize = 4 * 1024 * 1024;
const historyError = '对话历史未能读取，请保持窗口打开。';

export function aiConversationTitle(session: AiSession): string {
  return session.conversationTitle || session.history.find(message => message.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 300) || '';
}
export function identifyAiConversation(session: AiSession, id?: string): AiSession {
  return { ...session, conversationId: session.conversationId || id || crypto.randomUUID(), conversationTitle: aiConversationTitle(session), updatedAt: session.updatedAt || new Date().toISOString() };
}
export function touchAiConversation(session: AiSession): AiSession {
  return { ...identifyAiConversation(session), updatedAt: new Date().toISOString() };
}
export function listAiConversations(saved: AiSession[], current: AiSession): AiSession[] {
  const entries = new Map(saved.filter(item => item.libraryId === current.libraryId).map(item => [item.conversationId, item]));
  entries.set(current.conversationId, current);
  return [...entries.values()].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}
export function aiConversationHasContent(session: AiSession): boolean {
  return !!(session.history.length || session.output || session.draft?.trim() || session.memoryInstructions?.trim() || session.selection || session.activeMaterialIds?.length || session.proposals.length || session.changes.length || session.tools.length || session.usageHistory?.length);
}
export function readAiConversations(libraryId: string, storage: Pick<Storage, 'getItem'>): AiSession[] {
  try {
    const text = storage.getItem(key(libraryId));
    if (text === null) return [];
    if (text.length > maxSize) throw new Error(historyError);
    const value = JSON.parse(text);
    if (value?.version !== 1 || value.libraryId !== libraryId || !Array.isArray(value.sessions) || value.sessions.length > maxHistory) throw new Error(historyError);
    const ids = new Set<string>();
    return value.sessions.map((item: unknown) => {
      const session = restoreAiSession(libraryId, JSON.stringify(item));
      if (!session?.conversationId || ids.has(session.conversationId)) throw new Error(historyError);
      ids.add(session.conversationId);
      return session;
    });
  } catch { throw new Error(historyError); }
}
/** Persist both snapshots before replacing the active slot. A failed write never changes the caller's active session. */
export function switchAiConversation(current: AiSession, target: AiSession, storage: Pick<Storage, 'getItem' | 'setItem'>): AiSession[] {
  if (current.libraryId !== target.libraryId || !current.conversationId || !target.conversationId) throw new Error('AI 建议所属资料库已变化，请重新生成。');
  const saved = readAiConversations(current.libraryId, storage);
  const sessions = listAiConversations(listAiConversations(saved, current), target).filter(item => item.conversationId === target.conversationId || aiConversationHasContent(item));
  if (sessions.length > maxHistory) throw new Error('对话历史已达到 50 个，请先清空不再需要的对话。');
  try {
    if (sessions.some(session => restoreAiSession(current.libraryId, JSON.stringify(session))?.conversationId !== session.conversationId)) throw new Error('invalid session');
    const text = JSON.stringify({ version: 1, libraryId: current.libraryId, sessions: sessions.filter(aiConversationHasContent) });
    if (text.length > maxSize) throw new Error('limit');
    storage.setItem(key(current.libraryId), text);
  } catch { throw new Error('AI 会话未能保存，请保持窗口打开。'); }
  try { writeAiSession(target, storage); }
  catch {
    // In particular, a failed clear must not discard the previous snapshot from history.
    try {
      storage.setItem(key(current.libraryId), JSON.stringify({ version: 1, libraryId: current.libraryId,
        sessions: listAiConversations(saved, current).filter(aiConversationHasContent) }));
    } catch { /* The unchanged active slot and the caller still retain the current conversation. */ }
    throw new Error('AI 会话未能保存，请保持窗口打开。');
  }
  return sessions;
}
