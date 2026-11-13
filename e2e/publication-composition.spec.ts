import { expect, test, type Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runNotebookAction } from './helpers/researchNotebook.ts';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/composition-settings.json');
test.beforeEach(async () => {
  expect(settings.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  await rm(settings, { force: true });
  await rm(settings + '.export-profiles', { recursive: true, force: true });
  await rm(settings + '.image-workspace', { recursive: true, force: true });
});
async function open(page: Page) {
  await page.goto('/'); await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'composition-note', title: '宣传示例', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [{ id: 'intro', type: 'paragraph', text: '虚构内容' }] }]; state.activeNoteId = 'composition-note'; state.view = 'notes';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload(); const pending = page.waitForEvent('popup'); await runNotebookAction(page.getByTestId('research-notebook'), '社交图文导出');
  const output = await pending; await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  await expect(output.getByRole('combobox', { name: '工作模式', exact: true })).toBeVisible({ timeout: 3000 });
  await output.getByRole('combobox', { name: '工作模式', exact: true }).selectOption('images');
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720');
  return output;
}
async function add(output: Page) {
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  const buffer = await sharp({ create: { width: 900, height: 300, channels: 3, background: '#eeeeee' } }).png().toBuffer();
  await output.getByLabel('添加本地图片', { exact: true }).setInputFiles(['产品一', '产品二'].map(name => ({ name: name + '.png', mimeType: 'image/png', buffer })));
  await output.getByRole('tab', { name: '画布编辑', exact: true }).click();
}
async function generated(output: Page, count = 2) {
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(output.locator('.mewiki-publication-preview figure')).toHaveCount(count, { timeout: 60000 });
}
async function action(output: Page, name: string) { await output.getByRole('button', { name: '图片设计操作', exact: true }).click(); await output.getByRole('button', { name, exact: true }).click(); }
test('edits shared text and stickers within the left canvas, keeps clarity proportions and exports real batch images', async ({ page }) => {
  const output = await open(page); await add(output);
  await output.getByRole('button', { name: '添加文字', exact: true }).click();
  await output.getByLabel('图层文字', { exact: true }).fill('MeWiki {{index}} / {{total}}');
  await output.getByLabel('显示文字底色', { exact: true }).check();
  await output.getByLabel('图层颜色', { exact: true }).fill('#aa1122');
  const canvas = output.getByTestId('image-creation-canvas');
  const frame = output.frameLocator('iframe[title="图片效果预览"]');
  await expect(frame.locator('[data-composition-layer]')).toHaveCount(1);
  await expect(frame.locator('.composition-text')).toContainText('MeWiki 1 / 2');
  const rect = await frame.locator('[data-composition-layer]').evaluate(node => ({ left: (node as HTMLElement).offsetLeft, top: (node as HTMLElement).offsetTop }));
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('1080');
  await expect(output.getByRole('combobox', { name: '清晰度', exact: true })).toHaveValue('1080');
  await output.screenshot({ path: test.info().outputPath('composition-clarity.png'), fullPage: true });
  await expect.poll(() => frame.locator('[data-composition-layer]').evaluate(node => (node as HTMLElement).offsetLeft)).toBe(rect.left * 1.5);
  await output.getByRole('combobox', { name: '清晰度', exact: true }).selectOption('720');
  await output.getByRole('button', { name: '添加贴纸', exact: true }).click(); await output.getByLabel('图层颜色', { exact: true }).fill('#ef2929');
  await output.getByLabel('图层水平位置（%）', { exact: true }).fill('65'); await output.getByLabel('图层垂直位置（%）', { exact: true }).fill('65');
  const before = await canvas.boundingBox(); expect(before!.width / before!.height).toBeCloseTo(.75, 2);
  await output.screenshot({ path: test.info().outputPath('composition-editor-desktop.png'), fullPage: true });
  await generated(output);
  for (const image of await output.locator('.mewiki-publication-preview figure > img').all()) {
    const url = await image.getAttribute('src'), buffer = Buffer.from(url!.split(',')[1], 'base64');
    expect(await sharp(buffer).metadata()).toMatchObject({ width: 720, height: 960 });
    const { data } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let red = 0, dark = 0; for (let n = 0; n < data.length; n += 3) { if (data[n] === 239 && data[n + 1] === 41 && data[n + 2] === 41) red++; if (data[n] === 170 && data[n + 1] === 17 && data[n + 2] === 34) dark++; }
    expect(red).toBeGreaterThan(100); expect(dark).toBeGreaterThan(50);
  }
  const download = output.waitForEvent('download'); await output.getByRole('button', { name: '下载全部图片 ZIP', exact: true }).click();
  expect(Object.keys(unzipSync(await readFile((await (await download).path())!)))).toEqual(['001-产品一.png', '002-产品二.png']);
  await output.screenshot({ path: test.info().outputPath('composition-batch-results.png') });
});

