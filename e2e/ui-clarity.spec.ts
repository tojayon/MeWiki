import { expect, test } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { openSettingsSection, closeSettingsPage } from './helpers/settings.ts';
import { openNotebookMoreMenu } from './helpers/researchNotebook.ts';

test.beforeEach(async ({ page }) => {
  const state = createNotebookFixture();
  state.terms = [{ id: 'ui-term', name: '界面设计', aliases: [], meaning: '用布局表达信息层级。', status: 'active' }];
  state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  await page.addInitScript(state => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'false');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '界面检查资料库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  page.on('pageerror', error => { throw error; });
});

test('uses the shared brand palette in the workspace and browser icon', async ({ page }, info) => {
  await page.goto('/');
  const notebook = page.getByTestId('research-notebook');
  const toolbar = notebook.locator('.research-notebook-toolbar');
  const selected = notebook.locator('.research-notebook-mode-tabs [aria-selected="true"]');
  await expect(toolbar).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(selected).toHaveCSS('color', 'rgb(1, 53, 124)');
  await expect(selected).toHaveCSS('background-color', 'rgb(240, 243, 247)');
  await expect(notebook.locator('.research-notebook-sidebar')).toHaveCSS('background-color', 'rgb(251, 252, 254)');

  const mark = page.locator('link[rel="icon"][type="image/svg+xml"]');
  const source = await (await page.request.get(await mark.getAttribute('href') ?? '')).text();
  expect(source).toContain('fill="#01357c"');
  expect(source).toContain('fill="#00a9f3"');
  await page.screenshot({ path: info.outputPath('workspace-palette-desktop.png') });

  await page.setViewportSize({ width: 390, height: 780 });
  await expect(toolbar).toBeVisible();
  await expect(selected).toHaveCSS('color', 'rgb(1, 53, 124)');
  await page.screenshot({ path: info.outputPath('workspace-palette-mobile.png') });
});

