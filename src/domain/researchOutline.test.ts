import { describe, expect, it } from "vitest";
import { buildResearchOutline } from "./researchOutline.ts";
import type { ResearchNotebookBlock } from "./researchNotebook.ts";
import { defaultCalloutAppearance } from "./researchCallout.ts";

const heading = (id: string, level: 1 | 2 | 3 | 4 | 5 | 6, text = id): ResearchNotebookBlock => ({ id, type: "heading", level, text });

describe("article heading numbering and outline", () => {
  it("numbers all six levels and resets deeper counters after a sibling or parent", () => {
    const blocks = [heading("a", 1), heading("b", 2), heading("c", 3), heading("d", 4), heading("e", 5), heading("f", 6), heading("g", 3), heading("h", 2), heading("i", 1), heading("j", 2)];
    expect(buildResearchOutline(blocks).map(item => item.number)).toEqual(["1.", "1.1.", "1.1.1.", "1.1.1.1.", "1.1.1.1.1.", "1.1.1.1.1.1.", "1.1.2.", "1.2.", "2.", "2.1."]);
  });

  it("starts at the shallowest article heading and fills skipped intermediate levels without zeros", () => {
    const items = buildResearchOutline([heading("a", 2), heading("b", 4), heading("c", 3), heading("d", 2)]);
    expect(items.map(item => [item.depth, item.number])).toEqual([[0, "1."], [2, "1.1.1."], [1, "1.2."], [0, "2."]]);
  });

  it("recomputes numbering after insertions, deletions and moves while preserving heading identities", () => {
    const a = heading("a", 1), b = heading("b", 1), c = heading("c", 2);
    const original = buildResearchOutline([a, b, c]);
    const moved = buildResearchOutline([b, c, a]);
    expect(moved.map(item => item.number)).toEqual(["1.", "1.1.", "2."]);
    expect(moved.find(item => item.blockId === "a")?.id).toBe(original[0].id);
    expect(buildResearchOutline([heading("new", 1), a, c]).map(item => item.number)).toEqual(["1.", "2.", "2.1."]);
    expect(buildResearchOutline([b, c]).map(item => item.number)).toEqual(["1.", "1.1."]);
  });

  it("extracts individual anchors from mixed Markdown, including setext, formatted text and inline math", () => {
    const source = "开头说明\n\n# 控制 **模型** 与 $x(t)$\n\n正文\n\n下一部分 `code`\n---\n";
    const items = buildResearchOutline([{ id: "mixed", type: "paragraph", text: source }]);
    expect(items.map(item => [item.text, item.level, item.offset, item.number])).toEqual([
      ["控制 模型 与 x(t)", 1, source.indexOf("# 控制"), "1."],
      ["下一部分 code", 2, source.indexOf("下一部分"), "1.1."],
    ]);
    expect(items[0].id).not.toBe(items[1].id);
  });

  it("ignores quoted headings, fenced code, callout text and automatically rendered footnote headings", () => {
    const blocks: ResearchNotebookBlock[] = [
      { id: "quote", type: "markdown", kind: "quote", text: "> # 引用中的标题" },
      { id: "code", type: "markdown", kind: "code", text: "```md\n# 代码中的标题\n```" },
      { id: "callout", type: "callout", title: "提示", text: "# 提示中的标题", appearance: { ...defaultCalloutAppearance } },
      { id: "prose", type: "markdown", kind: "markdown", text: "# 真实标题\n\n正文[^a]\n\n[^a]: 注释" },
    ];
    expect(buildResearchOutline(blocks).map(item => item.text)).toEqual(["真实标题"]);
  });

  it("uses source order across every tab and theory section without changing the article", () => {
    const blocks: ResearchNotebookBlock[] = [
      { ...heading("given", 1), section: "given" },
      { id: "tabs", type: "examples", tabs: [
        { id: "first", title: "标签一", blocks: [heading("inside-first", 2)] },
        { id: "second", title: "标签二", blocks: [{ id: "nested", type: "examples", tabs: [{ id: "nested-tab", title: "内层", blocks: [heading("inside-second", 2)] }] }] },
      ] },
      { ...heading("conclusion", 1), section: "conclusion" },
    ];
    const original = JSON.stringify(blocks);
    expect(buildResearchOutline(blocks).map(item => [item.blockId, item.number])).toEqual([["given", "1."], ["inside-first", "1.1."], ["inside-second", "1.2."], ["conclusion", "2."]]);
    expect(JSON.stringify(blocks)).toBe(original);
  });

  it("returns an empty outline for an article without Markdown headings", () => {
    expect(buildResearchOutline([{ id: "p", type: "paragraph", text: "正文中的 # 不是标题" }])).toEqual([]);
  });
});
