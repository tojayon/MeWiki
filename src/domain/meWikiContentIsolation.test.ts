import { describe, expect, it } from "vitest";
import { createResearchNotebook, normalizeResearchNotebook } from "./researchNotebook.ts";
import { normalizeSymbolEntries, type ResearchSymbolEntry } from "./researchDictionary.ts";
import { positionSlots, symbolPositionSuffix } from "./researchSymbolPositions.ts";
import { ensureTheoryMaps, getResearchTheoryMap } from "./researchTheoryMap.ts";

const stamp = "2025-01-01T00:00:00.000Z";
const symbol: ResearchSymbolEntry = { id: "my-variable", name: "自定义变量", notation: "q" + symbolPositionSuffix,
  meaning: "保留 $q^p(t)$ 的原始说明。", category: "custom", tags: ["个人/变量"], slots: positionSlots({ x1: "p", x3: "(t)" }) };
const note = { id: "saved-note", title: "我的资料", createdAt: stamp, updatedAt: stamp, tags: ["个人/记录"],
  blocks: [{ id: "saved-text", type: "paragraph", text: "保留 $q^p(t)$ 和原始文字。" },
    { id: "saved-formula", type: "formula", tex: "q^p(t)" }],
  theory: { annotations: [{ ref: { noteId: "saved-note" }, role: "foundation" }], relations: [
    { id: "saved-relation", source: { noteId: "missing-note", blockId: "missing-block" }, target: { noteId: "saved-note", blockId: "saved-formula" }, kind: "derivation", description: "原始来源" }
  ] } };

