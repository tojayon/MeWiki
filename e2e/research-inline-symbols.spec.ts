import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Page } from "@playwright/test";
import katex from "katex";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";
import { positionSlots } from "../src/domain/researchSymbolPositions.ts";
import { defaultCalloutAppearance } from "../src/domain/researchCallout.ts";

async function openInlineSymbols(page: Page, edit = false) {
  const state = createResearchNotebook();
  state.symbols = [
    ["inline-state", "行内状态向量", "\\boldsymbol{x}", "", "", "(t)"],
    ["inline-rate", "行内状态变化率", "\\dot{\\boldsymbol{x}}", "", "", "(t)"],
    ["inline-completion", "计算完成时刻", "c", "", "h", ""],
    ["inline-capacity", "调度容量", "c", "", "k", ""],
    ["inline-age", "当前采纳样本年龄", "\\Delta", "", "", "(t)"],
    ["inline-time", "物理时间", "t", "", "", ""],
  ].map(([id, name, base, x1, x2, x3]) => createSymbolEntry({
    name, notation: base + "^{[x1]}_{[x2]}[x3]", meaning: name + "的词典说明。", category: "custom", slots: positionSlots({ x1, x2, x3 }),
  }, id));
  state.notes = [
    { ...createResearchNote("行内符号阅读"), id: "inline-note", blocks: [
      { id: "inline-paragraph", type: "paragraph", text: "行内 $\\boldsymbol{x}_{j+1}^{(q)}(t)+c_h+\\Delta(t)+z$，点击变量查看说明。`c_h` 是代码。参见 [对照笔记](#research-note/inline-other)。" },
      { id: "inline-ambiguous", type: "paragraph", text: "同形符号 $c_j$，文字 $\\text{cache and t}+\\mathrm{cat}+z$。" },
      { id: "inline-nested", type: "paragraph", text: "嵌套分式 $\\frac{\\dot{\\boldsymbol{x}}(t)}{c_h}$ 与独立变量 $t+t$。" },
      { id: "inline-matrices", type: "paragraph", text: "矩阵 $\\begin{array}{c|c}c_h & t\\end{array}$，可选对齐 $\\begin{matrix*}[c]c_h & t\\end{matrix*}$，单列 $\\begin{subarray}{c}c_h\\\\t\\end{subarray}$。" },
      { id: "inline-heading", type: "heading", level: 2, text: "年龄 $\\Delta(t)$" },
      { id: "inline-list", type: "list", items: ["列表 $\\Delta(t)$"] },
      { id: "inline-callout", type: "callout", title: "提示", text: "提示 $\\Delta(t)$", appearance: { ...defaultCalloutAppearance } },
      { id: "inline-tabs", type: "examples", tabs: [{ id: "inline-tab", title: "标签页", blocks: [{ id: "inline-tab-body", type: "paragraph", text: "标签页 $\\Delta(t)$" }] }] },
      { id: "inline-table", type: "markdown", kind: "table", text: "| 含义 |\n| --- |\n| 表格 $\\Delta(t)$ |" },
      { id: "inline-block-formula", type: "formula", tex: "", caption: "已有内容块交互", parts: [{ type: "symbol", entryId: "inline-age", bindings: { x1: "", x2: "", x3: "(t)" } }] },
    ] },
    { ...createResearchNote("对照笔记"), id: "inline-other", blocks: [{ id: "inline-other-body", type: "paragraph", text: "分屏中的 $\\Delta(t)$ 也可查看。" }] },
    { ...createResearchNote("定义笔记"), id: "inline-definition", blocks: [{
      id: "inline-source", type: "formula", tex: "", caption: "状态的定义公式",
      parts: [{ type: "symbol", entryId: "inline-state", bindings: { x1: "", x2: "", x3: "(t)" } }],
      outputs: [{ id: "inline-result", entryId: "inline-state", bindings: { x1: "", x2: "", x3: "(t)" } }],
    }] },
  ];
  state.activeNoteId = "inline-note"; state.librarySelections = { research: "inline-note" }; state.view = "notes"; state.open = true;
  await page.addInitScript(({ state, edit }) => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:research-notebook-mode", edit ? "edit" : "read");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "true");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, { state, edit });
  await page.goto("/?page=research-notebook");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("行内符号阅读");
  return { panel, paragraph: panel.locator('[data-block-id="inline-paragraph"]') };
}

let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on("pageerror", error => errors.push(error.message)); });
test.afterEach(() => { expect(errors).toEqual([]); });

