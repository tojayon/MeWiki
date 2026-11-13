import { expect, test, type Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { runNotebookAction } from './helpers/researchNotebook.ts';
import { publicationFrameLayout, defaultPublicationFrame } from '../src/domain/publicationFrames.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';

const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/publication-images-e2e-settings.json');
test.beforeEach(async () => {
  expect(settings.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  await rm(settings, { force: true });
  await rm(settings + '.export-profiles', { force: true, recursive: true });
});
const colors = ['#ef2929', '#22bb55', '#2666ee'];
async function picture(color: string) { return sharp({ create: { width: 900, height: 300, channels: 3, background: color } }).png().toBuffer(); }
async function open(page: Page) {
  const fixtures = await Promise.all(colors.map(async (color, index) => { const buffer = await picture(color); return { id: createHash('sha256').update(buffer).digest('hex'), name: `笔记图片${index + 1}`, base64: buffer.toString('base64') }; }));
  await page.goto('/'); await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(async fixtures => {
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'image-export-note', title: '批量设备图示例', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [
      { id: 'intro', type: 'paragraph', text: `正文保留，代码中的图片不应被选择：\`![假图片](webbench-asset:${fixtures[0].id})\`` },
      { id: 'image', type: 'media', kind: 'image', source: { type: 'asset', assetId: fixtures[0].id }, alt: fixtures[0].name },
      { id: 'md', type: 'markdown', kind: 'markdown', text: `![${fixtures[1].name}](webbench-asset:${fixtures[1].id})` },
      { id: 'tabs', type: 'examples', title: '标签页', tabs: [{ id: 'other', title: '隐藏标签页', blocks: [{ id: 'inside', type: 'media', kind: 'image', source: { type: 'asset', assetId: fixtures[2].id }, alt: fixtures[2].name }] }] },
    ] }];
    state.activeNoteId = 'image-export-note'; state.view = 'notes'; localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('mewiki-research-media', 1); request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'asset.id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('assets', 'readwrite');
      fixtures.forEach(item => { const bytes = Uint8Array.from(atob(item.base64), ch => ch.charCodeAt(0)); const blob = new Blob([bytes], { type: 'image/png' }); transaction.objectStore('assets').put({ asset: { id: item.id, name: item.name + '.png', size: blob.size, mimeType: 'image/png', sha256: item.id, createdAt: '2026-11-12', width: 900, height: 300 }, blob }); });
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    }); db.close();
  }, fixtures);
  await page.reload(); const popup = page.waitForEvent('popup'); await runNotebookAction(page.getByTestId('research-notebook'), '社交图文导出');
  const output = await popup; await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  await output.getByRole('combobox', { name: '工作模式', exact: true }).selectOption('images');
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720');
  return output;
}
async function add(output: Page, files: { name: string; buffer: Buffer }[]) {
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  await output.getByLabel('添加本地图片', { exact: true }).setInputFiles(files.map(file => ({ ...file, mimeType: 'image/png' })));
}
async function generated(output: Page, count: number) {
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.locator('.mewiki-publication-preview figure')).toHaveCount(count, { timeout: 60000 });
  await expect(output.getByRole('button', { name: '下载全部图片 ZIP', exact: true })).toBeEnabled();
}
async function resultBytes(output: Page, index: number) {
  const url = await output.locator('.mewiki-publication-preview figure > img').nth(index).getAttribute('src');
  return Buffer.from(url!.slice(url!.indexOf(',') + 1), 'base64');
}
async function pixel(buffer: Buffer, x: number, y: number) { const { data } = await sharp(buffer).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return [...data]; }
async function assetCount(page: Page) { return page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('mewiki-research-media', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const count = await new Promise<number>((resolve, reject) => { const request = db.transaction('assets', 'readonly').objectStore('assets').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); return count;
}); }

