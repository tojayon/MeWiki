import { expectEditorSource } from "./helpers/referenceEditor.ts";
import { expect, test } from "@playwright/test";
import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";
import { dictionaryReferenceMarkdown } from "../src/domain/researchTerms.ts";

test("keeps the detail pane unchanged while switching dictionary tabs until an entry is selected", async ({ page }) => {
  const state = createResearchNotebook();
  const symbol = createSymbolEntry({ name: "状态符号", notation: "q", meaning: "当前状态", category: "state", slots: [] }, "symbol-tab-detail");
  state.symbols = [symbol];
  state.terms = [{ id: "term-tab-detail", name: "多义术语", aliases: [], meaning: "术语整体含义", status: "active" }];
  state.activeSymbolId = symbol.id;
  state.view = "dictionary";
  state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");

  const panel = page.getByTestId("research-notebook");
  await expect(panel.locator(".research-symbol-title")).toHaveText("状态符号");
  await panel.getByRole("tab", { name: "术语", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "术语", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator(".research-symbol-title")).toHaveText("状态符号");
  await expect(panel.getByRole("region", { name: "术语词条详情", exact: true })).toHaveCount(0);

  await panel.getByLabel("搜索术语词条", { exact: true }).fill("多义");
  await panel.getByRole("button", { name: "多义术语", exact: true }).click();
  await expect(panel.getByLabel("搜索术语词条", { exact: true })).toHaveValue("多义");
  await expect(panel.getByRole("region", { name: "术语词条详情", exact: true })).toBeVisible();
  await expect(panel.locator(".research-symbol-title")).toHaveText("多义术语");
  await panel.getByRole("button", { name: "编辑术语", exact: true }).click();
  await panel.getByLabel("术语含义", { exact: true }).fill("切换标签页时保留的术语草稿");
  await panel.getByRole("tab", { name: "符号", exact: true }).click();
  await expect(panel.getByLabel("术语含义", { exact: true })).toHaveValue("切换标签页时保留的术语草稿");
  await panel.getByRole("button", { name: "保存术语定义", exact: true }).click();
  await expect(panel.getByRole("region", { name: "术语词条详情", exact: true })).toContainText("切换标签页时保留的术语草稿");
  await panel.getByRole("button", { name: "状态符号", exact: true }).click();
  await expect(panel.locator(".research-symbol-title")).toHaveText("状态符号");
});

test("creates the first term from the browsed sidebar while a note remains open", async ({ page }) => {
  const state = createResearchNotebook();
  state.terms = [];
  state.activeTermId = undefined;
  state.view = "notes";
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const title = page.getByLabel("笔记标题", { exact: true });
  const originalTitle = await title.inputValue();
  await page.getByRole("tab", { name: "术语", exact: true }).click();
  await expect(title).toBeVisible();
  await expect(title).toHaveValue(originalTitle);
  await page.getByRole("button", { name: "新建术语词条", exact: true }).click();
  await page.getByLabel("术语名称", { exact: true }).fill("原子概念");
  await page.getByLabel("术语含义", { exact: true }).fill("由用户维护的统一名称。");
  await page.getByRole("button", { name: "保存术语定义", exact: true }).click();
  await expect(page.getByRole("region", { name: "术语词条详情", exact: true })).toContainText("原子概念");
});

for (const kind of ["term", "symbol"] as const) test(`opens the referenced ${kind} after leaving an earlier dictionary draft`, async ({ page }) => {
  const state = createResearchNotebook();
  state.symbols = ["甲", "乙"].map((name, index) => createSymbolEntry({ name: `符号${name}`, notation: index ? "r" : "q", meaning: `符号${name}的说明`, slots: [] }, `navigate-symbol-${index}`));
  state.terms = ["甲", "乙"].map((name, index) => ({ id: `navigate-term-${index}`, name: `术语${name}`, aliases: [], meaning: `术语${name}的说明` }));
  const note = { ...createResearchNote("导航检查"), id: "navigate-note", blocks: [{ id: "navigate-body", type: "paragraph" as const,
    text: "[术语乙](mewiki-term:navigate-term-1) 与 [$r$](mewiki-symbol:navigate-symbol-1)。" }] };
  state.notes = [note]; state.activeNoteId = note.id;
  state.activeSymbolId = state.symbols[0].id;
  state.activeTermId = kind === "term" ? state.terms[0].id : undefined;
  state.view = "dictionary";
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: kind === "term" ? "编辑术语" : "编辑", exact: true }).click();
  await page.getByLabel(kind === "term" ? "术语含义" : "符号含义", { exact: true }).fill("旧条目的草稿");
  await page.getByRole("tab", { name: kind === "term" ? "符号" : "术语", exact: true }).click();
  await page.getByRole("button", { name: kind === "term" ? "符号甲" : "术语甲", exact: true }).click();
  await page.getByRole("tab", { name: "研究记录", exact: true }).click();
  await page.locator("#research-notebook-sidebar").getByRole("button", { name: "导航检查", exact: true }).click();
  const body = page.locator('[data-block-id="navigate-body"]');
  await body.getByRole("button", { name: kind === "term" ? "术语：术语乙" : "符号：符号乙", exact: true }).click();
  await page.getByRole("dialog", { name: kind === "term" ? "术语解释" : "符号含义与推导来源", exact: true }).getByRole("button", { name: "打开词典词条", exact: true }).click();
  await expect(page.locator(".research-symbol-title")).toHaveText(kind === "term" ? "术语乙" : "符号乙");
  await expect(page.getByRole("region", { name: kind === "term" ? "术语词条详情" : "符号词条详情", exact: true })).toBeVisible();
});

