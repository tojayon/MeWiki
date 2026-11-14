import { describe, expect, it } from 'vitest';
import { aiHistoryContextKey, createAiSession, isAiProposalApplied, readAiSession, writeAiSession } from './session.ts';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createNoteProposal } from './proposals.ts';
import { applyAiProposalGroup } from './proposalGroup.ts';

describe('library-scoped AI sessions', () => {
  const storage = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };
  const usageRecord = (index: number) => ({ prompt: `提问 ${index}`, providerName: '测试服务', model: 'test-model', inputTokens: index * 10, outputTokens: index, completedAt: '2026-11-12T10:00:00.000Z' });
  it('distinguishes active approvals from undone history and keeps merged suggestions applied', () => {
    const state = createNotebookFixture(), proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: 'fixture-definition', content: '可反复审阅的建议' });
    const approved = applyAiProposalGroup(state, [proposal], 'a');
    const session = { ...createAiSession('a'), proposals: [proposal], appliedIds: [proposal.id], changes: approved.changes };
    expect(isAiProposalApplied(session, proposal.id)).toBe(true);
    expect(isAiProposalApplied({ ...session, changes: [] }, proposal.id)).toBe(false);
    expect(isAiProposalApplied({ ...session, changes: [], mergedIds: [proposal.id] }, proposal.id)).toBe(true);
    const store = storage(); writeAiSession({ ...session, changes: [] }, store);
    expect(isAiProposalApplied(readAiSession('a', store), proposal.id)).toBe(false);
    expect(readAiSession('a', store).appliedIds).toEqual([proposal.id]);
  });
  it('ignores malformed merge metadata while restoring a rejected undone suggestion and its messages', () => {
    const state = createNotebookFixture(), proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: 'fixture-definition', content: '撤回后拒绝' });
    const store = storage(), session = { ...createAiSession('a'), proposals: [proposal], appliedIds: [proposal.id], rejectedIds: [proposal.id], history: [{ role: 'user' as const, content: '保留这次对话' }] };
    for (const mergedIds of [{ invalid: true }, 'invalid', [proposal.id, 123]]) {
      store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, mergedIds }));
      expect(readAiSession('a', store)).toMatchObject({ proposals: [proposal], appliedIds: [proposal.id], rejectedIds: [proposal.id], history: session.history, mergedIds: [] });
    }
    writeAiSession({ ...session, mergedIds: [proposal.id] }, store);
    expect(readAiSession('a', store).rejectedIds).toEqual([]);
  });
  it('restores optional conversation identity without letting malformed metadata discard messages', () => {
    const store = storage(), session = { ...createAiSession('a'), history: [{ role: 'user' as const, content: '原始提问' }], conversationId: 'conversation-1', conversationTitle: '稳定标题', updatedAt: '2026-11-13T08:00:00.000Z' };
    writeAiSession(session, store);
    expect(readAiSession('a', store)).toMatchObject(session);
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, conversationId: {}, conversationTitle: '字'.repeat(301), updatedAt: 'invalid' }));
    const restored = readAiSession('a', store);
    expect(restored.history).toEqual(session.history);
    expect(restored.conversationId).toBeUndefined(); expect(restored.conversationTitle).toBeUndefined(); expect(restored.updatedAt).toBeUndefined();
  });
  it('restores optional merged approvals and ignores unapproved or unknown merged IDs', () => {
    const state = createNotebookFixture(), store = storage();
    const proposals = [1, 2].map(index => createNoteProposal(state, 'a', { operation: 'append', noteId: 'fixture-definition', content: `内容 ${index}` }));
    const session = { ...createAiSession('a'), proposals, appliedIds: [proposals[0].id] };
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, mergedIds: [proposals[0].id, proposals[0].id, proposals[1].id, 'unknown'] }));
    expect(readAiSession('a', store).mergedIds).toEqual([proposals[0].id]);
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, mergedIds: { invalid: true } }));
    expect(readAiSession('a', store)).toMatchObject({ proposals, mergedIds: [] });
    writeAiSession(session, store);
    expect(readAiSession('a', store).mergedIds ?? []).toEqual([]);
  });
  it('restores unsent drafts with the conversation, keeps libraries separate and clears them on a new session', () => {
    const store = storage(), history = [{ role: 'assistant' as const, content: '已经收到的回复' }];
    const draft = '尚未发送的追问\n保留原始换行';
    writeAiSession({ ...createAiSession('a'), history, draft }, store);
    expect(readAiSession('a', store)).toMatchObject({ history, draft });
    expect(readAiSession('b', store).draft ?? '').toBe('');
    writeAiSession(createAiSession('a'), store);
    expect(readAiSession('a', store).draft ?? '').toBe('');
  });
  it('ignores malformed or oversized drafts without discarding valid conversation history', () => {
    const store = storage(), history = [{ role: 'user' as const, content: '保留这条消息' }];
    for (const draft of [{ invalid: true }, '字'.repeat(12001), null]) {
      store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...createAiSession('a'), history, draft }));
      const recovered = readAiSession('a', store);
      expect(recovered.history).toEqual(history);
      expect(recovered.draft ?? '').toBe('');
    }
  });
  it('restores tools and proposal ownership on each assistant reply', () => {
    const state = createNotebookFixture(), store = storage();
    const proposals = [1, 2].map(index => createNoteProposal(state, 'a', { operation: 'create', title: `第 ${index} 轮笔记`, content: `第 ${index} 轮内容` }));
    const history = proposals.flatMap((proposal, index) => [
      { role: 'user' as const, content: `第 ${index + 1} 轮提问` },
      { role: 'assistant' as const, content: `第 ${index + 1} 轮答复`, activity: { tools: index ? ['get_capabilities', 'propose_note'] : ['propose_note'], proposalIds: [proposal.id] } },
    ]);
    writeAiSession({ ...createAiSession('a'), history, proposals }, store);
    expect(readAiSession('a', store).history).toEqual(history);
    expect(readAiSession('b', store).history).toEqual([]);
  });
  it('ignores malformed reply activity and unknown proposal references without losing messages', () => {
    const state = createNotebookFixture(), store = storage();
    const proposal = createNoteProposal(state, 'a', { operation: 'create', title: '保留建议', content: '保留内容' });
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...createAiSession('a'), proposals: [proposal], history: [
      { role: 'user', content: '提问', activity: { tools: [], proposalIds: [proposal.id] } },
      { role: 'assistant', content: '有效答复', activity: { tools: ['propose_note'], proposalIds: [proposal.id, 'unknown'] } },
      { role: 'assistant', content: '损坏统计', activity: { tools: [{ private: true }], proposalIds: [] } },
      { role: 'assistant', content: '重复引用', activity: { tools: [], proposalIds: [proposal.id] } },
    ] }));
    const restored = readAiSession('a', store);
    expect(restored.history).toEqual([
      { role: 'user', content: '提问' },
      { role: 'assistant', content: '有效答复', activity: { tools: ['propose_note'], proposalIds: [proposal.id] } },
      { role: 'assistant', content: '损坏统计' },
      { role: 'assistant', content: '重复引用', activity: { tools: [], proposalIds: [] } },
    ]);
    expect(restored.proposals).toEqual([proposal]);
  });
  it('restores per-reply usage beyond five records without crossing libraries', () => {
    const store = storage();
    const session = { ...createAiSession('a'), usageHistory: Array.from({ length: 7 }, (_, index) => usageRecord(index + 1)) };
    writeAiSession(session, store);
    expect(readAiSession('a', store)).toMatchObject({ usageHistory: session.usageHistory });
    expect(readAiSession('b', store)).toMatchObject({ usageHistory: [] });
  });
  it('keeps a bounded usage history and discards malformed telemetry without losing the conversation', () => {
    const store = storage();
    const valid = Array.from({ length: 105 }, (_, index) => usageRecord(index + 1));
    const session = { ...createAiSession('a'), history: [{ role: 'user' as const, content: '保留原始对话' }], usageHistory: [...valid, { ...usageRecord(0), inputTokens: -1 }, { ...usageRecord(0), outputTokens: 'invalid' }] };
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify(session));
    expect(readAiSession('a', store)).toMatchObject({ history: session.history, usageHistory: valid.slice(-100) });
  });
  it('retains the latest reported usage from older sessions without inventing earlier records or timestamps', () => {
    const store = storage();
    const session = { ...createAiSession('a'), status: 'complete' as const, providerName: '旧服务', model: 'old-model', usage: { inputTokens: 21, outputTokens: 8 }, history: [{ role: 'user' as const, content: '旧提问' }, { role: 'assistant' as const, content: '旧回复' }] };
    Reflect.deleteProperty(session, 'usageHistory');
    writeAiSession(session, store);
    expect(readAiSession('a', store)).toMatchObject({ usageHistory: [{ prompt: '旧提问', providerName: '旧服务', model: 'old-model', inputTokens: 21, outputTokens: 8 }] });
    expect(readAiSession('a', store).usageHistory?.[0]).not.toHaveProperty('completedAt');
  });
  it('records reported partial usage once when restoring an interrupted task', () => {
    const store = storage();
    const session = { ...createAiSession('a'), status: 'running' as const, providerName: '测试服务', model: 'test-model', usage: { inputTokens: 20, outputTokens: 4 }, history: [{ role: 'user' as const, content: '中断任务' }], usageHistory: [usageRecord(1)] };
    writeAiSession(session, store);
    const restored = readAiSession('a', store);
    expect(restored).toMatchObject({ status: 'interrupted', usageHistory: [usageRecord(1), { prompt: '中断任务', inputTokens: 20, outputTokens: 4 }] });
    writeAiSession(restored, store);
    expect(readAiSession('a', store)).toEqual(restored);
  });
  it('restores explicit empty-content text deletion suggestions and rejects empty replacements', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    const proposal = createNoteProposal(state, 'a', { operation: 'delete-text', noteId: note.id, blockId: note.blocks[0].id, content: '' });
    const store = storage(), session = { ...createAiSession('a'), proposals: [proposal] };
    writeAiSession(session, store);
    expect(readAiSession('a', store).proposals).toEqual([proposal]);
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, proposals: [{ ...proposal, kind: 'replace-text' }] }));
    expect(readAiSession('a', store).proposals).toEqual([]);
  });
  it('keeps each library separate and restores unfinished tasks as interrupted', () => {
    const store = storage(), a = createAiSession('a'); a.status = 'running'; a.output = '已生成的结果';
    writeAiSession(a, store);
    expect(readAiSession('a', store)).toMatchObject({ status: 'interrupted', output: '已生成的结果' });
    expect(readAiSession('b', store).output).toBe('');
  });
  it('ignores corrupt and cross-library payloads and reports failed persistence', () => {
    const store = storage();
    store.setItem('mewiki:library:a:ai-session:v1', '{bad json');
    expect(readAiSession('a', store).status).toBe('idle');
    const wrong = createAiSession('b'); store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify(wrong));
    expect(readAiSession('a', store).libraryId).toBe('a');
    expect(() => writeAiSession(createAiSession('a'), { setItem: () => { throw new Error('quota'); } })).toThrow(/会话/);
  });
  it('rejects object children and mismatched proposal targets at the persistence boundary', () => {
    const store = storage();
    const bad = { ...createAiSession('a'), tools: [{ unexpected: 'object' }], error: { unexpected: 'object' } };
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify(bad));
    expect(readAiSession('a', store)).toEqual(createAiSession('a'));
    const proposal = { id: 'p', libraryId: 'a', kind: 'term', targetId: 'term', title: '定义', content: '含义', before: null, term: { id: 'other-term', name: '定义', meaning: '含义', aliases: [] } };
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...createAiSession('a'), proposals: [proposal] }));
    expect(readAiSession('a', store).proposals).toEqual([]);
  });
  it('binds reusable conversation to the exact service, model and authorized note IDs', () => {
    const provider = { id: 'provider', baseUrl: 'https://example.test/v1', protocol: 'openai-chat' as const };
    const key = aiHistoryContextKey(provider, 'model', ['b', 'a']);
    expect(aiHistoryContextKey(provider, 'model', ['a', 'b'])).toBe(key);
    expect(aiHistoryContextKey(provider, 'model', ['a'])).not.toBe(key);
    expect(aiHistoryContextKey({ ...provider, baseUrl: 'https://other.example.test/v1' }, 'model', ['a', 'b'])).not.toBe(key);
    expect(aiHistoryContextKey(provider, 'other-model', ['a', 'b'])).not.toBe(key);
    const store = storage();
    const session = { ...createAiSession('a'), contextKey: key, history: [{ role: 'assistant' as const, content: '限定范围的历史', contextKey: key }] };
    writeAiSession(session, store);
    expect(readAiSession('a', store)).toMatchObject({ contextKey: key, history: [{ contextKey: key }] });
    store.setItem('mewiki:library:a:ai-session:v1', JSON.stringify({ ...session, contextKey: { bad: true } }));
    expect(readAiSession('a', store)).toEqual(createAiSession('a'));
  });
});
