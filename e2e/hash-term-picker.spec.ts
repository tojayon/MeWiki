import { expectEditorSource, startEditorComposition, finishEditorComposition } from "./helpers/referenceEditor.ts";
import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";

async function openText(page: Page, empty = false) {
  const state = createNotebookFixture();
  state.terms = empty ? [] : [{ id: "hash-mse", name: "均方误差", englishName: "Mean squared error", englishAbbreviation: "MSE", aliases: ["平方误差均值"], meaning: "误差平方的均值。", tags: ["写作/术语"] }];
  const note = { ...createResearchNote("井号输入测试"), id: "hash-owner", blocks: [{ id: "hash-body", type: "paragraph" as const, text: "前文 后文" }] };
  state.notes = [note, { ...createResearchNote("均方误差笔记"), id: "hash-target", blocks: [] }];
  state.activeNoteId = note.id; state.view = "notes"; state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-mode", "edit");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  const block = page.locator('[data-block-id="hash-body"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  return block.locator('[contenteditable="true"]');
}

test("opens a term-only picker immediately for # and keeps @ for notes", async ({ page }, info) => {
  const editor = await openText(page);
  await editor.fill("#");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("option", { name: "均方误差", exact: true })).toBeVisible();
  await expect(picker.getByRole("option", { name: "均方误差笔记", exact: true })).toHaveCount(0);
  await picker.getByLabel("术语引用形式", { exact: true }).selectOption("full");
  await page.screenshot({ path: info.outputPath("hash-term-picker.png") });
  await editor.press("Enter");
  await expectEditorSource(editor, "[均方误差（Mean squared error, MSE）](mewiki-term:hash-mse?display=full)");
  await expect(editor).toBeFocused();
  await editor.fill("@均方");
  const notes = page.getByRole("dialog", { name: "插入笔记引用", exact: true });
  await expect(notes.getByRole("option", { name: "均方误差笔记", exact: true })).toBeVisible();
  await expect(notes.getByRole("option", { name: "均方误差", exact: true })).toHaveCount(0);
  await expect(notes.getByLabel("术语引用形式", { exact: true })).toHaveCount(0);
  await editor.press("Enter");
  await expectEditorSource(editor, "[均方误差笔记](#research-note/hash-target)");
});

test("keeps headings, code, math and URL fragments ordinary and preserves cancelled text", async ({ page }) => {
  const editor = await openText(page);
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await editor.fill("#");
  await expect(picker).toBeVisible();
  await editor.press("Space");
  await expect(picker).toHaveCount(0);
  await expectEditorSource(editor, "# ");
  await expect(editor.locator("h1")).toHaveCount(1);
  await editor.press("Control+Alt+0");
  for (const text of ["## 标题", "\\#均方", "`#均方", "$x+#均方", "[文档](#section", "https://example.com/#section", "C#"]) {
    await editor.fill(text);
    await expect(picker).toHaveCount(0);
    await expect(editor).toHaveText(text);
  }
  await editor.fill("前文 #MSE");
  await expect(picker.getByRole("option", { name: "均方误差", exact: true })).toBeVisible();
  await editor.press("Escape");
  await expect(picker).toHaveCount(0);
  await expectEditorSource(editor, "前文 #MSE");
  await expect(editor).toBeFocused();
  await editor.press("ArrowLeft");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "取消术语选择", exact: true }).click();
  await expectEditorSource(editor, "前文 #MSE");
});

test("shows the term dialog and reference formats even with an empty dictionary", async ({ page }) => {
  const editor = await openText(page, true);
  await editor.fill("#");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByLabel("术语引用形式", { exact: true })).toBeVisible();
  await expect(picker).toContainText("没有匹配的术语");
  await picker.getByRole("searchbox", { name: "搜索术语", exact: true }).fill("未收录");
  await expect(picker).toBeVisible();
  await picker.getByRole("searchbox").press("Escape");
  await expect(editor).toHaveText("#");
  await expectEditorSource(editor, "\\#");
});

for (const order of ["before", "after"] as const) test(`waits for Chinese composition to commit ${order} compositionend`, async ({ page }) => {
  const editor = await openText(page);
  await startEditorComposition(editor, "#均");
  const picker = page.getByRole("dialog", { name: "插入术语", exact: true });
  await expect(picker).toHaveCount(0);
  await finishEditorComposition(editor, "#均方", order);
  await expect(picker.getByRole("option", { name: "均方误差", exact: true })).toBeVisible();
  await expect(editor).toHaveText("#均方");
  await expectEditorSource(editor, "\\#均方");
  await editor.press("Enter");
  await expectEditorSource(editor, "[均方误差](mewiki-term:hash-mse)");
});
