import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";

async function openEditor(page: Page) {
  const state = createNotebookFixture();
  state.terms = [{
    id: "term-editor-example", name: "状态失配均方误差", englishName: "State-mismatch mean-square error", englishAbbreviation: "SM-MSE", chineseAbbreviation: "失配均误",
    aliases: ["状态失配均方值", "失配误差均值"], meaning: "真实状态与陈旧状态之差的平方均值，用于描述状态估计中的失配程度。",
    scope: "用于状态估计与调度策略比较；定义必须同时说明参考状态、时间范围及期望的取值方式。", tags: ["术语/机制与调度"], status: "active",
    atoms: [{ id: "atom-state", text: "状态失配", meaning: "真实状态与参考状态之间的差异。" }, { id: "atom-error", text: "均方误差", meaning: "误差平方的均值。" }],
  }];
  state.activeTermId = "term-editor-example"; state.view = "dictionary"; state.open = true;
  state.notes = [{ ...createResearchNote("术语填写预览"), id: "term-editor-preview", blocks: [{ id: "term-editor-reference", type: "paragraph", text: "[状态失配均方误差](mewiki-term:term-editor-example)" }] }];
  state.activeNoteId = "term-editor-preview";
  await page.addInitScript(value => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(value));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "编辑术语", exact: true }).click();
  return page.getByRole("region", { name: "术语词条编辑器", exact: true });
}

test("uses the available pane width and keeps the draft while the term form adapts", async ({ page }, info) => {
  await page.setViewportSize({ width: 1873, height: 1000 });
  const editor = await openEditor(page);
  await page.keyboard.press("Tab");
  for (const control of [editor.getByLabel("术语英文缩写", { exact: true }), editor.getByLabel("术语适用范围", { exact: true })]) {
    const border = await control.evaluate(element => getComputedStyle(element).borderColor);
    await control.focus();
    await expect(control).toHaveCSS("outline-style", "auto");
    await expect(control).toHaveCSS("outline-offset", "0px");
    await expect(control).toHaveCSS("border-color", border);
    await expect(control).toHaveCSS("box-shadow", "none");
  }
  const paneBox = await editor.boundingBox();
  const formBox = await editor.locator(".research-term-editor").boundingBox();
  expect(formBox!.width / paneBox!.width).toBeGreaterThan(0.9);
  const names = editor.getByRole("region", { name: "命名与引用", exact: true });
  const meanings = editor.getByRole("region", { name: "含义与使用", exact: true });
  const namesBox = await names.boundingBox();
  const meaningsBox = await meanings.boundingBox();
  expect(Math.abs(namesBox!.y - meaningsBox!.y)).toBeLessThan(2);
  expect(meaningsBox!.x).toBeGreaterThanOrEqual(namesBox!.x + namesBox!.width);
  await editor.getByLabel("术语英文缩写", { exact: true }).fill("SMSE");
  await expect(editor.getByLabel("规范引用预览", { exact: true })).toHaveText("状态失配均方误差（State-mismatch mean-square error, SMSE）");
  await page.screenshot({ path: info.outputPath("term-editor-desktop.png") });
  await page.setViewportSize({ width: 1024, height: 900 });
  const narrowNamesBox = await names.boundingBox();
  const narrowMeaningsBox = await meanings.boundingBox();
  expect(narrowMeaningsBox!.y).toBeGreaterThanOrEqual(narrowNamesBox!.y + narrowNamesBox!.height);
  await expect(editor.getByLabel("术语英文缩写", { exact: true })).toHaveValue("SMSE");
  await editor.getByRole("button", { name: "取消编辑", exact: true }).click();
  await page.getByRole("button", { name: "编辑术语", exact: true }).click();
  await expect(editor.getByLabel("术语英文缩写", { exact: true })).toHaveValue("SM-MSE");
});

test("fills long definitions, aliases and ordered atoms on a phone without horizontal overflow", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await openEditor(page);
  await page.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  const longScope = ["场景一：状态估计与调度比较。", "场景二：陈旧状态与真实状态之间的差异。", "边界条件：" + "定义应说明时间范围与期望。".repeat(8)].join("\n");
  await editor.getByLabel("术语适用范围", { exact: true }).fill(longScope);
  expect(await editor.getByLabel("术语适用范围", { exact: true }).evaluate(element => element.tagName)).toBe("TEXTAREA");
  await editor.getByRole("button", { name: "新增别名", exact: true }).click();
  await editor.getByLabel("别名 3", { exact: true }).fill("SM-MSE, legacy");
  await editor.getByRole("button", { name: "新增原子词汇", exact: true }).click();
  await editor.getByLabel("原子词汇 3 名称", { exact: true }).fill("测试片段");
  await editor.getByRole("button", { name: "删除原子词汇 3", exact: true }).click();
  await editor.getByLabel("原子词汇 2 解释", { exact: true }).fill("更新后：误差平方的均值。");
  await editor.getByLabel("标记为已废弃术语", { exact: true }).check();
  const layout = await editor.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll("input, textarea, button")].map(control => control.getBoundingClientRect());
    return { overflow: element.scrollWidth - element.clientWidth, inside: controls.every(box => box.left >= bounds.left && box.right <= bounds.right + 1) };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.inside).toBe(true);
  await editor.getByLabel("术语名称", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("term-editor-phone-names.png") });
  await editor.getByRole("button", { name: "保存词条", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("term-editor-phone-atoms.png") });
  await editor.getByRole("button", { name: "保存词条", exact: true }).click();
  const detail = page.getByRole("region", { name: "术语词条详情", exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(longScope, { exact: true })).toHaveCSS("white-space", "pre-wrap");
  await page.getByRole("button", { name: "展开笔记左侧面板", exact: true }).click();
  await page.getByRole("tab", { name: "研究记录", exact: true }).click();
  await page.locator("#research-notebook-sidebar").getByRole("button", { name: "术语填写预览", exact: true }).click();
  await page.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await page.locator('[data-block-id="term-editor-reference"] .research-dictionary-term-reference').click();
  const popover = page.getByRole("dialog", { name: "术语解释", exact: true });
  await expect(popover.getByText(longScope, { exact: true })).toHaveCSS("white-space", "pre-wrap");
  await popover.getByRole("button", { name: "打开词典词条", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "编辑术语", exact: true }).click();
  await expect(editor.getByLabel("术语适用范围", { exact: true })).toHaveValue(longScope);
  await expect(editor.getByLabel("别名 3", { exact: true })).toHaveValue("SM-MSE, legacy");
  await expect(editor.getByLabel("原子词汇 2 解释", { exact: true })).toHaveValue("更新后：误差平方的均值。");
  await expect(editor.getByLabel("标记为已废弃术语", { exact: true })).toBeChecked();
});
