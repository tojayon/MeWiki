import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createAiSession, aiHistoryContextKey, type AiSession } from '../src/ai/session.ts';
import { beginAiChatTask } from '../src/ai/chatActions.ts';
import type { AiMessage } from '../src/ai/types.ts';
import { openAiWorkspace } from './helpers/ai.ts';

const noteId = 'fixture-definition', key = 'mewiki:library:default:ai-session:v1';
const provider = { id: 'memory-fixture', name: '虚构记忆服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'fixture-model', hasApiKey: false };
const stateFixture = () => { const state = createNotebookFixture(); state.activeNoteId = noteId; state.view = 'notes'; state.open = true; return state; };
const done = (message: AiMessage) => JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 6, outputTokens: 2 } } }) + '\n';
const tool = (name: string, args: object) => ({ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) });
async function setup(page: Page, session?: AiSession, english = false) {
  await page.addInitScript(({ state, session, english }) => {
    if (!sessionStorage.getItem('memory-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      if (session) localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
      sessionStorage.setItem('memory-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as typeof window & { copied: string }).copied = text; } } });
  }, { state: stateFixture(), session, english });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); return openAiWorkspace(page, english);
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as AiSession, key);

test('retains full history on refresh and copy, builds scoped memory and edits standing instructions', async ({ page }, info) => {
  const session = createAiSession('default'), contextKey = aiHistoryContextKey(provider, provider.model, [noteId]);
  session.status = 'complete'; session.memoryInstructions = '保持公式不变';
  session.history = Array.from({ length: 64 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, id: `msg-${index}`, content: `历史消息 ${index}`, contextKey, ...(index % 2 ? { status: 'complete' as const } : {}) }));
  session.history.push({ role: 'user', content: '范围外问题 PRIVATE_SCOPE', contextKey: 'a'.repeat(64) }, { role: 'assistant', content: 'PRIVATE_SCOPE_RESPONSE', contextKey: 'a'.repeat(64), status: 'complete' });
  const ai = await setup(page, session), requests: { messages: AiMessage[] }[] = [];
  await expect(ai.locator('.mewiki-ai-message')).toHaveCount(40);
  await ai.getByRole('button', { name: '加载更早的消息', exact: true }).click();
  await expect(ai.locator('.mewiki-ai-message').getByText('历史消息 0', { exact: true })).toBeVisible();
  await expect(ai.locator('.mewiki-ai-message')).toHaveCount(66);
  await ai.getByRole('button', { name: '复制对话', exact: true }).click();
  expect(await page.evaluate(() => (window as typeof window & { copied: string }).copied)).toContain('历史消息 0');
  await ai.getByRole('button', { name: '对话记忆', exact: true }).click();
  const memory = ai.getByRole('dialog', { name: '对话记忆', exact: true });
  await expect(memory).toContainText('已保留 66 条消息');
  await memory.getByLabel('本对话固定要求', { exact: true }).fill('保持公式不变，先核对来源');
  await expect.poll(async () => (await saved(page)).memoryInstructions).toBe('保持公式不变，先核对来源');
  await page.screenshot({ path: info.outputPath('conversation-memory.png') });
  await memory.getByRole('button', { name: '关闭', exact: true }).click();
  await page.route('**/api/mewiki/ai/chat', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: '长期对话已接续。' }) }); });
  await ai.getByLabel('任务要求', { exact: true }).fill('继续分析'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('长期对话已接续。', { exact: true })).toBeVisible();
  expect(JSON.stringify(requests[0])).toContain('历史消息 0'); expect(JSON.stringify(requests[0])).toContain('保持公式不变，先核对来源'); expect(JSON.stringify(requests[0])).not.toContain('PRIVATE_SCOPE');
  expect(requests[0].messages.length).toBeLessThan(15);
  await expect.poll(async () => (await saved(page)).history.length).toBe(68);
  await page.reload(); await expect(ai.getByText('长期对话已接续。', { exact: true })).toBeVisible();
  expect((await saved(page)).history[0].content).toBe('历史消息 0');
});

