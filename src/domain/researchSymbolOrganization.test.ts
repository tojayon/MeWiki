import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createSymbolEntry, normalizeSymbolEntries, updateSymbolEntry, type SymbolCategory } from "./researchDictionary.ts";
import { normalizeResearchNotebook } from "./researchNotebook.ts";
import {
  buildResearchSymbolTree,
  defaultResearchSymbolFilters,
  filterResearchSymbols,
  mergeResearchSymbolTags,
  normalizeSymbolFilters,
  setResearchSymbolTags,
} from "./researchSymbolOrganization.ts";

const symbol = (id: string, tags: string[], category: SymbolCategory = "control") => ({
  ...createSymbolEntry({ name: id, notation: id, meaning: `${id}的定义`, category, slots: [] }),
  id, tags,
});

describe("symbol dictionary tags", () => {
  it("normalizes paths and preserves deliberately cleared tags across migration", () => {
    const state = createResearchNotebook();
    const original = { ...state.symbols[0], category: "control" as const };
    const [migrated] = normalizeSymbolEntries([{ ...original, tags: undefined }]);
    expect(migrated.tags).toEqual(["模型/控制"]);
    expect(normalizeSymbolEntries([{ ...original, tags: [] }])[0].tags).toEqual([]);
    expect(normalizeSymbolEntries([{ ...original, tags: [" 模型 // 控制 / LQR ", "模型/控制/lqr", 7, " / "] }])[0].tags).toEqual(["模型/控制/LQR"]);
    expect(normalizeSymbolEntries([{ ...original, tags: "invalid" }])[0].tags).toEqual([]);
  });

  it("combines query and parent-path filtering and ignores retired category filters", () => {
    const entries = [symbol("增益", ["模型/控制/LQR"]), symbol("状态", ["模型/控制/状态"], "state"), symbol("相似", ["模型/控制器"]), symbol("空白", [])];
    const filters = { ...defaultResearchSymbolFilters, tag: "模型/控制" };
    expect(filterResearchSymbols(entries, filters).map(entry => entry.id)).toEqual(["增益", "状态"]);
    expect(filterResearchSymbols(entries, { ...filters, query: "lqr" }).map(entry => entry.id)).toEqual(["增益"]);
    expect(filterResearchSymbols(entries, { ...filters, query: "的定义" })).toHaveLength(2);
    expect(filterResearchSymbols(entries, normalizeSymbolFilters({ ...filters, category: "communication" })).map(entry => entry.id)).toEqual(["增益", "状态"]);
    expect(normalizeSymbolFilters({ query: 7, category: "control", tag: " 模型 / 控制 " })).toEqual({ query: "", tag: "模型/控制" });
    entries[0].slots[0] = { ...entries[0].slots[0], description: "专用于搜索的位置说明" };
    expect(filterResearchSymbols(entries, { ...defaultResearchSymbolFilters, query: "位置说明" }).map(entry => entry.id)).toEqual(["增益"]);
  });

  it("keeps direct symbols, descendants, multi-tag entries and untagged entries in their own cells", () => {
    const entries = [symbol("父级", ["模型"]), symbol("多入口", ["模型/控制/LQR", "模型/控制/稳定性", "评价/控制"]), symbol("未分类符号", [])];
    const tree = buildResearchSymbolTree(entries);
    const model = tree.find(branch => branch.path === "模型")!;
    expect(model.count).toBe(2);
    expect(model.items.map(entry => entry.id)).toEqual(["父级"]);
    expect(model.children[0].count).toBe(1);
    expect(model.children[0].children).toHaveLength(2);
    expect(tree.find(branch => branch.path === "")?.items[0].id).toBe("未分类符号");
    const filtered = buildResearchSymbolTree(entries, { ...defaultResearchSymbolFilters, tag: "模型/控制" });
    expect(filtered.map(branch => branch.path)).toEqual(["模型"]);
    expect(filtered[0].items).toEqual([]);
    expect(filtered[0].count).toBe(1);
  });

  it("changes only symbol tags without invalidating reviewed notes or symbol definitions", () => {
    const state = createResearchNotebook();
    state.notes = state.notes.map(note => ({ ...note, reviewStatus: "reviewed" }));
    const entry = state.symbols[0];
    const next = setResearchSymbolTags(state, entry.id, [" 模型 // 索引 ", "模型/索引"]);
    expect(next.symbols[0]).toEqual({ ...entry, tags: ["模型/索引"] });
    expect(next.notes).toBe(state.notes);
    expect(updateSymbolEntry(state, { ...entry, tags: ["整理/分类"] }).notes).toBe(state.notes);
    expect(setResearchSymbolTags(next, entry.id, ["模型/索引"])).toBe(next);
    expect(setResearchSymbolTags(next, "missing", [])).toBe(next);
  });

  it("retains tags and independent filters when normalizing a saved notebook", () => {
    const state = createResearchNotebook();
    state.symbols[0].tags = ["自用/索引"];
    state.symbols[1].tags = [];
    state.symbolFilters = { query: "自用", tag: "自用" };
    const saved = JSON.parse(JSON.stringify(state));
    saved.symbolFilters.category = "index";
    const restored = normalizeResearchNotebook(saved);
    expect(restored.symbols[0].tags).toEqual(["自用/索引"]);
    expect(restored.symbols[1].tags).toEqual([]);
    expect(restored.symbolFilters).toEqual(state.symbolFilters);
    expect(restored.noteFilters).toEqual(state.noteFilters);
  });

  it("applies only draft tag additions and removals to the latest tags from other windows", () => {
    expect(mergeResearchSymbolTags(["原分类", "其他窗口/新增"], ["原分类"], ["原分类"])).toEqual(["原分类", "其他窗口/新增"]);
    expect(mergeResearchSymbolTags(["其他窗口/新增"], ["原分类"], ["原分类", "草稿/新增"])).toEqual(["其他窗口/新增", "草稿/新增"]);
    expect(mergeResearchSymbolTags(["原分类", "其他窗口/新增", "共同/LQR"], ["原分类"], ["共同/lqr"])).toEqual(["其他窗口/新增", "共同/LQR"]);
  });
});
