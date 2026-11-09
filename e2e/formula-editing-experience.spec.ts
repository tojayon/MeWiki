import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createResearchNote, type ResearchNotebookBlock } from "../src/domain/researchNotebook.ts";
import { type FormulaPart } from "../src/domain/researchDictionary.ts";
import { enableNotebookEditing } from "./helpers/researchNotebook.ts";
import { confirmDeletion } from "./helpers/deleteConfirmation.ts";
import { FORMULA_OPERATOR_USAGE_STORAGE_KEY } from "../src/state/formulaOperatorUsage.ts";

const symbol = (entryId: string, x2 = "", x3 = ""): FormulaPart => ({ type: "symbol", entryId, bindings: { x1: "(p)", x2, x3 } });
const op = (operator: Extract<FormulaPart, { type: "operator" }>["operator"]): FormulaPart => ({ type: "operator", operator });
const source = { noteId: "formula-input-note", formulaId: "definition", outputId: "state-output" };

async function openInputNote(page: Page, tags: Record<string, string[]> = {}) {
  const state = createResearchNotebook();
  state.symbols = state.symbols.map(entry => tags[entry.id] ? { ...entry, tags: tags[entry.id] } : entry);
  const first = symbol("example-vector", "j", "(t)");
  const blocks: ResearchNotebookBlock[] = [
    { id: "main", type: "formula", tex: "", caption: "可编辑公式", parts: [{ ...first, source } as FormulaPart, op("plus"), symbol("example-input", "k", "(s)")] },
    { id: "target", type: "formula", tex: "", caption: "粘贴目标", parts: [symbol("example-index")] },
    { id: "fraction", type: "formula", tex: "", caption: "完整结构", parts: [symbol("example-index"), op("equals"), op("fractionStart"), symbol("example-count"), op("plus"), op("one"), op("fractionDivide"), symbol("example-step"), op("groupClose"), op("plus"), op("two")] },
    { id: "definition", type: "formula", tex: "", caption: "状态定义", parts: [symbol("example-vector", "j", "(t)")], outputs: [{ id: "state-output", entryId: "example-vector", bindings: { x1: "(p)", x2: "j", x3: "(t)" } }] },
  ];
  const note = { ...createResearchNote("公式输入检查"), id: "formula-input-note", blocks, library: "research" as const };
  const other = { ...createResearchNote("跨笔记粘贴目标"), id: "formula-other-note", library: "research" as const, blocks: [{ id: "other-target", type: "formula", tex: "", parts: [symbol("example-count")] }] as ResearchNotebookBlock[] };
  const snapshot = { ...state, open: true, view: "notes" as const, activeNoteId: note.id, notes: [note, other] };
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.addInitScript((initial) => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(initial));
    localStorage.setItem("mewiki:research-notebook-mode", "edit");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "true");
  }, snapshot);
  await page.goto("/?page=research-notebook");
  const panel = page.getByTestId("research-notebook");
  await enableNotebookEditing(panel);
  return panel;
}

const formula = (panel: Locator, id = "main") => panel.locator(`[data-formula-id="${id}"]`);
const surface = (block: Locator) => block.getByRole("textbox", { name: "公式光标编辑器", exact: true });
async function edit(block: Locator) { await block.hover(); await block.getByRole("button", { name: "编辑公式", exact: true }).click(); }
async function savedParts(page: Page, id = "main", noteId = "formula-input-note"): Promise<FormulaPart[]> {
  return page.evaluate(({ id, noteId }) => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.find((note: { id: string }) => note.id === noteId).blocks.find((block: { id: string }) => block.id === id).parts, { id, noteId });
}
async function selectFirst(block: Locator, count = 1) {
  await surface(block).press("Home");
  for (let index = 0; index < count; index++) await surface(block).press("Shift+ArrowRight");
}