test('keeps term guidance optional while preserving a draft across language and width changes', async ({ page }, info) => {
  await page.goto('/');
  const notebook = page.getByTestId('research-notebook');
  await notebook.getByRole('tab', { name: '术语', exact: true }).click();
  await notebook.getByRole('button', { name: '界面设计', exact: true }).click();
  await notebook.getByRole('button', { name: '编辑术语', exact: true }).click();
  await notebook.getByRole('button', { name: '新增别名', exact: true }).click();
  await notebook.getByRole('textbox', { name: '别名 1', exact: true }).fill('清楚的界面');
  const trigger = notebook.getByRole('button', { name: '别名说明', exact: true });
  await trigger.click();
  const guidance = page.getByRole('dialog', { name: '别名说明', exact: true });
  await expect(guidance).toContainText('每行保存一个别名');
  await guidance.press('Escape');
  await expect(trigger).toBeFocused();
  await notebook.getByRole('textbox', { name: '术语含义', exact: true }).fill('待保存的布局定义。');
  await notebook.screenshot({ path: info.outputPath('dictionary-desktop.png') });
  const settings = await openSettingsSection(page);
  await settings.getByRole('radio', { name: /English/ }).check();
  await closeSettingsPage(page);
  await page.setViewportSize({ width: 390, height: 620 });
  await notebook.getByRole('button', { name: 'Collapse note left panel', exact: true }).click();
  await expect(notebook.getByRole('textbox', { name: 'Term meaning', exact: true })).toHaveValue('待保存的布局定义。');
  await expect(notebook.getByRole('textbox', { name: 'Alias 1', exact: true })).toHaveValue('清楚的界面');
  await notebook.getByRole('button', { name: 'Alias information', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Alias information', exact: true })).toContainText('alias');
  await page.screenshot({ path: info.outputPath('dictionary-english-mobile.png') });
  await page.keyboard.press('Escape');
  expect(await notebook.getByRole('region', { name: 'Term entry editor', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('keeps map roles visible and explains relations on demand', async ({ page }, info) => {
  await page.goto('/');
  const notebook = page.getByTestId('research-notebook');
  await notebook.getByRole('tab', { name: '理论地图', exact: true }).click();
  await notebook.getByRole('button', { name: '打开地图 全局地图', exact: true }).click();
  await notebook.getByRole('button', { name: '理论地图图例', exact: true }).click();
  await expect(notebook.locator('.theory-map-legend')).toContainText('内容角色');
  const trigger = notebook.getByRole('button', { name: '地图说明', exact: true });
  await trigger.click();
  const guidance = page.getByRole('dialog', { name: '地图说明', exact: true });
  await expect(guidance).toContainText('公式引用自动生成');
  await guidance.press('Escape');
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: info.outputPath('map-desktop.png') });
  await page.setViewportSize({ width: 390, height: 620 });
  await notebook.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await trigger.click();
  const box = (await guidance.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(11); expect(box.x + box.width).toBeLessThanOrEqual(379);
  await page.screenshot({ path: info.outputPath('map-mobile.png') });
  await guidance.press('Escape');
});

test('keeps settings concise with accessible on-demand guidance and intact controls', async ({ page }, info) => {
  await page.goto('/');
  const settings = await openSettingsSection(page);
  await settings.screenshot({ path: info.outputPath('settings-general.png') });
  await expect(settings.locator('.mewiki-settings-page-heading > p')).toHaveCount(0);
  const trigger = settings.getByRole('button', { name: '字体说明', exact: true });
  await trigger.click();
  const guidance = page.getByRole('dialog', { name: '字体说明', exact: true });
  await expect(guidance).toContainText('TTF、OTF、WOFF、WOFF2');
  await expect(guidance).toBeFocused();
  await guidance.press('Escape');
  await expect(guidance).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click();
  await settings.getByRole('combobox', { name: '界面与正文字体', exact: true }).click();
  await expect(guidance).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }]) {
    await page.setViewportSize(viewport);
    await trigger.click();
    const box = (await guidance.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(11); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 11);
    expect(box.y).toBeGreaterThanOrEqual(11); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 11);
    expect(await guidance.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`font-guidance-${viewport.width}.png`) });
    await guidance.press('Escape');
    expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await settings.getByRole('radio', { name: /English/ }).check();
  await expect(settings.getByRole('button', { name: 'Font information', exact: true })).toBeVisible();
  await settings.screenshot({ path: info.outputPath('settings-english-mobile.png') });
  await closeSettingsPage(page);
  await expect(page.getByTestId('research-notebook')).toBeVisible();
});

test('keeps export guidance beside its controls without covering the workspace', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.social-export': 'enabled' })));
  await page.goto('/');
  const popup = page.waitForEvent('popup');
  await (await openNotebookMoreMenu(page.getByTestId('research-notebook'))).getByRole('menuitem', { name: '社交图文导出', exact: true }).click();
  const output = await popup;
  await expect(output.getByTestId('mewiki-publication-page')).toBeVisible();
  const sampleTrigger = output.getByRole('button', { name: '样板说明', exact: true });
  await sampleTrigger.click();
  const sampleInfo = output.getByRole('dialog', { name: '样板说明', exact: true });
  await expect(sampleInfo).toContainText('实际内容与分页');
  await sampleInfo.press('Escape');
  await expect(sampleTrigger).toBeFocused();
  await expect(output.locator('.mewiki-publication-sample > p.mewiki-publication-hint')).toHaveCount(0);
  await output.getByRole('tab', { name: '选择内容', exact: true }).click();
  const selectionTrigger = output.getByRole('button', { name: '内容选择说明', exact: true });
  await selectionTrigger.click();
  const selectionInfo = output.getByRole('dialog', { name: '内容选择说明', exact: true });
  await expect(selectionInfo).toContainText('剪刀标记');
  await selectionInfo.press('Escape');
  await output.getByRole('button', { name: '清空选择', exact: true }).click();
  await output.getByRole('checkbox', { name: '导出此内容：1', exact: true }).check();
  await expect(output.getByRole('group', { name: '内容', exact: true })).toContainText('已选择 1 / 1 项');
  const textureTrigger = output.getByRole('button', { name: '纹理说明', exact: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }]) {
    await output.setViewportSize(viewport);
    await textureTrigger.click();
    const guidance = output.getByRole('dialog', { name: '纹理说明', exact: true });
    await expect(guidance).toContainText('最多叠加 6 层');
    const box = (await guidance.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(11); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 11);
    expect(box.y).toBeGreaterThanOrEqual(11); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 11);
    await output.screenshot({ path: info.outputPath(`export-guidance-${viewport.width}.png`) });
    await guidance.press('Escape');
    await expect(textureTrigger).toBeFocused();
    expect(await output.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await output.close();
});
