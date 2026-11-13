import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openNotebookMoreMenu } from './helpers/researchNotebook.ts';
import { openSettingsSection, closeSettingsPage } from './helpers/settings.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';

const originalPath = 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf';
let root = '';
test.beforeEach(async () => { await rm(process.env.MEWIKI_EXPORT_E2E_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });
async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'font-demo', title: 'Font Sample', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [{ id: 'font-paragraph', type: 'paragraph', text: '**Saved font** remains available after reopening. 用户字体演示。' }] }];
    state.activeNoteId = 'font-demo'; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
  });
  await page.reload();
  const popup = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await popup;
  await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  return output;
}
async function importFont(output: Page) {
  const bytes = await readFile(originalPath);
  const id = createHash('sha256').update(bytes).digest('hex');
  await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '我的字体.ttf', mimeType: 'font/ttf', buffer: bytes });
  await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
  return { id, bytes };
}
test('persists imported font originals and uses them for the live sample and actual image', async ({ page }) => {
  const output = await open(page);
  const original = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  const { id, bytes } = await importFont(output);
  const family = `MeWikiUserFont_${id}`;
  const frame = output.frameLocator('iframe[title="样板内容预览"]');
  await expect(frame.locator('body')).toHaveCSS('font-family', new RegExp(family));
  await expect.poll(() => output.locator('iframe[title="样板内容预览"]').evaluate(async element => {
    const doc = (element as HTMLIFrameElement).contentDocument!; await doc.fonts.ready;
    return [...doc.fonts].some(face => face.family.startsWith('MeWikiUserFont_') && face.status === 'loaded');
  })).toBe(true);
  const sent = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  const request = (await sent).postDataJSON();
  expect(request.options.fontAssetId).toBe(id);
  expect(request.font.id).toBe(id);
  expect(Buffer.from(request.font.dataUrl.split(',')[1], 'base64')).toEqual(bytes);
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible();
  await expect(output.getByRole('alert')).toHaveCount(0);
  await output.reload();
  await expect(output.getByLabel('本地字体', { exact: true }).locator(`option[value="font:${id}"]`)).toHaveCount(1);
  await importFont(output);
  await expect(output.getByLabel('本地字体', { exact: true }).locator('optgroup[label="资料库字体"] option')).toHaveCount(1);
  const downloading = output.waitForEvent('download');
  await output.getByRole('button', { name: '下载原字体', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('我的字体.ttf');
  expect(await readFile((await download.path())!)).toEqual(bytes);
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(original);
  await output.screenshot({ path: test.info().outputPath('user-font-desktop.png') });
});
test('carries its font in a personal template and imports it into a fresh browser database', async ({ page, browser }) => {
  const output = await open(page);
  const { id } = await importFont(output);
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill('随身字体模板');
  await output.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '个人模板已保存。' })).toBeVisible();
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  const downloading = output.waitForEvent('download');
  await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const file = await downloading;
  const data = await readFile((await file.path())!);
  expect(JSON.parse(data.toString()).font.id).toBe(id);
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  try {
    const source = await context.newPage();
    const imported = await open(source);
    await expect(imported.getByLabel('本地字体', { exact: true }).locator('optgroup[label="资料库字体"] option')).toHaveCount(0);
    await imported.getByLabel('导入模板', { exact: true }).setInputFiles({ name: 'portable.json', mimeType: 'application/json', buffer: data });
    await expect(imported.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`);
    await expect(imported.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
    await imported.reload();
    await expect(imported.getByLabel('本地字体', { exact: true }).locator(`option[value="font:${id}"]`)).toHaveCount(1);
    await imported.getByLabel('本地字体', { exact: true }).selectOption(`font:${id}`);
    await expect(imported.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
    await imported.getByLabel('本地字体', { exact: true }).scrollIntoViewIfNeeded();
    await expect(imported.getByRole('button', { name: '导入字体', exact: true })).toBeInViewport();
    await expect(imported.getByRole('button', { name: '下载原字体', exact: true })).toBeInViewport();
    expect(await imported.locator('.mewiki-publication-font-control').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await imported.screenshot({ path: test.info().outputPath('user-font-phone.png'), fullPage: true });
  } finally { await context.close(); }
});
test('rejects a disguised font and keeps the current built-in font available', async ({ page }) => {
  const output = await open(page);
  await expect(output.getByRole('button', { name: '导入字体', exact: true })).toBeVisible();
  await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '损坏字体.woff2', mimeType: 'font/woff2', buffer: Buffer.from('<html>not a font</html>') });
  await expect(output.getByRole('alert')).toContainText('字体');
  await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue('sans');
  await expect(output.getByLabel('本地字体', { exact: true }).locator('optgroup[label="资料库字体"] option')).toHaveCount(0);
});

test('imports a font larger than 20 MiB and uses it in a portable template and image', async ({ page, browser }) => {
  test.setTimeout(180000);
  const output = await open(page);
  // Extra trailing padding keeps the bundled TTF tables intact and exercises real byte limits.
  const bytes = Buffer.alloc(25 * 1024 * 1024);
  (await readFile(originalPath)).copy(bytes);
  const id = createHash('sha256').update(bytes).digest('hex');
  await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '大字体.ttf', mimeType: 'font/ttf', buffer: bytes });
  await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`, { timeout: 30000 });
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled({ timeout: 30000 });
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill('大字体模板');
  await output.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '个人模板已保存。' })).toBeVisible();
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  const downloading = output.waitForEvent('download');
  await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const data = await readFile((await (await downloading).path())!);
  expect(data.length).toBeGreaterThan(32 * 1024 * 1024);
  const context = await browser.newContext({ locale: 'zh-CN' });
  try {
    const imported = await open(await context.newPage());
    await imported.getByLabel('导入模板', { exact: true }).setInputFiles({ name: 'large-font.json', mimeType: 'application/json', buffer: data });
    await expect(imported.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`, { timeout: 30000 });
    await expect(imported.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled({ timeout: 30000 });
    await imported.reload();
    await imported.getByLabel('选择模板', { exact: true }).selectOption({ label: '大字体模板' });
    await expect(imported.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`, { timeout: 30000 });
    await expect(imported.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled({ timeout: 30000 });
    const sent = imported.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
    await imported.getByRole('button', { name: '生成预览', exact: true }).click();
    const request = await sent;
    expect(Buffer.byteLength(request.postData()!)).toBeGreaterThan(32 * 1024 * 1024);
    await expect(imported.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible({ timeout: 90000 });
    await expect(imported.getByRole('alert')).toHaveCount(0);
  } finally { await context.close(); }
});
test('imports and decodes OTF, WOFF and WOFF2 originals alongside TTF fonts', async ({ page }) => {
  const output = await open(page);
  for (const extension of ['otf', 'woff', 'woff2']) {
    const bytes = await readFile(extension === 'otf' ? 'node_modules/katex/src/fonts/lib/Extra.otf' : `node_modules/katex/dist/fonts/KaTeX_Main-Regular.${extension}`);
    const id = createHash('sha256').update(bytes).digest('hex');
    await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: `字体格式.${extension}`, mimeType: `font/${extension}`, buffer: bytes });
    await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`);
    await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
    await expect(output.getByRole('alert')).toHaveCount(0);
  }
  await output.reload();
  await expect(output.getByLabel('本地字体', { exact: true }).locator('optgroup[label="资料库字体"] option')).toHaveCount(3);
});

test('recovers a missing selected template font when its original is imported again', async ({ page }) => {
  const output = await open(page);
  const bytes = await readFile(originalPath), id = createHash('sha256').update(bytes).digest('hex');
  const endpoint = '/api/mewiki/export-profiles';
  const previousResponse = await output.request.get(`${endpoint}?library=default&plugin=org.mewiki.social-export`, { headers: { 'X-MeWiki-Request': 'export-profiles' } });
  expect(previousResponse.ok()).toBe(true);
  const previous = await previousResponse.json();
  const profile = { id: crypto.randomUUID(), name: '待恢复字体模板', templateId: 'mewiki', templateVersion: '0.1.0', options: { ...defaultPublicationOptions(), style: 'document', fontAssetId: id } };
  const response = await output.request.put(endpoint, { headers: { 'X-MeWiki-Request': 'export-profiles' }, data: { libraryId: 'default', pluginId: 'org.mewiki.social-export', revision: previous.revision, profiles: [...previous.profiles, profile] } });
  expect(response.ok()).toBe(true);
  await output.reload();
  await output.getByLabel('选择模板', { exact: true }).selectOption(`personal:${profile.id}`);
  await expect(output.getByRole('alert')).toContainText('字体');
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeDisabled();
  await importFont(output);
  await expect(output.getByRole('alert')).toHaveCount(0);
});
test('migrates browser fonts into the local library and reopens their original bytes', async ({ page }) => {
  root = await mkdtemp(path.join(tmpdir(), 'mewiki-font-migration-'));
  const directory = path.join(root, '字体资料库');
  try {
    const output = await open(page);
    const { id, bytes } = await importFont(output);
    const settings = await openSettingsSection(page, 'storage');
    await settings.getByRole('textbox', { name: '本地保存路径', exact: true }).fill(directory);
    await settings.getByRole('button', { name: '检查路径', exact: true }).click();
    await settings.getByRole('button', { name: '迁移到此目录', exact: true }).click();
    await expect(settings.getByText('本地自动保存已启用', { exact: true })).toBeVisible();
    await closeSettingsPage(page);
    const laterBytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Italic.ttf');
    const laterId = createHash('sha256').update(laterBytes).digest('hex');
    await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '迁移后字体.ttf', mimeType: 'font/ttf', buffer: laterBytes });
    await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${laterId}`);
    await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
    expect(await readFile(path.join(directory, 'assets', `${laterId}.ttf`))).toEqual(laterBytes);
    const popup = page.waitForEvent('popup');
    await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
    const local = await popup;
    const selector = local.getByLabel('本地字体', { exact: true });
    await expect(selector.locator(`option[value="font:${id}"]`)).toHaveCount(1);
    await selector.selectOption(`font:${id}`);
    await expect(local.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
    expect(await readFile(path.join(directory, 'assets', `${id}.ttf`))).toEqual(bytes);
    await local.reload();
    await expect(selector.locator(`option[value="font:${id}"]`)).toHaveCount(1);
  } finally {
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('mewiki-font-migration-')) await rm(root, { recursive: true, force: true });
    await rm(process.env.MEWIKI_EXPORT_E2E_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true });
  }
});
