import { expect, test, type Page } from '@playwright/test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runNotebookAction } from './helpers/researchNotebook.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';
import { defaultPublicationFrame, publicationFrameLayout, publicationFrames } from '../src/domain/publicationFrames.ts';
import { defaultPublicationTexture } from '../src/domain/publicationTextures.ts';
import { publicationHtml } from '../server/publicationHtml.ts';
import { publicationPagination } from '../server/publicationPagination.ts';

const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/media-e2e-settings.json');
test.beforeEach(async () => {
  expect(settings.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  await rm(settings, { force: true });
  await rm(settings + '.export-profiles', { recursive: true, force: true });
});
async function open(page: Page) {
  await page.goto('/'); await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'device-frame-note', title: '让知识被看见', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [
      { id: 'intro', type: 'paragraph', text: '把阅读体验放进设备屏幕，展示 **MeWiki** 的知识整理方式。' },
      { id: 'tips', type: 'callout', title: '分享提示', text: '正文与网页共用样式，内容保持清晰。' },
    ] }];
    state.activeNoteId = 'device-frame-note'; state.view = 'notes'; localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload(); const opened = page.waitForEvent('popup');
  await runNotebookAction(page.getByTestId('research-notebook'), '社交图文导出');
  const output = await opened; await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  return output;
}
async function sample(output: Page) {
  return output.locator('iframe[title="样板内容预览"]').evaluate(element => {
    const frame = element as HTMLIFrameElement, doc = frame.contentDocument;
    const device = doc?.querySelector<HTMLElement>('.publication-frame-device');
    const page = doc?.querySelector<HTMLElement>('.publication-page');
    const sheet = doc?.querySelector<HTMLElement>('.publication-sheet');
    const shell = doc?.querySelector('.publication-frame-shell');
    return { id: device?.dataset.deviceFrame ?? '', shape: shell ? frame.contentWindow!.getComputedStyle(shell).getPropertyValue('corner-shape') : '', background: page ? frame.contentWindow!.getComputedStyle(page).backgroundColor : '', sheetWidth: sheet?.clientWidth ?? 0, width: page?.clientWidth ?? 0, height: page?.clientHeight ?? 0 };
  });
}
async function save(output: Page, name: string) {
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '保存当前配置为个人模板', exact: true }).click();
  await output.getByLabel('模板名称', { exact: true }).fill(name);
  await output.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(output.getByRole('status')).toContainText('个人模板已保存');
}

test('updates the sample before generation, saves frame settings and restores portable personal templates', async ({ page }) => {
  const output = await open(page), picker = output.getByRole('combobox', { name: '设备边框', exact: true });
  await expect(picker).toHaveValue('none');
  for (const { id } of publicationFrames) {
    await picker.selectOption(id);
    await expect.poll(async () => (await sample(output)).id).toBe(id);
    await expect.poll(async () => (await sample(output)).shape).toBe('superellipse(1.6)');
  }
  await picker.selectOption('phone');
  await output.getByLabel('设备大小', { exact: true }).fill('85');
  await output.getByLabel('设备阴影', { exact: true }).fill('20');
  await output.getByLabel('屏幕内容缩放', { exact: true }).fill('110');
  await output.getByLabel('设备外背景', { exact: true }).fill('#e7edf4');
  await expect.poll(async () => (await sample(output)).background).toBe('rgb(231, 237, 244)');
  await expect.poll(async () => (await sample(output)).sheetWidth).toBe(Math.round(1080 / 1.1));
  await save(output, '手机宣传图');
  const downloaded = output.waitForEvent('download');
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '导出模板', exact: true }).click();
  const backup = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'));
  expect(backup.profile.options.frame).toEqual({ id: 'phone', background: '#e7edf4', scale: 85, shadow: 20, contentScale: 110 });
  expect(backup).not.toHaveProperty('document');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption('system:mewiki');
  await expect(picker).toHaveValue('none');
  await expect.poll(async () => (await sample(output)).id).toBe('');
  await output.getByRole('combobox', { name: '选择模板', exact: true }).selectOption({ label: '手机宣传图' });
  await expect(picker).toHaveValue('phone');
  await expect(output.getByLabel('设备大小', { exact: true })).toHaveValue('85');
  await output.getByRole('button', { name: '模板操作', exact: true }).click();
  await output.getByRole('button', { name: '导入模板', exact: true }).click();
  await output.locator('input[type=file][aria-label="导入模板"]').setInputFiles({ name: 'phone.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(output.getByRole('status')).toContainText('个人模板已导入');
  await expect.poll(async () => (await sample(output)).id).toBe('phone');
  await output.getByRole('group', { name: '内容', exact: true }).locator(':scope > summary').click();
  await output.screenshot({ path: test.info().outputPath('device-frame-desktop.png') });
});

