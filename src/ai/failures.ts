export interface AiFailure {
  kind: 'rate-limit' | 'network' | 'timeout' | 'configuration' | 'service' | 'response' | 'request';
  recovery: 'retry' | 'settings' | 'revise';
  status?: number;
  retryAt?: number;
}
export function restoreAiFailure(value: unknown): AiFailure | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const item = value as AiFailure;
  const recovery = item.kind === 'configuration' ? 'settings' : item.kind === 'request' ? 'revise' : 'retry';
  if (!['rate-limit', 'network', 'timeout', 'configuration', 'service', 'response', 'request'].includes(item.kind) || item.recovery !== recovery ||
    (item.status !== undefined && (!Number.isInteger(item.status) || item.status < 400 || item.status > 599)) ||
    (item.retryAt !== undefined && (item.kind !== 'rate-limit' || !Number.isSafeInteger(item.retryAt) || item.retryAt < 0 || item.retryAt > Date.now() + 86400000))) return;
  return { kind: item.kind, recovery, ...(item.status !== undefined ? { status: item.status } : {}), ...(item.retryAt !== undefined ? { retryAt: item.retryAt } : {}) };
}
export class AiRequestError extends Error {
  readonly failure: AiFailure;
  constructor(message: string, failure: AiFailure) { super(message); this.name = 'AiRequestError'; this.failure = failure; }
}
export function aiFailure(cause: unknown): AiFailure | undefined {
  if (cause instanceof Error && cause.name === 'AbortError') return;
  if (cause instanceof AiRequestError) return restoreAiFailure(cause.failure);
  if (cause instanceof TypeError) return { kind: 'network', recovery: 'retry' };
  return;
}
export function aiHttpFailure(status: number): AiFailure {
  if (status === 429) return { kind: 'rate-limit', recovery: 'retry', status };
  if ([408, 504].includes(status)) return { kind: 'timeout', recovery: 'retry', status };
  if ([400, 401, 403, 404, 405, 422].includes(status)) return { kind: 'configuration', recovery: 'settings', status };
  if (status >= 500) return { kind: 'service', recovery: 'retry', status };
  return { kind: 'request', recovery: 'revise', status };
}
