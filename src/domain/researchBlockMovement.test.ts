import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createResearchNote, normalizeResearchNotebook, type ResearchNotebookBlock } from "./researchNotebook.ts";
import { moveResearchBlock, moveResearchBlocks } from "./researchBlockMovement.ts";
import { getResearchBlockContainer } from "./researchBlockTree.ts";
import { partitionTheoryBlocks } from "./researchTheorySections.ts";
import { setNoteReviewStatus } from "./researchNoteOrganization.ts";
import { listFormulaConsumers } from "./researchFormulaLinks.ts";

function fixture() {
  const state = createResearchNotebook();
  state.notes = [{ ...createResearchNote("拖动排序"), id: "note", library: "foundation", blocks: [
    { id: "given", type: "paragraph", text: "条件", section: "given" },
    { id: "first", type: "paragraph", text: "第一行" },
    { id: "second", type: "paragraph", text: "第二行" },
    { id: "heading", type: "heading", level: 2, text: "推导" },
    { id: "formula", type: "formula", tex: "x", outputs: [{ id: "out", entryId: state.symbols[0].id, bindings: {} }], section: "conclusion" },
  ] as ResearchNotebookBlock[] }];
  state.activeNoteId = "note";
  return state;
}

function nestedFixture() {
  const state = fixture();
  const examples: ResearchNotebookBlock = {
    id: "examples", type: "examples", tabs: [
      { id: "tab-a", title: "例一", blocks: [
        { id: "a-first", type: "paragraph", text: "例一第一行" },
        { id: "a-formula", type: "formula", tex: "y", parts: [{ type: "symbol", entryId: state.symbols[0].id, bindings: {} }], outputs: [{ id: "a-output", entryId: state.symbols[0].id, bindings: {} }] },
        { id: "nested-examples", type: "examples", tabs: [{ id: "nested-tab", title: "内层例子", blocks: [
          { id: "nested-first", type: "paragraph", text: "内层第一行" },
          { id: "nested-last", type: "paragraph", text: "内层最后一行" },
        ] }] },
      ] },
      { id: "tab-b", title: "例二", blocks: [{ id: "b-first", type: "paragraph", text: "例二第一行" }] },
      { id: "empty-tab", title: "空例子", blocks: [] },
    ],
  };
  state.notes[0].blocks.splice(2, 0, examples);
  return state;
}

function tabBlocks(blocks: ResearchNotebookBlock[], exampleId: string, tabId: string): ResearchNotebookBlock[] {
  const found = getResearchBlockContainer(blocks, { exampleBlockId: exampleId, tabId });
  if (!found) throw new Error(`Missing example tab: ${exampleId}/${tabId}`);
  return found;
}

