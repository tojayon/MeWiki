import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { convertResearchBlockType, createResearchNote, insertResearchBlock, type ResearchNotebookBlock } from "./researchNotebook.ts";
import { setNoteReviewStatus } from "./researchNoteOrganization.ts";

function fixture() {
  const note = { ...createResearchNote("插入研究内容"), id: "note", blocks: [
    { id: "first", type: "paragraph" as const, text: "原有说明" },
    { id: "formula", type: "formula" as const, tex: "K", parts: [{ type: "symbol" as const, entryId: "example-matrix", bindings: {}, source: { noteId: "source", formulaId: "gain", outputId: "result" } }] },
  ] };
  return { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
}

describe("research block insertion", () => {
  it("inserts before stable block IDs and appends at the end without changing neighbors", () => {
    const initial = fixture();
    const heading: ResearchNotebookBlock = { id: "heading", type: "heading", level: 2, text: "建模假设" };
    const first = insertResearchBlock(initial, "note", heading, "first");
    const middle = insertResearchBlock(first, "note", { id: "middle", type: "paragraph", text: "公式的解释" }, "formula");
    const last = insertResearchBlock(middle, "note", { id: "last", type: "list", items: ["后续核对"] });
    expect(last.notes[0].blocks.map((block) => block.id)).toEqual(["heading", "first", "middle", "formula", "last"]);
    expect(last.notes[0].blocks[1]).toBe(initial.notes[0].blocks[0]);
    expect(last.notes[0].blocks[3]).toBe(initial.notes[0].blocks[1]);
    expect(initial.notes[0].blocks).toHaveLength(2);
  });

  it("changes compatible text block types without changing the block identity or content", () => {
    const paragraph: ResearchNotebookBlock = { id: "paragraph", type: "paragraph", text: "第一行\n第二行" };
    expect(convertResearchBlockType(paragraph, "list")).toEqual({ id: "paragraph", type: "list", items: ["第一行", "第二行"] });
    expect(convertResearchBlockType({ id: "list", type: "list", items: ["假设 A", "假设 B"] }, "paragraph")).toEqual({ id: "list", type: "paragraph", text: "假设 A\n假设 B" });
    expect(convertResearchBlockType({ id: "heading", type: "heading", level: 3, text: "LQR" }, "paragraph")).toEqual({ id: "heading", type: "paragraph", text: "LQR" });
  });

  it("retains readable formula and replay evidence details when converting them to text", () => {
    const formula: ResearchNotebookBlock = { id: "formula", type: "formula", tex: "J=\\int_0^T x(t)\\,dt", caption: "性能指标", conditions: "x(0)=0", outputs: [{ id: "result", entryId: "cost", bindings: { loop: "p" } }] };
    expect(convertResearchBlockType(formula, "paragraph")).toEqual({
      id: "formula", type: "paragraph", text: "$J=\\int_0^T x(t)\\,dt$\n性能指标\n条件：x(0)=0\n结果 result：cost，loop=p",
    });
    const evidence: ResearchNotebookBlock = { id: "evidence", type: "evidence", runId: "run-1", runTitle: "FIFO", time: 1.5, loopId: "loop-1", packetId: "g_1", eventLabel: "RE 调度", note: "队列发生竞争" };
    expect(convertResearchBlockType(evidence, "paragraph")).toEqual({
      id: "evidence", type: "paragraph", text: "回放：FIFO\n运行：run-1\nt = 1.5 s\n环路：loop-1\n数据包：g_1\n事件：RE 调度\n队列发生竞争",
    });
  });

  it("requires a loaded replay context before converting a block to replay evidence", () => {
    const paragraph: ResearchNotebookBlock = { id: "paragraph", type: "paragraph", text: "实验观察" };
    expect(convertResearchBlockType(paragraph, "evidence")).toBeNull();
    expect(convertResearchBlockType(paragraph, "evidence", { runId: "run", runTitle: "FIFO", time: 2 })).toEqual({
      id: "paragraph", type: "evidence", runId: "run", runTitle: "FIFO", time: 2, note: "实验观察",
    });
  });

  it("does not insert at a missing target or reuse an existing block ID", () => {
    const initial = fixture();
    const block: ResearchNotebookBlock = { id: "new", type: "paragraph", text: "待插入" };
    expect(insertResearchBlock(initial, "missing", block)).toBe(initial);
    expect(insertResearchBlock(initial, "note", block, "missing")).toBe(initial);
    expect(insertResearchBlock(initial, "note", { ...block, id: "first" })).toBe(initial);
  });

  it("starts an empty note and preserves complete replay evidence", () => {
    const initial = fixture();
    const empty = { ...initial, notes: [{ ...initial.notes[0], blocks: [] }] };
    const evidence: ResearchNotebookBlock = { id: "evidence", type: "evidence", runId: "run", runTitle: "FIFO", time: 1.5, loopId: "loop-1", packetId: "g_1" };
    expect(insertResearchBlock(empty, "note", evidence).notes[0].blocks).toEqual([evidence]);
  });

  it("requires rechecking actual content insertion and keeps tags and review history", () => {
    const initial = setNoteReviewStatus(fixture(), "note", "reviewed", "2026-11-05T02:30:00.000Z");
    const updated = insertResearchBlock(initial, "note", { id: "new", type: "paragraph", text: "新增假设" }, "formula");
    expect(updated.notes[0]).toMatchObject({ reviewStatus: "pending", reviewedAt: "2026-11-05T02:30:00.000Z", tags: initial.notes[0].tags });
  });
});