test('previews a local sample, batch exports uploaded images with one device template and downloads a named ZIP', async ({ page }) => {
  const output = await open(page), original = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook')), assets = await assetCount(page);
  let jobs = 0; output.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/publications/jobs')) jobs++; });
  await expect(output.getByText('示例图片（不参与导出）', { exact: true })).toBeVisible();
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeDisabled();
  await expect.poll(() => output.frameLocator('iframe[title="图片效果预览"]').locator('img').count()).toBe(1);
  expect(jobs).toBe(0);
  for (const label of ['导出标题', '正文字号', '正文行距', '页面留白', '本地字体', '显示页码', '单独生成封面']) await expect(output.getByLabel(label, { exact: true })).toHaveCount(0);
  await output.getByRole('button', { name: '导出说明', exact: true }).click();
  await expect(output.getByRole('tooltip')).toContainText('不包含本批主图、文案或逐图调整');
  await expect(output.getByRole('tooltip')).toContainText('首次手动保存后自动记录修改');
  await output.keyboard.press('Escape');
  await output.getByRole('combobox', { name: '设备边框', exact: true }).selectOption('phone');
  await expect(output.getByLabel('屏幕内容缩放', { exact: true })).toHaveCount(0);
  await add(output, await Promise.all(colors.map(async (color, index) => ({ name: `产品${index + 1}.png`, buffer: await picture(color) }))));
  await expect(output.getByRole('checkbox', { name: /^导出图片：产品/ })).toHaveCount(3);
  const thumbnail = output.locator('.mewiki-publication-image-card').filter({ has: output.getByRole('checkbox', { name: '导出图片：产品1.png', exact: true }) }).locator('img');
  await expect(thumbnail).toBeVisible(); await expect.poll(() => thumbnail.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(240);
  await output.getByRole('tab', { name: '画布编辑', exact: true }).click();
  await expect.poll(() => output.frameLocator('iframe[title="图片效果预览"]').locator('img').getAttribute('src')).toContain('data:image/png');
  await generated(output, 3);
  for (let index = 0; index < 3; index++) {
    const buffer = await resultBytes(output, index);
    expect(await sharp(buffer).metadata()).toMatchObject({ width: 720, height: 960 });
    expect(await pixel(buffer, 360, 480)).toEqual(index === 0 ? [239, 41, 41] : index === 1 ? [34, 187, 85] : [38, 102, 238]);
    if (!index) await sharp(buffer).toFile(test.info().outputPath('uploaded-phone-contain.png'));
  }
  const downloading = output.waitForEvent('download'); await output.getByRole('button', { name: '下载全部图片 ZIP', exact: true }).click();
  const archive = unzipSync(await readFile((await (await downloading).path())!));
  expect(Object.keys(archive)).toEqual(['001-产品1.png', '002-产品2.png', '003-产品3.png']);
  const single = output.waitForEvent('download'); await output.getByRole('button', { name: '下载第 2 张图片', exact: true }).click();
  expect((await single).suggestedFilename()).toBe('002-产品2.png');
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(original); expect(await assetCount(page)).toBe(assets);
  await output.screenshot({ path: test.info().outputPath('image-batch-result.png') });
});

test('selects image blocks, Markdown and hidden tabs from the frozen note without copying other content', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  await expect(output.locator('.mewiki-publication-image-card')).toHaveCount(3);
  const noteThumbnail = output.locator('.mewiki-publication-image-card').first().locator('img');
  await expect(noteThumbnail).toBeVisible(); await expect.poll(() => noteThumbnail.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(900);
  await noteThumbnail.evaluate(image => (image as HTMLImageElement).decode());
  const thumbnailPixels = await noteThumbnail.screenshot(), thumbnailSize = await sharp(thumbnailPixels).metadata();
  expect(await pixel(thumbnailPixels, thumbnailSize.width! / 2, thumbnailSize.height! / 2)).toEqual([239, 41, 41]);
  await output.getByRole('checkbox', { name: '全选图片', exact: true }).check();
  await expect(output.getByRole('checkbox', { name: /^导出图片：笔记图片/ })).toHaveCount(3);
  await output.getByRole('combobox', { name: '设备边框', exact: true }).selectOption('browser');
  await generated(output, 3);
  for (let index = 0; index < 3; index++) expect(await pixel(await resultBytes(output, index), 360, 480)).toEqual(index === 0 ? [239, 41, 41] : index === 1 ? [34, 187, 85] : [38, 102, 238]);
});

test('keeps crops per picture, uses the same crop in final pixels and saves only shared style in templates', async ({ page }) => {
  const output = await open(page);
  const strip = await sharp({ create: { width: 900, height: 300, channels: 3, background: colors[1] } }).composite([
    { input: await sharp({ create: { width: 300, height: 300, channels: 3, background: colors[0] } }).png().toBuffer(), left: 0, top: 0 },
    { input: await sharp({ create: { width: 300, height: 300, channels: 3, background: colors[2] } }).png().toBuffer(), left: 600, top: 0 },
  ]).png().toBuffer();
  await output.getByRole('combobox', { name: '设备边框', exact: true }).selectOption('phone');
  await output.getByRole('combobox', { name: '图片适配', exact: true }).selectOption('cover');
  await add(output, [{ name: '左侧.png', buffer: strip }, { name: '右侧.png', buffer: strip }]);
  await output.getByRole('button', { name: '切换主图取景', exact: true }).click();
  await output.getByLabel('水平位置', { exact: true }).fill('0');
  const cropArea = await output.getByRole('group', { name: '图片取景', exact: true }).boundingBox();
  await output.mouse.move(cropArea!.x + cropArea!.width / 2, cropArea!.y + cropArea!.height / 2); await output.mouse.down(); await output.mouse.move(cropArea!.x + cropArea!.width / 2 - 60, cropArea!.y + cropArea!.height / 2, { steps: 3 }); await output.mouse.up();
  expect(Number(await output.getByLabel('水平位置', { exact: true }).inputValue())).toBeGreaterThan(0);
  await output.getByLabel('水平位置', { exact: true }).fill('0');
  await output.getByRole('button', { name: '下一张图片', exact: true }).click();
  await output.getByLabel('水平位置', { exact: true }).fill('100'); await output.getByLabel('图片缩放', { exact: true }).fill('130');
  await output.getByRole('button', { name: '上一张图片', exact: true }).click();
  await expect(output.getByLabel('水平位置', { exact: true })).toHaveValue('0'); await expect(output.getByLabel('图片缩放', { exact: true })).toHaveValue('100');
  await output.getByRole('group', { name: '图片取景', exact: true }).press('ArrowLeft');
  await expect(output.getByLabel('水平位置', { exact: true })).toHaveValue('1');
  await output.getByRole('button', { name: '重置当前图片取景', exact: true }).click(); await expect(output.getByLabel('水平位置', { exact: true })).toHaveValue('50');
  await output.getByLabel('水平位置', { exact: true }).fill('0');
  await generated(output, 2);
  expect(await pixel(await resultBytes(output, 0), 360, 480)).toEqual([239, 41, 41]);
  expect(await pixel(await resultBytes(output, 1), 360, 480)).toEqual([38, 102, 238]);
  await sharp(await resultBytes(output, 1)).toFile(test.info().outputPath('phone-cover-crop.png'));
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill('批量手机图'); await output.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '个人模板已保存。' })).toBeVisible();
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); const downloading = output.waitForEvent('download'); await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const template = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(template.profile.options).toMatchObject({ imageMode: { fit: 'cover' }, frame: { id: 'phone' } });
  expect(JSON.stringify(template)).not.toMatch(/data:image|blocks|crop|左侧|右侧/);
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:mewiki'); await expect(output.getByRole('combobox', { name: '工作模式', exact: true })).toHaveValue('images');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption({ label: '批量手机图' }); await expect(output.getByRole('combobox', { name: '图片适配', exact: true })).toHaveValue('cover');
  await output.setViewportSize({ width: 390, height: 844 }); await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  await expect(output.getByLabel('添加本地图片', { exact: true })).toHaveCount(1);
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.getByRole('region', { name: '图片相册', exact: true }).focus(); await output.keyboard.press('Home');
  const mobileThumbnail = output.locator('.mewiki-publication-image-card').first().locator('img');
  await expect(mobileThumbnail).toBeVisible(); await expect.poll(() => mobileThumbnail.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(900);
  await mobileThumbnail.evaluate(image => (image as HTMLImageElement).decode());
  await output.screenshot({ path: test.info().outputPath('image-batch-mobile.png'), fullPage: true });
});

