import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { defaultCalloutAppearance } from "../src/domain/researchCallout.ts";
import { expectEditorSource, pasteEditorMarkdown } from "./helpers/referenceEditor.ts";

async function openNote(page: Page) {
  const state = createNotebookFixture();
  state.terms = [{ id: "rich-term", name: "示例术语", englishName: "Example term", aliases: [], meaning: "用于编辑回归的虚构词条。" }];
  state.notes = [{ ...createResearchNote("直接排版编辑"), id: "rich-note", blocks: [
    { id: "rich-heading", type: "heading", level: 2, text: "保持 **标题** 排版" },
    { id: "rich-paragraph", type: "paragraph", text: "开始 **重点内容**，*斜体文字*，~~删除文字~~ 和 `行内代码`。" },
    { id: "rich-list", type: "list", items: ["第一项 **重点**", "第二项内容"] },
    { id: "rich-quote", type: "markdown", kind: "quote", text: "> 引用 **重点**\n> 第二行" },
    { id: "rich-table", type: "markdown", kind: "table", text: "| 名称 |\n| --- |\n| **表格重点** |" },
    { id: "rich-reference", type: "paragraph", text: "[旧名](mewiki-term:rich-term)" },
    { id: "rich-task", type: "markdown", kind: "taskList", text: "- [x] 完成事项" },
    { id: "rich-callout", type: "callout", title: "提示", text: "**提示重点**", appearance: { ...defaultCalloutAppearance } },
    { id: "rich-tabs", type: "examples", tabs: [{ id: "rich-tab", title: "场景", blocks: [{ id: "rich-tab-text", type: "paragraph", text: "**场景重点**" }] }] },
  ] }];
  state.activeNoteId = "rich-note"; state.open = true; state.view = "notes";
  await page.addInitScript(value => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:locale", "zh-CN"); localStorage.setItem("mewiki:research-notebook-mode", "edit");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true"); localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
}