test("creates terms, inserts stable references, and refreshes every displayed name after a rename", async ({ page }) => {
  const state = createResearchNotebook();
  state.terms = [{ id: "term-orbit", name: "轨道面", aliases: ["轨道平面"], meaning: "描述轨道方向的几何平面。", tags: ["写作/术语"], status: "active" }];
  state.notes = [{ ...createResearchNote("术语一致性"), id: "term-note", blocks: [{ id: "term-body", type: "paragraph", text: "参见 [轨道面](mewiki-term:term-orbit)。" }] }];
  state.activeNoteId = "term-note";
  state.activeTermId = "term-orbit";
  state.view = "notes";
  state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.goto("/?page=research-notebook");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.locator('[data-block-id="term-body"]')).toContainText("轨道面");

  await panel.getByRole("tab", { name: "术语", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "术语", exact: true })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: "符号", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "符号", exact: true })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: "术语", exact: true }).click();
  await panel.getByRole("button", { name: "轨道面", exact: true }).click();
  await expect(panel.getByRole("region", { name: "术语词条详情", exact: true }).locator(".term-diagram-title")).toHaveText("轨道面");
  await panel.getByRole("button", { name: "编辑术语", exact: true }).click();
  await panel.getByLabel("术语名称", { exact: true }).fill("轨道几何面");
  await panel.getByRole("button", { name: "保存术语定义", exact: true }).click();
  await expect(panel.getByRole("region", { name: "术语词条详情", exact: true }).locator(".term-diagram-title")).toHaveText("轨道几何面");
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "术语一致性", exact: true }).click();
  await expect(panel.locator('[data-block-id="term-body"]')).toContainText("轨道几何面");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === "term-note").blocks[0].text)).toContain("mewiki-term:term-orbit");
});

test("inserts a selected term from the # picker without changing the source text around it", async ({ page }) => {
  const state = createResearchNotebook();
  state.terms = [{ id: "term-sample", name: "采纳样本", aliases: ["样本"], meaning: "用于研究的样本", status: "active" }];
  const note = createResearchNote("编辑术语");
  note.id = "term-editor";
  note.blocks = [{ id: "body", type: "paragraph", text: "前文 后文" }];
  state.notes = [note]; state.activeNoteId = note.id; state.view = "notes"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "edit");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const block = page.locator('[data-block-id="body"]');
  const editor = block.locator('[contenteditable="true"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  await editor.press("Home");
  await editor.type("#");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await expect(picker.getByRole("option", { name: "采纳样本", exact: true })).toBeVisible();
  await picker.getByRole("option", { name: "采纳样本", exact: true }).click();
  await expectEditorSource(editor, /\[采纳样本\]\(mewiki-term:term-sample\)前文 后文/);
});

