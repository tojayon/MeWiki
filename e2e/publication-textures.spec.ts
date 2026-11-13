import { expect, test, type Page } from '@playwright/test';
import { rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runNotebookAction } from './helpers/researchNotebook.ts';
import { publicationTexturePresets, defaultPublicationTexture } from '../src/domain/publicationTextures.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';
import { publicationHtml } from '../server/publicationHtml.ts';
import { publicationPagination } from '../server/publicationPagination.ts';

const settings = path.resolve(process.env.MEWIKI_EXPORT_E2E_SETTINGS || '.mewiki/publication-texture-settings.json');
test.beforeEach(async () => {
  const profileDirectory = settings + '.export-profiles';
  expect(settings.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  expect(profileDirectory.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  await rm(settings, { force: true }); await rm(profileDirectory, { recursive: true, force: true });
});
async function open(page: Page) {
  await page.goto('/'); await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'texture-note', title: '纸上知识', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [{ id: 'intro', type: 'paragraph', text: '背景纹理让知识卡片更有温度。**清晰阅读**始终放在第一位。' }, { id: 'second', type: 'paragraph', text: '重复生成与模板迁移都应保持纹理。' }] }];
    state.activeNoteId = 'texture-note'; state.view = 'notes'; localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload(); const opened = page.waitForEvent('popup');
  await runNotebookAction(page.getByTestId('research-notebook'), '社交图文导出');
  const output = await opened; await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  await output.getByRole('group', { name: '内容', exact: true }).locator(':scope > summary').click();
  await output.getByRole('group', { name: '画幅', exact: true }).locator(':scope > summary').click();
  return output;
}
async function save(output: Page, name: string) {
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill(name);
  await output.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(output.getByRole('status')).toContainText('个人模板已保存');
}
async function sampleProperty(output: Page, property: string) {
  // Read from the stable parent document while srcDoc replaces the child document.
  return output.locator('iframe[title="样板内容预览"]').evaluate((element, property) => {
    const frame = element as HTMLIFrameElement, layer = frame.contentDocument?.querySelector('.publication-page .publication-texture-layer');
    return layer ? frame.contentWindow!.getComputedStyle(layer).getPropertyValue(property) : property === 'background-image' ? 'none' : '';
  }, property);
}
async function sampleTexture(output: Page) { return sampleProperty(output, 'background-image'); }