test('keeps complete content, page numbers and screen textures inside every device at exact output dimensions', async ({ page }) => {
  for (const { id } of publicationFrames) {
    const text = 'Screen content remains complete after pagination. '.repeat(35);
    const options = { ...defaultPublicationOptions(), width: 900, height: 1200, fontSize: 28, margin: 48, cover: true, frame: { ...defaultPublicationFrame(id), shadow: 0 }, texture: { ...defaultPublicationTexture('grid'), opacity: 20 } };
    const document = { title: 'Product showcase', text, blocks: [{ id: 'first', kind: 'markdown' as const, content: text }, { id: 'last', kind: 'markdown' as const, content: 'Final paragraph.', breakBefore: true }] };
    await page.setContent(await publicationHtml({ document, options }));
    const sizes = await page.evaluate(`${publicationPagination}(${JSON.stringify({ options, title: document.title })})`);
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    for (const size of sizes) expect(size).toEqual({ width: 900, height: 1200 });
    await expect(page.locator('.publication-page .publication-frame-device')).toHaveCount(sizes.length);
    await expect(page.locator('.publication-sheet > .publication-texture-background')).toHaveCount(sizes.length);
    const paragraphs = await page.locator('.publication-page .page-body > p').allTextContents();
    expect(paragraphs.join('')).toBe(text.trimEnd() + 'Final paragraph.');
    await expect(page.locator('.publication-page .page-number').last()).toHaveText(`${sizes.length} / ${sizes.length}`);
    const bounds = await page.locator('.publication-page').first().evaluate(element => {
      const screen = element.querySelector('.publication-frame-screen')!.getBoundingClientRect(), body = element.querySelector('.page-body')!.getBoundingClientRect(), sheet = element.querySelector('.publication-sheet')!.getBoundingClientRect();
      return { screen: { x: screen.x, y: screen.y, width: screen.width, height: screen.height }, body: { x: body.x, y: body.y, right: body.right, bottom: body.bottom }, sheet: { width: sheet.width, height: sheet.height } };
    });
    expect(bounds.body.x).toBeGreaterThan(bounds.screen.x); expect(bounds.body.right).toBeLessThan(bounds.screen.x + bounds.screen.width);
    expect(bounds.body.y).toBeGreaterThan(bounds.screen.y); expect(bounds.body.bottom).toBeLessThan(bounds.screen.y + bounds.screen.height);
    expect(bounds.sheet.width).toBeCloseTo(bounds.screen.width, 1); expect(bounds.sheet.height).toBeCloseTo(bounds.screen.height, 1);
    const bitmap = await page.locator('.publication-page').first().screenshot();
    expect(await sharp(bitmap).metadata()).toMatchObject({ width: 900, height: 1200 });
    const { data } = await sharp(bitmap).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([237, 240, 244]);
    const layout = publicationFrameLayout(options)!;
    const x = Math.round(layout.left + (layout.device.shell.x + layout.device.shell.width / 2) * layout.unit);
    const y = Math.round(layout.top + (layout.device.shell.y + 8) * layout.unit);
    expect([...data.subarray((y * 900 + x) * 3, (y * 900 + x) * 3 + 3)]).not.toEqual([237, 240, 244]);
    await writeFile(test.info().outputPath(`${id}.png`), bitmap);
    await test.info().attach(`${id}.png`, { body: bitmap, contentType: 'image/png' });
  }
});

