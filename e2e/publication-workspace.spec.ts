import { expect, test, type Page } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { openNotebookMoreMenu } from './helpers/researchNotebook.ts';
import assets from '../docs/wiki/assets/manifest.json' with { type: 'json' };

test.beforeEach(async () => { await rm(process.env.MEWIKI_EXPORT_E2E_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });
async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'workspace-note', title: '原文可视选择', library: 'research', createdAt: '2026-11-11', updatedAt: '2026-11-11', blocks: [
      { id: 'heading', type: 'heading', level: 2, text: '完整原始标题' },
      { id: 'paragraph', type: 'paragraph', text: '这里显示**完整加粗原文**，而不是截断的摘要。' },
      { id: 'callout', type: 'callout', title: '提示内容', text: '在原文旁直接勾选。', appearance: { borderColor: '#c46221', borderStyle: 'dashdot' } },
      { id: 'tabs', type: 'examples', title: '阅读标签页', tabs: [{ id: 'a', title: '第一组', blocks: [{ id: 'a-text', type: 'paragraph', text: '原页第一组内容' }] }, { id: 'b', title: '第二组', blocks: [{ id: 'b-text', type: 'paragraph', text: '第二组需要导出的内容' }] }] },
      { id: 'embed', type: 'noteEmbed', sourceNoteId: 'reference-note', blockIds: ['ref-tabs'] },
    ] }, { id: 'reference-note', title: '引用来源', library: 'research', createdAt: '2026-11-11', updatedAt: '2026-11-11', blocks: [
      { id: 'ref-tabs', type: 'examples', title: '引用标签页', tabs: [{ id: 'ref-a', title: '引用甲', blocks: [{ id: 'ref-a-text', type: 'paragraph', text: '引用第一组内容' }] }, { id: 'ref-b', title: '引用乙', blocks: [{ id: 'ref-b-text', type: 'paragraph', text: '引用第二组内容' }] }] },
    ] }];
    state.activeNoteId = 'workspace-note'; state.view = 'notes';
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

test('groups export settings in full-width collapsible sections and preserves edits when toggled', async ({ page }) => {
  const output = await open(page);
  const controls = output.getByRole('region', { name: '导出设置', exact: true });
  const content = controls.getByRole('group', { name: '内容', exact: true });
  const canvas = controls.getByRole('group', { name: '画幅', exact: true });
  const style = controls.getByRole('group', { name: '样式', exact: true });
  await expect(content.getByLabel('导出标题', { exact: true })).toBeVisible();
  await expect(content.getByLabel('作者署名', { exact: true })).toBeVisible();
  await expect(content.getByLabel('作者头像或 Logo', { exact: true })).toBeVisible();
  await expect(canvas.getByRole('combobox', { name: '画面比例', exact: true })).toBeVisible();
  await expect(canvas.getByLabel('导出标题', { exact: true })).toHaveCount(0);
  await expect(style.getByLabel('背景颜色', { exact: true })).toBeVisible();
  await expect(style.getByLabel('封面图片', { exact: true })).toBeVisible();
  await expect(content.getByLabel('封面图片', { exact: true })).toHaveCount(0);
  await content.getByLabel('导出标题', { exact: true }).fill('折叠保留的导出标题');
  await content.getByLabel('作者署名', { exact: true }).fill('折叠保留的作者');
  await content.locator(':scope > summary').click({ position: { x: 12, y: 16 } });
  await expect(content.getByLabel('导出标题', { exact: true })).toBeHidden();
  await expect(canvas.getByRole('combobox', { name: '画面比例', exact: true })).toBeVisible();
  await content.locator(':scope > summary').focus();
  await output.keyboard.press('Enter');
  await expect(content.getByLabel('导出标题', { exact: true })).toHaveValue('折叠保留的导出标题');
  await expect(content.getByLabel('作者署名', { exact: true })).toHaveValue('折叠保留的作者');
  await style.getByLabel('正文字号', { exact: true }).fill('34');
  await style.locator(':scope > summary').focus();
  await output.keyboard.press('Space');
  await expect(style.getByLabel('正文字号', { exact: true })).toBeHidden();
  await content.getByRole('button', { name: '选择导出内容与分页', exact: true }).click();
  await expect(output.getByRole('tab', { name: '选择内容', exact: true })).toHaveAttribute('aria-selected', 'true');
  await output.getByRole('button', { name: '清空选择', exact: true }).click();
  await output.getByLabel('导出此内容：2', { exact: true }).check();
  await expect(content).toContainText('已选择 1 / 5 项');
  const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  const request = (await submitted).postDataJSON();
  expect(request.document.title).toBe('折叠保留的导出标题');
  expect(request.options.author).toBe('折叠保留的作者');
  expect(request.options.fontSize).toBe(34);
  expect(request.document.blocks.map((block: { id: string }) => block.id)).toEqual(['paragraph:native']);
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible();
  await expect(style).not.toHaveAttribute('open');
  await content.locator(':scope > summary').click();
  await output.locator('.mewiki-publication-controls').evaluate(element => { element.scrollTop = 0; });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await output.setViewportSize(viewport);
    for (const section of [content, canvas, style]) {
      const geometry = await section.locator(':scope > summary').evaluate(element => {
        const bar = element.getBoundingClientRect(), pane = element.closest('.mewiki-publication-controls')!.getBoundingClientRect();
        const text = getComputedStyle(element.querySelector('span')!);
        return { left: bar.left - pane.left, right: pane.right - bar.right, align: text.textAlign, radius: getComputedStyle(element).borderRadius };
      });
      expect(Math.abs(geometry.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.right)).toBeLessThanOrEqual(1);
      expect(geometry.align).toBe('right'); expect(geometry.radius).toBe('0px');
    }
    expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await output.screenshot({ path: test.info().outputPath(`export-sections-${viewport.width}.png`) });
  }
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  await expect(content).not.toHaveAttribute('open');
  await expect(style).not.toHaveAttribute('open');
  await expect(canvas).toHaveAttribute('open', '');
});

