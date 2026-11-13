import { expect, test, type Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assets from '../docs/wiki/assets/manifest.json' with { type: 'json' };
import { enableNotebookEditing, openNotebookMoreMenu } from './helpers/researchNotebook.ts';
import { publicationHtml, publicationFonts } from '../server/publicationHtml.ts';
import { publicationPagination } from '../server/publicationPagination.ts';
import type { PublicationRequest } from '../src/domain/publicationTypes.ts';

test.beforeEach(async () => { await rm(process.env.MEWIKI_EXPORT_E2E_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });
async function fixture(page: Page, media = false, long = false) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(({ assets, media, long }) => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    const mediaBlocks = ['audio', 'video', 'pdf', 'file'].map((kind, index) => ({ id: `media-${kind}`, type: 'media', kind,
      source: { type: 'asset', assetId: assets[['showcase-audio.wav', 'showcase-video.webm', 'showcase-document.pdf', 'showcase-data.csv'][index] as keyof typeof assets].id }, alt: `${kind} 演示原件`, caption: `${kind} 说明`, ...(kind === 'pdf' ? { document: { page: 1 } } : {}), ...(kind === 'video' ? { poster: { type: 'asset', assetId: assets['showcase-image.png'].id } } : {}) }));
    const note = { id: 'native-parity', title: '原生内容一致性', library: 'research', createdAt: '2026-11-11', updatedAt: '2026-11-11', blocks: [
      { id: 'heading-a', type: 'heading', level: 2, text: '标题与引用' },
      { id: 'links', type: 'paragraph', text: `[来源](#research-note/reference) 和 [PDF 文件](webbench-asset:${assets['showcase-document.pdf'].id}#page=2)` },
      { id: 'footnotes', type: 'paragraph', text: '带有脚注的说明[^one]。\n\n[^one]: 保留脚注分隔线与字号。' },
      { id: 'math-shapes', type: 'paragraph', text: '$\\sqrt{\\frac{x+1}{y}}$ 与 $\\xrightarrow{推导}$、$\\widehat{ABC}$、$\\left[\\begin{array}{c|c}a&b\\\\c&d\\end{array}\\right]$。' },
      { id: 'heading-b', type: 'heading', level: 3, text: '嵌套标题' },
      { id: 'callout', type: 'callout', title: '重要结论', text: long ? '保留 Callout 样式与连续内容。'.repeat(150) : '**加粗正文**与自定义标签。', appearance: { labelBackground: '#9c4a07', labelColor: '#ffffff', borderColor: '#c46221', borderStyle: 'dashdot', borderWidth: 2 } },
      { id: 'tabs', type: 'examples', title: '方案比较', labelPosition: 'right', appearance: { borderColor: '#8a4119', backgroundColor: '#fff4e8', headerBackground: '#fae1c4', accentColor: '#9c4a07' }, tabs: [
        { id: 'a', title: '方案甲', blocks: [{ id: 'a-text', type: 'paragraph', text: '第一页私有内容' }] },
        { id: 'b', title: '方案乙', blocks: [{ id: 'b-text', type: 'paragraph', text: '当前标签页内容' }] },
      ] },
      ...(media ? mediaBlocks : []),
    ] };
    state.notes = [note, { ...note, id: 'reference', title: '当前引用标题', blocks: [] }];
    state.activeNoteId = note.id; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-example-tab:tabs', 'b');
  }, { assets, media, long });
  await page.reload();
}
async function launch(page: Page) {
  const opened = page.waitForEvent('popup', { timeout: 10000 });
  const menu = await openNotebookMoreMenu(page.getByTestId('research-notebook'));
  await menu.getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const exportPage = await opened;
  await expect(exportPage.getByTestId('mewiki-publication-page')).toBeVisible();
  return exportPage;
}
async function generate(page: Page): Promise<PublicationRequest> {
  const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'), { timeout: 35000 });
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  const request = await Promise.race([
    submitted,
    page.getByRole('alert').first().waitFor({ state: 'visible', timeout: 35000 }).then(async () => { throw new Error(await page.getByRole('alert').first().innerText()); }),
    page.waitForEvent('pageerror', { timeout: 35000 }).then(error => { throw error; }),
  ]);
  await expect(page.getByAltText('导出预览第 1 页', { exact: true }).or(page.getByRole('alert').first())).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  return request.postDataJSON();
}
async function rendered(page: Page, request: PublicationRequest) {
  const css = await readFile(path.join(process.env.MEWIKI_PUBLICATION_BUILD || 'dist', 'mewiki-publication.css'), 'utf8');
  const fonts = await publicationFonts();
  const output = await page.context().newPage();
  await output.setViewportSize({ width: request.options.width, height: Math.min(request.options.height, 1440) });
  await output.route('**/*', async route => {
    const font = fonts.assets.get(route.request().url());
    if (font && route.request().resourceType() === 'font') await route.fulfill({ status: 200, contentType: font.endsWith('.woff2') ? 'font/woff2' : 'font/woff', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(font) });
    else await route.abort('blockedbyclient');
  });
  await output.setContent(await publicationHtml(request, fonts.css, css));
  await output.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
  return output;
}
test('preserves numbered headings, bold file icons, custom callouts and the selected tab from the actual page', async ({ page }) => {
  await fixture(page);
  const before = await page.locator('[data-block-id="heading-a"] h2').evaluate(element => ({ size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight, color: getComputedStyle(element).color }));
  const fileBefore = await page.locator('[data-block-id="links"] a').last().evaluate(element => ({ text: element.textContent, weight: getComputedStyle(element).fontWeight, color: getComputedStyle(element).color }));
  const mathBefore = await page.locator('[data-block-id="math-shapes"]').evaluate(element => ({
    aspect: [...element.querySelectorAll('svg')].map(svg => svg.getAttribute('preserveAspectRatio')),
    lines: [...element.querySelectorAll<HTMLElement>('.frac-line')].map(line => [line.style.borderBottomWidth, getComputedStyle(line).fontSize]),
    rules: [...element.querySelectorAll<HTMLElement>('[style]')].filter(part => part.style.borderRightStyle).map(part => [getComputedStyle(part).borderRightStyle, part.style.borderRightWidth]),
  }));
  const exportPage = await launch(page);
  const request = await generate(exportPage);
  expect(request.document.blocks.every(block => block.kind === 'native')).toBe(true);
  const output = await rendered(page, request);
  await expect(output.locator('.research-heading-number')).toHaveText(['1.', '1.1.']);
  const heading = output.locator('.is-heading h2');
  await expect(heading).toHaveCSS('font-size', before.size);
  await expect(heading).toHaveCSS('font-weight', before.weight);
  await expect(heading).toHaveCSS('color', before.color);
  await expect(output.locator('.research-note-link')).toHaveCSS('font-weight', '700');
  await expect(output.locator('.research-note-link > svg')).toHaveCount(1);
  const file = output.getByTitle('阅读 PDF 第 2 页', { exact: true });
  await expect(file).toHaveText(fileBefore.text!);
  await expect(file).toHaveCSS('font-weight', fileBefore.weight);
  await expect(file).toHaveCSS('color', fileBefore.color);
  await expect(output.locator('[data-footnotes]')).toHaveCSS('border-top-style', 'dashed');
  await expect(output.locator('[data-footnotes] h2')).toHaveCSS('font-size', '14px');
  expect(await output.locator('.katex svg').evaluateAll(elements => elements.map(svg => svg.getAttribute('preserveAspectRatio')))).toEqual(mathBefore.aspect);
  expect(await output.locator('.katex .frac-line').evaluateAll(elements => elements.map(line => [(line as HTMLElement).style.borderBottomWidth, getComputedStyle(line).fontSize]))).toEqual(mathBefore.lines);
  expect(await output.locator('.katex [style]').evaluateAll(elements => elements.filter(part => (part as HTMLElement).style.borderRightStyle).map(part => [getComputedStyle(part).borderRightStyle, (part as HTMLElement).style.borderRightWidth]))).toEqual(mathBefore.rules);
  await expect(output.locator('.research-callout-label')).toHaveCSS('background-color', 'rgb(156, 74, 7)');
  await expect(output.locator('.research-callout-border rect')).toHaveAttribute('stroke-dasharray', '14 6 2 6');
  await expect(output.locator('.research-examples')).toHaveCSS('background-color', 'rgb(255, 244, 232)');
  await expect(output.locator('.research-examples-label')).toHaveAttribute('data-label-position', 'right');
  await expect(output.locator('.research-example-body')).toContainText('当前标签页内容');
  await expect(output.locator('.research-example-body')).not.toContainText('第一页私有内容');
  await output.screenshot({ path: test.info().outputPath('native-rich-parity.png'), fullPage: true });
  await output.close();
});
test('keeps audio, video, current PDF page and attachment cards as static media previews', async ({ page }) => {
  await fixture(page, true);
  await page.getByRole('button', { name: 'PDF 下一页', exact: true }).click();
  await expect(page.getByLabel('PDF 页码', { exact: true })).toHaveValue('2');
  const original = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  await expect(page.locator('video')).toHaveAttribute('poster', /^(blob:|http)/);
  const poster = await page.locator('video').evaluate(async video => {
    const image = new Image(); image.src = (video as HTMLVideoElement).poster; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0); return canvas.toDataURL('image/png');
  });
  const exportPage = await launch(page);
  const request = await generate(exportPage);
  const output = await rendered(page, request);
  await expect(output.locator('.research-media-player[data-player-kind="audio"]')).toContainText('audio 演示原件');
  await expect(output.locator('audio')).toHaveAttribute('controls', '');
  await expect(output.locator('video')).toHaveAttribute('poster', poster);
  await expect(output.locator('.research-pdf-sheet img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(output.locator('.research-pdf-sheet img')).toHaveAttribute('alt', /第 2 页/);
  expect(await output.locator('.research-pdf-sheet img').evaluate(image => (image as HTMLImageElement).naturalWidth >= image.getBoundingClientRect().width - 1)).toBe(true);
  await expect(output.locator('.research-attachment-card')).toContainText('file 演示原件');
  await expect(output.getByRole('button', { name: 'PDF 下一页', exact: true })).toBeDisabled();
  await expect(output.getByRole('button', { name: 'PDF 上一页', exact: true })).toBeEnabled();
  await expect(output.locator('a[href],video[src],audio[src]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(original);
  await output.screenshot({ path: test.info().outputPath('native-media-parity.png'), fullPage: true });
  await output.close();
});

test('centers read-only content without reserving hidden editor action space', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    const note = state.notes[0];
    note.blocks.push({ id: 'center-formula', type: 'formula', tex: 'E=mc^2' });
    const tabs = note.blocks.find((block: { id: string }) => block.id === 'tabs');
    tabs.tabs[1].blocks = [{ id: 'nested-callout', type: 'callout', title: '嵌套提示', text: '嵌套内容两侧均匀。', appearance: note.blocks.find((block: { id: string }) => block.id === 'callout').appearance }];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const notebook = page.getByTestId('research-notebook');
  const readingBlocks = notebook.locator('.research-notebook-editor.is-readonly .research-note-blocks');
  await expect(readingBlocks.first()).toHaveCSS('margin-left', '0px');
  for (const block of await notebook.locator('.research-notebook-editor.is-readonly .research-note-block').all()) {
    expect(await block.evaluate(element => getComputedStyle(element).paddingLeft === getComputedStyle(element).paddingRight)).toBe(true);
  }
  const exportPage = await launch(page);
  const request = await generate(exportPage);
  const output = await rendered(page, request);
  for (const selector of ['.publication-dom > .is-callout > .research-callout', '.publication-dom > .is-examples > .research-examples', '.publication-dom > .is-formula > .research-formula-composer']) {
    const imbalance = await output.locator(selector).evaluate(element => {
      const content = element.getBoundingClientRect(), body = element.closest('.page-body')!.getBoundingClientRect();
      return Math.abs((content.left - body.left) - (body.right - content.right));
    });
    expect(imbalance).toBeLessThan(1);
  }
  await expect(output.locator('.research-example-body > .research-note-blocks')).toHaveCSS('margin-left', '0px');
  await output.screenshot({ path: test.info().outputPath('native-centered-content.png'), fullPage: true });
  await output.close();
  await enableNotebookEditing(notebook);
  const editable = notebook.locator('[data-block-id="callout"]');
  await expect(editable).toHaveCSS('padding-right', '28px');
  await editable.hover();
  await expect(editable.getByRole('button', { name: 'Callout 设置', exact: true })).toBeVisible();
});

test('keeps insertion controls inside empty notes and empty tabs', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [{ id: 'empty-tabs', type: 'examples', title: '空标签页', tabs: [{ id: 'empty', title: '空页', blocks: [] }] }];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const notebook = page.getByTestId('research-notebook');
  await enableNotebookEditing(notebook);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    if (width < 720) {
      for (const name of ['收起文章大纲', '收起笔记左侧面板']) {
        const toggle = notebook.getByRole('button', { name, exact: true });
        if (await toggle.isVisible()) await toggle.click();
      }
    }
    const body = notebook.locator('.research-example-body');
    const insert = body.getByRole('button', { name: '在标签页中插入', exact: true });
    await insert.focus();
    await expect(async () => {
      const bounds = await insert.evaluate(element => ({
        area: element.closest('.research-example-body')!.getBoundingClientRect().toJSON(),
        button: element.getBoundingClientRect().toJSON(),
      }));
      expect(bounds.button.left).toBeGreaterThanOrEqual(bounds.area.left);
      expect(bounds.button.right).toBeLessThanOrEqual(bounds.area.right);
    }).toPass();
    await insert.click();
    await expect(page.getByRole('dialog', { name: '插入笔记内容', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  await expect(notebook.locator('.research-notebook-editor .research-note-blocks').first()).toHaveCSS('margin-left', '27px');
  const insert = notebook.getByRole('button', { name: '在笔记末尾插入', exact: true });
  await insert.focus();
  await expect(insert).toBeInViewport();
});

for (const start of [0, 7]) test(`continues ordered list numbers from ${start} across native page fragments`, async ({ page }) => {
  await fixture(page);
  const items = Array.from({ length: 12 }, (_, index) => `项${String(index + start).padStart(2, '0')}；`.repeat(30));
  await page.evaluate(({ items, start }) => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [{ id: 'numbered-list', type: 'paragraph', text: items.map((text, index) => `${index + start}. ${text}`).join('\n') }];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  }, { items, start });
  await page.reload();
  const exportPage = await launch(page);
  await exportPage.getByText('精确尺寸（高级）', { exact: true }).click();
  await exportPage.getByLabel('输出宽度', { exact: true }).fill('600');
  await exportPage.getByLabel('输出高度', { exact: true }).fill('800');
  await exportPage.getByLabel('正文字号', { exact: true }).fill('20');
  const request = await generate(exportPage);
  const output = await rendered(page, request);
  expect(await output.locator('.publication-page').count()).toBeGreaterThan(1);
  const fragments = await output.locator('ol > li').evaluateAll(elements => elements.map(element => ({
    text: element.textContent!, number: (element.parentElement as HTMLOListElement).start + [...element.parentElement!.children].indexOf(element),
  })));
  expect(fragments.map(item => item.text).join('')).toBe(items.join(''));
  for (const fragment of fragments) {
    const item = fragment.text.match(/项(\d{2})/);
    if (item) expect(fragment.number).toBe(Number(item[1]));
  }
  await output.close();
});

test('marks overflowing sources, keeps original selection numbers and locates nested content diagnostics', async ({ page }, testInfo) => {
  await fixture(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [
      { id: 'excluded', type: 'paragraph', text: '本次不导出的正文' },
      { id: 'normal', type: 'paragraph', text: '正常内容可以直接导出。' },
      { id: 'wide:code', type: 'paragraph', text: '```text\n' + 'WideContent'.repeat(160) + '\n```' },
      { id: 'tabs:source', type: 'examples', title: '表格页签', tabs: [{ id: 'tab', title: '超宽表格', blocks: [{ id: 'nested:table', type: 'paragraph', text: '| Heading |\n| --- |\n| ' + 'WideContent'.repeat(160) + ' |' }] }] },
    ];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const savedNote = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  const exportPage = await launch(page);
  await exportPage.getByRole('tab', { name: '选择内容', exact: true }).click();
  await exportPage.getByRole('checkbox', { name: '导出此内容：1', exact: true }).uncheck();
  const generateButton = exportPage.getByRole('button', { name: '生成预览', exact: true });
  await generateButton.click();
  await expect(exportPage.getByRole('alert')).toContainText(/超宽|超出/);
  await expect(exportPage.getByRole('tab', { name: '选择内容', exact: true })).toHaveAttribute('aria-selected', 'true');
  const marked = exportPage.locator('[data-publication-issue="true"]');
  await expect(marked).toHaveCount(2);
  await expect(exportPage.locator('[data-publication-block="wide:code"] .mewiki-publication-source-diagnostic')).toContainText('超宽');
  await expect(exportPage.locator('[data-publication-block="tabs:source"] .mewiki-publication-source-diagnostic')).toContainText('超宽');
  await expect(exportPage.getByRole('button', { name: '定位到第 3 项问题内容', exact: true })).toBeVisible();
  await exportPage.getByRole('button', { name: '定位到第 4 项问题内容', exact: true }).click();
  await expect(exportPage.locator('[data-publication-block="tabs:source"]')).toBeFocused();
  await exportPage.screenshot({ path: testInfo.outputPath('diagnostics-desktop.png') });
  await exportPage.setViewportSize({ width: 390, height: 844 });
  await exportPage.getByRole('button', { name: '定位到第 3 项问题内容', exact: true }).click();
  await expect(exportPage.locator('[data-publication-block="wide:code"]')).toBeFocused();
  expect(await exportPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await exportPage.screenshot({ path: testInfo.outputPath('diagnostics-mobile.png') });
  await exportPage.setViewportSize({ width: 1440, height: 960 });
  await exportPage.getByRole('checkbox', { name: '导出此内容：3', exact: true }).uncheck();
  await expect(marked).toHaveCount(0);
  await generateButton.click();
  await expect(marked).toHaveCount(1, { timeout: 30000 });
  await expect(marked).toHaveAttribute('data-publication-block', 'tabs:source');
  await exportPage.getByLabel('正文字号', { exact: true }).fill('28');
  await expect(marked).toHaveCount(0);
  await generateButton.click();
  await expect(marked).toHaveCount(1, { timeout: 30000 });
  await exportPage.getByRole('checkbox', { name: '导出此内容：4', exact: true }).uncheck();
  await generateButton.click();
  await expect(exportPage.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(exportPage.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(savedNote);
  await exportPage.close();
});

test('locates parameter-template page overflow in the English source view on a narrow screen', async ({ page }, testInfo) => {
  await fixture(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [
      { id: 'normal', type: 'paragraph', text: '正常正文' },
      { id: 'formula:source', type: 'formula', tex: 'x+'.repeat(100) + 'x' },
    ];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const exportPage = await launch(page);
  await exportPage.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  await page.evaluate(() => localStorage.setItem('mewiki:locale', 'en'));
  await expect(exportPage.getByRole('combobox', { name: 'Choose template', exact: true })).toHaveValue('system:clear');
  await exportPage.setViewportSize({ width: 390, height: 844 });
  await exportPage.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(exportPage.getByRole('alert')).toBeVisible({ timeout: 30000 });
  await expect(exportPage.getByRole('tab', { name: 'Select content', exact: true })).toHaveAttribute('aria-selected', 'true');
  const item = exportPage.locator('[data-publication-block="formula:source"]');
  await expect(item).toHaveAttribute('data-publication-issue', 'true');
  await expect(item.locator('.mewiki-publication-source-diagnostic')).toContainText('This content cannot fit on one page.');
  await exportPage.getByRole('button', { name: 'Go to problem item 2', exact: true }).click();
  await expect(item).toBeFocused();
  expect(await exportPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await exportPage.screenshot({ path: testInfo.outputPath('diagnostics-english-mobile.png') });
  await exportPage.close();
});

for (const kind of ['code', 'table']) test(`rejects horizontally clipped native ${kind} instead of exporting incomplete content`, async ({ page }) => {
  await fixture(page);
  await page.evaluate(kind => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes[0].blocks = [{ id: 'wide-content', type: 'paragraph', text: kind === 'code'
      ? '```text\n' + 'WideContent'.repeat(160) + '\n```'
      : '| Heading |\n| --- |\n| ' + 'WideContent'.repeat(160) + ' |' }];
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  }, kind);
  await page.reload();
  const exportPage = await launch(page);
  await exportPage.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(exportPage.getByRole('alert')).toContainText(/超宽|超出/);
  await expect(exportPage.getByAltText('导出预览第 1 页', { exact: true })).toHaveCount(0);
});
test('paginates long styled content without losing its container or changing the saved tab', async ({ page }) => {
  await fixture(page, false, true);
  const exportPage = await launch(page);
  await exportPage.getByText('精确尺寸（高级）', { exact: true }).click();
  await exportPage.getByLabel('输出高度', { exact: true }).fill('1000');
  await exportPage.getByRole('tab', { name: '选择内容', exact: true }).click();
  await exportPage.getByLabel('展开全部标签页（默认仅当前页签）', { exact: true }).check();
  const request = await generate(exportPage);
  const output = await rendered(page, request);
  expect(await output.locator('.publication-page').count()).toBeGreaterThan(2);
  const content = await output.locator('.research-callout-body').allTextContents();
  expect(content.join('')).toBe('保留 Callout 样式与连续内容。'.repeat(150));
  expect(await output.locator('.research-examples').count()).toBe(2);
  expect(await exportPage.evaluate(() => localStorage.getItem('mewiki:research-example-tab:tabs'))).toBe('b');
  await output.close();
});

test('exports the complete content showcase with readable diagrams, charts, formulas and local media', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.activeNoteId = 'mewiki-manual-21-content-showcase'; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
  });
  await page.reload();
  const exportPage = await launch(page);
  await exportPage.getByLabel('正文字号', { exact: true }).fill('20');
  const request = await generate(exportPage);
  const output = await rendered(page, request);
  await expect(output.locator('.research-diagram-preview img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(output.locator('img.research-drawing-surface')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(output.locator('img.research-dataset-chart')).toHaveCount(3);
  expect(await output.locator('.katex').count()).toBeGreaterThan(5);
  await expect(output.locator('.research-note-embed')).toContainText('同步引用');
  await expect(output.locator('.research-citation-block')).toContainText('虚构示例');
  await expect(output.locator('pre code')).toContainText('console.table');
  await expect(output.locator('a[href],script,iframe')).toHaveCount(0);
  expect(request.document.text).not.toContain('demo-001');
  await output.screenshot({ path: test.info().outputPath('native-showcase-parity.png'), fullPage: true });
  await output.close();
});