test('keeps per-image edits, drag undo, template style and saved design resources isolated', async ({ page }) => {
  const output = await open(page); await add(output);
  await output.getByRole('button', { name: '添加文字', exact: true }).click(); await output.getByLabel('图层文字', { exact: true }).fill('共享标题');
  await output.getByLabel('编辑范围', { exact: true }).selectOption('current'); await output.getByLabel('图层水平位置（%）', { exact: true }).fill('5');
  await output.getByRole('button', { name: '下一张图片', exact: true }).click(); await expect(output.getByLabel('图层水平位置（%）', { exact: true })).toHaveValue('10');
  await output.getByLabel('编辑范围', { exact: true }).selectOption('all'); await output.getByLabel('图层颜色', { exact: true }).fill('#aa1122');
  await output.getByRole('button', { name: '上一张图片', exact: true }).click(); await expect(output.getByLabel('图层水平位置（%）', { exact: true })).toHaveValue('5');
  const item = output.getByRole('button', { name: '编辑图层：文字', exact: true }), r = await item.boundingBox();
  await output.getByLabel('编辑范围', { exact: true }).selectOption('current');
  await output.mouse.move(r!.x + r!.width / 2, r!.y + r!.height / 2); await output.mouse.down(); await output.mouse.move(r!.x + r!.width / 2 + 30, r!.y + r!.height / 2 + 15, { steps: 5 }); await output.mouse.up();
  expect(Number(await output.getByLabel('图层水平位置（%）', { exact: true }).inputValue())).toBeGreaterThan(5);
  await output.getByRole('button', { name: '撤销画布操作', exact: true }).click(); await expect(output.getByLabel('图层水平位置（%）', { exact: true })).toHaveValue('5');
  await output.getByRole('button', { name: '图片设计操作', exact: true }).click(); await output.getByRole('button', { name: '保存图片设计', exact: true }).click(); await output.getByLabel('设计名称', { exact: true }).fill('产品图作品'); await output.getByRole('button', { name: '确认保存设计', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '图片设计已保存。' })).toBeVisible();
  await expect(output.locator('[data-draft-state]')).toHaveAttribute('data-draft-state', 'saved');
  await output.reload(); await expect(output.getByRole('combobox', { name: '工作模式', exact: true })).toHaveValue('images');
  await output.getByRole('button', { name: '图片设计操作', exact: true }).click(); await output.getByRole('button', { name: '打开图片设计', exact: true }).click(); await output.getByRole('button', { name: '产品图作品', exact: true }).click();
  await expect(output.getByLabel('图层文字', { exact: true })).toHaveCount(0);
  await expect(output.getByRole('button', { name: '下一张图片', exact: true })).toBeEnabled();
  await output.getByRole('button', { name: '选择图层：文字', exact: true }).click(); await expect(output.getByLabel('图层水平位置（%）', { exact: true })).toHaveValue('5');
  await output.getByLabel('图层颜色', { exact: true }).fill('#116633');
  await expect(output.getByRole('status').filter({ hasText: '图片设计已自动保存。' })).toBeVisible();
  await generated(output);
});