test('explains the invalid export setting in the sample and generated result, then recovers after correction', async ({ page }) => {
  const output = await open(page);
  await output.getByText('精确尺寸（高级）', { exact: true }).click();
  await output.getByLabel('输出宽度', { exact: true }).fill('479');
  const sampleError = output.locator('.mewiki-publication-sample [role="status"]');
  await expect(sampleError).toContainText('画幅 → 输出宽度');
  await expect(sampleError).toContainText('479');
  await expect(sampleError).toContainText('480');
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.getByRole('alert')).toContainText('画幅 → 输出宽度');
  await output.getByLabel('输出宽度', { exact: true }).fill('480');
  await output.getByLabel('页面留白', { exact: true }).fill('200');
  await output.getByLabel('正文字号', { exact: true }).fill('80');
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.getByRole('alert')).toContainText('正文宽度');
  await expect(output.getByRole('alert')).toContainText('页面留白');
  await output.screenshot({ path: test.info().outputPath('export-setting-diagnostic.png') });
  await page.evaluate(() => localStorage.setItem('mewiki:locale', 'en'));
  await expect(output.getByRole('alert')).toContainText('Body width');
  await expect(output.getByRole('alert')).not.toContainText('正文');
  await output.getByLabel('Output width', { exact: true }).fill('1080');
  await output.getByLabel('Page margins', { exact: true }).fill('72');
  await output.getByLabel('Body font size', { exact: true }).fill('32');
  await output.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(output.getByAltText('Export preview, page 1', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(output.getByRole('alert')).toHaveCount(0);
});

test('retains the resource location when the real export service rejects a damaged image', async ({ page }) => {
  const output = await open(page);
  await output.route('**/api/mewiki/publications/jobs', route => {
    if (route.request().method() !== 'POST') return route.continue();
    const payload = route.request().postDataJSON();
    payload.options.logo = 'data:image/png;base64,bG9nbw==';
    return route.continue({ postData: JSON.stringify(payload) });
  });
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.getByRole('alert')).toContainText('内容 → 作者头像或 Logo', { timeout: 30000 });
  await expect(output.getByRole('alert')).toContainText('有效的静态 PNG 或 JPEG');
  await expect(output.getByRole('alert')).not.toContainText('导出参数或内容无效');
  await output.screenshot({ path: test.info().outputPath('export-resource-diagnostic.png') });
});

