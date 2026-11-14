import { describe, expect, it } from 'vitest';
import { createAiSession, readAiSession, writeAiSession } from './session.ts';
import { aiConversationTitle, identifyAiConversation, listAiConversations, readAiConversations, switchAiConversation } from './conversations.ts';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { applyAiProposal, createNoteProposal } from './proposals.ts';

const storage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};
const conversation = (id: string, title: string, libraryId = 'a') => identifyAiConversation({ ...createAiSession(libraryId), history: [{ role: 'user', content: title }], draft: `${title} 草稿` }, id);

describe('AI conversation history', () => {
  it('archives fixed requirements before the first message and restores them only in their conversation', () => {
    const store = storage();
    const current = { ...identifyAiConversation(createAiSession('a'), 'instructions-only'), memoryInstructions: '保留公式，使用简体中文' };
    const next = identifyAiConversation(createAiSession('a'), 'next');
    switchAiConversation(current, next, store);
    expect(readAiSession('a', store).memoryInstructions).toBeUndefined();
    const archived = readAiConversations('a', store).find(item => item.conversationId === current.conversationId);
    expect(archived?.memoryInstructions).toBe(current.memoryInstructions);
    switchAiConversation(next, archived!, store);
    expect(readAiSession('a', store)).toMatchObject({ conversationId: current.conversationId, memoryInstructions: current.memoryInstructions, history: [] });
  });

  it('keeps the old v1 session as a selectable conversation without losing drafts or reviews', () => {
    const store = storage(), proposal = createNoteProposal(createNotebookFixture(), 'a', { operation: 'create', title: '待审笔记', content: '待审内容' });
    writeAiSession({ ...createAiSession('a'), history: [{ role: 'user', content: '旧对话' }], draft: '旧草稿', proposals: [proposal], rejectedIds: [proposal.id] }, store);
    const legacy = identifyAiConversation(readAiSession('a', store), 'legacy');
    const next = identifyAiConversation(createAiSession('a'), 'new');
    switchAiConversation(legacy, next, store);
    expect(readAiSession('a', store).conversationId).toBe('new');
    const old = readAiConversations('a', store).find(item => item.conversationId === 'legacy')!;
    expect(old).toMatchObject({ draft: '旧草稿', proposals: [proposal], rejectedIds: [proposal.id] });
    switchAiConversation(next, old, store);
    expect(readAiSession('a', store)).toMatchObject({ conversationId: 'legacy', draft: '旧草稿', proposals: [proposal] });
    expect(readAiConversations('b', store)).toEqual([]);
  });

  it('uses the latest active snapshot and stable first question when sorting history', () => {
    const older = { ...conversation('old', '最初的提问'), updatedAt: '2026-11-12T10:00:00.000Z' };
    const newer = { ...conversation('new', '新对话'), updatedAt: '2026-11-13T10:00:00.000Z' };
    const active = { ...older, draft: '刚输入的草稿', updatedAt: '2026-11-13T11:00:00.000Z', history: [{ role: 'user' as const, content: '裁剪后的提问' }] };
    expect(aiConversationTitle(active)).toBe('最初的提问');
    expect(listAiConversations([older, newer], active).map(item => item.conversationId)).toEqual(['old', 'new']);
    expect(listAiConversations([older, newer], active)[0].draft).toBe('刚输入的草稿');
  });

  it('round-trips approval, undo, reply ownership and usage within the selected conversation', () => {
    const store = storage(), state = createNotebookFixture();
    const proposal = createNoteProposal(state, 'a', { operation: 'create', title: '已批准笔记', content: '明确批准后保存的内容' });
    const { change } = applyAiProposal(state, proposal, 'a');
    const current = { ...conversation('approved', '原始话题'), proposals: [proposal], changes: [change], appliedIds: [proposal.id], sourceIds: ['fixture-definition'],
      history: [{ role: 'user' as const, content: '原始话题' }, { role: 'assistant' as const, content: '已准备', activity: { tools: ['propose_note'], proposalIds: [proposal.id] } }],
      usageHistory: [{ prompt: '原始话题', providerName: '测试服务', model: 'model', inputTokens: 20, outputTokens: 10 }] };
    const other = conversation('other', '独立话题');
    switchAiConversation(current, other, store);
    const archived = readAiConversations('a', store).find(item => item.conversationId === 'approved')!;
    expect(archived).toMatchObject({ changes: [change], appliedIds: [proposal.id], proposals: [proposal], draft: current.draft, sourceIds: current.sourceIds, usageHistory: current.usageHistory, history: current.history });
    switchAiConversation(other, archived, store);
    expect(readAiSession('a', store).changes).toEqual([change]);
  });

  it('reports capacity instead of evicting conversations and frees a cleared slot', () => {
    const store = storage();
    const sessions = Array.from({ length: 50 }, (_, index) => conversation(`id-${index}`, `话题 ${index}`));
    store.setItem('mewiki:library:a:ai-conversations:v1', JSON.stringify({ version: 1, libraryId: 'a', sessions }));
    writeAiSession(sessions[0], store);
    const next = identifyAiConversation(createAiSession('a'), 'new');
    expect(() => switchAiConversation(sessions[0], next, store)).toThrow(/50/);
    expect(readAiConversations('a', store)).toHaveLength(50);
    const cleared = identifyAiConversation(createAiSession('a'), 'id-0');
    switchAiConversation(sessions[0], cleared, store);
    expect(readAiConversations('a', store)).toHaveLength(49);
    expect(() => switchAiConversation(cleared, next, store)).not.toThrow();
  });

  it('refuses to archive a snapshot that cannot be restored without replacing the active conversation', () => {
    const store = storage(), current = conversation('current', '保留内容');
    writeAiSession(current, store);
    expect(() => switchAiConversation({ ...current, output: '字'.repeat(100001) }, conversation('new', '下一段'), store)).toThrow(/保存/);
    expect(readAiSession('a', store).conversationId).toBe('current');
    expect(readAiConversations('a', store)).toEqual([]);
  });

  it('does not switch or remove either conversation if archive or active persistence fails', () => {
    for (const failOn of ['ai-conversations:v1', 'ai-session:v1']) {
      const store = storage(), current = conversation('current', '当前对话'), target = conversation('target', '目标对话');
      switchAiConversation(target, current, store);
      const failing = { getItem: store.getItem, setItem: (key: string, value: string) => { if (key.endsWith(failOn)) throw new Error('quota'); store.setItem(key, value); } };
      expect(() => switchAiConversation({ ...current, draft: '最新草稿' }, target, failing)).toThrow(/保存/);
      expect(readAiSession('a', store).conversationId).toBe('current');
      expect(listAiConversations(readAiConversations('a', store), current).map(item => item.conversationId).sort()).toEqual(['current', 'target']);
    }
  });

  it('clears only the selected conversation and never resurrects its older snapshot', () => {
    const store = storage(), a = conversation('one', '对话一'), b = conversation('two', '对话二');
    switchAiConversation(a, b, store);
    const cleared = identifyAiConversation(createAiSession('a'), 'two');
    switchAiConversation(b, cleared, store);
    switchAiConversation(cleared, a, store);
    const saved = readAiConversations('a', store);
    expect(saved.find(item => item.conversationId === 'two')?.history ?? []).toEqual([]);
    expect(readAiSession('a', store).history).toEqual(a.history);
  });

  it('keeps the last saved content when clearing fails to replace the active slot', () => {
    const store = storage(), current = conversation('current', '保留原对话');
    switchAiConversation(current, current, store);
    const failed = { getItem: store.getItem, setItem: (key: string, value: string) => { if (key.endsWith('ai-session:v1')) throw new Error('quota'); store.setItem(key, value); } };
    expect(() => switchAiConversation(current, identifyAiConversation(createAiSession('a'), 'current'), failed)).toThrow(/保存/);
    expect(readAiConversations('a', store)[0].history).toEqual(current.history);
  });

  it('rejects corrupt archives and cross-library snapshots instead of overwriting them', () => {
    const store = storage(), current = conversation('one', '本库对话'), foreign = conversation('foreign', '其他库', 'b');
    writeAiSession(current, store);
    expect(() => switchAiConversation(current, foreign, store)).toThrow();
    store.setItem('mewiki:library:a:ai-conversations:v1', '{bad');
    expect(() => readAiConversations('a', store)).toThrow(/历史/);
    expect(() => switchAiConversation(current, conversation('two', '新对话'), store)).toThrow(/历史/);
    expect(readAiSession('a', store).conversationId).toBe('one');
    store.setItem('mewiki:library:a:ai-conversations:v1', JSON.stringify({ version: 1, libraryId: 'a', sessions: [foreign] }));
    expect(() => readAiConversations('a', store)).toThrow(/历史/);
  });
});
