import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';
import { openAiWorkspace } from './helpers/ai.ts';

async function setup(page: Page, english = false, outlineCollapsed = false) {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'chrome-note';
  state.notes = [{ ...createResearchNote('界面检查笔记'), id: 'chrome-note', library: 'research', blocks: [
    { id: 'chrome-heading', type: 'heading', level: 2, text: '笔记标题与正文' },
    { id: 'chrome-text', type: 'paragraph', text: '导航布局变化不会改写这段正文。' },
  ] }];
  state.symbols = [createSymbolEntry({ name: '界面检查符号', notation: 'x', meaning: '虚构符号', slots: [] }, 'chrome-symbol')];
  await page.addInitScript(({ state, english, outlineCollapsed }) => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'false');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', String(outlineCollapsed));
    localStorage.setItem('mewiki:manual-sidebar-open:default', 'false');
  }, { state, english, outlineCollapsed });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '导航检查资料库名称', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  const panel = page.getByTestId('research-notebook');
  await expect(panel.getByLabel(english ? 'Note title' : '笔记标题', { exact: true })).toHaveValue('界面检查笔记');
  return panel;
}

for (const english of [false, true]) {
  test(`unifies global icon actions and moves the manual to the footer in ${english ? 'narrow English' : 'desktop Chinese'}`, async ({ page }, info) => {
    if (english) await page.setViewportSize({ width: 390, height: 680 });
    const panel = await setup(page, english, true), footer = panel.locator('.research-sidebar-footer');
    const manualName = english ? 'User manual' : '使用手册', manual = footer.getByRole('button', { name: manualName, exact: true });
    await expect(manual).toBeVisible();
    await expect(panel.locator('.research-notebook-mode-tabs img')).toHaveCount(0);
    await expect(panel.locator('.research-reading-rail').getByRole('button', { name: manualName, exact: true })).toHaveCount(0);
    await expect(footer.getByRole('button').last()).toHaveAccessibleName(manualName);
    const actions = await footer.getByRole('button').all(); expect(actions).toHaveLength(6);
    for (const button of actions) {
      await expect(button).toBeInViewport(); await expect(button.locator('svg')).toHaveCount(1);
      expect((await button.textContent())?.trim()).toBe(''); expect(await button.getAttribute('title')).toBeTruthy();
      const box = (await button.boundingBox())!; expect(box.width).toBe(28); expect(box.height).toBe(28);
    }
    const status = panel.locator('.research-note-footer'); await expect(status).toHaveCSS('border-top-width', '0px');
    const backgrounds = await status.evaluate(element => {
      const color = (element: Element | null): string => {
        for (let current = element; current; current = current.parentElement) {
          const background = getComputedStyle(current).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
        }
        return '';
      };
      return [color(element), color(document.querySelector('.research-note-scroll'))];
    });
    expect(backgrounds[0]).toBe(backgrounds[1]);
    await expect(panel.locator('.research-notebook-actions').first()).toHaveCSS('border-left-width', '0px');
    await manual.click(); await expect(manual).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('#research-manual-sidebar')).toBeVisible();
    await expect(panel.getByLabel(english ? 'Note title' : '笔记标题', { exact: true })).toHaveValue('界面检查笔记');
    await page.screenshot({ path: info.outputPath(`workspace-footer-${english ? 'en' : 'zh'}.png`) });
    await manual.press('Enter'); await expect(panel.locator('#research-manual-sidebar')).toHaveCount(0);
    await footer.locator('.mewiki-library-switcher').click();
    const libraries = page.getByRole('dialog', { name: english ? 'Switch library' : '切换资料库', exact: true });
    await expect(libraries).toBeVisible();
    await libraries.getByRole('button', { name: english ? 'Manage libraries' : '管理资料库', exact: true }).click();
    await expect(page.getByTestId('mewiki-library-manager')).toBeVisible();
  });

  test(`keeps right tabs as keyboard-accessible icons with the collapse action aligned right in ${english ? 'narrow English' : 'desktop Chinese'}`, async ({ page }, info) => {
    if (english) await page.setViewportSize({ width: 390, height: 680 });
    const panel = await setup(page, english), header = panel.locator('#research-note-outline > header');
    const tabs = header.getByRole('tablist'), collapse = header.locator('.research-outline-toggle');
    const labels = english ? ['Outline', 'Backlinks', 'Variable recipe'] : ['大纲', '反向链接', '变量配方'];
    for (const label of labels) {
      const tab = tabs.getByRole('tab', { name: label, exact: true });
      await expect(tab).toHaveAttribute('title', label); await expect(tab.locator('svg')).toHaveCount(1);
      expect((await tab.textContent())?.trim()).toBe(''); await expect(tab).toBeInViewport();
    }
    const frame = (await header.boundingBox())!, button = (await collapse.boundingBox())!;
    expect(frame.x + frame.width - button.x - button.width).toBeLessThanOrEqual(12);
    expect((await tabs.boundingBox())!.x + (await tabs.boundingBox())!.width).toBeLessThanOrEqual(button.x);
    await tabs.getByRole('tab', { name: labels[0], exact: true }).focus(); await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: labels[1], exact: true })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: labels[1], exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End'); await expect(tabs.getByRole('tab', { name: labels[2], exact: true })).toBeFocused();
    await page.keyboard.press('Home'); await expect(tabs.getByRole('tab', { name: labels[0], exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath(`workspace-right-tabs-${english ? 'en' : 'zh'}.png`) });
    await collapse.click(); await expect(panel.locator('#research-note-outline')).toHaveCount(0);
    const expand = panel.locator('.research-sidebar-ribbon.is-right .research-outline-toggle');
    await expect(expand).toBeFocused(); await expand.press('Enter'); await expect(collapse).toBeFocused();
  });
}

