import { describe, expect, it } from 'vitest';
import { runAiEvaluation } from './evaluation.ts';

describe('fictional offline Agent quality suite', () => {
  it('retains measured usage and completed tools when a later model request fails', async () => {
    let turn = 0;
    const report = await runAiEvaluation({ complete: async () => {
      if (++turn > 1) throw new TypeError('模拟网络失败');
      return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }, usage: { inputTokens: 123, outputTokens: 7 } };
    } });
    expect(report.results[0].completed).toBe(false);
    expect(report.results[0].usage).toEqual({ inputTokens: 123, outputTokens: 7 });
    expect(report.results[0].metrics).toMatchObject({ modelCalls: 2, toolCalls: 1 });
  });
  it('scores efficient custom completions without requiring injected duplicate or forbidden calls', async () => {
    const report = await runAiEvaluation({ complete: async request => {
      const prompt = request.messages.find(item => item.role === 'user')?.content ?? '', count = request.messages.filter(item => item.role === 'tool').length;
      const editing = prompt.includes('同一处'), scoped = prompt.includes('仅总结');
      const call = count === 0 ? { name: 'read_note', arguments: { noteId: 'fixture-definition' } } : editing && count === 1 ? { name: 'propose_note', arguments: { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '精确内容。' } } : undefined;
      return { message: { role: 'assistant', content: call && (editing || scoped) ? '' : '[关系定义](#research-note/fixture-definition) 已核对。', ...(call && (editing || scoped) ? { toolCalls: [{ id: `c-${count}`, name: call.name, arguments: JSON.stringify(call.arguments) }] } : {}) }, usage: { inputTokens: 1, outputTokens: 1 } };
    } });
    expect(report.results.find(item => item.id === 'duplicate-read-and-proposal')?.completed).toBe(true);
    expect(report.results.find(item => item.id === 'out-of-scope-rejection')?.completed).toBe(true);
  });
  it('scores complete workflows and exposes injected regressions without user data or network', async () => {
    const report = await runAiEvaluation();
    expect(report.mode).toBe('offline-fixture');
    expect(report.results.length).toBeGreaterThanOrEqual(5);
    expect(report.summary).toMatchObject({ completed: report.results.length, outOfScope: 0, invalidSources: 0, invalidProposals: 0 });
    expect(report.results.every(item => item.metrics.modelCalls > 0 && item.metrics.durationMs >= 0)).toBe(true);
    expect(report.results.find(item => item.id === 'duplicate-read-and-proposal')?.metrics.reusedCalls).toBe(2);
    expect(report.results.find(item => item.id === 'out-of-scope-rejection')?.metrics.failedCalls).toBe(1);
    expect(report.results.find(item => item.id === 'symbol-notation-repair')).toMatchObject({ completed: true, metrics: { failedCalls: 1 } });
    const degraded = await runAiEvaluation({ complete: async () => ({ message: { role: 'assistant', content: '未完成任务。' }, usage: { inputTokens: 0, outputTokens: 0 } }) });
    expect(degraded.summary.completed).toBeLessThan(report.summary.completed);
    expect(degraded.results.some(item => item.failures.length)).toBe(true);
  });
});
