import { describe, expect, it } from "vitest";
import { researchCaptionInputValue, researchTextEditorState, researchTitleInputValue } from "./researchTextPlaceholders.ts";
import { parseResearchTable } from "./researchTable.ts";

describe("research editing placeholders", () => {
  it("removes complete legacy hints from the editing draft and preserves authored text around them", () => {
    const cases = [
      ["paragraph", "点击此处记录研究内容。", ""], ["heading", "### 新标题", "### "],
      ["list", "新增条目", ""], ["callout", "在此记录需要强调的内容。", ""],
      ["quote", "> 在此记录引用内容。", "> "], ["code", "```python\n# 在此输入代码\n```", "```python\n\n```"],
      ["orderedList", "1. 第一项\n2. 第二项", "1. "], ["taskList", "- [ ] 待完成事项", "- [ ] "],
      ["markdown", "记录 Markdown 内容。", ""], ["image", "![图片说明]()", "![]()"],
    ];
    for (const [kind, legacy, source] of cases) {
      expect(researchTextEditorState(legacy, kind)).toMatchObject({ source, empty: true });
      const authored = legacy + "\n用户保留的补充";
      expect(researchTextEditorState(authored, kind).source).toBe(authored);
    }
    expect(researchTextEditorState("新标题", "paragraph").source).toBe("新标题");
  });

  it("places the caret inside empty code and image scaffolds and keeps the table cells empty", () => {
    expect(researchTextEditorState("```python\n\n```", "code").caret).toBe(10);
    expect(researchTextEditorState("![]()", "image").caret).toBe(2);
    const source = "| 项目 | 内容 |\n| :--- | :--- |\n| 第一项 | 填写内容 |";
    expect(parseResearchTable(researchTextEditorState(source, "table").source)?.rows).toEqual([["", ""], ["", ""]]);
    const populated = source.replace("填写内容", "实验观察");
    expect(researchTextEditorState(populated, "table").source).toBe(populated);
  });

  it("uses empty fields for legacy unnamed titles and caption hints without stripping actual names", () => {
    expect(researchTitleInputValue("未命名笔记")).toBe("");
    expect(researchTitleInputValue("未命名基础理论")).toBe("");
    expect(researchTitleInputValue("未命名笔记的整理")).toBe("未命名笔记的整理");
    expect(researchCaptionInputValue("公式说明")).toBe("");
    expect(researchCaptionInputValue("模型公式说明")).toBe("模型公式说明");
  });
});