test("refreshes a stable inline symbol reference after its notation changes", async ({ page }) => {
  const state = createResearchNotebook();
  const symbol = createSymbolEntry({ name: "统一状态", notation: "q", meaning: "状态含义", category: "state", slots: [] }, "symbol-stable");
  state.symbols = [symbol];
  const note = createResearchNote("符号一致性");
  note.id = "symbol-note";
  note.blocks = [{ id: "symbol-body", type: "paragraph", text: `使用 ${dictionaryReferenceMarkdown("symbol", symbol, "$q$", {})}。` }];
  state.notes = [note]; state.activeNoteId = note.id; state.activeSymbolId = symbol.id; state.view = "notes"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.locator('[data-block-id="symbol-body"] annotation')).toHaveText("q");
  await panel.getByRole("tab", { name: "符号", exact: true }).click();
  await panel.getByRole("button", { name: "统一状态", exact: true }).click();
  await panel.getByRole("button", { name: "编辑", exact: true }).click();
  await panel.getByLabel("符号模板", { exact: true }).fill("r^{[x1]}_{[x2]}[x3]");
  await panel.getByRole("button", { name: "保存定义", exact: true }).click();
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "符号一致性", exact: true }).click();
  await expect(panel.locator('[data-block-id="symbol-body"] annotation')).toHaveText("r");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].text)).toContain("mewiki-symbol:symbol-stable");
});

test("previews legacy term names and lets each hit be replaced or bound", async ({ page }) => {
  const state = createResearchNotebook();
  state.terms = [{ id: "term-legacy", name: "轨道面", aliases: ["旧轨道"], meaning: "描述轨道方向的几何平面。", status: "active" }];
  const note = createResearchNote("旧称检查");
  note.id = "legacy-note";
  note.blocks = [{ id: "legacy-body", type: "paragraph", text: "正文使用旧轨道一次，也使用旧轨道二次。代码 `旧轨道`，公式 $旧轨道$，链接 [旧轨道](https://example.com/旧轨道)。" }];
  state.notes = [note]; state.activeNoteId = note.id; state.activeTermId = "term-legacy"; state.view = "dictionary"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.getByRole("button", { name: "一致性检查", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "一致性检查", exact: true }).click();
  const consistency = panel.getByRole("region", { name: "一致性检查", exact: true });
  await expect(consistency.locator("li.research-dictionary-consistency-hit")).toHaveCount(2);
  await expect(consistency.locator("li.research-dictionary-consistency-hit").first().getByText(/代码/)).toBeVisible();
  await consistency.getByRole("button", { name: "替换这处文本", exact: true }).first().click();
  await consistency.getByRole("button", { name: "绑定这处文本", exact: true }).first().click();
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "旧称检查", exact: true }).click();
  await expect(panel.locator('[data-block-id="legacy-body"]')).toContainText("轨道面");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].text);
  expect(saved).toContain("mewiki-term:term-legacy");
  expect(saved).toContain("正文使用[轨道面](mewiki-term:term-legacy)一次");
});

