import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { runNotebookAction } from './helpers/researchNotebook.ts';
import { publicationHtml } from '../server/publicationHtml.ts';
import { publicationPagination } from '../server/publicationPagination.ts';
const settings = process.env.MEWIKI_EXPORT_E2E_SETTINGS || path.resolve('.mewiki/media-e2e-settings.json');
const profiles = settings + '.export-profiles';
test.beforeEach(async () => {
  expect(profiles.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  await rm(settings, { force: true }); await rm(profiles, { recursive: true, force: true });
});
async function openExport(page: Page, includeRemoteImage = false) {
  await page.goto('/');
  await expect(page.getByTestId('research-notebook')).toBeVisible();
  await page.evaluate(includeRemote => {
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'publication-note', title: '知识分享示例', library: 'research', createdAt: '2026-11-11', updatedAt: '2026-11-11', blocks: [
      { id: 'intro', type: 'paragraph', text: '知识可以清晰分享。这里是中文正文与 **重点说明**。' },
      { id: 'formula', type: 'formula', tex: 'E=mc^2', caption: '质量与能量' },
      { id: 'table', type: 'markdown', kind: 'table', text: '| 项目 | 数值 |\n| --- | --- |\n| 示例 | 42 |' },
    ] }];
    if (includeRemote) state.notes[0].blocks.push({ id: 'remote', type: 'paragraph', text: '![网络配图](https://social-export.invalid/image.png)' });
    state.activeNoteId = 'publication-note'; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  }, includeRemoteImage);
  await page.reload();
  return launchExport(page);
}
async function launchExport(notebook: Page) {
  const opened = notebook.waitForEvent('popup');
  await runNotebookAction(notebook.getByTestId('research-notebook'), '社交图文导出');
  const page = await opened;
  const panel = page.getByTestId('mewiki-publication-page');
  await expect(panel).toHaveAccessibleName('社交图文导出');
  return panel;
}
async function templateAction(dialog: Locator, name: string) {
  await dialog.getByRole('toolbar', { name: '模板工具栏', exact: true }).getByRole('button', { name: '模板操作', exact: true }).click();
  await dialog.getByRole('toolbar', { name: '模板操作', exact: true }).getByRole('button', { name, exact: true }).click();
}
async function saveTemplate(dialog: Locator, name: string) {
  await templateAction(dialog, '保存当前配置为个人模板');
  const form = dialog.getByRole('dialog', { name: '保存模板', exact: true });
  await form.getByLabel('模板名称', { exact: true }).fill(name);
  await form.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('个人模板已保存');
}
test('resets all parameters when switching between system and personal templates', async ({ page }) => {
  const dialog = await openExport(page);
  page = dialog.page();
  const templates = dialog.getByRole('combobox', { name: '选择模板', exact: true });
  const exportOptions = async () => {
    const pending = page.waitForEvent('download'); await templateAction(dialog, '导出模板');
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).profile.options;
  };
  const initial = await exportOptions();
  await dialog.getByLabel('导出标题', { exact: true }).fill('本次标题');
  await dialog.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
  await dialog.getByRole('combobox', { name: '图片格式', exact: true }).selectOption('jpeg');
  await dialog.getByText('精确尺寸（高级）', { exact: true }).click();
  await dialog.getByLabel('输出宽度', { exact: true }).fill('900');
  await dialog.getByLabel('长图最大高度', { exact: true }).fill('2400');
  await dialog.getByLabel('页面留白', { exact: true }).fill('96');
  await dialog.getByLabel('正文字号', { exact: true }).fill('36');
  await dialog.getByLabel('作者署名', { exact: true }).fill('模板作者');
  await dialog.getByLabel('页眉文字', { exact: true }).fill('模板页眉');
  await dialog.getByLabel('单独生成封面', { exact: true }).check();
  await dialog.getByLabel('显示页码', { exact: true }).uncheck();
  await saveTemplate(dialog, '完整参数');
  const personal = await exportOptions();
  await templates.selectOption('system:clear');
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('输出宽度', { exact: true })).toHaveValue('1080');
  await expect(dialog.getByLabel('输出高度', { exact: true })).toHaveValue('1440');
  await expect(dialog.getByLabel('单独生成封面', { exact: true })).not.toBeChecked();
  await templates.selectOption('system:mewiki');
  const systemSave = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/api/mewiki/export-profiles'));
  await saveTemplate(dialog, '系统参数快照');
  expect((await systemSave).postDataJSON().profiles.at(-1).options).toEqual(initial);
  await templates.selectOption({ label: '完整参数' });
  await expect(dialog.getByLabel('页眉文字', { exact: true })).toHaveValue('模板页眉');
  await dialog.getByLabel('作者署名', { exact: true }).fill('临时修改');
  await dialog.getByLabel('页面留白', { exact: true }).fill('120');
  await templateAction(dialog, '恢复模板样式');
  const personalSave = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/api/mewiki/export-profiles'));
  await saveTemplate(dialog, '完整参数');
  expect((await personalSave).postDataJSON().profiles.at(-1).options).toEqual(personal);
  await expect(dialog.getByLabel('导出标题', { exact: true })).toHaveValue('本次标题');
  await templates.selectOption('system:academic');
  await templateAction(dialog, '复制模板');
  await expect(dialog.getByRole('status')).toContainText('个人模板已复制');
  await expect(templates.locator('option:checked')).toHaveText('学术笔记副本');
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('');
});
test('uses a flat template selector and independent icon toolbars on a full export page', async ({ page }) => {
  const dialog = await openExport(page);
  page = dialog.page();
  await expect(dialog.locator(':scope > .device-record-modal-header')).toHaveCount(0);
  const toolbar = dialog.getByRole('toolbar', { name: '模板工具栏', exact: true });
  await expect(toolbar.getByRole('combobox', { name: '选择模板', exact: true })).toHaveValue('system:mewiki');
  await expect(toolbar.getByRole('combobox')).toHaveCount(1);
  await expect(toolbar.locator('optgroup')).toHaveCount(2);
  await expect(dialog).toHaveCSS('border-top-width', '0px');
  await expect(dialog).toHaveCSS('border-top-color', await dialog.evaluate(element => getComputedStyle(element).borderBottomColor));
  const preview = dialog.getByRole('toolbar', { name: '预览工具栏', exact: true });
  await expect(preview).toHaveCSS('height', '44px');
  await expect(toolbar).toHaveCSS('height', '44px');
  for (const button of await dialog.locator('.mewiki-publication-toolbar button[data-ui="icon-action"]').all()) {
    expect(await button.textContent()).toBe('');
    await expect(button).toHaveAttribute('data-ui', 'icon-action');
    await expect(button).toHaveCSS('border-top-style', 'none');
  }
  await toolbar.getByRole('button', { name: '导出说明', exact: true }).hover();
  await expect(dialog.getByRole('tooltip')).toContainText('个人模板按资料库保存');
  await expect(dialog.getByRole('tooltip')).toContainText('使用与觅维正文共用的基础样式');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('tooltip')).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await toolbar.getByRole('button', { name: '模板操作', exact: true }).click();
  const actions = dialog.getByRole('toolbar', { name: '模板操作', exact: true });
  await expect(actions.getByRole('button')).toHaveCount(6);
  const labels = ['保存当前配置为个人模板', '复制模板', '删除模板', '导出模板', '导入模板', '恢复模板样式'];
  await expect(actions.getByRole('button')).toHaveText(labels);
  for (const label of labels) {
    const button = actions.getByRole('button', { name: label, exact: true });
    const icon = await button.locator('svg').boundingBox();
    const text = await button.locator('span').boundingBox();
    expect(text!.x).toBeGreaterThan(icon!.x + icon!.width);
  }
  await expect(actions.getByRole('button', { name: '删除模板', exact: true })).toBeDisabled();
  await page.keyboard.press('End');
  await expect(actions.getByRole('button', { name: '恢复模板样式', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(actions.getByRole('button', { name: '保存当前配置为个人模板', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(actions.getByRole('button', { name: '导出模板', exact: true })).toBeFocused();
  await expect(actions.getByRole('button', { name: '导出模板', exact: true })).toHaveCSS('outline-style', 'auto');
  await page.screenshot({ path: test.info().outputPath('flat-export-actions.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(actions).not.toBeVisible();
  await expect(toolbar.getByRole('button', { name: '模板操作', exact: true })).toBeFocused();
  const closed = page.waitForEvent('close');
  await preview.getByRole('button', { name: '关闭社交图文导出', exact: true }).click();
  await closed;
});

test('keeps the browser focus feedback on template and export fields without an extra frame', async ({ page }) => {
  const dialog = await openExport(page);
  page = dialog.page();
  await page.keyboard.press('Tab');
  await dialog.getByText('精确尺寸（高级）', { exact: true }).click();
  for (const control of [dialog.getByRole('combobox', { name: '选择模板', exact: true }), dialog.getByLabel('导出标题', { exact: true }), dialog.getByLabel('输出宽度', { exact: true })]) {
    await control.evaluate(element => (element as HTMLElement).blur());
    const border = await control.evaluate(element => getComputedStyle(element).borderColor);
    await control.focus();
    await expect(control).toHaveCSS('outline-style', 'auto');
    await expect(control).toHaveCSS('outline-offset', '0px');
    await expect(control).toHaveCSS('border-color', border);
    await expect(control).toHaveCSS('box-shadow', 'none');
  }
});
test('exports real paginated images and portable templates without changing the notebook', async ({ page }) => {
  const notebook = page;
  let dialog = await openExport(page);
  page = dialog.page();
  await expect(dialog).toBeVisible();
  let templates = dialog.getByRole('combobox', { name: '选择模板', exact: true });
  await expect(templates).toHaveValue('system:mewiki');
  await page.screenshot({ path: test.info().outputPath('social-export-template-desktop.png'), fullPage: true });
  const panel = await dialog.boundingBox();
  const close = await dialog.getByRole('button', { name: '关闭社交图文导出', exact: true }).boundingBox();
  expect.soft(close!.x + close!.width).toBeGreaterThan(panel!.x + panel!.width - 30);
  const controls = dialog.locator('.mewiki-publication-controls');
  expect.soft(await controls.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(panel!.y + panel!.height);
  await controls.hover({ position: { x: 100, y: 100 } });
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => controls.evaluate(element => element.scrollTop)).toBeGreaterThan(200);
  await dialog.getByLabel('作者署名', { exact: true }).fill('示例作者');
  await saveTemplate(dialog, '我的蓝色知识卡');
  await dialog.getByRole('tab', { name: '选择内容', exact: true }).click();
  await dialog.getByLabel('在此内容前分页：3', { exact: true }).check();
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(dialog.getByAltText('导出预览第 1 页')).toBeVisible({ timeout: 90000 });
  await expect(dialog.locator('.mewiki-publication-preview img')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('social-export-desktop.png'), fullPage: true });
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载全部图片 ZIP', exact: true }).click();
  const download = await downloading;
  const files = unzipSync(await readFile((await download.path())!));
  const images = Object.entries(files).filter(([name]) => name.endsWith('.png'));
  expect(images).toHaveLength(2);
  for (const [, bytes] of images) expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', width: 1080, height: 1440 });
  expect(strFromU8(files['caption.txt'])).toContain('示例作者');
  const templateDownloading = page.waitForEvent('download');
  await templateAction(dialog, '导出模板');
  const template = await templateDownloading;
  const templateBytes = await readFile((await template.path())!);
  expect(templateBytes.toString()).not.toContain('知识可以清晰分享');
  expect(JSON.parse(templateBytes.toString()).profile.options.style).toBe('document');
  const closed = page.waitForEvent('close');
  await dialog.getByRole('button', { name: '关闭社交图文导出', exact: true }).click();
  await closed;
  dialog = await launchExport(notebook);
  page = dialog.page();
  templates = dialog.getByRole('combobox', { name: '选择模板', exact: true });
  await templates.selectOption({ label: '我的蓝色知识卡' });
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('示例作者');
  await templates.selectOption('system:clear');
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('');
  await templates.selectOption({ label: '我的蓝色知识卡' });
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('示例作者');
  await templateAction(dialog, '复制模板');
  await expect(dialog.getByRole('status')).toContainText('个人模板已复制');
  await expect(templates.locator('option:checked')).toHaveText('我的蓝色知识卡副本');
  await templateAction(dialog, '删除模板');
  await expect(dialog.getByRole('status')).toContainText('个人模板已删除');
  await expect(templates).toHaveValue('system:mewiki');
  await templates.selectOption({ label: '我的蓝色知识卡' });
  await dialog.getByLabel('作者署名', { exact: true }).fill('未保存的作者');
  await templateAction(dialog, '恢复模板样式');
  await expect(templates.locator('option:checked')).toHaveText('我的蓝色知识卡');
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('示例作者');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes[0].blocks[0].text)).toContain('知识可以清晰分享');
});

test('shares reading typography with the native template and keeps parameter templates independent', async ({ page, context }) => {
  const initial = await openExport(page);
  await initial.page().close();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [{ id: 'styled', type: 'markdown', kind: 'markdown', text: '## 共享标题\n\n正文 **重点** 与 `内联代码`。\n\n> 共享引用\n\n| 项目 | 数值 |\n| --- | --- |\n| 示例 | 42 |\n\n```ts\nconst value = 42;\n```' }];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const reading = page.locator('.research-note-block .research-markdown').filter({ hasText: '共享标题' }).first();
  const measure = (element: Element) => {
    const style = (selector?: string) => getComputedStyle(selector ? element.querySelector(selector)! : element);
    return { size: parseFloat(style().fontSize), font: style().fontFamily, headingSize: parseFloat(style('h2').fontSize), headingColor: style('h2').color, quoteBorder: parseFloat(style('blockquote').borderLeftWidth), quoteBackground: style('blockquote').backgroundColor, codeColor: style('p code').color, keywordColor: style('.hljs-keyword').color, tableSize: parseFloat(style('table').fontSize), headerBackground: style('th').backgroundColor };
  };
  const baseline = await reading.evaluate(measure);
  const titleStyle = await page.getByLabel('笔记标题', { exact: true }).evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), align: getComputedStyle(element).textAlign }));
  const dialog = await launchExport(page);
  page = dialog.page();
  // The previous draft selected the old block IDs; explicitly include the replacement source.
  await dialog.getByRole('tab', { name: '选择内容', exact: true }).click();
  await dialog.getByRole('button', { name: '全选', exact: true }).click();
  await dialog.getByRole('tab', { name: '样式预览', exact: true }).click();
  await dialog.getByRole('button', { name: '导出说明', exact: true }).hover();
  await expect(dialog.getByRole('tooltip')).toContainText('使用与觅维正文共用的基础样式');
  await page.keyboard.press('Escape');
  const pending = page.waitForRequest(request => request.url().endsWith('/api/mewiki/publications/jobs') && request.method() === 'POST');
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
  const request = (await pending).postDataJSON();
  expect(request.options.style).toBe('document');
  const inspection = await context.newPage();
  await inspection.route('**/*', route => route.abort('blockedbyclient'));
  const syntaxCss = await readFile(path.resolve('node_modules/highlight.js/styles/github-dark.css'), 'utf8');
  const documentCss = await readFile(path.join(process.env.MEWIKI_PUBLICATION_BUILD || 'dist', 'mewiki-publication.css'), 'utf8');
  await inspection.setContent(await publicationHtml(request, syntaxCss, documentCss));
  await inspection.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
  const exported = await inspection.locator('.page-body .research-markdown').filter({ has: inspection.locator('h2') }).first().evaluate(measure);
  const scale = request.options.fontSize / baseline.size;
  const zoom = await inspection.locator('.page-body .publication-dom').first().evaluate(element => Number(getComputedStyle(element).zoom));
  expect(zoom).toBeCloseTo(scale, 3);
  for (const key of ['headingSize', 'tableSize'] as const) expect(exported[key]).toBeCloseTo(baseline[key], 1);
  // Native content keeps the page's computed styles and scales them together via CSS zoom.
  expect(Math.abs(exported.quoteBorder - baseline.quoteBorder)).toBeLessThan(1 / scale);
  for (const key of ['font', 'headingColor', 'quoteBackground', 'codeColor', 'keywordColor', 'headerBackground'] as const) expect(exported[key]).toBe(baseline[key]);
  const exportedTitle = await inspection.locator('.document-title').first().evaluate(element => ({ size: parseFloat(getComputedStyle(element).fontSize), align: getComputedStyle(element).textAlign }));
  expect(exportedTitle.size / scale).toBeCloseTo(titleStyle.size, 1); expect(exportedTitle.align).toBe(titleStyle.align);
  await inspection.screenshot({ path: test.info().outputPath('native-export-content.png'), fullPage: true });
  await inspection.close();
  await expect(dialog.getByAltText('导出预览第 1 页')).toBeVisible({ timeout: 90000 });
  await page.screenshot({ path: test.info().outputPath('native-export-preview.png'), fullPage: true });
  const nativeImage = await dialog.getByAltText('导出预览第 1 页').getAttribute('src');
  await writeFile(test.info().outputPath('mewiki-native.png'), Buffer.from(nativeImage!.split(',')[1], 'base64'));
  await dialog.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  const legacy = page.waitForRequest(request => request.url().endsWith('/api/mewiki/publications/jobs') && request.method() === 'POST');
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
  expect((await legacy).postDataJSON().options).not.toHaveProperty('style');
  await expect(dialog.getByAltText('导出预览第 1 页')).toBeVisible({ timeout: 90000 });
});
test('exports a JPEG long image, changes language and closes when another window disables the plugin', async ({ page, context }) => {
  const dialog = await openExport(page);
  page = dialog.page();
  await dialog.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
  await dialog.getByRole('combobox', { name: '图片格式', exact: true }).selectOption('jpeg');
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(dialog.getByAltText('导出预览第 1 页')).toBeVisible({ timeout: 90000 });
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载第 1 页', exact: true }).click();
  const download = await downloading;
  expect(await sharp(await readFile((await download.path())!)).metadata()).toMatchObject({ format: 'jpeg', width: 1080 });
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(() => localStorage.setItem('mewiki:locale', 'en'));
  const exportPanel = page.getByTestId('mewiki-publication-page');
  await expect(exportPanel).toHaveAccessibleName('Social image export');
  await expect(exportPanel.getByRole('combobox', { name: 'Choose template', exact: true })).toBeVisible();
  await exportPanel.getByRole('button', { name: 'Template actions', exact: true }).click();
  const actions = exportPanel.getByRole('toolbar', { name: 'Template actions', exact: true });
  await expect(actions.getByRole('button', { name: 'Save current settings as a personal template', exact: true })).toHaveText('Save current settings as a personal template');
  expect(await actions.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('template-menu-english.png') });
  await page.keyboard.press('Escape');
  await expect(exportPanel.getByLabel('Export title', { exact: true })).toHaveValue('知识分享示例');
  await expect(exportPanel.getByRole('button', { name: 'Download page 1', exact: true })).toBeVisible();
  await other.evaluate(() => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'disabled' })));
  await expect(exportPanel).not.toBeVisible(); await other.close();
});