test('previews all presets, applies a selected variant and restores the saved seed and parameters', async ({ page }) => {
  const output = await open(page), preset = output.getByRole('combobox', { name: '纹理预设', exact: true });
  await expect(preset).toHaveValue('none');
  for (const { id, name } of publicationTexturePresets) {
    await preset.selectOption(id);
    await expect.poll(() => sampleTexture(output)).toContain('data:image/svg+xml');
    await expect(output.getByRole('combobox', { name: '纹理质感', exact: true })).toHaveValue('natural');
    expect(await preset.locator('option:checked').innerText()).toBe(name);
  }
  await preset.selectOption('fiber');
  await output.getByRole('button', { name: '生成三个变体', exact: true }).click();
  await output.getByRole('button', { name: '应用变体 2', exact: true }).click();
  await expect(output.getByRole('button', { name: '应用变体 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await output.getByLabel('纹理强度', { exact: true }).fill('28');
  await expect.poll(() => sampleProperty(output, 'opacity')).toBe('0.28');
  const appearance = await sampleTexture(output);
  await save(output, '棉纸个人模板');
  const download = output.waitForEvent('download');
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const file = await download; const backup = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(backup.profile.options.texture).toMatchObject({ kind: 'fiber', opacity: 28 });
  expect(backup).not.toHaveProperty('document');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:mewiki');
  await expect(preset).toHaveValue('none');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption({ label: '棉纸个人模板' });
  await expect(preset).toHaveValue('fiber');
  await expect.poll(() => sampleTexture(output)).toBe(appearance);
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '导入模板', exact: true }).click();
  await output.locator('input[type=file][aria-label="导入模板"]').setInputFiles({ name: 'texture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(output.getByRole('status')).toContainText('个人模板已导入');
  await expect.poll(() => sampleTexture(output)).toBe(appearance);
  await output.screenshot({ path: test.info().outputPath('texture-style-desktop.png') });
});

test('crops a local image, generates three candidates, preserves the current texture until selected and saves the processed asset', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('grid');
  await output.getByText('从本地图片制作纹理', { exact: true }).click();
  const pixels = Buffer.alloc(96 * 64 * 3); for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31 + Math.floor(i / 90) * 13) % 220;
  const image = await sharp(pixels, { raw: { width: 96, height: 64, channels: 3 } }).png().toBuffer();
  await output.getByLabel('上传纹理图片', { exact: true }).setInputFiles({ name: 'grain.png', mimeType: 'image/png', buffer: image });
  await expect(output.getByAltText('纹理裁切原图', { exact: true })).toBeVisible();
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('grid');
  await output.getByLabel('裁切区域大小', { exact: true }).fill('60');
  await output.getByLabel('裁切水平位置', { exact: true }).fill('85');
  await output.getByRole('button', { name: '生成处理候选', exact: true }).click();
  const candidates = output.getByRole('group', { name: '图片纹理候选', exact: true });
  await expect(candidates.getByRole('button')).toHaveCount(3);
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('grid');
  await candidates.getByRole('button', { name: '跟随背景色', exact: true }).click();
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('custom');
  await expect.poll(() => sampleTexture(output)).toContain('data:image/png;base64');
  const appearance = await sampleTexture(output);
  await output.getByRole('combobox', { name: '纹理铺放', exact: true }).selectOption('cover');
  await expect.poll(() => sampleProperty(output, 'background-size')).toBe('cover');
  await save(output, '自己的图片纹理');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption({ label: '自己的图片纹理' });
  await expect.poll(() => sampleTexture(output)).toBe(appearance);
  await expect(output.getByRole('combobox', { name: '纹理铺放', exact: true })).toHaveValue('cover');
  await output.getByText('从本地图片制作纹理', { exact: true }).click();
  await output.getByLabel('上传纹理图片', { exact: true }).setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
  await expect(output.getByRole('alert')).toBeVisible();
  await expect.poll(() => sampleTexture(output)).toBe(appearance);
  const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  expect((await submitted).postDataJSON().options.texture).toMatchObject({ kind: 'custom', fit: 'cover' });
  const result = output.getByAltText('导出预览第 1 页', { exact: true }); await expect(result).toBeVisible({ timeout: 30000 });
  const bitmap = Buffer.from((await result.getAttribute('src'))!.split(',')[1], 'base64');
  const statistics = await sharp(await sharp(bitmap).extract({ left: 0, top: 0, width: 120, height: 80 }).png().toBuffer()).stats();
  expect(Math.max(...statistics.channels.map(channel => channel.stdev))).toBeGreaterThan(.1);
  await test.info().attach('custom-image-texture.png', { body: bitmap, contentType: 'image/png' });
});

test('cancels a delayed image upload when switching templates and never applies it to the new template', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('paper');
  await output.getByText('从本地图片制作纹理', { exact: true }).click();
  await output.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(blob: Blob) { setTimeout(() => { read.call(this, blob); }, 500); };
  });
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#aa8866' } }).png().toBuffer();
  await output.getByLabel('上传纹理图片', { exact: true }).setInputFiles({ name: 'delayed.png', mimeType: 'image/png', buffer: image });
  await expect(output.getByRole('status')).toContainText('正在本地处理纹理');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:academic');
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('none');
  await output.getByText('从本地图片制作纹理', { exact: true }).click();
  await output.waitForTimeout(650);
  await expect(output.getByAltText('纹理裁切原图', { exact: true })).toHaveCount(0);
  await expect(output.getByRole('alert')).toHaveCount(0);
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('none');
});

