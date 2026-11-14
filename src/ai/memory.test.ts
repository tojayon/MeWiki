import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { beginAiChatTask, forkAiChatBeforeMessage, retryAiChatTask } from './chatActions.ts';
import { aiHistoryContextKey, createAiSession, restoreAiSession } from './session.ts';
import { buildAiModelMemory, scopedAiHistory } from './memory.ts';

const provider = { id: 'fixture', name: '虚构服务', baseUrl: 'http://127.0.0.1:9876/v1', protocol: 'openai-chat' as const, model: 'fixture', hasApiKey: false };
const ids = ['fixture-definition'];

describe('separate complete chat and bounded model memory', () => {
  it('retains more than twenty messages across sending, restoring and branching', () => {
    const previous = createAiSession('fixture');
    const key = aiHistoryContextKey(provider, provider.model, ids);
    previous.history = Array.from({ length: 60 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, id: `m-${index}`, content: `消息${index}`, contextKey: key, ...(index % 2 ? { status: 'complete' as const } : {}) }));
    const task = beginAiChatTask(previous, provider, provider.model, '下一问', ids, createNotebookFixture());
    expect(task.session.history).toHaveLength(62);
    expect(restoreAiSession('fixture', JSON.stringify(task.session))?.history).toHaveLength(62);
    expect(forkAiChatBeforeMessage(task.session, 40).history).toHaveLength(40);
    expect(previous.history).toHaveLength(60);
  });

  it('sends older excerpts plus recent full messages without private tool or reasoning fields', () => {
    const history = Array.from({ length: 70 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `内容${index} ` + '长文字'.repeat(4000), toolCalls: [{ id: 'private', name: 'secret', arguments: 'PRIVATE_ARGUMENTS' }] }));
    const memory = buildAiModelMemory(history, '始终保留公式');
    expect(memory.recent).toHaveLength(8);
    expect(memory.summary).toContain('内容0');
    expect(memory.summary.length).toBeLessThanOrEqual(6000);
    expect(memory.instructions).toBe('始终保留公式');
    expect(JSON.stringify(memory)).not.toContain('PRIVATE_ARGUMENTS');
    expect(history).toHaveLength(70);
  });
  it('keeps escaped older excerpts valid JSON and rejects new sends at capacity without dropping history', () => {
    const history = Array.from({ length: 60 }, () => ({ role: 'user' as const, content: '"\\'.repeat(3000) }));
    const memory = buildAiModelMemory(history);
    expect(() => JSON.parse(memory.summary)).not.toThrow();
    expect(memory.summary.length).toBeLessThanOrEqual(6000);
    const previous = createAiSession('fixture'); previous.history = Array.from({ length: 2000 }, (_, index) => ({ role: 'user', content: `问题${index}` }));
    expect(() => beginAiChatTask(previous, provider, provider.model, '下一问', ids, createNotebookFixture())).toThrow(/2000/);
    expect(previous.history).toHaveLength(2000);
  });

  it('excludes other scopes and failed exchanges and does not mix a failed reply into a successful one', () => {
    const history = [
      { role: 'user' as const, content: '已完成要求', contextKey: 'a' }, { role: 'assistant' as const, content: '有效回答', contextKey: 'a', status: 'complete' as const },
      { role: 'user' as const, content: '另一份资料', contextKey: 'b' }, { role: 'assistant' as const, content: '秘密', contextKey: 'b', status: 'complete' as const },
      { role: 'user' as const, content: '失败要求', contextKey: 'a' }, { role: 'assistant' as const, content: '失败输出', contextKey: 'a', status: 'error' as const },
    ];
    expect(scopedAiHistory(history, 'a').map(item => item.content)).toEqual(['已完成要求', '有效回答']);
    expect(scopedAiHistory(history.slice(0, 1), 'a')).toEqual([]);
  });

  it('keeps fixed instructions in branches and retries the instructions of the original request', () => {
    const previous = { ...createAiSession('fixture'), memoryInstructions: '保留所有公式' };
    const task = beginAiChatTask(previous, provider, provider.model, '润色', ids, createNotebookFixture());
    expect(task.memoryInstructions).toBe('保留所有公式');
    const retry = retryAiChatTask({ ...task.session, status: 'error', memoryInstructions: '后来的要求' }, [provider], createNotebookFixture());
    expect(retry.memoryInstructions).toBe('保留所有公式');
    expect(forkAiChatBeforeMessage(task.session, 0).memoryInstructions).toBe('保留所有公式');
    expect(restoreAiSession('fixture', JSON.stringify(task.session))?.memoryInstructions).toBe('保留所有公式');
  });
});
