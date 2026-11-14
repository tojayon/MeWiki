import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiSession, readAiSession, writeAiSession, aiHistoryContextKey } from './session.ts';
import { beginAiChatTask, retryAiChatTask, copyAiConversationText, forkAiChatBeforeMessage } from './chatActions.ts';
import { createAiTextSelection, aiTextSelectionError } from './textSelection.ts';
import { ensureAiTheoryMaps } from './nativeEdits.ts';

const provider = { id: 'local', name: '服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'model', hasApiKey: false };
const notebook = () => { const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; return state; };

describe('AI chat tasks and explicit text selection', () => {
  it('branches before an edited question and keeps only earlier replies and their suggestions', () => {
    const original = createAiSession('a');
    original.history = [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答', activity: { tools: [], proposalIds: ['early'] } }, { role: 'user', id: 'edit', content: '第二问' }, { role: 'assistant', content: '旧后续' }];
    original.proposals = ['early', 'later'].map(id => ({ id, libraryId: 'a', kind: 'append', title: id, targetId: 'fixture-definition', content: '新内容', before: notebook().notes[0] }));
    original.draft = '下一问草稿'; original.appliedIds = ['early', 'later']; original.conversationId = 'old';
    const before = structuredClone(original), branch = forkAiChatBeforeMessage(original, 2);
    expect(branch.conversationId).toBeUndefined(); expect(branch.history.map(item => item.content)).toEqual(['第一问', '第一答']);
    expect(branch.proposals.map(item => item.id)).toEqual(['early']); expect(branch.appliedIds).toEqual(['early']);
    expect(branch.draft).toBe('下一问草稿'); expect(branch.lastRequest).toBeUndefined(); expect(branch.output).toBe('');
    expect(original).toEqual(before);
    expect(() => forkAiChatBeforeMessage(original, 1)).toThrow(); expect(() => forkAiChatBeforeMessage(original, 50)).toThrow();
  });
  it('keeps edited-message drafts on refresh and discards only invalid edit metadata', () => {
    const original = createAiSession('a'); original.history = [{ role: 'user', id: 'edit', content: '原问题' }];
    Object.assign(original, { messageEdit: { index: 0, content: '修改到一半' } });
    const storage = { getItem: () => JSON.stringify(original) };
    expect(readAiSession('a', storage)).toMatchObject({ messageEdit: { index: 0, content: '修改到一半' }, history: [{ content: '原问题' }] });
    Object.assign(original, { messageEdit: { index: 10, content: '坏草稿' } });
    expect(readAiSession('a', storage)).not.toHaveProperty('messageEdit');
    expect(readAiSession('a', storage).history[0].content).toBe('原问题');
  });
  it('preserves a selected rendered quote with a stable block baseline and detects changes', () => {
    const state = notebook();
    const selection = createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '通用');
    expect(selection).toMatchObject({ libraryId: 'a', noteId: 'fixture-definition', text: '通用' });
    expect(aiTextSelectionError(state, 'a', selection)).toBe('');
    expect(aiTextSelectionError(state, 'b', selection)).toBeTruthy();
    state.notes.find(note => note.id === selection.noteId)!.blocks[0] = { id: 'fixture-definition:text', type: 'paragraph', text: '已改变的原文' };
    expect(aiTextSelectionError(state, 'a', selection)).toContain('变化');
  });
  it('rejects absent, non-text, oversized and empty selections instead of widening the task', () => {
    const state = notebook();
    expect(() => createAiTextSelection(state, 'a', 'missing', ['missing'], '引用')).toThrow();
    expect(() => createAiTextSelection(state, 'a', 'fixture-application', ['fixture-application:formula'], '公式')).toThrow();
    expect(() => createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '')).toThrow();
    expect(() => createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '字'.repeat(4001))).toThrow();
  });
  it('retries the original task once per click without another user message or losing the draft', () => {
    const state = notebook(), first = beginAiChatTask(createAiSession('a'), provider, 'model', '请润色', ['fixture-definition'], notebook());
    first.session.history.at(-1)!.content = '收到了一半';
    const failed = { ...first.session, status: 'error' as const, draft: '下一条尚未发送', output: '收到了一半', error: '连接中断' };
    const retry = retryAiChatTask(failed, [provider], state);
    expect(retry.prompt).toBe('请润色');
    expect(retry.noteIds).toEqual(['fixture-definition']);
    expect(retry.session.draft).toBe('下一条尚未发送');
    expect(retry.session.history.filter(message => message.role === 'user')).toHaveLength(1);
    expect(retry.session.history.at(-2)?.content).toBe('收到了一半');
    expect(retry.history).toEqual([]);
    expect(retry.session.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(() => retryAiChatTask(retry.session, [provider], state)).toThrow();
  });
  it('does not retry against a changed destination, a missing note or a changed selection', () => {
    const state = notebook();
    const selection = createAiTextSelection(state, 'a', state.activeNoteId, ['fixture-definition:text'], '通用');
    const { session } = beginAiChatTask({ ...createAiSession('a'), selection }, provider, 'model', '改写', [state.activeNoteId], state);
    session.status = 'interrupted';
    expect(() => retryAiChatTask(session, [{ ...provider, baseUrl: 'http://127.0.0.1:8888/v1' }], state)).toThrow(/服务/);
    expect(() => retryAiChatTask(session, [provider], { ...state, notes: [] })).toThrow();
    const block = state.notes.find(note => note.id === state.activeNoteId)!.blocks[0];
    if ('text' in block) block.text = '原文已经改变';
    expect(() => retryAiChatTask(session, [provider], state)).toThrow(/变化/);
  });
  it('restores valid retry and selection metadata without allowing foreign or malformed metadata to lose messages', () => {
    const state = notebook(), selection = createAiTextSelection(state, 'a', state.activeNoteId, ['fixture-definition:text'], '通用');
    const { session } = beginAiChatTask({ ...createAiSession('a'), selection }, provider, 'model', '解释', [state.activeNoteId], state);
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    writeAiSession({ ...session, selection }, storage);
    const restored = readAiSession('a', storage);
    expect(restored.lastRequest).toEqual(session.lastRequest);
    expect(restored.selection).toEqual(selection);
    expect(restored.history[0].selection).toEqual(selection);
    expect(restored.history.at(-1)?.status).toBe('interrupted');
    storage.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, selection: { ...selection, libraryId: 'b' }, lastRequest: { ...session.lastRequest, noteIds: ['different'] } }));
    const invalid = readAiSession('a', storage);
    expect(invalid.history[0].content).toBe('解释');
    expect(invalid.selection).toBeUndefined(); expect(invalid.lastRequest).toBeUndefined();
    expect(readAiSession('b', storage).history).toEqual([]);
  });
  it('copies readable messages and selected quotes without tools, internal identifiers or empty attempts', () => {
    const state = notebook(), selection = createAiTextSelection(state, 'a', state.activeNoteId, ['fixture-definition:text'], '通用');
    const session = beginAiChatTask({ ...createAiSession('a'), selection }, provider, 'model', '解释', [state.activeNoteId], state).session;
    session.history.push({ role: 'assistant', content: '**答案**', activity: { tools: ['private-tool'], proposalIds: ['private-id'] } });
    const text = copyAiConversationText(session.history, '你');
    expect(text).toContain('你\n'); expect(text).toContain('> 通用'); expect(text).toContain('**答案**');
    expect(text).not.toContain('private'); expect(text).not.toContain('fixture-definition');
    expect(session.contextKey).toBe(aiHistoryContextKey(provider, 'model', ['fixture-definition'], selection));
  });
  it('does not replay a task after a partial suggestion was approved or the original note was edited', () => {
    const state = notebook();
    const session = beginAiChatTask(createAiSession('a'), provider, 'model', '补充结论', [state.activeNoteId], state).session;
    session.status = 'error';
    state.activeNoteId = 'fixture-summary';
    expect(retryAiChatTask(session, [provider], state).noteIds).toEqual(['fixture-definition']);
    state.notes.find(note => note.id === 'fixture-definition')!.blocks.push({ id: 'approved', type: 'paragraph', text: '已批准的部分结果' });
    expect(() => retryAiChatTask(session, [provider], state)).toThrow(/原文/);
  });
  it('detects approved map changes while allowing map navigation', () => {
    const state = ensureAiTheoryMaps(notebook());
    const session = beginAiChatTask(createAiSession('a'), provider, 'model', '整理地图', [state.activeNoteId], state).session;
    session.status = 'error';
    state.theoryMaps!.activeMapId = 'navigation'; state.theoryMaps!.documents[0].view.selectedNodeId = 'navigation';
    expect(retryAiChatTask(session, [provider], state).prompt).toBe('整理地图');
    state.theoryMaps!.documents[0].title = '批准后的地图标题';
    expect(() => retryAiChatTask(session, [provider], state)).toThrow(/原文/);
  });
  it('keeps the original user message recoverable across many interrupted retries', () => {
    const state = notebook();
    let session = beginAiChatTask(createAiSession('a'), provider, 'model', '反复重试的原请求', [state.activeNoteId], state).session;
    for (let index = 0; index < 25; index++) session = retryAiChatTask({ ...session, status: 'interrupted' }, [provider], state).session;
    expect(session.history).toHaveLength(27);
    expect(session.history.filter(message => message.role === 'user')).toHaveLength(1);
  });
});