test('keeps personal sticker originals reusable and excludes single-image additions from templates', async ({ page }) => {
  const output = await open(page); await add(output);
  const logo = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#ea8212' } }).png().toBuffer();
  await output.getByLabel('上传装饰图片', { exact: true }).setInputFiles({ name: '品牌标识.png', mimeType: 'image/png', buffer: logo });
  await output.getByRole('button', { name: '加入我的贴纸', exact: true }).click(); await expect(output.getByRole('status').filter({ hasText: '贴纸已保存' })).toBeVisible();
  await output.getByLabel('编辑范围', { exact: true }).selectOption('current'); await output.getByRole('button', { name: '添加文字', exact: true }).click(); await output.getByLabel('图层文字', { exact: true }).fill('只在第一张出现');
  await output.getByLabel('编辑范围', { exact: true }).selectOption('all'); await output.getByLabel('图层文字', { exact: true }).fill('仍然只在第一张');
  await output.getByRole('button', { name: '下一张图片', exact: true }).click(); await expect(output.frameLocator('iframe[title="图片效果预览"]').locator('.composition-text')).toHaveCount(0);
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click(); await output.getByLabel('模板名称', { exact: true }).fill('品牌样式'); await output.getByRole('button', { name: '保存模板', exact: true }).click(); await expect(output.getByRole('status').filter({ hasText: '个人模板已保存。' })).toBeVisible();
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); const downloading = output.waitForEvent('download'); await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const template = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(template.profile.options.composition.layers).toHaveLength(1); expect(template.profile.options.composition.layers[0].type).toBe('image');
  await expect(output.locator('[data-draft-state]')).toHaveAttribute('data-draft-state', 'saved');
  await output.reload(); await expect(output.getByLabel('工作模式', { exact: true })).toHaveValue('images');
  await output.getByText('我的贴纸', { exact: true }).click(); await output.getByRole('button', { name: '品牌标识.png', exact: true }).click(); await expect(output.getByLabel('图层名称', { exact: true })).toHaveValue('品牌标识.png');
  await output.getByRole('button', { name: '移除个人贴纸：品牌标识.png', exact: true }).click(); await expect(output.getByRole('button', { name: '移除个人贴纸：品牌标识.png', exact: true })).toHaveCount(0);
  await expect(output.frameLocator('iframe[title="图片效果预览"]').locator('[data-layer-type="image"]')).toHaveCount(2);
});

