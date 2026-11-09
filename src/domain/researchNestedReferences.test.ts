import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { type ResearchNotebookBlock, type ResearchNotebookState } from "./researchNotebook.ts";
import {
  findResearchFormula,
  formulaMetadataError,
  formulaSourceError,
  listFormulaConsumers,
  listFormulaOutputs,
  researchFormulaTitle,
  resolveFormulaSource,
} from "./researchFormulaLinks.ts";
import {
  defaultResearchNoteFilters,
  filterResearchNotes,
  invalidateResearchReviews,
} from "./researchNoteOrganization.ts";
import { noteBasisIds } from "./researchNoteLibraries.ts";
import {
  buildResearchTheoryGraph,
  researchTheoryCatalogue,
  resolveTheoryReference,
  theoryReferenceKey,
} from "./researchTheoryMap.ts";
import { deleteSymbolEntry, listSymbolUses, updateSymbolEntry } from "./researchDictionary.ts";

const source = { noteId: "basis", formulaId: "gain", outputId: "result" };
const consumer = { noteId: "derivation", formulaId: "command" };
const examples = (id: string, blocks: ResearchNotebookBlock[]): ResearchNotebookBlock => ({
  id,
  type: "examples",
  tabs: [
    { id: id + ":visible", title: "默认示例", blocks: [] },
    { id: id + ":hidden", title: "边界算例", blocks },
  ],
});

function fixture(): ResearchNotebookState {
  const state = createResearchNotebook();
  const dates = { createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", reviewStatus: "reviewed" as const };
  return {
    ...state,
    activeNoteId: "derivation",
    notes: [
      {
        ...dates,
        id: "basis",
        title: "基础设计",
        library: "foundation",
        blocks: [
          { id: "overview", type: "formula", tex: "A=A" },
          examples("source-examples", [examples("inner-examples", [
            { id: "gain", type: "formula", tex: "K=P", outputs: [{ id: "result", entryId: "example-matrix", bindings: {} }] },
            { id: "hidden-text", type: "paragraph", text: "隐藏标签中的边界参数" },
          ])]),
        ],
      },
      {
        ...dates,
        id: "derivation",
        title: "场景推导",
        blocks: [examples("consumer-examples", [
          { id: "command", type: "formula", tex: "u=-Kx", parts: [{ type: "symbol", entryId: "example-matrix", bindings: {}, source }], outputs: [{ id: "command-result", entryId: "example-matrix", bindings: {} }] },
        ])],
      },
      {
        ...dates,
        id: "downstream",
        title: "后续应用",
        basisNoteIds: ["derivation"],
        blocks: [],
      },
    ],
  };
}

describe("references inside nested example tabs", () => {
  it("resolves results and numbers formulas across every tab while preserving IDs", () => {
    const state = fixture();
    const found = findResearchFormula(state, source);
    expect(found?.formula.id).toBe("gain");
    expect(researchFormulaTitle(found!.formula, found!.note)).toBe("公式 2");
    expect(resolveFormulaSource(state, source)?.reference).toEqual(source);
    expect(listFormulaOutputs(state, "example-matrix", consumer).map(item => item.reference)).toEqual([source]);
  });

  it("finds hidden consumers and prevents removing their declared source result", () => {
    const state = fixture();
    expect(listFormulaConsumers(state, source)).toMatchObject([{ noteId: "derivation", formulaId: "command", outputId: "result" }]);
    expect(formulaMetadataError(state, source, [])).toMatch(/引用/);
  });

  it("rejects cycles that pass through nested tabs", () => {
    const state = fixture();
    expect(formulaSourceError(state, source, {
      type: "symbol",
      entryId: "example-matrix",
      bindings: {},
      source: { ...consumer, outputId: "command-result" },
    })).toMatch(/循环|自身/);
  });

  it("propagates theory citations and review invalidation from hidden formulas", () => {
    const state = fixture();
    expect(noteBasisIds(state.notes[1])).toEqual(["basis"]);
    const next = invalidateResearchReviews(state.notes, ["basis"]);
    expect(next.map(note => note.reviewStatus)).toEqual(["pending", "pending", "pending"]);
  });

  it("searches hidden nested content as well as tab titles", () => {
    const state = fixture();
    expect(filterResearchNotes(state.notes, { ...defaultResearchNoteFilters, query: "边界参数" }).map(note => note.id)).toEqual(["basis"]);
    expect(filterResearchNotes(state.notes, { ...defaultResearchNoteFilters, query: "边界算例" }).map(note => note.id)).toEqual(["basis", "derivation"]);
  });

  it("keeps nested source nodes and formula edges available in theory maps", () => {
    const state = fixture();
    const ref = { noteId: source.noteId, blockId: source.formulaId };
    const target = { noteId: consumer.noteId, blockId: consumer.formulaId };
    expect(resolveTheoryReference(state, ref)).toMatchObject({ missing: false, block: { id: "gain", type: "formula" } });
    expect(researchTheoryCatalogue(state).map(node => node.id)).toContain(theoryReferenceKey({ noteId: "basis", blockId: "hidden-text" }));
    const graph = buildResearchTheoryGraph(state, { expandedNoteIds: ["basis", "derivation"], showAllBlocks: true });
    expect(graph.edges.filter(edge => edge.origin === "formula")).toMatchObject([{ source: theoryReferenceKey(ref), target: theoryReferenceKey(target) }]);
    expect(graph.edges.some(edge => edge.error)).toBe(false);
    expect(graph.nodes.find(node => node.id === theoryReferenceKey(ref))?.missing).toBe(false);
  });

  it("protects dictionary entries used only by a formula output in a nested tab", () => {
    const state = fixture();
    state.notes = state.notes.slice(0, 1);
    expect(listSymbolUses(state.notes, "example-matrix")).toEqual([{ noteId: "basis", noteTitle: "基础设计", blockId: "gain" }]);
    expect(deleteSymbolEntry(state, "example-matrix")).toBe(state);
    const entry = state.symbols.find(item => item.id === "example-matrix")!;
    const updated = updateSymbolEntry(state, { ...entry, meaning: "修改后的增益含义" });
    expect(updated.notes[0].reviewStatus).toBe("pending");
  });
});
