import { expect, test, type Locator, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";

const text = "**数据采样与发送（A）**：传感节点 $v_T$ 中的传感器 $S$ 按固定周期 $T_s$ 对对象 $P$ 进行测量，获得样本生成时刻 $s_g$ 的采样状态 $x(s_g)$，并将其与原始时间戳 $s_g$、环境标识 $p_g$ 等元数据封装为状态数据包。经阶段 A 发送至中继节点，随后选择满足 $U_k \\subseteq Q_k$ 和 $|U_k| \\leq c_k$ 的数据包。";

async function openNote(page: Page, documentSize: number) {
  const state = createNotebookFixture();
  const formulas = [...new Set([...text.matchAll(/\$([^$]+)\$/g)].map(match => match[1]))];
  state.symbols = formulas.map((tex, index) => createSymbolEntry({ name: `示例记号 ${index + 1}`, notation: tex, meaning: "用于排版间距核对的虚构符号。", category: "custom", slots: [] }, `spacing-symbol-${index}`));
  const references = text.replace(/\$([^$]+)\$/g, (source, tex) => `[${source}](mewiki-symbol:spacing-symbol-${formulas.indexOf(tex)})`);
  state.notes = [{ ...createResearchNote("排版间距核对"), id: "spacing-note", blocks: [
    { id: "spacing-paragraph", type: "paragraph", text },
    { id: "spacing-ordered", type: "markdown", kind: "orderedList", text: `1. ${text}\n2. **计算与转发（B）**：接收 $r_g$ 后，以 $u_h$ 表示输出，按 $h$ 次序记录。` },
    { id: "spacing-reference-paragraph", type: "paragraph", text: references },
    { id: "spacing-reference-ordered", type: "markdown", kind: "orderedList", text: `1. ${references}\n2. **计算与转发（B）**：保持其他文字排版。` },
  ] }];
  state.activeNoteId = "spacing-note"; state.open = true; state.view = "notes";
  await page.addInitScript(({ state, documentSize }) => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:library:default:font-sizes", JSON.stringify({ interface: 14, document: documentSize }));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-mode", "edit");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "true");
  }, { state, documentSize });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
}

async function geometry(block: Locator) {
  return block.evaluate(element => {
    const origin = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const letters: { text: string; x: number; y: number; width: number; height: number }[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(".katex, button, .research-text-view-toggle")) continue;
      for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
        const value = node.textContent![i];
        if (/\s/.test(value)) continue;
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        letters.push({ text: value, x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height });
      }
    }
    const math = [...element.querySelectorAll<HTMLElement>(".katex")].map(formula => {
      const rect = formula.getBoundingClientRect();
      return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height, fontSize: getComputedStyle(formula).fontSize };
    });
    return { left: origin.x, width: origin.width, letters, math };
  });
}

for (const width of [1863, 390]) for (const documentSize of [15, 20]) test(`keeps every text and inline math position when focusing dense prose at ${width}px with ${documentSize}px text`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 972 }); await openNote(page, documentSize);
  for (const id of ["spacing-paragraph", "spacing-ordered", "spacing-reference-paragraph", "spacing-reference-ordered"]) {
    const block = page.locator(`[data-block-id="${id}"] .research-editable-text`);
    await block.scrollIntoViewIfNeeded();
    const before = await geometry(block);
    if (id === "spacing-reference-ordered") await block.screenshot({ path: info.outputPath("symbols-before-focus.png") });
    await block.locator("strong").first().click({ position: { x: 4, y: 8 } });
    const editor = block.locator('[contenteditable="true"]'); await expect(editor).toBeFocused();
    await expect(editor.locator(".katex")).toHaveCount(before.math.length);
    const during = await geometry(block);
    if (id === "spacing-reference-ordered") await block.screenshot({ path: info.outputPath("symbols-during-focus.png") });
    await info.attach(`${id}-geometry.json`, { body: JSON.stringify({ before, during }, null, 2), contentType: "application/json" });
    expect(during.left).toBe(before.left); expect(during.width).toBe(before.width);
    expect(during.math.map(formula => formula.fontSize)).toEqual(before.math.map(formula => formula.fontSize));
    expect(during.letters.map(letter => letter.text)).toEqual(before.letters.map(letter => letter.text));
    for (const kind of ["letters", "math"] as const) {
      expect(during[kind]).toHaveLength(before[kind].length);
      for (let i = 0; i < before[kind].length; i++) for (const axis of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(during[kind][i][axis] - before[kind][i][axis]), `${id}: ${kind} ${i} ${axis}`).toBeLessThanOrEqual(.1);
      }
    }
    await editor.press("Escape");
    expect(await geometry(block)).toEqual(before);
  }
});
