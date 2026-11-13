import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { closeSettingsPage, openSettingsSection } from './helpers/settings.ts';
import { openNotebookMoreMenu } from './helpers/researchNotebook.ts';

type FontProbe = { waiting: boolean; released: boolean; frames: number; paintedBeforeReady: boolean; release?: () => void };
type ProbeWindow = Window & { fontProbe?: FontProbe };
function pauseFont(family: string) {
  const state: FontProbe = { waiting: false, released: false, frames: 0, paintedBeforeReady: false };
  (window as ProbeWindow).fontProbe = state;
  const load = FontFace.prototype.load;
  FontFace.prototype.load = async function () {
    const face = await load.call(this);
    if (this.family === family) {
      state.waiting = true;
      await new Promise<void>(resolve => { state.release = () => { FontFace.prototype.load = load; state.released = true; resolve(); }; });
    }
    return face;
  };
  const probe = () => {
    if (state.waiting && !state.released) {
      state.frames++;
      const text = document.querySelector('.research-note-title');
      let visible = !!text;
      for (let node = text; node; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (css.opacity === '0' || css.visibility === 'hidden' || css.display === 'none') visible = false;
      }
      if (visible && text && !getComputedStyle(text).fontFamily.includes(family)) state.paintedBeforeReady = true;
    }
    if (!state.released) requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
}
const waiting = (page: Page) => expect.poll(() => page.evaluate(() => (window as ProbeWindow).fontProbe?.waiting)).toBe(true);
const release = (page: Page) => page.evaluate(() => (window as ProbeWindow).fontProbe?.release?.());

async function fixture(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeVisible();
  const state = createNotebookFixture();
  state.notes = [{ id: 'font-loading-demo', title: '字体加载示例 Font Sample', library: 'research', createdAt: '2026-11-12', updatedAt: '2026-11-12', blocks: [
    { id: 'font-body', type: 'paragraph', text: 'Readable text，界面与正文 `inlineCode`。' },
    { id: 'font-code', type: 'markdown', kind: 'code', text: '```js\nconst value = 1;\n```' },
  ] }];
  state.activeNoteId = 'font-loading-demo'; state.view = 'notes';
  await page.evaluate(state => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' }));
  }, state);
  await page.reload();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue(state.notes[0].title);
}
async function importFont(page: Page, file = 'KaTeX_Main-Regular.ttf') {
  const bytes = await readFile(`node_modules/katex/dist/fonts/${file}`);
  const id = createHash('sha256').update(bytes).digest('hex');
  await page.getByLabel('导入字体文件', { exact: true }).setInputFiles({ name: file, mimeType: 'font/ttf', buffer: bytes });
  await expect(page.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(page.getByRole('button', { name: '下载原字体', exact: true })).toBeEnabled();
  return { id, family: `MeWikiUserFont_${id}` };
}

test.beforeEach(async () => { await rm(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/media-e2e-settings.json', { force: true }); });

test('never paints notebook text in a fallback font while a saved font decodes on refresh', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const { family } = await importFont(page);
  await closeSettingsPage(page);
  await page.addInitScript(pauseFont, family);
  await page.reload();
  await waiting(page);
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).fontProbe!.frames)).toBeGreaterThan(3);
  expect(await page.evaluate(() => (window as ProbeWindow).fontProbe!.paintedBeforeReady)).toBe(false);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await release(page);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveCSS('font-family', new RegExp(family));
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.locator('#root')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family && face.status === 'loaded'), family)).toBe(true);
});

test('keeps the old face until a newly selected font is ready', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const first = await importFont(page);
  const second = await importFont(page, 'KaTeX_Main-Italic.ttf');
  const choice = page.getByLabel('界面与正文字体', { exact: true });
  const heading = page.getByRole('heading', { name: '通用', exact: true });
  await choice.selectOption(`font:${first.id}`);
  await expect(heading).toHaveCSS('font-family', new RegExp(first.family));
  await page.evaluate(pauseFont, second.family);
  await choice.selectOption(`font:${second.id}`);
  await waiting(page);
  await expect(heading).toHaveCSS('font-family', new RegExp(first.family));
  expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family), first.family)).toBe(true);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await release(page);
  await expect(heading).toHaveCSS('font-family', new RegExp(second.family));
  expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family), first.family)).toBe(false);
});

