import { expectEditorSource } from "./helpers/referenceEditor.ts";
import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import type { ResearchTermEntry } from "../src/domain/researchTerms.ts";

async function openTermWorkspace(page: Page, editing = false, fields: Partial<ResearchTermEntry> = {}, locale = "zh-CN") {
  const state = createNotebookFixture();
  state.terms = [{ id: "term-mse", name: "均方误差", englishName: "Mean squared error", englishAbbreviation: "MSE", chineseAbbreviation: "均误",
    aliases: ["平方误差均值", "误差平方均值"], aliasEntries: [{ id: "alias-square", name: "平方误差均值" }, { id: "alias-error", name: "误差平方均值" }],
    meaning: "误差平方的均值。", status: "active", ...fields }];
  const note = { ...createResearchNote("双语术语引用"), id: "bilingual-note", blocks: [{ id: "bilingual-body", type: "paragraph" as const, text: editing ? "前文 后文" : [
    "[均方误差](mewiki-term:term-mse)", "[完整称呼](mewiki-term:term-mse?display=full)",
    "[英文](mewiki-term:term-mse?display=english)", "[缩写](mewiki-term:term-mse?display=english-abbreviation)",
    "[中文缩写](mewiki-term:term-mse?display=chinese-abbreviation)", "[别名](mewiki-term:term-mse?display=alias&alias=alias-error)",
  ].join("；") }] };
  state.notes = [note]; state.activeNoteId = note.id; state.activeTermId = "term-mse"; state.view = "notes"; state.open = true;
  await page.addInitScript(({ value, locale }) => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:locale", locale);
    localStorage.setItem("mewiki:research-notebook-mode", value.notes[0].blocks[0].type === "paragraph" && value.notes[0].blocks[0].text === "前文 后文" ? "edit" : "read");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
  }, { value: state, locale });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  return page.getByTestId("research-notebook");
}

test("edits bilingual names and individual aliases while all bound reference forms stay synchronized", async ({ page }, info) => {
  const panel = await openTermWorkspace(page);
  const body = panel.locator('[data-block-id="bilingual-body"]');
  await expect(body.locator(".research-dictionary-term-reference")).toHaveText([
    "均方误差", "均方误差（Mean squared error, MSE）", "Mean squared error", "MSE", "均误", "误差平方均值",
  ]);
  await body.locator(".research-dictionary-term-reference").nth(3).click();
  const popover = page.getByRole("dialog", { name: "术语解释", exact: true });
  await expect(popover).toContainText("Mean squared error");
  await expect(popover).toContainText("均误");
  await popover.getByRole("button", { name: "打开词典词条", exact: true }).click();
  await panel.getByRole("button", { name: "编辑术语", exact: true }).click();
  await panel.getByLabel("术语英文名称", { exact: true }).fill("Mean square error");
  await panel.getByLabel("术语英文缩写", { exact: true }).fill("MSERR");
  await panel.getByLabel("术语中文缩写", { exact: true }).fill("均方差");
  await panel.getByLabel("别名 2", { exact: true }).fill("误差平方平均值");
  await panel.getByRole("button", { name: "新增别名", exact: true }).click();
  await panel.getByLabel("别名 3", { exact: true }).fill("MSE, legacy");
  await expect(panel.getByLabel("规范引用预览", { exact: true })).toHaveText("均方误差（Mean square error, MSERR）");
  await page.screenshot({ path: info.outputPath("bilingual-term-editor.png") });
  await panel.getByRole("button", { name: "保存术语定义", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).terms[0]);
  expect(saved.aliases).toEqual(["平方误差均值", "误差平方平均值", "MSE, legacy"]);
  expect(saved.aliasEntries[1]).toEqual({ id: "alias-error", name: "误差平方平均值" });
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "双语术语引用", exact: true }).click();
  await expect(body.locator(".research-dictionary-term-reference")).toHaveText([
    "均方误差", "均方误差（Mean square error, MSERR）", "Mean square error", "MSERR", "均方差", "误差平方平均值",
  ]);
  await page.reload();
  await expect(body.locator(".research-dictionary-term-reference").nth(5)).toHaveText("误差平方平均值");
});

