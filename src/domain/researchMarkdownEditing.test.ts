import { describe, expect, it } from "vitest";
import { continueResearchMarkdownLine, researchListEditorSource } from "./researchMarkdownEditing.ts";

describe("research Markdown line editing", () => {
  it.each([
    ["- 采样", "- 采样\n- "],
    ["  * 子项", "  * 子项\n  * "],
    ["- 父项\n\t+ 子项", "- 父项\n\t+ 子项\n\t+ "],
    ["9. 推导", "9. 推导\n10. "],
    ["  09) 推导", "  09) 推导\n  10) "],
    ["- [x] 已完成", "- [x] 已完成\n- [ ] "],
    ["3. [X] 已完成", "3. [X] 已完成\n4. [ ] "],
    ["> > 引用", "> > 引用\n> > "],
    ["> 2. 步骤", "> 2. 步骤\n> 3. "],
  ])("continues %j with the matching prefix", (source, expected) => {
    expect(continueResearchMarkdownLine(source, source.length)).toEqual({ text: expected, caret: expected.length });
  });

  it("splits at the caret and replaces just the selection", () => {
    const source = "- 前半后半\n- 保留项";
    expect(continueResearchMarkdownLine(source, 4)).toEqual({ text: "- 前半\n- 后半\n- 保留项", caret: 7 });
    expect(continueResearchMarkdownLine(source, 4, 6)).toEqual({ text: "- 前半\n- \n- 保留项", caret: 7 });
  });

  it("adds Markdown markers when continuing the first item in a new plain list", () => {
    expect(continueResearchMarkdownLine("第一项", 3, 3, "list")).toEqual({ text: "- 第一项\n- ", caret: 8 });
    expect(researchListEditorSource("采样\n执行")).toBe("- 采样\n- 执行");
    expect(researchListEditorSource("")).toBe("");
  });

  it("leaves ordinary lines, inline punctuation and fenced code to native newline editing", () => {
    for (const source of ["普通段落", "结果 - 说明", "x > y", "```md\n- 字面文本", "~~~\n1. 字面文本"]) {
      expect(continueResearchMarkdownLine(source, source.length)).toBeNull();
    }
    expect(continueResearchMarkdownLine("- 字面文本", 6, 6, "code")).toBeNull();
    const afterFence = "```\n- 字面文本\n```\n- 正常项目";
    expect(continueResearchMarkdownLine(afterFence, afterFence.length)?.text).toBe(afterFence + "\n- ");
  });

  it("does not continue list-like content inside indented code or list-contained fences", () => {
    for (const source of ["说明\n\n    - 字面代码", "- ```md\n  - 字面代码", "> - ```md\n>   1. 字面代码"]) {
      expect(continueResearchMarkdownLine(source, source.length)).toBeNull();
    }
  });

  it("inserts at the start of a list source without moving past an existing newline", () => {
    expect(continueResearchMarkdownLine("\n保留项", 0, 0, "list")).toEqual({ text: "- \n- \n保留项", caret: 5 });
  });
});
