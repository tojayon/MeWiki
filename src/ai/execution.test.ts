import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { runAiTask } from './runner.ts';
import { createAiToolContext } from './tools.ts';
import { createAiSession, restoreAiSession } from './session.ts';

describe('locatable public execution progress', () => {
  it('reports verified targets, reused calls, review state and measured request counts', async () => {
    const state = createNotebookFixture(), id = 'fixture-definition';
    const snapshots: string[] = [];
    let turn = 0;
    const calls = [
      { name: 'read_note', arguments: JSON.stringify({ noteId: id }) },
      { name: 'read_note', arguments: JSON.stringify({ noteId: id }) },
      { name: 'propose_note', arguments: JSON.stringify({ operation: 'replace-text', noteId: id, blockId: `${id}:text`, content: '精确的虚构内容' }) },
    ];
    const result = await runAiTask({ context: createAiToolContext(state, 'fixture', [id]), providerId: 'fixture', prompt: '润色虚构资料', signal: new AbortController().signal,
      onProgress: value => snapshots.push(JSON.stringify(value)), complete: async () => ({ message: { role: 'assistant', content: turn === 3 ? '等待审阅' : '', ...(turn < 3 ? { toolCalls: [{ ...calls[turn], id: `call-${turn}` }] } : {}) }, usage: { inputTokens: ++turn, outputTokens: 1 } }) });
    expect(result.phase).toBe('review');
    expect(result.steps).toMatchObject([{ tool: 'read_note', status: 'complete', noteId: id }, { tool: 'read_note', status: 'reused', noteId: id }, { tool: 'propose_note', status: 'complete', blockId: `${id}:text` }]);
    expect(result.metrics).toMatchObject({ modelCalls: 4, toolCalls: 3, reusedCalls: 1, failedCalls: 0 });
    expect(result.metrics?.repeatedCalls).toBe(1);
    expect(snapshots.some(value => JSON.parse(value).phase === 'thinking')).toBe(true);
    const session = { ...createAiSession('fixture'), ...result };
    expect(restoreAiSession('fixture', JSON.stringify(session))?.steps).toEqual(result.steps);
  });
  it('records failed attempts without exposing an unauthorized target as a navigable source', async () => {
    let turn = 0;
    const result = await runAiTask({ context: createAiToolContext(createNotebookFixture(), 'fixture', ['fixture-definition']), providerId: 'fixture', prompt: '只读授权资料', signal: new AbortController().signal,
      complete: async () => ({ message: { role: 'assistant', content: turn++ ? '无法读取' : '', ...(turn === 1 ? { toolCalls: [{ id: 'outside', name: 'read_note', arguments: '{"noteId":"fixture-summary"}' }] } : {}) }, usage: { inputTokens: 1, outputTokens: 1 } }) });
    expect(result.steps?.[0]).toMatchObject({ status: 'error', tool: 'read_note' });
    expect(result.steps?.[0].noteId).toBeUndefined();
    expect(result.metrics?.failedCalls).toBe(1);
    expect(result.sourceIds).toEqual([]);
  });
});