for (const width of [1440, 390]) {
  test(`keeps typography and clicked caret while editing rendered text at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 }); await openNote(page);
    for (const [id, selector] of [["rich-heading", "h2"], ["rich-paragraph", "strong"], ["rich-list", "li"], ["rich-quote", "blockquote"], ["rich-callout", "strong"], ["rich-tab-text", "strong"]]) {
      const block = page.locator(`[data-block-id="${id}"]`), target = block.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      const before = (await target.boundingBox())!, font = await target.evaluate(element => ({ size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight }));
      await target.click({ position: { x: 4, y: before.height / 2 } });
      const editor = block.locator('[contenteditable="true"]'); await expect(editor).toBeFocused();
      const after = (await editor.locator(selector).first().boundingBox())!;
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
      expect(await editor.locator(selector).first().evaluate(element => ({ size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight }))).toEqual(font);
      expect(await editor.innerText()).not.toMatch(/\*\*|^## /);
      await editor.press("Escape");
    }
    const block = page.locator('[data-block-id="rich-paragraph"]');
    await block.scrollIntoViewIfNeeded();
    const bold = block.locator("strong"), box = (await bold.boundingBox())!;
    await bold.click({ position: { x: box.width * .5, y: box.height / 2 } });
    const editor = block.locator('[contenteditable="true"]');
    expect(await editor.evaluate(element => { const selection = getSelection(); return !!selection?.anchorNode?.parentElement?.closest("strong") && element.contains(selection.anchorNode); })).toBe(true);
    await page.keyboard.insertText("新增");
    await expect(editor.locator("strong")).toContainText("新增");
    await editor.press("Control+z"); await expect(editor.locator("strong")).toHaveText("重点内容");
    await editor.press("Control+Shift+z"); await expect(editor.locator("strong")).toContainText("新增");
    await page.screenshot({ path: info.outputPath("rendered-editing-active.png") });
    await editor.press("Escape");
    await expect(block.locator("strong")).toContainText("新增");
    await page.screenshot({ path: info.outputPath("rendered-editing.png") });
    await page.reload(); await expect(block.locator("strong")).toContainText("新增");
  });
}

test("keeps formatting in table cells and saves heading edits without exposing Markdown", async ({ page }) => {
  await openNote(page);
  const heading = page.locator('[data-block-id="rich-heading"]');
  await heading.locator("h2").click({ position: { x: 4, y: 8 } });
  let editor = heading.locator('[contenteditable="true"]');
  await editor.press("Control+End"); await page.keyboard.insertText("更新"); await editor.press("Escape");
  await expect(heading.locator("h2")).toContainText("排版更新");
  const cell = page.locator('[data-block-id="rich-table"] td'), before = (await cell.boundingBox())!;
  await cell.locator("strong").click();
  editor = page.locator('.research-table-cell-editor [contenteditable="true"]');
  await expect(editor.locator("strong")).toHaveText("表格重点");
  expect((await cell.boundingBox())!.height).toBe(before.height);
  await editor.press("Control+End"); await page.keyboard.insertText("更新"); await editor.press("Enter");
  await expect(cell.locator("strong")).toHaveText("表格重点更新");
});

test("attaches a rendered heading selection to AI without its automatic number or Markdown punctuation", async ({ page }) => {
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  await openNote(page);
  const block = page.locator('[data-block-id="rich-heading"]'); await block.locator('strong').click();
  const editor = block.locator('[contenteditable="true"]');
  await editor.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element.querySelector('h2')!);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Alt+Enter');
  const selection = page.getByRole('group', { name: '选中文字', exact: true });
  await expect(selection).toContainText('保持 标题 排版');
  await expect(selection).not.toContainText('1.');
});

test("keeps stable references when typing formatting around them and changing the display form", async ({ page }) => {
  await openNote(page);
  const block = page.locator('[data-block-id="rich-reference"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).focus();
  const editor = block.locator('[contenteditable="true"]');
  await editor.press("Control+Home"); await editor.pressSequentially("**");
  await editor.press("Control+End"); await editor.pressSequentially("**");
  await expect(editor.locator('strong [data-reference-kind="term"]')).toHaveCount(1);
  await editor.locator('[data-reference-kind="term"]').press("F2");
  const popup = page.getByRole("dialog", { name: "编辑引用", exact: true });
  await popup.getByLabel("术语引用形式", { exact: true }).selectOption("full");
  await popup.getByRole("button", { name: "应用引用修改", exact: true }).click();
  await expect(editor.locator('strong [data-reference-kind="term"]')).toHaveCount(1);
  await expectEditorSource(editor, "**[示例术语（Example term）](mewiki-term:rich-term?display=full)**");
});

test("switches to Markdown source only on explicit request and returns to rendered editing", async ({ page }) => {
  await openNote(page); const block = page.locator('[data-block-id="rich-paragraph"]');
  await block.locator("strong").click();
  await expect(block.locator("textarea")).toHaveCount(0);
  await block.getByRole("button", { name: "编辑 Markdown 源码", exact: true }).click();
  const source = block.locator("textarea");
  await expect(source).toHaveValue("开始 **重点内容**，*斜体文字*，~~删除文字~~ 和 `行内代码`。");
  await source.fill("## 修改后的 **标题**");
  await block.getByRole("button", { name: "返回排版编辑", exact: true }).click();
  await expect(block.locator('[contenteditable="true"] h2 strong')).toHaveText("标题");
  await block.locator('[contenteditable="true"]').press("Escape");
  await expect(block.locator("h2 strong")).toHaveText("标题");
});

test("pastes headings and fenced code as formatted blocks and keeps code out of term completion", async ({ page }) => {
  await openNote(page); const block = page.locator('[data-block-id="rich-paragraph"]');
  await block.locator("strong").click(); const editor = block.locator('[contenteditable="true"]');
  await pasteEditorMarkdown(editor, "## 粘贴的 **标题**");
  await expect(editor.locator("h2 strong")).toHaveText("标题");
  await pasteEditorMarkdown(editor, "```text\n#均方\n```");
  await expect(editor.locator("pre code")).toHaveText("#均方");
  await editor.press("Control+End"); await page.keyboard.insertText(" #示例");
  await expect(page.getByRole("dialog", { name: "插入术语", exact: true })).toHaveCount(0);
  await editor.press("Escape"); await expect(block.locator("pre code")).toHaveText("#均方 #示例");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).notes[0].blocks.find((block: { id: string }) => block.id === "rich-paragraph").text)).toContain("#均方 #示例");
  await page.reload(); await expect(block.locator("pre code")).toHaveText("#均方 #示例");
});

test("continues paragraphs and lists with editable new lines and preserves bold input in Chinese", async ({ page }) => {
  await openNote(page);
  const block = page.locator('[data-block-id="rich-paragraph"]'); await block.locator("strong").click();
  const editor = block.locator('[contenteditable="true"]');
  await editor.press("Control+End"); await editor.press("Enter"); await page.keyboard.insertText("新段落");
  await expect(editor.locator("p")).toHaveCount(2); await expect(editor.locator("p").last()).toHaveText("新段落");
  await editor.press("Control+b"); await page.keyboard.insertText("加粗中文"); await editor.press("Control+b");
  await expect(editor.locator("p").last().locator("strong")).toHaveText("加粗中文");
  await editor.press("Escape"); await expect(block.locator("p")).toHaveCount(2);
  const list = page.locator('[data-block-id="rich-list"]'); await list.locator("li").last().click();
  const listEditor = list.locator('[contenteditable="true"]');
  await listEditor.press("Control+End"); await listEditor.press("Enter"); await page.keyboard.insertText("第三项");
  await expect(listEditor.locator("li")).toHaveCount(3); await expect(listEditor.locator("li").last()).toHaveText("第三项"); await listEditor.press("Escape");
  const task = page.locator('[data-block-id="rich-task"]'); await task.locator("li").click();
  const taskEditor = task.locator('[contenteditable="true"]');
  await taskEditor.press("Control+End"); await taskEditor.press("Enter"); await page.keyboard.insertText("新事项");
  await expect(taskEditor.locator("li input")).toHaveCount(2); await expect(taskEditor.locator("li input").last()).not.toBeChecked();
  await taskEditor.press("Escape"); await expect(task.locator("li")).toHaveCount(2);
});
