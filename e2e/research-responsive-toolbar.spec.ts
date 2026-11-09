import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createResearchNote } from "../src/domain/researchNotebook.ts";

async function openNote(page: Page, foundation = false, reviewedAt?: string) {
  const state = createResearchNotebook();
  state.notes = [
    { ...createResearchNote("导航栏可用空间测试"), id: "toolbar-source", ...(foundation ? { library: "foundation" as const } : {}), tags: ["模型/控制"], blocks: [
      { id: "toolbar-heading", type: "heading", level: 2, text: "主要说明" },
      { id: "toolbar-body", type: "paragraph", text: "正文内容。[参考笔记](#research-note/toolbar-reference)。" },
    ], ...(reviewedAt ? { reviewedAt, reviewStatus: "reviewed" as const } : {}) },
    { ...createResearchNote("参考笔记"), id: "toolbar-reference", blocks: [{ id: "toolbar-reference-body", type: "paragraph", text: "参考内容。" }] },
  ];
  state.activeNoteId = "toolbar-source"; state.view = foundation ? "foundations" : "notes"; state.open = true;
  await page.addInitScript(state => {
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "false");
  }, state);
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/?page=research-notebook");
  const panel = page.getByTestId("research-notebook");
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("导航栏可用空间测试");
  return { panel, header: panel.getByRole("toolbar", { name: "笔记管理", exact: true }) };
}

async function expectCompact(header: Locator) {
  await expect(header).toHaveClass(/is-compact/);
  await expect(header.getByRole("button")).toHaveCount(3);
  const left = header.locator(".research-notebook-sidebar-toggle"), more = header.getByRole("button", { name: "更多笔记功能", exact: true }), right = header.locator(".research-outline-toggle");
  for (const control of [left, more, right]) await expect(control).toBeInViewport();
  const bounds = (await header.boundingBox())!, title = (await header.getByLabel("笔记标题", { exact: true }).boundingBox())!;
  expect(title.width).toBeGreaterThan(0);
  expect((await left.boundingBox())!.x + (await left.boundingBox())!.width).toBeLessThanOrEqual(title.x);
  expect(title.x + title.width).toBeLessThanOrEqual((await more.boundingBox())!.x);
  expect((await right.boundingBox())!.x + (await right.boundingBox())!.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await more.click();
  const menu = header.getByRole("menu", { name: "更多笔记功能", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /左侧面板|文章大纲|变量配方|反向链接/ })).toHaveCount(0);
  for (const label of ["管理笔记标签", "笔记元数据", "切换为编辑模式", "使用手册", "导入 Markdown", "导出 Markdown"])
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  return { more, menu };
}

let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on("pageerror", error => errors.push(error.message)); });
test.afterEach(() => { expect(errors).toEqual([]); });

