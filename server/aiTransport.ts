import { randomUUID } from 'node:crypto';
import type { AiCompletion, AiConnectionTest, AiMessage, AiProtocol, AiToolCall, AiToolDefinition, AiToolStreamUpdate } from '../src/ai/types.ts';
import { checkedResponsesReasoning } from '../src/ai/types.ts';
import { AiServiceError, type AiProviderSecret } from './aiProviderStore.ts';

export interface AiChatInput { messages: AiMessage[]; tools?: AiToolDefinition[]; model?: string }
export interface AiTransportOptions {
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onTool?: (update: AiToolStreamUpdate) => void;
  onStreamDetected?: () => void;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const tokens = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const hasControls = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function aiEndpoint(baseUrl: string, protocol: AiProtocol, models = false): string {
  const url = new URL(baseUrl);
  let base = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages|models)$/, '');
  if (!base) base = '/v1';
  url.pathname = base + (models ? '/models' : protocol === 'openai-chat' ? '/chat/completions' : protocol === 'openai-responses' ? '/responses' : '/messages');
  return url.href;
}
function headers(provider: AiProviderSecret): Record<string, string> {
  const value: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' };
  if (provider.protocol === 'anthropic') {
    value['anthropic-version'] = '2023-06-01';
    if (provider.apiKey) value['x-api-key'] = provider.apiKey;
  } else if (provider.apiKey) value.Authorization = 'Bearer ' + provider.apiKey;
  return value;
}
function chatPayload(provider: AiProviderSecret, input: AiChatInput): Record<string, unknown> {
  const model = input.model ?? provider.model;
  if (provider.protocol === 'openai-chat') return {
    model, stream: true, stream_options: { include_usage: true },
    messages: input.messages.map(message => ({ role: message.role, content: message.content || (message.toolCalls?.length ? null : ''),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}),
    })),
    ...(input.tools?.length ? { tools: input.tools.map(tool => ({ type: 'function', function: { ...tool, strict: false } })) } : {}),
  };
  const system = input.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  if (provider.protocol === 'openai-responses') {
    const items: Record<string, unknown>[] = [];
    for (const message of input.messages) {
      if (message.role === 'system') continue;
      if (message.role === 'tool') items.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      else {
        if (message.role === 'assistant' && message.responsesReasoning) items.push(...message.responsesReasoning.map(item => ({ ...item })));
        if (message.content) items.push({ role: message.role, content: message.content });
        for (const call of message.toolCalls ?? []) items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
      }
    }
    return { model, stream: true, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: 8192, instructions: system, input: items,
      ...(input.tools?.length ? { tools: input.tools.map(tool => ({ type: 'function', ...tool, strict: false })) } : {}),
    };
  }
  const messages: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
  for (const message of input.messages) {
    if (message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content: Record<string, unknown>[] = [];
    if (message.role === 'tool') content.push({ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content });
    else {
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        let argumentsObject: unknown;
        try { argumentsObject = JSON.parse(call.arguments); } catch { throw new AiServiceError('历史工具参数不是有效的 JSON，请开始新任务。'); }
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: argumentsObject });
      }
    }
    if (!content.length) continue;
    if (messages.at(-1)?.role === role) messages.at(-1)!.content.push(...content);
    else messages.push({ role, content });
  }
  return { model, stream: true, max_tokens: 8192, system, messages,
    ...(input.tools?.length ? { tools: input.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
  };
}

export function checkedAiChatInput(value: unknown): AiChatInput {
  const body = record(value);
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 128) throw new AiServiceError('AI 对话消息数量无效，最多 128 条。');
  const messages = body.messages.map((item): AiMessage => {
    const message = record(item);
    if (!['system', 'user', 'assistant', 'tool'].includes(str(message.role)) || typeof message.content !== 'string' || message.content.length > 262144) throw new AiServiceError('AI 对话消息无效或过长。');
    const result: AiMessage = { role: message.role as AiMessage['role'], content: message.content };
    if (message.responsesReasoning !== undefined) {
      if (message.role !== 'assistant') throw new AiServiceError('AI 推理续接数据无效或过长。');
      try { result.responsesReasoning = checkedResponsesReasoning(message.responsesReasoning); }
      catch { throw new AiServiceError('AI 推理续接数据无效或过长。'); }
    }
    if (message.role === 'tool') {
      if (!str(message.toolCallId) || str(message.toolCallId).length > 256) throw new AiServiceError('AI 工具结果缺少调用标识。');
      result.toolCallId = str(message.toolCallId);
    }
    if (message.toolCalls !== undefined) {
      if (message.role !== 'assistant' || !Array.isArray(message.toolCalls) || message.toolCalls.length > 20) throw new AiServiceError('AI 工具调用无效。');
      result.toolCalls = message.toolCalls.map((item): AiToolCall => {
        const call = record(item);
        if (!str(call.id) || str(call.id).length > 256 || !/^[a-zA-Z0-9_-]{1,128}$/.test(str(call.name)) || typeof call.arguments !== 'string' || call.arguments.length > 262144) throw new AiServiceError('AI 工具参数无效或过长。');
        return { id: str(call.id), name: str(call.name), arguments: call.arguments };
      });
    }
    return result;
  });
  const result: AiChatInput = { messages };
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 256 || hasControls(body.model)) throw new AiServiceError('模型名称无效。');
    result.model = body.model.trim();
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > 20) throw new AiServiceError('AI 工具数量无效。');
    result.tools = body.tools.map((item): AiToolDefinition => {
      const tool = record(item);
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(str(tool.name)) || typeof tool.description !== 'string' || tool.description.length > 4096 || !tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters) || JSON.stringify(tool.parameters).length > 65536) throw new AiServiceError('AI 工具定义无效。');
      return { name: str(tool.name), description: tool.description, parameters: tool.parameters as Record<string, unknown> };
    });
  }
  return result;
}