test("opens the existing details panel for dictionary variables in an inline formula", async ({ page }, info) => {
  const { panel, paragraph } = await openInlineSymbols(page);
  const variable = paragraph.getByRole("button", { name: "查看符号 行内状态向量", exact: true });
  await expect(variable).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"));
  await variable.click();
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("行内状态向量的词典说明。");
  await expect(popover.locator(".research-formula-symbol-instance annotation")).toHaveText("\\boldsymbol{x}_{j+1}^{(q)}(t)");
  await expect(popover.getByRole("button", { name: /定义笔记.*状态的定义公式/ })).toBeVisible();
  await popover.screenshot({ path: info.outputPath("inline-symbol-details-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(variable).toBeFocused();
  await paragraph.getByRole("button", { name: "查看符号 计算完成时刻", exact: true }).click();
  await expect(popover).toContainText("计算完成时刻的词典说明。");
  expect(await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"))).toBe(before);
  await panel.getByLabel("笔记标题", { exact: true }).click();
  await expect(popover).toHaveCount(0);
});

test("chooses between shared notations and opens definitions or dictionary entries from the same panel", async ({ page }) => {
  const { panel, paragraph } = await openInlineSymbols(page);
  const ambiguous = panel.locator('[data-block-id="inline-ambiguous"]');
  await ambiguous.getByRole("button", { name: "查看符号的多个含义", exact: true }).click();
  const choices = page.getByRole("dialog", { name: "选择符号含义", exact: true });
  await expect(choices.getByRole("option")).toHaveCount(2);
  await expect(choices.locator('.research-note-tree')).toBeVisible();
  await choices.getByRole("option", { name: /调度容量/ }).click();
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await expect(popover).toContainText("调度容量的词典说明。");
  await expect(popover.locator(".research-formula-symbol-instance annotation")).toHaveText("c_j");
  await page.keyboard.press("Escape");
  await paragraph.getByRole("button", { name: "查看符号 行内状态向量", exact: true }).click();
  await popover.getByRole("button", { name: /定义笔记.*状态的定义公式/ }).click();
  await expect(page.locator('[data-reading-note-id="inline-definition"]')).toBeVisible();
  await expect(popover).toHaveCount(0);
  await paragraph.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true }).click();
  await popover.getByRole("button", { name: "打开词典词条", exact: true }).click();
  await expect(panel.locator(".research-dictionary")).toHaveClass(/is-active/);
  await expect(panel.getByRole("heading", { name: "当前采纳样本年龄", exact: true })).toBeVisible();
  await expect(popover).toHaveCount(0);
});

test("preserves original inline glyph layout, colors and accessible math and ignores literal text", async ({ page }) => {
  const { panel } = await openInlineSymbols(page);
  for (const id of ["inline-paragraph", "inline-ambiguous", "inline-nested"]) {
    for (const formula of await panel.locator(`[data-block-id="${id}"] .research-inline-formula > .formula`).all()) {
      const tex = (await formula.locator("annotation").textContent())!;
      const expected = katex.renderToString(tex);
      const difference = await formula.evaluate((element, html) => {
        const reference = document.createElement("span");
        reference.className = "formula";
        reference.style.cssText = `position:fixed;left:-10000px;top:0;font-size:${getComputedStyle(element).fontSize};line-height:${getComputedStyle(element).lineHeight};color:${getComputedStyle(element).color}`;
        reference.innerHTML = html; document.body.append(reference);
        const glyphs = (root: Element) => {
          const origin = root.querySelector(".katex-html")!.getBoundingClientRect();
          return [...root.querySelectorAll<HTMLElement>(".katex-html span")].filter(node => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.replace(/[\s\u200b]/g, ""))).map(node => {
            const box = node.getBoundingClientRect();
            return { text: node.textContent, x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height, color: getComputedStyle(node).color };
          });
        };
        const result = { actual: glyphs(element), expected: glyphs(reference), math: element.querySelector("math")!.outerHTML, expectedMath: reference.querySelector("math")!.outerHTML };
        reference.remove(); return result;
      }, expected);
      expect(difference.math).toBe(difference.expectedMath);
      expect(difference.actual.map(glyph => glyph.text)).toEqual(difference.expected.map(glyph => glyph.text));
      expect(difference.actual.map(glyph => glyph.color)).toEqual(difference.expected.map(glyph => glyph.color));
      for (const [index, glyph] of difference.actual.entries()) for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(glyph[key] - difference.expected[index][key])).toBeLessThanOrEqual(1 / 64);
    }
  }
  await expect(panel.locator('[data-block-id="inline-paragraph"] code button')).toHaveCount(0);
  await expect(panel.locator('[data-block-id="inline-ambiguous"] .research-inline-formula').nth(1).getByRole("button")).toHaveCount(0);
  const nested = panel.locator('[data-block-id="inline-nested"]');
  await expect(nested.getByRole("button", { name: "查看符号 行内状态变化率", exact: true })).toHaveCount(1);
  await expect(nested.getByRole("button", { name: "查看符号 行内状态向量", exact: true })).toHaveCount(0);
  await expect(nested.getByRole("button", { name: "查看符号 物理时间", exact: true })).toHaveCount(2);
  await nested.getByRole("button", { name: "查看符号 行内状态变化率", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "符号含义与推导来源", exact: true })).toContainText("行内状态变化率的词典说明。");
});