test('renders all preset backgrounds as real nonuniform pixels and scopes texture to cover or body pages', async ({ page }) => {
  for (const { id } of publicationTexturePresets) {
    const request = { document: { title: 'Texture', text: 'Reading', blocks: [{ id: 'a', kind: 'markdown' as const, content: 'Reading' }] }, options: { ...defaultPublicationOptions(), width: 600, height: 800, margin: 40, fontSize: 24, cover: true, texture: { ...defaultPublicationTexture(id), opacity: 40 } } };
    await page.setContent(await publicationHtml(request));
    await page.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
    const screenshot = await page.locator('.publication-page').last().screenshot();
    const stats = await sharp(await sharp(screenshot).extract({ left: 0, top: 0, width: 120, height: 80 }).png().toBuffer()).stats();
    expect(Math.max(...stats.channels.map(channel => channel.stdev)), id).toBeGreaterThan(.1);
    if (id === 'watercolor') {
      // A square SVG fitted inside a portrait viewport leaves a rectangular grain edge.
      const above = await sharp(await sharp(screenshot).extract({ left: 250, top: 90, width: 100, height: 8 }).png().toBuffer()).stats();
      const below = await sharp(await sharp(screenshot).extract({ left: 250, top: 110, width: 100, height: 8 }).png().toBuffer()).stats();
      expect(Math.abs(above.channels[0].mean - below.channels[0].mean)).toBeLessThan(.5);
    }
    await writeFile(test.info().outputPath(`${id}.png`), screenshot);
    await test.info().attach(`${id}.png`, { body: screenshot, contentType: 'image/png' });
  }
  for (const scope of ['all', 'body', 'cover'] as const) {
    const request = { document: { title: 'Scope', text: 'Text', blocks: [{ id: 'a', kind: 'markdown' as const, content: 'Text' }] }, options: { ...defaultPublicationOptions(), cover: true, texture: { ...defaultPublicationTexture('dots'), scope } } };
    await page.setContent(await publicationHtml(request));
    await page.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
    const displays = await page.locator('.publication-page .publication-texture-layer').evaluateAll(elements => elements.map(el => getComputedStyle(el).display));
    expect(displays).toEqual(scope === 'all' ? ['block', 'block'] : scope === 'body' ? ['none', 'block'] : ['block', 'none']);
  }
});

test('exports repeatable PNG and textured continuous JPEG through the real service', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('paper');
  const generate = async () => {
    await output.getByRole('button', { name: '生成预览', exact: true }).click();
    const image = output.getByAltText('导出预览第 1 页', { exact: true }); await expect(image).toBeVisible({ timeout: 30000 }); return image.getAttribute('src');
  };
  const first = (await generate())!; const second = (await generate())!;
  expect(first).toBe(second);
  const png = Buffer.from(first.split(',')[1], 'base64'); expect((await sharp(png).metadata()).format).toBe('png');
  await writeFile(test.info().outputPath('export-paper.png'), png);
  await test.info().attach('export-paper.png', { body: png, contentType: 'image/png' });
  await output.getByRole('group', { name: '画幅', exact: true }).locator(':scope > summary').click();
  await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
  await output.getByRole('combobox', { name: '图片格式', exact: true }).selectOption('jpeg');
  const jpeg = Buffer.from((await generate())!.split(',')[1], 'base64');
  expect((await sharp(jpeg).metadata()).format).toBe('jpeg');
  await writeFile(test.info().outputPath('export-paper-long.jpg'), jpeg);
  await test.info().attach('export-paper-long.jpg', { body: jpeg, contentType: 'image/jpeg' });
});

test('keeps texture controls usable with native keyboard focus on narrow English screens', async ({ page }) => {
  const output = await open(page); await output.setViewportSize({ width: 390, height: 844 });
  await output.evaluate(() => { localStorage.setItem('mewiki:locale', 'en'); }); await output.reload();
  const style = output.getByRole('group', { name: '样式', exact: true });
  // Reload applies the stored locale before the standalone export page mounts.
  await expect(output.getByRole('combobox', { name: 'Texture preset', exact: true })).toBeVisible();
  await output.getByRole('combobox', { name: 'Texture preset', exact: true }).selectOption('linen');
  const strength = output.getByLabel('Texture strength', { exact: true }); await strength.focus(); await output.keyboard.press('ArrowRight');
  await expect(strength).toHaveValue('19');
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.getByRole('button', { name: 'Generate three variants', exact: true }).click();
  await expect(output.getByRole('button', { name: 'Apply variant 3', exact: true })).toBeVisible();
  expect(await style.count()).toBe(0);
  await output.screenshot({ path: test.info().outputPath('texture-style-mobile-en.png') });
});

