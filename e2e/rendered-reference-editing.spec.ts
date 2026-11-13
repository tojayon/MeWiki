import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";
import { expectEditorSource } from "./helpers/referenceEditor.ts";

const source = "前文 [旧术语名](mewiki-term:visual-term) 与 [$x_i$](mewiki-symbol:visual-symbol?x2=i)，参见 [旧笔记名](#research-note/visual-target)，[文献第 3 页](webbench-asset:" + "a".repeat(64) + "#page=3) 后文";
async function openReferences(page: Page, text = source, activate = true) {
  const state = createNotebookFixture();
  state.terms = [
    { id: "visual-term", name: "均方误差", englishName: "Mean squared error", englishAbbreviation: "MSE", aliases: ["平方误差均值"], meaning: "误差平方的均值。" },
    { id: "visual-other", name: "绝对误差", aliases: [], meaning: "误差的绝对值。" },
  ];
  state.symbols = [createSymbolEntry({ name: "观测值", notation: "x_{[x2]}", meaning: "一次观测的数值。", category: "custom", slots: [{ key: "x2", label: "下标", defaultValue: "n", description: "样本编号" }] }, "visual-symbol")];
  state.notes = [{ ...createResearchNote("渲染引用编辑"), id: "visual-owner", blocks: [{ id: "visual-body", type: "paragraph", text }, { id: "visual-table", type: "paragraph", text: "| 名称 |\n| --- |\n| 待填写 |" }] }, { ...createResearchNote("当前来源笔记"), id: "visual-target", blocks: [] }];
  state.activeNoteId = "visual-owner"; state.view = "notes"; state.open = true;
  await page.addInitScript(value => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:locale", "zh-CN"); localStorage.setItem("mewiki:research-notebook-mode", "edit");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true"); localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const block = page.locator('[data-block-id="visual-body"]');
  if (activate) await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  return { block, editor: block.locator('[contenteditable="true"]') };
}

const endingReferences = [
  ["note", "[来源笔记](#research-note/visual-target)"],
  ["file", `[示例文件](webbench-asset:${"a".repeat(64)})`],
  ["term", "[术语](mewiki-term:visual-term)"],
  ["symbol", "[$x_i$](mewiki-symbol:visual-symbol?x2=i)"],
] as const;
for (const width of [1440, 390]) for (const [kind, reference] of endingReferences) {
  test(`keeps a trailing ${kind} reference on the text line at ${width}px and deletes only that reference`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const prefix = "参见 ", text = prefix + reference;
    const { block, editor } = await openReferences(page, text, false);
    const rendered = block.getByRole("textbox", { name: "笔记段落", exact: true });
    const before = (await rendered.boundingBox())!;
    await rendered.click({ position: { x: 4, y: 4 } });
    await editor.press("Control+End");
    const after = (await editor.boundingBox())!;
    await page.screenshot({ path: info.outputPath("trailing-reference.png") });
    expect(after.height).toBeLessThanOrEqual(before.height + 2);
    await expectEditorSource(editor, text);
    await editor.locator(`[data-reference-kind="${kind}"]`).click();
    await page.getByRole("dialog", { name: "编辑引用", exact: true }).getByRole("button", { name: "删除此引用", exact: true }).click();
    await expectEditorSource(editor, prefix);
    await expect(block).toHaveCount(1);
    await editor.press("Control+z");
    await expectEditorSource(editor, text);
    await editor.press("Escape");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes.map((note: { id: string }) => note.id))).toContain("visual-target");
  });
}

test("renders sourced references during editing and saves surrounding text without rewriting links", async ({ page }, info) => {
  const { editor, block } = await openReferences(page);
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-reference-kind="term"]')).toHaveText("均方误差");
  await expect(editor.locator('[data-reference-kind="symbol"] .katex')).toBeVisible();
  await expect(editor.locator('[data-reference-kind="note"]')).toContainText("当前来源笔记");
  await expect(editor.locator('[data-reference-kind="file"]')).toContainText("文献第 3 页");
  await expect(editor).not.toContainText("mewiki-");
  await editor.press("Control+End"); await editor.pressSequentially("新增");
  await page.screenshot({ path: info.outputPath("rendered-references.png") });
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(block.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].text)).toBe(source + "新增");
});

