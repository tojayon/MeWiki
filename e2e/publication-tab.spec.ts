import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { enableNotebookEditing, runNotebookAction } from './helpers/researchNotebook.ts';
import sharp from 'sharp';

test.beforeEach(async ({ page }) => {
  const state = createNotebookFixture();
  state.notes = [
    { ...createResearchNote('标签页导出示例'), id: 'export-tab-note', library: 'research', blocks: [{ id: 'export-paragraph', type: 'paragraph', text: '用于导出与原笔记比对的正文。' }] },
    { ...createResearchNote('另一篇比对笔记'), id: 'export-other-note', library: 'research' },
  ];
  state.activeNoteId = 'export-tab-note'; state.open = true; state.view = 'notes';
  await page.addInitScript(state => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    if (!localStorage.getItem('mewiki:plugins:v1')) localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'false');
  }, state);
});

async function openExportTab(page: Page) {
  const opened = page.waitForEvent('popup');
  await runNotebookAction(page.getByTestId('research-notebook'), '社交图文导出');
  const exported = await opened;
  await expect(exported.getByTestId('mewiki-publication-page')).toBeVisible();
  return exported;
}

test('opens a full export tab and keeps the notebook available for comparison', async ({ page }) => {
  await page.goto('/');
  const originalUrl = page.url();
  const exported = await openExportTab(page);
  expect(new URL(exported.url()).searchParams.get('library')).toBe('default');
  expect(new URL(exported.url()).searchParams.get('publication')).toBeTruthy();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByTestId('mewiki-publication-dialog')).toHaveCount(0);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('标签页导出示例');
  await expect(exported.getByTestId('research-notebook')).toHaveCount(0);
  await expect(exported.getByLabel('导出标题', { exact: true })).toHaveValue('标签页导出示例');
  expect(await exported.evaluate(() => window.opener === null)).toBe(true);
  await exported.getByLabel('作者署名', { exact: true }).fill('对比作者');
  await page.bringToFront();
  await enableNotebookEditing(page.getByTestId('research-notebook'));
  await page.getByLabel('笔记标题', { exact: true }).fill('原标签页仍可编辑');
  await page.getByLabel('笔记标题', { exact: true }).press('Tab');
  await page.locator('button[data-note-id="export-other-note"]').click();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('另一篇比对笔记');
  await exported.bringToFront();
  await expect(exported.getByLabel('导出标题', { exact: true })).toHaveValue('标签页导出示例');
  await expect(exported.getByLabel('作者署名', { exact: true })).toHaveValue('对比作者');
  await exported.reload();
  await expect(exported.getByLabel('导出标题', { exact: true })).toHaveValue('标签页导出示例');
  await expect(exported.getByLabel('作者署名', { exact: true })).toHaveValue('对比作者');
  await exported.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  await exported.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(exported.getByAltText('导出预览第 1 页')).toBeVisible({ timeout: 90000 });
  await exported.screenshot({ path: test.info().outputPath('export-new-tab.png') });
  const closed = exported.waitForEvent('close');
  await exported.getByRole('button', { name: '关闭社交图文导出', exact: true }).click();
  await closed;
  await page.locator('button[data-note-id="export-tab-note"]').click();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('原标签页仍可编辑');
});

test('explains a blocked new tab and leaves the notebook usable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await page.evaluate(() => { window.open = () => null; });
  await runNotebookAction(page.getByTestId('research-notebook'), '社交图文导出');
  await expect(page.getByRole('alert')).toContainText('请允许浏览器打开新标签页');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('标签页导出示例');
});

test('rejects a copied link and a changed library without opening another notebook', async ({ page, context }) => {
  await page.goto('/');
  const exported = await openExportTab(page);
  const copied = await context.newPage();
  await copied.goto(exported.url());
  await expect(copied.getByRole('alert')).toContainText('导出内容已失效');
  await expect(copied.getByTestId('research-notebook')).toHaveCount(0);
  const changed = new URL(exported.url()); changed.searchParams.set('library', 'unrelated-library');
  await exported.goto(changed.href);
  await expect(exported.getByRole('alert')).toContainText('导出内容已失效');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('标签页导出示例');
});

