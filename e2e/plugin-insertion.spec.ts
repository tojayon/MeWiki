import { closeSettingsPage } from "./helpers/settings.ts";
import { expect, test, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { enableNotebookEditing, runNotebookAction } from './helpers/researchNotebook.ts';

const settings = path.resolve('.mewiki/media-e2e-settings.json');
const item = { id: 'catalog-record', file: 'examples/fixture.replay.sqlite', manifest: {
  format: 'cislunar-replay-sqlite/v2', sealed: true, run: { id: 'test-run', title: '可选择的实验' },
  recordDigest: 'a'.repeat(64), timeBase: { unit: 's', origin: 'scenario', start: 0, end: 0.8 }, loopIds: ['rc_slow'],
} };
test.beforeEach(async () => { await rm(settings, { force: true }); });

async function openNote(page: Page) {
  await page.goto('/');
  const panel = page.getByTestId('research-notebook');
  await expect(panel).toBeVisible();
  await runNotebookAction(panel, '插件管理');
  const manager = page.getByTestId('mewiki-plugin-manager');
  await manager.locator('.mewiki-plugin-row').filter({ hasText: 'org.mewiki.webbench' }).getByRole('button', { name: '安装并启用', exact: true }).click();
  await closeSettingsPage(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'insertion-note', title: '独立回放插入', library: 'research', createdAt: '2026-11-09', updatedAt: '2026-11-09', blocks: [{ id: 'paragraph-1', type: 'paragraph', text: '保留的正文' }] }];
    state.activeNoteId = 'insertion-note'; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  await enableNotebookEditing(panel);
  return panel;
}
async function chooseReplay(page: Page) {
  await page.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '插入笔记内容', exact: true });
  const button = menu.getByRole('button', { name: '插入回放位置', exact: true });
  await expect(button).toBeVisible({ timeout: 5000 });
  await button.click();
  return page.getByRole('dialog', { name: '插入回放位置', exact: true });
}

test('enabled plugin offers standalone insertion, validates time, saves and opens the selected identity', async ({ page, context }) => {
  await page.route('**/api/replays', route => route.fulfill({ json: { items: [item] } }));
  const panel = await openNote(page);
  const picker = await chooseReplay(page);
  await expect(picker).toHaveCSS('border-top-width', '1px');
  await expect(picker).toHaveCSS('border-top-color', await picker.evaluate(element => getComputedStyle(element).borderBottomColor));
  await picker.getByLabel('实验回放', { exact: true }).selectOption(item.id);
  await picker.getByLabel('物理时间（秒）', { exact: true }).fill('1');
  await expect(picker.getByRole('alert')).toContainText('时间');
  await expect(picker.getByRole('button', { name: '插入回放位置', exact: true })).toBeDisabled();
  await picker.getByLabel('物理时间（秒）', { exact: true }).fill('0.125');
  await picker.getByRole('combobox', { name: '环路', exact: true }).selectOption({ label: 'rc_slow' });
  await picker.getByRole('button', { name: '插入回放位置', exact: true }).click();
  await expect(picker).not.toBeVisible();
  const card = panel.locator('.mewiki-external-card');
  await expect(card).toContainText('可选择的实验');
  await expect(card).toContainText('0.125');
  await page.reload();
  await expect(card).toContainText('可选择的实验');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((n: { id: string }) => n.id === 'insertion-note').blocks);
  expect(saved).toHaveLength(2);
  expect(saved[0].text).toBe('保留的正文');
  expect(saved[1].data).toMatchObject({ replayId: item.id, runId: 'test-run', recordDigest: item.manifest.recordDigest, time: 0.125, loopId: 'rc_slow' });
  await context.route(url => url.origin === saved[1].data.webbenchOrigin, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>虚构回放来源</title>' }));
  const opened = page.waitForEvent('popup');
  await card.getByRole('button', { name: '打开来源', exact: true }).click();
  const popup = await opened;
  await expect.poll(() => popup.url()).toContain('mewikiReplay=');
  expect(new URL(popup.url()).origin).toBe(saved[1].data.webbenchOrigin);
  expect(JSON.parse(new URL(popup.url()).searchParams.get('mewikiReplay')!)).toMatchObject(saved[1].data);
  await popup.close();
});

test('offline, empty and cancelled selection do not create blocks; disabling removes only the insertion entry', async ({ page }) => {
  let response: 'offline' | 'empty' | 'ready' = 'offline';
  await page.route('**/api/replays', route => response === 'offline' ? route.abort() : route.fulfill({ json: { items: response === 'empty' ? [] : [item] } }));
  const panel = await openNote(page);
  let picker = await chooseReplay(page);
  await expect(picker.getByRole('alert')).toBeVisible();
  await expect(picker.getByRole('button', { name: '插入回放位置', exact: true })).toBeDisabled();
  response = 'empty';
  await picker.getByRole('button', { name: '刷新实验列表', exact: true }).click();
  await expect(picker).toContainText('还没有可用的实验回放');
  response = 'ready';
  await picker.getByRole('button', { name: '刷新实验列表', exact: true }).click();
  await picker.getByLabel('实验回放', { exact: true }).selectOption(item.id);
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel.locator('.mewiki-external-card')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: '收起文章大纲', exact: true }).click();
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  picker = await chooseReplay(page);
  await expect(picker).toBeVisible();
  await picker.getByLabel('实验回放', { exact: true }).selectOption(item.id);
  await picker.getByLabel('物理时间（秒）', { exact: true }).fill('0.125');
  expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/standalone-replay-picker-mobile.png' });
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await panel.getByRole('button', { name: '内容块操作', exact: true }).first().click();
  await page.getByRole('button', { name: '更改类型', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '更改内容类型', exact: true }).locator('[data-insert-type="external"]')).toHaveCount(0);
  await page.getByLabel('搜索内容类型', { exact: true }).press('Escape');
  await runNotebookAction(panel, '插件管理');
  const manager = page.getByTestId('mewiki-plugin-manager');
  await manager.locator('.mewiki-plugin-row').filter({ hasText: 'org.mewiki.webbench' }).getByRole('button', { name: '停用', exact: true }).click();
  await closeSettingsPage(page);
  await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await expect(page.getByRole('button', { name: '插入回放位置', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((n: { id: string }) => n.id === 'insertion-note').blocks.length)).toBe(1);
});

test('disabling the plugin in another window cancels selection and ignores a late catalog response', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/replays', async route => {
    requests++;
    if (requests === 1) await held;
    await route.fulfill({ json: { items: [item] } }).catch(() => {});
  });
  const panel = await openNote(page);
  const picker = await chooseReplay(page);
  await expect.poll(() => requests).toBe(1);
  const other = await page.context().newPage();
  await other.goto('/');
  await other.evaluate(() => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.webbench': 'disabled' })));
  await expect(picker).not.toBeVisible();
  release();
  await expect(panel.locator('.mewiki-external-card')).toHaveCount(0);
  await other.evaluate(() => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.webbench': 'enabled' })));
  await other.close();
  const fresh = await chooseReplay(page);
  await fresh.getByLabel('实验回放', { exact: true }).selectOption(item.id);
  await fresh.getByRole('button', { name: '插入回放位置', exact: true }).click();
  await expect(panel.locator('.mewiki-external-card')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((n: { id: string }) => n.id === 'insertion-note').blocks.length)).toBe(2);
});