async function startWindowDrag(page: Page, editor: Locator, dx: number, dy: number) {
  const preview = (await editor.getByLabel("符号预览", { exact: true }).boundingBox())!;
  const start = { x: preview.x + 10, y: preview.y + preview.height - 10 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
}

test("formula editor window drags from preview whitespace and retains its position while editing and inserting", async ({ page }, testInfo) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  const slot = editor.getByLabel("右下角标 x2", { exact: true }); await slot.fill("j+7");
  const popup = editor.getByRole("dialog", { name: "编辑右下角标", exact: true });
  const before = (await editor.boundingBox())!, popupBefore = (await popup.boundingBox())!;
  await startWindowDrag(page, editor, 160, 80); await page.mouse.up();
  const moved = (await editor.boundingBox())!, popupAfter = (await popup.boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(160, 0); expect(moved.y - before.y).toBeCloseTo(80, 0);
  expect(popupAfter.x - popupBefore.x).toBeCloseTo(160, 0); expect(popupAfter.y - popupBefore.y).toBeCloseTo(80, 0);
  await expect(slot).toHaveValue("j+7"); expect(await savedParts(page)).toEqual(original);
  await slot.press("Enter");
  await editor.getByRole("searchbox", { name: "搜索公式符号", exact: true }).fill("状态");
  await editor.getByRole("button", { name: "收起运算符面板", exact: true }).click();
  const compact = (await editor.boundingBox())!;
  expect(compact.x).toBeCloseTo(moved.x, 0); expect(compact.y).toBeCloseTo(moved.y, 0);
  await editor.getByRole("button", { name: "保存公式项", exact: true }).click();
  await editor.getByRole("button", { name: "插入符号", exact: true }).click();
  const changed = { ...original[0], bindings: { x1: "(p)", x2: "j+7", x3: "(t)" } };
  await expect.poll(() => savedParts(page)).toEqual([changed, changed, ...original.slice(1)]);
  const continued = (await editor.boundingBox())!;
  expect(continued.x).toBeCloseTo(moved.x, 0); expect(continued.y).toBeCloseTo(moved.y, 0);
  await editor.screenshot({ path: testInfo.outputPath("formula-window-dragged.png") });
  await editor.press("Escape"); await surface(block).press("Enter");
  const reopened = (await editor.boundingBox())!;
  expect(Math.abs(reopened.x - moved.x) + Math.abs(reopened.y - moved.y)).toBeGreaterThan(40);
});

test("formula editor window keeps text selection, controls and dictionary scrolling separate from dragging", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor"), before = (await editor.boundingBox())!;
  const search = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  await search.fill("状态");
  for (const target of [search, editor.getByLabel("符号预览", { exact: true }).locator(".katex-html > :is(.katex-base, .base)").first(),
    editor.getByRole("button", { name: "符号说明", exact: true })]) {
    const rect = (await target.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 90, rect.y + rect.height / 2 + 40, { steps: 5 }); await page.mouse.up();
    const after = (await editor.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0); expect(after.y).toBeCloseTo(before.y, 0);
  }
  await search.fill("");
  const tree = editor.getByRole("navigation", { name: "候选符号词条", exact: true });
  await tree.hover(); await page.mouse.wheel(0, 180);
  await expect.poll(() => editor.locator(".research-dictionary-list").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  const slot = editor.getByLabel("右下角标 x2", { exact: true }); await slot.fill("k"); await slot.press("Enter");
  await expect(editor.getByLabel("符号预览").locator("annotation")).toContainText("_{k}");
});

for (const cancel of ["Escape", "pointercancel", "blur"]) test(`formula editor window cancels dragging on ${cancel} without losing drafts`, async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor"), original = await savedParts(page);
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  const slot = editor.getByLabel("右下角标 x2", { exact: true }); await slot.fill("j+9");
  const before = (await editor.boundingBox())!;
  await startWindowDrag(page, editor, 120, 60);
  expect((await editor.boundingBox())!.x - before.x).toBeCloseTo(120, 0);
  if (cancel === "Escape") await page.keyboard.press("Escape");
  else if (cancel === "pointercancel") await editor.dispatchEvent("pointercancel", { pointerId: 1 });
  else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up(); await page.mouse.move(before.x + 220, before.y + 180);
  await expect(editor).toBeVisible(); await expect(slot).toHaveValue("j+9");
  const cancelled = (await editor.boundingBox())!;
  expect(cancelled.x).toBeCloseTo(before.x, 0); expect(cancelled.y).toBeCloseTo(before.y, 0);
  expect(await savedParts(page)).toEqual(original);
  await slot.press("Escape"); await expect(editor).toBeVisible();
  await startWindowDrag(page, editor, 60, 30); await page.mouse.up();
  const moved = (await editor.boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(60, 0); expect(moved.y - before.y).toBeCloseTo(30, 0);
  await editor.press("Escape"); await expect(editor).toBeHidden();
});

for (const width of [1440, 390]) test(`formula editor window stays within the viewport while dragging at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "收起运算符面板", exact: true }).click();
  await startWindowDrag(page, editor, -2000, -2000); await page.mouse.up();
  let rect = (await editor.boundingBox())!;
  expect(rect.x).toBeCloseTo(12, 0); expect(rect.y).toBeCloseTo(12, 0);
  await startWindowDrag(page, editor, 2000, 2000); await page.mouse.up();
  rect = (await editor.boundingBox())!;
  expect(rect.x + rect.width).toBeCloseTo(width - 12, 0); expect(rect.y + rect.height).toBeCloseTo(948, 0);
  await page.setViewportSize({ width, height: 700 });
  await expect.poll(async () => { const box = (await editor.boundingBox())!; return Math.round(box.y + box.height); }).toBeLessThanOrEqual(688);
  await editor.getByRole("button", { name: "展开运算符面板", exact: true }).click();
  await expect.poll(async () => { const box = (await editor.boundingBox())!; return Math.round(box.x + box.width); }).toBeLessThanOrEqual(width - 12);
  await expect.poll(async () => { const box = (await editor.boundingBox())!; return Math.round(box.y + box.height); }).toBeLessThanOrEqual(688);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`operator panel collapses beside the dictionary button and retains drafts at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 960 });
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor");
  const search = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  const latex = editor.getByRole("textbox", { name: "LaTeX 数学符号", exact: true });
  const keyboard = editor.getByRole("group", { name: "运算符键盘", exact: true });
  const hide = editor.getByRole("button", { name: "收起运算符面板", exact: true });
  const show = editor.getByRole("button", { name: "展开运算符面板", exact: true });
  const dictionary = editor.getByRole("button", { name: "打开词典词条", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  const full = (await editor.boundingBox())!;
  const dictionaryBox = (await dictionary.boundingBox())!;
  const toggleBox = (await hide.boundingBox())!;
  expect(toggleBox.x).toBeGreaterThanOrEqual(dictionaryBox.x + dictionaryBox.width);
  expect(Math.abs(toggleBox.y + toggleBox.height / 2 - dictionaryBox.y - dictionaryBox.height / 2)).toBeLessThan(1);
  await expect(editor.locator(".research-formula-symbol-search-row").getByRole("button", { name: "收起运算符面板", exact: true })).toHaveCount(0);
  await search.fill("输入向量");
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  const slot = editor.getByLabel("右下角标 x2", { exact: true }); await slot.fill("j+7"); await slot.press("Enter");
  await latex.fill("\\mathcal{A}");
  await hide.click();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(show).toBeFocused();
  await expect(keyboard).toBeHidden(); await expect(latex).toBeHidden();
  await expect(search).toHaveValue("输入向量");
  await expect(editor.getByLabel("符号预览").locator("annotation")).toContainText("j+7");
  expect(await savedParts(page)).toEqual(original);
  const compact = (await editor.boundingBox())!;
  if (width > 560) expect(compact.width).toBeLessThan(full.width);
  else expect(compact.height).toBeLessThan(full.height);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.screenshot({ path: testInfo.outputPath(`collapsed-operators-${width}.png`) });
  await show.press("Enter");
  await expect(keyboard).toBeVisible(); await expect(latex).toHaveValue("\\mathcal{A}");
  await hide.press("Space"); await show.press("Space");
  await expect(hide).toBeFocused(); await expect(keyboard).toBeVisible();
  await hide.click(); await editor.getByRole("button", { name: "保存公式项", exact: true }).click();
  await expect(show).toBeVisible();
  const changed = { ...original[0], bindings: { x1: "(p)", x2: "j+7", x3: "(t)" } };
  await expect.poll(() => savedParts(page)).toEqual([changed, ...original.slice(1)]);
  await editor.getByRole("button", { name: "插入符号", exact: true }).click();
  await expect.poll(() => savedParts(page)).toEqual([changed, changed, ...original.slice(1)]);
  await show.click(); await expect(latex).toHaveValue("\\mathcal{A}");
  await latex.press("Enter");
  await expect.poll(() => savedParts(page).then(parts => parts.filter(part => part.type === "latex"))).toEqual([{ type: "latex", tex: "\\mathcal{A}" }]);
});

