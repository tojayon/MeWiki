import { expect, test, type Page } from "@playwright/test";
import { createNotebookFixture } from "../src/domain/testUtils/notebook.ts";
import { createResearchNote } from "../src/domain/researchNotebook.ts";
import { createSymbolEntry } from "../src/domain/researchDictionary.ts";
import { ensureTheoryMaps } from "../src/domain/researchTheoryMap.ts";
import { enableNotebookEditing } from "./helpers/researchNotebook.ts";

async function openWorkspace(page: Page) {
  const state = createNotebookFixture();
  state.notes = ["foundation", "research"].flatMap(library =>
    Array.from({ length: 45 }, (_, index) => ({
      ...createResearchNote(`${library === "foundation" ? "理论" : "记录"} ${String(index).padStart(2, "0")}`),
      id: `${library}-${index}`, library: library as "foundation" | "research", tags: ["滚动示例/通用"],
      blocks: [{ id: `${library}-text-${index}`, type: "paragraph" as const, text: "仅用于左栏滚动检查的通用示例。" }],
    })),
  );
  state.symbols = Array.from({ length: 45 }, (_, index) => createSymbolEntry({
    name: `符号 ${String(index).padStart(2, "0")}`, notation: "x", meaning: "滚动检查示例", tags: ["滚动示例/通用"], slots: [],
  }, `scroll-symbol-${index}`));
  state.terms = Array.from({ length: 45 }, (_, index) => ({
    id: `scroll-term-${index}`, name: `术语 ${String(index).padStart(2, "0")}`, aliases: [],
    meaning: "仅用于术语列表检查的通用示例。", tags: ["滚动示例/通用"],
  }));
  state.activeNoteId = "research-0";
  state.activeSymbolId = "scroll-symbol-0";
  state.view = "notes";
  state.open = true;
  state.librarySelections = { foundation: "foundation-0", research: "research-0" };
  const maps = ensureTheoryMaps(state).theoryMaps!;
  const template = maps.documents[0];
  state.theoryMaps = { ...maps, activeMapId: "scroll-map-0", documents: [
    ...maps.documents.filter(document => document.kind === "global"),
    ...Array.from({ length: 45 }, (_, index) => ({ ...template, id: `scroll-map-${index}`, kind: "topic" as const, title: `地图 ${String(index).padStart(2, "0")}`, noteIds: [] })),
  ] };
  await page.addInitScript(state => {
    if (!localStorage.getItem("mewiki:research-notebook")) localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    localStorage.setItem("mewiki:locale", "zh-CN");
    localStorage.setItem("mewiki:research-notebook-mode", "read");
    localStorage.setItem("mewiki:research-notebook-sidebar-collapsed", "false");
    localStorage.setItem("mewiki:research-notebook-outline-collapsed", "true");
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: "default", name: "默认资料库", directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto("/");
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 00");
}

test("shows five icon tabs and keeps both dictionary toolbars on one row", async ({ page }, info) => {
  await openWorkspace(page);
  const navigation = page.getByRole("tablist", { name: "科研笔记视图", exact: true });
  const names = ["符号", "术语", "基础理论", "研究记录", "理论地图"];
  await expect(navigation.getByRole("tab")).toHaveCount(5);
  for (const name of names) {
    const tab = navigation.getByRole("tab", { name, exact: true });
    await expect(tab).toHaveAttribute("title", name);
    await expect(tab).toHaveText("");
    await expect(tab.locator("svg")).toBeVisible();
  }
  for (const viewport of [{ width: 1440, height: 800 }, { width: 720, height: 600 }, { width: 390, height: 680 }]) {
    await page.setViewportSize(viewport);
    for (const kind of ["符号", "术语"]) {
      await navigation.getByRole("tab", { name: kind, exact: true }).click();
      const sidebar = page.locator(kind === "符号" ? "#research-dictionary-sidebar" : "#research-term-dictionary-sidebar");
      const search = sidebar.getByLabel(`搜索${kind}词条`, { exact: true });
      const tag = sidebar.getByRole("combobox");
      const clear = sidebar.getByRole("button", { name: `清除${kind}筛选`, exact: true });
      const create = sidebar.getByRole("button", { name: `新建${kind}词条`, exact: true });
      const controls = [search, tag, clear, create];
      const bounds = (await sidebar.boundingBox())!;
      const boxes = await Promise.all(controls.map(control => control.boundingBox()));
      expect(boxes.every(box => box && box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width)).toBe(true);
      expect(Math.max(...boxes.map(box => box!.y + box!.height / 2)) - Math.min(...boxes.map(box => box!.y + box!.height / 2))).toBeLessThan(2);
      expect((await search.boundingBox())!.width).toBeGreaterThan(30);
      await tag.selectOption("滚动示例/通用");
      await search.fill(`${kind} 44`);
      await expect(sidebar.getByRole("button", { name: `${kind} 44`, exact: true })).toBeVisible();
      await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 00");
      await clear.click();
      await expect(search).toHaveValue("");
      await expect(tag).toHaveValue("");
      expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`five-tabs-${viewport.width}.png`) });
  }
});

