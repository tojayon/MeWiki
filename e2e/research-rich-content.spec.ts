import { openSettingsSection, closeSettingsPage } from "./helpers/settings.ts";
import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createResearchNote, type ResearchNotebookBlock } from "../src/domain/researchNotebook.ts";
import { enableNotebookEditing, runNotebookAction } from "./helpers/researchNotebook.ts";
import { researchPdfFixture } from "./fixtures/researchPdf.ts";
import { researchSpreadsheetFixture } from "./fixtures/researchSpreadsheet.ts";

const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || ".mewiki/media-e2e-settings.json");
let root: string;
test.beforeEach(async ({ page }) => {
  await page.route("**/api/research-library/media/citation-metadata", route => route.fulfill({ status: 404, json: { error: "未找到此 DOI 的文献元信息。" } }));
  await rm(settings, { force: true });
  root = await mkdtemp(path.join(tmpdir(), "webbench-rich-e2e-"));
  const note = { ...createResearchNote("文献、数据与绘图"), id: "rich-note", library: "research" as const };
  const state = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id, view: "notes" as const };
  await page.addInitScript(state => {
    if (!localStorage.getItem("rich-test-seeded")) {
      localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
      localStorage.setItem("rich-test-seeded", "1");
    }
  }, state);
  await page.goto("/?page=research-notebook");
  await enableNotebookEditing(page.getByTestId("research-notebook"));
});

test("automatically fills citation metadata from a pasted DOI and retains it after reload", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/research-library/media/citation-metadata", route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ doi: "10.1234/auto" });
    return route.fulfill({ json: { doi: "10.1234/auto", title: "自动获取的文献", authors: "Ming Li; Research Group", year: "2026", venue: "Research Journal", url: "https://example.com/paper" } });
  });
  await insert(page, "文献引用");
  const block = page.locator(".research-citation-block").last();
  const doi = block.getByLabel("文献 DOI", { exact: true });
  await expect(doi).toBeVisible();
  await doi.fill("https://doi.org/10.1234/auto");
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("自动获取的文献");
  await expect(block.getByLabel("文献作者", { exact: true })).toHaveValue("Ming Li; Research Group");
  await expect(block.getByLabel("文献年份", { exact: true })).toHaveValue("2026");
  await expect(block.getByLabel("文献期刊或来源", { exact: true })).toHaveValue("Research Journal");
  await doi.press("Enter"); await doi.press("Tab");
  expect(requests).toBe(1);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await expect(block.getByRole("button", { name: "获取 DOI 元信息", exact: true })).toHaveCount(0);
  await expect(block).toContainText("自动获取的文献");
  await page.reload();
  await expect(block).toContainText("自动获取的文献");
  expect(requests).toBe(1);
});

test("keeps existing citation fields and edits or cleared values made during DOI lookup", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route("**/api/research-library/media/citation-metadata", async route => {
    started = true; await gate;
    await route.fulfill({ json: { doi: "10.1234/manual", title: "来源标题", authors: "Fetched Author", year: "2026", venue: "Fetched Journal", url: "https://example.com/fetched" } });
  });
  await insert(page, "文献引用");
  const block = page.locator(".research-citation-block").last();
  await block.getByLabel("文献标题", { exact: true }).fill("我的标题");
  await block.getByLabel("文献阅读笔记", { exact: true }).fill("我的阅读笔记");
  await block.getByLabel("文献 DOI", { exact: true }).fill("10.1234/manual");
  await expect.poll(() => started).toBe(true);
  await block.getByLabel("文献年份", { exact: true }).fill("2030");
  await block.getByLabel("文献期刊或来源", { exact: true }).fill("临时编辑");
  await block.getByLabel("文献期刊或来源", { exact: true }).fill("");
  await block.getByRole("button", { name: "文献链接设置", exact: true }).click();
  await block.getByLabel("文献来源网址", { exact: true }).fill("https://example.com/my-draft");
  release();
  await expect(block.getByLabel("文献作者", { exact: true })).toHaveValue("Fetched Author");
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("我的标题");
  await expect(block.getByLabel("文献年份", { exact: true })).toHaveValue("2030");
  await expect(block.getByLabel("文献期刊或来源", { exact: true })).toHaveValue("");
  await expect(block.getByLabel("文献阅读笔记", { exact: true })).toHaveValue("我的阅读笔记");
  await expect(block.getByLabel("文献来源网址", { exact: true })).toHaveValue("https://example.com/my-draft");
});