test("collects tools as the center narrows without references and restores them when space returns", async ({ page }, info) => {
  const { panel, header } = await openNote(page);
  await expect(header.getByRole("button", { name: "切换为编辑模式", exact: true })).toBeVisible();
  const initial = await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"));
  const separator = panel.getByRole("separator", { name: "调整左侧栏宽度", exact: true });
  await separator.focus(); await separator.press("End");
  expect(page.viewportSize()!.width).toBe(1440);
  const { menu } = await expectCompact(header);
  await menu.getByRole("menuitem", { name: "笔记元数据", exact: true }).click();
  await expect(panel.getByRole("dialog", { name: "笔记元数据", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(header.getByRole("button", { name: "更多笔记功能", exact: true })).toBeFocused();
  await panel.screenshot({ path: info.outputPath("responsive-toolbar-desktop.png") });
  await header.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await expect(header).not.toHaveClass(/is-compact/);
  await expect(header.getByRole("button", { name: "切换为编辑模式", exact: true })).toBeVisible();
  await header.getByRole("button", { name: "展开笔记左侧面板", exact: true }).click();
  await expect(header).toHaveClass(/is-compact/);
  await header.getByRole("button", { name: "收起文章大纲", exact: true }).click();
  await expect(header).not.toHaveClass(/is-compact/);
  await header.getByRole("button", { name: "展开文章大纲", exact: true }).click();
  await expect(header).toHaveClass(/is-compact/);
  expect(await page.evaluate(() => localStorage.getItem("mewiki:research-notebook"))).toBe(initial);
});

test("keeps both panel switches outside the split-reading menu", async ({ page }) => {
  const { header, panel } = await openNote(page);
  await panel.getByRole("link", { name: "参考笔记", exact: true }).click();
  await expectCompact(header);
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await expect(header.getByRole("button", { name: "展开笔记左侧面板", exact: true })).toBeVisible();
  await header.getByRole("button", { name: "收起文章大纲", exact: true }).click();
  await expect(header.getByRole("button", { name: "展开文章大纲", exact: true })).toBeVisible();
});

test("collects foundation actions on a phone and preserves menu keyboard behavior", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, header } = await openNote(page, true);
  const { more, menu } = await expectCompact(header);
  await expect(menu.getByRole("menuitem", { name: "展开条件与结论", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(more).toBeFocused();
  await more.press("ArrowDown");
  await menu.getByRole("menuitem", { name: "切换为编辑模式", exact: true }).click();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toBeEditable();
  await expect(more).toBeFocused();
  await more.click();
  await expect(menu.getByRole("menuitem", { name: "切换为只读模式", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "批量选择内容块", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: "收起文章大纲", exact: true }).click();
  await header.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  await expect(header.getByRole("button", { name: "展开文章大纲", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "展开笔记左侧面板", exact: true })).toBeVisible();
  await expect(header).toHaveClass(/is-compact/);
  await panel.screenshot({ path: info.outputPath("responsive-toolbar-mobile.png") });
});

test("keeps full-size actions visible and grouped against the right controls across foundation pane widths", async ({ page }, info) => {
  const { header } = await openNote(page, true);
  await header.getByRole("button", { name: "切换为编辑模式", exact: true }).click();
  await header.getByRole("button", { name: "批量选择内容块", exact: true }).click();
  for (const width of [1260, 1300, 1360, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(() => header.evaluate(header => [...header.querySelectorAll<HTMLElement>(".research-page-tools, .research-notebook-window-controls")]
      .every(group => group.scrollWidth <= group.clientWidth))).toBe(true);
    expect(await header.evaluate(header => [...header.querySelectorAll<HTMLButtonElement>("button:not(.research-note-tag)")].filter(button => {
      const bounds = button.getBoundingClientRect();
      return ![bounds.left + 2, bounds.right - 2].every(x => button.contains(document.elementFromPoint(x, bounds.top + bounds.height / 2)));
    }).map(button => button.getAttribute("aria-label")))).toEqual([]);
  }
  await header.getByRole("button", { name: "批量选择内容块", exact: true }).click();
  await header.getByRole("button", { name: "收起文章大纲", exact: true }).click();
  await header.getByRole("button", { name: "收起笔记左侧面板", exact: true }).click();
  for (const width of [1057, 1160, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(async () => {
      const tools = (await header.locator(".research-page-tool-actions").boundingBox())!;
      const controls = (await header.locator(".research-notebook-actions").boundingBox())!;
      return controls.x - tools.x - tools.width;
    }).toBeLessThanOrEqual(8);
  }
  await page.setViewportSize({ width: 1057, height: 960 });
  await header.screenshot({ path: info.outputPath("toolbar-right-alignment.png") });
});

test("preserves a metadata draft and focus while collecting and restoring its toolbar entry", async ({ page }) => {
  const { panel, header } = await openNote(page);
  await header.getByRole("button", { name: "切换为编辑模式", exact: true }).click();
  await header.getByRole("button", { name: "笔记元数据", exact: true }).click();
  const metadata = panel.getByRole("dialog", { name: "笔记元数据", exact: true });
  await metadata.getByRole("button", { name: "编辑元数据", exact: true }).click();
  const input = metadata.getByLabel("元数据标题", { exact: true });
  await input.fill("缩放过程中保留的标题草稿");
  await page.setViewportSize({ width: 1160, height: 960 });
  await expect(header).toHaveClass(/is-compact/);
  await expect(input).toHaveValue("缩放过程中保留的标题草稿");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(header).not.toHaveClass(/is-compact/);
  await expect(input).toHaveValue("缩放过程中保留的标题草稿");
  await metadata.getByRole("button", { name: "保存元数据", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(header.getByRole("button", { name: "笔记元数据", exact: true })).toBeFocused();
  await expect(header.getByLabel("笔记标题", { exact: true })).toHaveValue("缩放过程中保留的标题草稿");
});

test("keeps reviewed-note controls outside the title near the compact threshold", async ({ page }) => {
  const { header } = await openNote(page, true, "2026-01-01T00:00:00.000Z");
  await header.getByRole("button", { name: "切换为编辑模式", exact: true }).click();
  await header.getByRole("button", { name: "批量选择内容块", exact: true }).click();
  for (const width of [1240, 1260, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    await expect.poll(() => header.evaluate(element => {
      const leading = element.querySelector<HTMLElement>(".research-note-header-leading")!.getBoundingClientRect();
      const title = element.querySelector<HTMLElement>(".research-note-title")!.getBoundingClientRect();
      const actions = element.querySelector<HTMLElement>(".research-note-header-actions")!.getBoundingClientRect();
      return title.width > 0 && leading.right <= title.left && title.right <= actions.left;
    })).toBe(true);
  }
});