test('restores rate-limit waiting and retries explicitly without duplicating the user question', async ({ page }, info) => {
  const initial = beginAiChatTask(createAiSession('default'), provider, provider.model, '限流任务', [noteId], stateFixture()).session;
  initial.status = 'error'; initial.error = 'AI 服务请求受限，请等待后重试。'; initial.failure = { kind: 'rate-limit', recovery: 'retry', status: 429, retryAt: Date.now() + 12000 };
  initial.history.at(-1)!.status = 'error';
  const ai = await setup(page, initial); let requests = 0;
  await page.route('**/api/mewiki/ai/chat', route => { requests++; return route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: '显式重试完成。' }) }); });
  const retry = ai.getByRole('button', { name: '重试任务', exact: true });
  await expect(retry).toBeDisabled(); await expect(ai.locator('.mewiki-ai-retry-wait')).toContainText('秒后可重试');
  await page.screenshot({ path: info.outputPath('rate-limit-wait.png') });
  await page.reload(); await expect(retry).toBeDisabled(); expect(requests).toBe(0);
  await expect(retry).toBeEnabled({ timeout: 20000 }); expect(requests).toBe(0);
  await retry.click(); await expect(ai.getByText('显式重试完成。', { exact: true })).toBeVisible();
  expect(requests).toBe(1); expect((await saved(page)).history.filter(message => message.role === 'user')).toHaveLength(1);
});

test('carries rate-limit and configuration metadata through streamed errors', async ({ page }) => {
  const ai = await setup(page); let requests = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    requests++;
    const failure = requests === 1 ? { kind: 'rate-limit', recovery: 'retry', status: 429, retryAt: Date.now() + 1500 } : { kind: 'configuration', recovery: 'settings', status: 401 };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'error', error: requests === 1 ? 'AI 服务请求受限，请等待后重试。' : '请检查虚构服务配置。', failure }) + '\n' });
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('恢复分类'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.locator('.mewiki-ai-retry-wait')).toBeVisible();
  await expect(ai.getByRole('button', { name: '重试任务', exact: true })).toBeEnabled(); await ai.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(ai.getByRole('button', { name: '前往 AI 服务设置', exact: true })).toBeVisible();
  await expect(ai.getByRole('button', { name: '重试任务', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).failure?.kind).toBe('configuration');
  await page.reload(); await expect(ai.getByRole('button', { name: '前往 AI 服务设置', exact: true })).toBeVisible();
  expect(requests).toBe(2);
});

test('shows compact locatable progress and paginated result metadata to the model', async ({ page }, info) => {
  const ai = await setup(page), requests: { messages: AiMessage[] }[] = [];
  await page.route('**/api/mewiki/ai/chat', route => {
    requests.push(route.request().postDataJSON());
    const message = requests.length === 1 ? { role: 'assistant' as const, content: '', toolCalls: [tool('search_notes', { query: '通用内容', limit: 1 })] }
      : requests.length === 2 ? { role: 'assistant' as const, content: '', toolCalls: [tool('read_note', { noteId }), tool('read_block', { noteId, blockId: `${noteId}:text` })] }
      : { role: 'assistant' as const, content: '检索与阅读完成，等待下一步。' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: done(message) });
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('检索并读取当前笔记'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('检索与阅读完成，等待下一步。', { exact: true })).toBeVisible();
  const result = requests[1].messages.find(message => message.role === 'tool')!;
  expect(JSON.parse(result.content)).toMatchObject({ items: [{ id: noteId, matches: [{ blockId: `${noteId}:text` }] }], total: 1, nextOffset: null });
  const progress = ai.locator('.mewiki-ai-tool-progress'); await expect(progress).not.toHaveAttribute('open', ''); await progress.locator('summary').click();
  await expect(progress.getByRole('button').first()).toContainText('关系定义');
  await progress.getByRole('button').last().click();
  await expect(page.locator(`[data-block-id="${noteId}:text"]`).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('locatable-progress.png') });
  await page.reload(); await ai.locator('.mewiki-ai-tool-progress summary').click(); await expect(ai.locator('.mewiki-ai-tool-progress').getByRole('button')).toHaveCount(2);
});

