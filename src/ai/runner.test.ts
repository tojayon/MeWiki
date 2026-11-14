import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { buildAiSystemPrompt, createAiToolContext } from './tools.ts';
import { runAiTask } from './runner.ts';
import type { AiCompletion, AiMessage } from './types.ts';
import { createAiSession, readAiSession } from './session.ts';
import { createNoteProposal, createTermProposal } from './proposals.ts';
import { createNativeProposal } from './nativeProposals.ts';
import { createAiTextSelection } from './textSelection.ts';

describe('native AI task loop', () => {
  it('reuses retried new terms without comparing newly generated identities', async () => {
    const state = createNotebookFixture();
    for (const native of [false, true]) {
      const args = native ? { action: 'term-save', fields: { name: '重试术语', meaning: '同一份定义', aliases: ['同义名'], atoms: [{ text: '重试术语', meaning: '原子含义' }] } } : { name: '重试术语', meaning: '同一份定义' };
      const existing = native ? createNativeProposal(state, 'a', args) : createTermProposal(state, 'a', { name: '重试术语', meaning: '同一份定义' });
      let turn = 0;
      const result = await runAiTask({ context: createAiToolContext(state, 'a', ['fixture-definition']), providerId: 'provider', prompt: '重试术语', signal: new AbortController().signal,
        existingProposals: [existing], complete: async request => {
          if (turn++) {
            expect(JSON.parse(request.messages.at(-1)!.content)).toMatchObject({ proposalId: existing.id, reused: true });
            return { message: { role: 'assistant', content: '仍是原建议' }, usage: { inputTokens: 0, outputTokens: 0 } };
          }
          return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'term', name: native ? 'propose_edit' : 'propose_term', arguments: JSON.stringify(args) }] }, usage: { inputTokens: 0, outputTokens: 0 } };
        } });
      expect(result.proposals).toEqual([]);
    }
  });
  it('reuses inserted formulas when their output identities are generated again on retry', async () => {
    const state = createNotebookFixture();
    const args = { action: 'block-insert', noteId: 'fixture-definition', blockType: 'formula', fields: { tex: 'x', outputs: [{ entryId: 'example-vector', bindings: {} }] } };
    const existing = createNativeProposal(state, 'a', args);
    const calls = [
      { name: 'read_note', arguments: JSON.stringify({ noteId: 'fixture-definition' }) },
      { name: 'read_dictionary_entry', arguments: JSON.stringify({ kind: 'symbol', entryId: 'example-vector' }) },
      { name: 'propose_edit', arguments: JSON.stringify(args) },
    ];
    const result = await runAiTask({ context: createAiToolContext(state, 'a', ['fixture-definition']), providerId: 'provider', prompt: '重试公式', signal: new AbortController().signal,
      existingProposals: [existing], complete: async request => {
        const call = calls.shift();
        if (call) return { message: { role: 'assistant', content: '', toolCalls: [{ id: `formula-${calls.length}`, ...call }] }, usage: { inputTokens: 0, outputTokens: 0 } };
        expect(JSON.parse(request.messages.at(-1)!.content)).toMatchObject({ proposalId: existing.id, reused: true });
        return { message: { role: 'assistant', content: '保留原建议' }, usage: { inputTokens: 0, outputTokens: 0 } };
      } });
    expect(result.proposals).toEqual([]);
  });
  it('revalidates then reuses identical suggestions from a failed attempt without counting them twice', async () => {
    const state = createNotebookFixture();
    const existing = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '润色后的内容。' });
    const requests: AiMessage[][] = [];
    let turn = 0;
    const result = await runAiTask({ context: createAiToolContext(state, 'a', ['fixture-definition']), providerId: 'provider', prompt: '重试润色',
      signal: new AbortController().signal, existingProposals: [existing], complete: async request => {
        requests.push(structuredClone(request.messages));
        const call = turn++ === 0 ? { name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }
          : turn === 2 ? { name: 'propose_note', arguments: '{"operation":"replace-text","noteId":"fixture-definition","blockId":"fixture-definition:text","content":"润色后的内容。"}' } : null;
        return { message: { role: 'assistant', content: call ? '' : '等待审阅', ...(call ? { toolCalls: [{ id: `retry-${turn}`, ...call }] } : {}) }, usage: { inputTokens: 1, outputTokens: 1 } };
      } });
    expect(result.proposals).toHaveLength(0);
    expect(JSON.parse(requests.at(-1)!.at(-1)!.content)).toMatchObject({ proposalId: existing.id, reused: true });
    const denied = await runAiTask({ context: createAiToolContext(state, 'a', []), providerId: 'provider', prompt: '无权重试', signal: new AbortController().signal,
      existingProposals: [existing], complete: async request => request.messages.some(message => message.role === 'tool')
        ? { message: { role: 'assistant', content: request.messages.at(-1)!.content }, usage: { inputTokens: 0, outputTokens: 0 } }
        : { message: { role: 'assistant', content: '', toolCalls: [{ id: 'denied', name: 'propose_note', arguments: '{"operation":"replace-text","noteId":"fixture-definition","blockId":"fixture-definition:text","content":"润色后的内容。"}' }] }, usage: { inputTokens: 0, outputTokens: 0 } } });
    expect(denied.output).toContain('范围'); expect(denied.output).not.toContain('reused');
  });
  it('restricts selection edits to the selected text blocks while allowing original reading', async () => {
    const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.blocks.push({ id: 'not-selected', type: 'paragraph', text: '不要改动这里' });
    const selection = createAiTextSelection(state, 'a', note.id, ['fixture-definition:text'], '通用');
    const context = createAiToolContext(state, 'a', [note.id], selection);
    let turn = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '改选中内容', signal: new AbortController().signal, complete: async request => {
      const name = turn++ === 0 ? 'read_note' : turn === 2 ? 'propose_note' : '';
      const args = name === 'read_note' ? { noteId: note.id } : { operation: 'replace-text', noteId: note.id, blockId: 'not-selected', content: '错误修改' };
      if (name) return { message: { role: 'assistant', content: '', toolCalls: [{ id: `selected-${turn}`, name, arguments: JSON.stringify(args) }] }, usage: { inputTokens: 0, outputTokens: 0 } };
      return { message: { role: 'assistant', content: request.messages.at(-1)!.content }, usage: { inputTokens: 0, outputTokens: 0 } };
    } });
    expect(result.proposals).toEqual([]); expect(result.output).toContain('选区');
    expect(buildAiSystemPrompt(context)).toContain('通用');
  });
  it('finishes seven independent edits even when their reads and proposals need more than twelve rounds', async () => {
    const state = createNotebookFixture();
    const note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.blocks = Array.from({ length: 7 }, (_, index) => ({ id: `part-${index}`, type: 'paragraph', text: `原文 ${index}` }));
    const before = JSON.stringify(state);
    const context = createAiToolContext(state, 'a', [note.id]);
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '逐段修改', signal: new AbortController().signal,
      complete: async () => {
        const turn = calls++;
        if (turn === 15) return { message: { role: 'assistant', content: '七处修改已准备好，等待审阅。' }, usage: { inputTokens: 1, outputTokens: 1 } };
        const index = Math.floor((turn - 1) / 2);
        const name = turn === 0 ? 'read_note' : turn % 2 ? 'read_block' : 'propose_edit';
        const args = turn === 0 ? { noteId: note.id } : turn % 2 ? { noteId: note.id, blockId: `part-${index}` }
          : { action: 'block-update', noteId: note.id, blockId: `part-${index}`, fields: { text: `新文 ${index}` } };
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: `round-${turn}`, name, arguments: JSON.stringify(args) }] }, usage: { inputTokens: 1, outputTokens: 1 } };
      } });
    expect(calls).toBe(16);
    expect(result.proposals).toHaveLength(7);
    expect(result.output).toBe('七处修改已准备好，等待审阅。');
    expect(result.usage).toEqual({ inputTokens: 16, outputTokens: 16 });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('reuses successful repeated calls and one identical text edit across legacy and native tools', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const replies: AiCompletion[] = [
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } },
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'read-block', name: 'read_block', arguments: '{"noteId":"fixture-definition","blockId":"fixture-definition:text"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } },
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'legacy', name: 'propose_note', arguments: '{"operation":"replace-text","noteId":"fixture-definition","blockId":"fixture-definition:text","content":"统一的新文。"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } },
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'native', name: 'propose_edit', arguments: '{"action":"block-update","noteId":"fixture-definition","blockId":"fixture-definition:text","fields":{"text":"统一的新文。"}}' }] }, usage: { inputTokens: 1, outputTokens: 1 } },
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'read-again', name: 'read_block', arguments: '{"blockId":"fixture-definition:text","noteId":"fixture-definition"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } },
      { message: { role: 'assistant', content: '完成，等待审阅。' }, usage: { inputTokens: 1, outputTokens: 1 } },
    ];
    const requests: AiMessage[][] = [];
    const result = await runAiTask({ context, providerId: 'provider', prompt: '修改一次', signal: new AbortController().signal,
      complete: async request => { requests.push(structuredClone(request.messages)); return replies.shift()!; } });
    expect(result.proposals).toHaveLength(1);
    const reused = JSON.parse(requests[4].at(-1)!.content);
    expect(reused).toMatchObject({ proposalId: result.proposals[0].id, reused: true });
    expect(JSON.parse(requests[5].at(-1)!.content)).toMatchObject({ reused: true });
    expect(context.state.notes.find(note => note.id === 'fixture-definition')!.blocks[0]).toMatchObject({ text: '通用内容。' });
  });

  it('reserves one tool-free summary after the round budget and keeps its pending proposals', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const drafts: unknown[] = [];
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '分步调研', signal: new AbortController().signal,
      onDraft: value => { if (value) drafts.push(value); },
      complete: async (request, callbacks) => {
        const turn = calls++;
        if (turn === 32) {
          expect(request.tools).toEqual([]);
          expect(request.messages.at(-1)?.content).toContain('不要再调用工具');
          callbacks.onTool({ key: 'forbidden-summary-draft', name: 'propose_note', arguments: '{"operation":"create","title":"禁止迟到","content":"不能生成' });
          return { message: { role: 'assistant', content: '已完成当前部分，其余请继续。', toolCalls: [{ id: 'forbidden-late', name: 'propose_note', arguments: '{"operation":"create","title":"禁止迟到","content":"不能生成"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        const name = turn === 0 ? 'propose_note' : 'list_notes';
        const args = turn === 0 ? { operation: 'create', title: '待审阅草稿', content: '已有建议内容。' } : { query: `检索 ${turn}` };
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: `turn-${turn}`, name, arguments: JSON.stringify(args) }] }, usage: { inputTokens: 1, outputTokens: 1 } };
      } });
    expect(calls).toBe(33);
    expect(result.proposals).toHaveLength(1);
    expect(result.output).toContain('已达到任务执行预算');
    expect(result.output).toContain('请审阅已有结果');
    expect(result.output).toContain('已完成当前部分');
    expect(result.tools).toHaveLength(32);
    expect(result.usage).toEqual({ inputTokens: 33, outputTokens: 33 });
    expect(drafts).toEqual([]);
  });

  it('stops at forty tools, pairs all tool replies, and cannot execute additional summary calls', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '批量调研', signal: new AbortController().signal,
      complete: async request => {
        const turn = calls++;
        if (turn === 5) {
          expect(request.tools).toEqual([]);
          expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(40);
          return { message: { role: 'assistant', content: '本次先到这里。' }, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        return { message: { role: 'assistant', content: '', toolCalls: Array.from({ length: 8 }, (_, index) => ({ id: `batch-${turn}-${index}`, name: 'list_notes', arguments: JSON.stringify({ query: `唯一检索 ${turn}-${index}` }) })) }, usage: { inputTokens: 1, outputTokens: 1 } };
      } });
    expect(calls).toBe(6);
    expect(result.tools).toHaveLength(40);
    expect(result.output).toContain('任务执行预算');
  });

  it('answers a whole returned tool batch when the remaining execution budget is smaller than that batch', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '批量工具预算', signal: new AbortController().signal,
      complete: async request => {
        const turn = calls++;
        if (!request.tools?.length) {
          const replies = request.messages.filter(message => message.role === 'tool');
          expect(replies).toHaveLength(41);
          expect(replies.at(-1)).toMatchObject({ toolCallId: 'batch-5-1' });
          expect(JSON.parse(replies.at(-1)!.content)).toMatchObject({ error: expect.stringContaining('工具调用数量') });
          return { message: { role: 'assistant', content: '已停止读取。' }, usage: { inputTokens: 0, outputTokens: 0 } };
        }
        const count = turn < 4 ? 8 : turn === 4 ? 7 : 2;
        return { message: { role: 'assistant', content: '', toolCalls: Array.from({ length: count }, (_, index) => ({ id: `batch-${turn}-${index}`, name: 'list_notes', arguments: JSON.stringify({ query: `检索 ${turn}-${index}` }) })) }, usage: { inputTokens: 0, outputTokens: 0 } };
      } });
    expect(calls).toBe(7);
    expect(result.tools.filter(tool => tool === 'list_notes')).toHaveLength(40);
    expect(result.tools).toHaveLength(40);
    expect(readAiSession('a', { getItem: () => JSON.stringify({ ...createAiSession('a'), ...result, status: 'complete' }) }).tools).toEqual(result.tools);
  });

  it('stops before sending an oversized context and retains already published suggestions', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '控制上下文', signal: new AbortController().signal,
      complete: async () => {
        const turn = calls++;
        return { message: { role: 'assistant', content: '说明'.repeat(45000), toolCalls: [{ id: `context-${turn}`, name: turn === 0 ? 'propose_note' : 'list_notes',
          arguments: JSON.stringify(turn === 0 ? { operation: 'create', title: '保留结果', content: '可供审阅' } : { query: `继续 ${turn}` }) }] }, usage: { inputTokens: 0, outputTokens: 0 } };
      } });
    expect(calls).toBeLessThan(10);
    expect(result.proposals).toHaveLength(1);
    expect(result.output).toContain('任务执行预算');
    expect(result.output.length).toBeLessThanOrEqual(100000);
  });

  it('retains existing proposals when repeated successful calls make no progress and the final summary fails', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '提一次建议', signal: new AbortController().signal,
      complete: async request => {
        calls++;
        if (!request.tools?.length) throw new Error('模拟收尾服务断开');
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: `repeat-${calls}`, name: 'propose_note', arguments: '{"operation":"create","title":"只有一份","content":"不应重复创建"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } };
      } });
    expect(calls).toBe(5);
    expect(result.proposals).toHaveLength(1);
    expect(result.output).toContain('已停止重复调用');
    expect(result.output).toContain('请审阅已有结果');
  });

  it('tells the model to retain pending proposal results instead of rereading the unchanged original as a failure', () => {
    const prompt = buildAiSystemPrompt(createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']));
    expect(prompt).toContain('读取工具始终返回原文');
    expect(prompt).toContain('不要再用另一种工具重复提出相同改写');
    expect(prompt).toContain('同一轮并行读取');
  });

  it('checks permissions again before reusing a repeated proposal or another text tool', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    let calls = 0;
    const requests: AiMessage[][] = [];
    const result = await runAiTask({ context, providerId: 'provider', prompt: '保留权限检查', signal: new AbortController().signal,
      complete: async request => {
        requests.push(structuredClone(request.messages));
        const turn = calls++;
        if (turn === 4) return { message: { role: 'assistant', content: '只登记已授权的建议。' }, usage: { inputTokens: 0, outputTokens: 0 } };
        if (turn === 3) context.readNoteIds.clear();
        const name = turn === 0 ? 'read_note' : turn === 2 ? 'propose_edit' : 'propose_note';
        const args = turn === 0 ? { noteId: 'fixture-definition' } : turn === 2
          ? { action: 'block-update', noteId: 'fixture-definition', blockId: 'fixture-definition:text', fields: { text: '同一个改写' } }
          : { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '同一个改写' };
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: `permission-${turn}`, name, arguments: JSON.stringify(args) }] }, usage: { inputTokens: 0, outputTokens: 0 } };
      } });
    expect(result.proposals).toHaveLength(1);
    expect(JSON.parse(requests[3].at(-1)!.content)).toMatchObject({ error: expect.stringContaining('读取') });
    expect(JSON.parse(requests[4].at(-1)!.content)).toMatchObject({ error: expect.stringContaining('读取') });
    expect(result.tools.filter(name => name.includes('读取'))).toHaveLength(2);
  });

  it('propagates cancellation during the reserved summary and keeps already registered proposals', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const abort = new AbortController();
    let calls = 0;
    await expect(runAiTask({ context, providerId: 'provider', prompt: '收尾中止', signal: abort.signal,
      complete: async request => {
        calls++;
        if (!request.tools?.length) { abort.abort(); throw new DOMException('cancelled', 'AbortError'); }
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: `repeat-${calls}`, name: 'propose_note', arguments: '{"operation":"create","title":"已生成","content":"仍然可以审阅"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } };
      } })).rejects.toThrow();
    expect(calls).toBe(5);
    expect(context.proposals).toHaveLength(1);
  });
  it('publishes temporary drafts before completion and only registers the completed tool call', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const drafts: string[] = [];
    let turn = 0;
    const args = { operation: 'append', noteId: 'fixture-definition', content: '实时 **正文**。' };
    const result = await runAiTask({ context, providerId: 'provider', prompt: '补充', signal: new AbortController().signal,
      onDraft: value => { if (value) { drafts.push(value.content); expect(context.proposals).toHaveLength(0); } },
      complete: async (_request, callbacks) => {
        turn++;
        if (turn === 1) return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }, usage: { inputTokens: 0, outputTokens: 0 } };
        if (turn === 2) {
          callbacks.onTool({ key: '0', name: 'propose_note', arguments: '{"operation":"append","noteId":"fixture-definition","content":"实时 ' });
          callbacks.onTool({ key: '0', name: 'propose_note', arguments: '**正文**。"}' });
          return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'draft', name: 'propose_note', arguments: JSON.stringify(args) }] }, usage: { inputTokens: 0, outputTokens: 0 } };
        }
        return { message: { role: 'assistant', content: '完成' }, usage: { inputTokens: 0, outputTokens: 0 } };
      } });
    expect(drafts).toEqual(['实时', '实时 **正文**。']);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].id).not.toContain('draft:');
    expect(context.state.notes.find(note => note.id === 'fixture-definition')!.blocks).toHaveLength(1);
  });

  it('rejects late streaming arguments after cancellation', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const abort = new AbortController();
    const drafts: unknown[] = [];
    await expect(runAiTask({ context, providerId: 'provider', prompt: '取消', signal: abort.signal, onDraft: value => drafts.push(value),
      complete: async (_request, callbacks) => {
        abort.abort();
        callbacks.onTool({ key: '0', name: 'propose_note', arguments: '{"operation":"create","title":"迟到","content":"不能预览' });
        return { message: { role: 'assistant', content: '' }, usage: { inputTokens: 0, outputTokens: 0 } };
      } })).rejects.toThrow();
    expect(drafts.filter(Boolean)).toEqual([]);
    expect(context.proposals).toHaveLength(0);
  });

  it('executes several tool rounds, retains source links, and ends with review proposals and token usage', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const requests: AiMessage[][] = [];
    const replies: AiCompletion[] = [
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }, usage: { inputTokens: 10, outputTokens: 2 } },
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 'draft', name: 'propose_note', arguments: '{"operation":"append","noteId":"fixture-definition","content":"补充解释。"}' }] }, usage: { inputTokens: 20, outputTokens: 3 } },
      { message: { role: 'assistant', content: '已经准备好建议，请审阅。' }, usage: { inputTokens: 30, outputTokens: 4 } },
    ];
    const result = await runAiTask({ context, providerId: 'provider', prompt: '补充解释', signal: new AbortController().signal,
      complete: async request => { requests.push(structuredClone(request.messages)); return replies.shift()!; } });
    expect(requests[1].at(-1)).toMatchObject({ role: 'tool', toolCallId: 'read' });
    expect(requests[2].at(-1)).toMatchObject({ role: 'tool', toolCallId: 'draft' });
    expect(result.proposals).toHaveLength(1);
    expect(result.sourceIds).toEqual(['fixture-definition']);
    expect(result.usage).toEqual({ inputTokens: 60, outputTokens: 9 });
  });

  it('does not execute late tool calls after cancellation', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    const abort = new AbortController();
    await expect(runAiTask({ context, providerId: 'provider', prompt: '取消任务', signal: abort.signal,
      complete: async () => { abort.abort(); return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'late', name: 'propose_note', arguments: '{"operation":"create","title":"迟到结果","content":"不应创建建议"}' }] }, usage: { inputTokens: 0, outputTokens: 0 } }; } })).rejects.toThrow();
    expect(context.proposals).toHaveLength(0);
  });

  it('stops runaway tool loops and returns tool errors for unsupported operations', async () => {
    const context = createAiToolContext(createNotebookFixture(), 'a', ['fixture-definition']);
    let calls = 0;
    const result = await runAiTask({ context, providerId: 'provider', prompt: '错误工具', signal: new AbortController().signal,
      complete: async request => {
        calls++;
        if (!request.tools?.length) return { message: { role: 'assistant', content: '无法执行此操作。' }, usage: { inputTokens: 0, outputTokens: 0 } };
        if (calls > 1) expect(request.messages.at(-1)!.content).toContain('未知或未授权');
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: `tool-${calls}`, name: 'shell', arguments: '{}' }] }, usage: { inputTokens: 0, outputTokens: 0 } };
      } });
    expect(result.finishReason).toBe('stalled');
    expect(result.tools).toEqual(Array(3).fill('shell: 未知或未授权的 AI 工具。'));
    expect(result.output).toContain('已停止重复调用');
    expect(calls).toBe(4);
  });
});