test("keeps dictionary references quiet until hover and opens the matching explanation panel", async ({ page }) => {
  const state = createResearchNotebook();
  const symbol = createSymbolEntry({ name: "统一状态", notation: "q", meaning: "状态含义", category: "state", slots: [] }, "symbol-reference");
  state.symbols = [symbol];
  state.terms = [{ id: "term-reference", name: "轨道面", aliases: [], meaning: "描述轨道方向的几何平面。", atoms: [
    { id: "atom-orbit", text: "轨道", meaning: "天体运行所沿的路径。" },
    { id: "atom-plane", text: "面", meaning: "承载轨道方向的几何平面。" },
  ], status: "active" }];
  const note = createResearchNote("词典引用交互");
  note.id = "reference-note";
  note.blocks = [{ id: "reference-body", type: "paragraph", text: "[轨道面](mewiki-term:term-reference) 与 [$q$](mewiki-symbol:symbol-reference)。" }];
  state.notes = [note]; state.activeNoteId = note.id; state.activeSymbolId = symbol.id; state.activeTermId = "term-reference"; state.view = "notes"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const panel = page.getByTestId("research-notebook");
  const body = panel.locator('[data-block-id="reference-body"]');
  const termReference = body.locator(".research-dictionary-term-reference");
  await expect(termReference).toHaveText("轨道面");
  await expect(termReference).toHaveAttribute("aria-label", "术语：轨道面");
  expect(await termReference.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe("none");
  await termReference.hover();
  expect(await termReference.evaluate(element => getComputedStyle(element).textDecorationStyle)).toBe("dotted");
  await termReference.click();
  const termPopover = page.getByRole("dialog", { name: "术语解释", exact: true });
  await expect(termPopover).toBeVisible();
  await expect(termPopover.getByRole("heading", { name: "轨道面", exact: true })).toBeVisible();
  await expect(termPopover).toContainText("描述轨道方向的几何平面。");
  await expect(termPopover).toContainText("天体运行所沿的路径。");
  await expect(termPopover).toContainText("承载轨道方向的几何平面。");
  await expect(panel.getByRole("tab", { name: "研究记录", exact: true })).toHaveAttribute("aria-selected", "true");
  await termPopover.getByRole("button", { name: "打开词典词条", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "术语", exact: true })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "词典引用交互", exact: true }).click();
  const noteBody = panel.locator('[data-block-id="reference-body"]');
  const currentSymbolReference = noteBody.locator(".research-dictionary-symbol-reference");
  await expect(currentSymbolReference).toBeVisible();
  await expect(currentSymbolReference).toHaveJSProperty("tagName", "BUTTON");
  await currentSymbolReference.hover();
  expect(await currentSymbolReference.evaluate(element => getComputedStyle(element).textDecorationStyle)).toBe("dashed");
  await currentSymbolReference.click();
  const symbolPopover = page.getByRole("dialog", { name: "符号含义与推导来源", exact: true });
  await expect(symbolPopover).toContainText("状态含义");
  await expect(noteBody).toBeVisible();
  await expect(panel.getByRole("tab", { name: "研究记录", exact: true })).toHaveAttribute("aria-selected", "true");
  await symbolPopover.getByRole("button", { name: "打开词典词条", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "符号", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("heading", { name: "统一状态", exact: true })).toBeVisible();
});