test('offers request revision for output limits and preserves the original branch on resend', async ({ page }) => {
  const ai = await setup(page); let requests = 0;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: ++requests === 1
    ? JSON.stringify({ type: 'error', error: 'AI 输出达到限制，请拆小任务。', failure: { kind: 'request', recovery: 'revise', status: 400 } }) + '\n'
    : done({ role: 'assistant', content: '已完成拆分后的任务。' }) }));
  await ai.getByLabel('任务要求', { exact: true }).fill('原来的大任务'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('button', { name: '修改要求后重新发送', exact: true })).toBeVisible();
  await expect(ai.getByRole('button', { name: '重试任务', exact: true })).toHaveCount(0);
  await ai.getByRole('button', { name: '修改要求后重新发送', exact: true }).click();
  await ai.getByLabel('编辑消息内容', { exact: true }).fill('只完成第一段'); await ai.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(ai.getByText('已完成拆分后的任务。', { exact: true })).toBeVisible();
  expect(requests).toBe(2);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click(); await ai.getByRole('button', { name: '原来的大任务', exact: true }).click();
  await expect(ai.getByRole('button', { name: '修改要求后重新发送', exact: true })).toBeVisible();
});

test('keeps memory controls usable in a short English floating window', async ({ page }, info) => {
  await page.setViewportSize({ width: 720, height: 560 });
  const ai = await setup(page, undefined, true);
  await ai.getByRole('button', { name: 'Conversation memory', exact: true }).click();
  const panel = ai.getByRole('dialog', { name: 'Conversation memory', exact: true });
  await expect(panel).toBeVisible(); await expect(panel.getByRole('textbox')).toBeInViewport();
  await panel.getByRole('textbox').fill('Preserve formulas');
  await panel.getByRole('textbox').press('Escape');
  await expect(panel).toHaveCount(0); await expect(ai.getByRole('button', { name: 'Conversation memory', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('english-memory-short-window.png') });
});

test('retains fixed requirements in an unsent conversation across creating another conversation and reload', async ({ page }) => {
  const ai = await setup(page); let requests = 0;
  await page.route('**/api/mewiki/ai/chat', route => { requests++; return route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: '不应自动请求' }) }); });
  await ai.getByRole('button', { name: '对话记忆', exact: true }).click();
  const memory = ai.getByRole('dialog', { name: '对话记忆', exact: true });
  await memory.getByLabel('本对话固定要求', { exact: true }).fill('未提问前也保留公式要求');
  await expect.poll(async () => (await saved(page))?.memoryInstructions).toBe('未提问前也保留公式要求');
  const originalId = (await saved(page)).conversationId;
  await memory.getByRole('button', { name: '关闭', exact: true }).click();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('dialog', { name: '对话历史', exact: true }).getByRole('button', { name: '新建对话', exact: true }).click();
  await expect.poll(async () => (await saved(page)).conversationId).not.toBe(originalId);
  expect((await saved(page)).memoryInstructions).toBeUndefined();
  await page.reload();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  const history = ai.getByRole('dialog', { name: '对话历史', exact: true });
  await expect(history.locator('ol button')).toHaveCount(2);
  await history.locator('ol button:not([aria-current="true"])').click();
  await ai.getByRole('button', { name: '对话记忆', exact: true }).click();
  await expect(memory.getByLabel('本对话固定要求', { exact: true })).toHaveValue('未提问前也保留公式要求');
  expect((await saved(page)).conversationId).toBe(originalId);
  expect((await saved(page)).history).toEqual([]);
  expect(requests).toBe(0);
});