describe("research block movement", () => {
  it("reorders in both directions by stable IDs without changing other block objects", () => {
    const state = fixture();
    const down = moveResearchBlock(state, "note", "first", { beforeBlockId: "heading" });
    expect(down.notes[0].blocks.map((block) => block.id)).toEqual(["given", "second", "first", "heading", "formula"]);
    const up = moveResearchBlock(down, "note", "heading", { beforeBlockId: "second" });
    expect(up.notes[0].blocks.map((block) => block.id)).toEqual(["given", "heading", "second", "first", "formula"]);
    expect(up.notes[0].blocks[0]).toBe(state.notes[0].blocks[0]);
    expect(up.notes[0].blocks[1]).toBe(state.notes[0].blocks[3]);
    expect(state.notes[0].blocks.map((block) => block.id)).toEqual(["given", "first", "second", "heading", "formula"]);
  });

  it("moves into a section, appends after its last block and restores a block to derivations", () => {
    const state = fixture();
    const given = moveResearchBlock(state, "note", "second", { area: "given" });
    expect(given.notes[0].blocks.map((block) => block.id)).toEqual(["given", "second", "first", "heading", "formula"]);
    expect(given.notes[0].blocks[1]).toMatchObject({ id: "second", section: "given", text: "第二行" });
    const result = moveResearchBlock(given, "note", "second", { area: "conclusion", beforeBlockId: "formula" });
    expect(partitionTheoryBlocks(result.notes[0].blocks).conclusion.map((block) => block.id)).toEqual(["second", "formula"]);
    const back = moveResearchBlock(result, "note", "second", { area: "derivation", beforeBlockId: "first" });
    expect(back.notes[0].blocks[1]).toMatchObject({ id: "second", text: "第二行" });
    expect(back.notes[0].blocks[1].section).toBeUndefined();
    expect(new Set(back.notes[0].blocks.map((block) => block.id)).size).toBe(5);
  });

  it("accepts empty sections and does not move descendants when dragging a heading", () => {
    const state = fixture();
    state.notes[0].blocks = state.notes[0].blocks.filter((block) => !block.section);
    const next = moveResearchBlock(state, "note", "heading", { area: "given" });
    expect(next.notes[0].blocks.map((block) => block.id)).toEqual(["heading", "first", "second"]);
    expect(next.notes[0].blocks.filter((block) => block.section)).toHaveLength(1);
    expect(moveResearchBlock(next, "note", "first", { area: "conclusion" }).notes[0].blocks.at(-1)).toMatchObject({ id: "first", section: "conclusion" });
  });

  it("keeps full-note reorder independent of section changes and permits appending to the note", () => {
    const state = fixture();
    const next = moveResearchBlock(state, "note", "given", {});
    expect(next.notes[0].blocks.at(-1)).toBe(state.notes[0].blocks[0]);
    expect(normalizeResearchNotebook(next).notes.find((note) => note.id === "note")!.blocks.map((block) => block.id)).toEqual(["first", "second", "heading", "formula", "given"]);
  });

  it("ignores invalid targets, self drops and unchanged order without resetting review status", () => {
    const state = setNoteReviewStatus(fixture(), "note", "reviewed");
    for (const [noteId, blockId, target] of [
      ["missing", "first", {}], ["note", "missing", {}],
      ["note", "first", { beforeBlockId: "missing" }],
      ["note", "first", { beforeBlockId: "first" }],
      ["note", "first", { beforeBlockId: "second" }],
      ["note", "first", { beforeBlockId: "given", area: "conclusion" as const }],
      ["note", "formula", { area: "conclusion" as const }],
    ] as const) expect(moveResearchBlock(state, noteId, blockId, target)).toBe(state);
  });

  it("preserves referenced formula outputs, consumers and metadata and invalidates reviews on actual moves", () => {
    const state = fixture();
    state.notes.push({ ...createResearchNote("引用者"), id: "consumer", blocks: [
      { id: "use", type: "formula", tex: "x", parts: [{ type: "symbol", entryId: state.symbols[0].id, bindings: {}, source: { noteId: "note", formulaId: "formula", outputId: "out" } }] },
    ] });
    const reviewed = setNoteReviewStatus(state, "note", "reviewed", "2026-11-07T00:00:00.000Z");
    const beforeConsumers = listFormulaConsumers(reviewed, { noteId: "note", formulaId: "formula" });
    const next = moveResearchBlock(reviewed, "note", "formula", { area: "given" });
    expect(listFormulaConsumers(next, { noteId: "note", formulaId: "formula" })).toEqual(beforeConsumers);
    expect(next.notes[0].blocks.find((block) => block.id === "formula")).toEqual({ ...reviewed.notes[0].blocks.at(-1), section: "given" });
    expect(next.notes[0]).toMatchObject({ reviewStatus: "pending", reviewedAt: "2026-11-07T00:00:00.000Z", tags: reviewed.notes[0].tags });
  });

  it("moves a batch in document order, deduplicates IDs and preserves untouched objects", () => {
    expect(moveResearchBlocks).toBeTypeOf("function");
    const state = fixture();
    const next = moveResearchBlocks(state, "note", ["heading", "first", "second", "first"], { beforeBlockId: "given" });
    expect(next.notes[0].blocks.map((block) => block.id)).toEqual(["first", "second", "heading", "given", "formula"]);
    expect(next.notes[0].blocks[3]).toBe(state.notes[0].blocks[0]);
    expect(next.notes[0].blocks[4]).toBe(state.notes[0].blocks[4]);
    expect(state.notes[0].blocks.map((block) => block.id)).toEqual(["given", "first", "second", "heading", "formula"]);
  });

  it("moves a batch into a section together and clears its assignment on returning to derivations", () => {
    const state = fixture();
    const conclusion = moveResearchBlocks(state, "note", ["second", "given"], { area: "conclusion", beforeBlockId: "formula" });
    expect(conclusion.notes[0].blocks.map((block) => block.id)).toEqual(["first", "heading", "given", "second", "formula"]);
    expect(partitionTheoryBlocks(conclusion.notes[0].blocks).conclusion.map((block) => block.id)).toEqual(["given", "second", "formula"]);
    const back = moveResearchBlocks(conclusion, "note", ["given", "second"], { area: "derivation", beforeBlockId: "first" });
    expect(back.notes[0].blocks.map((block) => block.id)).toEqual(["given", "second", "first", "heading", "formula"]);
    expect(back.notes[0].blocks.slice(0, 2).every((block) => block.section === undefined)).toBe(true);
  });

  it("keeps batches dropped within their own range unchanged without invalidating review", () => {
    const state = setNoteReviewStatus(fixture(), "note", "reviewed");
    for (const target of [{ beforeBlockId: "first" }, { beforeBlockId: "second" }, { beforeBlockId: "heading" }]) {
      expect(moveResearchBlocks(state, "note", ["second", "first"], target)).toBe(state);
    }
    expect(moveResearchBlocks(state, "note", [], {})).toBe(state);
    expect(moveResearchBlocks(state, "note", ["first", "missing"], {})).toBe(state);
  });

  it("gathers nonadjacent selections before a selected anchor without losing any blocks", () => {
    const state = fixture();
    const next = moveResearchBlocks(state, "note", ["heading", "first"], { beforeBlockId: "first" });
    expect(next.notes[0].blocks.map((block) => block.id)).toEqual(["given", "first", "heading", "second", "formula"]);
  });

  it("moves multiple root blocks into an empty example tab and strips their section assignment", () => {
    const state = nestedFixture();
    const formula = state.notes[0].blocks.at(-1)!;
    const next = moveResearchBlocks(state, "note", ["formula", "given"], { container: { exampleBlockId: "examples", tabId: "empty-tab" } });
    expect(next.notes[0].blocks.map((block) => block.id)).toEqual(["first", "examples", "second", "heading"]);
    const moved = tabBlocks(next.notes[0].blocks, "examples", "empty-tab");
    expect(moved.map((block) => block.id)).toEqual(["given", "formula"]);
    expect(moved.every((block) => block.section === undefined)).toBe(true);
    expect(moved[1]).toEqual({ ...formula, section: undefined });
    if (moved[1].type === "formula" && formula.type === "formula") expect(moved[1].outputs).toBe(formula.outputs);
    expect(tabBlocks(state.notes[0].blocks, "examples", "empty-tab")).toEqual([]);
  });

  it("sorts multiple lines in one tab while preserving a nested example as one block", () => {
    const state = nestedFixture();
    const original = tabBlocks(state.notes[0].blocks, "examples", "tab-a");
    const next = moveResearchBlocks(state, "note", ["nested-examples", "a-formula"], {
      container: { exampleBlockId: "examples", tabId: "tab-a" }, beforeBlockId: "a-first",
    });
    const reordered = tabBlocks(next.notes[0].blocks, "examples", "tab-a");
    expect(reordered.map((block) => block.id)).toEqual(["a-formula", "nested-examples", "a-first"]);
    expect(reordered[0]).toBe(original[1]);
    expect(reordered[1]).toBe(original[2]);
    expect(tabBlocks(next.notes[0].blocks, "nested-examples", "nested-tab").map((block) => block.id)).toEqual(["nested-first", "nested-last"]);
  });

  it("preserves reviews for unchanged nested batches, including drops onto selected lines", () => {
    const state = setNoteReviewStatus(nestedFixture(), "note", "reviewed");
    const container = { exampleBlockId: "examples", tabId: "tab-a" };
    expect(moveResearchBlock(state, "note", "a-formula", { container, beforeBlockId: "a-formula" })).toBe(state);
    expect(moveResearchBlocks(state, "note", ["nested-examples", "a-formula"], { container, beforeBlockId: "nested-examples" })).toBe(state);
    expect(moveResearchBlocks(state, "note", ["nested-examples", "a-formula"], { container })).toBe(state);
  });

  it("moves a batch between example tabs without replacing unrelated tab content", () => {
    const state = nestedFixture();
    const originalTarget = tabBlocks(state.notes[0].blocks, "examples", "tab-b");
    const next = moveResearchBlocks(state, "note", ["a-formula", "a-first"], {
      container: { exampleBlockId: "examples", tabId: "tab-b" }, beforeBlockId: "b-first",
    });
    expect(tabBlocks(next.notes[0].blocks, "examples", "tab-a").map((block) => block.id)).toEqual(["nested-examples"]);
    const target = tabBlocks(next.notes[0].blocks, "examples", "tab-b");
    expect(target.map((block) => block.id)).toEqual(["a-first", "a-formula", "b-first"]);
    expect(target[2]).toBe(originalTarget[0]);
  });

  it("collects selections from different depths in tree order into one target", () => {
    const state = nestedFixture();
    const next = moveResearchBlocks(state, "note", ["second", "nested-last", "a-first"], {
      container: { exampleBlockId: "examples", tabId: "empty-tab" },
    });
    expect(tabBlocks(next.notes[0].blocks, "examples", "empty-tab").map((block) => block.id)).toEqual(["a-first", "nested-last", "second"]);
    expect(tabBlocks(next.notes[0].blocks, "examples", "tab-a").map((block) => block.id)).toEqual(["a-formula", "nested-examples"]);
    expect(tabBlocks(next.notes[0].blocks, "nested-examples", "nested-tab").map((block) => block.id)).toEqual(["nested-first"]);
    expect(next.notes[0].blocks.map((block) => block.id)).toEqual(["given", "first", "examples", "heading", "formula"]);
  });

  it("moves nested lines back to root sections with stable formula details", () => {
    const state = nestedFixture();
    const originalFormula = tabBlocks(state.notes[0].blocks, "examples", "tab-a")[1];
    const next = moveResearchBlocks(state, "note", ["a-formula", "a-first"], { area: "given" });
    expect(next.notes[0].blocks.slice(0, 3).map((block) => block.id)).toEqual(["given", "a-first", "a-formula"]);
    expect(next.notes[0].blocks.slice(1, 3).every((block) => block.section === "given")).toBe(true);
    const movedFormula = next.notes[0].blocks[2];
    if (movedFormula.type === "formula" && originalFormula.type === "formula") {
      expect(movedFormula.parts).toBe(originalFormula.parts);
      expect(movedFormula.outputs).toBe(originalFormula.outputs);
    }
  });

  it("moves a selected example only once when its descendants are also selected", () => {
    const state = nestedFixture();
    const original = state.notes[0].blocks.find((block) => block.id === "examples")!;
    const next = moveResearchBlocks(state, "note", ["a-first", "nested-first", "examples"], { area: "conclusion" });
    expect(next.notes[0].blocks.map((block) => block.id)).toEqual(["given", "first", "second", "heading", "formula", "examples"]);
    expect(next.notes[0].blocks.at(-1)).toEqual({ ...original, section: "conclusion" });
    if (original.type === "examples" && next.notes[0].blocks.at(-1)?.type === "examples") {
      expect((next.notes[0].blocks.at(-1) as typeof original).tabs).toBe(original.tabs);
    }
  });

  it("rejects cyclic, missing and mismatched nested targets atomically", () => {
    const state = setNoteReviewStatus(nestedFixture(), "note", "reviewed");
    for (const [ids, target] of [
      [["examples"], { container: { exampleBlockId: "examples", tabId: "tab-a" } }],
      [["first", "examples"], { container: { exampleBlockId: "nested-examples", tabId: "nested-tab" } }],
      [["a-first"], { container: { exampleBlockId: "examples", tabId: "missing" } }],
      [["a-first"], { container: { exampleBlockId: "missing", tabId: "tab-a" } }],
      [["a-first"], { container: { exampleBlockId: "examples", tabId: "tab-a" }, beforeBlockId: "b-first" }],
      [["a-first"], { beforeBlockId: "b-first" }],
      [["a-first"], { beforeBlockId: "given", area: "conclusion" as const }],
    ] as const) expect(moveResearchBlocks(state, "note", [...ids], target)).toBe(state);
  });
});