test('loads bundled default glyphs before revealing the application and uses no remote fonts', async ({ page }) => {
  const pending: Route[] = []; let released = false;
  const fontHosts = new Set<string>();
  page.on('request', request => { if (request.resourceType() === 'font') fontHosts.add(new URL(request.url()).hostname); });
  await page.route(/\/noto-sans-sc-[^/]+\.woff2/, route => { if (released) return route.continue(); pending.push(route); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('笔记标题', { exact: true })).toBeAttached();
  await expect.poll(() => pending.length).toBeGreaterThan(0);
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.locator('#root')).toHaveCSS('opacity', '0');
  released = true;
  await Promise.all(pending.map(route => route.continue()));
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveCSS('font-family', /Noto Sans SC Variable/);
  expect(await page.evaluate(() => document.fonts.check('400 14px "Noto Sans SC Variable"', '字体界面'))).toBe(true);
  expect([...fontHosts]).toEqual(['127.0.0.1']);
});

test('waits for unused bundled glyphs before switching back to the default font', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const { family } = await importFont(page);
  const pending = new Promise<Route>(resolve => { void page.route('**/delayed-default-font.woff2', resolve); });
  // Recreate a not-yet-requested local subset independently of the browser cache.
  await page.evaluate(() => {
    for (const face of document.fonts) if (face.family.includes('Noto Sans SC Variable')) document.fonts.delete(face);
    document.fonts.add(new FontFace('Noto Sans SC Variable', `url("${location.origin}/delayed-default-font.woff2")`, { weight: '100 900' }));
  });
  await page.getByLabel('界面与正文字体', { exact: true }).selectOption('default');
  const request = await pending;
  const heading = page.getByRole('heading', { name: '通用', exact: true });
  await expect(heading).toHaveCSS('font-family', new RegExp(family));
  expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family), family)).toBe(true);
  await request.fulfill({ status: 200, contentType: 'font/woff2', body: await readFile('node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-119-wght-normal.woff2') });
  await expect(heading).not.toHaveCSS('font-family', new RegExp(family));
  expect(await page.evaluate(() => document.fonts.check('400 14px "Noto Sans SC Variable"'))).toBe(true);
});

test('prepares placeholder glyphs before replacing a custom font', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const { family } = await importFont(page);
  const pending = new Promise<Route>(resolve => { void page.route('**/placeholder-font.woff2', resolve); });
  await page.evaluate(() => {
    const field = document.createElement('input'); field.placeholder = '龘'; document.getElementById('root')!.append(field);
    document.fonts.add(new FontFace('Noto Sans SC Variable', `url("${location.origin}/placeholder-font.woff2")`, { weight: '100 900', unicodeRange: 'U+9F98' }));
  });
  await page.getByLabel('界面与正文字体', { exact: true }).selectOption('default');
  const request = await pending;
  const heading = page.getByRole('heading', { name: '通用', exact: true });
  await expect(heading).toHaveCSS('font-family', new RegExp(family));
  await request.fulfill({ status: 200, contentType: 'font/woff2', body: await readFile('node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-119-wght-normal.woff2') });
  await expect(heading).not.toHaveCSS('font-family', new RegExp(family));
});

test('releases initial display after one deadline when bundled fonts stall', async ({ page }) => {
  await page.route(/\/noto-sans-sc-[^/]+\.woff2/, () => {});
  await page.goto('/?page=settings&section=general', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await expect(page.getByRole('alert')).toContainText('字体加载超时', { timeout: 14000 });
  await expect(page.locator('#root')).not.toHaveAttribute('inert', { timeout: 1500 });
  await expect(page.locator('#root')).toHaveCSS('opacity', '1');
});

test('unblocks a stalled font with a clear fallback and ignores its late decode', async ({ page }) => {
  await fixture(page);
  await openSettingsSection(page, 'general');
  const { id, family } = await importFont(page);
  await page.addInitScript(pauseFont, family);
  await page.reload();
  await waiting(page);
  await expect(page.getByRole('alert')).toContainText('字体加载超时', { timeout: 15000 });
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.getByLabel('界面与正文字体', { exact: true })).toHaveValue(`font:${id}`);
  await expect(page.getByRole('heading', { name: '通用', exact: true })).toHaveCSS('font-family', /Noto Sans SC Variable/);
  await release(page);
  expect(await page.evaluate(family => [...document.fonts].some(face => face.family === family), family)).toBe(false);
});