test('keeps headers, footers and body corners inside a rounded phone screen at minimum margins', async ({ page }) => {
  const logo = 'data:image/png;base64,' + (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#173454' } }).png().toBuffer()).toString('base64');
  for (const id of ['phone', 'phone-landscape'] as const) {
    const options = { ...defaultPublicationOptions(), width: 1920, height: 1080, margin: 16, fontSize: 20, logo, header: 'Product', author: 'Author', footer: 'MeWiki', frame: defaultPublicationFrame(id) };
    await page.setContent(await publicationHtml({ document: { title: 'Safe area', text: 'Complete content', blocks: [{ id: 'a', kind: 'markdown', content: 'Complete content' }] }, options }));
    await page.evaluate(`${publicationPagination}(${JSON.stringify({ options, title: 'Safe area' })})`);
    const safe = await page.locator('.publication-page').first().evaluate(element => {
      const screen = element.querySelector('.publication-frame-screen')!, bounds = screen.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(screen).borderTopLeftRadius) * bounds.width / screen.clientWidth;
      const inside = (x: number, y: number) => {
        const dx = Math.max(0, radius - (x - bounds.x), radius - (bounds.right - x));
        const dy = Math.max(0, radius - (y - bounds.y), radius - (bounds.bottom - y));
        return !dx || !dy || dx * dx + dy * dy <= radius * radius + .1;
      };
      return [...element.querySelectorAll('.page-header,.page-footer,.page-body')].every(child => {
        const rect = child.getBoundingClientRect();
        return [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]].every(([x, y]) => inside(x, y));
      });
    });
    expect(safe, id).toBe(true);
  }
});

test('renders aligned continuous phone corners at final resolution in both orientations', async ({ page }) => {
  expect(await page.evaluate(() => CSS.supports('corner-shape', 'superellipse(1.6)'))).toBe(true);
  for (const id of ['phone', 'phone-landscape'] as const) for (const [width, height] of [[720, 960], [1080, 1440], [1440, 1920]]) {
    const options = { ...defaultPublicationOptions(), width, height, frame: { ...defaultPublicationFrame(id), background: '#0055d7', shadow: 0 } };
    await page.setContent(await publicationHtml({ document: { title: 'Continuous corners', text: 'Preview', blocks: [{ id: 'a', kind: 'markdown', content: 'Preview' }] }, options }));
    await page.evaluate(`${publicationPagination}(${JSON.stringify({ options, title: 'Continuous corners' })})`);
    const geometry = await page.locator('.publication-frame-device').first().evaluate(element => {
      const shell = element.querySelector('.publication-frame-shell')!, screen = element.querySelector('.publication-frame-screen')!;
      const outer = shell.getBoundingClientRect(), inner = screen.getBoundingClientRect();
      const outerStyle = getComputedStyle(shell), innerStyle = getComputedStyle(screen);
      const ro = parseFloat(outerStyle.borderTopLeftRadius), ri = parseFloat(innerStyle.borderTopLeftRadius);
      return { shape: outerStyle.getPropertyValue('corner-shape'), innerShape: innerStyle.getPropertyValue('corner-shape'), ro, ri,
        outer: { left: outer.left, top: outer.top, right: outer.right, bottom: outer.bottom },
        inner: { left: inner.left, top: inner.top, right: inner.right, bottom: inner.bottom },
        centers: [[outer.left + ro, inner.left + ri], [outer.top + ro, inner.top + ri], [outer.right - ro, inner.right - ri], [outer.bottom - ro, inner.bottom - ri]] };
    });
    expect(geometry.shape).toBe('superellipse(1.6)'); expect(geometry.innerShape).toBe(geometry.shape);
    for (const [outer, inner] of geometry.centers) expect(outer).toBeCloseTo(inner, 1);
    const insets = [geometry.inner.left - geometry.outer.left, geometry.inner.top - geometry.outer.top, geometry.outer.right - geometry.inner.right, geometry.outer.bottom - geometry.inner.bottom];
    for (const inset of insets) expect(inset).toBeCloseTo(geometry.ro - geometry.ri, 1);
    const bitmap = await page.locator('.publication-page').first().screenshot();
    const { data } = await sharp(bitmap).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // This point is inside a continuous superellipse, outside an ordinary circular corner.
    const delta = geometry.ro * .24;
    for (const [x, y] of [[geometry.outer.left + delta, geometry.outer.top + delta], [geometry.outer.right - delta, geometry.outer.top + delta], [geometry.outer.left + delta, geometry.outer.bottom - delta], [geometry.outer.right - delta, geometry.outer.bottom - delta]]) {
      const offset = (Math.floor(y) * width + Math.floor(x)) * 3;
      expect(data[offset + 2]).toBeLessThan(150);
    }
    if (width === 1080) await writeFile(test.info().outputPath(`${id}-continuous-corners.png`), bitmap);
  }
});

