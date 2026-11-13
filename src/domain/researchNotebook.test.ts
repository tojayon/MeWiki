import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { appendResearchBlock, createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, removeResearchBlock, serializeResearchMarkdown, updateResearchNote } from "./researchNotebook.ts";

describe("research notebook documents", () => {

  it("edits notes immutably and preserves formulas and citation metadata", () => {
    const state = createResearchNotebook();
    const note = createResearchNote("新想法");
    const withNote = {
      ...state,
      activeNoteId: note.id,
      notes: [...state.notes, note],
    };
    const withBlock = appendResearchBlock(withNote, note.id, {
      id: "formula-1",
      type: "formula",
      tex: "f(x)",
      caption: "函数记录",
    });
    const edited = updateResearchNote(withBlock, note.id, {
      title: "研究假设",
    });
    expect(edited).not.toBe(withBlock);
    expect(withBlock.notes.at(-1)?.title).toBe("新想法");
    expect(edited.notes.at(-1)?.title).toBe("研究假设");
    expect(edited.notes.at(-1)?.blocks).toContainEqual(
      expect.objectContaining({ type: "formula", tex: "f(x)" }),
    );
    expect(
      appendResearchBlock(edited, "missing", {
        id: "ignored",
        type: "paragraph",
        text: "ignored",
      }),
    ).toBe(edited);
  });

  it("adds and removes blocks without losing neighboring evidence", () => {
    const note = createResearchNote("证据");
    const state = {
      ...createResearchNotebook(),
      activeNoteId: note.id,
      notes: [note],
    };
    const evidence = {
      id: "evidence-1",
      type: "evidence" as const,
      runId: "run-a",
      runTitle: "FIFO 6 s",
      time: 1.25,
      loopId: "loop-a",
      packetId: "g_1",
      eventLabel: "中继调度",
    };
    const withEvidence = appendResearchBlock(state, note.id, evidence);
    const withParagraph = appendResearchBlock(withEvidence, note.id, {
      id: "paragraph-1",
      type: "paragraph",
      text: "候选包竞争激烈",
    });
    const removed = removeResearchBlock(withParagraph, note.id, "paragraph-1");
    expect(removed.notes[0].blocks).toEqual([evidence]);
    expect(withParagraph.notes[0].blocks).toHaveLength(2);
  });

  it("round-trips headings, paragraphs, lists and display equations through Markdown", () => {
    const note = parseResearchMarkdown(
      "# 研究问题\n\n记录当前观察。\n\n- FIFO\n- min-EVL\n\n$$\n\\Delta(t)=t-r_{g_h}\n$$",
      "导入笔记",
    );
    expect(note.title).toBe("导入笔记");
    expect(note.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "formula",
    ]);
    const markdown = serializeResearchMarkdown(note);
    expect(markdown).toContain("# 导入笔记");
    expect(markdown).toContain("- FIFO\n- min-EVL");
    expect(markdown).toContain("$$\n\\Delta(t)=t-r_{g_h}\n$$");
    expect(parseResearchMarkdown(markdown, note.title).blocks).toEqual(
      note.blocks.map((block) => ({ ...block, id: expect.any(String) })),
    );
  });

  it("normalizes malformed persisted values instead of rendering invalid blocks", () => {
    const state = createResearchNotebook();
    expect(
      normalizeResearchNotebook(null).notes.some(
        (note) => note.id === "mewiki-example-foundation",
      ),
    ).toBe(true);
    const recovered = normalizeResearchNotebook({
      version: 99,
      notes: [{ blocks: "bad" }],
    });
    expect(recovered.notes.some((note) => note.id === "mewiki-example-foundation")).toBe(
      true,
    );
    expect(recovered.notes[0].title).toBe(state.notes[0].title);
    const malformedBlock = normalizeResearchNotebook({
      version: 1,
      activeNoteId: "n",
      open: true,
      notes: [
        {
          id: "n",
          title: "笔记",
          createdAt: "today",
          updatedAt: "today",
          blocks: [{ id: "bad", type: "unknown", value: "x" }],
        },
      ],
    });
    expect(malformedBlock.notes[0].blocks).toEqual([]);
    expect(malformedBlock.open).toBe(true);
  });

  it("does not restore a deliberately removed unused symbol after the current format is saved", () => {
    const state = createResearchNotebook();
    const withoutGenericIndex = {
      ...state,
      symbols: state.symbols.filter((entry) => entry.id !== "example-b"),
    };
    expect(
      normalizeResearchNotebook(withoutGenericIndex).symbols.some(
        (entry) => entry.id === "example-b",
      ),
    ).toBe(false);
  });

  it("preserves optional terms while keeping old notebooks without terms unchanged", () => {
    const state = createResearchNotebook();
    const normalized = normalizeResearchNotebook({
      ...state,
      activeTermId: "term-1",
      terms: [{ id: "term-1", name: "轨道面", aliases: ["轨道平面", "轨道平面"], meaning: "几何定义" }],
    });
    expect(normalized.activeTermId).toBe("term-1");
    expect(normalized.terms).toEqual([{ id: "term-1", name: "轨道面", aliases: ["轨道平面"], meaning: "几何定义", status: "active" }]);
    const old = normalizeResearchNotebook(state);
    expect(Object.hasOwn(old, "terms")).toBe(false);
  });
});
