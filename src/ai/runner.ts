import { completeAi, type AiChatRequest } from './client.ts';
import { aiTools, buildAiSystemPrompt, executeAiTool, type AiToolContext } from './tools.ts';
import type { AiCompletion, AiMessage, AiToolStreamUpdate } from './types.ts';
import type { AiProposal } from './proposals.ts';
import { createAiDraft } from './drafts.ts';
import { nativeFingerprint } from './nativeEdits.ts';
import { t } from '../i18n/locale.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';

const MAX_TOOL_ROUNDS = 32;
const MAX_TOOL_CALLS = 40;
const MAX_IDLE_ROUNDS = 3;

/** The two text tools may express the same edit, but must both pass their own access checks. */
function textProposalKey(proposal: AiProposal): string | undefined {
  if (proposal.kind === 'replace-text') return nativeFingerprint([proposal.libraryId, proposal.targetId, proposal.blockId, proposal.content]);
  if (proposal.kind === 'native' && proposal.edit.action === 'block-update' && Object.keys(proposal.edit.fields).length === 1 && typeof proposal.edit.fields.text === 'string') {
    const block = proposal.before && 'blocks' in proposal.before ? findResearchBlock(proposal.before.blocks, proposal.edit.blockId ?? '')?.block : undefined;
    if (block && ['paragraph', 'heading', 'markdown'].includes(block.type)) return nativeFingerprint([proposal.libraryId, proposal.targetId, proposal.edit.blockId, proposal.edit.fields.text]);
  }
  return undefined;
}

