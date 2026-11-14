import type { AiMessage } from './types.ts';
import type { AiConversationMessage } from './session.ts';

export const AI_CHAT_MESSAGE_LIMIT = 2000;
export const AI_SESSION_CHAR_LIMIT = 4 * 1024 * 1024;

/** Only successful exchanges in the same destination and authorization context are reusable. */
export function scopedAiHistory(history: AiConversationMessage[], contextKey: string): AiMessage[] {
  const result: AiMessage[] = [];
  for (let index = 0; index < history.length; index++) {
    const user = history[index];
    if (user.role !== 'user' || user.contextKey !== contextKey) continue;
    const replies: AiConversationMessage[] = [];
    for (let next = index + 1; next < history.length && history[next].role !== 'user'; next++) {
      const reply = history[next];
      if (reply.role === 'assistant' && reply.contextKey === contextKey && (!reply.status || reply.status === 'complete') && reply.content) replies.push(reply);
    }
    if (replies.length) result.push({ role: 'user', content: user.content }, ...replies.map(reply => ({ role: 'assistant' as const, content: reply.content })));
  }
  return result;
}

/** Deterministic excerpts: never store private reasoning or pretend these are a model-written summary. */
export function buildAiModelMemory(history: AiMessage[], instructions = '') {
  const messages = history.filter(message => ['user', 'assistant'].includes(message.role) && message.content);
  const recent = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 12000) }));
  const older = messages.slice(0, -8);
  // Sample across the older conversation, retaining both its beginning and its latest decisions.
  const count = Math.min(24, older.length);
  const excerpts = Array.from({ length: count }, (_, index) => {
    const at = count === 1 ? 0 : Math.floor(index * (older.length - 1) / (count - 1));
    const message = older[at];
    return { index: at, role: message.role, excerpt: message.content.replace(/\s+/g, ' ').slice(0, 180) };
  });
  const encode = () => JSON.stringify({ olderMessages: older.length, excerpts });
  while (encode().length > 6000) for (const item of excerpts) item.excerpt = item.excerpt.slice(0, Math.max(0, item.excerpt.length - 10));
  return { recent, instructions: instructions.slice(0, 4000), summary: older.length ? encode() : '' };
}