test("discards the previous DOI response when its input changes", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route("**/api/research-library/media/citation-metadata", async route => {
    const doi = route.request().postDataJSON().doi;
    if (doi === "10.1234/old") { started = true; await gate; }
    await route.fulfill({ json: { doi, title: doi === "10.1234/old" ? "过期的结果" : "正确的结果", year: "2026" } }).catch(() => {});
  });
  await insert(page, "文献引用");
  const block = page.locator(".research-citation-block").last();
  const doi = block.getByLabel("文献 DOI", { exact: true });
  await doi.fill("10.1234/old");
  await expect.poll(() => started).toBe(true);
  await doi.fill("10.1234/new"); await doi.press("Enter");
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("正确的结果");
  release();
  await doi.fill(""); await doi.press("Tab");
  await expect(block.getByRole("link", { name: /^DOI:/ })).toHaveCount(0);
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("正确的结果");
});

test("retains citation content on DOI failure and retries from the narrow editor", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/research-library/media/citation-metadata", route => {
    requests++;
    return requests === 1 ? route.fulfill({ status: 404, json: { error: "未找到此 DOI 的文献元信息，请检查 DOI。" } }) : route.fulfill({ json: { doi: "10.1234/retry", title: "重试成功的文献" } });
  });
  await insert(page, "文献引用");
  const block = page.locator(".research-citation-block").last();
  const doi = block.getByLabel("文献 DOI", { exact: true });
  await block.getByLabel("文献阅读笔记", { exact: true }).fill("保留此笔记");
  await doi.fill("invalid DOI"); await doi.press("Enter");
  await expect(block.getByRole("alert")).toContainText("DOI");
  expect(requests).toBe(0);
  await doi.fill("10.1234/retry"); await doi.press("Enter");
  await expect(block.getByRole("alert")).toContainText("未找到");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) { const toggle = page.getByRole("button", { name, exact: true }); if (await toggle.isVisible()) await toggle.click(); }
  await block.getByRole("button", { name: "获取 DOI 元信息", exact: true }).click();
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("重试成功的文献");
  await expect(block.getByLabel("文献阅读笔记", { exact: true })).toHaveValue("保留此笔记");
  expect(requests).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/evidence/research-citation-doi-mobile.png", fullPage: true });
});

test("allows DOI retry after a cancelled lookup during a failed library connection", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route("**/api/research-library/media/citation-metadata", async route => {
    requests++;
    if (requests === 1) await gate;
    await route.fulfill({ json: { doi: "10.1234/cancel", title: "重新获取成功", url: "https://example.com/fetched" } }).catch(() => {});
  });
  await page.route("**/api/research-library/connect", route => route.fulfill({ status: 400, json: { error: "资料库连接测试失败" } }));
  await insert(page, "文献引用");
  const block = page.locator(".research-citation-block").last();
  await block.getByRole("button", { name: "文献链接设置", exact: true }).click();
  await block.getByLabel("文献来源网址", { exact: true }).fill("https://");
  await block.getByLabel("文献 DOI", { exact: true }).fill("10.1234/cancel");
  await expect.poll(() => requests).toBe(1);
  await openSettingsSection(page, "storage");
  const dialog = page.getByTestId("research-library-storage");
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(path.join(root, "连接测试"));
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("资料库连接测试失败", { exact: true })).toBeVisible();
  await closeSettingsPage(page);
  release();
  const retry = block.getByRole("button", { name: "获取 DOI 元信息", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("重新获取成功");
  await expect(block.getByLabel("文献来源网址", { exact: true })).toHaveValue("https://");
});

test("does not write a delayed DOI response after switching to reading mode", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route("**/api/research-library/media/citation-metadata", async route => {
    requests++; await gate;
    await route.fulfill({ json: { doi: "10.1234/readonly", title: "过期的只读结果" } }).catch(() => {});
  });
  await insert(page, "文献引用");
  const block = page.locator(".research-citation-block").last();
  await block.getByLabel("文献 DOI", { exact: true }).fill("10.1234/readonly");
  await expect.poll(() => requests).toBe(1);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  release();
  await page.waitForLoadState("networkidle");
  await expect(block).not.toContainText("过期的只读结果");
  await enableNotebookEditing(page.getByTestId("research-notebook"));
  await block.getByRole("button", { name: "编辑文献资料", exact: true }).click();
  await expect(block.getByLabel("文献标题", { exact: true })).toHaveValue("");
  expect(requests).toBe(1);
});
test.afterEach(async () => {
  await rm(settings, { force: true });
  if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("webbench-rich-e2e-")) await rm(root, { recursive: true, force: true });
});
async function insert(page: Page, label: string) {
  await page.getByRole("button", { name: "在笔记末尾插入", exact: true }).click();
  await page.getByRole("dialog", { name: "插入笔记内容" }).getByRole("button", { name: label, exact: true }).click();
}
async function connect(page: Page) {
  await openSettingsSection(page, "storage");
  const dialog = page.getByTestId("research-library-storage");
  await dialog.getByRole("textbox", { name: "本地保存路径", exact: true }).fill(path.join(root, "资料库"));
  await dialog.getByRole("button", { name: "检查路径", exact: true }).click();
  await dialog.getByRole("button", { name: "迁移到此目录", exact: true }).click();
  await expect(dialog.getByText("本地自动保存已启用", { exact: true })).toBeVisible();
  await closeSettingsPage(page);
}

