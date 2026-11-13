import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';
import { closeSettingsPage, openSettingsSection } from './helpers/settings.ts';
import { openNotebookMoreMenu } from './helpers/researchNotebook.ts';

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  const state = createNotebookFixture();
  state.notes = [{ id: 'interface-font-demo', title: 'Interface Font', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [
    { id: 'font-heading', type: 'heading', level: 2, text: 'Heading Sample' },
    { id: 'font-text', type: 'paragraph', text: 'Readable **bold** text and $x^2$. 字体示例。' },
    { id: 'font-code', type: 'markdown', kind: 'code', text: '```javascript\nconst answer = 42;\n```' },
  ] }];
  state.activeNoteId = 'interface-font-demo'; state.view = 'notes';
  await page.evaluate(state => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
  }, state);
  await page.reload();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('Interface Font');
  return openSettingsSection(page, 'general');
}
async function importFont(page: Page, extension = 'ttf') {
  const bytes = await readFile(`node_modules/katex/dist/fonts/KaTeX_Main-Regular.${extension}`);
  const id = createHash('sha256').update(bytes).digest('hex');
  const settings = page.getByTestId('mewiki-settings-page');
  await settings.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: `我的界面字体.${extension}`, mimeType: `font/${extension}`, buffer: bytes });
  await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(settings.getByRole('button', { name: '下载原字体', exact: true })).toBeEnabled();
  return { id, bytes, family: `MeWikiUserFont_${id}` };
}

test.beforeEach(async () => { await rm(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });

test('applies a saved library font to the interface and note text, restores after reload and resets to defaults', async ({ page }) => {
  const settings = await open(page);
  const original = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  const { family, bytes } = await importFont(page);
  await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(family));
  await expect(settings.getByRole('searchbox', { name: '搜索设置', exact: true })).toHaveCSS('font-family', new RegExp(family));
  const downloading = page.waitForEvent('download');
  await settings.getByRole('button', { name: '下载原字体', exact: true }).click();
  expect(await readFile((await (await downloading).path())!)).toEqual(bytes);
  await closeSettingsPage(page);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveCSS('font-family', new RegExp(family));
  await expect(page.locator('.research-markdown p').filter({ hasText: 'Readable' })).toHaveCSS('font-family', new RegExp(family));
  await expect(page.locator('.research-note-outline li button').first()).toHaveCSS('font-family', new RegExp(family));
  await expect(page.locator('.katex .mord').first()).not.toHaveCSS('font-family', new RegExp(family));
  await expect(page.locator('pre code').first()).not.toHaveCSS('font-family', new RegExp(family));
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(original);
  await page.reload();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveCSS('font-family', new RegExp(family));
  await openSettingsSection(page, 'general');
  await settings.screenshot({ path: test.info().outputPath('interface-font-desktop.png') });
  await settings.getByLabel('界面与正文字体', { exact: true }).selectOption('default');
  await expect(settings.getByRole('heading', { name: '通用', exact: true })).not.toHaveCSS('font-family', new RegExp(family));
  await page.reload();
  await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue('default');
});

test('shares font originals with export and synchronizes same-library windows without enabling the export plugin', async ({ page, context }) => {
  const settings = await open(page);
  await page.evaluate(() => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'disabled' })));
  await page.reload();
  await expect(settings.getByLabel('界面与正文字体', { exact: true })).toBeVisible();
  const peer = await context.newPage();
  await peer.goto('/?page=settings&section=general');
  const { id, family } = await importFont(page);
  await expect(peer.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(peer.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(family));
  await page.evaluate(() => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' })));
  await closeSettingsPage(page);
  await page.reload();
  const popup = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await popup;
  await expect(output.getByLabel('本地字体', { exact: true }).locator(`option[value="font:${id}"]`)).toHaveCount(1);
  await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue('sans');
  const imported = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Italic.ttf');
  const otherId = createHash('sha256').update(imported).digest('hex');
  await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '导出导入字体.ttf', mimeType: 'font/ttf', buffer: imported });
  await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${otherId}`);
  await expect(peer.getByLabel('界面与正文字体', { exact: true }).locator(`option[value="font:${otherId}"]`)).toHaveCount(1);
  await expect(peer.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
});

test('keeps the selected font on invalid import and supports English and narrow settings', async ({ page }) => {
  const settings = await open(page);
  const { id } = await importFont(page, 'woff2');
  await settings.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '坏字体.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') });
  await expect(settings.getByRole('alert')).toContainText('字体');
  await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await settings.getByRole('radio', { name: /English/ }).check();
  await settings.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('font');
  await settings.getByRole('button', { name: /Interface font/ }).click();
  await expect(settings.getByLabel('Interface and note font', { exact: true })).toHaveValue(`font:${id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await settings.getByLabel('Interface and note font', { exact: true }).scrollIntoViewIfNeeded();
  await expect(settings.getByRole('button', { name: 'Import font', exact: true })).toBeInViewport();
  await expect(settings.getByRole('button', { name: 'Download original font', exact: true })).toBeInViewport();
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await settings.screenshot({ path: test.info().outputPath('interface-font-phone.png') });
});

