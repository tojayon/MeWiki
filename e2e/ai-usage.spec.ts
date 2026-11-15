import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { openAiWorkspace as openAi } from './helpers/ai.ts';

async function setup(page: Page, locale = 'zh-CN') {
  const state = createNotebookFixture();
  state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  await page.addInitScript(({ state, locale }) => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', locale);
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, locale });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'usage-provider', providers: [
    { id: 'usage-provider', name: '用量测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'usage-model', hasApiKey: false },
  ] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
}

test('opens usage from one footer icon and dismisses it with Escape and outside clicks', async ({ page }) => {
  await setup(page);
  const ai = await openAi(page);
  const button = ai.locator('.mewiki-ai-session-bar').getByRole('button', { name: 'Token 使用记录', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveText('');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const panel = ai.getByRole('dialog', { name: 'Token 使用记录', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('暂无使用记录', { exact: true })).toBeVisible();
  await button.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(ai).toBeVisible();
  await ai.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(ai.getByLabel('本次模型', { exact: true })).toBeVisible();
  await button.click();
  await expect(ai.getByLabel('本次模型', { exact: true })).toBeHidden();
  await ai.getByRole('heading', { name: '开始一段笔记对话', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(ai).toBeVisible();
});

test('retains older replies within at most five usage rows and restores and clears them with the session', async ({ page }, info) => {
  await setup(page);
  let calls = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    calls++;
    const first = calls === 1;
    const index = first ? 1 : calls - 1;
    const message = first ? { role: 'assistant', content: '', toolCalls: [{ id: 'usage-capabilities', name: 'get_capabilities', arguments: '{}' }] }
      : { role: 'assistant', content: `用量回复 ${index}` };
    const usage = first ? { inputTokens: 10, outputTokens: 5 } : { inputTokens: index * 100, outputTokens: index * 10 };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage } }) + '\n' });
  });
  let ai = await openAi(page);
  for (let index = 1; index <= 7; index++) {
    await ai.getByLabel('任务要求', { exact: true }).fill(`提问 ${index}`);
    await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(ai.locator('.mewiki-ai-messages').getByText(`用量回复 ${index}`, { exact: true })).toBeVisible();
  }
  await expect(ai.locator('.mewiki-ai-history .mewiki-ai-usage')).toHaveCount(0);
  const button = ai.locator('.mewiki-ai-session-bar').getByRole('button', { name: 'Token 使用记录', exact: true });
  await button.click();
  const panel = ai.getByRole('dialog', { name: 'Token 使用记录', exact: true });
  const list = panel.getByRole('list');
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText('提问 7');
  await expect(rows.first().locator('.mewiki-ai-usage-input')).toHaveText('700');
  await expect(rows.first().locator('.mewiki-ai-usage-output')).toHaveText('70');
  await expect(rows.last().locator('.mewiki-ai-usage-input')).toHaveText('110');
  await expect(rows.last().locator('.mewiki-ai-usage-output')).toHaveText('15');
  const row = (await rows.first().boundingBox())!;
  const listHeight = await list.evaluate(element => element.clientHeight);
  expect(listHeight).toBeLessThanOrEqual(row.height * 5 + 1);
  expect(listHeight).toBeGreaterThanOrEqual(row.height * 4);
  const panelBox = (await panel.boundingBox())!, workspaceBox = (await ai.boundingBox())!;
  expect(panelBox.y).toBeGreaterThanOrEqual(workspaceBox.y);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(workspaceBox.y + workspaceBox.height);
  expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-usage-desktop.png') });
  await list.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(rows.last()).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 620 });
  await expect(panel).toBeInViewport();
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(button).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-usage-mobile.png') });
  await button.press('Escape');
  await page.getByTestId('mewiki-ai-launcher').click();
  ai = await openAi(page);
  await ai.getByRole('button', { name: 'Token 使用记录', exact: true }).click();
  await expect(ai.getByRole('dialog', { name: 'Token 使用记录', exact: true }).getByRole('listitem')).toHaveCount(7);
  await ai.getByRole('button', { name: '清空会话', exact: true }).click();
  await ai.getByRole('button', { name: '确认清空', exact: true }).click();
  await ai.getByRole('button', { name: 'Token 使用记录', exact: true }).click();
  await expect(ai.getByRole('dialog', { name: 'Token 使用记录', exact: true }).getByText('暂无使用记录', { exact: true })).toBeVisible();
});

test('keeps the reported partial usage once after a task is stopped', async ({ page }) => {
  await setup(page);
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    calls++;
    if (calls === 1) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: {
      message: { role: 'assistant', content: '', toolCalls: [{ id: 'partial-capabilities', name: 'get_capabilities', arguments: '{}' }] }, usage: { inputTokens: 12, outputTokens: 6 },
    } }) + '\n' });
    await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '迟到回复' }, usage: { inputTokens: 99, outputTokens: 99 } } }) + '\n' }).catch(() => {});
  });
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('统计中断任务');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await ai.getByRole('button', { name: 'Token 使用记录', exact: true }).click();
  const row = ai.getByRole('dialog', { name: 'Token 使用记录', exact: true }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.mewiki-ai-usage-input')).toHaveText('12');
  await ai.getByRole('button', { name: 'Token 使用记录', exact: true }).press('Escape');
  await ai.getByRole('button', { name: '停止任务', exact: true }).click();
  release();
  await page.getByTestId('mewiki-ai-launcher').click();
  ai = await openAi(page);
  await ai.getByRole('button', { name: 'Token 使用记录', exact: true }).click();
  const restored = ai.getByRole('dialog', { name: 'Token 使用记录', exact: true }).getByRole('listitem');
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('.mewiki-ai-usage-input')).toHaveText('12');
  await expect(restored.locator('.mewiki-ai-usage-output')).toHaveText('6');
});

test('uses an English usage popover on a narrow screen', async ({ page }) => {
  await setup(page, 'en');
  await page.setViewportSize({ width: 390, height: 620 });
  const ai = await openAi(page, true);
  const button = ai.locator('.mewiki-ai-session-bar').getByRole('button', { name: 'Token usage history', exact: true });
  await expect(button).toBeInViewport();
  await button.click();
  const panel = ai.getByRole('dialog', { name: 'Token usage history', exact: true });
  await expect(panel.getByText('No usage yet', { exact: true })).toBeVisible();
  await expect(panel).toBeInViewport();
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