export interface AiRunProgress {
  output: string; tools: string[]; sourceIds: string[]; proposals: AiProposal[];
  usage: { inputTokens: number; outputTokens: number };
}
export async function runAiTask(options: {
  context: AiToolContext; providerId: string; model?: string; prompt: string;
  signal: AbortSignal; history?: AiMessage[]; onProgress?: (progress: AiRunProgress) => void;
  onDraft?: (proposal: AiProposal | null) => void;
  complete?: (request: AiChatRequest, options: { signal: AbortSignal; onText: (text: string) => void; onTool: (update: AiToolStreamUpdate) => void }) => Promise<AiCompletion>;
}): Promise<AiRunProgress> {
  const { context, signal } = options;
  const messages: AiMessage[] = [{ role: 'system', content: buildAiSystemPrompt(context) },
    ...(options.history ?? []).filter(message => ['user', 'assistant'].includes(message.role) && message.content).slice(-8).map(message => ({ role: message.role, content: message.content.slice(0, 12000) })),
    { role: 'user', content: options.prompt }];
  const progress: AiRunProgress = { output: '', tools: [], sourceIds: [], proposals: [], usage: { inputTokens: 0, outputTokens: 0 } };
  const publish = () => {
    progress.proposals = [...context.proposals]; progress.sourceIds = [...context.sourceIds];
    options.onProgress?.({ ...progress, tools: [...progress.tools], usage: { ...progress.usage } });
  };
  let toolCount = 0, idleRounds = 0;
  let finishReason: 'budget' | 'stalled' | undefined;
  const successfulCalls = new Map<string, unknown>();
  const finish = () => {
    const notice = finishReason === 'stalled'
      ? t('AI 连续多轮未取得新进展，已停止重复调用。请审阅已有结果，调整要求后继续。')
      : t('本次已达到任务执行预算，已停止继续调用工具。请审阅已有结果；未完成的部分可缩小范围后继续。');
    progress.output = progress.output ? `${progress.output.slice(0, 100000 - notice.length - 2)}\n\n${notice}` : notice;
    options.onDraft?.(null); publish(); return progress;
  };
  for (let turn = 0; turn <= MAX_TOOL_ROUNDS; turn++) {
    signal.throwIfAborted();
    if (turn === MAX_TOOL_ROUNDS || toolCount >= MAX_TOOL_CALLS || context.proposals.length >= 20) finishReason ??= 'budget';
    const finalizing = !!finishReason;
    if (finalizing) messages.push({ role: 'system', content: '本次工具执行已停止，不要再调用工具。只根据已经返回的原文与待审阅建议总结已完成部分、尚未完成的内容和下一步；不得声称建议已经保存。' });
    if (JSON.stringify(messages).length > 400000) { finishReason = 'budget'; return finish(); }
    let streamed = '';
    const draftCalls = new Map<string, { name: string; arguments: string }>();
    const prefix = progress.output ? `${progress.output}\n\n` : '';
    let result: AiCompletion;
    try { result = await (options.complete ?? completeAi)({ providerId: options.providerId, model: options.model, messages, tools: finalizing ? [] : aiTools }, {
      signal, onText: text => {
        signal.throwIfAborted(); streamed += text;
        if (streamed.length + prefix.length > 100000) throw new Error('AI 响应超过允许长度。');
        progress.output = prefix + streamed; publish();
      },
      onTool: update => {
        signal.throwIfAborted();
        if (finalizing || !['propose_note', 'propose_term', 'propose_edit'].includes(update.name)) return;
        if (!draftCalls.has(update.key) && draftCalls.size >= 8) return;
        const current = draftCalls.get(update.key);
        const args = update.reset ? update.arguments : (current?.arguments ?? '') + update.arguments;
        draftCalls.set(update.key, { name: update.name, arguments: args.slice(0, 45001) });
        options.onDraft?.(createAiDraft(context, { name: update.name, arguments: args }, `draft:${turn}:${update.key}`));
      },
    }); } catch (error) {
      signal.throwIfAborted();
      if (!finalizing) throw error;
      return finish();
    }
    signal.throwIfAborted();
    progress.output = prefix + result.message.content;
    progress.usage.inputTokens += result.usage.inputTokens;
    progress.usage.outputTokens += result.usage.outputTokens;
    messages.push(result.message); publish();
    // A provider ignoring the absent tool definitions cannot extend the task budget.
    if (finalizing) return finish();
    if (!result.message.toolCalls?.length) { options.onDraft?.(null); return progress; }
    if (result.message.toolCalls.length > 8) throw new Error('单次工具调用数量已达到上限。');
    let madeProgress = false;
    for (const call of result.message.toolCalls) {
      signal.throwIfAborted();
      let content: string;
      const admitted = toolCount < MAX_TOOL_CALLS;
      try {
        if (!admitted) throw new Error('本次工具调用数量已达到上限。');
        toolCount++;
        if (call.arguments.length > 45000) throw new Error('AI 工具参数超过允许长度。');
        const args: unknown = JSON.parse(call.arguments);
        const key = nativeFingerprint([call.name, args]);
        const cached = successfulCalls.get(key);
        const proposing = ['propose_note', 'propose_term', 'propose_edit'].includes(call.name);
        let value: unknown;
        if (cached !== undefined && !proposing) value = cached && typeof cached === 'object' && !Array.isArray(cached) ? { ...cached, reused: true } : cached;
        else {
          const before = context.proposals.length;
          value = executeAiTool(context, call.name, args);
          const proposal = context.proposals[before], semanticKey = proposal && textProposalKey(proposal);
          const duplicate = semanticKey ? context.proposals.slice(0, before).find(item => textProposalKey(item) === semanticKey) : undefined;
          // Validate every new proposal first, then reuse an already registered equivalent suggestion.
          if (proposing && (cached !== undefined || duplicate)) {
            context.proposals.splice(before);
            value = { ...value as object, ...(cached as object ?? {}), ...(duplicate ? { proposalId: duplicate.id } : {}), reused: true };
          } else madeProgress = true;
          successfulCalls.set(key, value);
        }
        content = JSON.stringify(value);
        if (content.length > 150000) throw new Error('工具结果过长，请缩小查询范围。');
        progress.tools.push(call.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 工具执行失败。';
        content = JSON.stringify({ error: message });
        if (admitted) progress.tools.push(`${call.name}: ${message}`);
      }
      messages.push({ role: 'tool', content, toolCallId: call.id }); publish();
      options.onDraft?.(null);
    }
    idleRounds = madeProgress ? 0 : idleRounds + 1;
    if (idleRounds >= MAX_IDLE_ROUNDS) {
      options.onDraft?.(null);
      if (!context.proposals.length) throw new Error('AI 连续多轮未取得新进展，已停止重复调用。请调整要求后重试。');
      finishReason = 'stalled';
    }
  }
  return finish();
}