for (const width of [1440, 390]) test(`frequent operators duplicate their categories, persist and stay stable during rapid input at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.locator(".research-formula-item-editor");
  const group = (label: string) => editor.locator(`.research-formula-operator-group[aria-label="${label}"]`);
  const frequent = group("常用");
  const recent = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).recent as string[], FORMULA_OPERATOR_USAGE_STORAGE_KEY);
  await expect(frequent).toHaveCount(0);
  await expect(group("运算").locator('[data-operator="plus"]')).toBeVisible();
  await expect(group("关系").locator('[data-operator="equals"]')).toBeVisible();
  await expect(group("常数").locator('[data-operator="zero"]')).toHaveCount(1);
  for (const id of ["minus", "minus", "plus", "plus", "plus"]) await group("运算").locator(`[data-operator="${id}"]`).click();
  await group("关系").locator('[data-operator="equals"]').click();
  // Newly promoted shortcuts must not shift a keyboard that is already open.
  await expect(frequent).toHaveCount(0);
  await editor.press("Escape"); await surface(block).press("Enter");
  await expect(frequent.locator("button")).toHaveCount(2);
  expect(await frequent.locator("button").evaluateAll(elements => elements.map(element => element.getAttribute("data-operator")))).toEqual(["plus", "minus"]);
  await expect(editor.locator('[data-operator="plus"]')).toHaveCount(2);
  await expect(editor.locator('[data-operator="minus"]')).toHaveCount(2);
  await expect(frequent.locator('[data-operator="equals"]')).toHaveCount(0);
  const before = (await savedParts(page)).length;
  await frequent.locator('[data-operator="minus"]').evaluate(button => { for (let index = 0; index < 4; index++) (button as HTMLButtonElement).click(); });
  await group("运算").locator('[data-operator="plus"]').click();
  await expect.poll(() => savedParts(page).then(parts => parts.slice(before))).toEqual([op("minus"), op("minus"), op("minus"), op("minus"), op("plus")]);
  expect(await frequent.locator("button").evaluateAll(elements => elements.map(element => element.getAttribute("data-operator")))).toEqual(["plus", "minus"]);
  expect(await recent()).toEqual(["minus", "minus", "plus", "plus", "plus", "equals", "minus", "minus", "minus", "minus", "plus"]);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.screenshot({ path: testInfo.outputPath(`frequent-operators-${width}.png`) });
  await editor.press("Escape");
  const target = formula(panel, "target"); await edit(target); await surface(target).press("End"); await surface(target).press("Enter");
  const targetFrequent = target.locator('.research-formula-operator-group[aria-label="常用"]');
  expect(await targetFrequent.locator("button").evaluateAll(elements => elements.map(element => element.getAttribute("data-operator")))).toEqual(["minus", "plus"]);
  await page.reload(); await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  await expect(frequent).toBeVisible();
  expect(await frequent.locator("button").evaluateAll(elements => elements.map(element => element.getAttribute("data-operator")))).toEqual(["minus", "plus"]);
});

for (const width of [1440, 390]) test(`expanded operators and custom LaTeX remain editable and copyable at ${width}px`, async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width, height: 844 });
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  let editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "插入运算符 平方根", exact: true }).click();
  await editor.getByRole("button", { name: "插入运算符 α alpha", exact: true }).click();
  await editor.press("Escape"); await surface(block).press("End"); await surface(block).press("Enter");
  editor = block.locator(".research-formula-item-editor");
  const input = editor.getByRole("textbox", { name: "LaTeX 数学符号", exact: true });
  const custom = "\\mathscr{F}\\!\\left[\\frac{a}{b}\\right]";
  await input.fill(custom);
  await expect(editor.getByLabel("LaTeX 预览").locator(".katex-error")).toHaveCount(0);
  await input.press("Enter");
  await editor.getByRole("button", { name: "插入 LaTeX", exact: true }).click();
  await expect.poll(() => savedParts(page).then(parts => parts.slice(-2))).toEqual([{ type: "latex", tex: custom }, { type: "latex", tex: custom }]);
  const lastIndex = (await savedParts(page)).length - 1;
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.screenshot({ path: testInfo.outputPath(`expanded-operator-palette-${width}.png`) });
  await editor.press("Escape");
  await block.locator(`[data-formula-index="${lastIndex}"]`).dblclick();
  await expect(input).toHaveValue(custom);
  const matrix = "\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}";
  await input.fill(matrix);
  await editor.getByRole("button", { name: "替换为 LaTeX", exact: true }).click();
  await editor.press("Escape");
  expect((await savedParts(page)).at(-1)).toEqual({ type: "latex", tex: matrix });
  await block.locator(`[data-formula-index="${lastIndex}"]`).click();
  await page.keyboard.press("Control+c");
  const target = formula(panel, "target"); await edit(target); await surface(target).press("End");
  await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page, "target").then(parts => parts.at(-1))).toEqual({ type: "latex", tex: matrix });
  await surface(target).press("Control+z");
  await expect.poll(() => savedParts(page, "target").then(parts => parts.length)).toBe(1);
  await surface(target).press("Control+Shift+z");
  await page.reload();
  await expect.poll(() => savedParts(page, "target").then(parts => parts.at(-1))).toEqual({ type: "latex", tex: matrix });
  await expect(formula(panel, "target").locator(".katex-error")).toHaveCount(0);
});

test("custom LaTeX rejects incomplete input and preserves IME confirmation and stale sessions", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.locator(".research-formula-item-editor");
  const input = editor.getByRole("textbox", { name: "LaTeX 数学符号", exact: true });
  const original = await savedParts(page);
  await input.fill("\\sqrt{");
  await expect(editor.getByRole("button", { name: "插入 LaTeX", exact: true })).toBeDisabled();
  await input.press("Enter");
  expect(await savedParts(page)).toEqual(original);
  await input.fill("\\hbar");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  expect(await savedParts(page)).toEqual(original);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.notes.find((note: { id: string }) => note.id === "formula-input-note").blocks[0].parts.push({ type: "operator", operator: "two" });
    const previous = localStorage.getItem("mewiki:research-notebook");
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    window.dispatchEvent(new StorageEvent("storage", { key: "mewiki:research-notebook", oldValue: previous, newValue: JSON.stringify(state), storageArea: localStorage }));
  });
  await editor.getByRole("button", { name: "插入 LaTeX", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("已变更");
  expect((await savedParts(page)).at(-1)).toEqual(op("two"));
});

test("single click and plain mouse selection copy and paste within and across formula blocks without clipboard permissions", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await block.locator('[data-formula-index="0"]').click();
  await expect(surface(block)).toHaveAttribute("data-selection-start", "0");
  await expect(surface(block)).toHaveAttribute("data-selection-end", "1");
  await page.keyboard.press("Control+c");
  await surface(block).press("End"); await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page)).toEqual([...original, original[0]]);
  await surface(block).press("Control+z");
  const start = (await block.locator('[data-formula-index="0"]').boundingBox())!;
  const end = (await block.locator('[data-formula-index="2"]').boundingBox())!;
  await page.mouse.move(start.x + 1, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(surface(block)).toHaveAttribute("data-selection-start", "0");
  await expect(surface(block)).toHaveAttribute("data-selection-end", "3");
  await page.keyboard.press("Control+c");
  const target = formula(panel, "target"); await edit(target); await surface(target).press("End");
  await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page, "target").then(parts => parts.slice(1))).toEqual(original);
});

test("dragging unselected symbol bodies selects in either direction without moving the formula", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  for (const reverse of [false, true]) {
    await surface(block).press("End");
    const first = (await block.locator('[data-formula-index="0"]').boundingBox())!;
    const last = (await block.locator('[data-formula-index="2"]').boundingBox())!;
    const start = reverse ? last : first, end = reverse ? first : last;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(reverse ? end.x + 1 : end.x + end.width - 1, end.y + end.height / 2, { steps: 8 });
    await expect(block.locator(".research-formula-selected")).not.toHaveCount(0);
    await page.mouse.up();
    await expect(surface(block)).toHaveAttribute("data-selection-start", "0");
    await expect(surface(block)).toHaveAttribute("data-selection-end", "3");
    expect(await savedParts(page)).toEqual(original);
  }
});

for (const width of [1440, 390]) test(`pastes external TeX and matches dictionary symbols at ${width}px`, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width, height: 960 });
  const panel = await openInputNote(page), block = formula(panel, "target"); await edit(block);
  const original = await savedParts(page, "target");
  const tex = "\\[\\boldsymbol{u}(t)=-\\boldsymbol{K}\\boldsymbol{x}(t)+\\frac{1}{2}\\]";
  await page.evaluate(value => navigator.clipboard.writeText(value), tex);
  await surface(block).press("Control+a"); await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page, "target").then(parts => parts.length)).toBe(11);
  expect((await savedParts(page, "target"))[0]).toEqual({ type: "symbol", entryId: "example-input", bindings: { x1: "", x2: "", x3: "(t)" } });
  await expect(block.locator("annotation")).toHaveText("\\boldsymbol{u}(t)=-\\boldsymbol{K}\\boldsymbol{x}(t)+\\frac{1}{2}");
  await expect(block.locator(".katex-error")).toHaveCount(0);
  await surface(block).press("Control+z"); await expect.poll(() => savedParts(page, "target")).toEqual(original);
});

test("pastes gathered TeX with its layout and falls back to text when a browser supplies an empty custom payload", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel, "target"); await edit(block);
  await page.evaluate(() => navigator.clipboard.writeText("$$\\begin{gathered}p=1\\\\P=2\\end{gathered}$$"));
  await surface(block).press("Control+a"); await page.keyboard.press("Control+v");
  await expect(block.locator("annotation")).toHaveText("\\begin{gathered}p=1\\\\P=2\\end{gathered}");
  await surface(block).press("Control+a");
  await surface(block).evaluate(element => {
    const data = new DataTransfer(); data.setData("application/x-webbench-formula+json", " "); data.setData("text/plain", "\\boldsymbol{K}");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect.poll(() => savedParts(page, "target")).toEqual([{ type: "symbol", entryId: "example-matrix", bindings: { x1: "", x2: "", x3: "" } }]);
  await expect(block.getByRole("alert")).toHaveCount(0);
});

test("copies and cuts a caret-adjacent symbol without an existing selection", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await surface(block).press("End"); await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("\\boldsymbol{u}^{(p)}_{k}(s)");
  await page.keyboard.press("Control+x");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await savedParts(page)).toEqual(original);
  await confirmDeletion(page);
  await expect.poll(() => savedParts(page)).toEqual(original.slice(0, -1));
  await surface(block).press("Control+z"); await expect.poll(() => savedParts(page)).toEqual(original);
});

for (const failure of ["rejects", "discards"]) test(`keeps the original formula when the browser ${failure} a complete clipboard fragment during cut`, async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await selectFirst(block);
  await page.evaluate(failure => {
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function(format, data) {
      if (format === "application/x-webbench-formula+json") {
        if (failure === "rejects") throw new Error("custom clipboard write rejected");
        return;
      }
      return setData.call(this, format, data);
    };
  }, failure);
  await page.keyboard.press("Control+x");
  await expect(block.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await savedParts(page)).toEqual(original);
});

test("continuous palette inserts alternating symbols and operator keys without closing or losing the draft", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.locator(".research-formula-item-editor");
  await expect(editor.getByRole("tablist")).toHaveCount(0);
  await expect(editor.getByRole("group", { name: "运算符键盘", exact: true })).toBeVisible();
  const search = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  await search.fill("输入向量"); await editor.getByRole("navigation", { name: "候选符号词条", exact: true }).getByRole("option", { name: "输入向量", exact: true }).click();
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  const slot = editor.getByLabel("右下角标 x2", { exact: true }); await slot.fill("j+1"); await slot.press("Enter");
  await expect(editor.getByLabel("推导来源", { exact: true })).toBeHidden();
  const insert = editor.getByRole("button", { name: "插入符号", exact: true });
  await insert.click();
  await editor.getByRole("button", { name: "插入运算符 + 加", exact: true }).click();
  await insert.click(); await insert.click();
  await expect(editor).toBeVisible(); await expect(search).toHaveValue("输入向量");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(8);
  const instance = { type: "symbol", entryId: "example-input", bindings: { x1: "", x2: "j+1", x3: "(t)" } };
  expect((await savedParts(page)).slice(3)).toEqual([{ ...instance, bindings: { x1: "", x2: "", x3: "(t)" } }, instance, op("plus"), instance, instance]);
  await editor.press("Escape");
  await surface(block).press("Control+z");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(7);
  await surface(block).press("Control+z");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(6);
  await surface(block).press("Control+Shift+z");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(7);
});

test("continuous operator keys preserve paired structures and handle rapid repeated clicks", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "插入运算符 ( 左括号", exact: true }).click();
  await editor.getByRole("button", { name: "插入运算符 分数开始", exact: true }).click();
  const one = editor.getByRole("button", { name: "插入运算符 1 常数", exact: true });
  await one.evaluate(button => { for (let i = 0; i < 4; i++) (button as HTMLButtonElement).click(); });
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(12);
  expect((await savedParts(page)).slice(3)).toEqual([op("leftParen"), op("fractionStart"), op("one"), op("one"), op("one"), op("one"), op("fractionDivide"), op("groupClose"), op("rightParen")]);
  await expect(block.locator(".research-formula-math-canvas .katex-error")).toHaveCount(0);
  await expect(editor).toBeVisible();
});

test("editing saves once then continues inserting, preserves source and replaces a selected range only once", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); const original = await savedParts(page);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  await editor.getByLabel("右下角标 x2", { exact: true }).fill("j+2");
  await editor.getByRole("button", { name: "保存公式项", exact: true }).click();
  await expect(editor).toHaveAttribute("aria-label", "添加公式项");
  await editor.getByRole("button", { name: "插入符号", exact: true }).click();
  const edited = { ...original[0], bindings: { x1: "(p)", x2: "j+2", x3: "(t)" } };
  await expect.poll(() => savedParts(page)).toEqual([edited, edited, ...original.slice(1)]);
  await editor.press("Escape");
  await selectFirst(block, 2); await surface(block).press("Enter");
  await editor.getByRole("button", { name: "插入运算符 1 常数", exact: true }).click();
  await editor.getByRole("button", { name: "插入运算符 2 常数", exact: true }).click();
  await expect.poll(() => savedParts(page)).toEqual([op("one"), op("two"), ...original.slice(1)]);
});

test("continuous palette refuses to overwrite formula changes from another window", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "插入运算符 1 常数", exact: true }).click();
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(4);
  const other = await page.context().newPage();
  await other.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await other.goto("/?page=research-notebook");
  const otherBlock = other.locator('[data-formula-id="main"]');
  await edit(otherBlock); await surface(otherBlock).press("End"); await surface(otherBlock).press("Enter");
  await otherBlock.locator(".research-formula-item-editor").getByRole("button", { name: "插入运算符 0 零", exact: true }).click();
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(5);
  await expect(block.locator('.research-formula-math-canvas [data-formula-index="4"]')).toBeVisible();
  const changed = await savedParts(page);
  const usageBeforeRejectedInput = await page.evaluate(key => localStorage.getItem(key), FORMULA_OPERATOR_USAGE_STORAGE_KEY);
  await editor.getByRole("button", { name: "插入运算符 + 加", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("已变更");
  expect(await savedParts(page)).toEqual(changed);
  expect(await page.evaluate(key => localStorage.getItem(key), FORMULA_OPERATOR_USAGE_STORAGE_KEY)).toBe(usageBeforeRejectedInput);
  await other.close();
});

test("editing an operator requires an explicit symbol choice before replacing it with a symbol", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await block.locator('[data-formula-index="1"]').dblclick();
  const editor = block.locator(".research-formula-item-editor");
  await expect(editor.getByRole("button", { name: "替换为符号", exact: true })).toBeDisabled();
  expect(await savedParts(page)).toEqual(original);
  await editor.getByRole("button", { name: "插入运算符 − 减", exact: true }).click();
  await expect.poll(() => savedParts(page)).toEqual([original[0], op("minus"), original[2]]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).recent, FORMULA_OPERATOR_USAGE_STORAGE_KEY)).toEqual(["minus"]);
  await expect(editor).toHaveAttribute("aria-label", "添加公式项");
  await editor.press("Escape");
  await block.locator('[data-formula-index="1"]').dblclick();
  await editor.getByRole("searchbox", { name: "搜索公式符号", exact: true }).fill("输入向量");
  await editor.getByRole("navigation", { name: "候选符号词条", exact: true }).getByRole("option", { name: "输入向量", exact: true }).click();
  await editor.getByRole("button", { name: "替换为符号", exact: true }).click();
  await expect.poll(() => savedParts(page).then(parts => parts[1])).toMatchObject({ type: "symbol", entryId: "example-input" });
});

test("replacing an atomic operator with a fraction inserts its matching markers and continues inside it", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await block.locator('[data-formula-index="1"]').dblclick();
  const editor = block.locator(".research-formula-item-editor");
  await editor.getByRole("button", { name: "插入运算符 分数开始", exact: true }).click();
  await editor.getByRole("button", { name: "插入运算符 1 常数", exact: true }).click();
  await expect.poll(() => savedParts(page)).toEqual([original[0], op("fractionStart"), op("one"), op("fractionDivide"), op("groupClose"), original[2]]);
  await expect(block.locator(".research-formula-math-canvas .katex-error")).toHaveCount(0);
  await editor.press("Escape");
  await surface(block).press("Control+z"); await surface(block).press("Control+z");
  await expect.poll(() => savedParts(page)).toEqual(original);
});

for (const width of [1440, 390]) test(`large symbol preview has separate borderless position targets at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 960 });
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.locator(".research-formula-item-editor"), preview = editor.getByLabel("符号预览", { exact: true });
  await expect(preview).toHaveCSS("font-size", "36px");
  await expect(editor.getByRole("tablist")).toHaveCount(0);
  await expect(editor.getByLabel("推导来源", { exact: true })).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
  const boxes = [];
  for (const position of ["右上角标", "右下角标", "右侧变量"]) {
    const button = editor.getByRole("button", { name: `编辑${position}`, exact: true });
    await expect(button).toHaveCSS("border-top-style", "none");
    boxes.push((await button.boundingBox())!);
    await button.click();
    await expect(editor.getByRole("dialog", { name: `编辑${position}`, exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "取消位置编辑", exact: true }).click();
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))).toBe(0);
  }
  const canvas = (await preview.boundingBox())!;
  expect(boxes[0].x + boxes[0].width / 2).toBeLessThan(canvas.x + canvas.width / 2);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(editor.locator(".katex-error")).toHaveCount(0);
  await editor.screenshot({ path: testInfo.outputPath(`formula-palette-${width}.png`) });
});

