import { describe, expect, it } from 'vitest';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { aiHistoryContextKey, createAiSession, restoreAiSession } from './session.ts';
import { beginAiChatTask, forkAiChatBeforeMessage, retryAiChatTask } from './chatActions.ts';
import { createAiTextSelection } from './textSelection.ts';
import { aiTaskNoteIds, restoreAiTaskSupport, type AiTaskSupport } from './taskSupport.ts';
import { createAiToolContext, executeAiTool } from './tools.ts';
import { runAiTask } from './runner.ts';
import { ensureAiTheoryMaps } from './nativeEdits.ts';

const provider = { id: 'local', name: '服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'model', hasApiKey: false };
const support = (): AiTaskSupport => ({ references: [{ kind: 'note', id: 'fixture-definition' }], guidance: { instructions: '保留引用', skills: [{ id: 'precise', name: '精确改写', description: '改写正文', instructions: '先核对词典，再提出局部建议。' }] } });

describe('AI task reference and skill snapshots', () => {
  it('never uses a hidden old note as the current dictionary or map target', () => {
    const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition';
    state.view = 'dictionary'; state.activeSymbolId = state.symbols[0].id;
    expect(aiTaskNoteIds(state, 'current')).toEqual([]);
    state.view = 'maps'; expect(aiTaskNoteIds(state, 'current')).toEqual([]);
    state.view = 'notes'; expect(aiTaskNoteIds(state, 'current')).toEqual(['fixture-definition']);
    expect(aiTaskNoteIds(state, 'library')).toContain('fixture-definition');
  });
  it('freezes rules and references for retry, while preserving the next draft', () => {
    const state = createNotebookFixture(), input = support();
    const task = beginAiChatTask(createAiSession('a'), provider, 'model', '润色', [], state, input);
    input.guidance.instructions = '后来改动'; input.guidance.skills[0].instructions = '新步骤'; input.references.length = 0;
    expect(task.noteIds).toEqual(['fixture-definition']);
    expect(task.support?.guidance.instructions).toBe('保留引用');
    expect(task.session.history[0].skillIds).toEqual(['precise']);
    const retry = retryAiChatTask({ ...task.session, status: 'error', draft: '下一问', references: [], skillIds: [] }, [provider], state);
    expect(retry.support).toEqual(task.support); expect(retry.session.draft).toBe('下一问');
    expect(retry.session.history.filter(item => item.role === 'user')).toHaveLength(1);
  });
  it('isolates histories by rules and references, preserving old empty-context keys', () => {
    const plain = aiHistoryContextKey(provider, 'model', []);
    expect(aiHistoryContextKey(provider, 'model', [], undefined, [], { references: [], guidance: { instructions: '', skills: [] } })).toBe(plain);
    expect(aiHistoryContextKey(provider, 'model', ['fixture-definition'], undefined, [], { references: [{ kind: 'note', id: 'fixture-definition' }], guidance: { instructions: '', skills: [] } })).toBe(aiHistoryContextKey(provider, 'model', ['fixture-definition']));
    const one = aiHistoryContextKey(provider, 'model', [], undefined, [], support());
    const changed = support(); changed.guidance.skills[0].instructions += '核对条件';
    expect(one).not.toBe(plain); expect(aiHistoryContextKey(provider, 'model', [], undefined, [], changed)).not.toBe(one);
    changed.guidance = support().guidance; changed.references = [{ kind: 'module', id: 'symbols' }];
    expect(aiHistoryContextKey(provider, 'model', [], undefined, [], changed)).not.toBe(one);
  });
  it('does not widen a selection or read the library through a module reference', () => {
    const state = createNotebookFixture(), selection = createAiTextSelection(state, 'a', 'fixture-definition', ['fixture-definition:text'], '通用');
    const input = support(); input.references = [{ kind: 'note', id: 'fixture-summary' }];
    expect(() => beginAiChatTask({ ...createAiSession('a'), selection }, provider, 'model', '润色', [], state, input)).toThrow(/选区/);
    input.references = [{ kind: 'module', id: 'library' }];
    expect(beginAiChatTask(createAiSession('a'), provider, 'model', '帮助', [], state, input).noteIds).toEqual([]);
    input.references = [{ kind: 'note', id: 'removed' }];
    expect(() => beginAiChatTask(createAiSession('a'), provider, 'model', '帮助', [], state, input)).toThrow();
  });
  it('restores v1 sessions and rejects malformed retry snapshots without losing history', () => {
    const state = createNotebookFixture(), task = beginAiChatTask(createAiSession('a'), provider, 'model', '润色', [], state, support());
    const restored = restoreAiSession('a', JSON.stringify(task.session))!;
    expect(restored.lastRequest?.support).toEqual(task.support);
    expect(restored.history[0].references).toEqual(support().references);
    const invalid = { ...task.session, references: [{ kind: 'note', id: '' }], lastRequest: { ...task.session.lastRequest, support: { references: [], guidance: { instructions: '', skills: [{ id: 'broken' }] } } } };
    const recovered = restoreAiSession('a', JSON.stringify(invalid))!;
    expect(recovered.history[0].content).toBe('润色'); expect(recovered.lastRequest).toBeUndefined(); expect(recovered.references).toBeUndefined();
    const missing = restoreAiSession('a', JSON.stringify({ ...task.session, lastRequest: { ...task.session.lastRequest, support: undefined } }))!;
    expect(missing.lastRequest).toBeUndefined(); expect(missing.history[0].content).toBe('润色');
    expect(restoreAiTaskSupport({ references: [], guidance: { instructions: '', skills: [] }, arbitrary: 'ignored' })).toEqual({ references: [], guidance: { instructions: '', skills: [] } });
  });
  it('branches with original references and the current conversation skill selection', () => {
    const state = createNotebookFixture(), task = beginAiChatTask({ ...createAiSession('a'), skillIds: ['new-choice'] }, provider, 'model', '润色', [], state, support());
    const branch = forkAiChatBeforeMessage(task.session, 0);
    expect(branch.references).toEqual(support().references);
    expect(branch.skillIds).toEqual(['new-choice']); expect(branch.lastRequest).toBeUndefined();
  });
  it('sends only the selected workflow and stable object metadata, without granting edit access', async () => {
    const state = createNotebookFixture(), input = support();
    input.references = [{ kind: 'symbol', id: state.symbols[0].id }, { kind: 'module', id: 'symbols' }];
    const context = createAiToolContext(state, 'a', [], undefined, [], input);
    let payload = '';
    await runAiTask({ context, providerId: provider.id, prompt: '请检查', signal: new AbortController().signal, history: [{ role: 'user', content: '旧固定要求的历史' }, { role: 'assistant', content: '旧答复' }], memoryInstructions: '保留公式', complete: async request => {
      payload = JSON.stringify(request.messages);
      expect(request.messages.findIndex(item => item.content.includes('先核对词典，再提出局部建议'))).toBeGreaterThan(request.messages.findIndex(item => item.content === '旧答复'));
      expect(request.messages.findIndex(item => item.content.includes('本对话固定要求'))).toBeGreaterThan(request.messages.findIndex(item => item.content === '旧答复'));
      return { message: { role: 'assistant', content: '待用户确认' }, usage: { inputTokens: 1, outputTokens: 1 } };
    } });
    expect(payload).toContain('先核对词典，再提出局部建议'); expect(payload).toContain('保留引用'); expect(payload).toContain('保留公式');
    expect(context.readDictionaryIds.size).toBe(0); expect(context.noteIds.size).toBe(0);
    expect(() => executeAiTool(context, 'read_note', { noteId: 'fixture-definition' })).toThrow(/范围/);
    const help = JSON.stringify(executeAiTool(context, 'get_product_help', { query: '符号库' }));
    expect(help).toContain('mewiki-module:symbols'); expect(help).toContain('符号词典'); expect(help).not.toContain('通用内容');
  });
  it('allows explicitly referenced map metadata while keeping unapproved members and edit access hidden', () => {
    const state = ensureAiTheoryMaps(createNotebookFixture()), mapId = state.theoryMaps!.documents[0].id;
    const input = support(); input.references = [{ kind: 'map', id: mapId }];
    const context = createAiToolContext(state, 'a', [], undefined, [], input);
    const result = executeAiTool(context, 'read_theory_maps', { mapId }) as { noteIds: string[]; scopeComplete: boolean };
    expect(result.noteIds).toEqual([]); expect(result.scopeComplete).toBe(false); expect(context.readMapIds.size).toBe(0);
  });
});