test('falls back for a missing original and restores the same selected font when reimported', async ({ page }) => {
  const settings = await open(page);
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf');
  const id = createHash('sha256').update(bytes).digest('hex');
  await page.evaluate(id => localStorage.setItem('mewiki:library:default:interface-font', id), id);
  await page.reload();
  await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(settings.getByRole('alert')).toContainText('重新导入字体');
  await expect(settings.getByRole('heading', { name: '通用', exact: true })).not.toHaveCSS('font-family', /MeWikiUserFont_/);
  await expect(settings.getByRole('button', { name: '下载原字体', exact: true })).toBeDisabled();
  const { family } = await importFont(page);
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(family));
});

test('restores a missing export template font by importing its original in interface settings', async ({ page }) => {
  await open(page);
  await closeSettingsPage(page);
  const popup = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await popup;
  await expect(output.getByLabel('本地字体', { exact: true })).toBeVisible();
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf');
  const id = createHash('sha256').update(bytes).digest('hex');
  const endpoint = '/api/mewiki/export-profiles';
  const previous = await output.request.get(`${endpoint}?library=default&plugin=org.mewiki.social-export`, { headers: { 'X-MeWiki-Request': 'export-profiles' } });
  expect(previous.ok()).toBe(true);
  const collection = await previous.json();
  const profile = { id: crypto.randomUUID(), name: '共享字体恢复', templateId: 'mewiki', templateVersion: '0.1.0', options: { ...defaultPublicationOptions(), style: 'document', fontAssetId: id } };
  const saved = await output.request.put(endpoint, { headers: { 'X-MeWiki-Request': 'export-profiles' }, data: { libraryId: 'default', pluginId: 'org.mewiki.social-export', revision: collection.revision, profiles: [...collection.profiles, profile] } });
  expect(saved.ok()).toBe(true);
  await output.reload();
  await output.getByLabel('选择模板', { exact: true }).selectOption(`personal:${profile.id}`);
  await expect(output.getByRole('alert')).toContainText('字体');
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeDisabled();
  await openSettingsSection(page, 'general');
  await importFont(page);
  await expect(output.getByRole('alert')).toHaveCount(0);
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
  await expect(output.getByLabel('选择模板', { exact: true })).toHaveValue(`personal:${profile.id}`);
  await expect(output.getByLabel('本地字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(output.frameLocator('iframe[title="样板内容预览"]').locator('body')).toHaveCSS('font-family', new RegExp(`MeWikiUserFont_${id}`));
});

test('keeps the selected interface font when browser originals migrate to the local library', async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-interface-font-migration-'));
  try {
    const settings = await open(page);
    const { id, bytes, family } = await importFont(page);
    await openSettingsSection(page, 'storage');
    await settings.getByRole('textbox', { name: '本地保存路径', exact: true }).fill(root);
    await settings.getByRole('button', { name: '检查路径', exact: true }).click();
    await settings.getByRole('button', { name: '迁移到此目录', exact: true }).click();
    await expect(settings.getByText('本地自动保存已启用', { exact: true })).toBeVisible();
    await openSettingsSection(page, 'general');
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(family));
    expect(await readFile(path.join(root, 'assets', `${id}.ttf`))).toEqual(bytes);
    await page.reload();
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(family));
    await expect(settings.getByRole('alert')).toHaveCount(0);
  } finally {
    await page.close();
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('mewiki-interface-font-migration-')) await rm(root, { recursive: true, force: true });
  }
});

