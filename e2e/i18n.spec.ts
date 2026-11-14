import { closeSettingsPage, openSettingsSection } from "./helpers/settings.ts";
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ locale: 'en-US' });

test('detects English and localizes navigation without translating saved manual content', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('MeWiki');
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', 'MeWiki');
  await expect(page.getByRole('tab', { name: 'Symbol', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Term', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Foundations', exact: true })).toBeVisible();
  expect(await page.locator('.research-notebook-mode-tabs [role="tab"]').evaluateAll(buttons => buttons.every(button => {
    const box = button.getBoundingClientRect(), icon = button.querySelector('svg')!.getBoundingClientRect();
    return !button.textContent?.trim() && button.getAttribute('aria-label') === button.getAttribute('title') && icon.left >= box.left && icon.right <= box.right;
  }))).toBe(true);
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('MeWiki 使用手册');
  await page.getByRole('button', { name: 'Interface language', exact: true }).click();
  const dialog = page.getByTestId('mewiki-language-settings');
  await dialog.getByRole('radio', { name: /简体中文/ }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle('觅维');
  await page.keyboard.press('Escape');
  const about = await openSettingsSection(page, 'about');
  await expect(about.locator('.mewiki-settings-brand')).toHaveText('觅维');
  await expect(about.getByRole('heading', { name: '关于觅维', exact: true })).toBeVisible();
  await expect(about.locator('.mewiki-settings-about h3')).toHaveText('觅维');
  await expect(about).toContainText('寻觅知识，以多维链接万物。');
  await page.screenshot({ path: info.outputPath('miwei-about-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await about.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('miwei-about-narrow.png') });
  await openSettingsSection(page, 'general');
  await about.getByRole('radio', { name: /English/ }).check();
  await expect(page).toHaveTitle('Settings · MeWiki');
  await openSettingsSection(page, 'about');
  await expect(about.locator('.mewiki-settings-about h3')).toHaveText('MeWiki');
  await expect(about).toContainText('Seek knowledge. Connect everything across dimensions.');
  await openSettingsSection(page, 'general');
  await about.getByRole('radio', { name: /简体中文/ }).check();
  await closeSettingsPage(page);
  await expect(page).toHaveTitle('觅维');
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', '觅维');
  await expect(page.getByRole('tab', { name: '符号', exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveTitle('觅维');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('MeWiki 使用手册');
});

test('updates an open property editor across windows while preserving its unsaved draft', async ({ page, context }) => {
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Note properties', exact: true }).click();
  const metadata = page.locator('.research-metadata-popover');
  await metadata.getByRole('button', { name: 'Edit metadata', exact: true }).click();
  await metadata.getByLabel('Metadata title', { exact: true }).fill('Private draft · 不要翻译');
  await second.getByRole('button', { name: 'Interface language', exact: true }).click();
  await second.getByRole('radio', { name: /简体中文/ }).check();
  await expect(metadata.getByLabel('元数据标题', { exact: true })).toHaveValue('Private draft · 不要翻译');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await metadata.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('MeWiki 使用手册');
});

test('keeps language settings in the left footer on narrow screens and searches English content types', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Insert at end of note', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Insert note content', exact: true });
  await picker.getByRole('textbox').fill('formula');
  await expect(picker.getByRole('button', { name: 'Formula', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 680, height: 900 });
  await page.locator('.research-sidebar-footer').getByRole('button', { name: 'Interface language', exact: true }).click();
  await expect(page.getByTestId('mewiki-language-settings')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('switches language for this session when saving its preference is denied', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'mewiki:locale') throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interface language', exact: true }).click();
  await page.getByRole('radio', { name: /简体中文/ }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: '符号', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:locale'))).toBeNull();
});

test('localizes built-in plugin details and the insertion entry without changing the provider id', async ({ page }) => {
  const webbenchManifest = JSON.parse(await readFile('plugins/webbench/manifest.json', 'utf8'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Plugin manager', exact: true }).click();
  await page.getByRole('dialog', { name: 'Plugin manager', exact: true }).getByRole('button', { name: 'Manage plugins', exact: true }).click();
  const manager = page.getByTestId('mewiki-plugin-manager');
  await expect(manager.getByRole('heading', { name: `WebBench simulation replay ${webbenchManifest.version}`, exact: true })).toBeVisible();
  await expect(manager).toContainText('Save a real experiment');
  await manager.locator('.mewiki-plugin-row').filter({ hasText: 'org.mewiki.webbench' }).getByRole('button', { name: 'Install and enable', exact: true }).click();
  await closeSettingsPage(page);
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Insert at end of note', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Insert note content', exact: true });
  await expect(picker.getByRole('button', { name: 'Insert replay position', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:plugins:v1')!))).toEqual({ 'org.mewiki.webbench': 'enabled' });
});
