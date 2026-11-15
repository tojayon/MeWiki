import { expect, test, type Page } from '@playwright/test';
import { createAiSession } from '../src/ai/session.ts';
import { createNoteProposal } from '../src/ai/proposals.ts';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';

const sessionKey = 'mewiki:library:default:ai-session:v1';
const archiveKey = 'mewiki:library:default:ai-conversations:v1';
async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  const proposals = [1, 2].map(index => createNoteProposal(state, 'default', { operation: 'create', title: `建议笔记 ${index}`, content: `等待批准的内容 ${index}` }));
  const session = { ...createAiSession('default'), status: 'complete' as const, proposals, sourceIds: ['fixture-definition'], history: [
    { role: 'user' as const, content: '请整理第一段对话中的笔记与概念' },
    { role: 'assistant' as const, content: '第一段对话的回复。', activity: { tools: ['propose_note', 'propose_note'], proposalIds: proposals.map(item => item.id) } },
  ] };
  await page.addInitScript(({ state, session, english, sessionKey }) => {
    if (!sessionStorage.getItem('chat-panels-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem(sessionKey, JSON.stringify(session));
      sessionStorage.setItem('chat-panels-seeded', 'true');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, session, english, sessionKey });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'panels', providers: [
    { id: 'panels', name: '面板测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'panels-model', hasApiKey: false },
    { id: 'second', name: '第二个服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'second-model', hasApiKey: false },
  ] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: english ? 'AI workspace' : 'AI 工作区', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace');
  await expect(ai).toBeVisible();
  return ai;
}
const done = (content: string) => JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content }, usage: { inputTokens: 10, outputTokens: 2 } } }) + '\n';

test('uses compact collapsed preview cards with green applied and red undone rows', async ({ page }, info) => {
  const ai = await setup(page);
  const card = ai.locator('.mewiki-ai-proposal-card');
  await expect(card).not.toHaveAttribute('open');
  await expect(card.locator('summary')).toContainText('2 项修改');
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(40);
  await card.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('open', '');
  const first = card.locator('.mewiki-ai-proposal').first();
  expect((await first.boundingBox())!.height).toBeLessThanOrEqual(42);
  await expect(first).not.toContainText('等待批准的内容');
  await first.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(page.getByTestId('mewiki-ai-review').getByText('等待批准的内容 1', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(first).toHaveAttribute('data-status', 'applied');
  await expect(first).toHaveCSS('color', 'rgb(35, 115, 72)');
  await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(first.getByText('已应用', { exact: true })).toBeVisible();
  await first.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect(first).toHaveAttribute('data-status', 'undone');
  await expect(first).toHaveCSS('color', 'rgb(161, 40, 55)');
  await expect(first).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(first.getByText('已撤回', { exact: true })).toBeVisible();
  const second = card.locator('.mewiki-ai-proposal').last();
  await second.getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(second).toHaveAttribute('data-status', 'rejected');
  await expect(second).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(second).toHaveCSS('color', 'rgb(113, 128, 148)');
  await second.getByRole('button', { name: '恢复此建议', exact: true }).click();
  await second.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(second).toHaveCSS('color', 'rgb(35, 115, 72)');
  await expect(second).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: info.outputPath('ai-compact-cards.png') });
  await card.locator('summary').press('Space');
  await expect(card).not.toHaveAttribute('open');
  await page.reload();
  await expect(card).not.toHaveAttribute('open');
  await card.locator('summary').click();
  await expect(card.locator('[data-status=applied]')).toHaveCount(1);
  await expect(card.locator('[data-status=undone]')).toHaveCount(1);
});