async function transport<T>(options: AiTransportOptions, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 90000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try { return await work(signal); }
  catch (cause) {
    if (options.signal?.aborted) throw new AiServiceError('AI 请求已取消。');
    if (timeout.signal.aborted) throw new AiServiceError('AI 服务响应超时，请缩小任务或稍后重试。', 504);
    if (cause instanceof AiServiceError) throw cause;
    throw new AiServiceError('无法连接 AI 服务，请检查 API 地址、网络和接口类型。', 502);
  } finally { clearTimeout(timer); }
}
async function responseText(response: Response): Promise<string> {
  if (!response.body) throw new AiServiceError('AI 服务未返回内容。', 502);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let result = ''; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > MAX_UPSTREAM_BYTES) throw new AiServiceError('AI 服务返回内容过大，请缩小任务。', 413);
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function checkStatus(response: Response, models = false) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new AiServiceError(models ? `无法获取模型列表（HTTP ${response.status}），可以手动填写模型名称。` : `AI 服务请求失败（HTTP ${response.status}），请检查密钥、模型和接口类型。`, 502);
  }
}
interface StreamState {
  content: string;
  calls: Map<string, AiToolCall>;
  usage: AiCompletion['usage'];
  complete: boolean;
  responsesReasoning?: AiMessage['responsesReasoning'];
}
function usage(state: StreamState, input: unknown, output: unknown) {
  if (input !== undefined) state.usage.inputTokens = tokens(input);
  if (output !== undefined) state.usage.outputTokens = tokens(output);
}
function incomplete(reason: unknown) {
  if (['length', 'max_tokens', 'max_output_tokens', 'content_filter', 'refusal'].includes(str(reason))) throw new AiServiceError('AI 输出达到限制或被服务阻止，请缩小任务后重试。');
}
function finalResponses(state: StreamState, value: unknown) {
  const response = record(value);
  if (response.status && response.status !== 'completed') throw new AiServiceError('AI 输出未完整结束，请重试。');
  const output = array(response.output);
  const reasoning = output.filter(item => record(item).type === 'reasoning');
  if (reasoning.length) {
    try { state.responsesReasoning = checkedResponsesReasoning(reasoning); }
    catch { throw new AiServiceError('AI 推理续接数据无效或过长。', 502); }
  }
  if (output.length) {
    let content = ''; const calls = new Map<string, AiToolCall>();
    for (const item of output) {
      const block = record(item);
      if (block.type === 'message') content += array(block.content).map(part => { const value = record(part); return value.type === 'output_text' ? str(value.text) : ''; }).join('');
      if (block.type === 'function_call') calls.set(str(block.id) || str(block.call_id), { id: str(block.call_id), name: str(block.name), arguments: str(block.arguments) });
    }
    state.content = content; state.calls = calls;
  }
  const count = record(response.usage); usage(state, count.input_tokens, count.output_tokens); state.complete = true;
}
function parseEvent(state: StreamState, protocol: AiProtocol, source: string, append: (text: string) => void) {
  if (source === '[DONE]') { if (protocol === 'openai-chat') state.complete = true; return; }
  let value: Record<string, unknown>;
  try { value = record(JSON.parse(source)); } catch { throw new AiServiceError('AI 流式响应格式无效。', 502); }
  if (value.error || value.type === 'error' || value.type === 'response.failed' || value.type === 'response.incomplete') throw new AiServiceError('AI 服务返回错误或未完整结束，请检查模型后重试。', 502);
  if (protocol === 'openai-chat') {
    const count = record(value.usage); usage(state, count.prompt_tokens, count.completion_tokens);
    for (const choice of array(value.choices).slice(0, 1)) {
      const item = record(choice); const delta = record(item.delta);
      append(str(delta.content));
      for (const item of array(delta.tool_calls)) {
        const part = record(item); const fn = record(part.function); const key = String(part.index ?? 0);
        const call = state.calls.get(key) ?? { id: '', name: '', arguments: '' };
        call.id += str(part.id); call.name += str(fn.name); call.arguments += str(fn.arguments); state.calls.set(key, call);
      }
      incomplete(item.finish_reason); if (item.finish_reason) state.complete = true;
    }
  } else if (protocol === 'openai-responses') {
    if (value.type === 'response.output_text.delta') append(str(value.delta));
    if (value.type === 'response.output_item.added') {
      const item = record(value.item);
      if (item.type === 'function_call') state.calls.set(str(item.id) || String(value.output_index ?? 0), { id: str(item.call_id), name: str(item.name), arguments: str(item.arguments) });
    }
    if (value.type === 'response.function_call_arguments.delta') {
      const key = str(value.item_id) || String(value.output_index ?? 0); const call = state.calls.get(key);
      if (call) call.arguments += str(value.delta);
    }
    if (value.type === 'response.output_item.done') {
      const item = record(value.item);
      if (item.type === 'function_call') state.calls.set(str(item.id) || String(value.output_index ?? 0), { id: str(item.call_id), name: str(item.name), arguments: str(item.arguments) });
    }
    if (value.type === 'response.completed') finalResponses(state, value.response);
  } else {
    if (value.type === 'message_start') {
      const count = record(record(value.message).usage); usage(state, count.input_tokens, count.output_tokens);
    }
    if (value.type === 'content_block_start') {
      const block = record(value.content_block);
      if (block.type === 'tool_use') state.calls.set(String(value.index), { id: str(block.id), name: str(block.name), arguments: block.input && Object.keys(record(block.input)).length ? JSON.stringify(block.input) : '' });
      if (block.type === 'text') append(str(block.text));
    }
    if (value.type === 'content_block_delta') {
      const delta = record(value.delta);
      if (delta.type === 'text_delta') append(str(delta.text));
      if (delta.type === 'input_json_delta') { const call = state.calls.get(String(value.index)); if (call) call.arguments += str(delta.partial_json); }
    }
    if (value.type === 'message_delta') {
      incomplete(record(value.delta).stop_reason); const count = record(value.usage); usage(state, count.input_tokens, count.output_tokens);
    }
    if (value.type === 'message_stop') state.complete = true;
  }
  if (state.calls.size > 20) throw new AiServiceError('AI 一次返回的工具调用过多。');
}
function parseFull(state: StreamState, protocol: AiProtocol, value: unknown) {
  const body = record(value);
  if (body.error) throw new AiServiceError('AI 服务返回错误，请检查模型后重试。', 502);
  if (protocol === 'openai-responses') { finalResponses(state, body); return; }
  if (protocol === 'openai-chat') {
    const choice = record(array(body.choices)[0]); incomplete(choice.finish_reason);
    const message = record(choice.message); state.content = str(message.content);
    array(message.tool_calls).forEach((item, index) => { const call = record(item); const fn = record(call.function); state.calls.set(String(index), { id: str(call.id), name: str(fn.name), arguments: str(fn.arguments) }); });
    const count = record(body.usage); usage(state, count.prompt_tokens, count.completion_tokens);
  } else {
    incomplete(body.stop_reason);
    array(body.content).forEach((item, index) => { const block = record(item); if (block.type === 'text') state.content += str(block.text); if (block.type === 'tool_use') state.calls.set(String(index), { id: str(block.id), name: str(block.name), arguments: JSON.stringify(block.input ?? {}) }); });
    const count = record(body.usage); usage(state, count.input_tokens, count.output_tokens);
  }
  state.complete = true;
}

