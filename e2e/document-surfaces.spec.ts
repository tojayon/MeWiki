import { expect, test, type Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { openNotebookMoreMenu, enableNotebookEditing, runNotebookAction } from './helpers/researchNotebook.ts';
import { publicationFonts, publicationHtml } from '../server/publicationHtml.ts';
import { publicationPagination } from '../server/publicationPagination.ts';
import { defaultPublicationOptions, type PublicationRequest } from '../src/domain/publicationTypes.ts';
import { defaultPublicationTexture } from '../src/domain/publicationTextures.ts';

const code = '// Clear on any background\nconst message = "Hello, MeWiki";\nconsole.log(message);';
test.beforeEach(async () => { await rm(process.env.MEWIKI_EXPORT_E2E_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(code => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'surfaces', title: '纹理上的清晰内容', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [
      { id: 'surface-table', type: 'markdown', kind: 'table', text: '| **内容** [链接](https://example.com) | 说明 |\n| --- | --- |\n| 表格正文 | 白色底层 |\n| 行内 `code` | 清晰阅读 |' },
      { id: 'surface-code', type: 'markdown', kind: 'code', text: '```javascript\n' + code + '\n```' },
      { id: 'surface-plain', type: 'markdown', kind: 'code', text: '```\nplain terminal output\n```' },
      { id: 'surface-quote', type: 'paragraph', text: '> 引用内容应该有独立底色。' },
      { id: 'surface-data', type: 'dataset', title: '数据表', columns: ['时间', '测量'], rows: [['0', '1'], ['1', '2']] },
      { id: 'surface-tabs', type: 'examples', title: '自定义配色', appearance: { borderColor: '#8a4119', backgroundColor: '#fff4e8', headerBackground: '#fae1c4', accentColor: '#9c4a07' }, tabs: [{ id: 'inside', title: '内嵌内容', blocks: [{ id: 'inside-code', type: 'markdown', kind: 'code', text: '```javascript\nconst nested = true;\n```' }] }] },
      { id: 'surface-dark-tabs', type: 'examples', title: '深色自定义配色', appearance: { borderColor: '#64748b', backgroundColor: '#172033', headerBackground: '#25364d', accentColor: '#b4d0ff' }, tabs: [{ id: 'dark', title: '深色内容', blocks: [
        { id: 'inside-dark-quote', type: 'paragraph', text: '> 深色引用内容，保留**重点**和[链接](https://example.com)。' },
        { id: 'inside-dark-table', type: 'markdown', kind: 'table', text: '| 内容 |\n| --- |\n| **深色标签页表格** [链接](https://example.com) |' },
      ] }] },
    ] }];
    state.activeNoteId = 'surfaces'; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
  }, code);
  await page.reload();
  return page.getByTestId('research-notebook');
}
async function open(page: Page) {
  const pending = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await pending;
  await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  return output;
}
async function inspect(page: Page, request: PublicationRequest) {
  const fonts = await publicationFonts();
  const css = await readFile(path.join(process.env.MEWIKI_PUBLICATION_BUILD || 'dist', 'mewiki-publication.css'), 'utf8');
  const output = await page.context().newPage();
  await output.setViewportSize({ width: request.options.width, height: request.options.height });
  await output.route('**/*', async route => {
    const font = fonts.assets.get(route.request().url());
    if (font) await route.fulfill({ contentType: font.endsWith('.woff2') ? 'font/woff2' : 'font/woff', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(font) });
    else await route.abort('blockedbyclient');
  });
  await output.setContent(await publicationHtml(request, fonts.css, css));
  await output.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
  return output;
}

