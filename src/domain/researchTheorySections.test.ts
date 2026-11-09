import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { commitResearchTextBlock, convertResearchBlockType, createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown, type ResearchNotebookBlock } from "./researchNotebook.ts";
import { prepareLibraryNote } from "./researchNoteLibraries.ts";
import { partitionTheoryBlocks, setTheoryBlockSection, sectionInsertionBefore, theoryReadingFlow } from "./researchTheorySections.ts";
import {
  assertResearchLibraryNotebook,
  createResearchLibraryFile,
  parseResearchLibraryFile,
} from "../state/researchLibraryFile.ts";

function fixture() {
  const state = createResearchNotebook();
  const note = {
    ...createResearchNote("抽屉理论"),
    library: "foundation" as const,
    blocks: [
      { id: "given", type: "paragraph", text: "已知 $x>0$。", section: "given" },
      { id: "proof", type: "paragraph", text: "进行推导。" },
      { id: "result", type: "formula", tex: "x^2>0", section: "conclusion" },
    ] as ResearchNotebookBlock[],
  };
  return { ...state, notes: [note], activeNoteId: note.id };
}

describe("theory content sections", () => {
  it("keeps each separated condition and conclusion run at its original reading position", () => {
    const blocks: ResearchNotebookBlock[] = [
      { id: "intro", type: "paragraph", text: "引言" },
      { id: "g1", type: "heading", level: 2, text: "前提", section: "given" },
      { id: "g2", type: "paragraph", text: "假设", section: "given" },
      { id: "proof", type: "paragraph", text: "推导" },
      { id: "c1", type: "paragraph", text: "阶段结论", section: "conclusion" },
      { id: "g3", type: "paragraph", text: "补充条件", section: "given" },
      { id: "tail", type: "paragraph", text: "后续讨论" },
    ];
    const flow = theoryReadingFlow(blocks);
    expect(flow).toEqual([
      { kind: "content", block: blocks[0] },
      { kind: "drawer", section: "given", blocks: blocks.slice(1, 3) },
      { kind: "content", block: blocks[3] },
      { kind: "drawer", section: "conclusion", blocks: [blocks[4]] },
      { kind: "drawer", section: "given", blocks: [blocks[5]] },
      { kind: "content", block: blocks[6] },
    ]);
    expect(flow[0]).toMatchObject({ kind: "content", block: blocks[0] });
    expect(flow.flatMap(item => item.kind === "drawer" ? item.blocks : [item.block])).toEqual(blocks);
    expect(blocks[1].section).toBe("given");
  });

  it("assigns a heading and all its descendants without crossing the next sibling chapter", () => {
    const state = fixture();
    state.notes[0].blocks = [
      { id: "chapter", type: "heading", level: 2, text: "任意标题" },
      ...state.notes[0].blocks,
      { id: "nested", type: "heading", level: 3, text: "下级条件" },
      { id: "detail", type: "paragraph", text: "条件细节" },
      { id: "next", type: "heading", level: 2, text: "下一节" },
      { id: "tail", type: "paragraph", text: "不属于条件" },
    ];
    const assigned = setTheoryBlockSection(state, state.activeNoteId, "chapter", "given");
    expect(assigned.notes[0].blocks.slice(0, 6).every((block) => block.section === "given")).toBe(true);
    expect(assigned.notes[0].blocks.slice(6).every((block) => !block.section)).toBe(true);
    expect(assigned.notes[0].blocks.map((block) => block.id)).toEqual(state.notes[0].blocks.map((block) => block.id));
    expect(assigned.notes[0].blocks[3]).toMatchObject({ id: "result", type: "formula", tex: "x^2>0" });
    const single = setTheoryBlockSection(assigned, state.activeNoteId, "proof", "derivation");
    expect(single.notes[0].blocks[2].section).toBeUndefined();
    expect(single.notes[0].blocks[1].section).toBe("given");
    expect(setTheoryBlockSection(single, state.activeNoteId, "proof", "derivation")).toBe(single);
  });

  it("partitions existing block objects once and inserts at the end of the requested area", () => {
    const state = fixture();
    const blocks = state.notes[0].blocks;
    const groups = partitionTheoryBlocks(blocks);
    expect(groups.given).toEqual([blocks[0]]);
    expect(groups.derivation).toEqual([blocks[1]]);
    expect(groups.conclusion).toEqual([blocks[2]]);
    expect(groups.conclusion[0]).toBe(blocks[2]);
    expect(sectionInsertionBefore(blocks, "given")).toBe("proof");
    expect(sectionInsertionBefore(blocks, "derivation")).toBe("result");
    expect(sectionInsertionBefore(blocks, "conclusion")).toBeUndefined();
    expect(sectionInsertionBefore(blocks.slice(1), "given")).toBe("proof");
  });

  it("preserves roles, content and stable block IDs through browser normalization", () => {
    const state = fixture();
    expect(normalizeResearchNotebook(state).notes[0].blocks).toEqual(state.notes[0].blocks);
  });

  it("retains the section when changing content type or committing a heading edit", () => {
    const state = fixture();
    const block = state.notes[0].blocks[0];
    for (const kind of ["heading", "list", "callout", "code", "formula"] as const)
      expect(convertResearchBlockType(block, kind)).toMatchObject({ id: "given", section: "given" });
    const heading = commitResearchTextBlock(state, state.activeNoteId, "given", "## 假设");
    expect(heading.notes[0].blocks[0]).toMatchObject({ id: "given", type: "heading", section: "given" });
    const paragraph = commitResearchTextBlock(heading, state.activeNoteId, "given", "重新表述条件");
    expect(paragraph.notes[0].blocks[0]).toMatchObject({ id: "given", type: "paragraph", section: "given" });
  });

  it("round-trips sections in Markdown without assigning roles by visible heading text", () => {
    const state = fixture();
    const source = serializeResearchMarkdown(state.notes[0]);
    const restored = parseResearchMarkdown(source);
    expect(restored.blocks.map((block) => block.section)).toEqual(["given", undefined, "conclusion"]);
    expect(restored.blocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "formula"]);
    expect(parseResearchMarkdown("## 成立条件\n\n普通正文").blocks.every((block) => !block.section)).toBe(true);
  });

  it("keeps literal section markers inside code and recognizes real markers around Callouts", () => {
    const note = fixture().notes[0];
    const code = "```html\n<!-- webbench-section: conclusion -->\n```";
    note.blocks = [
      { id: "code", type: "markdown", kind: "code", text: code, section: "given" },
      { id: "callout", type: "callout", title: "条件", text: "$x>0$", appearance: { labelBackground: "#153b6d", labelColor: "#ffffff", borderColor: "#224f82", borderStyle: "solid", borderWidth: 1 }, section: "given" },
      { id: "tail", type: "paragraph", text: "推导正文" },
    ];
    const restored = parseResearchMarkdown(serializeResearchMarkdown(note));
    expect(restored.blocks.map((block) => block.section)).toEqual(["given", "given", undefined]);
    expect(restored.blocks[0]).toMatchObject({ type: "markdown", kind: "code", text: code });
    expect(restored.blocks[1]).toMatchObject({ type: "callout", title: "条件", text: "$x>0$" });
  });

  it("explicitly marks the given and conclusion chapters in a new foundation template", () => {
    const note = prepareLibraryNote(createResearchNote(), "foundation");
    expect(note.blocks.find((block) => block.type === "heading" && block.text === "成立条件")).toMatchObject({ section: "given" });
    expect(note.blocks.find((block) => block.type === "heading" && block.text === "标准结论")).toMatchObject({ section: "conclusion" });
  });

  it("includes sections in complete local backups and rejects unsupported section values", async () => {
    const state = fixture();
    const file = await createResearchLibraryFile(state);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook.notes[0].blocks).toEqual(state.notes[0].blocks);
    const invalid = structuredClone(state);
    Object.assign(invalid.notes[0].blocks[0], { section: "unknown-section" });
    expect(() => assertResearchLibraryNotebook(invalid)).toThrow();
  });
});
