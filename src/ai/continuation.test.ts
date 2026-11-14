import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiSession, readAiSession } from './session.ts';
import { beginAiChatTask, continueAiChatTask } from './chatActions.ts';
import { runAiTask } from './runner.ts';
import { createAiToolContext } from './tools.ts';
import type { AiTaskCheckpoint } from './checkpoint.ts';
import type { AiCompletion, AiToolCall } from './types.ts';
import { createAiTextSelection } from './textSelection.ts';
import { createAiMaterial } from './materials.ts';
import { createNoteProposal } from './proposals.ts';
import { checkedAiChatInput } from '../../server/aiTransport.ts';

const provider = { id: 'local', name: '服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'model', hasApiKey: false };
const reply = (toolCalls?: AiToolCall[], content = ''): AiCompletion => ({ message: { role: 'assistant', content, ...(toolCalls ? { toolCalls } : {}) }, usage: { inputTokens: 1, outputTokens: 2 } });
const call = (name: string, args: object) => ({ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) });
const fixture = () => {
  const state = createNotebookFixture();
  const task = beginAiChatTask(createAiSession('a'), provider, 'model', '分段整理', ['fixture-definition'], state);
  const checkpoint: AiTaskCheckpoint = { version: 1, libraryId: 'a', requestId: task.session.lastRequest!.messageId, scopeKey: task.session.lastRequest!.scopeKey,
    reads: [{ name: 'read_note', arguments: { noteId: 'fixture-definition' } }], proposalIds: [], summary: '已读定义；还需整理。' };
  return { state, task, checkpoint };
};
describe('bounded partial tasks and explicit continuation', () => {
  it('exposes a checkpoint on budget exhaustion and resumes without registering duplicate edits', async () => {
    const { state, task } = fixture(); let turn = 0;
    const args = { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: 'AI 修改。' };
    const result = await runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal, requestId: task.session.lastRequest!.messageId,
      complete: async request => {
        const index = turn++;
        if (!request.tools?.length) return reply(undefined, '已完成一项，尚有剩余。');
        return reply([index === 0 ? call('read_note', { noteId: 'fixture-definition' }) : index === 1 ? call('propose_note', args) : call('list_notes', { query: `查找${index}` })]);
      } });
    expect(result.finishReason).toBe('budget'); expect(result.checkpoint?.reads).toHaveLength(1); expect(result.proposals).toHaveLength(1);
    expect(result.checkpoint?.proposalIds).toEqual([result.proposals[0].id]);
    let step = 0;
    const continued = await runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal,
      checkpoint: result.checkpoint, existingProposals: result.proposals,
      complete: async request => {
        expect(JSON.stringify(request.messages)).toContain('已完成一项');
        expect(JSON.stringify(request.messages)).toContain(result.proposals[0].id);
        return step++ === 0 ? reply([call('propose_note', args)]) : reply(undefined, '剩余任务已完成。');
      } });
    expect(continued.finishReason).toBe('complete'); expect(continued.proposals).toEqual([]); expect(continued.checkpoint).toBeUndefined();
  });
  it('persists partial status and validates continuation while preserving drafts and history ownership', () => {
    const { state, task, checkpoint } = fixture();
    const session = { ...task.session, status: 'partial' as const, checkpoint, draft: '下一问的草稿' };
    session.history.at(-1)!.status = 'partial';
    const restored = readAiSession('a', { getItem: () => JSON.stringify(session) });
    expect(restored.status).toBe('partial'); expect(restored.history.at(-1)!.status).toBe('partial'); expect(restored.checkpoint).toEqual(checkpoint);
    const resumed = continueAiChatTask(restored, [provider], state);
    expect(resumed.checkpoint).toEqual(checkpoint); expect(resumed.session.draft).toBe('下一问的草稿');
    expect(resumed.session.history.filter(message => message.role === 'user')).toHaveLength(1);
    expect(resumed.session.history.filter(message => message.role === 'assistant')).toHaveLength(2);
    expect(resumed.session.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(() => continueAiChatTask(restored, [{ ...provider, baseUrl: 'http://127.0.0.1:8888/v1' }], state)).toThrow(/服务/);
    state.notes.find(note => note.id === 'fixture-definition')!.title = '手动变化';
    expect(() => continueAiChatTask(restored, [provider], state)).toThrow(/原文/);
    expect(beginAiChatTask(restored, provider, 'model', '新任务', task.noteIds, state).session.checkpoint).toBeUndefined();
  });
  it('discards malformed optional checkpoints without losing valid messages', () => {
    const { task, checkpoint } = fixture();
    for (const bad of [{ ...checkpoint, requestId: 'other' }, { ...checkpoint, reads: [{ name: 'propose_note', arguments: { operation: 'create' } }] }, { ...checkpoint, summary: 'x'.repeat(6001) }]) {
      const restored = readAiSession('a', { getItem: () => JSON.stringify({ ...task.session, status: 'partial', checkpoint: bad }) });
      expect(restored.history[0].content).toBe('分段整理'); expect(restored.checkpoint).toBeUndefined();
    }
  });
  it('marks a repeated read loop as partial even before any proposal exists', async () => {
    const { state, task } = fixture();
    const result = await runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal,
      complete: async request => request.tools?.length ? reply([call('read_note', { noteId: 'fixture-definition' })]) : reply(undefined, '已读原文，尚未修改。') });
    expect(result.finishReason).toBe('stalled'); expect(result.checkpoint?.reads).toHaveLength(1);
  });
  it('revalidates the original selection, materials and dictionary instead of using the next draft context', () => {
    const { state } = fixture(), material = createAiMaterial('a', 'source.md', 'md', 8, [{ label: '正文', text: '辅助原文' }]);
    const selection = createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '通用');
    const task = beginAiChatTask({ ...createAiSession('a'), selection, materials: [material], activeMaterialIds: [material.id] }, provider, 'model', '仅修改选区', ['fixture-definition'], state);
    task.session.status = 'partial'; task.session.checkpoint = { version: 1, libraryId: 'a', requestId: task.session.lastRequest!.messageId, scopeKey: task.session.lastRequest!.scopeKey, reads: [], proposalIds: [], summary: '需要继续' };
    task.session.selection = createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '内容');
    task.session.activeMaterialIds = [];
    expect(continueAiChatTask(task.session, [provider], state)).toMatchObject({ selection, materials: [material] });
    expect(() => continueAiChatTask({ ...task.session, materials: [] }, [provider], state)).toThrow(/辅助材料/);
    const changedSelection = structuredClone(state), block = changedSelection.notes.find(note => note.id === 'fixture-definition')!.blocks[0];
    if (block.type !== 'paragraph') throw new Error('fixture');
    block.text = '手动修改的选区';
    expect(() => continueAiChatTask(task.session, [provider], changedSelection)).toThrow(/选区原文/);
    const changedDictionary = structuredClone(state); changedDictionary.symbols[0].name = '修改后的词典名称';
    expect(() => continueAiChatTask(task.session, [provider], changedDictionary)).toThrow(/词典/);
  });
  it('keeps the suggestion limit and all prior identities across multiple execution segments', async () => {
    const { state, task, checkpoint } = fixture();
    const existing = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '已有结果' });
    checkpoint.proposalIds = [existing.id];
    const result = await runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal,
      checkpoint, existingProposals: [existing], proposalLimit: 1,
      complete: async request => request.tools?.length ? reply([call('propose_note', { operation: 'append', noteId: 'fixture-definition', content: '新的一项' }), call('propose_note', { operation: 'append', noteId: 'fixture-definition', content: '超过本段限额' })]) : reply(undefined, '仍有后续') });
    expect(result.finishReason).toBe('budget'); expect(result.proposals).toHaveLength(1);
    expect(result.checkpoint?.proposalIds).toEqual([existing.id, result.proposals[0].id]);
    let requests = 0;
    const final = await runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal,
      checkpoint: result.checkpoint, existingProposals: [existing, ...result.proposals],
      complete: async () => requests++ === 0 ? reply([call('propose_note', { operation: 'append', noteId: 'fixture-definition', content: '新的一项' })]) : reply(undefined, '完成') });
    expect(final.finishReason).toBe('complete'); expect(final.proposals).toEqual([]); expect(final.checkpoint).toBeUndefined();
  });
  it('replays checkpoint reads through the current scope before sending any model request', async () => {
    const { state, task, checkpoint } = fixture(); let requests = 0;
    checkpoint.reads = [{ name: 'read_note', arguments: { noteId: 'fixture-summary' } }];
    await expect(runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal,
      checkpoint, complete: async () => { requests++; return reply(); } })).rejects.toThrow(/范围/);
    expect(requests).toBe(0);
    const abort = new AbortController(); abort.abort();
    await expect(runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: abort.signal,
      checkpoint, complete: async () => { requests++; return reply(); } })).rejects.toThrow();
    expect(requests).toBe(0);
  });
  it('keeps restored reads and long continuations within the service message limit', async () => {
    const { state, task, checkpoint } = fixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.blocks = Array.from({ length: 40 }, (_, index) => ({ id: `read-${index}`, type: 'paragraph', text: `原文${index}` }));
    checkpoint.reads = note.blocks.map(block => ({ name: 'read_block', arguments: { noteId: note.id, blockId: block.id } }));
    const history = Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `旧对话${index}` }));
    let turn = 0;
    const result = await runAiTask({ context: createAiToolContext(state, 'a', task.noteIds), providerId: provider.id, prompt: task.prompt, signal: new AbortController().signal,
      checkpoint, history, complete: async request => {
        checkedAiChatInput(request);
        for (const message of request.messages) for (const call of message.toolCalls ?? []) if (call.id.startsWith('resume')) expect(call.id).toMatch(/^[a-zA-Z0-9_-]+$/);
        const index = turn++;
        if (!request.tools?.length) return reply(undefined, '已保留本段结果');
        return reply(Array.from({ length: index < 8 ? 2 : 1 }, (_, offset) => call('list_notes', { query: `唯一${index}-${offset}` })));
      } });
    expect(result.finishReason).toBe('budget'); expect(result.output).toContain('已保留本段结果');
    expect(turn).toBeGreaterThan(16); expect(result.checkpoint?.reads).toHaveLength(40);
  });
});