test("native clipboard copies one symbol with indices and source, repeats paste and supports undo/redo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block);
  const original = await savedParts(page);
  await selectFirst(block);
  await expect(surface(block)).toHaveAttribute("data-selection-start", "0");
  await expect(surface(block)).toHaveAttribute("data-selection-end", "1");
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("\\boldsymbol{x}^{(p)}_{j}(t)");
  await surface(block).press("End");
  await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(4);
  expect((await savedParts(page))[3]).toEqual(original[0]);
  await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(5);
  await surface(block).press("Control+z");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(4);
  await surface(block).press("Control+Shift+z");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(5);
  expect((await savedParts(page)).slice(3)).toEqual([original[0], original[0]]);
  await page.reload();
  expect((await savedParts(page)).slice(3)).toEqual([original[0], original[0]]);
});

test("multiple symbols paste across formula blocks and notebooks while preserving references", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel);
  const original = await savedParts(page);
  await edit(block); await surface(block).press("Control+a"); await page.keyboard.press("Control+c");
  await block.getByRole("button", { name: "完成公式编辑", exact: true }).click();
  const target = formula(panel, "target"); await edit(target); await surface(target).press("End"); await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page, "target").then(parts => parts.length)).toBe(4);
  expect((await savedParts(page, "target")).slice(1)).toEqual(original);
  await target.getByRole("button", { name: "完成公式编辑", exact: true }).click();
  await panel.getByRole("button", { name: "展开笔记左侧面板", exact: true }).click();
  await panel.getByRole("button", { name: "跨笔记粘贴目标", exact: true }).click();
  const other = formula(panel, "other-target"); await edit(other); await surface(other).press("Control+a"); await page.keyboard.press("Control+v");
  await expect.poll(() => savedParts(page, "other-target", "formula-other-note").then(parts => parts.length)).toBe(3);
  expect(await savedParts(page, "other-target", "formula-other-note")).toEqual(original);
});