test('keeps reading tables, data cells and quotations opaque above a patterned page', async ({ page }) => {
  const notebook = await seed(page);
  await page.addStyleTag({ content: '.research-notebook-editor { background: repeating-linear-gradient(45deg,#ffd6e0 0 12px,#d6efff 12px 24px) !important; }' });
  await expect(notebook.locator('[data-block-id="surface-table"] .research-markdown-table')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(notebook.locator('[data-block-id="surface-table"] td').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(notebook.locator('[data-block-id="surface-table"] .research-markdown-table')).toHaveCSS('border-top-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('[data-block-id="surface-table"] td').first()).toHaveCSS('border-bottom-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('[data-block-id="surface-table"] td').nth(1)).toHaveCSS('border-left-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('[data-block-id="surface-table"] th').first()).toHaveCSS('background-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('[data-block-id="surface-table"] th strong')).toHaveCSS('color', 'rgb(248, 251, 255)');
  await expect(notebook.locator('[data-block-id="surface-table"] th a')).toHaveCSS('color', 'rgb(197, 220, 255)');
  await notebook.locator('[data-block-id="surface-table"] th a').hover();
  await expect(notebook.locator('[data-block-id="surface-table"] th a')).toHaveCSS('color', 'rgb(197, 220, 255)');
  await expect(notebook.locator('.research-dataset-table-scroll')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(notebook.locator('.research-dataset-table-scroll td').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(notebook.locator('.research-dataset-table-scroll thead th').first()).toHaveCSS('background-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('.research-dataset-table-scroll thead th').first()).toHaveCSS('color', 'rgb(248, 251, 255)');
  await expect(notebook.locator('.research-dataset-table-scroll')).toHaveCSS('border-top-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('.research-dataset-table-scroll td').first()).toHaveCSS('border-right-color', 'rgb(23, 52, 84)');
  await expect(notebook.locator('[data-block-id="surface-quote"] blockquote')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(notebook.locator('[data-block-id="surface-tabs"] .research-examples')).toHaveCSS('background-color', 'rgb(255, 244, 232)');
  const dark = notebook.locator('[data-block-id="surface-dark-tabs"]');
  await expect(dark.locator('blockquote')).toHaveCSS('background-color', 'rgb(23, 32, 51)');
  await expect(dark.locator('blockquote strong')).toHaveCSS('color', 'rgb(241, 245, 251)');
  await expect(dark.locator('td a')).toHaveCSS('color', 'rgb(21, 71, 192)');
  await notebook.locator('[data-block-id="surface-table"]').screenshot({ path: test.info().outputPath('opaque-table.png') });
});

test('keeps header editing and keyboard navigation readable on both header and body surfaces', async ({ page }) => {
  const notebook = await seed(page);
  await enableNotebookEditing(notebook);
  const block = notebook.locator('[data-block-id="surface-table"]');
  await block.locator('th').first().click({ position: { x: 7, y: 7 } });
  const editor = block.getByRole('textbox', { name: '单元格内容', exact: true });
  await expect(block.locator('th[data-research-table-editing]')).toHaveCSS('background-color', 'rgb(23, 52, 84)');
  await expect(editor).toHaveCSS('color', 'rgb(248, 251, 255)');
  await expect(editor).toHaveCSS('caret-color', 'rgb(248, 251, 255)');
  await editor.fill('修改后的表头');
  await editor.press('Tab');
  await expect(block.locator('th').nth(1)).toHaveAttribute('data-research-table-editing', 'true');
  await expect(editor).toHaveCSS('color', 'rgb(248, 251, 255)');
  await editor.press('Tab');
  await expect(block.locator('td').first()).toHaveAttribute('data-research-table-editing', 'true');
  await expect(editor).toHaveCSS('color', 'rgb(37, 54, 77)');
  await expect(editor).toHaveCSS('caret-color', 'rgb(37, 54, 77)');
  await editor.fill('修改后的正文');
  await editor.press('Enter');
  await runNotebookAction(notebook, '切换为只读模式');
  await expect(block.locator('th').first()).toHaveText('修改后的表头');
  await expect(block.locator('td').first()).toHaveText('修改后的正文');
  await block.screenshot({ path: test.info().outputPath('header-edit-saved.png') });
});

test('uses a dark terminal for highlighted, plain and editable code while preserving copy text', async ({ page, context }) => {
  const notebook = await seed(page);
  const block = notebook.locator('[data-block-id="surface-code"]');
  await expect(block.locator('.research-markdown-code')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  await expect(block.locator('pre')).toHaveCSS('color', 'rgb(230, 237, 243)');
  await expect(block.locator('.research-code-toolbar')).toHaveCSS('background-color', 'rgb(22, 27, 34)');
  await expect(block.locator('.hljs-keyword')).toHaveCSS('color', 'rgb(255, 123, 114)');
  await expect(notebook.locator('[data-block-id="surface-plain"] pre')).toHaveCSS('color', 'rgb(230, 237, 243)');
  await expect(notebook.locator('[data-block-id="inside-code"] pre')).toHaveCSS('color', 'rgb(230, 237, 243)');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await block.getByRole('button', { name: '复制代码', exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n').trimEnd()).toBe(code);
  await block.screenshot({ path: test.info().outputPath('terminal-reading.png') });
  await enableNotebookEditing(notebook);
  await block.locator('pre').click();
  const editor = block.locator('textarea');
  await expect(editor).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  await expect(editor).toHaveCSS('color', 'rgb(230, 237, 243)');
  await page.setViewportSize({ width: 390, height: 844 });
  await runNotebookAction(notebook, '收起文章大纲');
  await runNotebookAction(notebook, '收起笔记左侧面板');
  await block.locator('pre').click();
  await editor.scrollIntoViewIfNeeded();
  await expect(editor).toBeInViewport();
  expect(await editor.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('terminal-editor-phone.png') });
});

test('keeps native sample and actual image surfaces solid with a visible texture', async ({ page }) => {
  await seed(page);
  const output = await open(page);
  // Keep the chart's 600px reading surface within the exported content width.
  await output.getByLabel('正文字号', { exact: true }).fill('20');
  await output.getByLabel('背景颜色', { exact: true }).fill('#d8e7f6');
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('grid');
  const sample = output.frameLocator('iframe[title="样板内容预览"]');
  await expect(sample.locator('td').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(sample.locator('th').first()).toHaveCSS('background-color', 'rgb(23, 52, 84)');
  await expect(sample.locator('pre').first()).toHaveCSS('background-color', 'rgb(13, 17, 23)');
  const pending = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  const request = (await pending).postDataJSON() as PublicationRequest;
  await expect(output.getByAltText('导出预览第 1 页', { exact: true }).or(output.getByRole('alert'))).toBeVisible({ timeout: 90000 });
  await expect(output.getByRole('alert')).toHaveCount(0);
  const rendered = await inspect(page, request);
  const dark = rendered.locator('.page-body .research-examples').filter({ hasText: '深色引用内容' });
  await expect(dark.locator('blockquote')).toHaveCSS('background-color', 'rgb(23, 32, 51)');
  await expect(dark.locator('blockquote strong')).toHaveCSS('color', 'rgb(241, 245, 251)');
  await expect(dark.locator('td a')).toHaveCSS('color', 'rgb(21, 71, 192)');
  for (const [selector, color] of [['.research-markdown td', [255, 255, 255]], ['.research-markdown th', [23, 52, 84]], ['.research-markdown-code pre', [13, 17, 23]]] as const) {
    const point = await rendered.locator('.page-body ' + selector).first().evaluate(element => {
      const rect = element.getBoundingClientRect(), owner = element.closest('.publication-page')!, parent = owner.getBoundingClientRect();
      return { page: [...document.querySelectorAll('.publication-page')].indexOf(owner) + 1, x: Math.floor(rect.right - parent.left - 12), y: Math.floor(rect.top - parent.top + rect.height / 2) };
    });
    const dataUrl = await output.getByAltText(`导出预览第 ${point.page} 页`, { exact: true }).getAttribute('src');
    const pixel = await sharp(Buffer.from(dataUrl!.split(',')[1], 'base64')).extract({ left: point.x, top: point.y, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixel]).toEqual(color);
  }
  await rendered.screenshot({ path: test.info().outputPath('native-solid-surfaces.png'), fullPage: true });
  await rendered.close();
});

test('preserves dark code and opaque tables on every parameter-template page fragment', async ({ page }) => {
  const table = '| **项目** | [说明](https://example.com) |\n| --- | --- |\n' + Array.from({ length: 18 }, (_, index) => `| 第 ${index} 行 | **重点** [链接](https://example.com) |`).join('\n');
  const lines = Array.from({ length: 25 }, (_, index) => `const value${index} = "MeWiki";`);
  const request: PublicationRequest = { document: { title: '跨页内容', text: '', blocks: [{ id: 'table', kind: 'markdown', content: table }, { id: 'quote', kind: 'markdown', content: '> ## 引用标题\n>\n> 普通引用**重点**与[链接](https://example.com)。' }, { id: 'code', kind: 'markdown', content: '```javascript\n' + lines.join('\n') + '\n```' }] }, options: { ...defaultPublicationOptions(), width: 600, height: 800, margin: 40, fontSize: 24, background: '#172033', textColor: '#f1f5fb', headingColor: '#f1f5fb', accentColor: '#b4d0ff', texture: defaultPublicationTexture('grid') } };
  const rendered = await inspect(page, request);
  expect(await rendered.locator('.publication-page').count()).toBeGreaterThan(2);
  for (const table of await rendered.locator('.page-body table').all()) await expect(table).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (const head of await rendered.locator('.page-body thead th').all()) { await expect(head).toHaveCSS('background-color', 'rgb(23, 52, 84)'); await expect(head).toHaveCSS('color', 'rgb(248, 251, 255)'); }
  await expect(rendered.locator('.page-body td').first()).toHaveCSS('border-bottom-color', 'rgb(23, 52, 84)');
  await expect(rendered.locator('.page-body th strong').first()).toHaveCSS('color', 'rgb(248, 251, 255)');
  await expect(rendered.locator('.page-body th .document-link').first()).toHaveCSS('color', 'rgb(197, 220, 255)');
  await expect(rendered.locator('.page-body td strong').first()).toHaveCSS('color', 'rgb(37, 54, 77)');
  await expect(rendered.locator('.page-body td .document-link').first()).toHaveCSS('color', 'rgb(21, 71, 192)');
  await expect(rendered.locator('.page-body blockquote strong')).toHaveCSS('color', 'rgb(69, 86, 110)');
  await expect(rendered.locator('.page-body blockquote h2')).toHaveCSS('color', 'rgb(69, 86, 110)');
  for (const pre of await rendered.locator('.page-body pre').all()) { await expect(pre).toHaveCSS('background-color', 'rgb(13, 17, 23)'); await expect(pre).toHaveCSS('color', 'rgb(230, 237, 243)'); }
  expect((await rendered.locator('.page-body pre').allTextContents()).join('\n')).toBe(lines.join('\n'));
  expect(await rendered.locator('.page-body pre .hljs-keyword').count()).toBe(lines.length);
  await rendered.screenshot({ path: test.info().outputPath('parameter-solid-pages.png'), fullPage: true });
  await rendered.close();
});