export async function completeAi(provider: AiProviderSecret, input: AiChatInput, options: AiTransportOptions = {}): Promise<AiCompletion> {
  const checked = checkedAiChatInput(input);
  return transport(options, async signal => {
    const response = await (options.fetch ?? globalThis.fetch)(aiEndpoint(provider.baseUrl, provider.protocol), { method: 'POST', headers: headers(provider), body: JSON.stringify(chatPayload(provider, checked)), signal, redirect: 'error' });
    checkStatus(response);
    if (signal.aborted) throw new AiServiceError('AI 请求已取消。');
    const state: StreamState = { content: '', calls: new Map(), usage: { inputTokens: 0, outputTokens: 0 }, complete: false };
    const secretForms = provider.apiKey ? [...new Set([provider.apiKey, JSON.stringify(provider.apiKey).slice(1, -1)])].sort((a, b) => b.length - a.length) : [];
    const secretTail = Math.max(0, ...secretForms.map(key => key.length - 1));
    const hideKey = (text: string) => secretForms.reduce((safe, key) => safe.split(key).join('[已隐藏密钥]'), text);
    const toolStreams: { key: string; source: string; callId: string; name: string; arguments: string }[] = [];
    const emitTools = (flush = false) => {
      for (const [source, call] of state.calls) {
        if (signal.aborted) throw new AiServiceError('AI 请求已取消。');
        if (call.arguments.length > 262144 || call.name.length > 128 || call.id.length > 256) throw new AiServiceError('AI 返回的工具调用不完整或无效，请重试。', 502);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(call.name)) continue;
        let entry = toolStreams.find(item => item.source === source || !!call.id && item.callId === call.id);
        if (!entry) {
          if (toolStreams.length >= 20) throw new AiServiceError('AI 一次返回的工具调用过多。');
          entry = { key: String(toolStreams.length), source, callId: call.id, name: '', arguments: '' }; toolStreams.push(entry);
        }
        if (call.id) entry.callId = call.id;
        const raw = call.arguments || (flush ? '{}' : '');
        let end = flush ? raw.length : Math.max(0, raw.length - secretTail);
        // Never expose a credential prefix by cutting through a complete escaped/raw key.
        for (const key of secretForms) {
          for (let at = raw.indexOf(key); at >= 0 && at < end; at = raw.indexOf(key, at + key.length)) {
            if (at + key.length > end) end = at;
          }
        }
        const safe = hideKey(raw.slice(0, end)), name = hideKey(call.name);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name)) continue;
        const reset = entry.name !== '' && (entry.name !== name || !safe.startsWith(entry.arguments));
        const delta = reset ? safe : safe.slice(entry.arguments.length);
        if (delta || entry.name !== name || reset) options.onTool?.({ key: entry.key, name, arguments: delta, ...(reset ? { reset: true } : {}) });
        entry.name = name; entry.arguments = safe;
      }
    };
    // Hold the trailing credential-length window so a split upstream echo cannot leak the key.
    let pendingText = '';
    const emit = (text: string, flush = false) => {
      pendingText += text;
      const safe = hideKey(pendingText);
      const keep = flush ? 0 : secretTail;
      if (safe.length > keep) { options.onText?.(safe.slice(0, safe.length - keep)); pendingText = safe.slice(safe.length - keep); }
    };
    const append = (text: string) => { state.content += text; if (text) emit(text); };
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      options.onStreamDetected?.();
      if (!response.body) throw new AiServiceError('AI 服务未返回内容。', 502);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { buffer += decoder.decode(); break; }
          bytes += value.byteLength; if (bytes > MAX_UPSTREAM_BYTES) throw new AiServiceError('AI 服务返回内容过大，请缩小任务。', 413);
          buffer += decoder.decode(value, { stream: true });
          let match: RegExpExecArray | null;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
            const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
            if (data) { parseEvent(state, provider.protocol, data, append); emitTools(); }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!state.complete || buffer.trim()) throw new AiServiceError('AI 流式输出未完整结束或已中断，请重试。', 502);
    } else {
      let value: unknown;
      try { value = JSON.parse(await responseText(response)); } catch (cause) { if (cause instanceof AiServiceError) throw cause; throw new AiServiceError('AI 服务返回的内容不是有效 JSON，请检查接口类型。', 502); }
      parseFull(state, provider.protocol, value); emit(state.content);
    }
    if (signal.aborted) throw new AiServiceError('AI 请求已取消。');
    const calls = [...state.calls.values()].map(call => ({ id: hideKey(call.id), name: hideKey(call.name), arguments: hideKey(call.arguments || '{}') }));
    if (calls.length > 20 || new Set(calls.map(call => call.id)).size !== calls.length || calls.some(call => !call.id || call.id.length > 256 || !/^[a-zA-Z0-9_-]{1,128}$/.test(call.name) || call.arguments.length > 262144)) throw new AiServiceError('AI 返回的工具调用不完整或无效，请重试。', 502);
    if (!state.content && !calls.length) throw new AiServiceError('AI 服务未返回文字或工具调用，请检查模型和接口类型。', 502);
    emit('', true);
    // Do not alter signed/encrypted continuation data; reject a credential echo instead.
    if (provider.apiKey && state.responsesReasoning?.some(item => [item.id, item.encrypted_content ?? '', ...item.summary.map(part => part.text)].some(value => value.includes(provider.apiKey)))) throw new AiServiceError('AI 推理续接数据无效或过长。', 502);
    emitTools(true);
    return { message: { role: 'assistant', content: hideKey(state.content), ...(calls.length ? { toolCalls: calls } : {}),
      ...(state.responsesReasoning ? { responsesReasoning: state.responsesReasoning } : {}) }, usage: state.usage };
  });
}

