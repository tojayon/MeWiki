import { describe, expect, it } from 'vitest';
import { AiRequestError, aiFailure, restoreAiFailure } from './failures.ts';
import { createAiSession, restoreAiSession } from './session.ts';

describe('recoverable AI error metadata', () => {
  it('restores safe metadata across refresh while dropping malformed optional fields', () => {
    const failure = { kind: 'rate-limit' as const, recovery: 'retry' as const, status: 429, retryAt: Date.now() + 3000 };
    expect(restoreAiFailure(failure)).toEqual(failure);
    expect(restoreAiFailure({ ...failure, retryAt: 'tomorrow' })).toBeUndefined();
    const session = { ...createAiSession('fixture'), failure };
    expect(restoreAiSession('fixture', JSON.stringify(session))?.failure).toEqual(failure);
    expect(restoreAiSession('fixture', JSON.stringify({ ...session, failure: { kind: 'invalid' } }))?.history).toEqual([]);
  });
  it('normalizes browser network failures without treating cancellation as a network retry', () => {
    expect(aiFailure(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'network', recovery: 'retry' });
    expect(aiFailure(new DOMException('Aborted', 'AbortError'))).toBeUndefined();
    const failure = { kind: 'configuration' as const, recovery: 'settings' as const };
    expect(aiFailure(new AiRequestError('配置错误', failure))).toEqual(failure);
  });
});