test('opens source selection from the content section on a narrow English page', async ({ page }) => {
  const output = await open(page);
  await output.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('mewiki:locale', 'en'));
  const controls = output.getByRole('region', { name: 'Export settings', exact: true });
  for (const name of ['Content', 'Canvas', 'Style']) {
    const section = controls.getByRole('group', { name, exact: true });
    await expect(section).toHaveAttribute('open', '');
    await section.locator(':scope > summary').click();
    await expect(section).not.toHaveAttribute('open');
  }
  const content = controls.getByRole('group', { name: 'Content', exact: true });
  await content.locator(':scope > summary').click();
  await content.getByRole('button', { name: 'Choose content and page breaks', exact: true }).click();
  const source = output.getByRole('region', { name: 'Source and content selection', exact: true });
  await expect(output.getByRole('tab', { name: 'Select content', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(source).toBeInViewport();
  await expect(source.getByLabel('Export this content: 2', { exact: true })).toBeInViewport();
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.screenshot({ path: test.info().outputPath('export-sections-english-phone.png') });
});

test('shows a live sample before generating and updates it without creating an image job', async ({ page }) => {
  const output = await open(page);
  const jobs: string[] = [];
  output.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs')) jobs.push(request.url()); });
  await expect(output.getByRole('tab', { name: '样式预览', exact: true })).toHaveAttribute('aria-selected', 'true');
  const sample = output.frameLocator('iframe[title="样板内容预览"]');
  await expect(sample.locator('.document-title')).toContainText('样板');
  await output.screenshot({ path: test.info().outputPath('publication-sample-desktop.png') });
  await output.getByLabel('背景颜色', { exact: true }).fill('#fff4e8');
  await expect(sample.locator('.publication-page').first()).toHaveCSS('background-color', 'rgb(255, 244, 232)');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:academic');
  await expect(sample.locator('.publication-page').first()).toHaveCSS('background-color', 'rgb(250, 248, 242)');
  await expect.poll(() => sample.locator('body').evaluate(async () => (await document.fonts.load('30px "Noto Serif SC Variable"', '样板')).length)).toBeGreaterThan(0);
  await output.getByLabel('作者署名', { exact: true }).fill('样板作者');
  await expect(sample.locator('.page-header')).toContainText('样板作者');
  expect(jobs).toHaveLength(0);
  await expect(output.getByRole('button', { name: '下载全部图片 ZIP', exact: true })).toBeDisabled();
});

test('offers aspect and clarity first and keeps exact dimensions in advanced settings', async ({ page }) => {
  const output = await open(page);
  await expect(output.getByRole('combobox', { name: '画面比例', exact: true })).toHaveValue('3:4');
  await expect(output.getByRole('combobox', { name: '清晰度', exact: true })).toHaveValue('1080');
  await expect(output.getByLabel('输出宽度', { exact: true })).not.toBeVisible();
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720');
  await output.getByText('精确尺寸（高级）', { exact: true }).click();
  await expect(output.getByLabel('输出宽度', { exact: true })).toHaveValue('720');
  await expect(output.getByLabel('输出高度', { exact: true })).toHaveValue('960');
  await expect(output.getByLabel('页面留白', { exact: true })).toHaveValue('48');
  await output.getByRole('combobox', { name: '画面比例', exact: true }).selectOption('16:9');
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('1080');
  await expect(output.getByLabel('输出宽度', { exact: true })).toHaveValue('1920');
  await expect(output.getByLabel('输出高度', { exact: true })).toHaveValue('1080');
  await expect(output.getByRole('combobox', { name: '清晰度', exact: true }).locator('option[value="1440"]')).toHaveAttribute('disabled', '');
});

test('restores the paged canvas when returning from continuous images', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
  await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('pages');
  await expect(output.getByRole('combobox', { name: '画面比例', exact: true })).toHaveValue('3:4');
  await output.getByText('精确尺寸（高级）', { exact: true }).click();
  await expect(output.getByLabel('输出高度', { exact: true })).toHaveValue('1440');
});

test('exports the chosen tab inside a synchronized reference without writing its preference', async ({ page }) => {
  const output = await open(page);
  const before = await page.evaluate(() => localStorage.getItem('mewiki:research-example-tab:ref-tabs'));
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await output.getByRole('button', { name: '清空选择', exact: true }).click();
  await output.getByLabel('导出此内容：5', { exact: true }).check();
  await output.getByRole('tab', { name: '引用乙', exact: true }).click();
  const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  expect((await submitted).postDataJSON().document.text).toContain('引用第二组内容');
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-example-tab:ref-tabs'))).toBe(before);
});

test('locks source content interaction while an image job is running', async ({ page }) => {
  const output = await open(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await output.route('**/api/mewiki/publications/jobs', async route => { if (route.request().method() === 'POST') await gate; await route.continue(); });
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  try {
    await expect(output.locator('.mewiki-publication-source-paper')).toHaveAttribute('inert', '');
    await expect(output.getByLabel('导出此内容：2', { exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(output.getByRole('button', { name: '取消导出', exact: true })).toHaveCount(0);
});

test('keeps a PDF page chosen in the source view for the actual export', async ({ page }) => {
  let output = await open(page);
  await output.close();
  await page.evaluate(assetId => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [{ id: 'pdf-page', type: 'media', kind: 'pdf', source: { type: 'asset', assetId }, alt: '样板 PDF', document: { page: 1 } }];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  }, assets['showcase-document.pdf'].id);
  await page.reload();
  const before = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  const popup = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  output = await popup;
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await output.getByRole('button', { name: 'PDF 下一页', exact: true }).click();
  await expect(output.getByLabel('PDF 页码', { exact: true })).toHaveValue('2');
  await output.getByRole('tab', { name: '样式预览', exact: true }).click();
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await expect(output.getByLabel('PDF 页码', { exact: true })).toHaveValue('2');
  const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  expect((await submitted).postDataJSON().document.blocks[0].content).toContain('样板 PDF · 第 2 页');
  await expect(output.getByAltText('导出预览第 1 页', { exact: true }).or(output.getByRole('alert').first())).toBeVisible({ timeout: 90000 });
  await expect(output.getByRole('alert')).toHaveCount(0);
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(before);
});

test('selects full rendered source blocks in the middle, with breaks and tabs, without writing the note', async ({ page }) => {
  const output = await open(page);
  const before = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  const source = output.getByRole('region', { name: '原文与内容选择', exact: true });
  await expect(source.locator('h2')).toContainText('完整原始标题');
  await expect(source.locator('strong').filter({ hasText: '完整加粗原文' })).toBeVisible();
  await expect(source.locator('.research-callout-border rect')).toHaveAttribute('stroke-dasharray', '7 3 1 3');
  await expect(output.locator('.mewiki-publication-controls-pane .mewiki-publication-blocks')).toHaveCount(0);
  await source.getByRole('button', { name: '清空选择', exact: true }).click();
  await source.getByLabel('导出此内容：2', { exact: true }).check();
  await source.getByLabel('导出此内容：4', { exact: true }).check();
  await source.getByLabel('在此内容前分页：4', { exact: true }).check();
  await source.getByRole('tab', { name: '第二组', exact: true }).click();
  await expect(source).toContainText('第二组需要导出的内容');
  const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  const request = (await submitted).postDataJSON();
  expect(request.document.blocks.map((block: { id: string }) => block.id)).toEqual(['paragraph:native', 'tabs:native']);
  expect(request.document.blocks[1].breakBefore).toBe(true);
  expect(request.document.text).toContain('第二组需要导出的内容');
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible();
  await expect(output.getByRole('tab', { name: '导出结果', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(before);
});

test('fits a continuous sample to its content and keeps sample frames script-free', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
  const frame = output.locator('iframe[title="样板内容预览"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  const sample = output.frameLocator('iframe[title="样板内容预览"]');
  await expect(sample.locator('.document-title')).toBeVisible();
  await expect.poll(async () => Number(await frame.getAttribute('height'))).toBeLessThan(3000);
  await expect(sample.locator('script')).toHaveCount(0);
  await expect(sample.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', /script-src 'none'/);
});

test('keeps sample and visual selection usable at phone width', async ({ page }) => {
  const output = await open(page);
  await output.setViewportSize({ width: 390, height: 844 });
  await expect(output.frameLocator('iframe[title="样板内容预览"]').locator('.document-title')).toBeVisible();
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await output.getByLabel('导出此内容：2', { exact: true }).uncheck();
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.screenshot({ path: test.info().outputPath('publication-source-phone.png'), fullPage: true });
});