test("cut waits for confirmation, cancel preserves the selection, confirm can be undone", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); const original = await savedParts(page);
  await selectFirst(block, 2); await page.keyboard.press("Control+x");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await savedParts(page)).toEqual(original);
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  expect(await savedParts(page)).toEqual(original);
  await surface(block).focus(); await page.keyboard.press("Control+x"); await confirmDeletion(page);
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(1);
  await surface(block).press("Control+z");
  await expect.poll(() => savedParts(page)).toEqual(original);
});

test("native paste refuses self references, invalid custom data and ambiguous text without replacing content", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); await selectFirst(block); await page.keyboard.press("Control+c");
  const definition = formula(panel, "definition"); await edit(definition); const original = await savedParts(page, "definition");
  await surface(definition).press("Control+a"); await page.keyboard.press("Control+v");
  await expect(definition.getByRole("alert")).toContainText("循环");
  expect(await savedParts(page, "definition")).toEqual(original);
  await surface(definition).evaluate(element => {
    const data = new DataTransfer(); data.setData("application/x-webbench-formula+json", "{broken"); data.setData("text/plain", "+");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(definition.getByRole("alert")).toContainText("损坏");
  expect(await savedParts(page, "definition")).toEqual(original);
  await page.evaluate(() => navigator.clipboard.writeText("unrecognized_{bad}")); await surface(definition).focus(); await page.keyboard.press("Control+v");
  await expect(definition.getByRole("alert")).toContainText("没有对应");
  expect(await savedParts(page, "definition")).toEqual(original);
});

