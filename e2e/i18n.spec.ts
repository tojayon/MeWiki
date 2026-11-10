import { expect, test } from '@playwright/test';

test.use({ locale: 'en-US' });

test('detects English and localizes navigation without translating saved manual content', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('tab', { name: 'Symbol dictionary', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Foundations', exact: true })).toBeVisible();
  expect(await page.locator('.research-notebook-mode-tabs button').evaluateAll(buttons => buttons.every(button => {
    const box = button.getBoundingClientRect(), text = button.querySelector('span')!.getBoundingClientRect();
    return text.left >= box.left - 1 && text.right <= box.right + 1;
  }))).toBe(true);
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('MeWiki 使用手册');
  await page.getByRole('button', { name: 'Interface language', exact: true }).click();
  const dialog = page.getByTestId('mewiki-language-settings');
  await dialog.getByRole('radio', { name: /简体中文/ }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('tab', { name: '符号词典', exact: true })).toBeVisible();
  await page.reload();
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

test('keeps language settings accessible in the compact menu and searches English content types', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Insert at end of note', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Insert note content', exact: true });
  await picker.getByRole('textbox').fill('formula');
  await expect(picker.getByRole('button', { name: 'Formula', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 680, height: 900 });
  await page.getByRole('button', { name: 'More note actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Interface language', exact: true }).click();
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
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('tab', { name: '符号词典', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:locale'))).toBeNull();
});

test('localizes built-in plugin details and the insertion entry without changing the provider id', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Plugin manager', exact: true }).click();
  const manager = page.getByTestId('mewiki-plugin-manager');
  await expect(manager.getByRole('heading', { name: 'WebBench simulation replay 1.0.0', exact: true })).toBeVisible();
  await expect(manager).toContainText('Save a real experiment');
  await manager.getByRole('button', { name: 'Install and enable', exact: true }).click();
  await manager.getByRole('button', { name: 'Close Plugin manager', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Insert at end of note', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Insert note content', exact: true });
  await expect(picker.getByRole('button', { name: 'Insert replay position', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:plugins:v1')!))).toEqual({ 'org.mewiki.webbench': 'enabled' });
});