test('clips the texture to the four page margins on covers, paged content and the final height of a long image', async ({ page }) => {
  const image = async (color: string) => `data:image/png;base64,${(await sharp({ create: { width: 12, height: 12, channels: 3, background: color } }).png().toBuffer()).toString('base64')}`;
  const red = { ...defaultPublicationTexture('custom'), image: await image('#ff0000'), opacity: 50, scope: 'margins' as const };
  const blue = { ...defaultPublicationTexture('custom'), image: await image('#0000ff'), opacity: 50 };
  const pixel = async (buffer: Buffer, x: number, y: number) => {
    const { data } = await sharp(buffer).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return [...data];
  };
  for (const mode of ['pages', 'long'] as const) for (const margin of [40, 80]) {
    const options = { ...defaultPublicationOptions(), width: 600, height: 1000, fontSize: 24, margin, mode, cover: true, texture: red };
    const document = { title: 'Margins', text: 'Text', blocks: [{ id: 'a', kind: 'markdown' as const, content: 'Text' }] };
    await page.setContent(await publicationHtml({ document, options }));
    await page.evaluate(`${publicationPagination}(${JSON.stringify({ options, title: document.title })})`);
    await expect(page.locator('.publication-page')).toHaveCount(2);
    let sheetIndex = 0;
    for (const sheet of await page.locator('.publication-page').all()) {
      const buffer = await sheet.screenshot(), metadata = await sharp(buffer).metadata(), height = metadata.height!;
      await writeFile(test.info().outputPath(`margins-${mode}-${margin}-${++sheetIndex}.png`), buffer);
      const middle = Math.floor(height / 2);
      for (const [x, y] of [[10, middle], [590, middle], [300, 10], [300, height - 10], [margin - 2, middle]]) expect(await pixel(buffer, x, y)).toEqual([255, 127, 127]);
      expect(await pixel(buffer, 300, middle)).toEqual([255, 255, 255]);
      // Sample blank inner corners; the centered cover title can cross the left middle point.
      for (const [x, y] of [[margin + 2, margin + 2], [600 - margin - 2, margin + 2], [margin + 2, height - margin - 2], [600 - margin - 2, height - margin - 2]]) {
        expect(await pixel(buffer, x, y), `${mode}, margin ${margin}, page ${sheetIndex}, pixel ${x}/${y}`).toEqual([255, 255, 255]);
      }
    }
  }
  for (const front of ['red', 'blue']) {
    const options = { ...defaultPublicationOptions(), width: 600, height: 800, margin: 40, fontSize: 24, textureLayers: front === 'red' ? [red, blue] : [blue, red] };
    const document = { title: 'Layers', text: 'Text', blocks: [{ id: 'a', kind: 'markdown' as const, content: 'Text' }] };
    await page.setContent(await publicationHtml({ document, options }));
    await page.evaluate(`${publicationPagination}(${JSON.stringify({ options, title: document.title })})`);
    const buffer = await page.locator('.publication-page').screenshot();
    expect(await pixel(buffer, 10, 400)).toEqual(front === 'red' ? [191, 63, 127] : [127, 63, 191]);
    expect(await pixel(buffer, 300, 400)).toEqual([127, 127, 255]);
    await writeFile(test.info().outputPath(`layered-${front}-front.png`), buffer);
  }
});