test('shares typography with standalone export UI and original reading while templates stay independent', async ({ page }) => {
  await fixture(page);
  const original = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  await openSettingsSection(page, 'general');
  const { family, id } = await importFont(page);
  await page.getByLabel('界面字号', { exact: true }).selectOption('20');
  await page.getByLabel('正文字号', { exact: true }).selectOption('24');
  await closeSettingsPage(page);
  const opened = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await opened;
  const choice = output.getByLabel('选择模板', { exact: true });
  await expect(choice).toHaveCSS('font-family', new RegExp(family));
  await choice.selectOption({ label: 'MeWiki 原生' });
  await expect(output.locator('html')).toHaveCSS('font-size', '20px');
  await expect(output.locator('.mewiki-publication-toolbar').first()).toHaveCSS('height', '44px');
  const templateSize = await output.getByLabel('正文字号', { exact: true }).inputValue();
  const sample = output.frameLocator('iframe[title="样板内容预览"]');
  await expect(sample.locator('body')).not.toHaveCSS('font-family', new RegExp(family));
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  const source = output.locator('.mewiki-publication-source-paper [data-block-id="font-body"] p');
  const capture = output.locator('.publication-reading-surface [data-block-id="sample-paragraph"] p');
  await expect(source).toHaveCSS('font-family', new RegExp(family));
  await expect(source).toHaveCSS('font-size', '24px');
  await expect(capture).toHaveCSS('font-size', '15px');
  await expect(capture).not.toHaveCSS('font-family', new RegExp(family));
  await openSettingsSection(page, 'general');
  await page.getByLabel('界面字号', { exact: true }).selectOption('16');
  await page.getByLabel('正文字号', { exact: true }).selectOption('28');
  await page.getByLabel('界面与正文字体', { exact: true }).selectOption('default');
  await expect(choice).toHaveCSS('font-family', /Noto Sans SC Variable/);
  await expect(choice).not.toHaveCSS('font-family', new RegExp(family));
  await expect(output.locator('html')).toHaveCSS('font-size', '16px');
  await expect(source).toHaveCSS('font-size', '28px');
  await expect(capture).toHaveCSS('font-size', '15px');
  await expect(output.getByLabel('正文字号', { exact: true })).toHaveValue(templateSize);
  await output.getByLabel('本地字体', { exact: true }).selectOption(`font:${id}`);
  await expect(capture).toHaveCSS('font-family', new RegExp(family));
  const submitted = new Promise<Route>(resolve => {
    void output.route('**/api/mewiki/publications/jobs', route => { if (route.request().method() === 'POST') resolve(route); else return route.continue(); });
  });
  await output.getByRole('button', { name: '生成预览', exact: true }).click();
  const pending = await submitted;
  const actualCapture = output.locator('.publication-reading-surface [data-block-id="font-body"] p');
  await expect(actualCapture).toHaveCSS('font-size', '15px');
  await expect(actualCapture).toHaveCSS('font-family', new RegExp(family));
  expect(await actualCapture.evaluate(node => getComputedStyle(node).getPropertyValue('--mewiki-interface-unit'))).toBe('1px');
  expect(await actualCapture.evaluate(node => getComputedStyle(node).getPropertyValue('--mewiki-interface-font-size'))).toBe('14px');
  await pending.continue();
  await expect(output.getByAltText('导出预览第 1 页', { exact: true })).toBeVisible({ timeout: 60000 });
  await output.reload();
  await expect(output.locator('html')).toHaveCSS('font-size', '16px');
  await expect(choice).not.toHaveCSS('font-family', new RegExp(family));
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  await expect(source).toHaveCSS('font-size', '28px');
  await output.screenshot({ path: test.info().outputPath('shared-export-typography.png') });
  await output.setViewportSize({ width: 390, height: 844 });
  await expect(choice).toBeInViewport();
  expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await output.screenshot({ path: test.info().outputPath('shared-export-mobile.png') });
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toBe(original);
});