test('archives conversations with their drafts and reviews, restores the active choice and clears only one', async ({ page }) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('第一段草稿\n继续编辑');
  const history = ai.getByRole('button', { name: '对话历史', exact: true });
  expect((await history.boundingBox())!.x).toBeLessThan((await ai.locator('.mewiki-ai-session-title').boundingBox())!.x);
  await history.click();
  let panel = ai.getByRole('dialog', { name: '对话历史', exact: true });
  await expect(panel.getByRole('button', { name: /请整理第一段/ })).toHaveAttribute('aria-current', 'true');
  await panel.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(ai).not.toContainText('第一段对话的回复。');
  await expect(ai.locator('.mewiki-ai-proposal-card')).toHaveCount(0);
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: done('第二段回复。') }));
  await input.fill('第二段对话'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('第二段回复。', { exact: true })).toBeVisible();
  await input.fill('第二段草稿');
  await history.click(); await panel.getByRole('button', { name: /请整理第一段/ }).click();
  await expect(input).toHaveValue('第一段草稿\n继续编辑');
  await expect(ai.getByText('第一段对话的回复。', { exact: true })).toBeVisible();
  await expect(ai.locator('.mewiki-ai-proposal')).toHaveCount(2);
  await expect(page.getByTestId('mewiki-ai-review')).toHaveCount(0);
  await page.reload();
  await expect(ai).toBeVisible(); await expect(input).toHaveValue('第一段草稿\n继续编辑');
  await ai.getByRole('button', { name: '清空会话', exact: true }).click();
  await ai.getByRole('button', { name: '确认清空', exact: true }).click();
  await history.click(); panel = ai.getByRole('dialog', { name: '对话历史', exact: true });
  await expect(panel.getByRole('button', { name: /请整理第一段/ })).toHaveCount(0);
  await panel.getByRole('button', { name: /第二段对话/ }).click();
  await expect(input).toHaveValue('第二段草稿');
  await expect(ai.getByText('第二段回复。', { exact: true })).toBeVisible();
});

test('retains the current conversation and unsaved draft when archive persistence fails', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('不能丢失的草稿');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, name, value); };
  }, archiveKey);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('AI 会话未能保存');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('不能丢失的草稿');
  await expect(ai.getByText('第一段对话的回复。', { exact: true })).toBeVisible();
});

test('keeps both conversations after a failed active-slot write and keeps other libraries private', async ({ page }) => {
  const ai = await setup(page);
  const history = ai.getByRole('button', { name: '对话历史', exact: true });
  const input = ai.getByLabel('任务要求', { exact: true });
  await history.click(); await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  await input.fill('独立的第二段草稿');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).draft, sessionKey)).toBe('独立的第二段草稿');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as typeof window & { restoreChatStorage: () => void }).restoreChatStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, name, value); };
    const foreign = { ...JSON.parse(localStorage.getItem(key)!), libraryId: 'another-library', conversationId: 'foreign', conversationTitle: '其他库不得显示', history: [{ role: 'user', content: '其他库不得显示' }] };
    localStorage.setItem('mewiki:library:another-library:ai-conversations:v1', JSON.stringify({ version: 1, libraryId: 'another-library', sessions: [foreign] }));
  }, sessionKey);
  await history.click();
  const panel = ai.getByRole('dialog', { name: '对话历史', exact: true });
  await expect(panel.locator('ol > li')).toHaveCount(2);
  await expect(panel).not.toContainText('其他库不得显示');
  await panel.getByRole('button', { name: /请整理第一段/ }).click();
  await expect(ai.getByRole('alert')).toContainText('AI 会话未能保存');
  await expect(input).toHaveValue('独立的第二段草稿');
  await page.evaluate(() => (window as typeof window & { restoreChatStorage: () => void }).restoreChatStorage());
  await panel.getByRole('button', { name: /请整理第一段/ }).click();
  await expect(ai.getByText('第一段对话的回复。', { exact: true })).toBeVisible();
  await history.click(); await panel.getByRole('button', { name: /^新对话/ }).click();
  await expect(input).toHaveValue('独立的第二段草稿');
});