test('reports batch limits and an invalid canvas specifically, and cancels a pending batch', async ({ page }) => {
  const output = await open(page), buffer = await picture(colors[0]);
  await add(output, Array.from({ length: 51 }, (_, i) => ({ name: `图片${i}.png`, buffer })));
  await expect(output.getByRole('alert')).toContainText('50 张');
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeDisabled();
  await add(output, [{ name: '正常.png', buffer }]);
  await output.getByText('精确尺寸（高级）', { exact: true }).click(); await output.getByLabel('输出宽度', { exact: true }).fill('479');
  await output.getByRole('button', { name: '生成预览', exact: true }).click(); await expect(output.getByRole('alert').filter({ hasText: '画幅 → 输出宽度' })).toBeVisible();
  await output.getByLabel('输出宽度', { exact: true }).fill('720');
  const id = '11111111-1111-4111-8111-111111111111'; let created = 0, deleted = false;
  await output.route('**/api/mewiki/publications/jobs**', async route => {
    const method = route.request().method(); if (method === 'POST') created++; if (method === 'DELETE') deleted = true;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id, status: 'running', completed: 0, total: 1 }) });
  });
  await output.getByRole('button', { name: '生成预览', exact: true }).click(); await expect(output.getByRole('button', { name: '取消导出', exact: true })).toBeVisible();
  await expect.poll(() => created).toBe(1); await output.getByRole('button', { name: '取消导出', exact: true }).click();
  await expect.poll(() => deleted).toBe(true); await expect(output.getByRole('alert').filter({ hasText: '导出已取消。' })).toBeVisible();
  await expect(output.getByRole('button', { name: '下载全部图片 ZIP', exact: true })).toBeDisabled(); expect(created).toBe(1);
});

