import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Page } from "@playwright/test";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";


const positions = ["右上角标 x1", "右下角标 x2", "右侧变量 x3"];
const explanations = [
  "所属回路 $p$。\n同一符号可用于不同回路。",
  "采纳更新对应的分组索引 $g_h$，即使当前未填写取值，也保留这段说明。",
  "唯一物理回放时间 $t$，括号由取值完整给出。",
];

async function openDictionary(page: Page) {
  const state = createResearchNotebook();
  const entry = createSymbolEntry({
    name: "四处说明测试符号", notation: "q", meaning: "原本体说明。", category: "control", tags: ["自用/位置说明"], slots: [],
  }, "position-description");
  entry.slots[0].defaultValue = "(p)";
  entry.slots[2].defaultValue = "(t)";
  state.symbols.push(entry, createSymbolEntry({
    name: "另一标签词条", notation: "v", meaning: "其他含义。", category: "state", tags: ["自用/其他"], slots: [],
  }, "position-other"));
  state.activeSymbolId = entry.id;
  state.open = true;
  state.view = "dictionary";
  const legacy = { ...state, symbolFilters: { query: "", category: "time", tag: "自用" } };
  await page.addInitScript(value => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, legacy);
  await page.goto("/?page=research-notebook");
  const panel = page.getByTestId("research-notebook");
  const diagram = panel.getByRole("region", { name: "符号结构解释图", exact: true });
  await expect(diagram).toBeVisible();
  return { panel, diagram, tree: panel.getByRole("navigation", { name: "筛选后的符号词条", exact: true }) };
}

const savedEntry = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).symbols.find((entry: { id: string }) => entry.id === "position-description"));

test("retires category controls and persisted category filters while keeping tag filtering", async ({ page }) => {
  const { panel, tree } = await openDictionary(page);
  await expect(panel.getByLabel("筛选符号类别", { exact: true })).toHaveCount(0);
  await expect(panel.locator(".research-page-tags > .research-note-tag")).toHaveCount(0);
  await expect(tree.getByRole("button", { name: "四处说明测试符号", exact: true })).toBeVisible();
  await expect(tree.getByRole("button", { name: "另一标签词条", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).symbolFilters)).toEqual({ query: "", tag: "自用" });
  await panel.getByLabel("筛选符号层级标签", { exact: true }).selectOption("自用/位置说明");
  await expect(tree.getByRole("button", { name: "另一标签词条", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(panel.getByLabel("符号分类", { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("符号含义", { exact: true })).toBeVisible();
  for (const position of positions) await expect(panel.getByLabel(position + "说明", { exact: true })).toBeVisible();
});

test("saves independent explanations, discards canceled edits and keeps preview values temporary", async ({ page }, testInfo) => {
  const { panel, diagram, tree } = await openDictionary(page);
  const before = await savedEntry(page);
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  await panel.getByLabel("符号含义", { exact: true }).fill("待放弃的本体说明。");
  for (const position of positions) await panel.getByLabel(position + "说明", { exact: true }).fill("待放弃的位置说明。");
  await panel.getByRole("button", { name: "返回", exact: true }).click();
  expect(await savedEntry(page)).toEqual(before);
  await expect(diagram.getByText("尚未填写说明", { exact: true })).toHaveCount(3);
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  await panel.getByLabel("符号含义", { exact: true }).fill("本体说明：回路状态 $q$。\n用于解释整体符号。");
  for (const [index, position] of positions.entries()) await panel.getByLabel(position + "说明", { exact: true }).fill(explanations[index]);
  await panel.getByRole("button", { name: "保存定义", exact: true }).click();
  await expect(diagram.locator('[data-symbol-callout="body"]')).toContainText("本体说明：回路状态");
  await expect(diagram.getByLabel("右上角标 x1说明", { exact: true }).locator("annotation")).toHaveText("p");
  await expect(diagram.getByLabel("右下角标 x2说明", { exact: true })).toContainText("即使当前未填写取值");
  await expect(diagram.locator('[data-symbol-callout="x2"]')).toContainText("当前留空");
  const saved = await savedEntry(page);
  expect(saved.slots.map((slot: { description: string }) => slot.description)).toEqual(explanations);
  expect(saved.slots.map((slot: { defaultValue: string }) => slot.defaultValue)).toEqual(["(p)", "", "(t)"]);
  await diagram.screenshot({ path: testInfo.outputPath("position-explanations-desktop.png") });
  await diagram.getByLabel("右上角标 x1示例值", { exact: true }).fill("(q)");
  await diagram.getByLabel("右下角标 x2示例值", { exact: true }).fill("h+1");
  await diagram.getByLabel("右侧变量 x3示例值", { exact: true }).fill("[t]");
  await expect(diagram.locator(".research-symbol-hero annotation")).toHaveText("q^{(q)}_{h+1}[t]");
  expect(await savedEntry(page)).toEqual(saved);
  await page.reload();
  await expect(diagram.getByLabel("右下角标 x2示例值", { exact: true })).toHaveValue("");
  expect(await savedEntry(page)).toEqual(saved);
  await panel.getByLabel("搜索符号词条", { exact: true }).fill("唯一物理回放时间");
  await expect(tree.getByRole("button", { name: "四处说明测试符号", exact: true })).toBeVisible();
  await expect(tree.getByRole("button", { name: "另一标签词条", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(panel.getByLabel("右上角标 x1说明", { exact: true })).toHaveValue(explanations[0]);
  await panel.getByLabel("右上角标 x1说明", { exact: true }).fill("");
  await panel.getByRole("button", { name: "保存定义", exact: true }).click();
  await page.reload();
  await expect(diagram.getByLabel("右上角标 x1说明", { exact: true })).toHaveText("尚未填写说明");
  expect((await savedEntry(page)).slots[0].description).toBe("");
});

test("creates and reads explanations for empty positions on a narrow screen without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1100 });
  const { panel, diagram } = await openDictionary(page);
  await panel.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await panel.getByRole("button", { name: "新建符号词条", exact: true }).click();
  await panel.getByLabel("符号词条名称", { exact: true }).fill("空位置也有说明");
  await panel.getByLabel("符号模板", { exact: true }).fill("\\eta^{[x1]}_{[x2]}[x3]");
  await panel.getByLabel("符号含义", { exact: true }).fill("本体 $\\eta$ 的说明。");
  for (const [index, position] of positions.entries()) await panel.getByLabel(position + "说明", { exact: true }).fill(explanations[index]);
  const editor = panel.getByRole("region", { name: "符号词条编辑器", exact: true });
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const input of await editor.locator("textarea").all()) {
    const box = (await input.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  await editor.screenshot({ path: testInfo.outputPath("position-explanations-editor-mobile.png") });
  await panel.getByRole("button", { name: "保存定义", exact: true }).click();
  await expect(diagram.getByText("当前留空", { exact: true })).toHaveCount(3);
  await expect(diagram.getByText("尚未填写说明", { exact: true })).toHaveCount(0);
  await expect(diagram.locator(".research-symbol-hero annotation")).toHaveText("\\eta");
  await page.reload();
  await expect(panel.getByRole("heading", { name: "空位置也有说明", exact: true })).toBeVisible();
  await expect(diagram.getByLabel("右下角标 x2说明", { exact: true })).toContainText("即使当前未填写取值");
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await expect.poll(() => diagram.evaluate(element => element.clientWidth)).toBeGreaterThan(300);
  await diagram.screenshot({ path: testInfo.outputPath("position-explanations-mobile.png") });
});