test('exports native content in a real image, invalidates old results and restores the frame after long mode', async ({ page }) => {
  const output = await open(page);
  await output.getByRole('combobox', { name: '设备边框', exact: true }).selectOption('phone');
  const submitted = output.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/mewiki/publications/jobs'));
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  expect((await submitted).postDataJSON().options.frame.id).toBe('phone');
  const result = output.getByAltText('导出预览第 1 页', { exact: true }); await expect(result).toBeVisible({ timeout: 30000 });
  const bitmap = Buffer.from((await result.getAttribute('src'))!.split(',')[1], 'base64');
  expect(await sharp(bitmap).metadata()).toMatchObject({ format: 'png', width: 1080, height: 1440 });
  await writeFile(test.info().outputPath('phone-native.png'), bitmap);
  await test.info().attach('phone-native.png', { body: bitmap, contentType: 'image/png' });
  await output.getByLabel('设备大小', { exact: true }).fill('90');
  await expect(output.getByRole('tab', { name: '样式预览', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(output.getByRole('button', { name: '下载全部图片 ZIP', exact: true })).toBeDisabled();
  await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('long');
  await expect(output.getByRole('combobox', { name: '设备边框', exact: true })).toBeDisabled();
  await expect(output.getByText('连续长图暂不套用设备边框，切回多页图片后恢复。', { exact: true })).toBeVisible();
  await expect.poll(async () => (await sample(output)).id).toBe('');
  await output.getByRole('combobox', { name: '图片格式', exact: true }).selectOption('jpeg');
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(result).toBeVisible({ timeout: 30000 });
  expect(await sharp(Buffer.from((await result.getAttribute('src'))!.split(',')[1], 'base64')).metadata()).toMatchObject({ format: 'jpeg', width: 1080 });
  await output.getByRole('combobox', { name: '导出形式', exact: true }).selectOption('pages');
  await expect.poll(async () => (await sample(output)).id).toBe('phone');
  await expect(output.getByLabel('设备大小', { exact: true })).toHaveValue('90');
  await output.getByRole('combobox', { name: '设备边框', exact: true }).selectOption('laptop');
  await output.getByRole('combobox', { name: '画面比例', exact: true }).selectOption('16:9');
  await output.getByLabel('屏幕内容缩放', { exact: true }).fill('115');
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(result).toBeVisible({ timeout: 30000 });
  const laptop = Buffer.from((await result.getAttribute('src'))!.split(',')[1], 'base64');
  expect(await sharp(laptop).metadata()).toMatchObject({ format: 'jpeg', width: 1920, height: 1080 });
  await writeFile(test.info().outputPath('laptop-native.jpg'), laptop);
  await test.info().attach('laptop-native.jpg', { body: laptop, contentType: 'image/jpeg' });
});

test('keeps frame controls usable by keyboard on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const output = await open(page); await output.setViewportSize({ width: 390, height: 844 });
  await output.getByRole('group', { name: '内容', exact: true }).locator(':scope > summary').click();
  const picker = output.getByRole('combobox', { name: '设备边框', exact: true });
  await picker.focus(); await picker.press('Home'); await picker.press('ArrowDown'); await picker.press('Enter');
  await expect(picker).toHaveValue('phone');
  await expect.poll(async () => (await sample(output)).id).toBe('phone');
  const scale = output.getByLabel('设备大小', { exact: true }); await scale.focus(); await scale.press('Home'); await scale.press('ArrowRight');
  await expect(scale).toHaveValue('61');
  const dimensions = await output.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  await output.getByRole('tab', { name: '样式预览', exact: true }).scrollIntoViewIfNeeded();
  await output.screenshot({ path: test.info().outputPath('device-frame-mobile.png'), fullPage: true });
});