test('releases a running export when its browser tab closes', async ({ page, request }) => {
  await page.goto('/');
  const exported = await openExportTab(page);
  await exported.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  const created = exported.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/mewiki/publications/jobs'));
  await exported.getByRole('button', { name: '生成预览', exact: true }).click();
  const { id } = await (await created).json();
  const route = '/api/mewiki/publications/jobs/' + id;
  const headers = { 'X-MeWiki-Request': 'publications' };
  const running = await request.get(route, { headers });
  expect(running.status()).toBe(200);
  expect((await running.json()).status).toBe('running');
  await exported.close();
  await expect.poll(async () => (await request.get(route, { headers })).status()).toBe(404);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('标签页导出示例');
});

test('keeps the export and saved template in their original library after the source switches libraries', async ({ page }) => {
  const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/media-e2e-settings.json');
  expect(settings.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  const directory = await mkdtemp(path.join(tmpdir(), 'mewiki-publication-tab-'));
  try {
    await page.goto('/');
    const exported = await openExportTab(page);
    await exported.getByLabel('作者署名', { exact: true }).fill('原资料库作者');
    await page.bringToFront();
    await runNotebookAction(page.getByTestId('research-notebook'), '切换资料库');
    const manager = page.getByTestId('mewiki-library-manager');
    await manager.getByRole('button', { name: '新建资料库', exact: true }).click();
    await manager.getByLabel('资料库名称', { exact: true }).fill('导出比对测试库');
    await manager.getByLabel('资料库文件夹', { exact: true }).fill(directory);
    await manager.getByRole('button', { name: '创建并打开', exact: true }).click();
    await expect(manager).not.toBeVisible();
    await expect(page.getByRole('button', { name: '当前资料库：导出比对测试库，切换资料库', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('library')).not.toBe('default');
    await exported.bringToFront();
    await expect(exported.getByLabel('导出标题', { exact: true })).toHaveValue('标签页导出示例');
    await expect(exported.getByLabel('作者署名', { exact: true })).toHaveValue('原资料库作者');
    expect(new URL(exported.url()).searchParams.get('library')).toBe('default');
    await exported.getByRole('button', { name: '模板操作', exact: true }).click();
    await exported.getByRole('toolbar', { name: '模板操作', exact: true }).getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
    const form = exported.getByRole('dialog', { name: '保存模板', exact: true });
    await form.getByLabel('模板名称', { exact: true }).fill('固定原资料库');
    const saved = exported.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/api/mewiki/export-profiles'));
    await form.getByRole('button', { name: '保存模板', exact: true }).click();
    expect((await saved).postDataJSON().libraryId).toBe('default');
    await expect(exported.getByRole('status')).toContainText('个人模板已保存');
  } finally {
    await page.context().close();
    await rm(settings, { force: true });
    if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('mewiki-publication-tab-')) await rm(directory, { recursive: true, force: true });
  }
});

async function draftSaved(output: Page) {
  await expect(output.locator('[data-draft-state]')).toHaveAttribute('data-draft-state', 'saved');
}

test('recovers settings and content choices after refresh and closing, without changing template reset behavior', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks.push({ id: 'export-second', type: 'paragraph', text: '第二段虚构正文。' });
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  let output = await openExportTab(page);
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  await output.getByLabel('导出标题', { exact: true }).fill('我的导出标题');
  await output.getByLabel('作者署名', { exact: true }).fill('继续编辑的作者');
  await output.getByRole('combobox', { name: '画面比例', exact: true }).selectOption('1:1');
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720');
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await output.getByLabel('导出此内容：1', { exact: true }).uncheck();
  await output.getByLabel('在此内容前分页：2', { exact: true }).check();
  await output.getByLabel('展开全部标签页（默认仅当前页签）', { exact: true }).check();
  await draftSaved(output);
  await output.reload();
  await expect(output.getByLabel('作者署名', { exact: true })).toHaveValue('继续编辑的作者');
  await expect(output.getByLabel('导出标题', { exact: true })).toHaveValue('我的导出标题');
  await expect(output.getByRole('combobox', { name: '画面比例', exact: true })).toHaveValue('1:1');
  await expect(output.getByRole('combobox', { name: '清晰度', exact: true })).toHaveValue('720');
  await expect(output.getByLabel('导出此内容：1', { exact: true })).not.toBeChecked();
  await expect(output.getByLabel('在此内容前分页：2', { exact: true })).toBeChecked();
  await expect(output.getByLabel('展开全部标签页（默认仅当前页签）', { exact: true })).toBeChecked();
  // Closing via the workspace flushes the final keystroke instead of dropping the debounce.
  await output.getByLabel('作者署名', { exact: true }).fill('关闭前最后一次修改');
  await output.getByRole('button', { name: '关闭社交图文导出', exact: true }).click();
  await expect.poll(() => output.isClosed()).toBe(true);
  output = await openExportTab(page);
  await expect(output.getByLabel('作者署名', { exact: true })).toHaveValue('关闭前最后一次修改');
  await expect(output.getByLabel('导出此内容：1', { exact: true })).not.toBeChecked();
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:mewiki');
  await expect(output.getByLabel('作者署名', { exact: true })).toHaveValue('');
  await expect(output.getByLabel('导出标题', { exact: true })).toHaveValue('我的导出标题');
});

test('keeps drafts separate across simultaneous tabs and notes', async ({ page }) => {
  await page.goto('/');
  const first = await openExportTab(page);
  await first.getByLabel('作者署名', { exact: true }).fill('第一标签页'); await draftSaved(first);
  const second = await openExportTab(page);
  await expect(second.getByLabel('作者署名', { exact: true })).toHaveValue('第一标签页');
  await draftSaved(second);
  await first.getByLabel('作者署名', { exact: true }).fill('第一标签页的新修改'); await draftSaved(first);
  await second.reload(); await expect(second.getByLabel('作者署名', { exact: true })).toHaveValue('第一标签页');
  await second.getByLabel('作者署名', { exact: true }).fill('第二标签页'); await draftSaved(second);
  await first.reload(); await expect(first.getByLabel('作者署名', { exact: true })).toHaveValue('第一标签页的新修改');
  await second.reload(); await expect(second.getByLabel('作者署名', { exact: true })).toHaveValue('第二标签页');
  const newest = await openExportTab(page);
  await expect(newest.getByLabel('作者署名', { exact: true })).toHaveValue('第二标签页');
  await page.locator('button[data-note-id="export-other-note"]').click();
  const other = await openExportTab(page);
  await expect(other.getByLabel('作者署名', { exact: true })).toHaveValue('');
});

test('retains local image originals, shared layers and per-image edits without requiring a named design', async ({ page }) => {
  await page.goto('/');
  let output = await openExportTab(page);
  await output.getByLabel('工作模式', { exact: true }).selectOption('images');
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720');
  await output.getByRole('combobox', { name: '图片适配', exact: true }).selectOption('cover');
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  const buffer = await sharp({ create: { width: 800, height: 450, channels: 3, background: '#ea8212' } }).png().toBuffer();
  await output.getByLabel('添加本地图片', { exact: true }).setInputFiles(['草稿主图一.png', '草稿主图二.png'].map(name => ({ name, mimeType: 'image/png', buffer })));
  await output.getByRole('tab', { name: '画布编辑', exact: true }).click();
  await output.getByRole('button', { name: '添加文字', exact: true }).click();
  await output.getByLabel('图层文字', { exact: true }).fill('草稿 {{title}}');
  await output.getByLabel('编辑范围', { exact: true }).selectOption('current');
  await output.getByLabel('图层水平位置（%）', { exact: true }).fill('7');
  await output.getByText('当前图片文案', { exact: true }).click();
  await output.getByLabel('本图标题', { exact: true }).fill('自定义主图标题');
  await draftSaved(output);
  await output.reload();
  await expect(output.getByLabel('工作模式', { exact: true })).toHaveValue('images');
  await expect(output.getByLabel('图层文字', { exact: true })).toHaveValue('草稿 {{title}}');
  await expect(output.getByLabel('图层水平位置（%）', { exact: true })).toHaveValue('7');
  await output.getByText('当前图片文案', { exact: true }).click();
  await expect(output.getByLabel('本图标题', { exact: true })).toHaveValue('自定义主图标题');
  await output.getByRole('button', { name: '下一张图片', exact: true }).click();
  await expect(output.getByLabel('图层水平位置（%）', { exact: true })).toHaveValue('10');
  await draftSaved(output);
  await output.close();
  output = await openExportTab(page);
  await expect(output.getByLabel('工作模式', { exact: true })).toHaveValue('images');
  await expect(output.getByLabel('图层文字', { exact: true })).toHaveValue('草稿 {{title}}');
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.locator('.mewiki-publication-preview figure')).toHaveCount(2, { timeout: 90000 });
  await output.screenshot({ path: test.info().outputPath('recovered-image-draft.png') });
});

