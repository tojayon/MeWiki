import { expect, type Page } from "@playwright/test";
import type { SettingsSection } from "../../src/state/settingsNavigation.ts";

const labels = {
  general: /^(通用|General)$/,
  libraries: /^(资料库管理|Libraries)$/,
  storage: /^(存储位置|Storage location)$/,
  backup: /^(备份与恢复|Backup and restore)$/,
  history: /^(历史版本|Version history)$/,
  plugins: /^(插件与集成|Plugins and integrations)$/,
  ai: /^(AI 服务|AI services)$/,
  about: /^(关于觅维|About MeWiki)$/,
};

export async function openSettingsSection(page: Page, section: SettingsSection = "general") {
  const settings = page.getByTestId("mewiki-settings-page");
  if (!(await settings.isVisible())) await page.keyboard.press("Control+,");
  await expect(settings).toBeVisible();
  const category = settings.getByRole("combobox", { name: /^(设置分类|Settings categories)$/ });
  if (await category.isVisible()) await category.selectOption(section);
  else await settings.getByRole("navigation", { name: /^(设置分类|Settings categories)$/ }).getByRole("link", { name: labels[section] }).click();
  return settings;
}

export async function closeSettingsPage(page: Page) {
  const settings = page.getByTestId("mewiki-settings-page");
  await settings.getByRole("button", { name: /^(返回笔记|Back to notes)$/ }).click();
  await expect(settings).toBeHidden();
}