test('renders screen layers above the main image and transforms the entire device together', async ({ page }) => {
  const output = await open(page); await add(output);
  await output.getByRole('combobox', { name: '设备边框', exact: true }).selectOption('phone');
  await output.getByRole('combobox', { name: '图片适配', exact: true }).selectOption('cover');
  await output.getByRole('button', { name: '添加贴纸', exact: true }).click();
  await output.getByLabel('图层位置', { exact: true }).selectOption('screen'); await output.getByLabel('系统贴纸', { exact: true }).selectOption('badge');
  await output.getByLabel('图层颜色', { exact: true }).fill('#ef2929'); await output.getByLabel('图层水平位置（%）', { exact: true }).fill('40'); await output.getByLabel('图层垂直位置（%）', { exact: true }).fill('45');
  await output.getByRole('button', { name: '设备与主图', exact: true }).click();
  await output.getByLabel('主体大小（%）', { exact: true }).fill('75'); await output.getByLabel('主体旋转', { exact: true }).fill('12');
  await output.getByRole('button', { name: '锁定主体', exact: true }).click(); await expect(output.getByLabel('主体旋转', { exact: true })).toBeDisabled();
  await output.getByRole('button', { name: '解锁主体', exact: true }).click(); await expect(output.getByLabel('主体旋转', { exact: true })).toBeEnabled();
  const main = output.getByRole('button', { name: '编辑图层：设备与主图', exact: true }); await main.scrollIntoViewIfNeeded(); const mainRect = await main.boundingBox();
  await output.mouse.dblclick(mainRect!.x + mainRect!.width / 2, mainRect!.y + mainRect!.height * .2); await expect(output.getByRole('group', { name: '图片取景', exact: true })).toBeVisible();
  await output.getByRole('button', { name: '切换主图取景', exact: true }).click();
  await output.getByRole('button', { name: '添加文字', exact: true }).click(); await output.getByLabel('图层文字', { exact: true }).fill('宣传海报');
  await output.getByRole('button', { name: '编辑图层：文字', exact: true }).dblclick(); await expect(output.getByLabel('图层文字', { exact: true })).toBeFocused();
  const center = await output.frameLocator('iframe[title="图片效果预览"]').locator('[data-layer-type="sticker"]').evaluate(node => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  await generated(output);
  const url = await output.locator('.mewiki-publication-preview figure > img').first().getAttribute('src');
  const sample = await sharp(Buffer.from(url!.split(',')[1], 'base64')).extract({ left: center.x, top: center.y, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  expect([...sample]).toEqual([239, 41, 41]);
});

test('backs up originals and fonts, imports as a new design, and keeps canvas templates reusable', async ({ page, browser }) => {
  const output = await open(page); await add(output);
  const originalNote = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  await output.getByRole('button', { name: '添加文字', exact: true }).click(); await output.getByLabel('图层文字', { exact: true }).fill('Launch {{title}}');
  const font = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf'), fontId = createHash('sha256').update(font).digest('hex');
  await output.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: '宣传字体.ttf', mimeType: 'font/ttf', buffer: font });
  await expect(output.getByLabel('文字字体', { exact: true })).toHaveValue('font:' + fontId);
  await expect.poll(() => output.locator('iframe[title="图片效果预览"]').evaluate(async node => { const doc = (node as HTMLIFrameElement).contentDocument!; await doc.fonts.ready; return [...doc.fonts].some(face => face.family.includes('MeWikiUserFont_') && face.status === 'loaded'); })).toBe(true);
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill('可重复海报'); await output.getByRole('button', { name: '保存模板', exact: true }).click(); await expect(output.getByRole('status').filter({ hasText: '个人模板已保存。' })).toBeVisible();
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); const templateDownload = output.waitForEvent('download'); await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const template = JSON.parse(await readFile((await (await templateDownload).path())!, 'utf8'));
  expect(template.version).toBe(2); expect(template.fonts[0].id).toBe(fontId); expect(template.profile.options.composition.layers[0].text).toBe('Launch {{title}}'); expect(template.profile.options).not.toHaveProperty('items');
  await action(output, '保存图片设计'); await output.getByLabel('设计名称', { exact: true }).fill('可编辑作品'); await output.getByRole('button', { name: '确认保存设计', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '图片设计已保存。' })).toBeVisible();
  const downloading = output.waitForEvent('download'); await action(output, '导出作品备份'); const archive = await readFile((await (await downloading).path())!);
  expect(Object.keys(unzipSync(archive)).some(name => name.startsWith('assets/'))).toBe(true); expect(Object.keys(unzipSync(archive))).toContain(`fonts/${fontId}.font`);
  await action(output, '图片设计另存为'); await output.getByLabel('设计名称', { exact: true }).fill('可编辑作品副本'); await output.getByRole('button', { name: '确认保存设计', exact: true }).click();
  await expect(output.getByRole('status').filter({ hasText: '图片设计已保存。' })).toBeVisible();
  await action(output, '删除当前图片设计'); await output.getByRole('button', { name: '确认删除设计', exact: true }).click(); await expect(output.getByRole('status').filter({ hasText: '图片设计已删除' })).toBeVisible();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1600, height: 1000 } });
  try {
    const fresh = await open(await context.newPage());
    await action(fresh, '打开图片设计'); await fresh.getByRole('button', { name: '可编辑作品', exact: true }).click();
    await expect(fresh.getByRole('alert')).toContainText('图片创作 → 第 1 张 → 第 1 个图层 → 字体');
    await fresh.getByRole('button', { name: '定位字体图层', exact: true }).click(); await expect(fresh.getByLabel('文字字体', { exact: true })).toHaveValue('font:' + fontId);
    await fresh.getByLabel('选择作品备份 ZIP', { exact: true }).setInputFiles({ name: 'design.zip', mimeType: 'application/zip', buffer: archive });
    await expect(fresh.getByRole('status').filter({ hasText: '作品备份已导入' })).toBeVisible();
    await fresh.getByRole('button', { name: '选择图层：文字', exact: true }).click(); await expect(fresh.getByLabel('文字字体', { exact: true })).toHaveValue('font:' + fontId);
    await generated(fresh); await expect(fresh.getByRole('alert')).toHaveCount(0);
  } finally { await context.close(); }
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(originalNote);
});

