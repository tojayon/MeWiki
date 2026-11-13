import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { completeAi, listAiModels, testAiConnection } from './aiTransport.ts';
import type { AiMessage } from '../src/ai/types.ts';

const provider = { id: 'sample', name: '虚构服务', baseUrl: 'http://127.0.0.1:9876/v1', protocol: 'openai-chat' as const, model: 'sample-model', apiKey: 'fictional-private-key' };
const messages: AiMessage[] = [{ role: 'system', content: '只使用用户选择的虚构资料。' }, { role: 'user', content: '读取笔记' }, { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_note', arguments: '{"id":"note-a"}' }] }, { role: 'tool', toolCallId: 'call-1', content: '虚构资料' }];
const tools = [{ name: 'read_note', description: '读取虚构笔记', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }];
function stream(events: unknown[]) {
  const source = events.map(event => 'data: ' + (typeof event === 'string' ? event : JSON.stringify(event)) + '\r\n\r\n').join('');
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({ start(controller) { for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('AI protocol transport', () => {
  it.each(['openai-chat', 'openai-responses', 'anthropic'] as const)('emits bounded tool argument deltas before %s finishes', async protocol => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const encode = (event: unknown) => new TextEncoder().encode('data: ' + (typeof event === 'string' ? event : JSON.stringify(event)) + '\n\n');
    const updates: { key: string; name: string; arguments: string; reset?: boolean }[] = [];
    const fragments = ['{"content":"', '正在生成的正文。'.repeat(30), '"}'];
    const args = fragments.join('');
    let finished = false;
    const result = completeAi({ ...provider, protocol, apiKey: '' }, { messages }, {
      onTool: update => updates.push(update),
      fetch: async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'Content-Type': 'text/event-stream' } }),
    }).finally(() => { finished = true; });
    await vi.waitFor(() => expect(controller).toBeDefined());
    const begin = protocol === 'openai-chat'
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'live', function: { name: 'propose_note', arguments: fragments[0] } }] } }] }
      : protocol === 'openai-responses'
        ? { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'item-live', call_id: 'live', name: 'propose_note', arguments: fragments[0] } }
        : { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'live', name: 'propose_note', input: {} } };
    controller.enqueue(encode(begin));
    for (const fragment of protocol === 'anthropic' ? fragments.slice(0, 2) : fragments.slice(1, 2)) controller.enqueue(encode(protocol === 'openai-chat'
      ? { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fragment } }] } }] }
      : protocol === 'openai-responses' ? { type: 'response.function_call_arguments.delta', item_id: 'item-live', delta: fragment }
        : { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: fragment } }));
    try {
      await vi.waitFor(() => expect(updates.some(update => update.arguments.includes('正在生成'))).toBe(true));
      expect(finished).toBe(false);
    } finally {
      if (protocol === 'openai-chat') {
        controller.enqueue(encode({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fragments[2] } }] }, finish_reason: 'tool_calls' }] }));
        controller.enqueue(encode('[DONE]'));
      } else if (protocol === 'openai-responses') controller.enqueue(encode({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', id: 'item-live', call_id: 'live', name: 'propose_note', arguments: args }] } }));
      else {
        controller.enqueue(encode({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: fragments[2] } }));
        controller.enqueue(encode({ type: 'message_stop' }));
      }
      controller.close();
      await result;
    }
    let received = '';
    for (const update of updates) received = update.reset ? update.arguments : received + update.arguments;
    expect(received).toBe(args);
    expect(new Set(updates.map(update => update.key)).size).toBe(1);
    expect(updates.every(update => update.name === 'propose_note')).toBe(true);
    expect(updates.reduce((sum, update) => sum + update.arguments.length, 0)).toBe(args.length);
  });
  it.each(['fictional-private-key', 'fictional-"quoted\\key'])('redacts split raw and escaped credentials in tool streams (%s)', async apiKey => {
    const encodedKey = JSON.stringify(apiKey).slice(1, -1);
    const args = '{"content":"' + encodedKey + ' ' + '末尾'.repeat(40) + '"}';
    const updates: { key: string; name: string; arguments: string; reset?: boolean }[] = [];
    const result = await completeAi({ ...provider, apiKey }, { messages }, { onTool: value => updates.push(value), fetch: async () => stream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'safe', function: { name: 'propose_note', arguments: args.slice(0, 20) } }] } }] },
      ...Array.from({ length: Math.ceil((args.length - 20) / 7) }, (_, i) => ({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(20 + i * 7, 27 + i * 7) } }] } }] })),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]',
    ]) });
    const received = updates.map(update => update.arguments).join('');
    expect(received).not.toContain(apiKey);
    expect(received).not.toContain(encodedKey);
    expect(JSON.parse(received).content).toContain('[已隐藏密钥]');
    expect(result.message.toolCalls?.[0].arguments).toBe(received);
  });
  it('resets a Responses draft when the completed tool replaces its streamed arguments', async () => {
    const updates: { key: string; name: string; arguments: string; reset?: boolean }[] = [];
    const draft = '{"content":"生成草稿"}', final = '{"content":"最终正文"}';
    const result = await completeAi({ ...provider, protocol: 'openai-responses', apiKey: '' }, { messages }, { onTool: value => updates.push(value), fetch: async () => stream([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'item-rewrite', call_id: 'call-rewrite', name: 'propose_note', arguments: draft } },
      { type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'call-rewrite', name: 'propose_note', arguments: final }] } },
    ]) });
    expect(updates).toEqual([{ key: '0', name: 'propose_note', arguments: draft }, { key: '0', name: 'propose_note', arguments: final, reset: true }]);
    expect(result.message.toolCalls?.[0].arguments).toBe(final);
  });
  it('rejects cancellation between tool events without forwarding another delta', async () => {
    const abort = new AbortController(), updates: unknown[] = [];
    await expect(completeAi({ ...provider, apiKey: '' }, { messages }, { signal: abort.signal, onTool: update => { updates.push(update); abort.abort(); }, fetch: async () => stream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'cancel-call', function: { name: 'propose_note', arguments: '{"content":"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '迟到正文"}' } }] }, finish_reason: 'tool_calls' }] }, '[DONE]',
    ]) })).rejects.toThrow(/取消/);
    expect(updates).toEqual([{ key: '0', name: 'propose_note', arguments: '{"content":"' }]);
  });
  it('assembles split UTF-8 text and tool arguments and retains tool history in Chat Completions', async () => {
    const text: string[] = []; let sent: Record<string, unknown> = {};
    const result = await completeAi(provider, { messages, tools }, { onText: chunk => text.push(chunk), fetch: async (url, init) => {
      expect(String(url)).toBe(provider.baseUrl + '/chat/completions'); sent = JSON.parse(String(init?.body));
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + provider.apiKey);
      return stream([{ choices: [{ delta: { content: '中文回答', tool_calls: [{ index: 0, id: 'call-2', function: { name: 'read_note', arguments: '{"id":' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"note-b"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } }, '[DONE]']);
    } });
    expect(text.join('')).toBe('中文回答'); expect(result.message.toolCalls).toEqual([{ id: 'call-2', name: 'read_note', arguments: '{"id":"note-b"}' }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(sent.messages).toMatchObject([{}, {}, { tool_calls: [{ id: 'call-1', function: { name: 'read_note' } }] }, { role: 'tool', tool_call_id: 'call-1' }]);
  });
  it('converts tool calls and results for Responses and reads its completed output', async () => {
    const result = await completeAi({ ...provider, protocol: 'openai-responses' }, { messages, tools }, { fetch: async (url, init) => {
      expect(String(url)).toBe(provider.baseUrl + '/responses'); const sent = JSON.parse(String(init?.body));
      expect(sent.instructions).toContain('虚构资料'); expect(sent.input).toContainEqual({ type: 'function_call_output', call_id: 'call-1', output: '虚构资料' });
      return stream([{ type: 'response.output_text.delta', delta: '已找到' }, { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '已找到' }] }, { type: 'function_call', call_id: 'call-r', name: 'read_note', arguments: '{"id":"note-r"}' }], usage: { input_tokens: 20, output_tokens: 6 } } }]);
    } });
    expect(result.message.content).toBe('已找到'); expect(result.message.toolCalls?.[0].id).toBe('call-r'); expect(result.usage.inputTokens).toBe(20);
  });
  it('converts Anthropic tool blocks and combines input_json_delta fragments', async () => {
    const result = await completeAi({ ...provider, protocol: 'anthropic' }, { messages, tools }, { fetch: async (url, init) => {
      expect(String(url)).toBe(provider.baseUrl + '/messages'); const sent = JSON.parse(String(init?.body));
      expect(sent.messages[1].content[0]).toMatchObject({ type: 'tool_use', id: 'call-1', input: { id: 'note-a' } });
      expect(sent.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call-1' });
      expect(new Headers(init?.headers).get('x-api-key')).toBe(provider.apiKey);
      return stream([{ type: 'message_start', message: { usage: { input_tokens: 15, output_tokens: 0 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-a', name: 'read_note', input: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"id":"n"}' } }, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
    } });
    expect(result.message.toolCalls).toEqual([{ id: 'call-a', name: 'read_note', arguments: '{"id":"n"}' }]); expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 5 });
  });
  it('carries encrypted Responses reasoning into the next tool round without storing the response remotely', async () => {
    const reasoning = { type: 'reasoning', id: 'rs-example', summary: [], encrypted_content: 'opaque-fictional-reasoning' };
    const responseProvider = { ...provider, protocol: 'openai-responses' as const };
    const first = await completeAi(responseProvider, { messages: messages.slice(0, 2), tools }, { fetch: async (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.store).toBe(false);
      expect(sent.include).toContain('reasoning.encrypted_content');
      return stream([{ type: 'response.completed', response: { status: 'completed', output: [reasoning, { type: 'function_call', call_id: 'call-r', name: 'read_note', arguments: '{"id":"note-r"}' }] } }]);
    } });
    expect(first.message).toMatchObject({ responsesReasoning: [reasoning] });
    await completeAi(responseProvider, { messages: [...messages.slice(0, 2), first.message, { role: 'tool', toolCallId: 'call-r', content: '虚构笔记' }], tools }, { fetch: async (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.input.slice(-3)).toEqual([reasoning, { type: 'function_call', call_id: 'call-r', name: 'read_note', arguments: '{"id":"note-r"}' }, { type: 'function_call_output', call_id: 'call-r', output: '虚构笔记' }]);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '续接完成' }] }] });
    } });
  });
  it('rejects interrupted or truncated output and never propagates upstream credentials in errors', async () => {
    await expect(completeAi(provider, { messages }, { fetch: async () => new Response(provider.apiKey, { status: 401 }) })).rejects.toThrow('401');
    try { await completeAi(provider, { messages }, { fetch: async () => new Response(provider.apiKey, { status: 401 }) }); } catch (error) { expect(String(error)).not.toContain(provider.apiKey); }
    await expect(completeAi(provider, { messages }, { fetch: async () => stream([{ choices: [{ delta: { content: '未完成' } }] }]) })).rejects.toThrow(/未完整|中断/);
    await expect(completeAi(provider, { messages }, { fetch: async () => stream([{ choices: [{ delta: {}, finish_reason: 'length' }] }, '[DONE]']) })).rejects.toThrow(/限制/);
  });
  it('passes cancellation upstream, refuses redirects, and allows model-list failures to remain explicit', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(completeAi(provider, { messages }, { signal: controller.signal, fetch: async (_url, init) => { expect(init?.signal?.aborted).toBe(true); throw new DOMException('aborted', 'AbortError'); } })).rejects.toThrow(/取消/);
    await expect(completeAi(provider, { messages }, { fetch: async (_url, init) => { expect(init?.redirect).toBe('error'); return new Response('', { status: 302 }); } })).rejects.toThrow(/302/);
    expect(await listAiModels(provider, { fetch: async () => Response.json({ data: [{ id: 'one' }, { id: 'two' }, { id: 'one' }] }) })).toEqual(['one', 'two']);
    await expect(listAiModels(provider, { fetch: async () => new Response('', { status: 404 }) })).rejects.toThrow(/手动填写/);
  });
  it('tests a real model response and reports missing tool support without pretending it is available', async () => {
    const plain = await testAiConnection(provider, { fetch: async () => stream([{ choices: [{ delta: { content: 'hello' }, finish_reason: 'stop' }] }, '[DONE]']) });
    expect(plain).toMatchObject({ response: true, stream: true, tools: false });
  });
  it('redacts an upstream key echo even when split across separate stream events', async () => {
    const parts: string[] = [];
    const result = await completeAi(provider, { messages }, { onText: text => parts.push(text), fetch: async () => stream([
      { choices: [{ delta: { content: 'prefix ' + provider.apiKey.slice(0, 9) } }] },
      { choices: [{ delta: { content: provider.apiKey.slice(9) + ' suffix' }, finish_reason: 'stop' }] }, '[DONE]',
    ]) });
    expect(parts.join('')).not.toContain(provider.apiKey);
    expect(parts.join('')).toBe('prefix [已隐藏密钥] suffix');
    expect(result.message.content).toBe('prefix [已隐藏密钥] suffix');
  });
  it('redacts JSON-escaped text credentials split one character at a time', async () => {
    const apiKey = 'fictional-"quoted\\value';
    const encodedKey = JSON.stringify(apiKey).slice(1, -1);
    const parts: string[] = [];
    const result = await completeAi({ ...provider, apiKey }, { messages }, { onText: text => parts.push(text), fetch: async () => stream([
      ...[...'prefix ' + encodedKey + ' suffix'].map(content => ({ choices: [{ delta: { content } }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]',
    ]) });
    expect(parts.join('')).toBe('prefix [已隐藏密钥] suffix');
    expect(result.message.content).toBe(parts.join(''));
  });
  it('rejects credential echoes inside opaque reasoning even for quoted credentials', async () => {
    const apiKey = 'fictional-key-"quoted\\value';
    await expect(completeAi({ ...provider, apiKey, protocol: 'openai-responses' }, { messages: messages.slice(0, 2) }, { fetch: async () => Response.json({ status: 'completed', output: [
      { type: 'reasoning', id: 'rs-key', summary: [{ type: 'summary_text', text: apiKey }], encrypted_content: 'opaque-fictional-token' },
      { type: 'message', content: [{ type: 'output_text', text: '正常文字' }] },
    ] }) })).rejects.toThrow(/续接数据/);
  });
  it('aborts an actual upstream HTTP stream when its caller cancels', async () => {
    let closed!: () => void; const upstreamClosed = new Promise<void>(resolve => { closed = resolve; });
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(120) } }] }) + '\n\n');
      response.on('close', closed);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const controller = new AbortController();
      const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
      await expect(completeAi({ ...provider, baseUrl }, { messages }, { signal: controller.signal, onText: () => controller.abort() })).rejects.toThrow(/取消/);
      await Promise.race([upstreamClosed, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('upstream stream was not cancelled')), 1000))]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