test("selection expands across fraction markers and preserves complete structures when pasted", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel, "fraction");
  await edit(block);
  const numerator = (await block.locator(".research-formula-part-3").boundingBox())!;
  const denominator = (await block.locator(".research-formula-part-7").boundingBox())!;
  await page.mouse.click(numerator.x + 1, numerator.y + numerator.height / 2);
  await page.keyboard.down("Shift"); await page.mouse.click(denominator.x + denominator.width - 1, denominator.y + denominator.height / 2); await page.keyboard.up("Shift");
  await expect(surface(block)).toHaveAttribute("data-selection-start", "2"); await expect(surface(block)).toHaveAttribute("data-selection-end", "9");
  await page.keyboard.press("Control+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText()); expect(copied).toContain("\\frac{P^{(p)}+1}{h^{(p)}}");
  await surface(block).press("End"); await page.keyboard.press("Control+v");
  await expect(block.locator(".katex-error")).toHaveCount(0);
  expect((await savedParts(page, "fraction")).slice(11)).toEqual((await savedParts(page, "fraction")).slice(2, 9));
});

test("moves a numerator selection into the denominator and copies the resulting selection", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const panel = await openInputNote(page), block = formula(panel, "fraction"); await edit(block);
  const p = (await block.locator(".research-formula-part-3").boundingBox())!;
  const one = (await block.locator(".research-formula-part-5").boundingBox())!;
  await page.mouse.click(p.x + 1, p.y + p.height / 2);
  await page.keyboard.down("Shift"); await page.mouse.click(one.x + one.width - 1, one.y + one.height / 2); await page.keyboard.up("Shift");
  await expect(surface(block)).toHaveAttribute("data-selection-start", "3"); await expect(surface(block)).toHaveAttribute("data-selection-end", "6");
  const h = (await block.locator(".research-formula-part-7").boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2); await page.mouse.down();
  await page.mouse.move(p.x + p.width / 2 + 8, p.y + p.height / 2, { steps: 2 });
  await page.mouse.move(h.x + h.width - 1, h.y + h.height / 2, { steps: 8 });
  await expect(block.locator(".research-formula-drop-caret")).toHaveAttribute("data-position", "8");
  await page.mouse.up();
  await expect(block.locator("annotation")).toHaveText("p^{(p)}=\\frac{}{h^{(p)}P^{(p)}+1}+2");
  await expect(surface(block)).toHaveAttribute("data-selection-start", "5"); await expect(surface(block)).toHaveAttribute("data-selection-end", "8");
  await page.keyboard.press("Control+c"); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("P^{(p)}+1");
  await expect(block.getByRole("alert")).toHaveCount(0);
});

