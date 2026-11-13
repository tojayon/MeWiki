import { expect, test } from "@playwright/test";
import { rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import path from "node:path";
import { enableNotebookEditing, runNotebookAction } from "./helpers/researchNotebook.ts";

const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || ".mewiki/media-e2e-settings.json");
const manualPageCount = readdirSync(new URL("../docs/wiki/", import.meta.url)).filter(file => file.endsWith(".md")).length;
test.beforeEach(async () => { await rm(settings, { force: true }); });

test("opens MeWiki with complete manuals and follows a built-in page link without old services", async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.goto("/");
  await expect(page).toHaveTitle("MeWiki");
  const panel = page.getByTestId("research-notebook");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveAttribute("readonly");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.filter((note: { tags?: string[] }) => note.tags?.includes("MeWiki/使用手册")).length)).toBe(manualPageCount);
  await panel.getByRole("link", { name: "快速开始", exact: true }).first().click();
  await expect(page.locator(".research-reading-rail")).toContainText("安装与启动");
  expect(requests.some(url => /8766|replay|three|ephemeris/i.test(url))).toBe(false);
  const origin = new URL(page.url()).origin;
  expect(requests.filter(url => !url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:"))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("cislunar:research-notebook"))).toBeNull();
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("mewiki-manual.png"), fullPage: true });
});

test("keeps an edited manual and missing example across reload, then restores help explicitly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.notes = state.notes.filter((note: { id: string }) => !["mewiki-manual-index", "mewiki-example-content"].includes(note.id));
    state.activeNoteId = "mewiki-manual-01-getting-started";
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  });
  await page.reload();
  const panel = page.getByTestId("research-notebook");
  await enableNotebookEditing(panel);
  await panel.getByLabel("笔记标题", { exact: true }).fill("我的快速开始");
  await panel.getByLabel("笔记标题", { exact: true }).press("Tab");
  await page.reload();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("我的快速开始");
  await runNotebookAction(panel, "使用手册");
  await expect(panel.getByRole("tab", { name: "使用手册", exact: true })).toHaveCount(0);
  await runNotebookAction(panel, "使用手册");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("我的快速开始");
  await panel.locator("#research-manual-sidebar").getByRole("button", { name: "MeWiki 使用手册", exact: true }).click();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!));
  expect(result.notes.filter((note: { tags?: string[] }) => note.tags?.includes("MeWiki/使用手册"))).toHaveLength(manualPageCount);
  expect(result.notes.find((note: { id: string }) => note.id === "mewiki-manual-01-getting-started").title).toBe("我的快速开始");
  expect(result.notes.some((note: { id: string }) => note.id === "mewiki-example-content")).toBe(false);
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
});

test("shows generic sample content and keeps panel switches accessible in a narrow workspace", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.activeNoteId = "mewiki-example-content";
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator(".research-diagram-preview svg")).toBeVisible();
  await expect(page.getByLabel("数据图表", { exact: true })).toBeVisible();
  await expect(page.locator(".research-reading-rail")).toContainText("开始整理自己的知识");
  await page.setViewportSize({ width: 720, height: 900 });
  const header = page.getByRole("toolbar", { name: "笔记管理", exact: true });
  await expect(header.locator(".research-notebook-sidebar-toggle")).toBeVisible();
  await expect(header.locator(".research-outline-toggle")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("mewiki-examples.png"), fullPage: true });
});

test("opens a built-in theory map and returns from the local map through a manual chapter", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
  await panel.getByRole("tab", { name: "理论地图", exact: true }).click();
  await panel.getByRole("button", { name: "打开地图 全局地图", exact: true }).click();
  await expect(panel.getByRole("toolbar", { name: "地图文档管理", exact: true })).toBeVisible();
  await expect(panel.locator(".react-flow__node").first()).toBeVisible();
  await panel.getByRole("tab", { name: "使用手册", exact: true }).click();
  await panel.locator("#research-manual-sidebar").getByRole("button", { name: "MeWiki 使用手册", exact: true }).click();
  await panel.getByRole("button", { name: "更多笔记功能", exact: true }).click();
  const menu = panel.getByRole("menu", { name: "更多笔记功能", exact: true });
  await menu.getByRole("menuitem", { name: "本篇推导图", exact: true }).click();
  await expect(panel.getByRole("toolbar", { name: "理论地图工具", exact: true })).toBeVisible();
  await panel.locator("#research-manual-sidebar").getByRole("button", { name: "MeWiki 使用手册", exact: true }).click();
  await expect(panel.getByRole("toolbar", { name: "理论地图工具", exact: true })).not.toBeVisible();
  await expect(panel.getByRole("link", { name: "快速开始", exact: true }).first()).toBeVisible();
});
