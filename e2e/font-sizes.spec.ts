import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { defaultCalloutAppearance } from '../src/domain/researchCallout.ts';
import { closeSettingsPage, openSettingsSection } from './helpers/settings.ts';
import { enableNotebookEditing, openNotebookMoreMenu, runNotebookAction } from './helpers/researchNotebook.ts';

async function fixture(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  const state = createNotebookFixture();
  state.notes = [{ id: 'font-size-demo', title: '字号演示', tags: ['字号/分类'], library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [
    { id: 'heading', type: 'heading', level: 2, text: '独立字号' },
    { id: 'paragraph', type: 'paragraph', text: '正文包含 `inlineCode` 和 **加粗**。 [对照笔记](#research-note/font-size-peer)' },
    { id: 'list', type: 'list', items: ['列表文字'] },
    { id: 'code', type: 'markdown', kind: 'code', text: '```js\nconst value = 1;\n```' },
    { id: 'formula', type: 'formula', tex: 'x^2', caption: '公式字号' },
    { id: 'table', type: 'markdown', kind: 'table', text: '| 列名 | 数值 |\n| --- | --- |\n| 单元格 | 1 |' },
    { id: 'callout', type: 'callout', title: '提示标签', text: '提示正文', appearance: { ...defaultCalloutAppearance } },
    { id: 'tabs', type: 'examples', title: '标签页标题', tabs: [{ id: 'tab', title: '页签', blocks: [{ id: 'tab-text', type: 'paragraph', text: '标签页正文' }] }] },
  ] }];
  state.notes.push({ id: 'font-size-peer', title: '对照笔记', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [{ id: 'peer-body', type: 'paragraph', text: '分屏正文' }] });
  state.activeNoteId = 'font-size-demo'; state.view = 'notes';
  await page.evaluate(state => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
  }, state);
  await page.reload();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('字号演示');
}
const text = (page: Page) => page.locator('[data-block-id="paragraph"] .research-markdown p').first();
const cssSize = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));