test("edits ordered term atoms and places their explanations in one row below the centered term", async ({ page }, info) => {
  const state = createResearchNotebook();
  state.terms = [{ id: "term-atomic", name: "ABCDEF", aliases: [], meaning: "整体定义", atoms: [
    { id: "atom-ab", text: "AB", meaning: "前缀解释" },
    { id: "atom-c", text: "C", meaning: "中间解释" },
    { id: "atom-def", text: "DEF", meaning: "后缀解释" },
  ], status: "active" }];
  state.activeTermId = "term-atomic"; state.view = "dictionary"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  await expect(page.getByTestId("research-notebook")).toBeVisible();
  const panel = page.getByTestId("research-notebook");
  await expect(panel.locator(".research-term-item").first().locator("svg.lucide-atom")).toBeVisible();
  const detail = panel.getByRole("region", { name: "术语词条详情", exact: true });
  const diagram = detail.getByRole("region", { name: "术语结构解释图", exact: true });
  await expect(diagram.locator(".term-diagram-title")).toHaveText("ABCDEF");
  await expect(diagram.locator(".term-diagram-title [data-term-atom-piece]")).toHaveCount(3);
  await expect(diagram.locator(".term-diagram-atom-links [data-term-atom-link]")).toHaveCount(3);
  await expect(diagram.locator(".term-diagram-atom-links")).toHaveText("");
  const alignment = await diagram.evaluate(element => [...element.querySelectorAll<HTMLElement>("[data-term-atom-piece]")].map(piece => {
    const link = element.querySelector<HTMLElement>(`[data-term-atom-link="${CSS.escape(piece.dataset.termAtomPiece ?? "")}"]`)!;
    const pieceBox = piece.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    return { centerDelta: Math.abs((pieceBox.left + pieceBox.right) / 2 - (linkBox.left + linkBox.right) / 2), widthDelta: Math.abs(pieceBox.width - linkBox.width) };
  }));
  expect(alignment.every(item => item.centerDelta < 2 && item.widthDelta < 2)).toBe(true);
  await expect(diagram.locator('[data-term-callout]')).toHaveCount(3);
  await expect(diagram.locator('[data-term-connection]')).toHaveCount(3);
  const layout = await diagram.evaluate(element => {
    const canvas = element.querySelector(".term-diagram-canvas")!.getBoundingClientRect();
    const title = element.querySelector(".term-diagram-title")!.getBoundingClientRect();
    const underlines = element.querySelector(".term-diagram-atom-links")!.getBoundingClientRect();
    const cards = [...element.querySelectorAll("[data-term-callout]")].map(card => card.getBoundingClientRect());
    return {
      centerDelta: Math.abs((title.left + title.right) / 2 - (canvas.left + canvas.right) / 2),
      belowTerm: cards.every(card => card.top > underlines.bottom),
      cardTops: cards.map(card => Math.round(card.top)),
      ordered: cards.every((card, index) => index === 0 || card.left >= cards[index - 1].right),
    };
  });
  expect(layout.centerDelta).toBeLessThan(2);
  expect(layout.belowTerm).toBe(true);
  expect(new Set(layout.cardTops).size).toBe(1);
  expect(layout.ordered).toBe(true);
  await expect(diagram.locator('[data-term-callout="atom-ab"]')).toContainText("前缀解释");
  await expect(diagram.locator('[data-term-callout="atom-c"]')).toContainText("中间解释");
  await expect(diagram.locator('[data-term-callout="atom-def"]')).toContainText("后缀解释");
  await diagram.locator('[data-term-atom-piece="atom-c"]').hover();
  await expect(diagram.locator('[data-term-atom-piece="atom-c"]')).toHaveCSS("color", "rgb(21, 71, 192)");
  await expect(diagram.locator('[data-term-atom-piece="atom-ab"]')).not.toHaveCSS("color", "rgb(21, 71, 192)");
  await panel.getByRole("button", { name: "编辑术语", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "术语组成", exact: true })).toBeVisible();
  await panel.getByLabel("原子词汇 2 解释", { exact: true }).fill("更新后的中间解释");
  await panel.getByRole("button", { name: "保存术语定义", exact: true }).click();
  await expect(detail.locator('[data-term-callout="atom-c"]')).toContainText("更新后的中间解释");
  await page.screenshot({ path: info.outputPath("term-cards-below-desktop.png") });
});