test("edits citations, validates DOI and keeps linked PDF pages and copied references", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await insert(page, "文献引用");
  const citation = page.locator(".research-citation-block").last();
  await citation.getByLabel("文献标题", { exact: true }).fill("Lunar observation report");
  await citation.getByLabel("文献作者", { exact: true }).fill("Li; Wang");
  await citation.getByLabel("文献年份", { exact: true }).fill("2026");
  await citation.getByLabel("文献期刊或来源", { exact: true }).fill("Research Journal");
  await citation.getByLabel("文献阅读笔记", { exact: true }).fill("观测记录与符号说明");
  await citation.getByRole("button", { name: "文献链接设置", exact: true }).click();
  const doi = citation.getByLabel("文献 DOI", { exact: true });
  await doi.fill("invalid doi"); await doi.press("Enter");
  await expect(citation.getByRole("alert")).toContainText("DOI");
  await doi.fill("https://doi.org/10.1234/lunar"); await doi.press("Enter");
  await expect(citation.getByRole("link", { name: "DOI: 10.1234/lunar", exact: true })).toHaveAttribute("href", "https://doi.org/10.1234/lunar");
  await citation.getByRole("button", { name: "复制文献引用", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Li; Wang (2026). Lunar observation report");
  await citation.getByRole("button", { name: "关联文献 PDF", exact: true }).click();
  await citation.getByLabel("选择PDF 文档文件", { exact: true }).setInputFiles({ name: "文献.pdf", mimeType: "application/pdf", buffer: researchPdfFixture() });
  await expect(citation.locator("canvas")).toBeVisible();
  await citation.getByRole("button", { name: "PDF 下一页", exact: true }).click();
  await expect(citation.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await page.reload();
  await expect(citation.getByText("Lunar observation report", { exact: true })).toBeVisible();
  await citation.getByRole("button", { name: "阅读关联 PDF", exact: true }).click();
  await expect(citation.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await expect(citation.getByRole("button", { name: "编辑文献资料", exact: true })).toHaveCount(0);
  await citation.getByRole("button", { name: "阅读关联 PDF", exact: true }).click();
  await expect(citation.getByRole("button", { name: "PDF 上一页", exact: true })).toBeEnabled();
});

test("shares an existing PDF original with a citation", async ({ page }) => {
  await insert(page, "PDF 文档");
  await page.getByLabel("选择PDF 文档文件", { exact: true }).setInputFiles({ name: "已有报告.pdf", mimeType: "application/pdf", buffer: researchPdfFixture() });
  await expect(page.locator('[data-media-kind="pdf"] canvas')).toBeVisible();
  await insert(page, "文献引用");
  const citation = page.locator(".research-citation-block").last();
  await citation.getByRole("button", { name: "关联文献 PDF", exact: true }).click();
  const chooser = citation.getByLabel("关联已有 PDF", { exact: true });
  const value = await chooser.locator("option").nth(1).getAttribute("value");
  await chooser.selectOption(value!);
  await expect(citation.locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("mewiki-research-media", 1);
    request.onsuccess = () => { const db = request.result; const count = db.transaction("assets").objectStore("assets").count(); count.onsuccess = () => { resolve(count.result); db.close(); }; count.onerror = reject; }; request.onerror = reject;
  }))).toBe(1);
});

test("pastes real CSV data, changes chart types and retains the previous data after a parse error", async ({ page }) => {
  await insert(page, "数据与图表");
  const block = page.locator(".research-dataset-block").last();
  await block.getByLabel("CSV 数据", { exact: true }).fill('time,value,note\n0,2,"start, record"\n1,4,"two\nlines"\n2,,missing');
  await block.getByRole("button", { name: "应用数据", exact: true }).click();
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("start, record");
  await expect(block.getByLabel("数据图表", { exact: true })).toBeVisible();
  await block.getByRole("button", { name: "图表设置", exact: true }).click();
  await block.getByLabel("图表类型", { exact: true }).selectOption("scatter");
  await block.getByLabel("图表类型", { exact: true }).selectOption("bar");
  await expect(block.getByLabel("数据图表", { exact: true }).locator("rect")).not.toHaveCount(0);
  await block.getByRole("button", { name: "编辑数据", exact: true }).click();
  await block.getByLabel("CSV 数据", { exact: true }).fill('time,value\n0,"unfinished');
  await block.getByRole("button", { name: "应用数据", exact: true }).click();
  await expect(block.getByRole("alert")).toContainText("引号");
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("start, record");
  await page.reload();
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("start, record");
  await block.getByRole("button", { name: "图表设置", exact: true }).click();
  await expect(block.getByLabel("图表类型", { exact: true })).toHaveValue("bar");
});

