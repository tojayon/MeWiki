import type { AiSession } from './session.ts';

export interface AiUsageRecord {
  prompt: string;
  providerName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  completedAt?: string;
}

const MAX_USAGE_RECORDS = 100;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 300;

function storedUsageRecord(value: unknown): value is AiUsageRecord {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return text(entry.prompt) && text(entry.providerName) && text(entry.model) && count(entry.inputTokens) && count(entry.outputTokens) &&
    (entry.completedAt === undefined || typeof entry.completedAt === 'string' && entry.completedAt.length <= 40 && Number.isFinite(Date.parse(entry.completedAt)));
}

export function currentAiUsage(session: AiSession): AiUsageRecord {
  return {
    prompt: (session.history.findLast(message => message.role === 'user')?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    providerName: session.providerName, model: session.model,
    inputTokens: session.usage.inputTokens, outputTokens: session.usage.outputTokens,
  };
}

function reportedUsage(session: AiSession): boolean {
  return session.usage.inputTokens > 0 || session.usage.outputTokens > 0;
}

/** Optional telemetry must never discard an otherwise valid conversation. */
export function restoreAiUsageHistory(session: AiSession): AiUsageRecord[] {
  const history = Array.isArray(session.usageHistory) ? session.usageHistory.filter(storedUsageRecord).slice(-MAX_USAGE_RECORDS).map(entry => ({
    prompt: entry.prompt, providerName: entry.providerName, model: entry.model,
    inputTokens: entry.inputTokens, outputTokens: entry.outputTokens,
    ...(entry.completedAt ? { completedAt: entry.completedAt } : {}),
  })) : [];
  const legacy = session.usageHistory === undefined && session.status !== 'idle' && session.status !== 'running';
  if ((legacy && (session.status === 'complete' || reportedUsage(session)) || session.status === 'running' && reportedUsage(session)) && session.providerName) {
    history.push(currentAiUsage(session));
  }
  return history.slice(-MAX_USAGE_RECORDS);
}

/** One record per user task, including all completed tool-call rounds. */
export function finishAiUsage(session: AiSession, status: AiSession['status']): AiUsageRecord[] {
  const history = session.usageHistory ?? [];
  if (session.status !== 'running' || status === 'running' || status === 'idle' || status !== 'complete' && !reportedUsage(session)) return history;
  return [...history, { ...currentAiUsage(session), completedAt: new Date().toISOString() }].slice(-MAX_USAGE_RECORDS);
}
