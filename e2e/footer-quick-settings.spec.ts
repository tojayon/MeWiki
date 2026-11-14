import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { closeSettingsPage, openSettingsSection } from './helpers/settings.ts';

async function setup(page: Page, options: { failSwitch?: boolean; failPluginSave?: boolean } = {}) {
  const makeState = (title: string, id: string) => {
    const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = id;
    state.notes = [{ ...createResearchNote(title), id, library: 'research', blocks: [{ id: `${id}-body`, type: 'paragraph', text: `${title}的独立正文。` }] }];
    return state;
  };
  await page.addInitScript(({ first, second, failPluginSave }) => {
    if (!sessionStorage.getItem('quick-settings-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(first));
      localStorage.setItem('mewiki:library:quick-second:notebook', JSON.stringify(second));
      localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'false');
      localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
      localStorage.setItem('mewiki:research-notebook-mode', 'read');
      localStorage.setItem('mewiki:locale', 'zh-CN');
      localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ 'org.mewiki.webbench': 'enabled' }));
      sessionStorage.setItem('quick-settings-seeded', 'true');
    }
    if (failPluginSave) {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'mewiki:plugins:v1') throw new DOMException('Storage unavailable', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }
  }, { first: makeState('快捷配置笔记', 'quick-note'), second: makeState('另一库的独立笔记', 'second-note'), failPluginSave: options.failPluginSave });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [
    { id: 'default', name: '快捷配置测试库', directory: null }, { id: 'quick-second', name: '另一资料库', directory: null },
  ], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => options.failSwitch && new URL(route.request().url()).searchParams.get('library') === 'quick-second'
    ? route.fulfill({ status: 500, json: { error: '目标资料库未能读取，已保留当前资料库。' } })
    : route.fulfill({ json: { directory: null, file: null } }));
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  const panel = page.getByTestId('research-notebook'), footer = panel.locator('.research-sidebar-footer');
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('快捷配置笔记');
  return { panel, footer };
}

