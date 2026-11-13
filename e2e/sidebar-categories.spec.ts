import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";

const modes = [
  { tab: "符号", sidebar: "#research-dictionary-sidebar", search: "搜索符号词条", first: "符号 0" },
  { tab: "术语", sidebar: "#research-term-dictionary-sidebar", search: "搜索术语词条", first: "术语 0" },
  { tab: "基础理论", sidebar: "#research-notebook-sidebar", search: "搜索研究笔记", first: "理论 0" },
  { tab: "研究记录", sidebar: "#research-notebook-sidebar", search: "搜索研究笔记", first: "记录 0" },
];

async function openWorkspace(page: Page, tags = [["模型/调度/队列"], ["模型/状态"], ["模型"], ["评价"], []]) {
  const state = createNotebookFixture();
  state.notes = ["foundation", "research"].flatMap(library => tags.map((tags, index) => ({
    ...createResearchNote(`${library === "foundation" ? "理论" : "记录"} ${index}`),
    id: `${library}-${index}`, library: library as "foundation" | "research", tags,
  })));
  state.symbols = tags.map((tags, index) => createSymbolEntry({ name: `符号 ${index}`, notation: "x", meaning: "分类示例", slots: [], tags }, `symbol-${index}`));
  state.terms = tags.map((tags, index) => ({ id: `term-${index}`, name: `术语 ${index}`, aliases: [], meaning: "分类示例", tags }));
  state.activeNoteId = "research-0";
  state.activeSymbolId = "symbol-0";
  state.view = "notes";
  state.open = true;
  await page.addInitScript(state => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 0");
}

test("fills the sidebar edges and places one category toggle at the right of the search toolbar", async ({ page }, info) => {
  await openWorkspace(page);
  for (const viewport of [{ width: 1440, height: 800 }, { width: 390, height: 680 }]) {
    await page.setViewportSize(viewport);
    for (const mode of modes) {
      await page.getByRole("tab", { name: mode.tab, exact: true }).click();
      const sidebar = page.locator(mode.sidebar);
      const tree = sidebar.locator(".research-note-tree");
      const bounds = (await sidebar.boundingBox())!;
      const table = (await tree.boundingBox())!;
      expect(Math.abs(table.x - bounds.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(table.x + table.width - bounds.x - bounds.width)).toBeLessThanOrEqual(1);
      const tools = (await sidebar.locator(".research-note-list-tools, .research-dictionary-toolbar").boundingBox())!;
      expect(Math.abs(table.y - tools.y - tools.height)).toBeLessThanOrEqual(1);
      await expect(tree).toHaveCSS("border-radius", "0px");
      const toggle = sidebar.getByRole("button", { name: "全部折叠分类", exact: true });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveText("");
      const action = (await toggle.boundingBox())!;
      const search = (await sidebar.getByLabel(mode.search, { exact: true }).boundingBox())!;
      expect(action.x).toBeGreaterThan(search.x + search.width);
      expect(action.x + action.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(Math.abs(action.y + action.height / 2 - search.y - search.height / 2)).toBeLessThanOrEqual(1);
      await expect(sidebar.getByRole("button", { name: "查看已核对笔记", exact: true })).toHaveCount(0);
      await expect(sidebar.getByRole("progressbar", { name: "笔记核对进度", exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath(`categories-${viewport.width}.png`) });
  }
  await page.getByRole("tab", { name: "理论地图", exact: true }).click();
  await expect(page.getByRole("button", { name: /全部(折叠|展开)分类/ })).toHaveCount(0);
});

test("hides all entries while keeping every category visible and restores search folds separately", async ({ page }, info) => {
  await openWorkspace(page);
  for (const mode of modes) {
    await page.getByRole("tab", { name: mode.tab, exact: true }).click();
    const sidebar = page.locator(mode.sidebar);
    const collapse = page.getByRole("button", { name: "全部折叠分类", exact: true });
    const expand = page.getByRole("button", { name: "全部展开分类", exact: true });
    if (await expand.count()) await expand.click();
    await sidebar.getByRole("button", { name: "收起标签 模型/调度", exact: true }).click();
    await collapse.click();
    await expect(sidebar.locator('.research-note-folder[aria-expanded="true"]')).toHaveCount(0);
    await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(0);
    await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(6);
    expect(await sidebar.locator('.research-note-tree-branch[data-tag-orientation="vertical"] > .research-note-folder .research-note-folder-label').evaluateAll(labels => labels.every(label => label.scrollHeight <= label.clientHeight + 1))).toBe(true);
    await expect(sidebar.getByRole("button", { name: "展开标签 模型/调度", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: mode.first, exact: true })).toBeHidden();
    await sidebar.getByRole("button", { name: "展开标签 模型/调度", exact: true }).click();
    await expect(sidebar.getByRole("button", { name: mode.first, exact: true })).toBeVisible();
    await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(1);
    await collapse.click();
    await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(6);
    await page.setViewportSize({ width: 390, height: 680 });
    await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(6);
    await sidebar.screenshot({ path: info.outputPath(`labels-only-${mode.tab}.png`) });
    const search = sidebar.getByLabel(mode.search, { exact: true });
    await search.fill(mode.first);
    await expect(sidebar.getByRole("button", { name: mode.first, exact: true })).toBeVisible();
    await collapse.click();
    await expect(sidebar.getByRole("button", { name: mode.first, exact: true })).toBeHidden();
    await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(3);
    await expand.click();
    await expect(sidebar.getByRole("button", { name: mode.first, exact: true })).toBeVisible();
    await search.fill("没有匹配的内容");
    await expect(expand).toBeDisabled();
    await search.fill("");
    await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(0);
    await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(6);
    await expand.focus();
    await expand.press("Enter");
    await expect(sidebar.locator('.research-note-folder[aria-expanded="false"]')).toHaveCount(0);
    await collapse.press("Space");
    await expect(expand).toBeFocused();
    await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "全部展开分类", exact: true })).toBeVisible();
  await expect(page.locator("#research-notebook-sidebar [data-research-choice]:visible")).toHaveCount(0);
  await expect(page.locator("#research-notebook-sidebar .research-note-folder:visible")).toHaveCount(6);
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 0");
});

test("keeps saved parent folds compatible while revealing the complete tag hierarchy", async ({ page }) => {
  await openWorkspace(page);
  await page.evaluate(() => {
    localStorage.setItem("mewiki:research-note-tree-folds", JSON.stringify(["tag:模型"]));
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.noteFilters = { query: "记录 0", status: "all", tag: "" };
    state.notes.find((note: { id: string }) => note.id === "foundation-1").tags = ["模型/基础专用"];
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  });
  await page.reload();
  const sidebar = page.locator("#research-notebook-sidebar");
  await sidebar.getByLabel("搜索研究笔记", { exact: true }).fill("");
  await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(6);
  await expect(sidebar.getByRole("button", { name: "记录 0", exact: true })).toBeHidden();
  await expect(sidebar.getByRole("button", { name: "记录 1", exact: true })).toBeHidden();
  await expect(sidebar.getByRole("button", { name: "记录 2", exact: true })).toBeHidden();
  await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(2);
  await sidebar.getByRole("button", { name: "展开标签 模型/调度", exact: true }).click();
  await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(3);
  await page.reload();
  await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(6);
  await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(3);
  await expect(sidebar.getByRole("button", { name: "记录 2", exact: true })).toBeHidden();
  await sidebar.getByRole("button", { name: "收起标签 模型", exact: true }).click();
  await sidebar.getByRole("button", { name: "展开标签 模型", exact: true }).click();
  await expect(sidebar.locator("[data-research-choice]:visible")).toHaveCount(5);
  await page.getByRole("button", { name: "全部折叠分类", exact: true }).click();
  await page.getByRole("tab", { name: "基础理论", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "展开标签 模型/基础专用", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "理论 1", exact: true })).toBeHidden();
});

test("stretches descendant category cells to fill tall parent labels without white gaps", async ({ page }, info) => {
  await openWorkspace(page, [
    ["控制/控制器分类"], ["控制/线性系统/离散时间"], ["控制/线性系统/连续时间"], ["控制/状态反馈"], ["控制/LQR"],
    ["复杂控制系统及其设计方法/系统/状态"], ["复杂控制系统及其设计方法/系统/输入"], ["复杂控制系统及其设计方法/输出"],
    ["单链路层级测试/中间控制系统层级/末级分类"], [],
  ]);
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 680 }]) {
    await page.setViewportSize(viewport);
    for (const mode of modes) {
      await page.getByRole("tab", { name: mode.tab, exact: true }).click();
      const sidebar = page.locator(mode.sidebar);
      const expand = sidebar.getByRole("button", { name: "全部展开分类", exact: true });
      if (await expand.count()) await expand.click();
      for (const collapsed of [false, true]) {
        if (collapsed) await sidebar.getByRole("button", { name: "全部折叠分类", exact: true }).click();
        const gaps = await sidebar.locator(".research-note-tree-branch").evaluateAll(branches => branches.flatMap(branch => {
          const folder = branch.querySelector<HTMLElement>(":scope > .research-note-folder");
          const list = branch.querySelector<HTMLElement>(":scope > .research-note-tree-children:not([hidden])");
          if (!folder || !list || !list.getClientRects().length) return [];
          const rows = [...list.children].filter(row => row.getClientRects().length);
          if (!rows.length) return [];
          const cell = folder.getBoundingClientRect();
          const childList = list.getBoundingClientRect();
          const first = rows[0].getBoundingClientRect();
          const last = rows.at(-1)!.getBoundingClientRect();
          const differences = [cell.top - childList.top, cell.bottom - childList.bottom, childList.top - first.top, childList.bottom - last.bottom];
          return differences.some(gap => Math.abs(gap) > 1) ? [{ path: branch.getAttribute("data-tag-path"), differences }] : [];
        }));
        expect(gaps, `${mode.tab} / ${viewport.width}px / ${collapsed ? "collapsed" : "expanded"}`).toEqual([]);
        await expect(sidebar.locator(".research-note-folder:visible")).toHaveCount(16);
      }
      await sidebar.screenshot({ path: info.outputPath(`stretched-${mode.tab}-${viewport.width}.png`) });
    }
  }
});