test("preserves natural wrapping without an extra row after a paragraph-ending reference", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 960 });
  const text = "这是一段用于核对引用排版的示例文字，内容较长时会根据窗口宽度自然折行。".repeat(3) + "参见 [来源](#research-note/visual-target)";
  const { block, editor } = await openReferences(page, text, false);
  const rendered = block.getByRole("textbox", { name: "笔记段落", exact: true });
  const before = (await rendered.boundingBox())!;
  expect(before.height).toBeGreaterThan(60);
  await rendered.click({ position: { x: 4, y: 4 } });
  await editor.press("Control+End");
  expect((await editor.boundingBox())!.height).toBeLessThanOrEqual(before.height + 2);
  await expectEditorSource(editor, text);
  await page.screenshot({ path: info.outputPath("wrapped-reference-phone.png") });
});

test("keeps an ending table reference on one row and removes only the selected link", async ({ page }) => {
  const text = "| 名称 |\n| --- |\n| 参见 [来源](#research-note/visual-target) |";
  const { block } = await openReferences(page, text, false);
  await block.locator("td").first().click();
  const editor = block.getByRole("textbox", { name: "单元格内容", exact: true });
  await expect.poll(() => editor.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await editor.locator('[data-reference-kind="note"]').click();
  await page.getByRole("dialog", { name: "编辑引用", exact: true }).getByRole("button", { name: "删除此引用", exact: true }).click();
  await expectEditorSource(editor, "参见 ");
  await editor.press("Enter");
  await expect(block.locator("td").first()).toHaveText("参见");
  await expect(block).toHaveCount(1);
});

test("deletes a term atom once and restores it with undo and redo", async ({ page }) => {
  const { editor } = await openReferences(page, "前[术语](mewiki-term:visual-term)后");
  await editor.press("Control+Home"); await editor.press("ArrowRight"); await editor.press("Delete");
  await expect(editor).toHaveText("前后");
  await editor.press("Control+z"); await expect(editor.locator('[data-reference-kind="term"]')).toHaveCount(1);
  await editor.press("Control+y"); await expect(editor.locator('[data-reference-kind="term"]')).toHaveCount(0);
  await editor.press("Control+z"); await editor.press("Control+End"); await editor.press("ArrowLeft"); await editor.press("Backspace");
  await expect(editor).toHaveText("前后");
});

test("edits the selected term reference in a popover while keeping the dictionary intact", async ({ page }) => {
  const { editor } = await openReferences(page);
  await editor.locator('[data-reference-kind="term"]').click();
  const popover = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await expect(popover).toContainText("误差平方的均值。");
  await popover.getByLabel("术语引用形式", { exact: true }).selectOption("full");
  await popover.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await expect(editor.locator('[data-reference-kind="term"]')).toHaveText("均方误差（Mean squared error, MSE）");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!));
  expect(state.notes[0].blocks[0].text).toContain("mewiki-term:visual-term?display=full");
  expect(state.terms[0].name).toBe("均方误差");
});

test("opens reference controls directly from a rendered paragraph and replaces only this occurrence", async ({ page }) => {
  const { editor, block } = await openReferences(page, "[一](mewiki-term:visual-term) 与 [二](mewiki-term:visual-term)", false);
  await block.locator(".research-dictionary-term-reference").nth(1).click();
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "更换引用来源", exact: true }).click();
  const choices = page.getByRole("dialog", { name: "更换引用来源", exact: true });
  await choices.getByRole("option", { name: "绝对误差", exact: true }).click();
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await expect(editor.locator('[data-reference-kind="term"]')).toHaveText(["均方误差", "绝对误差"]);
  await expectEditorSource(editor, "[一](mewiki-term:visual-term) 与 [绝对误差](mewiki-term:visual-other)");
  await editor.press("Control+z");
  await expectEditorSource(editor, "[一](mewiki-term:visual-term) 与 [二](mewiki-term:visual-term)");
});

