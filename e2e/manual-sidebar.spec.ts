import { expect, test, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { runNotebookAction } from "./helpers/researchNotebook.ts";
import { closeSettingsPage, openSettingsSection } from "./helpers/settings.ts";

const manualPageCount = readdirSync(new URL("../docs/wiki/", import.meta.url)).filter(file => file.endsWith(".md")).length;

async function openWorkspace(page: Page, empty = false) {
  const state = createNotebookFixture();
  state.notes = [
    { ...createResearchNote("正在阅读的记录"), id: "manual-demo-note", library: "research" },
    { ...createResearchNote("我的手册摘录"), id: "manual-demo-excerpt", library: "research", tags: ["MeWiki/使用手册"] },
    { ...createResearchNote("自定义入门说明"), id: "mewiki-manual-01-getting-started", library: "research", tags: ["我的标记"] },
    { ...createResearchNote("保存与备份"), id: "mewiki-manual-15-storage-and-backup", library: "research", tags: ["MeWiki/使用手册"] },
  ];
  state.activeNoteId = "manual-demo-note";
  if (empty) { state.notes = []; state.activeNoteId = ""; }
  state.view = "notes";
  state.open = true;
  await page.addInitScript(state => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  page.on("pageerror", error => { throw error; });
  await page.goto("/");
  if (empty) await expect(page.getByRole("heading", { name: "研究记录库暂无笔记", exact: true })).toBeVisible();
  else await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("正在阅读的记录");
  return page.getByTestId("research-notebook");
}

test("keeps manual chapters out of research notes and opens them only from their own tab", async ({ page }, info) => {
  const panel = await openWorkspace(page);
  const sidebar = panel.locator("#research-notebook-sidebar");
  await expect(sidebar.getByRole("button", { name: "自定义入门说明", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "我的手册摘录", exact: true })).toBeVisible();
  await expect(sidebar.locator("button[data-research-choice]")).toHaveCount(2);
  await expect(sidebar.getByRole("button", { name: "查看已核对笔记", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  await runNotebookAction(panel, "使用手册");
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveAttribute("aria-selected", "true");
  const manual = panel.getByRole("complementary", { name: "使用手册", exact: true });
  await expect(manual.locator("button[data-research-choice]")).toHaveCount(manualPageCount);
  await panel.getByRole("button", { name: "全部折叠分类", exact: true }).click();
  await expect(manual.locator("[data-research-choice]:visible")).toHaveCount(0);
  await panel.getByRole("button", { name: "全部展开分类", exact: true }).click();
  await expect(manual.locator('.research-note-folder[aria-expanded="false"]')).toHaveCount(0);
  await expect(manual.getByRole("button", { name: "自定义入门说明", exact: true })).toBeVisible();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("正在阅读的记录");
  await manual.getByRole("button", { name: "界面与阅读", exact: true }).click();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("界面与阅读");
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath("manual-tab-desktop.png") });
});

test("toggles the manual tab without changing the open note or deleting saved chapters", async ({ page }) => {
  const panel = await openWorkspace(page);
  await panel.getByLabel("搜索研究笔记", { exact: true }).fill("我的手册摘录");
  await runNotebookAction(panel, "使用手册");
  const manual = panel.getByRole("complementary", { name: "使用手册", exact: true });
  await manual.getByRole("button", { name: "界面与阅读", exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"));
  await runNotebookAction(panel, "使用手册");
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("tab", { name: "研究记录", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByLabel("搜索研究笔记", { exact: true })).toHaveValue("我的手册摘录");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("界面与阅读");
  expect(await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"))).toBe(before);
  await page.reload();
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  await runNotebookAction(panel, "使用手册");
  await expect(manual.getByRole("button", { name: "自定义入门说明", exact: true })).toBeVisible();
  await manual.getByRole("button", { name: "关闭使用手册", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("tab", { name: "研究记录", exact: true })).toBeFocused();
});

test("groups legacy and edited manual chapters by subject without changing saved notes", async ({ page }, info) => {
  const panel = await openWorkspace(page);
  const before = await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"));
  await runNotebookAction(panel, "使用手册");
  const manual = panel.getByRole("complementary", { name: "使用手册", exact: true });
  const categories = manual.locator(".research-note-tree > [data-tag-path] > .research-note-folder .research-note-folder-label");
  await expect(categories).toHaveText(["入门与界面", "编辑与组织", "词典与知识", "媒体与数据", "保存与维护", "插件与导出"]);
  await expect(manual.locator('[data-tag-path="MeWiki/使用手册"]')).toHaveCount(0);
  await expect(manual.locator('[data-tag-path="入门与界面"]').getByRole("button", { name: "自定义入门说明", exact: true })).toBeVisible();
  await expect(manual.locator('[data-tag-path="保存与维护"]').getByRole("button", { name: "保存与备份", exact: true })).toBeVisible();
  const maintenanceChapterCount = await manual.locator('[data-tag-path="保存与维护"] [data-research-choice]').count();
  await page.screenshot({ path: info.outputPath("manual-subjects-desktop.png") });

  await manual.getByRole("button", { name: "收起标签 入门与界面", exact: true }).click();
  await expect(manual.getByRole("button", { name: "自定义入门说明", exact: true })).toBeHidden();
  const search = manual.getByLabel("搜索使用手册", { exact: true });
  await search.fill("入门与界面");
  await expect(manual.locator("button[data-research-choice]")).toHaveCount(4);
  await expect(manual.getByRole("button", { name: "自定义入门说明", exact: true })).toBeVisible();
  await search.fill("");
  await expect(manual.getByRole("button", { name: "自定义入门说明", exact: true })).toBeHidden();
  await search.fill("保存与维护");
  await expect(manual.locator("button[data-research-choice]")).toHaveCount(maintenanceChapterCount);
  await expect(manual.getByRole("button", { name: "保存与备份", exact: true })).toBeVisible();
  await search.fill("我的标记");
  await expect(manual.locator("button[data-research-choice]")).toHaveCount(1);
  await expect(manual.locator('[data-tag-path="入门与界面"]').getByRole("button", { name: "自定义入门说明", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"))).toBe(before);
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("正在阅读的记录");
});

test("opens help from settings even when the manual tab is already available", async ({ page }) => {
  const panel = await openWorkspace(page);
  await runNotebookAction(panel, "使用手册");
  await panel.getByRole("tab", { name: "术语", exact: true }).click();
  const settings = await openSettingsSection(page, "about");
  await settings.getByRole("button", { name: /使用手册.*完整说明/ }).click();
  await expect(settings).toBeHidden();
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByLabel("搜索使用手册", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("正在阅读的记录");
});

test("supports chapter search, scrolling and keyboard tabs in a narrow sidebar", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  const panel = await openWorkspace(page);
  await runNotebookAction(panel, "使用手册");
  const manual = panel.getByRole("complementary", { name: "使用手册", exact: true });
  const navigation = panel.getByRole("tablist", { name: "科研笔记视图", exact: true });
  await expect(navigation.getByRole("tab")).toHaveCount(6);
  const search = manual.getByLabel("搜索使用手册", { exact: true });
  await search.fill("社交图文导出");
  await expect(manual.locator("button[data-research-choice]")).toHaveCount(1);
  await expect(manual.getByRole("button", { name: "社交图文导出", exact: true })).toBeVisible();
  await navigation.getByRole("tab", { name: "研究记录", exact: true }).click();
  await navigation.getByRole("tab", { name: "研究记录", exact: true }).press("End");
  await expect(navigation.getByRole("tab", { name: "使用手册", exact: true })).toBeFocused();
  await expect(search).toHaveValue("社交图文导出");
  await search.fill("");
  const list = manual.locator(".research-classified-list");
  await list.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const tab of await navigation.getByRole("tab").all()) await expect(tab).toBeInViewport();
  await expect(manual.getByRole("button", { name: "关闭使用手册", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("manual-tab-mobile.png") });
});

test("opens a collapsed sidebar and localizes the manual controls", async ({ page }) => {
  const panel = await openWorkspace(page);
  const settings = await openSettingsSection(page, "general");
  await settings.getByRole("radio", { name: /English/ }).check();
  await closeSettingsPage(page);
  await panel.getByRole("button", { name: "Collapse note left panel", exact: true }).click();
  await panel.getByRole("button", { name: "User manual", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "User manual", exact: true })).toHaveAttribute("aria-selected", "true");
  const manual = panel.getByRole("complementary", { name: "User manual", exact: true });
  await expect(manual.getByLabel("Search user manual", { exact: true })).toBeVisible();
  await expect(manual.getByRole("button", { name: "Close user manual", exact: true })).toBeVisible();
  await manual.getByRole("button", { name: "Collapse all categories", exact: true }).click();
  await expect(manual.locator("[data-research-choice]:visible")).toHaveCount(0);
  await manual.getByRole("button", { name: "Expand all categories", exact: true }).click();
  await expect(manual.locator(".research-note-tree > [data-tag-path] > .research-note-folder .research-note-folder-label"))
    .toHaveText(["Getting started & interface", "Editing & organization", "Dictionary & knowledge", "Media & data", "Storage & maintenance", "Plugins & export"]);
  await manual.getByLabel("Search user manual", { exact: true }).fill("Editing & organization");
  await expect(manual.locator("button[data-research-choice]")).toHaveCount(4);
  await expect(manual.getByRole("button", { name: "内容类型展示", exact: true })).toBeVisible();
  await expect(panel.getByLabel("Note title", { exact: true })).toHaveValue("正在阅读的记录");
});

test("keeps an empty library unchanged until a manual chapter is chosen", async ({ page }) => {
  const panel = await openWorkspace(page, true);
  const before = await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"));
  await panel.getByRole("button", { name: "使用手册", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "研究记录库暂无笔记", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"))).toBe(before);
  await panel.getByRole("complementary", { name: "使用手册", exact: true }).getByRole("button", { name: "MeWiki 使用手册", exact: true }).click();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes);
  expect(notes).toHaveLength(manualPageCount);
});
