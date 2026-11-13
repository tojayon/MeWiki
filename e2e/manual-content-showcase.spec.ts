import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { runNotebookAction } from "./helpers/researchNotebook.ts";
import { closeSettingsPage, openSettingsSection } from "./helpers/settings.ts";

const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || ".mewiki/media-e2e-settings.json");
const showcaseId = "mewiki-manual-21-content-showcase";
test.beforeEach(async () => { await rm(settings, { force: true }); });
test.afterEach(async () => { await rm(settings, { force: true }); });

async function openShowcase(page: Page) {
  await page.goto("/");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toBeVisible();
  const manual = panel.locator("#research-manual-sidebar");
  if (!await manual.isVisible()) await runNotebookAction(panel, "使用手册");
  await manual.getByRole("button", { name: "内容类型展示", exact: true }).click();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("内容类型展示");
  return panel;
}

test("renders real manual content, diagrams and all chart types without external requests", async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  const panel = await openShowcase(page);
  for (let level = 1; level <= 6; level++) await expect(panel.locator(`.research-note-block h${level}`).first()).toBeVisible();
  await expect(panel.locator(".research-note-block pre code.language-typescript")).toContainText("console.table");
  await expect(panel.locator("code.language-mewiki-block")).toHaveCount(0);
  await expect(panel.locator(".research-callout")).toBeVisible();
  await expect(panel.locator('.research-diagram-preview svg')).toBeVisible();
  await expect(panel.locator('.research-drawing-surface')).toBeVisible();
  await expect(panel.locator('.research-dataset-chart')).toHaveCount(3);
  await expect(panel.getByRole("table", { name: "数据表预览", exact: true })).toHaveCount(3);
  const image = panel.locator('[data-media-kind="image"] img').first();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(960);
  const tabs = panel.locator('[data-block-id="manual-showcase:tabs"]');
  await tabs.getByRole("tab", { name: "代入", exact: true }).click();
  await expect(tabs.locator(".katex")).toBeVisible();
  await tabs.getByRole("tab", { name: "定义", exact: true }).click();
  await expect(tabs.getByText("线性关系的斜率为 2，截距为 1。输入每增加 1，输出增加 2。", { exact: true })).toBeVisible();
  const embed = panel.locator('[data-note-embed="manual-showcase:embed"]');
  await expect(embed.locator(".katex")).toBeVisible();
  await expect(embed.locator(".research-note-embed-error")).toHaveCount(0);
  await expect(panel.locator('.research-citation-block')).toContainText("虚构示例");
  await expect(panel.locator('.research-evidence-block')).toContainText("1.250000");
  const external = panel.locator('[data-provider="org.mewiki.manual-demo"]');
  await external.locator("summary").click();
  await expect(external.locator("pre")).toContainText('"output": 7');
  await panel.locator('[data-block-id="manual-showcase:line-chart"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("showcase-charts-desktop.png") });
  expect(errors).toEqual([]);
  expect(requests.filter(url => /^https?:/.test(url) && new URL(url).origin !== new URL(page.url()).origin)).toEqual([]);
});