test('keeps long history lists inside the available short-window space', async ({ page }, info) => {
  const ai = await setup(page);
  await page.evaluate(({ sessionKey, archiveKey }) => {
    const first = JSON.parse(localStorage.getItem(sessionKey)!);
    const sessions = Array.from({ length: 18 }, (_, index) => ({ ...first, conversationId: `history-${index}`, conversationTitle: `历史对话 ${index}：${'较长的用户标题'.repeat(10)}`, updatedAt: new Date(2026, 10, 1 + index).toISOString() }));
    localStorage.setItem(archiveKey, JSON.stringify({ version: 1, libraryId: 'default', sessions }));
  }, { sessionKey, archiveKey });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }, { width: 1024, height: 420 }]) {
    await page.setViewportSize(viewport);
    const trigger = ai.getByRole('button', { name: '对话历史', exact: true });
    await trigger.click();
    const panel = ai.getByRole('dialog', { name: '对话历史', exact: true });
    await expect(panel.locator('li')).toHaveCount(19);
    const list = panel.locator('ol');
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual((await ai.boundingBox())!.y);
    await list.locator('li').last().getByRole('button').focus();
    await expect(list.locator('li').last().getByRole('button')).toBeInViewport();
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ai-long-history-${viewport.width}.png`) });
    await list.press('Escape'); await expect(trigger).toBeFocused();
  }
});

test('interrupts an archived running task and ignores its late reply after switching', async ({ page }) => {
  const ai = await setup(page);
  let release!: () => void, started = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    started = true; await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: done('不应进入新对话的迟到回复') }).catch(() => {});
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('运行中的任务');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  release();
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('mewiki-ai-review')).toHaveCount(0);
  await expect(ai).not.toContainText('迟到回复');
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('dialog', { name: '对话历史', exact: true }).getByRole('button', { name: /请整理第一段/ }).click();
  await expect(ai.getByText('上次任务已中断，已生成的结果仍可查看。', { exact: true })).toBeVisible();
  await expect(ai).not.toContainText('迟到回复');
});

test('keeps history, usage and compact model popovers exclusive, accessible and beside their buttons in English', async ({ page }, info) => {
  const ai = await setup(page, true);
  const trigger = ai.getByRole('button', { name: 'Conversation history', exact: true });
  const panel = ai.getByRole('dialog', { name: 'Conversation history', exact: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }, { width: 1024, height: 420 }]) {
    await page.setViewportSize(viewport);
    await ai.getByLabel('Task instructions', { exact: true }).fill('Draft line\n'.repeat(12));
    await trigger.click(); await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual((await ai.boundingBox())!.y);
    const historyBox = (await panel.boundingBox())!, triggerBox = (await trigger.boundingBox())!;
    expect(historyBox.y + historyBox.height).toBeLessThanOrEqual((await ai.boundingBox())!.y + (await ai.boundingBox())!.height);
    expect(Math.min(Math.abs(triggerBox.y - historyBox.y - historyBox.height - 6), Math.abs(historyBox.y - triggerBox.y - triggerBox.height - 6))).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath(`ai-history-${viewport.width}.png`) });
    await panel.getByRole('button', { name: 'New conversation', exact: true }).press('Escape');
    await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.click(); await ai.getByRole('button', { name: 'Token usage history', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await ai.getByRole('button', { name: 'Model settings', exact: true }).press('Enter');
    await expect(ai.getByRole('dialog', { name: 'Token usage history', exact: true })).toHaveCount(0);
    await expect(ai.getByLabel('Model for this task', { exact: true })).toBeVisible();
    await ai.getByRole('combobox', { name: 'AI services', exact: true }).selectOption('second');
    await expect(ai.getByLabel('Model for this task', { exact: true })).toHaveValue('second-model');
    await expect(ai.locator('.mewiki-ai-model-options > p')).toHaveCount(0);
    expect((await ai.locator('.mewiki-ai-model-options').boundingBox())!.y).toBeGreaterThanOrEqual((await ai.boundingBox())!.y);
    expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ai-model-${viewport.width}.png`) });
    await ai.getByLabel('Model for this task', { exact: true }).press('Escape');
    await expect(ai.getByRole('button', { name: 'Model settings', exact: true })).toBeFocused();
    await trigger.click(); await ai.getByRole('region', { name: 'Conversation', exact: true }).click({ position: { x: 10, y: 10 } });
    await expect(panel).toHaveCount(0);
    await expect(ai.getByLabel('Task instructions', { exact: true })).toBeInViewport();
  }
});
