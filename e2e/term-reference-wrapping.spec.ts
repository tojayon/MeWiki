import { expect, test, type Locator, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { defaultCalloutAppearance } from "../src/domain/researchCallout.ts";
import { runNotebookAction } from "./helpers/researchNotebook.ts";

const name = "端到端传输与传播时延";

async function openNote(page: Page) {
  const state = createNotebookFixture(), text = `这里说明数据包的[${name}](mewiki-term:wrap-term)分别计量。`;
  state.terms = [{ id: "wrap-term", name, aliases: [], meaning: "用于核对自然换行的虚构词条。" }];
  state.notes = [{ ...createResearchNote("术语自然换行"), id: "wrap-note", blocks: [
    { id: "wrap-paragraph", type: "paragraph", text },
    { id: "wrap-list", type: "list", items: [text] },
    { id: "wrap-table", type: "markdown", kind: "table", text: `| 内容 |\n| --- |\n| ${text} |` },
    { id: "wrap-callout", type: "callout", title: "提示", text, appearance: { ...defaultCalloutAppearance } },
  ] }];
  state.activeNoteId = "wrap-note"; state.view = "notes"; state.open = true;
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
}

async function letters(reference: Locator) {
  return reference.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), result: { x: number; y: number }[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      for (let i = 0; i < (text.textContent?.length ?? 0); i++) {
        const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1);
        const rect = range.getBoundingClientRect(); result.push({ x: rect.x, y: rect.y });
      }
    }
    return result;
  });
}

for (const width of [1440, 390]) test(`wraps terms at the same letters before, during and after editing at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 960 }); await openNote(page);
  const original = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    return { blocks: saved.notes[0].blocks, terms: saved.terms.map(({ id, name, meaning, aliases }: { id: string; name: string; meaning: string; aliases: string[] }) => ({ id, name, meaning, aliases })) };
  });
  for (const id of ["wrap-paragraph", "wrap-list", "wrap-table", "wrap-callout"]) {
    const block = page.locator(`[data-block-id="${id}"]`), text = block.locator(".research-editable-text").first();
    await text.evaluate(element => { (element as HTMLElement).style.width = "210px"; });
    if (id === "wrap-table") await block.locator("table").evaluate(element => { element.style.width = "100%"; element.style.tableLayout = "fixed"; });
    await block.scrollIntoViewIfNeeded();
    const term = block.getByRole("button", { name: `术语：${name}`, exact: true }), before = await letters(term);
    expect(new Set(before.map(point => Math.round(point.y))).size, id).toBeGreaterThan(1);
    await term.click();
    const detail = page.getByRole("dialog", { name: "术语解释", exact: true });
    await expect(detail).toBeVisible(); await expect(block.locator('[contenteditable="true"], textarea')).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(term).toBeFocused();
    const line = block.locator(id === "wrap-table" ? "td" : id === "wrap-list" ? "li" : "p").first();
    await line.click({ position: { x: 4, y: 8 } });
    const editor = block.locator('[contenteditable="true"]'); await expect(editor).toBeFocused();
    const during = await letters(editor.locator('[data-reference-kind="term"]'));
    expect(during).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(before[i].x - during[i].x), `${id}: letter ${i}, horizontal position`).toBeLessThanOrEqual(1);
      expect(Math.abs(before[i].y - during[i].y), `${id}: letter ${i}, vertical position`).toBeLessThanOrEqual(1);
    }
    await editor.press(id === "wrap-table" ? "Enter" : "Escape");
    await expect(editor).toHaveCount(0);
    expect(await letters(term)).toEqual(before);
    if (id === "wrap-paragraph") await block.screenshot({ path: info.outputPath("wrapped-term.png") });
  }
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    return { blocks: saved.notes[0].blocks, terms: saved.terms.map(({ id, name, meaning, aliases }: { id: string; name: string; meaning: string; aliases: string[] }) => ({ id, name, meaning, aliases })) };
  })).toEqual(original);
  await runNotebookAction(page.getByTestId("research-notebook"), "切换为只读模式");
  const paragraph = page.locator('[data-block-id="wrap-paragraph"]');
  await paragraph.locator(".research-read-text").evaluate(element => { (element as HTMLElement).style.width = "210px"; });
  const term = paragraph.getByRole("button", { name: `术语：${name}`, exact: true });
  expect(new Set((await letters(term)).map(point => Math.round(point.y))).size).toBeGreaterThan(1);
  await term.press("Space"); await expect(page.getByRole("dialog", { name: "术语解释", exact: true })).toBeVisible();
});