describe("public workspace content isolation", () => {
  it("creates only general examples in the core factory", () => {
    const state = createResearchNotebook();
    expect(state.notes.length).toBeGreaterThan(0);
    expect(state.symbols.map(entry => entry.id).sort()).toEqual(["example-a", "example-b", "example-x", "example-y"]);
    expect(JSON.stringify(state)).not.toMatch(/thesis-model|model-plant|model-controller|AutoPaper|博士论文|SM-MSE|地月/);
    expect(getResearchTheoryMap(ensureTheoryMaps(state)).topics.every(topic => !["control", "scheduling", "evaluation"].includes(topic.id))).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("reads version %i without injecting or rewriting research content", version => {
    const input = { version, open: true, view: "notes", activeNoteId: note.id, activeSymbolId: symbol.id,
      symbols: [symbol], notes: [note] };
    const next = normalizeResearchNotebook(input);
    expect(next.notes).toHaveLength(1);
    expect(next.notes[0].blocks).toEqual(note.blocks);
    expect(next.notes[0].theory).toEqual(note.theory);
    expect(next.notes[0].tags).toEqual(note.tags);
    expect(next.symbols).toEqual([symbol]);
    expect(next.activeNoteId).toBe(note.id);
    expect(normalizeResearchNotebook(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it("does not add missing examples to imported symbols or refill a deliberately empty notebook", () => {
    expect(normalizeSymbolEntries([])).toEqual([]);
    expect(normalizeSymbolEntries(undefined)).toEqual([]);
    const empty = normalizeResearchNotebook({ version: 8, notes: [], symbols: [] });
    expect(empty.notes).toEqual([]);
    expect(empty.symbols).toEqual([]);
    expect(empty.activeNoteId).toBe("");
  });

  it("creates independent examples for separate libraries", () => {
    const first = createResearchNotebook(), second = createResearchNotebook();
    const a = first.notes.flatMap(note => note.blocks).find(block => block.type === "formula" && block.parts)!;
    const b = second.notes.flatMap(note => note.blocks).find(block => block.id === a.id)!;
    if (a.type !== "formula" || b.type !== "formula") throw new Error("missing formula");
    expect(a.parts).not.toBe(b.parts);
    expect(a.parts?.[0]).not.toBe(b.parts?.[0]);
  });

  it("migrates named positions from saved templates, including nested formulas and declared outputs", () => {
    const legacy = { ...symbol, notation: "q^{[power]}_{[index]}([time])", slots: [
      { key: "power", label: "次数", defaultValue: "2", domain: "generic" },
      { key: "index", label: "序号", defaultValue: "i", domain: "generic" },
      { key: "time", label: "自变量", defaultValue: "t", domain: "time" }
    ] };
    const formula = { id: "nested-formula", type: "formula", tex: "q^3_j(s)",
      parts: [{ type: "symbol", entryId: symbol.id, bindings: { power: "3", index: "j", time: "s" } }],
      outputs: [{ id: "result", entryId: symbol.id, bindings: { power: "3", index: "j", time: "s" } }] };
    const state = normalizeResearchNotebook({ version: 2, symbols: [legacy], activeNoteId: note.id,
      notes: [{ ...note, blocks: [{ id: "tabs", type: "examples", tabs: [{ id: "tab", title: "例子", blocks: [formula] }] }] }] });
    expect(state.symbols[0].notation).toBe("q" + symbolPositionSuffix);
    expect(state.symbols[0].slots.map(slot => slot.defaultValue)).toEqual(["2", "i", "(t)"]);
    const nested = state.notes[0].blocks[0];
    expect(nested.type).toBe("examples");
    if (nested.type !== "examples") throw new Error("missing tabs");
    expect(nested.tabs[0].blocks[0]).toMatchObject({ id: "nested-formula", tex: "q^{3}_{j}(s)",
      parts: [{ bindings: { x1: "3", x2: "j", x3: "(s)" } }], outputs: [{ id: "result", bindings: { x1: "3", x2: "j", x3: "(s)" } }] });
  });

  it("preserves stored names, meaning, notation and maps even when IDs resemble earlier built-in entries", () => {
    const saved = { ...symbol, id: "latest-update-generation", notation: "u" + symbolPositionSuffix };
    const state = normalizeResearchNotebook({ version: 8, modelLibraryVersion: 3, symbols: [saved], notes: [{ ...note, id: "model-plant", tags: [] }] });
    expect(state.symbols).toEqual([saved]);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]).toMatchObject({ id: "model-plant", tags: [], blocks: note.blocks, theory: note.theory });
    expect(state.modelLibraryVersion).toBe(3);
  });

  it.each(["toString", "constructor"])("preserves saved formulas with a %s symbol ID", entryId => {
    const formula = { id: "special-id", type: "formula", tex: "q^p(t)",
      parts: [{ type: "symbol", entryId, bindings: { old: "v" } }] };
    const state = normalizeResearchNotebook({ version: 2, symbols: [{ ...symbol, id: entryId }],
      notes: [{ ...note, blocks: [formula] }] });
    expect(state.notes[0].blocks[0]).toEqual(formula);
  });

  it("preserves cached formulas and named bindings when their symbol definition is missing", () => {
    const formula = { id: "missing-definition", type: "formula", tex: "r_j",
      parts: [{ type: "symbol", entryId: "state-reception", bindings: { packet: "j" } }],
      outputs: [{ id: "missing-output", entryId: "state-reception", bindings: { packet: "j" } }] };
    const state = normalizeResearchNotebook({ version: 2, symbols: [], notes: [{ ...note, blocks: [formula] }] });
    expect(state.symbols).toEqual([]);
    expect(state.notes[0].blocks[0]).toEqual(formula);
    expect(normalizeResearchNotebook(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("keeps cached TeX when a migrated formula also contains an unresolved symbol", () => {
    const saved = { ...symbol, notation: "q^{[power]}", slots: [
      { key: "power", label: "次数", defaultValue: "2", domain: "generic" }
    ] };
    const formula = { id: "partly-resolved", type: "formula", tex: "q^3+r_j", parts: [
      { type: "symbol", entryId: symbol.id, bindings: { power: "3" } },
      { type: "operator", operator: "plus" },
      { type: "symbol", entryId: "missing-symbol", bindings: { packet: "j" } }
    ] };
    const state = normalizeResearchNotebook({ version: 2, symbols: [saved], notes: [{ ...note, blocks: [formula] }] });
    expect(state.notes[0].blocks[0]).toMatchObject({ tex: formula.tex, parts: [
      { bindings: { x1: "3", x2: "", x3: "" } }, formula.parts[1], formula.parts[2]
    ] });
    expect(normalizeResearchNotebook(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});