export async function listAiModels(provider: AiProviderSecret, options: AiTransportOptions = {}): Promise<string[]> {
  return transport(options, async signal => {
    const response = await (options.fetch ?? globalThis.fetch)(aiEndpoint(provider.baseUrl, provider.protocol, true), { headers: headers(provider), signal, redirect: 'error' });
    checkStatus(response, true); let value: unknown;
    try { value = JSON.parse(await responseText(response)); } catch (cause) { if (cause instanceof AiServiceError) throw cause; throw new AiServiceError('模型列表格式不受支持，可以手动填写模型名称。'); }
    const models = [...new Set(array(record(value).data).map(item => str(record(item).id)).filter(id => id && id.length <= 256 && !hasControls(id) && !id.includes(provider.apiKey || '\u0000')))];
    if (!models.length) throw new AiServiceError('服务没有提供模型列表，可以手动填写模型名称。');
    return models.slice(0, 2000);
  });
}
export async function testAiConnection(provider: AiProviderSecret, options: AiTransportOptions = {}): Promise<AiConnectionTest> {
  const nonce = randomUUID(); let streamed = false;
  const result = await completeAi(provider, {
    messages: [{ role: 'user', content: `MeWiki connection capability test. Call mewiki_connection_check with nonce ${nonce}. This is a fictional no-op test; do not access any real data.` }],
    tools: [{ name: 'mewiki_connection_check', description: 'Fictional no-op connection check.', parameters: { type: 'object', properties: { nonce: { type: 'string', enum: [nonce] } }, required: ['nonce'], additionalProperties: false } }],
  }, { ...options, onStreamDetected: () => { streamed = true; options.onStreamDetected?.(); } });
  const tools = result.message.toolCalls?.some(call => { if (call.name !== 'mewiki_connection_check') return false; try { return record(JSON.parse(call.arguments)).nonce === nonce; } catch { return false; } }) ?? false;
  return { response: true, stream: streamed, tools, message: tools ? '模型响应正常，工具调用测试通过。' : '模型响应正常，但未通过工具调用测试；可以聊天，执行笔记任务前请更换模型或检查服务。' };
}
