import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { beginAiChatTask, copyAiConversationText, forkAiChatBeforeMessage, retryAiChatTask } from './chatActions.ts';
import { createAiSession, restoreAiSession, type AiSession } from './session.ts';
import { insertAiInlineReference, reconcileAiInlineReferences } from './inlineReferences.ts';
import { resolveAiReference } from './references.ts';
import { runAiTask } from './runner.ts';
import { createAiToolContext } from './tools.ts';

const provider = { id: 'local', name: '服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'model', hasApiKey: false };
function task() {
  const state = createNotebookFixture();
  const module = resolveAiReference(state, { kind: 'module', id: 'symbols' })!;
  const note = resolveAiReference(state, { kind: 'note', id: 'fixture-definition' })!;
  const one = insertAiInlineReference('请阅读，然后修改。', [], module, 3, 3);
  const at = one.text.indexOf('。');
  const draft = insertAiInlineReference(one.text, one.references, note, at, at);
  const session = { ...createAiSession('a'), draft: draft.text, inlineReferences: draft.references };
  return { state, draft, ...beginAiChatTask(session, provider, 'model', draft.text, [], state) };
}

describe('inline references through the chat lifecycle', () => {
  it('keeps the natural sentence, exact occurrences and stable identities together through retry and restore', () => {
    const first = task();
    expect(first.prompt).toBe(first.draft.text);
    expect(first.noteIds).toEqual(['fixture-definition']);
    expect(first.support?.references).toEqual(first.draft.references.map(item => item.reference));
    expect(first.session.inlineReferences).toEqual([]);
    expect(first.session.history[0].inlineReferences).toEqual(first.draft.references);
    const restored = restoreAiSession('a', JSON.stringify({ ...first.session, status: 'error', draft: '下一问草稿' }))!;
    const retry = retryAiChatTask(restored, [provider], first.state);
    expect(retry.prompt).toBe(first.prompt);
    expect(retry.inlineReferences).toEqual(first.inlineReferences);
    expect(retry.session.draft).toBe('下一问草稿');
    expect(retry.session.history.filter(item => item.role === 'user')).toHaveLength(1);
  });

  it('copies inline references once as part of the sentence, keeping separate pinned references', () => {
    const first = task(), message = first.session.history[0];
    const pinned = { kind: 'note' as const, id: 'fixture-summary' };
    const copied = copyAiConversationText([{ ...message, references: [...message.references!, pinned], referenceNames: [...message.referenceNames!, '单独固定的笔记'] }], '你');
    expect(copied).toBe(`你\n\n@单独固定的笔记\n\n${first.prompt}`);
    expect(copied.match(/@符号词典/g)).toHaveLength(1);
  });

  it('retains untouched inline references in an edited branch while leaving the original message intact', () => {
    const first = task(), original = structuredClone(first.session);
    const branch = forkAiChatBeforeMessage(first.session, 0), prompt = `请优先${first.prompt}`;
    expect(branch.references).toEqual([]);
    branch.inlineReferences = reconcileAiInlineReferences(first.prompt, prompt, branch.inlineReferences ?? []);
    const edited = beginAiChatTask(branch, provider, 'model', prompt, [], first.state);
    expect(edited.inlineReferences?.map(item => item.start)).toEqual(first.inlineReferences!.map(item => item.start + 3));
    expect(edited.support?.references).toEqual(first.support?.references);
    expect(first.session).toEqual(original);
  });

  it('keeps an independently pinned target when an edited branch deletes the same target from its sentence', () => {
    const first = task(), reference = { kind: 'note' as const, id: 'fixture-definition' };
    const original = beginAiChatTask({ ...createAiSession('a'), references: [reference], inlineReferences: first.inlineReferences }, provider, 'model', first.prompt, [], first.state);
    const restored = restoreAiSession('a', JSON.stringify(original.session))!;
    const branch = forkAiChatBeforeMessage(restored, 0), edited = first.prompt.replace('@关系定义', '这篇笔记');
    branch.inlineReferences = reconcileAiInlineReferences(first.prompt, edited, branch.inlineReferences ?? []);
    const resent = beginAiChatTask(branch, provider, 'model', edited, [], first.state);
    expect(branch.references).toEqual([reference]);
    expect(resent.noteIds).toEqual(['fixture-definition']);
  });

  it('does not substitute a same-name note after the explicitly referenced one is removed', () => {
    const first = task();
    const target = first.state.notes.find(item => item.id === 'fixture-definition')!;
    first.state.notes = first.state.notes.filter(item => item.id !== target.id);
    first.state.notes[0].title = target.title;
    expect(() => retryAiChatTask({ ...first.session, status: 'error' }, [provider], first.state)).toThrow(/移除|变化/);
  });

  it.each(['different-request-id', 'missing-request', 'broken-message', 'different-support'] as const)('keeps messages but disables retry for %s binding metadata', issue => {
    const first = task(), broken = structuredClone(first.session);
    broken.lastRequest!.inlineReferences = structuredClone(broken.lastRequest!.inlineReferences);
    if (issue === 'different-request-id') broken.lastRequest!.inlineReferences![1].reference.id = 'fixture-summary';
    if (issue === 'missing-request') delete broken.lastRequest!.inlineReferences;
    if (issue === 'broken-message') broken.history[0].inlineReferences![0].start++;
    if (issue === 'different-support') broken.lastRequest!.support!.references[1].id = 'fixture-summary';
    const restored = restoreAiSession('a', JSON.stringify(broken))!;
    expect(restored.history[0].content).toBe(first.prompt);
    expect(restored.lastRequest).toBeUndefined();
  });

  it('validates the same binding snapshot when retrying an in-memory task', () => {
    const first = task();
    const broken: AiSession = { ...structuredClone(first.session), status: 'error' };
    broken.lastRequest!.inlineReferences = structuredClone(broken.lastRequest!.inlineReferences);
    broken.lastRequest!.inlineReferences![1].reference.id = 'fixture-summary';
    expect(() => retryAiChatTask(broken, [provider], first.state)).toThrow(/句内引用/);
  });

  it('keeps a damaged draft visible but blocks sending until the user clears or reselects its references', () => {
    const first = task(), broken = structuredClone(first.draft.references);
    broken[0].start++;
    const restored = restoreAiSession('a', JSON.stringify({ ...createAiSession('a'), draft: first.prompt, inlineReferences: broken }))!;
    expect(restored.draft).toBe(first.prompt);
    expect(() => beginAiChatTask(restored, provider, 'model', first.prompt, ['fixture-summary'], first.state)).toThrow(/句内引用/);
    const again = restoreAiSession('a', JSON.stringify(restored))!;
    expect(() => beginAiChatTask(again, provider, 'model', first.prompt, [], first.state)).toThrow(/句内引用/);
  });

  it('keeps an explicitly cleared edited-message binding cleared after reload', () => {
    const first = task(), broken = structuredClone(first.session);
    broken.history[0].inlineReferences![0].start++;
    const restored = restoreAiSession('a', JSON.stringify(broken))!;
    expect(restored.history[0].inlineReferencesInvalid).toBe(true);
    restored.messageEdit = { index: 0, content: first.prompt, inlineReferences: [] };
    const cleared = restoreAiSession('a', JSON.stringify(restored))!;
    expect(cleared.messageEdit?.inlineReferences).toEqual([]);
    expect(cleared.messageEdit?.inlineReferencesInvalid).toBeUndefined();
  });

  it('sends occurrence metadata alongside the natural prompt and refuses unmatched task support', async () => {
    const first = task();
    let calls = 0;
    const complete = async () => { calls++; return { message: { role: 'assistant' as const, content: '待审阅' }, usage: { inputTokens: 1, outputTokens: 1 } }; };
    await expect(runAiTask({ context: createAiToolContext(first.state, 'a', first.noteIds), providerId: provider.id, prompt: first.prompt, inlineReferences: first.inlineReferences, signal: new AbortController().signal, complete })).rejects.toThrow(/句内引用/);
    expect(calls).toBe(0);
    await runAiTask({ context: createAiToolContext(first.state, 'a', first.noteIds, undefined, [], first.support), providerId: provider.id, prompt: first.prompt, inlineReferences: first.inlineReferences, signal: new AbortController().signal, complete: async request => {
      expect(request.messages.at(-1)?.content).toBe(first.prompt);
      expect(request.messages.some(item => item.content.includes(JSON.stringify(first.inlineReferences)))).toBe(true);
      return complete();
    } });
    expect(calls).toBe(1);
  });
});