test('warns before leaving unsaved settings when browser draft storage fails and allows retry', async ({ page, context }) => {
  await context.addInitScript(() => {
    const testWindow = window as unknown as { draftStorageBlocked: boolean };
    testWindow.draftStorageBlocked = false;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, version) {
      if (name === 'mewiki:publication-drafts' && testWindow.draftStorageBlocked) throw new DOMException('Storage blocked for regression', 'SecurityError');
      return version === undefined ? open.call(this, name) : open.call(this, name, version);
    };
  });
  await page.goto('/');
  const output = await openExportTab(page);
  await draftSaved(output);
  await output.evaluate(() => { (window as unknown as { draftStorageBlocked: boolean }).draftStorageBlocked = true; });
  await output.getByLabel('作者署名', { exact: true }).fill('保存失败时也不能丢');
  await expect(output.locator('[data-draft-state]')).toHaveAttribute('data-draft-state', 'error');
  await expect(output.getByRole('alert').filter({ hasText: '导出草稿存储不可用' })).toBeVisible();
  const leaving = output.waitForEvent('dialog');
  const reload = output.reload({ timeout: 1500 }).catch(() => {});
  const confirmation = await leaving; expect(confirmation.type()).toBe('beforeunload'); await confirmation.dismiss(); await reload;
  await expect(output.getByLabel('作者署名', { exact: true })).toHaveValue('保存失败时也不能丢');
  await output.getByRole('button', { name: '关闭社交图文导出', exact: true }).click();
  expect(output.isClosed()).toBe(false);
  await output.evaluate(() => { (window as unknown as { draftStorageBlocked: boolean }).draftStorageBlocked = false; localStorage.setItem('mewiki:test:draft-storage-allowed', 'true'); });
  await output.getByRole('button', { name: '重试保存导出草稿', exact: true }).first().click(); await draftSaved(output);
  await output.reload();
  await expect(output.getByLabel('作者署名', { exact: true })).toHaveValue('保存失败时也不能丢');
});

test('retries a failed draft read without replacing saved settings with defaults', async ({ page, context }) => {
  await context.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, version) {
      if (name === 'mewiki:publication-drafts' && localStorage.getItem('mewiki:test:draft-read-blocked') === 'true') throw new DOMException('Temporary storage error', 'SecurityError');
      return version === undefined ? original.call(this, name) : original.call(this, name, version);
    };
  });
  await page.goto('/');
  const output = await openExportTab(page);
  await output.getByLabel('作者署名', { exact: true }).fill('读取失败前的已存作者'); await draftSaved(output);
  await output.evaluate(() => { localStorage.setItem('mewiki:test:draft-read-blocked', 'true'); });
  await output.reload();
  await expect(output.getByRole('button', { name: '重新读取导出草稿', exact: true })).toBeVisible();
  await expect(output.getByTestId('mewiki-publication-page')).toHaveCount(0);
  await output.evaluate(() => { localStorage.removeItem('mewiki:test:draft-read-blocked'); });
  await output.getByRole('button', { name: '重新读取导出草稿', exact: true }).click();
  await expect(output.getByLabel('作者署名', { exact: true })).toHaveValue('读取失败前的已存作者');
});