test("imports real multi-sheet Excel and downloads the preserved original after reload", async ({ page }) => {
  await insert(page, "数据与图表");
  const block = page.locator(".research-dataset-block").last();
  const bytes = researchSpreadsheetFixture();
  await block.getByLabel("选择数据文件", { exact: true }).setInputFiles({ name: "研究数据.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes });
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("y");
  await block.getByLabel("Excel 工作表", { exact: true }).selectOption({ label: "验证" });
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("value");
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("30");
  await page.reload();
  await expect(block.getByRole("table", { name: "数据表预览" })).toContainText("30");
  const download = page.waitForEvent("download");
  await block.getByRole("link", { name: "研究数据.xlsx", exact: true }).click();
  expect(await readFile((await (await download).path())!)).toEqual(bytes);
  await block.getByRole("button", { name: "重新读取工作表", exact: true }).click();
  await expect(block.getByLabel("Excel 工作表", { exact: true })).toBeVisible();
});

test("renders local flow, sequence and structure diagrams and recovers from invalid source", async ({ page }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  await expect(block.locator(".research-diagram-preview svg")).toBeVisible({ timeout: 30000 });
  await block.getByLabel("流程图模板", { exact: true }).selectOption("sequence");
  await expect(block.locator(".research-diagram-preview")).toContainText("传感器");
  await expectCompleteDiagram(block.locator(".research-diagram-preview > svg"));
  await block.getByLabel("流程图模板", { exact: true }).selectOption("structure");
  await expect(block.locator(".research-diagram-preview")).toContainText("Sensor");
  await expectCompleteDiagram(block.locator(".research-diagram-preview > svg"));
  await block.getByLabel("流程图源码", { exact: true }).fill("flowchart LR\n A[broken");
  await expect(block.getByRole("alert")).toContainText(/line|行|语法/i);
  await expect(block.getByLabel("流程图源码", { exact: true })).toHaveValue("flowchart LR\n A[broken");
  await block.getByLabel("流程图源码", { exact: true }).fill("flowchart LR\n A[恢复] --> B[通过]");
  await expect(block.locator(".research-diagram-preview")).toContainText("通过");
  const download = page.waitForEvent("download");
  await block.getByRole("button", { name: "导出绘图 SVG", exact: true }).click();
  expect((await readFile((await (await download).path())!, "utf8"))).toContain("<svg");
  await page.reload();
  await expect(block.locator(".research-diagram-preview")).toContainText("通过");
});

test("opens a flowchart in a large preview window and closes it with Escape", async ({ page }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  await block.getByLabel("流程图模板", { exact: true }).selectOption("flow");
  await expect(block.locator(".research-diagram-preview svg")).toBeVisible({ timeout: 30000 });
  await expect(block.locator(".research-diagram-preview")).toContainText("是否满足条件");
  const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === "rich-note").blocks));

  const enlarge = block.getByRole("button", { name: "放大流程图", exact: true });
  await enlarge.click();
  const dialog = page.getByRole("dialog", { name: "流程图预览", exact: true });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole("img", { name: "流程图预览", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const snapshot = decodeURIComponent((await image.getAttribute("src"))!.split(",").slice(1).join(","));
  expect(snapshot).toContain("完成");
  expect(snapshot).toContain("是否满足条件");
  const source = block.locator(".research-diagram-preview > svg");
  expect(snapshot).toContain(`viewBox="${await source.getAttribute("viewBox")}"`);
  expect((await image.boundingBox())!.width).toBeGreaterThan((await source.boundingBox())!.width);
  const dialogBounds = (await dialog.boundingBox())!;
  const closeBounds = (await dialog.getByRole("button", { name: "关闭流程图预览", exact: true }).boundingBox())!;
  expect(dialogBounds.x + dialogBounds.width - closeBounds.x - closeBounds.width).toBeLessThan(20);
  await page.screenshot({ path: test.info().outputPath("diagram-preview-desktop.png") });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(enlarge).toBeFocused();

  const preview = block.getByRole("button", { name: "查看流程图预览", exact: true });
  await preview.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭流程图预览", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
  await preview.press("Enter");
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();

  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await preview.focus();
  await preview.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
  expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === "rich-note").blocks))).toBe(before);
});