test("keeps mouse and keyboard symbol inspection separate from paragraph and table editing", async ({ page }) => {
  const { panel, paragraph } = await openInlineSymbols(page, true);
  const variable = paragraph.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true });
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await variable.focus(); await variable.press("Enter");
  await expect(popover).toBeVisible();
  await expect(paragraph.locator("textarea")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(variable).toBeFocused();
  await variable.press("Space");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  const table = panel.locator('[data-block-id="inline-table"]');
  await table.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true }).click();
  await expect(popover).toBeVisible();
  await expect(table.getByRole("textbox", { name: "单元格内容", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await paragraph.getByText("，点击变量查看说明。", { exact: false }).click({ position: { x: 2, y: 5 } });
  await expect(paragraph.locator("textarea")).toBeVisible();
});

test("inspects matrix entries while ignoring column formatting arguments", async ({ page }) => {
  const { panel } = await openInlineSymbols(page);
  const formulas = panel.locator('[data-block-id="inline-matrices"] .research-inline-formula');
  await expect(formulas).toHaveCount(3);
  for (const formula of await formulas.all()) {
    await expect(formula.getByRole("button")).toHaveCount(2);
    await formula.getByRole("button", { name: "查看符号 计算完成时刻", exact: true }).click();
    const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
    await expect(popover).toContainText("计算完成时刻的词典说明。");
    await page.keyboard.press("Escape");
    await formula.getByRole("button", { name: "查看符号 物理时间", exact: true }).click();
    await expect(popover).toContainText("物理时间的词典说明。");
    await page.keyboard.press("Escape");
  }
});

test("shares symbol inspection across headings, lists, callouts, tabs, tables and split reading", async ({ page }) => {
  const { panel, paragraph } = await openInlineSymbols(page);
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  for (const id of ["inline-heading", "inline-list", "inline-callout", "inline-tab-body", "inline-table", "inline-block-formula"]) {
    await panel.locator(`[data-block-id="${id}"]`).getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true }).click();
    await expect(popover).toContainText("当前采纳样本年龄的词典说明。");
    await page.keyboard.press("Escape");
  }
  await paragraph.getByRole("link", { name: "对照笔记", exact: true }).click();
  const split = page.locator('[data-reading-note-id="inline-other"]');
  await split.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true }).click();
  await expect(popover).toContainText("当前采纳样本年龄的词典说明。");
});

test("fits symbol details on a phone and keeps the focus and anchor after resizing", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { paragraph } = await openInlineSymbols(page);
  const variable = paragraph.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true });
  await variable.click();
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await expect(popover).toBeVisible();
  for (const width of [390, 720, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => { const box = await popover.boundingBox(); return !!box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844; }).toBe(true);
  }
  await popover.screenshot({ path: info.outputPath("inline-symbol-details-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(variable).toBeFocused();
});

test("moves keyboard focus into symbol choices and keeps only one inline inspection open", async ({ page }) => {
  const { panel, paragraph } = await openInlineSymbols(page);
  const variable = panel.locator('[data-block-id="inline-ambiguous"]').getByRole("button", { name: "查看符号的多个含义", exact: true });
  await variable.focus(); await variable.press("Enter");
  const choices = page.getByRole("dialog", { name: "选择符号含义", exact: true });
  await expect(choices.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await expect(popover).toContainText("调度容量的词典说明。");
  await expect(popover.getByRole("button", { name: "打开词典词条", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(variable).toBeFocused();
  await variable.press("Enter");
  const age = paragraph.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true });
  await age.focus(); await age.press("Enter");
  await expect(choices).toHaveCount(0);
  await expect(popover).toHaveCount(1);
  await expect(popover).toContainText("当前采纳样本年龄的词典说明。");
});

test("dismisses inline details when switching away from the reading view with the keyboard", async ({ page }) => {
  const { panel, paragraph } = await openInlineSymbols(page);
  await panel.getByRole("button", { name: "展开笔记左侧面板", exact: true }).click();
  await paragraph.getByRole("button", { name: "查看符号 当前采纳样本年龄", exact: true }).click();
  const popover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await expect(popover).toBeVisible();
  const tab = panel.getByRole("tab", { name: "符号词典", exact: true });
  await tab.focus(); await tab.press("Enter");
  await expect(panel.locator(".research-dictionary")).toHaveClass(/is-active/);
  await expect(popover).toHaveCount(0);
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await expect(paragraph).toBeVisible();
  await expect(popover).toHaveCount(0);
});