test("right-aligns dictionary text and makes long and tall symbol previews fully readable", async ({ page }, info) => {
  await openWorkspace(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    const notations = [String.raw`\widehat{\boldsymbol{x}}^{(p)}_{g_h}(t_{k+1})`,
      String.raw`\frac{\displaystyle\sum_{i=1}^{n} x_i}{1+\sqrt{1+z^2}}`,
      String.raw`\operatorname{VeryLongSymbolNameWithSeveralIndices}_{i,j,k}^{(p+1)}(t_{k+1})`];
    state.symbols = state.symbols.slice(0, 3).map((symbol: object, index: number) => ({ ...symbol, notation: notations[index] }));
    state.terms = state.terms.slice(0, 3).map((term: object) => ({ ...term, englishName: "A long English term name" }));
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  });
  await page.reload();
  for (const viewport of [{ width: 1440, height: 800 }, { width: 390, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const kind of ["符号", "术语"]) {
      await page.getByRole("tab", { name: kind, exact: true }).click();
      const sidebar = page.locator(kind === "符号" ? "#research-dictionary-sidebar" : "#research-term-dictionary-sidebar");
      const rows = sidebar.locator("button[data-research-choice]");
      await expect(rows).toHaveCount(3);
      for (const row of await rows.all()) {
        const rowBox = (await row.boundingBox())!;
        const sidebarBox = (await sidebar.boundingBox())!;
        expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width + 1);
        const copy = row.locator(kind === "符号" ? ".research-symbol-entry-copy" : ".research-term-item-copy");
        await expect(copy).toHaveCSS("text-align", "right");
        expect(await copy.evaluate(element => Math.abs(element.getBoundingClientRect().right - element.parentElement!.getBoundingClientRect().right + 4))).toBeLessThan(2);
        await expect(copy.locator("strong")).toHaveCSS("font-weight", "700");
        if (kind === "符号") {
          const preview = row.locator(".research-symbol-entry-formula");
          const box = (await preview.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(Math.min(60, rowBox.width - 8) - 1);
          const math = (await preview.locator(".katex-html").boundingBox())!;
          expect(math.y).toBeGreaterThanOrEqual(box.y - 1);
          expect(math.y + math.height).toBeLessThanOrEqual(box.y + box.height + 1);
          if (math.width > box.width) {
            await expect(preview).toHaveCSS("overflow-x", "auto");
            await preview.evaluate(element => { element.scrollLeft = element.scrollWidth; });
            expect(await preview.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
            const end = (await preview.locator(".katex-html").boundingBox())!;
            expect(end.x + end.width).toBeLessThanOrEqual(box.x + box.width + 1);
          } else {
            expect(math.x).toBeGreaterThanOrEqual(box.x - 1);
            expect(math.x + math.width).toBeLessThanOrEqual(box.x + box.width + 1);
          }
        }
      }
      expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await sidebar.screenshot({ path: info.outputPath(`right-aligned-${kind}-${viewport.width}.png`) });
    }
  }
});

test("navigates icon tabs with the keyboard while retaining the open note", async ({ page }) => {
  await openWorkspace(page);
  const navigation = page.getByRole("tablist", { name: "科研笔记视图", exact: true });
  const notes = navigation.getByRole("tab", { name: "研究记录", exact: true });
  await notes.focus();
  await notes.press("Home");
  const symbols = navigation.getByRole("tab", { name: "符号", exact: true });
  await expect(symbols).toBeFocused();
  await symbols.press("ArrowRight");
  await expect(navigation.getByRole("tab", { name: "术语", exact: true })).toBeFocused();
  await expect(navigation.getByRole("tab", { name: "术语", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("搜索术语词条", { exact: true })).toBeVisible();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 00");
});

test("retains independent symbol and term searches and tag filters across tabs", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("tab", { name: "符号", exact: true }).click();
  await page.getByLabel("搜索符号词条", { exact: true }).fill("符号 01");
  await page.getByLabel("筛选符号层级标签", { exact: true }).selectOption("滚动示例/通用");
  await page.getByRole("tab", { name: "术语", exact: true }).click();
  await page.getByLabel("搜索术语词条", { exact: true }).fill("术语 02");
  await page.getByLabel("筛选术语标签", { exact: true }).selectOption("滚动示例");
  for (const tab of ["基础理论", "研究记录", "理论地图", "符号"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
  }
  await expect(page.getByLabel("搜索符号词条", { exact: true })).toHaveValue("符号 01");
  await expect(page.getByLabel("筛选符号层级标签", { exact: true })).toHaveValue("滚动示例/通用");
  await page.getByRole("tab", { name: "术语", exact: true }).click();
  await expect(page.getByLabel("搜索术语词条", { exact: true })).toHaveValue("术语 02");
  await expect(page.getByLabel("筛选术语标签", { exact: true })).toHaveValue("滚动示例");
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 00");
});

for (const original of ["符号", "术语"]) test(`opens the existing ${original} after creating the opposite dictionary draft from a note`, async ({ page }) => {
  await openWorkspace(page);
  if (original === "术语") {
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
      state.activeTermId = "scroll-term-0"; state.activeSymbolId = "";
      localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
    });
    await page.reload();
  }
  const opposite = original === "符号" ? "术语" : "符号";
  await page.getByRole("tab", { name: opposite, exact: true }).click();
  await page.getByRole("button", { name: `新建${opposite}词条`, exact: true }).click();
  await expect(page.getByRole("tab", { name: opposite, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: `${opposite}词条编辑器`, exact: true })).toBeVisible();
  await page.getByLabel(opposite === "符号" ? "符号词条名称" : "术语名称", { exact: true }).fill("未保存的草稿");
  await page.getByRole("tab", { name: original, exact: true }).click();
  await page.getByRole("button", { name: `${original} 00`, exact: true }).click();
  await expect(page.getByRole("region", { name: `${original}词条详情`, exact: true })).toBeVisible();
  await expect(page.locator(".research-symbol-title")).toHaveText(`${original} 00`);
  await expect(page.getByRole("tab", { name: original, exact: true })).toHaveAttribute("aria-selected", "true");
});

test("browses workspace tabs without replacing the open content until a list entry is chosen", async ({ page }) => {
  await openWorkspace(page);
  const title = page.getByLabel("笔记标题", { exact: true });
  for (const tab of ["基础理论", "符号", "术语", "理论地图", "研究记录"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(title).toBeVisible();
    await expect(title).toHaveValue("记录 00");
  }
  await page.getByRole("tab", { name: "基础理论", exact: true }).click();
  await page.locator("#research-notebook-sidebar").getByRole("button", { name: "理论 01", exact: true }).click();
  await expect(title).toHaveValue("理论 01");
  await page.getByRole("tab", { name: "研究记录", exact: true }).click();
  await expect(title).toHaveValue("理论 01");
  await page.locator("#research-notebook-sidebar").getByRole("button", { name: "记录 01", exact: true }).click();
  await expect(title).toHaveValue("记录 01");
  await page.getByRole("tab", { name: "符号", exact: true }).click();
  await expect(title).toHaveValue("记录 01");
  await page.getByRole("button", { name: "符号 01", exact: true }).click();
  await expect(page.getByRole("region", { name: "符号词条详情", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "理论地图", exact: true }).click();
  await expect(page.getByRole("region", { name: "符号词条详情", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开地图 地图 01", exact: true }).click();
  const map = page.getByRole("region", { name: "理论地图文档", exact: true });
  await expect(map).toBeVisible();
  await page.getByRole("tab", { name: "研究记录", exact: true }).click();
  await expect(map).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mewiki:research-notebook")!).view)).toBe("maps");
  await page.reload();
  await expect(map).toBeVisible();
  await expect(page.getByRole("tab", { name: "理论地图", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("filters the browsed note library without changing the open note or its library filters", async ({ page }) => {
  await openWorkspace(page);
  const title = page.getByLabel("笔记标题", { exact: true });
  const search = page.getByLabel("搜索研究笔记", { exact: true });
  await search.fill("记录 01");
  await page.getByRole("tab", { name: "基础理论", exact: true }).click();
  await expect(title).toHaveValue("记录 00");
  await expect(search).toHaveValue("");
  await search.fill("理论 02");
  await expect(page.locator("#research-notebook-sidebar").getByRole("button", { name: "理论 02", exact: true })).toBeVisible();
  await expect(title).toHaveValue("记录 00");
  await page.getByRole("tab", { name: "研究记录", exact: true }).click();
  await expect(search).toHaveValue("记录 01");
  await page.getByRole("tab", { name: "基础理论", exact: true }).click();
  await expect(search).toHaveValue("理论 02");
  await page.locator("#research-notebook-sidebar").getByRole("button", { name: "理论 02", exact: true }).click();
  await expect(title).toHaveValue("理论 02");
  await expect(search).toHaveValue("理论 02");
});

test("preserves the reading position and outline while browsing sidebar tabs", async ({ page }, info) => {
  await openWorkspace(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    state.notes.find((note: { id: string }) => note.id === "research-0").blocks = [
      { id: "reading-heading", type: "heading", level: 2, text: "阅读位置检查" },
      ...Array.from({ length: 35 }, (_, index) => ({ id: `reading-paragraph-${index}`, type: "paragraph", text: `第 ${index + 1} 段。` + "保留当前笔记的阅读位置。".repeat(35) })),
    ];
    localStorage.setItem("mewiki:research-notebook", JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole("button", { name: "展开文章大纲", exact: true }).click();
  const outline = page.getByRole("complementary", { name: "文章大纲", exact: true });
  const content = page.locator(".research-note-scroll");
  await expect(outline.getByRole("button", { name: /阅读位置检查/ })).toBeVisible();
  await content.evaluate(element => { element.scrollTop = 500; });
  const scrollTop = await content.evaluate(element => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  for (const tab of ["符号", "术语", "基础理论", "理论地图", "研究记录", "基础理论"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 00");
    await expect(outline).toBeVisible();
    expect(await content.evaluate(element => element.scrollTop)).toBe(scrollTop);
  }
  await page.screenshot({ path: info.outputPath("sidebar-browsing.png") });
});

test("keeps note edits when browsing other tabs and creates a note in the browsed library", async ({ page }) => {
  await openWorkspace(page);
  const panel = page.getByTestId("research-notebook");
  await enableNotebookEditing(panel);
  const block = panel.locator('[data-block-id="research-text-0"]');
  await block.getByRole("textbox", { name: "笔记段落", exact: true }).click();
  await block.locator('[contenteditable="true"]').fill("浏览其他标签页时保留的正文修改。");
  await panel.getByRole("tab", { name: "基础理论", exact: true }).click();
  await expect(panel.getByLabel("笔记标题", { exact: true })).toHaveValue("记录 00");
  await expect(block).toContainText("浏览其他标签页时保留的正文修改。");
  await panel.locator("#research-notebook-sidebar").getByRole("button", { name: "新建笔记", exact: true }).click();
  const title = panel.getByLabel("笔记标题", { exact: true });
  await expect(title).toHaveValue("");
  await title.fill("新建的基础理论");
  await title.press("Tab");
  await expect(panel.getByRole("tab", { name: "基础理论", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("mewiki:research-notebook")!);
    return { view: state.view, library: state.notes.find((note: { id: string }) => note.id === state.activeNoteId).library,
      original: state.notes.find((note: { id: string }) => note.id === "research-0").blocks[0].text };
  })).toEqual({ view: "foundations", library: "foundation", original: "浏览其他标签页时保留的正文修改。" });
});

for (const mode of [
  { name: "符号", sidebar: "#research-dictionary-sidebar", first: "符号 00", last: "符号 44", search: "搜索符号词条" },
  { name: "术语", sidebar: "#research-term-dictionary-sidebar", first: "术语 00", last: "术语 44", search: "搜索术语词条" },
  { name: "基础理论", sidebar: "#research-notebook-sidebar", first: "理论 00", last: "理论 44", search: "搜索研究笔记" },
  { name: "研究记录", sidebar: "#research-notebook-sidebar", first: "记录 00", last: "记录 44", search: "搜索研究笔记" },
  { name: "理论地图", sidebar: "#research-theory-sidebar", first: "打开地图 地图 00", last: "打开地图 地图 44", search: "搜索地图" },
]) {
  test(`scrolls ${mode.name} with the wheel while keeping search and footer in place`, async ({ page }, info) => {
    await openWorkspace(page);
    await page.getByRole("tab", { name: mode.name, exact: true }).click();
    const sidebar = page.locator(mode.sidebar);
    const first = sidebar.getByRole("button", { name: mode.first, exact: true });
    const last = sidebar.getByRole("button", { name: mode.last, exact: true });
    const search = sidebar.getByLabel(mode.search, { exact: true });
    const footer = page.getByRole("toolbar", { name: "页面设置", exact: true });
    for (const viewport of [{ width: 1440, height: 760 }, { width: 720, height: 500 }]) {
      await page.setViewportSize(viewport);
      await first.scrollIntoViewIfNeeded();
      const searchTop = (await search.boundingBox())!.y;
      const footerTop = (await footer.boundingBox())!.y;
      const bounds = (await sidebar.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width - 50, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 10000);
      await expect(last).toBeInViewport();
      expect((await search.boundingBox())!.y).toBe(searchTop);
      expect((await footer.boundingBox())!.y).toBe(footerTop);
      await expect(footer).toBeInViewport();
      await page.mouse.wheel(0, -10000);
      await expect(first).toBeInViewport();
    }
    if (mode.name !== "理论地图") {
      await first.focus();
      await first.press("End");
      await expect(last).toBeFocused();
      await expect(last).toBeInViewport();
      await last.press("Home");
      await expect(first).toBeFocused();
      await expect(first).toBeInViewport();
    }
    await sidebar.screenshot({ path: info.outputPath("sidebar-scroll.png") });
  });
}

test("focuses workspace and settings searches without extra rings and still filters results", async ({ page }, info) => {
  await openWorkspace(page);
  for (const mode of [
    { tab: "研究记录", search: "搜索研究笔记", query: "记录 44" },
    { tab: "符号", search: "搜索符号词条", query: "符号 44" },
    { tab: "术语", search: "搜索术语词条", query: "术语 44" },
    { tab: "理论地图", search: "搜索地图", query: "地图 44" },
  ]) {
    await page.getByRole("tab", { name: mode.tab, exact: true }).click();
    const input = page.getByLabel(mode.search, { exact: true });
    const border = await input.evaluate(element => getComputedStyle(element.parentElement!).borderColor);
    await input.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("box-shadow", "none");
    expect(await input.evaluate(element => getComputedStyle(element.parentElement!).outlineStyle)).toBe("none");
    expect(await input.evaluate(element => getComputedStyle(element.parentElement!).borderColor)).toBe(border);
    expect(await input.evaluate(element => getComputedStyle(element.parentElement!).boxShadow)).toBe("none");
    await input.fill(mode.query);
    await expect(input).toHaveValue(mode.query);
    const result = page.getByRole("button", { name: mode.tab === "理论地图" ? `打开地图 ${mode.query}` : mode.query, exact: true });
    await expect(result).toBeVisible();
    if (mode.tab === "研究记录") await page.screenshot({ path: info.outputPath("focused-search.png") });
    await input.fill("");
  }
  await page.getByRole("button", { name: "应用设置", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜索设置", exact: true });
  const border = await search.evaluate(element => getComputedStyle(element.parentElement!).borderColor);
  await search.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveCSS("outline-style", "none");
  expect(await search.evaluate(element => getComputedStyle(element.parentElement!).borderColor)).toBe(border);
  expect(await search.evaluate(element => getComputedStyle(element.parentElement!).boxShadow)).toBe("none");
  expect(await search.evaluate(element => getComputedStyle(element.parentElement!).outlineStyle)).toBe("none");
  await search.fill("语言");
  await expect(page.getByTestId("mewiki-settings-page").getByRole("button", { name: /界面语言/ })).toBeVisible();
});

test("keeps compact settings on the right and reserves account space beside the library switcher", async ({ page }, info) => {
  await openWorkspace(page);
  const footer = page.getByRole("toolbar", { name: "页面设置", exact: true });
  for (const viewport of [{ width: 1440, height: 760 }, { width: 390, height: 620 }]) {
    await page.setViewportSize(viewport);
    const settings = footer.getByRole("button", { name: "应用设置", exact: true });
    const library = footer.getByRole("button", { name: /当前资料库.*切换资料库/ });
    await expect(settings).toBeInViewport();
    await expect(library).toBeInViewport();
    const bounds = (await footer.boundingBox())!;
    const action = (await settings.boundingBox())!;
    expect(action.width).toBeLessThan(100);
    expect(bounds.x + bounds.width - action.x - action.width).toBeLessThanOrEqual(9);
    const slot = (await footer.locator(".research-sidebar-account-slot").boundingBox())!;
    expect(slot.width).toBeGreaterThanOrEqual(40);
    expect(slot.x + slot.width).toBeLessThanOrEqual((await library.boundingBox())!.x);
    expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await footer.screenshot({ path: info.outputPath("sidebar-footer.png") });
  await footer.getByRole("button", { name: "应用设置", exact: true }).click();
  await expect(page.getByTestId("mewiki-settings-page")).toBeVisible();
});
