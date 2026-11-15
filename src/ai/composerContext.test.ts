import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createAiSession, restoreAiSession } from './session.ts';
import { beginAiChatTask, forkAiChatBeforeMessage, retryAiChatTask } from './chatActions.ts';
import { resolveAiComposerContext } from './composerContext.ts';
import { createAiTextSelection } from './textSelection.ts';
import { aiConversationHasContent } from './conversations.ts';
import type { AiTaskSupport } from './taskSupport.ts';

const provider = { id: 'local', name: '服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'model', hasApiKey: false };
const guidance = { instructions: '', skills: [] };

describe('unified AI composer context', () => {
  it('shows the actual current page only until the user chooses or removes a reference', () => {
    const state = createNotebookFixture(); state.view = 'notes'; state.activeNoteId = 'fixture-definition';
    const session = createAiSession('a');
    expect(resolveAiComposerContext(state, session)).toMatchObject({ references: [{ kind: 'note', id: 'fixture-definition' }], noteIds: ['fixture-definition'], implicit: true, scope: 'references' });
    session.referenceMode = 'explicit';
    state.activeNoteId = 'fixture-summary';
    expect(resolveAiComposerContext(state, session)).toMatchObject({ references: [], noteIds: [], implicit: false });
    expect(resolveAiComposerContext(state, { ...session, referenceMode: 'auto', inlineReferencesInvalid: true }).noteIds).toEqual([]);
  });
  it('uses explicit B without silently appending the open note A', () => {
    const state = createNotebookFixture(); state.view = 'notes'; state.activeNoteId = 'fixture-definition';
    const draft = { ...createAiSession('a'), references: [{ kind: 'note' as const, id: 'fixture-summary' }] };
    const context = resolveAiComposerContext(state, draft);
    expect(context.noteIds).toEqual(['fixture-summary']);
    const task = beginAiChatTask(draft, provider, 'model', '修改 B', ['fixture-definition'], state, { ...context, guidance });
    expect(task.noteIds).toEqual(['fixture-summary']);
    expect(task.support?.references).toEqual([{ kind: 'note', id: 'fixture-summary' }]);
  });
  it('does not authorize the library through an ordinary module reference', () => {
    const state = createNotebookFixture();
    const draft = { ...createAiSession('a'), references: [{ kind: 'module' as const, id: 'library' }] };
    expect(resolveAiComposerContext(state, draft).noteIds).toEqual([]);
    const full = resolveAiComposerContext(state, { ...draft, libraryScope: true });
    expect(full.scope).toBe('library');
    expect(full.noteIds).toContain('fixture-definition');
    expect(full.noteIds).toContain('fixture-summary');
    expect(full.implicit).toBe(false);
  });
  it('keeps selection as a strict boundary and rejects conflicting references or library scope', () => {
    const state = createNotebookFixture(), selection = createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '通用');
    const draft = { ...createAiSession('a'), selection };
    expect(resolveAiComposerContext(state, draft).noteIds).toEqual(['fixture-definition']);
    expect(() => resolveAiComposerContext(state, { ...draft, libraryScope: true })).toThrow(/选区/);
    expect(() => resolveAiComposerContext(state, { ...draft, references: [{ kind: 'note', id: 'fixture-summary' }] })).toThrow(/选区/);
    const support: AiTaskSupport = { references: [], guidance, scope: 'library' };
    expect(() => beginAiChatTask(draft, provider, 'model', '修改', [], state, support)).toThrow(/选区/);
  });
  it('freezes full-library scope for retry and old-message editing, independent of the next draft', () => {
    const state = createNotebookFixture();
    const task = beginAiChatTask({ ...createAiSession('a'), libraryScope: true, referenceMode: 'explicit' }, provider, 'model', '检索', [], state, { references: [], guidance, scope: 'library' });
    expect(task.noteIds).toContain('fixture-summary');
    expect(task.session.history[0].libraryScope).toBe(true);
    expect(task.session.libraryScope).toBe(true);
    const restored = restoreAiSession('a', JSON.stringify({ ...task.session, status: 'error', referenceMode: 'explicit', libraryScope: true, draft: '下一问' }))!;
    expect(restored.referenceMode).toBe('explicit'); expect(restored.libraryScope).toBe(true);
    expect(restored.lastRequest?.support?.scope).toBe('library');
    const retry = retryAiChatTask({ ...restored, libraryScope: false }, [provider], state);
    expect(retry.noteIds).toEqual(task.noteIds); expect(retry.support?.scope).toBe('library');
    expect(retry.session.draft).toBe('下一问');
    const branch = forkAiChatBeforeMessage(restored, 0);
    expect(branch.libraryScope).toBe(true); expect(branch.referenceMode).toBe('explicit');
    expect(aiConversationHasContent({ ...createAiSession('a'), libraryScope: true })).toBe(true);
  });
  it('restores removal without falling back and fails closed on a damaged scope snapshot', () => {
    const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; state.view = 'notes';
    const removed = restoreAiSession('a', JSON.stringify({ ...createAiSession('a'), referenceMode: 'explicit' }))!;
    expect(resolveAiComposerContext(state, removed).references).toEqual([]);
    const task = beginAiChatTask(createAiSession('a'), provider, 'model', '测试', [], state, { references: [], guidance, scope: 'library' });
    const damaged = restoreAiSession('a', JSON.stringify({ ...task.session, lastRequest: { ...task.session.lastRequest, support: { ...task.support, scope: 'all-data' } } }))!;
    expect(damaged.lastRequest).toBeUndefined(); expect(damaged.history[0].content).toBe('测试');
  });
  it('retains explicitly pinned context for follow-up questions while clearing sentence bindings', () => {
    const state = createNotebookFixture(), reference = { kind: 'note' as const, id: 'fixture-summary' };
    const draft = { ...createAiSession('a'), references: [reference], referenceMode: 'explicit' as const };
    const context = resolveAiComposerContext(state, draft);
    const task = beginAiChatTask(draft, provider, 'model', '请检查', [], state, { ...context, guidance });
    expect(task.session.references).toEqual([reference]);
    expect(resolveAiComposerContext(state, task.session).noteIds).toEqual(['fixture-summary']);
    const completed = { ...task.session, status: 'complete' as const, history: task.session.history.map(message => message.role === 'assistant' ? { ...message, content: '已检查。', status: 'complete' as const } : message) };
    const followup = beginAiChatTask(completed, provider, 'model', '继续解释', [], state, { ...resolveAiComposerContext(state, completed), guidance });
    expect(followup.history.some(message => message.content === '请检查')).toBe(true);
  });
  it.each([false, true])('recovers the proven source IDs of a legacy %s message without borrowing the current page', withMetadata => {
    const state = createNotebookFixture(); state.activeNoteId = 'fixture-results'; state.view = 'notes';
    const original = beginAiChatTask(createAiSession('a'), provider, 'model', '旧消息', ['fixture-definition', ...(withMetadata ? ['fixture-summary'] : [])], state, withMetadata ? { references: [{ kind: 'note', id: 'fixture-definition' }], guidance } : undefined);
    const restored = restoreAiSession('a', JSON.stringify({ ...original.session, status: 'complete' }))!;
    const branch = forkAiChatBeforeMessage(restored, 0);
    expect(resolveAiComposerContext(state, branch).noteIds).toEqual(original.noteIds);
    expect(branch.references).toEqual(original.noteIds.map(id => ({ kind: 'note', id })));
  });
  it('requires reselecting an unprovable or oversized legacy source group instead of dropping sources', () => {
    const state = createNotebookFixture();
    const task = beginAiChatTask(createAiSession('a'), provider, 'model', '旧消息', ['fixture-definition'], state);
    expect(() => forkAiChatBeforeMessage({ ...task.session, lastRequest: undefined }, 0)).toThrow(/重新引用/);
    const many = { ...task.session, lastRequest: { ...task.session.lastRequest!, noteIds: Array.from({ length: 13 }, (_, index) => `note-${index}`) } };
    expect(() => forkAiChatBeforeMessage(many, 0)).toThrow(/重新引用/);
  });
  it('does not mistake an earlier unified references-only message for an unprovable legacy scope', () => {
    const state = createNotebookFixture(), reference = { kind: 'note' as const, id: 'fixture-summary' };
    const first = beginAiChatTask({ ...createAiSession('a'), references: [reference], referenceMode: 'explicit' }, provider, 'model', '第一问', [], state, { references: [reference], guidance, scope: 'references' });
    const next = beginAiChatTask(first.session, provider, 'model', '下一问', [], state, { references: [reference], guidance, scope: 'references' });
    const restored = restoreAiSession('a', JSON.stringify(next.session))!;
    expect(restored.history[0].libraryScope).toBe(false);
    expect(resolveAiComposerContext(state, forkAiChatBeforeMessage(restored, 0)).noteIds).toEqual(['fixture-summary']);
  });
  it('excludes manuals from library search while allowing an explicitly referenced manual', () => {
    const state = createNotebookFixture(), manual = { ...state.notes[0], id: 'mewiki-manual-fixture' };
    state.notes.push(manual);
    expect(resolveAiComposerContext(state, { libraryScope: true }).noteIds).not.toContain(manual.id);
    expect(resolveAiComposerContext(state, { libraryScope: true, references: [{ kind: 'note', id: manual.id }] }).noteIds).toContain(manual.id);
  });
  it('keeps the original full-library retry snapshot when another note is added later', () => {
    const state = createNotebookFixture(), task = beginAiChatTask(createAiSession('a'), provider, 'model', '整库任务', [], state, { references: [], guidance, scope: 'library' });
    state.notes.push({ ...state.notes[0], id: 'created-later' });
    expect(retryAiChatTask({ ...task.session, status: 'error' }, [provider], state).noteIds).toEqual(task.noteIds);
  });
  it('recovers a legacy hidden source independently from a sentence reference that can still be unbound', () => {
    const state = createNotebookFixture(), prompt = '请检查 @结果摘要';
    const inlineReferences = [{ start: 4, end: 9, text: '@结果摘要', reference: { kind: 'note' as const, id: 'fixture-summary' } }];
    const task = beginAiChatTask({ ...createAiSession('a'), inlineReferences }, provider, 'model', prompt, ['fixture-definition'], state);
    const branch = forkAiChatBeforeMessage(task.session, 0);
    expect(resolveAiComposerContext(state, branch).noteIds).toEqual(['fixture-definition', 'fixture-summary']);
    expect(resolveAiComposerContext(state, { ...branch, inlineReferences: [] }).noteIds).toEqual(['fixture-definition']);
    const plain = { ...createAiSession('a'), history: [{ role: 'user' as const, content: '没有资料范围的普通消息' }] };
    expect(forkAiChatBeforeMessage(plain, 0).references).toEqual([]);
  });
});