test("zooms the diagram around the cursor and pans a vector canvas without changing the note", async ({ page }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  await expect(block.locator(".research-diagram-preview svg")).toBeVisible({ timeout: 30000 });
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === "rich-note").blocks);
  await block.getByRole("button", { name: "放大流程图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "流程图预览", exact: true });
  await expect(dialog.getByRole("toolbar", { name: "绘图缩放", exact: true })).toBeVisible();
  const canvas = dialog.getByRole("region", { name: "绘图画布", exact: true });
  const image = dialog.getByRole("img", { name: "流程图预览", exact: true });
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const initial = (await image.boundingBox())!;
  const anchor = { x: Math.round(initial.x + initial.width * 0.6), y: Math.round(initial.y + initial.height * 0.4) };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(initial.width * 1.5);
  const enlarged = (await image.boundingBox())!;
  expect((anchor.x - enlarged.x) / enlarged.width).toBeCloseTo((anchor.x - initial.x) / initial.width, 2);
  expect((anchor.y - enlarged.y) / enlarged.height).toBeCloseTo((anchor.y - initial.y) / initial.height, 2);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 120, anchor.y + 70, { steps: 8 });
  await page.mouse.up();
  const moved = (await image.boundingBox())!;
  expect(moved.x - enlarged.x).toBeCloseTo(120, 0);
  expect(moved.y - enlarged.y).toBeCloseTo(70, 0);
  await dialog.getByRole("button", { name: "适应画布", exact: true }).click();
  await dialog.getByRole("button", { name: "原始大小", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "原始大小", exact: true })).toHaveText("100%");
  await expect(dialog.getByRole("button", { name: "原始大小", exact: true })).toHaveAccessibleDescription("100%");
  for (let index = 0; index < 8; index++) await dialog.getByRole("button", { name: "放大绘图", exact: true }).click();
  expect((await image.boundingBox())!.width).toBeGreaterThan(initial.width * 4);
  await page.screenshot({ path: test.info().outputPath("diagram-canvas-zoomed.png") });
  await canvas.focus();
  await canvas.press("Home");
  expect((await image.boundingBox())!.width).toBeCloseTo(initial.width, 0);
  await canvas.press("+");
  expect((await image.boundingBox())!.width).toBeCloseTo(initial.width * 1.25, 0);
  const beforeResize = (await image.boundingBox())!;
  const oldArea = (await canvas.boundingBox())!;
  const centerX = (oldArea.x + oldArea.width / 2 - beforeResize.x) / beforeResize.width;
  const centerY = (oldArea.y + oldArea.height / 2 - beforeResize.y) / beforeResize.height;
  await page.setViewportSize({ width: 900, height: 700 });
  const resizedArea = (await canvas.boundingBox())!;
  await expect.poll(async () => {
    const next = (await image.boundingBox())!;
    return Math.abs((resizedArea.x + resizedArea.width / 2 - next.x) / next.width - centerX);
  }).toBeLessThan(0.01);
  const afterResize = (await image.boundingBox())!;
  expect(afterResize.width).toBeCloseTo(beforeResize.width, 0);
  expect((resizedArea.y + resizedArea.height / 2 - afterResize.y) / afterResize.height).toBeCloseTo(centerY, 2);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press("Escape");
  await block.getByRole("button", { name: "放大流程图", exact: true }).click();
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(0);
  const reopenedArea = (await canvas.boundingBox())!;
  const reopened = (await image.boundingBox())!;
  expect(reopened.x).toBeGreaterThanOrEqual(reopenedArea.x);
  expect(reopened.y).toBeGreaterThanOrEqual(reopenedArea.y);
  expect(reopened.x + reopened.width).toBeLessThanOrEqual(reopenedArea.x + reopenedArea.width);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === "rich-note").blocks)).toEqual(original);
});

test("disables diagram enlargement for empty or invalid source and restores it after recovery", async ({ page }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  const source = block.getByLabel("流程图源码", { exact: true });
  const enlarge = block.getByRole("button", { name: "放大流程图", exact: true });
  await expect(enlarge).toBeEnabled({ timeout: 30000 });
  await source.fill("");
  await expect(enlarge).toBeDisabled();
  await expect(block.getByRole("button", { name: "查看流程图预览", exact: true })).toHaveCount(0);
  await source.fill("flowchart LR\n A[broken");
  await expect(block.getByRole("alert")).toContainText(/line|行|语法/i);
  await expect(enlarge).toBeDisabled();
  await source.fill("flowchart LR\n A[恢复] --> B[完成]");
  await expect(enlarge).toBeEnabled();
  await enlarge.click();
  const dialog = page.getByRole("dialog", { name: "流程图预览", exact: true });
  await expect(dialog).toBeVisible();
  expect(decodeURIComponent((await dialog.getByRole("img").getAttribute("src"))!)).toContain("恢复");
  await page.keyboard.press("Escape");
});