test.beforeEach(async () => { await rm(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });

test('scales classification labels with UI size and formulas with document size', async ({ page }) => {
  await fixture(page);
  const formula = await cssSize(page, '[data-block-id="formula"] .research-formula-inline-expression');
  const tag = await cssSize(page, '.research-note-folder-label');
  await openSettingsSection(page, 'general');
  await page.getByLabel('界面字号', { exact: true }).selectOption('20');
  expect.soft(await cssSize(page, '.research-note-folder-label')).toBeCloseTo(tag * 20 / 14, 2);
  expect(await cssSize(page, '[data-block-id="formula"] .research-formula-inline-expression')).toBeCloseTo(formula, 2);
  await page.getByLabel('正文字号', { exact: true }).selectOption('30');
  expect(await cssSize(page, '[data-block-id="formula"] .research-formula-inline-expression')).toBeCloseTo(formula * 2, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await cssSize(page, '[data-block-id="formula"] .research-formula-inline-expression')).toBeCloseTo(32, 2);
});

test('adjusts UI and document sizes independently, persists them and resets each separately', async ({ page }) => {
  await fixture(page);
  const saved = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  const settings = await openSettingsSection(page, 'general');
  await expect(settings.getByLabel('界面字号', { exact: true })).toHaveValue('14');
  await expect(settings.getByLabel('正文字号', { exact: true })).toHaveValue('15');
  const heading = settings.getByRole('heading', { name: '通用', exact: true });
  const defaultHeading = await heading.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await settings.getByLabel('界面字号', { exact: true }).selectOption('20');
  expect(await heading.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(defaultHeading * 20 / 14, 2);
  await expect(text(page)).toHaveCSS('font-size', '15px');
  await settings.getByLabel('正文字号', { exact: true }).selectOption('30');
  await expect(text(page)).toHaveCSS('font-size', '30px');
  await closeSettingsPage(page);
  await expect(page.locator('.research-notebook-toolbar').first()).toHaveCSS('height', '44px');
  expect(await cssSize(page, '.research-note-title')).toBeCloseTo(20 * 20 / 14, 2);
  expect(await page.getByLabel('笔记标题', { exact: true }).evaluate(node => node.clientHeight >= parseFloat(getComputedStyle(node).lineHeight))).toBe(true);
  expect(await cssSize(page, '.research-note-outline li button')).toBeCloseTo(12 * 20 / 14, 2);
  for (const [selector, size] of [
    ['[data-block-id="heading"] h2', 34], ['.research-callout-label', 30],
    ['.research-examples-label', 28], ['.research-examples-tabs > button', 24],
    ['[data-block-id="list"] li', 30], ['[data-block-id="table"] td', 28], ['pre', 26],
  ] as const) expect(await cssSize(page, selector)).toBeCloseTo(size, 2);
  await page.reload();
  await expect(text(page)).toHaveCSS('font-size', '30px');
  await openSettingsSection(page, 'general');
  await expect(settings.getByLabel('界面字号', { exact: true })).toHaveValue('20');
  await settings.getByRole('button', { name: '恢复默认界面字号', exact: true }).click();
  await expect(text(page)).toHaveCSS('font-size', '30px');
  await expect(heading).toHaveCSS('font-size', `${defaultHeading}px`);
  await settings.getByRole('button', { name: '恢复默认正文字号', exact: true }).click();
  await expect(text(page)).toHaveCSS('font-size', '15px');
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(saved);
});

test('synchronizes same-library windows and keeps session sizes when localStorage writes are blocked', async ({ page, context }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const peer = await context.newPage();
  await peer.goto('/?page=settings&section=general');
  await page.getByLabel('界面字号', { exact: true }).selectOption('18');
  await expect(peer.getByLabel('界面字号', { exact: true })).toHaveValue('18');
  await peer.getByLabel('正文字号', { exact: true }).selectOption('24');
  await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('24');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.endsWith(':font-sizes')) throw new Error('blocked'); original.call(this, key, value); };
  });
  await page.getByLabel('界面字号', { exact: true }).selectOption('16');
  await closeSettingsPage(page);
  await openSettingsSection(page, 'general');
  await expect(page.getByLabel('界面字号', { exact: true })).toHaveValue('16');
  await expect(page.getByLabel('正文字号', { exact: true })).toHaveValue('24');
});

test('keeps large sizes usable on mobile and applies the document size to editing', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  await page.getByLabel('界面字号', { exact: true }).selectOption('20');
  await page.getByLabel('正文字号', { exact: true }).selectOption('32');
  await page.setViewportSize({ width: 390, height: 844 });
  const settings = page.getByTestId('mewiki-settings-page');
  await settings.getByLabel('界面字号', { exact: true }).scrollIntoViewIfNeeded();
  await expect(settings.getByLabel('界面字号', { exact: true })).toBeInViewport();
  expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await settings.screenshot({ path: test.info().outputPath('font-sizes-mobile.png') });
  await closeSettingsPage(page);
  await expect(text(page)).toHaveCSS('font-size', '32px');
  const outline = page.getByRole('button', { name: '收起文章大纲', exact: true });
  if (await outline.isVisible()) await outline.click();
  await enableNotebookEditing(page.getByTestId('research-notebook'));
  await text(page).click();
  await expect(page.locator('[data-block-id="paragraph"] [contenteditable="true"]')).toHaveCSS('font-size', '32px');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press('Escape');
  await runNotebookAction(page.getByTestId('research-notebook'), '切换为只读模式');
  await page.locator('[data-block-id="paragraph"]').getByRole('link', { name: '对照笔记', exact: true }).click();
  await expect(page.locator('[data-reading-note-id="font-size-peer"] .research-markdown p')).toHaveCSS('font-size', '32px');
  await page.getByTestId('research-notebook').screenshot({ path: test.info().outputPath('font-sizes-note.png') });
  await openSettingsSection(page, 'general');
  await settings.screenshot({ path: test.info().outputPath('font-sizes-desktop.png') });
});