test('edits and reorders independent layers, restores and migrates their template, and exports layered PNG and JPEG', async ({ page }) => {
  const output = await open(page), list = output.getByRole('group', { name: '纹理图层列表', exact: true });
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('paper');
  await output.getByLabel('纹理强度', { exact: true }).fill('12');
  await output.getByText('纹理位置与范围', { exact: true }).click();
  await output.getByRole('combobox', { name: '纹理应用范围', exact: true }).selectOption('margins');
  await output.getByRole('button', { name: '添加纹理图层', exact: true }).click();
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('watercolor');
  await output.getByLabel('纹理强度', { exact: true }).fill('25');
  await list.getByRole('button', { name: '编辑纹理图层 2：暖白纸纹', exact: true }).click();
  await expect(output.getByLabel('纹理强度', { exact: true })).toHaveValue('12');
  await output.getByText('纹理位置与范围', { exact: true }).click();
  await expect(output.getByRole('combobox', { name: '纹理应用范围', exact: true })).toHaveValue('margins');
  const saved = output.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/api/mewiki/export-profiles'));
  await save(output, '水彩与纸纹');
  const original = (await saved).postDataJSON().profiles.at(-1).options;
  expect(original).not.toHaveProperty('texture');
  expect(original.textureLayers).toMatchObject([{ kind: 'watercolor', opacity: 25, scope: 'all' }, { kind: 'paper', opacity: 12, scope: 'margins' }]);
  await output.getByRole('button', { name: '上移纹理图层', exact: true }).click();
  await expect(list.getByRole('button').first()).toHaveAttribute('aria-label', '编辑纹理图层 1：暖白纸纹');
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '恢复模板样式', exact: true }).click();
  await expect(list.getByRole('button').first()).toHaveAttribute('aria-label', '编辑纹理图层 1：边缘水彩');
  const download = output.waitForEvent('download');
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(backup.profile.options).toEqual(original);
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:clear');
  await expect(list.getByRole('button')).toHaveCount(1);
  await output.getByRole('button', { name: '模板操作', exact: true }).click(); await output.getByRole('button', { name: '导入模板', exact: true }).click();
  await output.locator('input[type=file][aria-label="导入模板"]').setInputFiles({ name: 'layers.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(output.getByRole('status')).toContainText('个人模板已导入'); await expect(list.getByRole('button')).toHaveCount(2);
  await expect.poll(() => output.locator('iframe[title="样板内容预览"]').evaluate(element => (element as HTMLIFrameElement).contentDocument?.querySelectorAll('.publication-page .publication-texture-layer').length)).toBe(2);
  await output.screenshot({ path: test.info().outputPath('texture-layers-desktop.png') });
  for (const format of ['png', 'jpeg']) {
    if (format === 'jpeg') {
      await output.getByRole('group', { name: '画幅', exact: true }).locator(':scope > summary').click();
      await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
      await output.getByRole('combobox', { name: '图片格式', exact: true }).selectOption('jpeg');
    }
    const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
    await output.getByRole('button', { name: '生成预览', exact: true }).click();
    expect((await submitted).postDataJSON().options.textureLayers).toEqual(original.textureLayers);
    const image = output.getByAltText('导出预览第 1 页', { exact: true }); await expect(image).toBeVisible({ timeout: 30000 });
    const bitmap = Buffer.from((await image.getAttribute('src'))!.split(',')[1], 'base64'); expect((await sharp(bitmap).metadata()).format).toBe(format);
    await writeFile(test.info().outputPath(`texture-layers-export.${format}`), bitmap);
  }
  await output.getByRole('button', { name: '移除纹理图层', exact: true }).click(); await expect(list.getByRole('button')).toHaveCount(1);
  await output.getByRole('button', { name: '移除纹理图层', exact: true }).click();
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('none');
  await expect(output.getByRole('button', { name: '移除纹理图层', exact: true })).toBeDisabled();
});

test('discards a delayed image draft when selecting a different texture layer', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '纹理预设', exact: true }).selectOption('dots');
  await output.getByRole('button', { name: '添加纹理图层', exact: true }).click();
  await output.getByText('从本地图片制作纹理', { exact: true }).click();
  await output.evaluate(() => { const read = FileReader.prototype.readAsDataURL; FileReader.prototype.readAsDataURL = function(blob: Blob) { setTimeout(() => read.call(this, blob), 500); }; });
  const bitmap = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#998877' } }).png().toBuffer();
  await output.getByLabel('上传纹理图片', { exact: true }).setInputFiles({ name: 'delayed.png', mimeType: 'image/png', buffer: bitmap });
  await expect(output.getByRole('status')).toContainText('正在本地处理纹理');
  await output.getByRole('button', { name: '编辑纹理图层 2：点阵手帐', exact: true }).click();
  await output.getByText('从本地图片制作纹理', { exact: true }).click();
  await output.waitForTimeout(650);
  await expect(output.getByAltText('纹理裁切原图', { exact: true })).toHaveCount(0);
  await expect(output.getByRole('alert')).toHaveCount(0);
  await expect(output.getByRole('combobox', { name: '纹理预设', exact: true })).toHaveValue('dots');
});

test('supports six layers and keyboard reordering on a narrow English screen', async ({ page }) => {
  const output = await open(page); await output.setViewportSize({ width: 390, height: 844 });
  await output.evaluate(() => localStorage.setItem('mewiki:locale', 'en')); await output.reload();
  await output.locator('#publication-content-heading').click(); await output.locator('#publication-canvas-heading').click();
  const add = output.getByRole('button', { name: 'Add texture layer', exact: true });
  for (let i = 0; i < 6; i++) await add.click();
  await expect(add).toBeDisabled(); await expect(output.getByRole('group', { name: 'Texture layers', exact: true }).getByRole('button')).toHaveCount(6);
  await output.getByRole('combobox', { name: 'Texture preset', exact: true }).selectOption('dots');
  const down = output.getByRole('button', { name: 'Move texture layer down', exact: true }); await down.focus(); await output.keyboard.press('Enter');
  await expect(output.getByRole('button', { name: 'Edit texture layer 2: Dotted journal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.screenshot({ path: test.info().outputPath('texture-layers-mobile-en.png') });
});