test("keeps cancellation, symbol bindings and file page edits local to the selected reference", async ({ page }, info) => {
  const { editor } = await openReferences(page);
  await editor.locator('[data-reference-kind="symbol"]').click();
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await popup.getByRole("textbox", { name: "本次引用：右下角标 x2", exact: true }).fill("k+1");
  await popup.getByRole("button", { name: "取消", exact: true }).click();
  await expectEditorSource(editor, source);
  await editor.locator('[data-reference-kind="symbol"]').click();
  await popup.getByRole("textbox", { name: "本次引用：右下角标 x2", exact: true }).fill("k+1");
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await expect(editor.locator('[data-reference-kind="symbol"] annotation')).toHaveText("x_{k+1}");
  await editor.locator('[data-reference-kind="file"]').click();
  await popup.getByLabel("PDF 页码（可选）", { exact: true }).fill("5");
  await page.screenshot({ path: info.outputPath("file-reference-panel.png") });
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await expect(editor.locator('[data-reference-kind="file"]')).toContainText("第 5 页");
  await expect(editor.locator('[data-reference-kind="file"]')).not.toContainText("第 3 页");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!));
  expect(state.notes[0].blocks[0].text).toContain("?x2=k%2B1");
  expect(state.notes[0].blocks[0].text).toContain("#page=5");
  expect(state.symbols[0].slots.find((slot: { key: string }) => slot.key === "x2").defaultValue).toBe("n");
});

test("copies readable text and pastes complete references in the same library with undo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor } = await openReferences(page, "前[原文](mewiki-term:visual-term)后");
  await editor.press("Control+a"); await editor.press("Control+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("前均方误差后");
  await editor.press("Control+End"); await editor.press("Control+v");
  await expect(editor.locator('[data-reference-kind="term"]')).toHaveCount(2);
  await expectEditorSource(editor, "前[原文](mewiki-term:visual-term)后前[原文](mewiki-term:visual-term)后");
  await editor.press("Control+z"); await expect(editor.locator('[data-reference-kind="term"]')).toHaveCount(1);
});

test("preserves selected text when the clipboard contains only an unsupported payload", async ({ page }) => {
  const { editor } = await openReferences(page, "前[原文](mewiki-term:visual-term)后");
  await editor.press("Control+a");
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/html", "<img src='invalid'>");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expectEditorSource(editor, "前[原文](mewiki-term:visual-term)后");
});

test("keeps unavailable references whole and lets users repair or remove them on a narrow screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { editor } = await openReferences(page, "前[缺失术语](mewiki-term:missing-id)后");
  await editor.locator('[data-reference-kind="term"]').click();
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await expect(popup).toContainText("引用来源已移除");
  const box = await popup.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("reference-panel-phone.png") });
  await popup.getByRole("button", { name: "删除此引用", exact: true }).click();
  await expect(editor).toHaveText("前后");
  await editor.press("Control+z"); await expect(editor).toContainText("缺失术语");
});

test("preserves multiline edits, list continuation and a term inserted with #", async ({ page }) => {
  const { editor } = await openReferences(page, "前文");
  await editor.fill("```text\n#代码中的文字\n```\n\n后文");
  await expectEditorSource(editor, "```text\n#代码中的文字\n```\n\n后文");
  await editor.fill("- 第一项"); await editor.press("Control+End"); await editor.press("Shift+Enter");
  await expectEditorSource(editor, "- 第一项\n- ");
  await editor.pressSequentially("#");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await picker.getByRole("option", { name: "均方误差", exact: true }).click();
  await expect(editor.locator('[data-reference-kind="term"]')).toHaveText("均方误差");
  await editor.press("Control+z"); await expectEditorSource(editor, "- 第一项\n- #");
});

test("edits atomic references inside a table cell while preserving the table source", async ({ page }) => {
  const text = "| 名称 | 说明 |\n| --- | --- |\n| [旧](mewiki-term:visual-term) | 正文 |";
  const { block } = await openReferences(page, text, false);
  await block.locator("td").first().click();
  const editor = block.getByRole("textbox", { name: "单元格内容", exact: true });
  await expect(editor.locator('[data-reference-kind="term"]')).toHaveText("均方误差");
  await editor.locator('[data-reference-kind="term"]').click();
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await popup.getByLabel("术语引用形式", { exact: true }).selectOption("english-abbreviation");
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await editor.press("Enter");
  await expect(block.locator("td").first()).toContainText("MSE");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].text)).toContain("mewiki-term:visual-term?display=english-abbreviation");
});

