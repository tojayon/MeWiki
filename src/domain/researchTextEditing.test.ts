import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { commitResearchTextBlock, createResearchContentBlock, createResearchNote, normalizeResearchNotebook, serializeResearchMarkdown, type ResearchNotebookBlock } from "./researchNotebook.ts";

function stateWith(block: ResearchNotebookBlock) {
  const note = { ...createResearchNote("文本编辑"), id: "note", reviewStatus: "reviewed" as const, blocks: [block, { id: "next", type: "paragraph" as const, text: "后续内容" }] };
  return { ...createResearchNotebook(), activeNoteId: note.id, notes: [note] };
}

describe("research text editing", () => {
  it("saves Markdown list editing without duplicating bullet markers on read or export", () => {
    const initial = stateWith({ id: "text", type: "list", items: ["采样", "执行"] });
    expect(commitResearchTextBlock(initial, "note", "text", "- 采样\n- 执行")).toBe(initial);
    const updated = commitResearchTextBlock(initial, "note", "text", "- 采样\n- 执行\n- 新项目");
    expect(updated.notes[0].blocks[0]).toMatchObject({ type: "list", items: ["采样", "执行", "新项目"] });
    expect(serializeResearchMarkdown(updated.notes[0])).toContain("- 采样\n- 执行\n- 新项目");
    expect(serializeResearchMarkdown(updated.notes[0])).not.toContain("- - ");
  });

  it("preserves nested list Markdown entered into a simple list", () => {
    const initial = stateWith({ id: "text", type: "list", items: ["父项"], section: "given" });
    const source = "- 父项\n  - 子项\n  - 新子项";
    expect(commitResearchTextBlock(initial, "note", "text", source).notes[0].blocks[0]).toEqual({ id: "text", type: "markdown", kind: "markdown", text: source, section: "given" });
  });

  it("keeps multiline item Markdown intact for reading, re-editing and export", () => {
    const initial = stateWith({ id: "text", type: "list", items: ["采样", "执行"] });
    const source = "- 采样\n  说明续行\n- 执行";
    const updated = commitResearchTextBlock(initial, "note", "text", source);
    expect(updated.notes[0].blocks[0]).toEqual({ id: "text", type: "markdown", kind: "markdown", text: source });
    expect(serializeResearchMarkdown(updated.notes[0])).toContain(source);
  });

  it("starts new content without saving instructional text as user content", () => {
    expect(createResearchContentBlock("paragraph")).toMatchObject({ text: "" });
    expect(createResearchContentBlock("list")).toMatchObject({ items: [""] });
    expect(createResearchContentBlock("callout")).toMatchObject({ text: "" });
    expect(createResearchContentBlock("formula")).toMatchObject({ caption: "" });
    const scaffolds = { quote: "> ", code: "```python\n\n```", orderedList: "1. ", taskList: "- [ ] ", table: "|  |  |\n| :--- | :--- |\n|  |  |", image: "![]()", markdown: "" };
    for (const [kind, text] of Object.entries(scaffolds)) {
      expect(createResearchContentBlock(kind as keyof typeof scaffolds)).toMatchObject(kind === "image" ? { type: "media", kind } : { type: "markdown", kind, text });
    }
  });

  it("uses the same Markdown heading model for insertion and typed heading levels", () => {
    expect(createResearchContentBlock("heading")).toMatchObject({ type: "heading", level: 2, text: "" });
    const initial = stateWith({ id: "text", type: "paragraph", text: "原说明" });
    for (let level = 1; level <= 6; level++) {
      const updated = commitResearchTextBlock(initial, "note", "text", "#".repeat(level) + " **状态** $x(t)$");
      expect(updated.notes[0].blocks[0]).toEqual({ id: "text", type: "heading", level, text: "**状态** $x(t)$" });
      expect(serializeResearchMarkdown(updated.notes[0])).toContain("#".repeat(level) + " **状态** $x(t)$");
      expect(updated.notes[0].reviewStatus).toBe("pending");
    }
  });

  it("changes heading levels and converts a heading to prose when its prefix is removed", () => {
    const initial = stateWith({ id: "text", type: "heading", level: 2, text: "控制模型" });
    expect(commitResearchTextBlock(initial, "note", "text", "## 控制模型")).toBe(initial);
    expect(commitResearchTextBlock(initial, "note", "text", "###### 深层模型").notes[0].blocks[0]).toEqual({ id: "text", type: "heading", level: 6, text: "深层模型" });
    expect(commitResearchTextBlock(initial, "note", "text", "普通说明").notes[0].blocks[0]).toEqual({ id: "text", type: "paragraph", text: "普通说明" });
    expect(commitResearchTextBlock(initial, "note", "text", "# 小标题\n\n后续段落").notes[0].blocks[0]).toMatchObject({ type: "paragraph", text: "# 小标题\n\n后续段落" });
  });

  it("removes cleared text, headings, Markdown and lists on commit, including browser whitespace", () => {
    const blocks: ResearchNotebookBlock[] = [
      { id: "text", type: "paragraph", text: "内容" }, { id: "text", type: "heading", level: 3, text: "标题" },
      { id: "text", type: "markdown", kind: "quote", text: "> 引用" }, { id: "text", type: "list", items: ["项目一", "项目二"] },
    ];
    for (const block of blocks) for (const text of ["", " \t\n\u00a0\u200b"]) {
      const initial = stateWith(block);
      const updated = commitResearchTextBlock(initial, "note", "text", text);
      expect(updated.notes[0].blocks.map((item) => item.id)).toEqual(["next"]);
      expect(updated.notes[0].reviewStatus).toBe("pending");
      expect(initial.notes[0].blocks).toHaveLength(2);
    }
    for (let level = 1; level <= 6; level++) expect(commitResearchTextBlock(stateWith(blocks[1]), "note", "text", "#".repeat(level) + " ").notes[0].blocks).toHaveLength(1);
  });

  it("preserves code, explicit dividers, inner blank lines and meaningful non-text blocks", () => {
    const code = { id: "text", type: "markdown" as const, kind: "code" as const, text: "```md\n## 字面标题\n```" };
    expect(commitResearchTextBlock(stateWith(code), "note", "text", code.text).notes[0].blocks[0]).toEqual(code);
    const divider = { ...code, kind: "divider" as const, text: "---" };
    expect(commitResearchTextBlock(stateWith(divider), "note", "text", "---").notes[0].blocks[0]).toEqual(divider);
    const list = commitResearchTextBlock(stateWith({ id: "text", type: "list", items: ["一"] }), "note", "text", "一\n\n二");
    expect(list.notes[0].blocks[0]).toMatchObject({ type: "list", items: ["一", "", "二"] });
    const formula = stateWith({ id: "text", type: "formula", tex: "", parts: [], caption: "待推导" });
    expect(commitResearchTextBlock(formula, "note", "text", "")).toBe(formula);
    expect(commitResearchTextBlock(formula, "missing", "text", "")).toBe(formula);
    expect(commitResearchTextBlock(formula, "note", "missing", "")).toBe(formula);
  });

  it("removes already saved blank text rows without discarding formula placeholders or labeled Callouts", () => {
    const initial = stateWith({ id: "empty", type: "paragraph", text: " \u200b" });
    initial.notes[0].blocks = [
      ...initial.notes[0].blocks, { id: "blank-heading", type: "heading", level: 3, text: "" },
      { id: "blank-md", type: "markdown", kind: "quote", text: "\n" }, { id: "blank-list", type: "list", items: ["", " "] },
      { id: "formula", type: "formula", tex: "", parts: [] },
      { ...createResearchContentBlock("callout")!, id: "callout", text: "" } as ResearchNotebookBlock,
      { id: "divider", type: "markdown", kind: "divider", text: "---" },
    ];
    expect(normalizeResearchNotebook(initial).notes[0].blocks.map((block) => block.id)).toEqual(["next", "formula", "callout", "divider"]);
  });
});