test("chooses full names, abbreviations and individual aliases from the term insertion picker", async ({ page }, info) => {
  const panel = await openTermWorkspace(page, true);
  const block = panel.locator('[data-block-id="bilingual-body"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  const editor = block.locator('[contenteditable="true"]');
  const formats = [
    ["full", "均方误差（Mean squared error, MSE）", "display=full"],
    ["english", "Mean squared error", "display=english"],
    ["english-abbreviation", "MSE", "display=english-abbreviation"],
    ["chinese-abbreviation", "均误", "display=chinese-abbreviation"],
    ["alias", "误差平方均值", "display=alias&alias=alias-error"],
  ];
  for (const [form, label, query] of formats) {
    await editor.fill("#MSE");
    const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
    await expect(picker).toBeVisible();
    await picker.getByLabel("术语引用形式", { exact: true }).selectOption(form);
    await expect(picker.getByRole("option", { name: label, exact: true })).toBeVisible();
    if (form === "full") await page.screenshot({ path: info.outputPath("bilingual-term-picker.png") });
    await picker.getByRole("option", { name: label, exact: true }).click();
    await expectEditorSource(editor, `[${label}](mewiki-term:term-mse?${query})`);
    await expect(picker).toHaveCount(0);
  }
  await editor.fill("#均误");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await expect(picker.getByRole("option", { name: "均方误差", exact: true })).toBeVisible();
  await editor.press("Escape");
  await expectEditorSource(editor, "\\#均误");
});

test("keeps the chosen reference form keyboard accessible on a phone", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const panel = await openTermWorkspace(page, true);
  await panel.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  const block = panel.locator('[data-block-id="bilingual-body"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  const editor = block.locator('[contenteditable="true"]');
  await editor.fill("前文 #MSE");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  const form = picker.getByLabel("术语引用形式", { exact: true });
  await form.selectOption("full");
  await expect(picker.getByRole("option", { name: "均方误差（Mean squared error, MSE）", exact: true })).toBeVisible();
  const bounds = await picker.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("bilingual-term-picker-phone.png") });
  await picker.getByRole("searchbox").focus();
  await picker.getByRole("searchbox").press("Enter");
  await expectEditorSource(editor, "前文 [均方误差（Mean squared error, MSE）](mewiki-term:term-mse?display=full)");
  await expect(editor).toBeFocused();
});

test("removes an earlier alias without retargeting later alias references", async ({ page }) => {
  const panel = await openTermWorkspace(page);
  await panel.getByRole("tab", { name: "术语", exact: true }).click();
  await panel.getByLabel("搜索术语词条", { exact: true }).fill("MSE");
  await panel.getByRole("button", { name: "均方误差", exact: true }).click();
  await panel.getByRole("button", { name: "编辑术语", exact: true }).click();
  await panel.getByRole("button", { name: "删除别名 1", exact: true }).click();
  await expect(panel.getByLabel("别名 1", { exact: true })).toHaveValue("误差平方均值");
  await panel.getByRole("button", { name: "保存术语定义", exact: true }).click();
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "双语术语引用", exact: true }).click();
  const reference = panel.locator('[data-block-id="bilingual-body"] .research-dictionary-term-reference').nth(5);
  await expect(reference).toHaveText("误差平方均值");
  await panel.getByRole("tab", { name: "术语", exact: true }).click();
  await panel.getByRole("button", { name: "均方误差", exact: true }).click();
  await panel.getByRole("button", { name: "编辑术语", exact: true }).click();
  await panel.getByRole("button", { name: "删除别名 1", exact: true }).click();
  await panel.getByLabel("术语英文缩写", { exact: true }).fill("");
  await panel.getByRole("button", { name: "保存术语定义", exact: true }).click();
  await panel.getByRole("tab", { name: "研究记录", exact: true }).click();
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "双语术语引用", exact: true }).click();
  await expect(reference).toHaveText("均方误差");
  await expect(panel.locator('[data-block-id="bilingual-body"] .research-dictionary-term-reference').nth(3)).toHaveText("均方误差");
});

test("composes independent references to one term using names, abbreviations and an English alias", async ({ page }, info) => {
  const panel = await openTermWorkspace(page, true, { aliases: ["Mean square error"], aliasEntries: [{ id: "alias-english", name: "Mean square error" }] });
  const block = panel.locator('[data-block-id="bilingual-body"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  const editor = block.locator('[contenteditable="true"]');
  const selections = [
    ["chinese-abbreviation", "均误", ""],
    ["english", "Mean squared error", "（"],
    ["english-abbreviation", "MSE", "，"],
    ["alias", "Mean square error", "，"],
  ];
  await editor.fill("");
  for (const [form, label, prefix] of selections) {
    await editor.press("Control+End");
    await page.keyboard.insertText(`${prefix}#MSE`);
    const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
    await picker.getByLabel("术语引用形式", { exact: true }).selectOption(form);
    await picker.getByRole("option", { name: label, exact: true }).click();
  }
  await page.keyboard.insertText("）");
  const references = editor.locator('[data-reference-kind="term"]');
  await expect(references).toHaveText(["均误", "Mean squared error", "MSE", "Mean square error"]);
  await references.first().press("F2");
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  const forms = popup.getByLabel("术语引用形式", { exact: true });
  await expect(forms.locator('option[value="chinese-abbreviation"]')).toHaveText("仅中文缩写 · 均误");
  await expect(forms.locator('option[value="english-abbreviation"]')).toHaveText("仅英文缩写 · MSE");
  await expect(forms.locator('option[value="english"]')).toHaveText("仅英文名称 · Mean squared error");
  await expect(forms.locator('option[value="alias:alias-english"]')).toHaveText("别名／英文别称 · Mean square error");
  await forms.selectOption("name");
  await expect(popup.getByLabel("本次引用预览", { exact: true })).toHaveText("均方误差");
  await page.screenshot({ path: info.outputPath("independent-reference-forms.png") });
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await expect(references).toHaveText(["均方误差", "Mean squared error", "MSE", "Mean square error"]);
  await expectEditorSource(editor, "[均方误差](mewiki-term:term-mse)（[Mean squared error](mewiki-term:term-mse?display=english)，[MSE](mewiki-term:term-mse?display=english-abbreviation)，[Mean square error](mewiki-term:term-mse?display=alias&alias=alias-english)）");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks[0].text)).toContain("alias=alias-english");
  await page.reload();
  await expect(block.locator(".research-dictionary-term-reference")).toHaveText(["均方误差", "Mean squared error", "MSE", "Mean square error"]);
});