test("retains stable sources when a copied multiline paragraph is pasted into table rows", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor } = await openReferences(page, "[旧名](mewiki-term:visual-term)\n[另一条](mewiki-term:visual-other)");
  await editor.press("Control+a"); await editor.press("Control+c");
  const table = page.locator('[data-block-id="visual-table"]');
  await table.locator("td").first().click();
  const cell = table.getByRole("textbox", { name: "单元格内容", exact: true });
  await cell.press("Control+v");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks.find((block: { id: string }) => block.id === "visual-table").text)).toContain("mewiki-term:visual-term");
  await expect(table.locator("td")).toHaveText(["均方误差", "绝对误差"]);
});

test("copies an old reference-style link independently of its definition", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { editor } = await openReferences(page, "前[旧词][term]\n\n[term]: mewiki-term:visual-term?display=full");
  await editor.press("Control+Home"); await editor.press("ArrowRight"); await editor.press("Shift+ArrowRight"); await editor.press("Control+c");
  const table = page.locator('[data-block-id="visual-table"]'); await table.locator("td").click();
  const cell = table.getByRole("textbox", { name: "单元格内容", exact: true });
  await cell.press("Control+a"); await cell.press("Control+v");
  await expect(cell.locator('[data-reference-kind="term"]')).toHaveCount(1);
  await expectEditorSource(cell, "[旧词](mewiki-term:visual-term?display=full)");
});

test("uses readable text for a clipboard reference from another library", async ({ page }) => {
  const { editor } = await openReferences(page, "前文");
  await editor.press("Control+End");
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "均方误差");
    clipboardData.setData("application/x-mewiki-references+json", JSON.stringify({ library: "another-library", source: "[旧名](mewiki-term:visual-term)" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expectEditorSource(editor, "前文均方误差");
  await expect(editor.locator('[data-reference-kind]')).toHaveCount(0);
});

test("announces the active candidate and edits an atom from the keyboard", async ({ page }) => {
  const { editor } = await openReferences(page, "前[旧名](mewiki-term:visual-term)后");
  await editor.press("Control+Home"); await editor.press("ArrowRight"); await editor.press("F2");
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await expect(popup).toBeVisible(); await page.keyboard.press("Escape"); await expect(editor).toBeFocused();
  await editor.fill("#"); await editor.press("ArrowDown");
  const activeId = await editor.getAttribute("aria-activedescendant"); expect(activeId).toBeTruthy();
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute("role", "option");
  await expect(editor).toHaveAttribute("aria-autocomplete", "list");
});

test("uses the visible caret when a command arrives before selectionchange", async ({ page }) => {
  const { editor } = await openReferences(page, "前[旧名](mewiki-term:visual-term)后");
  await editor.press("Control+Home");
  await editor.evaluate(element => {
    const text = element.firstChild!.firstChild!;
    // Keep movement and the command in one task, before the browser emits selectionchange.
    document.getSelection()!.collapse(text, 1);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", code: "F2", keyCode: 113, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("dialog", { name: "编辑引用", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.evaluate(element => {
    document.getSelection()!.collapse(element.firstChild!.lastChild!, 0);
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", keyCode: 8, bubbles: true, cancelable: true }));
  });
  await expectEditorSource(editor, "前后");
  await editor.press("Control+z");
  await expectEditorSource(editor, "前[旧名](mewiki-term:visual-term)后");
});

test("finishes a rendered reference paragraph with Ctrl+Enter and preserves it after reload", async ({ page }) => {
  const { editor, block } = await openReferences(page, "前[旧名](mewiki-term:visual-term)后");
  await editor.press("Control+End"); await editor.pressSequentially("完成"); await editor.press("Control+Enter");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].text)).toBe("前[旧名](mewiki-term:visual-term)后完成");
  await page.reload(); await expect(block).toContainText("均方误差后完成");
});
