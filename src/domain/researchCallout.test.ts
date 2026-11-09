import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { convertResearchBlockType, createResearchContentBlock, createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown, type ResearchNotebookBlock } from "./researchNotebook.ts";
import { defaultResearchNoteFilters, filterResearchNotes } from "./researchNoteOrganization.ts";

const appearance = { labelBackground: "#123b70", labelColor: "#ffffff", borderColor: "#2563eb", borderStyle: "dashdot", borderWidth: 2.5 };
const callout = { id: "callout", type: "callout", title: "项目演进", text: "研究 **关系映射** 与 $\\Delta(t)$。\n\n> 需要保留嵌套引用\n\n```text\n<!-- webbench-callout: {} -->\n```", appearance } as ResearchNotebookBlock;

describe("research Callout", () => {
  it("creates a labeled Callout with the reference colors and preserves content during type conversion", () => {
    expect(createResearchContentBlock("callout")).toMatchObject({ type: "callout", title: "提示", appearance: { labelColor: "#ffffff", borderStyle: "solid", borderWidth: 1 } });
    const paragraph = { id: "source", type: "paragraph" as const, text: "原有 $x(t)$ 说明" };
    const converted = convertResearchBlockType(paragraph, "callout");
    expect(converted).toMatchObject({ id: "source", type: "callout", text: paragraph.text });
    expect(convertResearchBlockType(callout, "paragraph")).toMatchObject({ id: "callout", type: "paragraph", text: "项目演进\n" + (callout as { text: string }).text });
  });

  it("retains the complete Callout through browser storage and makes its title and body searchable", () => {
    const note = { ...createResearchNote("建模"), blocks: [callout] };
    const initial = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
    const saved = normalizeResearchNotebook(JSON.parse(JSON.stringify(initial)));
    expect(saved.notes.find((item) => item.id === note.id)?.blocks).toEqual([callout]);
    for (const query of ["项目演进", "关系映射"]) expect(filterResearchNotes([note], { ...defaultResearchNoteFilters, query })).toEqual([note]);
  });

  it("recovers malformed appearance values without discarding the title or body", () => {
    const note = { ...createResearchNote("恢复"), blocks: [{ ...callout, appearance: { labelBackground: "url(unsafe)", labelColor: "#F80", borderColor: "", borderStyle: "dotted", borderWidth: Number.POSITIVE_INFINITY } }] };
    const saved = normalizeResearchNotebook({ ...createResearchNotebook(), notes: [note], activeNoteId: note.id });
    expect(saved.notes.find((item) => item.id === note.id)?.blocks[0]).toMatchObject({ type: "callout", title: "项目演进", appearance: { labelBackground: "#153b6d", labelColor: "#ff8800", borderColor: "#224f82", borderStyle: "solid", borderWidth: 1 } });
  });

  it("round trips Callout styles, empty bodies and Markdown without swallowing neighboring content", () => {
    const first = { ...callout, title: "标签 ** <-->" } as ResearchNotebookBlock;
    const second = { ...callout, id: "empty", title: "空内容", text: "", appearance: { ...appearance, borderStyle: "dashed", borderWidth: 0.5 } } as ResearchNotebookBlock;
    const note = { ...createResearchNote("交换"), blocks: [{ id: "before", type: "paragraph", text: "开始" }, first, second, { id: "after", type: "paragraph", text: "结束" }] as ResearchNotebookBlock[] };
    const exported = serializeResearchMarkdown(note);
    expect(exported).toContain("<!-- webbench-callout:");
    expect(exported).toContain("> 研究 **关系映射**");
    const imported = parseResearchMarkdown(exported, note.title);
    const content = (blocks: ResearchNotebookBlock[]) => blocks.map(({ id: _id, ...block }) => block);
    expect(content(imported.blocks)).toEqual(content(note.blocks));
  });

  it("treats Callout markers inside code as literal text and keeps malformed markers readable", () => {
    const marker = '<!-- webbench-callout: {"title":"代码示例"} -->';
    const note = parseResearchMarkdown("```md\n" + marker + "\n\n> 代码中的引用\n```\n\n<!-- webbench-callout: broken -->\n\n> 普通引用");
    expect(note.blocks.map((block) => block.type)).not.toContain("callout");
    expect(note.blocks[0]).toMatchObject({ type: "markdown", kind: "code" });
    expect(note.blocks.at(-1)).toMatchObject({ type: "markdown", kind: "quote", text: "> 普通引用" });
  });

  it("keeps Callouts as independent blocks between Markdown reference contexts", () => {
    const note = { ...createResearchNote("参考"), blocks: [callout] };
    const exported = serializeResearchMarkdown(note);
    const source = '[文献][paper]\n\n' + exported + '\n\n[paper]: https://example.com/paper';
    const imported = parseResearchMarkdown(source);
    expect(imported.blocks.filter((block) => block.type === "callout")).toHaveLength(1);
  });
});