async function startMove(page: Page, block: Locator, index: number, destination: "start" | "end") {
  const selection = await surface(block).evaluate(element => ({ start: Number(element.getAttribute("data-selection-start") ?? -1), end: Number(element.getAttribute("data-selection-end") ?? -1) }));
  if (index < selection.start || index >= selection.end) await block.locator(`[data-formula-index="${index}"]`).click();
  const origin = (await block.locator(`[data-formula-index="${index}"]`).boundingBox())!;
  const canvas = (await block.locator(".research-formula-math-canvas").boundingBox())!;
  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2); await page.mouse.down();
  await page.mouse.move(origin.x + origin.width / 2 + 8, origin.y + origin.height / 2, { steps: 2 });
  await page.mouse.move(destination === "end" ? canvas.x + canvas.width - 2 : canvas.x + 2, canvas.y + canvas.height / 2, { steps: 8 });
  await expect(block.locator(".research-formula-drop-caret")).toBeVisible();
}

test("drags one symbol or a selected range, shows its insertion position and supports undo", async ({ page }, testInfo) => {
  const panel = await openInputNote(page), block = formula(panel);
  await edit(block); const original = await savedParts(page);
  await startMove(page, block, 0, "end"); await page.mouse.up();
  await expect.poll(() => savedParts(page)).toEqual([original[1], original[2], original[0]]);
  await expect(block.locator(".research-formula-drop-caret")).toHaveCount(0);
  await surface(block).press("Control+z"); await expect.poll(() => savedParts(page)).toEqual(original);
  await selectFirst(block, 2); await startMove(page, block, 0, "end"); await page.mouse.up();
  await expect.poll(() => savedParts(page)).toEqual([original[2], original[0], original[1]]);
  await panel.screenshot({ path: testInfo.outputPath("formula-selected-after-move.png") });
});

test("drag cancellation by Escape, outside release, pointer cancellation or blur never changes the formula", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block); const original = await savedParts(page);
  for (const cancel of ["escape", "outside", "pointer", "blur"]) {
    await startMove(page, block, 0, "end");
    if (cancel === "escape") await page.keyboard.press("Escape");
    if (cancel === "outside") await page.mouse.move(2, 2);
    if (cancel === "pointer") await surface(block).dispatchEvent("pointercancel");
    if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await expect(block.locator(".research-formula-drop-caret")).toHaveCount(0);
    expect(await savedParts(page)).toEqual(original);
    await expect(panel).toBeVisible();
  }
  const origin = (await block.locator('[data-formula-index="0"]').boundingBox())!;
  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2); await page.mouse.down();
  // Leave in one move before the formula can capture an active drag.
  await page.mouse.move(2, 2); await page.mouse.up();
  await page.mouse.move(origin.x + origin.width, origin.y + origin.height / 2);
  await expect(block.locator(".research-formula-drop-caret")).toHaveCount(0);
  await expect(surface(block)).not.toHaveClass(/is-dragging-formula/);
  expect(await savedParts(page)).toEqual(original);
});

test("dictionary search inserts an exact name and position drafts stay local until inserted", async ({ page }, testInfo) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block); const original = await savedParts(page);
  await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.getByRole("dialog", { name: "添加公式项", exact: true });
  const combo = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  const picker = editor.getByRole("navigation", { name: "候选符号词条", exact: true });
  await combo.fill("不存在的符号"); await expect(picker.getByText("没有匹配的符号词条", { exact: true })).toBeVisible();
  expect(await savedParts(page)).toEqual(original);
  await combo.fill("输入向量"); await expect(picker.getByRole("option", { name: "输入向量", exact: true })).toBeVisible();
  await combo.press("Enter");
  await expect(editor).toBeVisible(); await expect(picker).toBeVisible();
  const clicked = { type: "symbol", entryId: "example-input", bindings: { x1: "", x2: "", x3: "(t)" } };
  await expect.poll(() => savedParts(page)).toEqual([...original, clicked]);
  await expect(editor.locator(".research-formula-symbol-preview-heading")).toContainText("输入向量");
  await editor.getByRole("button", { name: "编辑右上角标", exact: true }).click();
  await editor.getByLabel("右上角标 x1", { exact: true }).fill("(q)");
  await expect(editor.getByLabel("符号预览").locator("annotation")).toContainText("(q)");
  await editor.getByLabel("右上角标 x1", { exact: true }).press("Escape");
  await expect(editor).toBeVisible(); await expect(editor.getByLabel("右上角标 x1", { exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "编辑右下角标", exact: true }).click();
  await editor.getByLabel("右下角标 x2", { exact: true }).fill("j+1"); await editor.getByLabel("右下角标 x2", { exact: true }).press("Enter");
  await expect(editor).toBeVisible(); expect(await savedParts(page)).toEqual([...original, clicked]);
  await editor.getByRole("button", { name: "编辑右侧变量", exact: true }).click();
  await editor.getByLabel("右侧变量 x3", { exact: true }).fill("[t]");
  await panel.screenshot({ path: testInfo.outputPath("formula-symbol-visual-editor-desktop.png") });
  await editor.getByRole("button", { name: "插入符号", exact: true }).click();
  await expect(editor).toBeVisible();
  expect((await savedParts(page)).at(-1)).toMatchObject({ type: "symbol", entryId: "example-input", bindings: { x1: "", x2: "j+1", x3: "[t]" } });
});