test('uses the selected font for inline code and keeps export typography independent of reading sizes', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf');
  const id = createHash('sha256').update(bytes).digest('hex'), family = `MeWikiUserFont_${id}`;
  await page.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '字体.ttf', mimeType: 'font/ttf', buffer: bytes });
  await expect(page.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await page.getByLabel('界面字号', { exact: true }).selectOption('20');
  await page.getByLabel('正文字号', { exact: true }).selectOption('30');
  await closeSettingsPage(page);
  await expect(page.locator('p code').first()).toHaveCSS('font-family', new RegExp(family));
  await expect(page.locator('pre code').first()).not.toHaveCSS('font-family', new RegExp(family));
  const opened = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await opened;
  await expect(output.getByLabel('正文字号', { exact: true })).not.toHaveValue('30');
  const original = await output.getByLabel('正文字号', { exact: true }).inputValue();
  const sample = output.frameLocator('iframe[title="样板内容预览"]');
  await expect(sample.locator('body')).toBeVisible();
  await openSettingsSection(page, 'general');
  await page.getByLabel('正文字号', { exact: true }).selectOption('32');
  await expect(output.getByLabel('正文字号', { exact: true })).toHaveValue(original);
  await output.getByLabel('本地字体', { exact: true }).selectOption(`font:${id}`);
  await expect(sample.locator('p code').first()).toHaveCSS('font-family', new RegExp(family));
  await expect(output.locator('.publication-reading-surface pre code').first()).not.toHaveCSS('font-family', new RegExp(family));
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await expect(output.locator('.publication-reading-surface .research-markdown').first()).toHaveCSS('font-size', '15px');
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible({ timeout: 60000 });
  await output.getByRole('tab', { name: '样式预览', exact: true }).click();
  await output.getByLabel('选择模板', { exact: true }).selectOption({ label: '清爽科普' });
  await expect(sample.locator('body')).not.toHaveClass(/publication-native/);
  await output.getByLabel('本地字体', { exact: true }).selectOption(`font:${id}`);
  await expect(sample.locator('p code').first()).toHaveCSS('font-family', new RegExp(family));
});

test('imports a 25 MiB font through interface settings in browser and local storage', async ({ page }) => {
  test.setTimeout(120000);
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-font-size-large-'));
  try {
    await fixture(page);
    const settings = await openSettingsSection(page, 'general');
    const bytes = Buffer.alloc(25 * 1024 * 1024);
    (await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf')).copy(bytes);
    const id = createHash('sha256').update(bytes).digest('hex');
    const upload = () => settings.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '25MiB.ttf', mimeType: 'font/ttf', buffer: bytes });
    await upload();
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`, { timeout: 30000 });
    await openSettingsSection(page, 'storage');
    await settings.getByLabel('本地保存路径', { exact: true }).fill(root);
    await settings.getByRole('button', { name: '检查路径', exact: true }).click();
    await settings.getByRole('button', { name: '迁移到此目录', exact: true }).click();
    await expect(settings.getByText('本地自动保存已启用', { exact: true })).toBeVisible();
    await openSettingsSection(page, 'general');
    expect(createHash('sha256').update(await readFile(path.join(root, 'assets', `${id}.ttf`))).digest('hex')).toBe(id);
    bytes[bytes.length - 1] = 1;
    const localId = createHash('sha256').update(bytes).digest('hex');
    await upload();
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${localId}`, { timeout: 30000 });
    await expect(settings.getByRole('button', { name: '下载原字体', exact: true })).toBeEnabled({ timeout: 30000 });
    expect(createHash('sha256').update(await readFile(path.join(root, 'assets', `${localId}.ttf`))).digest('hex')).toBe(localId);
    await page.reload();
    await expect(settings.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${localId}`);
    await expect(settings.getByRole('alert')).toHaveCount(0);
  } finally {
    await page.close();
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('mewiki-font-size-large-')) await rm(root, { recursive: true, force: true });
  }
});