test('changes language above its footer button without leaving the note or replacing the title input', async ({ page }, info) => {
  const { panel, footer } = await setup(page);
  await panel.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  const title = panel.getByLabel('笔记标题', { exact: true });
  await title.evaluate(element => element.setAttribute('data-preserve-title', 'true'));
  await title.fill('切换语言时保留的标题');
  const trigger = footer.getByRole('button', { name: '界面语言', exact: true });
  await trigger.click();
  const card = page.getByRole('dialog', { name: '界面语言', exact: true });
  await expect(card).toBeVisible(); await expect(page.getByTestId('mewiki-settings-page')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('page')).not.toBe('settings');
  expect((await card.boundingBox())!.y + (await card.boundingBox())!.height).toBeLessThan((await trigger.boundingBox())!.y);
  await card.getByRole('radio', { name: 'English', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(panel.getByLabel('Note title', { exact: true })).toHaveValue('切换语言时保留的标题');
  await expect(panel.getByLabel('Note title', { exact: true })).toHaveAttribute('data-preserve-title', 'true');
  await expect(page.getByRole('dialog', { name: 'Interface language', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('language-card-desktop.png') });
  await page.keyboard.press('Escape'); await expect(footer.getByRole('button', { name: 'Interface language', exact: true })).toBeFocused();
  await footer.getByRole('button', { name: 'Interface language', exact: true }).click();
  await panel.getByLabel('Note title', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Interface language', exact: true })).toBeHidden();
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(panel.getByLabel('Note title', { exact: true })).toHaveValue('切换语言时保留的标题');
});

test('switches libraries directly, saves the active edit and keeps both notebooks isolated', async ({ page }) => {
  const { panel, footer } = await setup(page);
  await panel.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  await panel.getByLabel('笔记标题', { exact: true }).fill('切库前保存的标题');
  await footer.locator('.mewiki-library-switcher').click();
  const card = page.getByRole('dialog', { name: '切换资料库', exact: true });
  await expect(card).toBeVisible(); await expect(card.getByRole('button', { name: '切换到快捷配置测试库', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: '切换到另一资料库', exact: true }).click();
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('另一库的独立笔记');
  await expect(card).toBeHidden(); await expect(page.getByTestId('mewiki-settings-page')).toBeHidden();
  await expect(footer.locator('.mewiki-library-switcher')).toBeFocused();
  expect(new URL(page.url()).searchParams.get('library')).toBe('quick-second');
  await footer.locator('.mewiki-library-switcher').click();
  await card.getByRole('button', { name: '切换到快捷配置测试库', exact: true }).click();
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('切库前保存的标题');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:library:quick-second:notebook')!).notes.find((note: { id: string }) => note.id === 'second-note').title)).toBe('另一库的独立笔记');
});

test('keeps a failed library switch in its card with the original note available', async ({ page }) => {
  const { panel, footer } = await setup(page, { failSwitch: true });
  await footer.locator('.mewiki-library-switcher').click();
  const card = page.getByRole('dialog', { name: '切换资料库', exact: true });
  await expect(card).toBeVisible(); await card.getByRole('button', { name: '切换到另一资料库', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('目标资料库未能读取');
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('快捷配置笔记');
  expect(new URL(page.url()).searchParams.get('library')).toBeNull();
  await card.getByRole('button', { name: '管理资料库', exact: true }).click();
  await expect(card).toBeHidden(); await expect(page.getByTestId('mewiki-library-manager')).toBeVisible();
});

test('keeps language choices correct after visiting full settings and closes the card on sidebar collapse', async ({ page }) => {
  const { panel, footer } = await setup(page);
  await openSettingsSection(page); await closeSettingsPage(page);
  const trigger = footer.getByRole('button', { name: '界面语言', exact: true });
  await trigger.click(); const card = page.getByRole('dialog', { name: '界面语言', exact: true });
  await expect(card.getByRole('radio', { name: '简体中文', exact: true })).toBeChecked();
  await card.getByRole('radio', { name: 'English', exact: true }).check();
  const englishCard = page.getByRole('dialog', { name: 'Interface language', exact: true });
  await expect(englishCard.getByRole('radio', { name: 'English', exact: true })).toBeChecked();
  await englishCard.getByRole('radio', { name: '简体中文', exact: true }).check();
  await expect(card.getByRole('radio', { name: '简体中文', exact: true })).toBeChecked();
  await card.getByRole('button', { name: '关闭卡片', exact: true }).click(); await expect(trigger).toBeFocused();
  await trigger.click(); await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await expect(card).toBeHidden(); await panel.getByRole('button', { name: '展开笔记左侧面板', exact: true }).click();
  await expect(card).toBeHidden();
});

test('returns focus to the collapsed sidebar switch after changing libraries in its temporary card', async ({ page }) => {
  const { panel, footer } = await setup(page);
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await panel.locator('.research-notebook-mode-tabs').getByRole('tab', { name: '研究记录', exact: true }).click();
  await footer.locator('.mewiki-library-switcher').click();
  await page.getByRole('dialog', { name: '切换资料库', exact: true }).getByRole('button', { name: '切换到另一资料库', exact: true }).click();
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('另一库的独立笔记');
  await expect(panel.getByRole('button', { name: '展开笔记左侧面板', exact: true })).toBeFocused();
  await expect(page.locator('.mewiki-footer-quick-panel')).toHaveCount(0);
});

test('toggles plugins in place and opens the full manager only on request', async ({ page }, info) => {
  const { panel, footer } = await setup(page), trigger = footer.getByRole('button', { name: '插件管理', exact: true });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'quick-note').blocks);
  await trigger.click(); const card = page.getByRole('dialog', { name: '插件管理', exact: true });
  await expect(card).toBeVisible(); await expect(page.getByTestId('mewiki-settings-page')).toBeHidden();
  const toggle = card.getByRole('switch', { name: 'WebBench 仿真回放', exact: true });
  await expect(toggle).toBeChecked(); await toggle.uncheck(); await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:plugins:v1')!)['org.mewiki.webbench'])).toBe('disabled');
  await toggle.check(); await expect(toggle).toBeChecked();
  await page.screenshot({ path: info.outputPath('plugins-card-desktop.png') });
  await card.getByRole('button', { name: '管理插件', exact: true }).click();
  await expect(page.getByTestId('mewiki-plugin-manager')).toBeVisible(); await expect(card).toBeHidden();
  await closeSettingsPage(page); await expect(trigger).toBeFocused();
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('快捷配置笔记');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'quick-note').blocks)).toEqual(before);
});

test('reports an unsaved plugin preference in the card and retains the previous state', async ({ page }) => {
  const { footer } = await setup(page, { failPluginSave: true });
  await footer.getByRole('button', { name: '插件管理', exact: true }).click();
  const card = page.getByRole('dialog', { name: '插件管理', exact: true }); await expect(card).toBeVisible();
  await card.getByRole('switch', { name: 'WebBench 仿真回放', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('浏览器未能保存插件设置');
  await expect(card.getByRole('switch', { name: 'WebBench 仿真回放', exact: true })).toBeChecked();
});

test('keeps one anchored card usable in a temporary sidebar on narrow and short screens', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 620 });
  const { panel, footer } = await setup(page);
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await panel.locator('.research-notebook-mode-tabs').getByRole('tab', { name: '研究记录', exact: true }).click();
  const language = footer.getByRole('button', { name: '界面语言', exact: true });
  await language.click(); await expect(page.getByRole('dialog', { name: '界面语言', exact: true })).toBeVisible();
  const plugins = footer.getByRole('button', { name: '插件管理', exact: true }); await plugins.click();
  const card = page.getByRole('dialog', { name: '插件管理', exact: true }); await expect(card).toBeVisible();
  await expect(page.locator('.mewiki-footer-quick-panel')).toHaveCount(1);
  await expect(panel.locator('.research-notebook-layout')).toHaveAttribute('data-left-peek', 'true');
  await page.screenshot({ path: info.outputPath('quick-card-narrow.png') });
  for (const height of [620, 230]) {
    await page.setViewportSize({ width: 390, height });
    await expect(card).toBeInViewport();
    await expect(card.getByRole('button', { name: '管理插件', exact: true })).toBeInViewport();
    const box = (await card.boundingBox())!, trigger = (await plugins.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(trigger.y); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('quick-card-short.png') });
  await page.keyboard.press('Escape'); await expect(card).toBeHidden(); await expect(plugins).toBeFocused();
  await expect(panel.locator('.research-notebook-layout')).toHaveAttribute('data-left-peek', 'true');
  await plugins.press('Enter'); await expect(card).toBeVisible(); await plugins.click(); await expect(card).toBeHidden();
  await language.click(); await page.keyboard.press('Control+,');
  await expect(page.getByTestId('mewiki-settings-page')).toBeVisible(); await expect(page.locator('.mewiki-footer-quick-panel')).toHaveCount(0);
  await closeSettingsPage(page); await expect(page.locator('.mewiki-footer-quick-panel')).toHaveCount(0);
});