test("identifies unfilled term name fields instead of hiding the supported display modes", async ({ page }) => {
  const panel = await openTermWorkspace(page, false, { englishName: undefined, englishAbbreviation: undefined, chineseAbbreviation: undefined, aliases: [], aliasEntries: [] });
  await panel.getByRole("button", { name: "切换为编辑模式", exact: true }).click();
  const block = panel.locator('[data-block-id="bilingual-body"]');
  await block.getByRole("textbox").focus();
  await block.locator('[data-reference-kind="term"]').first().press("F2");
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  const form = popup.getByLabel("术语引用形式", { exact: true });
  for (const value of ["english", "english-abbreviation", "chinese-abbreviation", "alias"]) {
    const option = form.locator(`option[value="${value}"]`);
    await expect(option).toContainText("未填写");
    await expect(option).toHaveJSProperty("disabled", true);
  }
  await expect(popup).toContainText("不同位置可引用同一术语并分别选择显示形式；缺少的名称请在词典中填写。");
  expect(await popup.evaluate(element => !!element.closest('dialog[data-testid="research-notebook"]'))).toBe(true);
  await popup.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel.locator('[data-block-id="bilingual-body"] [data-reference-kind="term"]')).toHaveCount(6);
});

test("changes a single reference form with keyboard controls on a narrow screen", async ({ page }, info) => {
  const panel = await openTermWorkspace(page);
  await panel.getByRole("button", { name: "切换为编辑模式", exact: true }).click();
  await panel.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 800 });
  const block = panel.locator('[data-block-id="bilingual-body"]');
  await block.getByRole("textbox").focus();
  await block.locator('[data-reference-kind="term"]').first().press("F2");
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  const form = popup.getByLabel("术语引用形式", { exact: true });
  await form.focus();
  await form.press("Home");
  await form.press("ArrowDown");
  await form.press("ArrowDown");
  await expect(form).toHaveValue("chinese-abbreviation");
  await expect(popup.getByLabel("本次引用预览", { exact: true })).toHaveText("均误");
  const bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("reference-form-phone.png") });
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(block.locator('[data-reference-kind="term"]').first()).toHaveText("均误");
  await expect(block.locator('[data-reference-kind="term"]').nth(3)).toHaveText("MSE");
});

test("localizes form types while preserving each selected term name", async ({ page }, info) => {
  const panel = await openTermWorkspace(page, false, {}, "en");
  await panel.getByRole("button", { name: "Switch to edit mode", exact: true }).click();
  const block = panel.locator('[data-block-id="bilingual-body"]');
  await block.getByRole("textbox").focus();
  await block.locator('[data-reference-kind="term"]').first().press("F2");
  const popup = page.getByRole("dialog", { name: "Edit reference", exact: true });
  const form = popup.getByLabel("Term reference form", { exact: true });
  await expect(form.locator('option[value="chinese-abbreviation"]')).toHaveText("Chinese abbreviation only · 均误");
  await expect(form.locator('option[value="english-abbreviation"]')).toHaveText("English abbreviation only · MSE");
  await expect(form.locator('option[value="alias:alias-square"]')).toHaveText("Alias / English alternative name · 平方误差均值");
  await form.selectOption("english-abbreviation");
  await expect(popup.getByLabel("Current reference preview", { exact: true })).toHaveText("MSE");
  await page.screenshot({ path: info.outputPath("reference-forms-english.png") });
  await popup.getByRole("button", { name: "Apply reference changes", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).terms[0].name)).toBe("均方误差");
});
