import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createResearchContentBlock, convertResearchBlockType, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown } from "./researchNotebook.ts";
import { defaultResearchNoteFilters, filterResearchNotes } from "./researchNoteOrganization.ts";
import { isPlainResearchText } from "./researchMarkdown.ts";

const markdown = [
  "# Markdown 样式", "", "# 一级标题", "", "###### 六级标题", "",
  "普通 **粗体**、*斜体*、~~删除线~~、`inline()` 和 $\\boldsymbol{x}(t)$。", "",
  "> 引用 **观点**", ">", "> > 嵌套引用", "",
  "```python", "# $x$ 与 **原文** 都是代码", "print('hello')", "```", "",
  "3. 有序项 A", "4. 有序项 B", "",
  "- [ ] 待核对", "- [x] 已完成", "",
  "嵌套列表：", "", "- 外层", "  - 内层", "",
  "| 指标 | 数值 |", "| :--- | ---: |", "| IAE | 1.2 |", "",
  "![实验示意图](/test-image.svg)", "", "---", "",
  "$$", "J=x^TQx", "$$",
].join("\n");

describe("research Markdown content", () => {
  it("recognizes literal prose including soft breaks, blank lines and repeated spaces", () => {
    for (const text of ["普通中文与 English 123。", "第一行\n第二行\n\n另一段", "alpha   beta", "第一行\r\n第二行", "使用 x_1 和 2 * 3，价格 $20。", "", " \n"]) {
      expect(isPlainResearchText(text), text).toBe(true);
    }
  });

  it("keeps Markdown structures, math, decoded escapes and entities on the rendering path", () => {
    for (const text of ["## 标题", "文字 **加粗**", "文字 *斜体*", "$x(t)$", "> 引用", "- 项目", "```js\nlet a = 1\n```", "`code`", "https://example.com", "[文献](https://example.com)", "&amp;", "\\*字面星号\\*", "第一行  \n第二行", "<!-- 注释 -->", "---"]) {
      expect(isPlainResearchText(text), text).toBe(false);
    }
  });

  it("imports common Markdown structures while preserving their source and heading depths", () => {
    const note = parseResearchMarkdown(markdown, "Markdown 样式");
    expect(note.blocks[0]).toMatchObject({ type: "heading", level: 1, text: "一级标题" });
    expect(note.blocks[1]).toMatchObject({ type: "heading", level: 6, text: "六级标题" });
    const rich = note.blocks.filter((block) => block.type === "markdown");
    expect(rich.map((block) => block.kind)).toEqual(["quote", "code", "orderedList", "taskList", "markdown", "table", "divider"]);
    expect(note.blocks.find(block => block.type === "media")).toMatchObject({ kind: "image", legacySource: "![实验示意图](/test-image.svg)" });
    expect(rich.find((block) => block.kind === "code")?.text).toContain("# $x$ 与 **原文** 都是代码\nprint('hello')");
    expect(note.blocks.at(-1)).toMatchObject({ type: "formula", tex: "J=x^TQx" });
  });

  it("keeps Markdown blocks through browser storage and export/import", () => {
    const note = parseResearchMarkdown(markdown, "Markdown 样式");
    const state = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
    const saved = normalizeResearchNotebook(JSON.parse(JSON.stringify(state)));
    expect(saved.notes.find((item) => item.id === note.id)?.blocks).toEqual(note.blocks);
    const exported = serializeResearchMarkdown(note);
    const imported = parseResearchMarkdown(exported, note.title);
    const content = (blocks: typeof note.blocks) => blocks.map(({ id: _id, ...block }) => block);
    expect(content(imported.blocks)).toEqual(content(note.blocks));
    expect(filterResearchNotes([note], { ...defaultResearchNoteFilters, query: "print('hello')" })).toEqual([note]);
  });

  it("creates source-backed blocks and preserves identity when changing their kinds", () => {
    for (const kind of ["quote", "code", "orderedList", "taskList", "table", "image", "divider"] as const) {
      expect(createResearchContentBlock(kind)).toMatchObject({ type: kind === "image" ? "media" : "markdown", kind });
    }
    const paragraph = { id: "original", type: "paragraph" as const, text: "A\nB" };
    const quote = convertResearchBlockType(paragraph, "quote")!;
    expect(quote).toMatchObject({ id: "original", type: "markdown", kind: "quote", text: "> A\n> B" });
    expect(convertResearchBlockType(quote, "paragraph")).toMatchObject({ id: "original", text: "> A\n> B" });
    expect(convertResearchBlockType(paragraph, "code")).toMatchObject({ id: "original", type: "markdown", kind: "code", text: "```text\nA\nB\n```" });
  });

  it("does not confuse longer fences, indented code, or escaped display math with prose", () => {
    const source = ["````md", "```python", "# 标题", "```", "````", "", "    value = 2", "", "\\[", "x(t)=0", "\\]"].join("\n");
    const note = parseResearchMarkdown(source);
    expect(note.blocks).toHaveLength(3);
    expect(note.blocks[0]).toMatchObject({ type: "markdown", kind: "code", text: source.split("\n\n")[0] });
    expect(note.blocks[1]).toMatchObject({ type: "markdown", kind: "code", text: "    value = 2" });
    expect(note.blocks[2]).toMatchObject({ type: "formula", tex: "x(t)=0" });
  });

  it("keeps reference links and footnote definitions in one rendering context", () => {
    const source = "# 引用语法\n\n参考 [文献][paper] 与结论[^1]。\n\n[paper]: https://example.com/paper\n\n[^1]: 控制性能说明。";
    const note = parseResearchMarkdown(source, "引用语法");
    expect(note.blocks).toHaveLength(1);
    const text = source.split("\n\n").slice(1).join("\n\n");
    expect(note.blocks[0]).toMatchObject({ type: "markdown", kind: "markdown", text });
    expect(parseResearchMarkdown(serializeResearchMarkdown(note), note.title).blocks[0]).toMatchObject({ type: "markdown", text });
  });
});