test('uses the same icon tabs and right-aligned collapse action for symbol backlinks', async ({ page }, info) => {
  const panel = await setup(page);
  await panel.locator('.research-notebook-mode-tabs').getByRole('tab', { name: '符号', exact: true }).click();
  await panel.locator('#research-dictionary-sidebar').getByRole('button', { name: '界面检查符号', exact: true }).click();
  const header = panel.locator('#research-note-outline > header');
  for (const name of ['反向链接', '变量配方']) {
    const tab = header.getByRole('tab', { name, exact: true });
    await expect(tab.locator('svg')).toHaveCount(1); await expect(tab).toHaveAttribute('title', name);
  }
  const frame = (await header.boundingBox())!, button = (await header.locator('.research-outline-toggle').boundingBox())!;
  expect(frame.x + frame.width - button.x - button.width).toBeLessThanOrEqual(12);
  await header.getByRole('tab', { name: '反向链接', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(header.getByRole('tab', { name: '变量配方', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('workspace-symbol-tabs.png') });
});

test('keeps docked AI tabs consistent and preserves the chat while switching with the keyboard', async ({ page }, info) => {
  const panel = await setup(page), ai = await openAiWorkspace(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('切换图标标签时保留草稿');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  const header = ai.locator('> header'), tabs = header.getByRole('tablist');
  for (const name of ['大纲', '反向链接', '变量配方', '智能助理']) {
    const tab = tabs.getByRole('tab', { name, exact: true });
    await expect(tab.locator('svg')).toHaveCount(1); await expect(tab).toHaveAttribute('title', name);
    expect((await tab.textContent())?.trim()).toBe('');
  }
  const collapse = header.getByRole('button', { name: '收起AI 工作区', exact: true });
  const frame = (await header.boundingBox())!, button = (await collapse.boundingBox())!;
  expect(frame.x + frame.width - button.x - button.width).toBeLessThanOrEqual(12);
  await tabs.getByRole('tab', { name: '智能助理', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(panel.locator('#research-note-outline')).toBeVisible();
  const outlineTabs = panel.locator('#research-note-outline > header').getByRole('tablist');
  await expect(outlineTabs.getByRole('tab', { name: '大纲', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await expect(ai).toBeVisible();
  await expect(tabs.getByRole('tab', { name: '智能助理', exact: true })).toBeFocused();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('切换图标标签时保留草稿');
  await page.screenshot({ path: info.outputPath('workspace-ai-tabs.png') });
});