for (const width of [720, 390]) test(`keeps long term segments aligned with one explanation row at ${width}px`, async ({ page }, info) => {
  const state = createResearchNotebook();
  state.terms = [{ id: "term-long", name: "远程通信网络化多智能体分布式协同控制系统", aliases: [], meaning: "整体定义", atoms: [
    { id: "atom-remote", text: "远程通信", meaning: "远程通信的解释" },
    { id: "atom-network", text: "网络化多智能体分布式协同", meaning: "网络化多智能体分布式协同的解释" },
    { id: "atom-control", text: "控制", meaning: "控制的解释" },
    { id: "atom-system", text: "系统", meaning: "系统的解释" },
  ], status: "active" }];
  state.activeTermId = "term-long"; state.view = "dictionary"; state.open = true;
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const diagram = page.getByRole("region", { name: "术语结构解释图", exact: true });
  const scrollArea = diagram.locator(".term-diagram-term-scroll");
  await expect(scrollArea).toBeVisible();
  await expect.poll(() => scrollArea.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scrollArea.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => diagram.evaluate(element => {
    const piece = element.querySelector<HTMLElement>('[data-term-atom-piece="atom-system"]')!.getBoundingClientRect();
    const link = element.querySelector<HTMLElement>('[data-term-atom-link="atom-system"]')!.getBoundingClientRect();
    return Math.abs((piece.left + piece.right) / 2 - (link.left + link.right) / 2);
  })).toBeLessThan(2);
  await expect.poll(() => diagram.evaluate(element => {
    const canvas = element.querySelector<HTMLElement>(".term-diagram-canvas")!.getBoundingClientRect();
    const cards = [...element.querySelectorAll<HTMLElement>("[data-term-callout]")].map(card => ({ id: card.dataset.termCallout, box: card.getBoundingClientRect() }));
    return [...element.querySelectorAll<SVGPathElement>("[data-term-connection] path")].flatMap(path => {
      const ownId = path.parentElement?.getAttribute("data-term-connection");
      const length = path.getTotalLength();
      for (let position = 0; position <= length; position += 2) {
        const point = path.getPointAtLength(position);
        if (cards.some(({ id, box }) => id !== ownId && point.x + canvas.left > box.left + 2 && point.x + canvas.left < box.right - 2 && point.y + canvas.top > box.top + 2 && point.y + canvas.top < box.bottom - 2)) return [ownId];
      }
      return [];
    });
  })).toEqual([]);
  const cardRow = diagram.locator(".term-diagram-callouts");
  await expect(cardRow).toBeVisible();
  const cardLayout = await diagram.evaluate(element => {
    const underlines = element.querySelector(".term-diagram-atom-links")!.getBoundingClientRect();
    const cards = [...element.querySelectorAll("[data-term-callout]")].map(card => card.getBoundingClientRect());
    return { belowTerm: cards.every(card => card.top > underlines.bottom), tops: cards.map(card => Math.round(card.top)) };
  });
  expect(cardLayout.belowTerm).toBe(true);
  expect(new Set(cardLayout.tops).size).toBe(1);
  await expect.poll(() => cardRow.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await diagram.locator('[data-term-atom-link="atom-system"]').click();
  await expect(diagram.locator('[data-term-callout="atom-system"]')).toBeFocused();
  await expect.poll(() => cardRow.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect(diagram.locator('[data-term-connection="atom-system"]')).toBeAttached();
  await expect.poll(() => cardRow.evaluate(element => {
    const row = element.getBoundingClientRect();
    const card = element.querySelector('[data-term-callout="atom-system"]')!.getBoundingClientRect();
    return card.left >= row.left && card.right <= row.right;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath(`term-cards-below-${width}px.png`) });
});

test("keeps the term on one line and uses the full detail width", async ({ page }) => {
  const state = createResearchNotebook();
  state.terms = [{ id: "term-single-line", name: "状态失配均方误差", aliases: [], meaning: "整体定义", atoms: [
    { id: "atom-state-mismatch", text: "状态失配", meaning: "状态失配的解释" },
    { id: "atom-mean-square", text: "均方误差", meaning: "均方误差的解释" },
  ], status: "active" }];
  state.activeTermId = "term-single-line"; state.view = "dictionary"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const panel = page.getByTestId("research-notebook");
  const detail = panel.getByRole("region", { name: "术语词条详情", exact: true });
  const titlePieces = detail.locator("[data-term-atom-piece]");
  await expect(titlePieces).toHaveCount(2);
  const tops = await titlePieces.evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const detailBox = await detail.locator(".research-term-detail").evaluate(element => element.getBoundingClientRect());
  const viewportBox = await panel.locator(".research-symbol-detail").evaluate(element => element.getBoundingClientRect());
  expect(detailBox.width / viewportBox.width).toBeGreaterThan(0.9);
});
