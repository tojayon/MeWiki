/** Stable boundary between MeWiki's provider transport and its native Agent tools. */
export type AiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic';

export interface AiProvider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: AiProtocol;
  model: string;
  hasApiKey: boolean;
}
export type AiProviderInput = Omit<AiProvider, 'hasApiKey'> & { apiKey?: string };
export interface AiSettings {
  revision: string;
  defaultProviderId: string | null;
  providers: AiProvider[];
}
export interface AiSettingsInput {
  revision: string;
  defaultProviderId: string | null;
  providers: AiProviderInput[];
}
export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}
/** Display-only tool argument stream. A reset replaces that key's temporary buffer. */
export interface AiToolStreamUpdate {
  key: string;
  name: string;
  arguments: string;
  reset?: boolean;
}
/** Opaque Responses continuation, kept only inside one task's in-memory messages. */
export interface AiResponsesReasoning {
  type: 'reasoning';
  id: string;
  summary: { type: 'summary_text'; text: string }[];
  encrypted_content?: string;
}
export function checkedResponsesReasoning(value: unknown): AiResponsesReasoning[] {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  if (!Array.isArray(value) || value.length > 20 || JSON.stringify(value).length > 300000) throw new Error('AI 推理续接数据无效或过长。');
  return value.map(item => {
    if (!object(item) || item.type !== 'reasoning' || typeof item.id !== 'string' || !item.id || item.id.length > 256 ||
      (item.encrypted_content !== undefined && (typeof item.encrypted_content !== 'string' || item.encrypted_content.length > 262144)) ||
      !Array.isArray(item.summary) || item.summary.length > 32 || item.summary.some(part => !object(part) || part.type !== 'summary_text' || typeof part.text !== 'string' || part.text.length > 16384)) throw new Error('AI 推理续接数据无效或过长。');
    return { type: 'reasoning', id: item.id, summary: item.summary.map(part => ({ type: 'summary_text', text: part.text as string })),
      ...(typeof item.encrypted_content === 'string' ? { encrypted_content: item.encrypted_content } : {}) };
  });
}
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
  responsesReasoning?: AiResponsesReasoning[];
}
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface AiCompletion {
  message: AiMessage;
  usage: { inputTokens: number; outputTokens: number };
}
export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; update: AiToolStreamUpdate }
  | { type: 'done'; result: AiCompletion }
  | { type: 'error'; error: string; failure?: import('./failures.ts').AiFailure };
export interface AiConnectionTest {
  response: boolean;
  stream: boolean;
  tools: boolean;
  message: string;
}