test('automatically splits large sources into sequential jobs while keeping the whole batch and JPEG settings', async ({ page }) => {
  const output = await open(page);
  const large = await sharp(randomBytes(1700 * 1600 * 3), { raw: { width: 1700, height: 1600, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  expect(large.length).toBeLessThan(8 * 1024 * 1024);
  const groups: { count: number; format: string; background: string }[] = [];
  output.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/publications/jobs')) { const input = request.postDataJSON(); groups.push({ count: input.document.blocks.length, format: input.options.format, background: input.options.background.toLowerCase() }); } });
  await output.getByRole('combobox', { name: '图片格式', exact: true }).selectOption('jpeg');
  await add(output, Array.from({ length: 3 }, (_, i) => ({ name: `大图${i + 1}.png`, buffer: large })));
  await generated(output, 3);
  expect(groups).toEqual([{ count: 2, format: 'jpeg', background: '#ffffff' }, { count: 1, format: 'jpeg', background: '#ffffff' }]);
  for (let index = 0; index < 3; index++) expect(await sharp(await resultBytes(output, index)).metadata()).toMatchObject({ format: 'jpeg', width: 720, height: 960 });
  const downloading = output.waitForEvent('download'); await output.getByRole('button', { name: '下载全部图片 ZIP', exact: true }).click();
  expect(Object.keys(unzipSync(await readFile((await (await downloading).path())!)))).toEqual(['001-大图1.jpg', '002-大图2.jpg', '003-大图3.jpg']);
});

test('converts WebP locally and reuses an image template with a new selection after reopening', async ({ page }) => {
  const output = await open(page);
  const webp = await sharp(await picture(colors[0])).webp({ lossless: true }).toBuffer();
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  await output.getByLabel('添加本地图片', { exact: true }).setInputFiles({ name: '演示.webp', mimeType: 'image/webp', buffer: webp });
  await generated(output, 1); expect(await pixel(await resultBytes(output, 0), 360, 480)).toEqual([239, 41, 41]);
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill('下次复用'); await output.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '个人模板已保存。' })).toBeVisible();
  await expect(output.locator('[data-draft-state]')).toHaveAttribute('data-draft-state', 'saved'); await output.reload();
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption({ label: '下次复用' });
  await expect(output.getByRole('button', { name: '生成预览', exact: true })).toBeEnabled();
  await output.getByRole('tab', { name: '选择图片', exact: true }).click(); await expect(output.locator('.mewiki-publication-image-card')).toHaveCount(4);
  await output.getByRole('checkbox', { name: '导出图片：演示.webp', exact: true }).uncheck();
  await output.getByRole('checkbox', { name: '导出图片：笔记图片1', exact: true }).check(); await generated(output, 1);
});

test('preserves all source edges with contain and shares continuous corners for every device', async ({ page }) => {
  const source = await sharp({ create: { width: 900, height: 300, channels: 4, background: '#ef2929' } }).composite([{ input: await sharp({ create: { width: 30, height: 300, channels: 4, background: '#2666ee' } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
  const { publicationHtml } = await import('../server/publicationHtml.ts');
  const { publicationPagination } = await import('../server/publicationPagination.ts');
  for (const id of ['phone', 'phone-landscape', 'laptop', 'browser'] as const) {
    const options = { ...defaultPublicationOptions(), width: 720, height: 960, imageMode: { fit: 'contain' as const }, frame: { ...defaultPublicationFrame(id), shadow: 0 }, background: '#ffffff' };
    const document = { title: '', text: '', blocks: [{ id: 'source', kind: 'image' as const, content: 'data:image/png;base64,' + source.toString('base64') }] };
    await page.setContent(await publicationHtml({ document, options })); await page.evaluate(`${publicationPagination}(${JSON.stringify({ options, title: '' })})`);
    await expect(page.locator('.publication-frame-shell')).toHaveCSS('corner-shape', 'superellipse(1.6)');
    const image = await page.locator('.publication-page').screenshot(), layout = publicationFrameLayout(options)!;
    const left = layout.left + layout.device.screen.x * layout.unit, top = layout.top + layout.device.screen.y * layout.unit;
    const width = layout.device.screen.width * layout.unit, height = layout.device.screen.height * layout.unit;
    const unit = Math.min(width / 900, height / 300), imageLeft = left + (width - 900 * unit) / 2;
    expect(await pixel(image, imageLeft + 15 * unit, top + height / 2)).toEqual([38, 102, 238]);
    expect(await pixel(image, left + width / 2, top + height / 2)).toEqual([239, 41, 41]);
    await sharp(image).toFile(test.info().outputPath(`image-${id}-contain.png`));
  }
});