test("plays bundled audio and video, searches PDF pages and downloads the original attachment", async ({ page }, info) => {
  const panel = await openShowcase(page);
  const audio = panel.locator("audio"), video = panel.locator("video");
  for (const player of [audio, video]) {
    await expect.poll(() => player.evaluate(element => (element as HTMLMediaElement).readyState)).toBeGreaterThan(0);
    expect(await player.evaluate(element => (element as HTMLMediaElement).paused)).toBe(true);
    await player.evaluate(async element => { const media = element as HTMLMediaElement; media.muted = true; await media.play(); });
    await expect.poll(() => player.evaluate(element => (element as HTMLMediaElement).currentTime)).toBeGreaterThan(0);
    await player.evaluate(element => (element as HTMLMediaElement).pause());
  }
  const pdf = panel.locator('[data-block-id="manual-showcase:pdf"]');
  await expect(pdf.locator("canvas")).toBeVisible();
  await pdf.getByRole("button", { name: "PDF 下一页", exact: true }).click();
  await expect(pdf.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await pdf.getByLabel("搜索 PDF", { exact: true }).fill("MeWiki");
  await pdf.getByLabel("搜索 PDF", { exact: true }).press("Enter");
  await expect(pdf.getByRole("status")).toContainText("2 页");
  await expect(pdf.locator('[data-pdf-match="true"]')).toHaveCount(1);
  await pdf.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("showcase-pdf-desktop.png") });
  const downloading = page.waitForEvent("download");
  await panel.locator('[data-block-id="manual-showcase:file"] .research-attachment-card').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("showcase-data.csv");
  expect(await readFile((await download.path())!, "utf8")).toContain("输入 x,观测值 y,参考值");
  await expect(panel.locator(".research-media-unavailable")).toHaveCount(0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("adds the new chapter to an existing local library and exports intact originals before visiting it", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "mewiki-showcase-e2e-"));
  try {
    await page.goto("/");
    await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
    await page.evaluate(id => {
      const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
      state.notes = state.notes.filter((note: { id: string }) => note.id !== id);
      state.notes.find((note: { id: string }) => note.id === "mewiki-manual-01-getting-started").title = "我修改过的入门";
      localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    }, showcaseId);
    await page.reload();
    await openSettingsSection(page, "storage");
    const storage = page.getByTestId("research-library-storage");
    await storage.getByLabel("本地保存路径", { exact: true }).fill(path.join(root, "资料库"));
    await storage.getByRole("button", { name: "检查路径", exact: true }).click();
    await storage.getByRole("button", { name: "迁移到此目录", exact: true }).click();
    await expect(storage.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
    await closeSettingsPage(page);
    const panel = page.getByTestId("research-notebook");
    if (await panel.locator("#research-manual-sidebar").isVisible()) await panel.getByRole("button", { name: "关闭使用手册", exact: true }).click();
    await runNotebookAction(panel, "使用手册");
    await expect(panel.locator("#research-manual-sidebar").getByRole("button", { name: "我修改过的入门", exact: true })).toBeVisible();
    // Choosing an existing chapter saves all missing chapters without opening the showcase.
    await panel.locator("#research-manual-sidebar").getByRole("button", { name: "MeWiki 使用手册", exact: true }).click();
    await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("MeWiki 使用手册");
    await openSettingsSection(page, "backup");
    const downloading = page.waitForEvent("download");
    await storage.getByRole("button", { name: "导出含附件备份", exact: true }).click();
    const download = await downloading;
    const files = unzipSync(await readFile((await download.path())!));
    const originals = Object.keys(files).filter(name => /^assets\/[a-f0-9]{64}\.[^.]+$/.test(name) && !name.endsWith(".json"));
    expect(originals).toHaveLength(5);
    for (const name of originals) expect(createHash("sha256").update(files[name]).digest("hex")).toBe(name.split("/")[1].split(".")[0]);
    await closeSettingsPage(page);
    await panel.locator("#research-manual-sidebar").getByRole("button", { name: "内容类型展示", exact: true }).click();
    await expect(panel.locator('[data-block-id="manual-showcase:pdf"] canvas')).toBeVisible();
    const audio = panel.locator("audio");
    await expect.poll(() => audio.evaluate(element => (element as HTMLMediaElement).readyState)).toBeGreaterThan(0);
    await expect(panel.locator(".research-media-unavailable")).toHaveCount(0);
  } finally {
    if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("mewiki-showcase-e2e-")) await rm(root, { recursive: true, force: true });
  }
});

test("keeps the showcase readable and interactive in a narrow window", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 720 });
  const panel = await openShowcase(page);
  const collapse = panel.getByRole("button", { name: "收起笔记左侧面板", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  for (const id of ["manual-showcase:image", "manual-showcase:tabs", "manual-showcase:line-chart", "manual-showcase:pdf", "manual-showcase:embed"]) {
    const block = panel.locator(`[data-block-id="${id}"]`);
    await block.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await panel.locator('[data-block-id="manual-showcase:tabs"]').getByRole("tab", { name: "代入", exact: true }).click();
  await expect(panel.locator('[data-block-id="manual-showcase:tab-formula"] .katex')).toBeVisible();
  await page.screenshot({ path: info.outputPath("showcase-mobile.png") });
});