test('reports online images and exports only the explicitly selected blocks', async ({ page }) => {
  await page.route('https://social-export.invalid/**', route => route.abort());
  const dialog = await openExport(page, true);
  page = dialog.page();
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('网络图片需先保存到本地资料库');
  await expect(dialog.locator('.mewiki-publication-preview img')).toHaveCount(0);
  await dialog.getByRole('tab', { name: '选择内容', exact: true }).click();
  await dialog.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '生成预览', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '导出此内容：1', exact: true }).check();
  const submitted = page.waitForRequest(request => request.url().endsWith('/api/mewiki/publications/jobs') && request.method() === 'POST');
  await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.document.blocks).toHaveLength(1);
  expect(payload.document.blocks[0].id).toMatch(/^intro:/);
  expect(JSON.stringify(payload)).not.toContain('social-export.invalid');
  await expect(dialog.getByAltText('导出预览第 1 页')).toBeVisible({ timeout: 90000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes[0].blocks)).toHaveLength(4);
});
test('keeps the export controls usable on a narrow screen and supports template import', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openExport(page);
  page = dialog.page();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('combobox', { name: '选择模板', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '模板操作', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '关闭社交图文导出', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('social-export-template-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: '模板操作', exact: true }).click();
  const actions = dialog.getByRole('toolbar', { name: '模板操作', exact: true });
  await expect(actions.getByRole('button', { name: '保存当前配置为个人模板', exact: true })).toHaveText('保存当前配置为个人模板');
  const menuBounds = await actions.boundingBox();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(390);
  expect(await actions.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('template-menu-mobile.png') });
  await page.keyboard.press('Escape');
  const panel = await dialog.boundingBox();
  const close = await dialog.getByRole('button', { name: '关闭社交图文导出', exact: true }).boundingBox();
  expect(close!.x + close!.width).toBeGreaterThan(panel!.x + panel!.width - 30);
  const source = { format: 'mewiki-export-template', version: 1, profile: { id: 'imported', name: '导入风格', templateId: 'clear', templateVersion: '1.0.0', options: {
    width: 1080, height: 1440, margin: 72, fontSize: 32, lineHeight: 1.7, fontFamily: 'sans', background: '#ffffff', textColor: '#20252b', headingColor: '#162d50', accentColor: '#245fa5', subtitle: '', author: '导入作者', header: '', footer: '', date: '', showPageNumbers: true, cover: false, logo: '', coverImage: '', mode: 'pages', format: 'png', quality: 90,
  } } };
  const choosing = page.waitForEvent('filechooser');
  await templateAction(dialog, '导入模板');
  await (await choosing).setFiles({ name: 'style.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(dialog.getByLabel('作者署名', { exact: true })).toHaveValue('导入作者');
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('social-export-mobile.png'), fullPage: true });
  const content = dialog.locator(':scope > .mewiki-publication-content');
  await content.hover({ position: { x: 100, y: 100 } });
  await page.mouse.wheel(0, 5000);
  await expect(dialog.getByRole('button', { name: '生成预览', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('combobox', { name: '选择模板', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '关闭社交图文导出', exact: true })).toBeInViewport();
});