test("symbol tree is visible directly and inserts clicked symbols without a dropdown", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.getByRole("dialog", { name: "添加公式项", exact: true });
  const tree = editor.getByRole("navigation", { name: "候选符号词条", exact: true });
  await expect(tree).toBeVisible();
  await expect(editor.getByRole("combobox")).toHaveCount(0);
  await expect(editor.getByRole("searchbox", { name: "搜索公式符号", exact: true })).toHaveCount(1);
  await expect(tree.getByRole("button", { name: "收起标签 示例", exact: true })).toBeVisible();
  const input = tree.getByRole("option", { name: "输入向量", exact: true });
  await input.click(); await input.click();
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(5);
  const clicked = { type: "symbol", entryId: "example-input", bindings: { x1: "", x2: "", x3: "(t)" } };
  expect((await savedParts(page)).slice(-2)).toEqual([clicked, clicked]);
  await expect(editor.locator(".research-formula-symbol-preview-heading")).toContainText("输入向量");
  await expect(tree).toBeVisible();
});

test("dictionary search reveals folded results and keyboard input skips collapsed symbols", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.getByRole("dialog", { name: "添加公式项", exact: true });
  const search = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  const tree = editor.getByRole("navigation", { name: "候选符号词条", exact: true });
  const original = await savedParts(page);
  await tree.getByRole("button", { name: "收起标签 示例", exact: true }).click();
  await expect(tree.getByRole("option", { name: "输入向量", exact: true })).toBeHidden();
  await search.fill("输入向量");
  await expect(tree.getByRole("option", { name: "输入向量", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "清除符号搜索", exact: true }).click();
  await expect(tree.getByRole("button", { name: "展开标签 示例", exact: true })).toBeVisible();
  await expect(tree.getByRole("option", { name: "输入向量", exact: true })).toBeHidden();
  await search.press("ArrowDown");
  const chosenId = await page.locator("button[data-symbol-id]:focus").getAttribute("data-symbol-id");
  await page.keyboard.press("Enter");
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(original.length + 1);
  expect((await savedParts(page)).at(-1)).toMatchObject({ type: "symbol", entryId: chosenId });
});

for (const width of [1440, 390]) test(`dictionary tree contains deep and multiple tags at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  const panel = await openInputNote(page, {
    "example-vector": ["特别长的分类名称/通信网络与控制/控制器设计/离散系统/稳态求解/验证记录/实验分组/模型实例/状态"],
    "example-input": ["专题/控制/LQR", "收藏/常查"], "example-index": [],
  });
  const block = formula(panel); await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.getByRole("dialog", { name: "添加公式项", exact: true });
  const tree = editor.getByRole("navigation", { name: "候选符号词条", exact: true });
  const buttons = tree.getByRole("option", { name: "输入向量", exact: true });
  await expect(buttons).toHaveCount(2);
  const ids = await buttons.evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(ids).size).toBe(2);
  await tree.locator('[data-tag-path="收藏/常查"]').getByRole("option", { name: "输入向量", exact: true }).click();
  await expect.poll(() => savedParts(page).then(parts => parts.length)).toBe(4);
  expect((await savedParts(page)).at(-1)).toMatchObject({ type: "symbol", entryId: "example-input" });
  const state = tree.getByRole("option", { name: "状态向量", exact: true });
  await state.scrollIntoViewIfNeeded();
  await expect(state).toBeInViewport({ ratio: .99 });
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const search = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  await search.fill("专题");
  await expect(tree.getByRole("option", { name: "输入向量", exact: true })).toHaveCount(2);
  await expect(tree.locator('[data-tag-path="特别长的分类名称"]')).toHaveCount(0);
  await editor.screenshot({ path: testInfo.outputPath(`formula-dictionary-tree-${width}.png`) });
});

test("choosing the same entry preserves local positions and source; choosing a different entry starts from its defaults", async ({ page }) => {
  const panel = await openInputNote(page), block = formula(panel); await edit(block);
  const original = await savedParts(page);
  await block.locator('[data-formula-index="0"]').dblclick();
  const editor = block.getByRole("dialog", { name: "编辑公式项", exact: true });
  const combo = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  await combo.fill("状态向量"); await editor.getByRole("navigation", { name: "候选符号词条", exact: true }).getByRole("option", { name: "状态向量", exact: true }).click();
  await expect(editor.getByLabel("符号预览").locator("annotation")).toHaveText("\\boldsymbol{x}^{(p)}_{j}(t)");
  await editor.getByRole("button", { name: "高级设置", exact: true }).click();
  await expect(editor.getByRole('button', { name: '推导来源', exact: true })).toContainText('状态定义');
  await editor.getByRole("button", { name: "保存公式项", exact: true }).click();
  expect(await savedParts(page)).toEqual(original);
  await block.locator('[data-formula-index="0"]').dblclick();
  await combo.fill("输入向量"); await editor.getByRole("navigation", { name: "候选符号词条", exact: true }).getByRole("option", { name: "输入向量", exact: true }).click();
  await expect(editor.getByLabel("符号预览").locator("annotation")).toHaveText("\\boldsymbol{u}(t)");
  await editor.getByRole('button', { name: '高级设置', exact: true }).click();
  await expect(editor.getByRole('button', { name: '推导来源', exact: true })).toContainText('仅使用词典定义');
  await editor.getByRole("button", { name: "保存公式项", exact: true }).click();
  expect((await savedParts(page))[0]).toEqual({ type: "symbol", entryId: "example-input", bindings: { x1: "", x2: "", x3: "(t)" } });
});

test("symbol search preserves IME Enter and slot drafts fit a narrow screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await openInputNote(page), block = formula(panel); await edit(block); await surface(block).press("End"); await surface(block).press("Enter");
  const editor = block.getByRole("dialog", { name: "添加公式项", exact: true }), combo = editor.getByRole("searchbox", { name: "搜索公式符号", exact: true });
  await combo.fill("输入向量");
  await combo.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(editor.getByRole("navigation", { name: "候选符号词条", exact: true })).toBeVisible(); await expect(editor).toBeVisible();
  expect(await savedParts(page).then(parts => parts.length)).toBe(3);
  await combo.press("Enter"); await editor.getByRole("button", { name: "编辑右侧变量", exact: true }).click();
  const input = editor.getByLabel("右侧变量 x3", { exact: true }); await input.fill("(t\\mid s_{g_h},\\mathcal H_h)");
  const popup = editor.getByRole("dialog", { name: "编辑右侧变量", exact: true });
  const bounds = (await popup.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath("formula-symbol-visual-editor-mobile.png") });
  await input.press("Escape"); await editor.press("Escape");
  expect(await savedParts(page).then(parts => parts.length)).toBe(4);
});