test("fits and zooms a tall diagram on a narrow English canvas", async ({ page }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  const code = `flowchart TB\n${Array.from({ length: 14 }, (_, index) => ` N${index}[Step ${index + 1}] --> N${index + 1}[Step ${index + 2}]`).join("\n")}`;
  await block.getByLabel("流程图源码", { exact: true }).fill(code);
  await expect(block.locator(".research-diagram-preview")).toContainText("Step 15");
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) {
    const toggle = page.getByRole("button", { name, exact: true });
    if (await toggle.isVisible()) await toggle.click();
  }
  await page.evaluate(() => localStorage.setItem("mewiki:locale", "en"));
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await block.getByRole("button", { name: "Enlarge diagram", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Diagram preview", exact: true });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole("img", { name: "Diagram preview", exact: true });
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  const imageBounds = (await image.boundingBox())!;
  expect(imageBounds.x).toBeGreaterThanOrEqual(bounds.x);
  expect(imageBounds.x + imageBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  const canvas = dialog.getByRole("region", { name: "Diagram canvas", exact: true });
  const area = (await canvas.boundingBox())!;
  expect(imageBounds.y).toBeGreaterThanOrEqual(area.y);
  expect(imageBounds.y + imageBounds.height).toBeLessThanOrEqual(area.y + area.height + 1);
  await dialog.getByRole("button", { name: "Actual size", exact: true }).click();
  expect((await image.boundingBox())!.height).toBe(await image.evaluate(image => (image as HTMLImageElement).naturalHeight));
  expect((await image.boundingBox())!.height).toBeGreaterThan(imageBounds.height * 1.5);
  await canvas.focus();
  const beforeMove = (await image.boundingBox())!;
  await canvas.press("ArrowDown");
  expect((await image.boundingBox())!.y).toBeCloseTo(beforeMove.y - 40, 0);
  await dialog.getByRole("button", { name: "Fit to canvas", exact: true }).click();
  expect((await image.boundingBox())!.height).toBeCloseTo(imageBounds.height, 0);
  await page.screenshot({ path: test.info().outputPath("diagram-preview-mobile-en.png") });
  await dialog.getByRole("button", { name: "Close Diagram preview", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("pinches and drags the diagram on a touch screen", async ({ page, context }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  await expect(block.locator(".research-diagram-preview svg")).toBeVisible({ timeout: 30000 });
  await block.getByRole("button", { name: "放大流程图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "流程图预览", exact: true });
  const image = dialog.getByRole("img", { name: "流程图预览", exact: true });
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const canvas = dialog.getByRole("region", { name: "绘图画布", exact: true });
  const box = (await canvas.boundingBox())!, original = (await image.boundingBox())!;
  const center = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const touch = await context.newCDPSession(page);
  await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: center.x - 40, y: center.y }, { id: 2, x: center.x + 40, y: center.y }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: center.x - 100, y: center.y }, { id: 2, x: center.x + 100, y: center.y }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(original.width * 2);
  const enlarged = (await image.boundingBox())!;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 3, x: center.x, y: center.y }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 3, x: center.x + 60, y: center.y + 40 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await image.boundingBox())!.x).toBeCloseTo(enlarged.x + 60, 0);
  expect((await image.boundingBox())!.y).toBeCloseTo(enlarged.y + 40, 0);
  await dialog.getByRole("button", { name: "适应画布", exact: true }).click();
  expect((await image.boundingBox())!.width).toBeCloseTo(original.width, 0);
  await touch.detach();
  await page.keyboard.press("Escape");
});

async function expectCompleteDiagram(svg: Locator) {
  const geometry = await svg.evaluate(element => {
    const svg = element as SVGSVGElement;
    const view = svg.viewBox.baseVal, box = svg.getBoundingClientRect(), content = svg.getBBox();
    return {
      view: { left: view.x, top: view.y, right: view.x + view.width, bottom: view.y + view.height },
      content: { left: content.x, top: content.y, right: content.x + content.width, bottom: content.y + content.height },
      width: box.width, height: box.height,
      parts: [...svg.querySelectorAll<SVGGraphicsElement>(".node, .edgePaths, .edgeLabels")].map(part => {
        const rect = part.getBoundingClientRect();
        return { text: part.textContent || part.getAttribute("class"), left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top };
      }),
    };
  });
  expect(geometry.view.left).toBeLessThanOrEqual(geometry.content.left);
  expect(geometry.view.top).toBeLessThanOrEqual(geometry.content.top);
  expect(geometry.view.right).toBeGreaterThanOrEqual(geometry.content.right);
  expect(geometry.view.bottom).toBeGreaterThanOrEqual(geometry.content.bottom);
  for (const part of geometry.parts) {
    expect(part.left, part.text || "left").toBeGreaterThanOrEqual(-1);
    expect(part.right, part.text || "right").toBeLessThanOrEqual(geometry.width + 1);
    expect(part.top, part.text || "top").toBeGreaterThanOrEqual(-1);
    expect(part.bottom, part.text || "bottom").toBeLessThanOrEqual(geometry.height + 1);
  }
}

for (const staleMeasurements of [false, true]) test(`fits every decision-flow node and loop${staleMeasurements ? " after stale render measurements" : ""}`, async ({ page, context }) => {
  if (staleMeasurements) await page.addInitScript(() => {
    const getBBox = SVGSVGElement.prototype.getBBox;
    SVGSVGElement.prototype.getBBox = function (options) {
      const box = getBBox.call(this, options);
      // Reproduce an offset viewport measured in Mermaid's temporary render tree.
      if (this.id.startsWith("research-diagram-") && this.parentElement?.id === `d${this.id}`) return new DOMRect(box.x - 100, box.y - 100, box.width, box.height);
      return box;
    };
  });
  if (staleMeasurements) await page.reload();
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  await block.getByLabel("流程图模板", { exact: true }).selectOption("flow");
  const svg = block.locator(".research-diagram-preview > svg");
  await expect(svg).toContainText("是否满足条件");
  await expect(svg.locator(".node")).toHaveCount(4);
  await expectCompleteDiagram(svg);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await expectCompleteDiagram(svg);
  if (staleMeasurements) await page.screenshot({ path: "docs/evidence/research-flowchart-desktop.png", fullPage: true });
  const download = page.waitForEvent("download");
  await block.getByRole("button", { name: "导出绘图 SVG", exact: true }).click();
  const exported = await readFile((await (await download).path())!, "utf8");
  const exportedPage = await context.newPage();
  await exportedPage.setContent(exported);
  await expectCompleteDiagram(exportedPage.locator("svg"));
  await exportedPage.close();
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) {
    const toggle = page.getByRole("button", { name, exact: true });
    if (await toggle.isVisible()) await toggle.click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectCompleteDiagram(svg);
  expect(await block.locator(".research-diagram-preview").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  if (staleMeasurements) await page.screenshot({ path: "docs/evidence/research-flowchart-mobile.png", fullPage: true });
});

test("fits a tall diagram after its nested tab opens and the reading area resizes", async ({ page }) => {
  const code = "flowchart TB\n A[开始] --> B[接收数据] --> C{是否满足条件}\n C -->|是| D[计算结果] --> E[保存结果] --> F[完成]\n C -->|否| B";
  await page.evaluate(code => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.notes.find((note: { id: string }) => note.id === "rich-note").blocks = [{
      id: "flow-tabs", type: "examples", tabs: [
        { id: "intro", title: "说明", blocks: [{ id: "intro-text", type: "paragraph", text: "查看另一标签页中的流程图。" }] },
        { id: "flow", title: "完整流程", blocks: [{ id: "nested-flow", type: "diagram", mode: "mermaid", code, strokes: [] }] },
      ],
    }];
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  }, code);
  await page.reload();
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await page.getByRole("tab", { name: "完整流程", exact: true }).click();
  const svg = page.locator(".research-diagram-preview > svg");
  await expect(svg).toContainText("完成");
  await expectCompleteDiagram(svg);
  await page.getByRole("button", { name: "放大流程图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "流程图预览", exact: true });
  await expect(dialog.getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: "符号", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "研究记录", exact: true }).click();
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) {
    const toggle = page.getByRole("button", { name, exact: true });
    if (await toggle.isVisible()) await toggle.click();
  }
  await expect(svg).toBeVisible();
  await expectCompleteDiagram(svg);
  await page.getByRole("tab", { name: "说明", exact: true }).click();
  await page.getByRole("tab", { name: "完整流程", exact: true }).click();
  await expectCompleteDiagram(svg);
  await page.reload();
  await page.getByRole("tab", { name: "完整流程", exact: true }).click();
  await expect(svg).toContainText("完成");
  await expectCompleteDiagram(svg);
});

test("draws and edits a vector sketch with undo, redo, text and read-only viewing", async ({ page }) => {
  await insert(page, "绘图与流程图");
  const block = page.locator(".research-diagram-block").last();
  await block.getByRole("button", { name: "手绘模式", exact: true }).click();
  const surface = block.getByRole("img", { name: "草图画布", exact: true });
  const box = (await surface.boundingBox())!;
  await block.getByRole("button", { name: "草图箭头", exact: true }).click();
  await page.mouse.move(box.x + 30, box.y + 35); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 10 }); await page.mouse.up();
  await expect(surface.locator("line")).toHaveCount(1);
  await block.getByRole("button", { name: "撤销绘图", exact: true }).click();
  await expect(surface.locator("line")).toHaveCount(0);
  await block.getByRole("button", { name: "重做绘图", exact: true }).click();
  await expect(surface.locator("line")).toHaveCount(1);
  await block.getByRole("button", { name: "草图文字", exact: true }).click();
  await surface.click({ position: { x: 60, y: 120 } });
  await block.getByLabel("草图文字内容", { exact: true }).fill("接收时刻");
  await block.getByRole("button", { name: "添加文字", exact: true }).click();
  await expect(surface.locator("text")).toContainText("接收时刻");
  await page.reload();
  await expect(surface.locator("line")).toHaveCount(1);
  await expect(surface.locator("text")).toContainText("接收时刻");
  await block.getByRole("button", { name: "放大草图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "草图预览", exact: true });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole("img", { name: "草图预览", exact: true });
  await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const snapshot = decodeURIComponent((await image.getAttribute("src"))!);
  expect(snapshot).toContain("接收时刻");
  expect(snapshot).toContain("<line");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(surface.locator("line")).toHaveCount(1);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  await expect(block.getByRole("toolbar", { name: "草图工具", exact: true })).toHaveCount(0);
  await expect(surface).toBeVisible();
  await block.getByRole("button", { name: "放大草图", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭草图预览", exact: true }).click();
});

test("restores all three content types and linked originals from an attachment backup", async ({ page }) => {
  await connect(page);
  await insert(page, "文献引用");
  const citation = page.locator(".research-citation-block").last();
  await citation.getByLabel("文献标题", { exact: true }).fill("备份文献");
  await citation.getByRole("button", { name: "关联文献 PDF", exact: true }).click();
  await citation.getByLabel("选择PDF 文档文件", { exact: true }).setInputFiles({ name: "原文.pdf", mimeType: "application/pdf", buffer: researchPdfFixture() });
  await expect(citation.locator("canvas")).toBeVisible();
  await insert(page, "数据与图表");
  const data = page.locator(".research-dataset-block").last();
  await data.getByLabel("选择数据文件", { exact: true }).setInputFiles({ name: "观测.csv", mimeType: "text/csv", buffer: Buffer.from("time,value\n0,3\n1,6") });
  await expect(data.getByRole("table", { name: "数据表预览" })).toContainText("6");
  await insert(page, "绘图与流程图");
  const drawing = page.locator(".research-diagram-block").last();
  await drawing.getByLabel("流程图源码", { exact: true }).fill("flowchart LR\n A[备份] --> B[恢复]");
  await expect(drawing.locator(".research-diagram-preview")).toContainText("恢复");
  await openSettingsSection(page, "storage");
  const dialog = page.getByTestId("research-library-storage");
  const download = page.waitForEvent("download");
  await openSettingsSection(page, "backup");
  await dialog.getByRole("button", { name: "导出含附件备份", exact: true }).click();
  const backup = await download;
  await closeSettingsPage(page);
  await drawing.getByLabel("流程图源码", { exact: true }).fill("flowchart LR\n X[后续修改]");
  await openSettingsSection(page, "storage");
  await openSettingsSection(page, "backup");
  await dialog.getByLabel("选择完整资料库备份").setInputFiles((await backup.path())!);
  await expect(dialog.getByLabel("恢复预览")).toBeVisible();
  await dialog.getByRole("button", { name: "确认恢复此版本", exact: true }).click();
  await expect(dialog.getByText("已恢复资料库，原版本已保留。", { exact: true })).toBeVisible();
  await closeSettingsPage(page);
  await expect(drawing.locator(".research-diagram-preview")).toContainText("恢复");
  await expect(data.getByRole("table", { name: "数据表预览" })).toContainText("6");
  const original = data.getByRole("link", { name: "观测.csv", exact: true });
  const originalDownload = page.waitForEvent("download"); await original.click();
  expect((await readFile((await (await originalDownload).path())!, "utf8"))).toBe("time,value\n0,3\n1,6");
  await expect(citation.getByText("备份文献", { exact: true })).toBeVisible();
});

test("shows all rich types in nested tabs on a narrow read-only page", async ({ page }) => {
  const blocks: ResearchNotebookBlock[] = [
    { id: "nested-ref", type: "citation", title: "离线文献", authors: "作者", year: "2026", notes: "阅读记录" },
    { id: "nested-data", type: "dataset", columns: ["t", "value"], rows: [["0", "1"], ["1", "2"]] },
    { id: "nested-chart", type: "diagram", mode: "mermaid", code: "flowchart LR\n A[开始] --> B[完成]", strokes: [] },
  ];
  await page.evaluate(blocks => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.notes.find((note: { id: string }) => note.id === "rich-note").blocks = [{ id: "nested-tabs", type: "examples", tabs: [{ id: "nested-tab", title: "资料", blocks }] }];
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  }, blocks);
  await page.reload();
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  for (const name of ["收起文章大纲", "收起笔记左侧面板"]) { const toggle = page.getByRole("button", { name, exact: true }); if (await toggle.isVisible()) await toggle.click(); }
  await page.setViewportSize({ width: 1440, height: 1400 });
  await expect(page.locator(".research-diagram-preview svg")).toBeVisible();
  await page.screenshot({ path: "docs/evidence/research-rich-content-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".research-citation-block")).toContainText("离线文献");
  await expect(page.getByLabel("数据图表", { exact: true })).toBeVisible();
  await expect(page.locator(".research-diagram-preview svg")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/evidence/research-rich-content-mobile.png", fullPage: true });
});
