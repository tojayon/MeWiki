import { describe, expect, it } from "vitest";
import { createResearchNote, parseResearchMarkdown, serializeResearchMarkdown } from "./researchNotebook.ts";
import { buildResearchNoteBacklinks, findResearchNoteMention, insertResearchNoteMention, researchNoteLinkId, researchNoteLinkMarkdown, researchNoteLinkUrl, researchTextNoteLinks } from "./researchNoteLinks.ts";

describe("笔记双链", () => {
  it("uses stable encoded IDs and escapes Markdown titles", () => {
    const note = { id: "库/笔记 #1", title: "[模型](甲)\\乙" };
    const markdown = researchNoteLinkMarkdown(note);
    expect(researchNoteLinkId(researchNoteLinkUrl(note.id))).toBe(note.id);
    expect(researchTextNoteLinks(markdown)).toEqual([note.id]);
    expect(researchNoteLinkId("#research-note/%ZZ")).toBeNull();
    expect(researchNoteLinkId("https://example.com/#research-note/a")).toBeNull();
  });

  it("finds an active @ query but excludes email, code, math and escaped text", () => {
    for (const text of ["参见 @", "参见 @零阶保持", "@模型 说明", "参见@", "参见@零阶保持", "（参见）@模型"]) {
      expect(findResearchNoteMention(text, text.length)).toMatchObject({ start: text.indexOf("@"), end: text.length });
    }
    for (const text of ["reader@example.com", "\\@模型", "`@模型", "```ts\n@模型", "$@模型", "[链接](https://example.com/@模型", "正常文字"]) {
      expect(findResearchNoteMention(text, text.length)).toBeNull();
    }
  });

  it("replaces only the active mention and preserves the surrounding text and caret", () => {
    const source = "前文 @模 后文";
    const mention = findResearchNoteMention(source, 5)!;
    const result = insertResearchNoteMention(source, mention, { id: "target", title: "模型" });
    expect(result.text).toBe("前文 [模型](#research-note/target) 后文");
    expect(result.text.slice(result.caret)).toBe(" 后文");
  });

  it("indexes actual Markdown links across nested tabs and deduplicates each source", () => {
    const source = createResearchNote("来源");
    source.id = "source";
    source.blocks = [
      { id: "p", type: "paragraph", text: "引用 [旧标题](#research-note/target) 和 [再次](#research-note/target)。" },
      { id: "code", type: "markdown", kind: "code", text: "```md\n[示例](#research-note/ignored)\n```" },
      { id: "tabs", type: "examples", title: "分支", tabs: [{ id: "tab", title: "隐藏标签", blocks: [{ id: "nested", type: "paragraph", text: "[目标](#research-note/nested)" }] }] },
    ];
    expect(buildResearchNoteBacklinks([source], "target")).toMatchObject([{ noteId: "source", blockId: "p" }]);
    expect(buildResearchNoteBacklinks([source], "nested")).toMatchObject([{ noteId: "source", blockId: "nested" }]);
    expect(buildResearchNoteBacklinks([source], "ignored")).toEqual([]);
    expect(researchTextNoteLinks("`[代码](#research-note/a)` $[公式](#research-note/b)$")).toEqual([]);
  });

  it("preserves stable links through Markdown export and import, including hidden tabs", () => {
    const source = createResearchNote("来源");
    source.blocks = [{ id: "tabs", type: "examples", tabs: [
      { id: "one", title: "空白", blocks: [] },
      { id: "two", title: "引用", blocks: [{ id: "nested", type: "markdown", kind: "table", text: "| 参照 |\n| --- |\n| [旧标题](#research-note/target) |" }] },
    ] }];
    const restored = parseResearchMarkdown(serializeResearchMarkdown(source));
    expect(buildResearchNoteBacklinks([restored], "target")).toMatchObject([{ blockId: "nested" }]);
  });

  it("does not index a formula's plain-text metadata as navigable prose", () => {
    const source = createResearchNote("来源");
    source.blocks = [{ id: "formula", type: "formula", tex: "x=1", caption: "[说明示例](#research-note/target)", conditions: "[条件示例](#research-note/target)" }];
    expect(buildResearchNoteBacklinks([source], "target")).toEqual([]);
  });

  it("keeps Markdown reference and code scopes inside each separately rendered list item", () => {
    const definitions = createResearchNote("逐项引用示例");
    definitions.blocks = [{ id: "definitions", type: "list", items: ["[ref]: #research-note/target", "[示例][ref]"] }];
    const source = createResearchNote("真实引用");
    source.blocks = [{ id: "list", type: "list", items: ["```md", "[目标](#research-note/target)"] }];
    expect(buildResearchNoteBacklinks([definitions], "target")).toEqual([]);
    expect(buildResearchNoteBacklinks([source], "target")).toMatchObject([{ noteId: source.id, blockId: "list" }]);
  });
});