test('isolates local library choices and ignores a font decode that completes after switching libraries', async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-interface-fonts-'));
  const settings = await open(page);
  async function create(name: string) {
    await openSettingsSection(page, 'libraries');
    const manager = page.getByTestId('mewiki-library-manager');
    await manager.getByRole('button', { name: '新建资料库', exact: true }).click();
    await manager.getByLabel('资料库名称', { exact: true }).fill(name);
    await manager.getByLabel('资料库文件夹', { exact: true }).fill(path.join(root, name));
    await manager.getByRole('button', { name: '创建并打开', exact: true }).click();
    await expect(manager).not.toBeVisible();
    await openSettingsSection(page, 'general');
    return new URL(page.url()).searchParams.get('library')!;
  }
  async function switchTo(name: string) {
    await openSettingsSection(page, 'libraries');
    await page.getByTestId('mewiki-library-manager').getByRole('button', { name: `切换到${name}`, exact: true }).click();
    await expect(settings).not.toBeVisible();
    await expect(page.getByRole('button', { name: `当前资料库：${name}，切换资料库`, exact: true })).toBeVisible();
    await openSettingsSection(page, 'general');
  }
  try {
    const firstLibrary = await create('字体库一');
    await settings.getByLabel('界面字号', { exact: true }).selectOption('18');
    await settings.getByLabel('正文字号', { exact: true }).selectOption('24');
    const first = await importFont(page);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(first.family));
    expect(await readFile(path.join(root, '字体库一', 'assets', `${first.id}.ttf`))).toEqual(first.bytes);
    const secondLibrary = await create('字体库二');
    expect(secondLibrary).not.toBe(firstLibrary);
    await expect(settings.getByLabel('界面字号', { exact: true })).toHaveValue('14');
    await expect(settings.getByLabel('正文字号', { exact: true })).toHaveValue('15');
    await settings.getByLabel('界面字号', { exact: true }).selectOption('12');
    await settings.getByLabel('正文字号', { exact: true }).selectOption('16');
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue('default');
    await expect(settings.getByLabel('界面与正文字体', { exact: true }).locator('optgroup[label="资料库字体"] option')).toHaveCount(0);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).not.toHaveCSS('font-family', /MeWikiUserFont_/);
    const second = await importFont(page, 'woff2');
    await switchTo('字体库一');
    await expect(settings.getByLabel('界面字号', { exact: true })).toHaveValue('18');
    await expect(settings.getByLabel('正文字号', { exact: true })).toHaveValue('24');
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${first.id}`);
    await expect(settings.getByLabel('界面与正文字体', { exact: true }).locator(`option[value="font:${second.id}"]`)).toHaveCount(0);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(first.family));
    await settings.getByLabel('界面与正文字体', { exact: true }).selectOption('default');
    await page.evaluate(family => {
      const state = window as Window & { fontDecodeWaiting?: boolean; releaseFontDecode?: () => void; fontDecodeReleased?: boolean };
      const load = FontFace.prototype.load;
      FontFace.prototype.load = async function () {
        const face = await load.call(this);
        if (this.family === family) {
          state.fontDecodeWaiting = true;
          await new Promise<void>(resolve => { state.releaseFontDecode = () => { FontFace.prototype.load = load; resolve(); }; });
          state.fontDecodeReleased = true;
        }
        return face;
      };
    }, first.family);
    await settings.getByLabel('界面与正文字体', { exact: true }).selectOption(`font:${first.id}`);
    await expect.poll(() => page.evaluate(() => (window as Window & { fontDecodeWaiting?: boolean }).fontDecodeWaiting)).toBe(true);
    await switchTo('字体库二');
    await expect(settings.getByLabel('界面字号', { exact: true })).toHaveValue('12');
    await expect(settings.getByLabel('正文字号', { exact: true })).toHaveValue('16');
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(second.family));
    await page.evaluate(() => (window as Window & { releaseFontDecode?: () => void }).releaseFontDecode?.());
    await expect.poll(() => page.evaluate(() => (window as Window & { fontDecodeReleased?: boolean }).fontDecodeReleased)).toBe(true);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(second.family));
    expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family), first.family)).toBe(false);
    await page.reload();
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${second.id}`);
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(second.family));
    await switchTo('字体库一');
    await expect(settings.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', new RegExp(first.family));
  } finally {
    await page.close();
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('mewiki-interface-fonts-')) await rm(root, { recursive: true, force: true });
  }
});