test('starts from a blank canvas and locates overflowing text in its image and layer', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('tab', { name: '选择图片', exact: true }).click(); await output.getByRole('button', { name: '添加空白画布', exact: true }).click(); await output.getByRole('tab', { name: '画布编辑', exact: true }).click();
  await output.getByRole('button', { name: '添加文字', exact: true }).click(); await output.getByLabel('图层文字', { exact: true }).fill('MeWiki');
  await generated(output, 1);
  await output.getByRole('tab', { name: '画布编辑', exact: true }).click(); await output.getByLabel('图层宽度（%）', { exact: true }).fill('5'); await output.getByLabel('图层高度（%）', { exact: true }).fill('5'); await output.getByLabel('图层文字', { exact: true }).fill('这是一段无法放进小文字框的很长文字。'.repeat(60));
  await expect(output.locator('.mewiki-composition-issues')).toContainText('第 1 张 · 第 1 个图层');
  await output.getByRole('button', { name: '生成预览', exact: true }).click(); await expect(output.getByRole('alert')).toContainText('图片创作 → 第 1 张 → 第 1 个图层：文字超出文字框');
  await expect(output.getByRole('tab', { name: '画布编辑', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(output.getByLabel('图层文字', { exact: true })).toBeVisible();
  await output.getByLabel('图层宽度（%）', { exact: true }).fill('80'); await output.getByLabel('图层高度（%）', { exact: true }).fill('15'); await output.getByLabel('图层文字', { exact: true }).fill('MeWiki 图片创作');
  await generated(output, 1);
});

test('opens independent image creation without note content and fits its toolbars on narrow screens', async ({ page }) => {
  const first = await open(page); await first.close();
  const popup = page.waitForEvent('popup'); await runNotebookAction(page.getByTestId('research-notebook'), '图片创作'); const output = await popup;
  await expect(output.getByLabel('工作模式', { exact: true })).toHaveValue('images');
  const snapshot = await output.evaluate(() => { const key = Object.keys(sessionStorage).find(key => key.startsWith('mewiki:publication:'))!; return JSON.parse(sessionStorage.getItem(key)!).snapshot; });
  expect(snapshot.notes[0].blocks).toEqual([]);
  await output.setViewportSize({ width: 390, height: 844 });
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const close = output.getByRole('button', { name: '关闭社交图文导出', exact: true }); await expect(close).toBeInViewport();
  await output.getByRole('tab', { name: '选择图片', exact: true }).click(); await output.getByRole('button', { name: '添加空白画布', exact: true }).click();
  await output.getByRole('tab', { name: '画布编辑', exact: true }).click();
  await output.getByRole('button', { name: '图层面板', exact: true }).click();
  await output.getByRole('button', { name: '添加文字', exact: true }).click(); await output.getByLabel('图层文字', { exact: true }).fill('窄屏编辑');
  const properties = output.getByRole('complementary', { name: '画布编辑与图层属性', exact: true });
  expect((await properties.boundingBox())!.y).toBe(88);
  await output.screenshot({ path: test.info().outputPath('composition-properties-mobile.png') });
  await properties.getByRole('button', { name: '收起图层面板', exact: true }).click();
  const canvas = output.getByTestId('image-creation-canvas');
  await expect.poll(async () => { const box = await canvas.boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(378);
  await expect(output.frameLocator('iframe[title="图片效果预览"]').locator('.composition-text')).toContainText('窄屏编辑');
  await canvas.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await output.screenshot({ path: test.info().outputPath('composition-mobile.png'), fullPage: true });
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('localizes image editing and design menus on a narrow English screen', async ({ page }) => {
  const output = await open(page);
  await page.evaluate(() => localStorage.setItem('mewiki:locale', 'en'));
  await expect(output.getByRole('button', { name: 'Edit layer: Device and main image', exact: true })).toBeVisible();
  await output.setViewportSize({ width: 390, height: 844 });
  await output.getByRole('combobox', { name: 'Workspace mode', exact: true }).selectOption('images');
  await output.getByRole('tab', { name: 'Select images', exact: true }).click(); await output.getByRole('button', { name: 'Add blank canvas', exact: true }).click();
  await output.getByRole('tab', { name: 'Canvas editor', exact: true }).click();
  await output.getByRole('button', { name: 'Layers panel', exact: true }).click();
  await output.getByRole('button', { name: 'Add text', exact: true }).click(); await output.getByLabel('Layer text', { exact: true }).fill('MeWiki launch');
  const properties = output.getByRole('complementary', { name: 'Canvas editor and layer properties', exact: true });
  await expect(properties).not.toContainText(/[\u4e00-\u9fff]/);
  await output.screenshot({ path: test.info().outputPath('composition-properties-english-mobile.png') });
  await properties.getByRole('button', { name: 'Collapse layers panel', exact: true }).click();
  await expect.poll(async () => { const box = await output.getByTestId('image-creation-canvas').boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(378);
  await output.getByRole('button', { name: 'Image design actions', exact: true }).click(); await expect(output.getByRole('button', { name: 'Export design backup', exact: true })).toBeVisible();
  await expect(output.getByRole('toolbar', { name: 'Image design actions', exact: true })).not.toContainText(/[\u4e00-\u9fff]/);
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.screenshot({ path: test.info().outputPath('composition-english-mobile.png'), fullPage: true });
});

test('docks the properties to the right edge and scrolls them independently from the canvas', async ({ page }) => {
  const output = await open(page); await add(output);
  const properties = output.getByRole('complementary', { name: '画布编辑与图层属性', exact: true });
  const canvas = output.getByTestId('image-creation-canvas');
  const bounds = await properties.boundingBox();
  const viewport = output.viewportSize()!;
  expect(bounds!.y).toBe(0); expect(bounds!.x + bounds!.width).toBe(viewport.width); expect(bounds!.height).toBe(viewport.height);
  const header = properties.getByRole('toolbar', { name: '画布编辑工具栏', exact: true });
  expect((await header.boundingBox())!.height).toBe(44);
  await properties.getByRole('button', { name: '添加文字', exact: true }).click();
  await properties.getByLabel('图层文字', { exact: true }).fill('固定右侧面板');
  const original = await canvas.boundingBox();
  await properties.getByLabel('图层圆角', { exact: true }).scrollIntoViewIfNeeded();
  const after = await canvas.boundingBox(); expect(after!.y).toBe(original!.y);
  await expect(header).toBeInViewport();
  await output.getByRole('button', { name: '图层面板', exact: true }).click();
  await expect(properties).toBeHidden();
  await output.getByRole('button', { name: '图层面板', exact: true }).click();
  await expect(properties.getByLabel('图层文字', { exact: true })).toHaveValue('固定右侧面板');
  await properties.getByRole('button', { name: '收起图层面板', exact: true }).click();
  await expect(output.getByRole('button', { name: '图层面板', exact: true })).toBeFocused();
  await output.keyboard.press('Enter');
  await expect(properties).toBeVisible();
  await expect(properties.getByText('画布边界由左侧画幅决定。位置和大小按比例保存，切换清晰度保持布局。', { exact: true })).toHaveCount(0);
  await output.screenshot({ path: test.info().outputPath('composition-docked-desktop.png') });
});

test('keeps imported pictures in one fixed-height horizontal album while the canvas scrolls', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  const buffer = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#e8edf3' } }).png().toBuffer();
  await output.getByLabel('添加本地图片', { exact: true }).setInputFiles(Array.from({ length: 12 }, (_, i) => ({ name: `相册-${i + 1}.png`, mimeType: 'image/png', buffer })));
  const album = output.getByRole('region', { name: '图片相册', exact: true });
  await expect(album).toBeVisible();
  const cards = album.locator('.mewiki-publication-image-card'); await expect(cards).toHaveCount(12);
  const initial = await album.boundingBox();
  const positions = await cards.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
  expect(new Set(positions).size).toBe(1);
  expect(await album.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  const footer = output.getByRole('region', { name: '选择图片', exact: true });
  const before = await footer.boundingBox();
  await output.getByTestId('image-creation-canvas').hover(); await output.mouse.wheel(0, 500);
  await expect.poll(() => output.getByRole('region', { name: '图片画布', exact: true }).evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect((await footer.boundingBox())!.y).toBe(before!.y);
  await album.focus(); await output.keyboard.press('End');
  await album.getByRole('button', { name: '预览图片：相册-12.png', exact: true }).click();
  await expect(output.getByRole('toolbar', { name: '图片预览工具栏', exact: true })).toContainText('12 / 12');
  await album.getByLabel('导出图片：相册-12.png', { exact: true }).uncheck();
  await expect(output.getByRole('toolbar', { name: '图片选择工具栏', exact: true })).toContainText('11 / 12');
  await album.getByRole('button', { name: '移除图片：相册-12.png', exact: true }).click(); await expect(cards).toHaveCount(11);
  expect((await album.boundingBox())!.height).toBe(initial!.height);
  await output.screenshot({ path: test.info().outputPath('composition-album-desktop.png') });
  await output.setViewportSize({ width: 390, height: 844 });
  await output.getByRole('button', { name: '图层面板', exact: true }).click();
  await output.getByRole('tab', { name: '选择图片', exact: true }).click();
  await expect(album).toBeInViewport();
  expect((await album.boundingBox())!.height).toBe(initial!.height);
  expect(await album.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.screenshot({ path: test.info().outputPath('composition-album-mobile.png') });
});
