import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { beginAiChatTask } from '../src/ai/chatActions.ts';
import { createAiSession, type AiSession } from '../src/ai/session.ts';
import { createNoteProposal } from '../src/ai/proposals.ts';
import type { AiMessage } from '../src/ai/types.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';

const sessionKey = 'mewiki:library:default:ai-session:v1';
const noteId = 'fixture-definition';
const provider = { id: 'reliability', name: '接续测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'reliability-model', hasApiKey: false };
const stateFixture = () => {
  const state = createNotebookFixture(); state.activeNoteId = noteId; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === noteId)!.blocks = [{ id: 'target', type: 'paragraph', text: '保留。重复词。中间。重复词。结尾。' }, { id: 'manual', type: 'paragraph', text: '用户手动段落。' }];
  return state;
};
const done = (message: AiMessage) => JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 2, outputTokens: 1 } } }) + '\n';
const tool = (name: string, args: object) => ({ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) });
const savedSession = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionKey) as Promise<AiSession>;
const savedNote = (page: Page) => page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === id), noteId);

async function setup(page: Page, options: { english?: boolean; session?: AiSession; state?: ReturnType<typeof stateFixture> } = {}) {
  await page.addInitScript(({ state, session, english }) => {
    if (!sessionStorage.getItem('reliability-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem('mewiki:research-notebook-mode', 'read');
      if (session) localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
      sessionStorage.setItem('reliability-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state: stateFixture(), ...options });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); return openAiWorkspace(page, options.english);
}
async function moveChatLeft(page: Page, english = false) {
  const move = page.getByRole('button', { name: english ? 'Move AI panel' : '移动AI 面板', exact: true });
  for (let index = 0; index < 30; index++) await move.press('Shift+ArrowLeft');
}

test('enforces a repeated rendered word selection and preserves all text outside it through approval and undo', async ({ page }, info) => {
  const ai = await setup(page), text = page.locator('[data-block-id="target"] .research-read-text p').first();
  await text.evaluate(element => {
    const node = element.firstChild!, value = node.textContent!, start = value.lastIndexOf('重复词');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 3);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Alt+Enter');
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('重复词');
  let turn = 0; const original = (await savedNote(page)).blocks[0].text, replacement = '保留。重复词。中间。精确词。结尾。';
  await page.route('**/api/mewiki/ai/chat', route => {
    const message = ++turn === 1 ? { role: 'assistant' as const, content: '', toolCalls: [tool('read_note', { noteId })] }
      : turn === 2 ? { role: 'assistant' as const, content: '', toolCalls: [tool('propose_note', { operation: 'replace-text', noteId, blockId: 'target', content: '整段全部重写。' }), tool('propose_note', { operation: 'replace-text', noteId, blockId: 'target', content: replacement })] }
      : { role: 'assistant' as const, content: '局部建议已准备好。' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: done(message) });
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('仅修改选中词'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('局部建议已准备好。', { exact: true })).toBeVisible();
  const session = await savedSession(page); expect(session.proposals).toHaveLength(1); expect(session.tools.join()).toContain('超出选区');
  expect(session.history[0].selection!.blocks[0].ranges).toEqual([{ field: 'text', start: 10, end: 13 }]);
  await page.reload(); await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'); await expect(review.locator('ins.mewiki-ai-inline-change')).toHaveText('精确');
  await moveChatLeft(page);
  await page.screenshot({ path: info.outputPath('exact-selection-review.png') });
  await review.getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(replacement);
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(original);
});

test('protects emphasis and an adjacent image when the selected words are the only visible text', async ({ page }) => {
  const state = stateFixture(), note = state.notes.find(note => note.id === noteId)!;
  const original = '**始终** ![保留图片](/brand/mewiki-ai-mascot.svg)', replacement = original.replace('始终', '局部');
  note.blocks = [{ id: 'target', type: 'paragraph', text: original }];
  const ai = await setup(page, { state }), phrase = page.locator('[data-block-id="target"] .research-read-text strong');
  await phrase.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Alt+Enter');
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('始终');
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: done(++turn === 1
    ? { role: 'assistant', content: '', toolCalls: [tool('read_note', { noteId })] }
    : turn === 2 ? { role: 'assistant', content: '', toolCalls: [tool('propose_note', { operation: 'replace-text', noteId, blockId: 'target', content: '局部' }), tool('propose_note', { operation: 'replace-text', noteId, blockId: 'target', content: replacement })] }
    : { role: 'assistant', content: '已保护选区外的图片和格式。' }) }));
  await ai.getByLabel('任务要求', { exact: true }).fill('仅修改加粗文字'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已保护选区外的图片和格式。', { exact: true })).toBeVisible();
  const session = await savedSession(page); expect(session.proposals).toHaveLength(1); expect(session.tools.join()).toContain('超出选区');
  expect(session.history[0].selection!.blocks[0].ranges).toEqual([{ field: 'text', start: 2, end: 4 }]);
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'); await expect(review.getByRole('img', { name: '保留图片', exact: true })).toHaveCount(2);
  await moveChatLeft(page); await review.getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(replacement);
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(original);
});

test('applies an independent suggestion after manual editing and preserves it through refreshed undo', async ({ page }) => {
  const state = stateFixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'target', content: 'AI 建议的新文字。' });
  const session = createAiSession('default'); session.proposals = [proposal];
  session.history = [{ role: 'user', content: '润色第一段' }, { role: 'assistant', content: '建议等待审阅。', status: 'complete', activity: { tools: [], proposalIds: [proposal.id] } }];
  const ai = await setup(page, { session }); await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  const edit = page.locator('[data-block-id="manual"] .research-editable-text').first();
  await edit.click(); await edit.locator('[contenteditable=true]').fill('手动补充必须保留。'); await ai.getByLabel('任务要求', { exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[1].text).toBe('手动补充必须保留。');
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'); await expect(review).toContainText('手动补充必须保留。');
  await moveChatLeft(page); await review.getByRole('button', { name: '同意此修改', exact: true }).click();
  await page.reload(); await expandAiProposalCards(ai); await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[1].text).toBe('手动补充必须保留。');
});

test('shows three rendered versions and blocks approval when the same field has a manual conflict', async ({ page }, info) => {
  const proposal = createNoteProposal(stateFixture(), 'default', { operation: 'replace-text', noteId, blockId: 'target', content: 'AI 建议的新文字。' });
  const session = createAiSession('default'); session.proposals = [proposal];
  const ai = await setup(page, { session }); await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  const target = page.locator('[data-block-id="target"] .research-editable-text').first();
  await target.click(); await target.locator('[contenteditable=true]').fill('用户手动改写同一段。'); await ai.getByLabel('任务要求', { exact: true }).click();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  const conflict = review.locator('.mewiki-ai-review-conflict');
  await expect(conflict).toContainText('当前内容'); await expect(conflict).toContainText('用户手动改写同一段。'); await expect(conflict).toContainText('AI 建议的新文字。');
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('manual-conflict-versions.png') });
});

test('continues a budget-limited task after refresh, retains the draft and suggestion ownership, and counts each run', async ({ page }, info) => {
  const ai = await setup(page); let turn = 0, stage = 0;
  const replacement = { operation: 'replace-text', noteId, blockId: 'target', content: '第一项建议。' };
  await page.route('**/api/mewiki/ai/chat', route => {
    const request = route.request().postDataJSON(); const current = turn++;
    let message: AiMessage;
    if (stage) message = stage++ === 1 ? { role: 'assistant', content: '', toolCalls: [tool('propose_note', replacement), tool('propose_note', { operation: 'replace-text', noteId, blockId: 'manual', content: '剩余的第二项建议。' })] } : { role: 'assistant', content: '剩余任务已完成。' };
    else message = !request.tools?.length ? { role: 'assistant', content: '已完成第一项，还需整理第二项。' }
      : { role: 'assistant', content: '', toolCalls: [current === 0 ? tool('read_note', { noteId }) : current === 1 ? tool('propose_note', replacement) : tool('list_notes', { query: `读取${current}` })] };
    return route.fulfill({ contentType: 'application/x-ndjson', body: done(message) });
  });
  const input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('逐段整理这篇笔记'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  const resume = ai.getByRole('button', { name: '继续剩余任务', exact: true }); await expect(resume).toBeVisible();
  expect(turn).toBe(33); expect((await savedSession(page)).status).toBe('partial');
  await input.fill('下一问尚未发送'); await page.reload(); await expect(resume).toBeVisible();
  await page.screenshot({ path: info.outputPath('partial-task-resume.png') });
  stage = 1; await resume.click(); await expect(ai.getByText('剩余任务已完成。', { exact: true })).toBeVisible();
  const session = await savedSession(page); expect(session.status).toBe('complete'); expect(session.checkpoint).toBeUndefined();
  expect(session.proposals).toHaveLength(2); expect(session.history.filter(message => message.role === 'user')).toHaveLength(1);
  expect(session.history.filter(message => message.role === 'assistant').map(message => message.activity?.proposalIds.length)).toEqual([1, 1]);
  expect(session.usageHistory).toHaveLength(2); expect(session.usageHistory!.map(item => item.inputTokens)).toEqual([66, 4]);
  await expect(input).toHaveValue('下一问尚未发送'); expect((await savedNote(page)).blocks[0].text).toBe('保留。重复词。中间。重复词。结尾。');
});

test('shows the continuation action in narrow English UI and rechecks the destination before any request', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const task = beginAiChatTask(createAiSession('default'), provider, provider.model, 'Finish the remaining work', [noteId], stateFixture());
  task.session.status = 'partial'; task.session.history.at(-1)!.status = 'partial'; task.session.history.at(-1)!.content = 'First part is ready.';
  task.session.checkpoint = { version: 1, libraryId: 'default', requestId: task.session.lastRequest!.messageId, scopeKey: task.session.lastRequest!.scopeKey, reads: [], proposalIds: [], summary: 'First part is ready.' };
  const ai = await setup(page, { session: task.session, english: true }); let sent = 0;
  await page.route('**/api/mewiki/ai/chat', route => { sent++; return route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: 'Unexpected' }) }); });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '1', defaultProviderId: provider.id, providers: [{ ...provider, baseUrl: 'http://127.0.0.1:8888/v1' }] } }));
  const resume = ai.getByRole('button', { name: 'Continue remaining task', exact: true }); await expect(resume).toBeVisible(); await resume.click();
  await expect(ai.getByRole('alert')).toContainText('settings have changed'); expect(sent).toBe(0);
  await page.screenshot({ path: info.outputPath('partial-task-english-narrow.png') });
});
