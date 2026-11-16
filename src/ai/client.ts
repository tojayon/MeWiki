import type { AiCompletion, AiConnectionTest, AiMessage, AiSettings, AiSettingsInput, AiStreamEvent, AiToolDefinition, AiToolStreamUpdate } from './types.ts';
import { checkedResponsesReasoning } from './types.ts';
import { AiRequestError, aiHttpFailure, restoreAiFailure } from './failures.ts';

const base = '/api/mewiki/ai';
const headers = { 'Content-Type': 'application/json', 'X-MeWiki-Request': 'ai' };
const hasControls = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export interface AiChatRequest { providerId: string; model?: string; messages: AiMessage[]; tools?: AiToolDefinition[] }
export interface AiCompleteOptions { signal?: AbortSignal; onText?: (text: string) => void; onTool?: (update: AiToolStreamUpdate) => void }
export type AiRequest = <T>(path: string, init: RequestInit, read: (response: Response, signal?: AbortSignal) => Promise<T>) => Promise<T>;
export interface AiClient {
  getAiSettings: (signal?: AbortSignal) => Promise<AiSettings>;
  saveAiSettings: (settings: AiSettingsInput, signal?: AbortSignal) => Promise<AiSettings>;
  getAiModels: (providerId: string, signal?: AbortSignal) => Promise<string[]>;
  testAiProvider: (providerId: string, signal?: AbortSignal) => Promise<AiConnectionTest>;
  completeAi: (request: AiChatRequest, options?: AiCompleteOptions) => Promise<AiCompletion>;
}
async function checkedFetch(path: string, init: RequestInit) {
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'error', credentials: 'same-origin' });
  if (!response.ok) {
    let error = 'AI 服务请求失败。';
    let failure = aiHttpFailure(response.status);
    try { const payload = await response.json(); if (typeof payload.error === 'string') error = payload.error.slice(0, 500); failure = restoreAiFailure(payload.failure) ?? failure; } catch { /* Never expose raw upstream errors. */ }
    throw new AiRequestError(error, failure);
  }
  return response;
}
export function createAiClient(request: AiRequest = async (path, init, read) => read(await checkedFetch(path, init))): AiClient {
  return {
    getAiSettings: signal => request('/settings', { method: 'GET', signal }, response => response.json()),
    saveAiSettings: (settings, signal) => request('/settings', { method: 'PUT', body: JSON.stringify(settings), signal }, response => response.json()),
    getAiModels: (providerId, signal) => request('/models', { method: 'POST', body: JSON.stringify({ providerId }), signal }, async response => {
      const result = await response.json();
      if (!Array.isArray(result.models) || result.models.some((model: unknown) => typeof model !== 'string')) throw new Error('模型列表无效，请手动填写模型名称。');
      return result.models;
    }),
    testAiProvider: (providerId, signal) => request('/test', { method: 'POST', body: JSON.stringify({ providerId }), signal }, response => response.json()),
    completeAi: (input, options = {}) => request('/chat', { method: 'POST', body: JSON.stringify(input), signal: options.signal }, (response, signal) => readAiCompletion(response, { ...options, signal: signal ? AbortSignal.any([signal, ...(options.signal ? [options.signal] : [])]) : options.signal })),
  };
}
export const { getAiSettings, saveAiSettings, getAiModels, testAiProvider, completeAi } = createAiClient();
function validCompletion(value: unknown): value is AiCompletion {
  if (!value || typeof value !== 'object') return false;
  const result = value as AiCompletion;
  if (result.message?.responsesReasoning !== undefined) {
    try { result.message.responsesReasoning = checkedResponsesReasoning(result.message.responsesReasoning); }
    catch { return false; }
  }
  return result.message?.role === 'assistant' && typeof result.message.content === 'string' &&
    Number.isFinite(result.usage?.inputTokens) && result.usage.inputTokens >= 0 && Number.isFinite(result.usage?.outputTokens) && result.usage.outputTokens >= 0 &&
    (result.message.toolCalls === undefined || (Array.isArray(result.message.toolCalls) && result.message.toolCalls.length <= 16 && result.message.toolCalls.every(call => typeof call.id === 'string' && !!call.id && typeof call.name === 'string' && typeof call.arguments === 'string')));
}
async function readAiCompletion(response: Response, options: AiCompleteOptions): Promise<AiCompletion> {
  if (!response.body) throw new Error('AI 响应在完成前中断。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', size = 0, result: AiCompletion | undefined;
  const toolSizes = new Map<string, number>();
  const parse = (line: string) => {
    if (!line.trim()) return;
    options.signal?.throwIfAborted();
    if (result) throw new Error('AI 响应格式无效。');
    const event: AiStreamEvent = JSON.parse(line);
    if (event.type === 'error') throw new AiRequestError(typeof event.error === 'string' ? event.error.slice(0, 500) : 'AI 服务请求失败。', restoreAiFailure(event.failure) ?? { kind: 'response', recovery: 'retry' });
    if (event.type === 'text') {
      if (typeof event.text !== 'string') throw new Error('AI 响应格式无效。');
      options.onText?.(event.text);
    } else if (event.type === 'tool') {
      const update = event.update;
      if (!update || typeof update.key !== 'string' || !update.key || update.key.length > 256 || hasControls(update.key) ||
        typeof update.name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(update.name) || typeof update.arguments !== 'string' ||
        (update.reset !== undefined && typeof update.reset !== 'boolean')) throw new Error('AI 响应格式无效。');
      const length = (update.reset ? 0 : toolSizes.get(update.key) ?? 0) + update.arguments.length;
      if (length > 262144 || (!toolSizes.has(update.key) && toolSizes.size >= 20)) throw new Error('AI 工具参数超过允许长度。');
      toolSizes.set(update.key, length);
      options.onTool?.({ key: update.key, name: update.name, arguments: update.arguments, ...(update.reset !== undefined ? { reset: update.reset } : {}) });
    } else if (event.type === 'done') {
      if (result || !validCompletion(event.result)) throw new Error('AI 响应格式无效。');
      result = event.result;
    } else throw new Error('AI 响应格式无效。');
  };
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('AI 响应超过允许长度。');
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) parse(line);
    }
    pending += decoder.decode();
    if (pending.trim()) parse(pending);
    options.signal?.throwIfAborted();
    if (!result) throw new Error('AI 响应在完成前中断。');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
