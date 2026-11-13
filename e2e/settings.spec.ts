import { expect, test, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { closeSettingsPage, openSettingsSection } from "./helpers/settings.ts";

test.beforeEach(async ({ page }) => {
  await rm(path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || ".mewiki/media-e2e-settings.json"), { force: true });
  const state = createNotebookFixture();
  state.notes = [{ ...createResearchNote("设置页面示例"), id: "settings-demo", blocks: Array.from({ length: 35 }, (_, index) => ({ id: `settings-text-${index}`, type: "paragraph" as const, text: `第 ${index + 1} 段示例内容。设置与阅读应保留各自状态。` })) }];
  state.activeNoteId = "settings-demo"; state.view = "notes"; state.open = true;
  await page.addInitScript(state => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "false");
  }, state);
  page.on("pageerror", error => { throw error; });
});

async function expectNoOverflow(page: Page) {
  expect(await page.getByTestId("mewiki-settings-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("opens a full settings page, commits input and returns to the same note and scroll position", async ({ page }, info) => {
  await page.goto("/?workspace=org.mewiki.webbench");
  const panel = page.getByTestId("research-notebook");
  const title = panel.getByLabel("笔记标题", { exact: true });
  await expect(title).toHaveValue("设置页面示例");
  await panel.getByRole("button", { name: "切换为编辑模式", exact: true }).click();
  const scroll = panel.locator('[data-reading-pane-id="primary"] .research-note-scroll').first();
  await scroll.evaluate(element => { element.scrollTop = 600; });
  const position = await scroll.evaluate(element => element.scrollTop);
  await title.fill("进入设置前的标题修改");
  await title.press("Control+,");
  const settings = page.getByTestId("mewiki-settings-page");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "通用", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workspace")).toBe("org.mewiki.webbench");
  await expect(title).toBeHidden();
  await expectNoOverflow(page);
  await settings.screenshot({ path: info.outputPath("settings-desktop.png") });
  await closeSettingsPage(page);
  await expect(title).toHaveValue("进入设置前的标题修改");
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(position);
  await expect(title).toBeFocused();
});

test("searches settings across languages and preserves storage drafts between categories", async ({ page }) => {
  await page.goto("/");
  const settings = await openSettingsSection(page, "storage");
  await settings.getByLabel("本地保存路径", { exact: true }).fill("D:\\Examples\\Settings draft");
  await openSettingsSection(page, "general");
  await openSettingsSection(page, "storage");
  await expect(settings.getByLabel("本地保存路径", { exact: true })).toHaveValue("D:\\Examples\\Settings draft");
  await settings.getByRole("searchbox", { name: "搜索设置", exact: true }).fill("附件 ZIP");
  await settings.getByRole("button", { name: /完整备份与恢复/ }).click();
  await expect(settings.getByRole("heading", { name: "备份与恢复", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "导出含附件备份", exact: true })).toBeVisible();
  await openSettingsSection(page, "general");
  await settings.getByRole("radio", { name: /English/ }).check();
  await settings.getByRole("searchbox", { name: "Search settings", exact: true }).fill("BACKUP zip");
  await settings.getByRole("button", { name: /Full backup and restore/ }).click();
  await expect(settings.getByRole("heading", { name: "Backup and restore", exact: true })).toBeVisible();
  await settings.getByRole("searchbox", { name: "Search settings", exact: true }).fill("unmatched-setting");
  await expect(settings.getByRole("heading", { name: "No matching settings", exact: true })).toBeVisible();
  await settings.getByRole("searchbox", { name: "Search settings", exact: true }).press("Escape");
  await expect(settings.getByRole("heading", { name: "Backup and restore", exact: true })).toBeVisible();
});

test("supports direct settings links, reload, browser navigation and mobile categories", async ({ page }, info) => {
  await page.goto("/?page=settings&section=history&workspace=org.mewiki.webbench");
  const settings = page.getByTestId("mewiki-settings-page");
  await expect(settings.getByRole("heading", { name: "历史版本", exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(settings.getByRole("heading", { name: "历史版本", exact: true }).first()).toBeVisible();
  await closeSettingsPage(page);
  await page.keyboard.press("Control+,");
  await expect(settings).toBeVisible();
  await page.goBack();
  await expect(settings).toBeHidden();
  await page.goForward();
  await expect(settings).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const section of ["general", "libraries", "storage", "backup", "history", "plugins", "about"] as const) {
    await openSettingsSection(page, section);
    await expectNoOverflow(page);
  }
  await expect(settings).toContainText(/版本 \d+\.\d+\.\d+/);
  await openSettingsSection(page, "general");
  await settings.getByRole("switch", { name: "显示左侧导航", exact: true }).uncheck();
  await settings.screenshot({ path: info.outputPath("settings-mobile.png") });
  await closeSettingsPage(page);
  await expect(page.getByRole("button", { name: "展开笔记左侧面板", exact: true })).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(settings).toBeVisible();
});

test("keeps navigation unavailable while checking a storage path", async ({ page }) => {
  await page.goto("/");
  const settings = await openSettingsSection(page, "storage");
  let finishInspection!: () => void;
  const pending = new Promise<void>(resolve => { finishInspection = resolve; });
  await page.route("**/api/research-library/inspect", async route => {
    await pending;
    await route.fulfill({ json: { directory: "D:\\Examples\\Test library", exists: false, summary: null } });
  });
  try {
    await settings.getByLabel("本地保存路径", { exact: true }).fill("D:\\Examples\\Test library");
    await settings.getByRole("button", { name: "检查路径", exact: true }).click();
    await expect(settings.getByRole("button", { name: "返回笔记", exact: true })).toBeDisabled();
    await expect(settings.getByRole("searchbox", { name: "搜索设置", exact: true })).toBeDisabled();
    await expect(settings.getByRole("link", { name: "通用", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(settings.getByRole("status").last()).toContainText("操作进行中");
    await page.keyboard.press("Escape");
    await expect(settings).toBeVisible();
  } finally { finishInspection(); }
  await expect(settings.getByText("此目录将创建新资料库", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "返回笔记", exact: true })).toBeEnabled();
});
