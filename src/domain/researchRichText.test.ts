import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { splitBlock, toggleMark } from "prosemirror-commands";
import { splitListItem } from "prosemirror-schema-list";
import { createReferenceDocument, referenceDocumentSource, referencePositionAt, referenceSourceOffset } from "./researchReferenceEditor.ts";

describe("rendered Markdown editing", () => {
  it("represents headings and emphasis as editable formatting rather than source characters", () => {
    const source = "## 标题 **重点**\n\n普通 *斜体*、~~删除~~ 和 `代码`。";
    const doc = createReferenceDocument(source);
    expect(doc.firstChild!.type.name).toBe("heading");
    expect(doc.textContent).toBe("标题 重点普通 斜体、删除 和 代码。");
    const marks: string[] = [];
    doc.descendants(node => { node.marks.forEach(mark => marks.push(mark.type.name)); });
    expect(marks).toEqual(expect.arrayContaining(["strong", "em", "strike", "code"]));
    expect(referenceDocumentSource(doc)).toBe(source);
  });

  it("keeps Markdown syntax and source positions when editing inside formatted text", () => {
    const source = "## 标题 __重点__ 与 \\*原文\\* &amp;\n\n> 引用\n> 第二行\n\n- 项目 **内容**\n- 下一项\n";
    let state = EditorState.create({ doc: createReferenceDocument(source), plugins: [history()] });
    const at = source.indexOf("重点") + 1, position = referencePositionAt(state.doc, at);
    expect(referenceSourceOffset(state.doc, position)).toBe(at);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)).insertText("新增"));
    expect(referenceDocumentSource(state.doc)).toBe(source.replace("重点", "重新增点"));
    expect(undo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(referenceDocumentSource(state.doc)).toBe(source);
  });

  it("renders nested lists, tasks, quotes and math without discarding their original source", () => {
    const source = "> **提示**\n>\n> 续行\n\n3. 第一项\n   - 子项\n4. 第二项\n\n- [x] 完成\n- [ ] 待办\n\n$x_i$\n\n$$\nx^2\n$$\n";
    const doc = createReferenceDocument(source), types: string[] = [];
    doc.descendants(node => { types.push(node.type.name); });
    expect(types).toEqual(expect.arrayContaining(["blockquote", "ordered_list", "bullet_list", "list_item", "inline_math", "math_block"]));
    expect(referenceDocumentSource(doc)).toBe(source);
    for (const text of ["提示", "子项", "第二项", "完成"]) {
      const offset = source.indexOf(text) + 1;
      expect(referenceSourceOffset(doc, referencePositionAt(doc, offset))).toBe(offset);
    }
  });

  it("keeps a stable reference atomic inside bold text", () => {
    const source = "**前[旧名](mewiki-term:a)后**";
    const doc = createReferenceDocument(source), found: string[] = [];
    doc.descendants(node => { if (node.type.name === "reference") { found.push(node.attrs.source); expect(node.marks[0].type.name).toBe("strong"); } });
    expect(found).toEqual(["[旧名](mewiki-term:a)"]);
    expect(doc.textContent).toBe("前旧名后");
    expect(referenceDocumentSource(doc)).toBe(source);
  });

  it("retains new paragraph boundaries after Enter instead of merging them during normalization", () => {
    let state = EditorState.create({ doc: createReferenceDocument("普通正文") });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(splitBlock(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(referenceDocumentSource(state.doc)).toBe("普通\n\n正文");
    expect(createReferenceDocument(referenceDocumentSource(state.doc)).childCount).toBe(2);
  });

  it("continues an existing list with an editable empty item and preserves its source offsets", () => {
    let state = EditorState.create({ doc: createReferenceDocument("- 第一项\n- 第二项") });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, referencePositionAt(state.doc, 5))));
    expect(splitListItem(state.schema.nodes.list_item)(state, transaction => { state = state.apply(transaction); })).toBe(true);
    const source = referenceDocumentSource(state.doc);
    expect(source).toBe("- 第一项\n- \n- 第二项");
    state = state.apply(state.tr.insertText("新增"));
    expect(referenceDocumentSource(state.doc)).toBe("- 第一项\n- 新增\n- 第二项");
    expect(referenceSourceOffset(state.doc, state.selection.from)).toBe("- 第一项\n- 新增".length);
  });

  it("keeps the next paragraph separate when changing the formatting of a selected word", () => {
    let state = EditorState.create({ doc: createReferenceDocument("第一段\n\n第二段") });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 4)));
    toggleMark(state.schema.marks.strong)(state, transaction => { state = state.apply(transaction); });
    expect(referenceDocumentSource(state.doc)).toBe("**第一段**\n\n第二段");
  });

  it("preserves literal punctuation and valid external links after adding formatting", () => {
    for (const source of ["正文\\*符号\\*", "[正文](<https://example.com/a b>)"]) {
      let state = EditorState.create({ doc: createReferenceDocument(source) });
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
      toggleMark(state.schema.marks.strong)(state, transaction => { state = state.apply(transaction); });
      state = state.apply(state.tr.insertText("新增"));
      const saved = referenceDocumentSource(state.doc), restored = createReferenceDocument(saved);
      expect(restored.textContent).toBe("正新增文" + (source.startsWith("[") ? "" : "*符号*"));
      let link = ""; restored.descendants(node => { link ||= node.marks.find(mark => mark.type.name === "link")?.attrs.href ?? ""; });
      if (source.startsWith("[")) expect(decodeURI(link)).toBe("https://example.com/a b");
    }
  });

  it("edits literal code content without changing fence language or interpreting escapes", () => {
    for (const source of ["```js\njs\n```", "```text\na \\* b &amp;\n```", "`\\*`", "`` `value` ``"]) {
      const doc = createReferenceDocument(source);
      let position = 0;
      doc.descendants((node, at) => { if (node.isText) position = at + node.nodeSize; });
      const state = EditorState.create({ doc });
      const next = state.apply(state.tr.insertText("X", position));
      const restored = createReferenceDocument(referenceDocumentSource(next.doc));
      expect(restored.textContent).toBe(doc.textContent + "X");
      if (doc.firstChild!.type.name === "code_block") expect(restored.firstChild!.attrs.language).toBe(doc.firstChild!.attrs.language);
    }
  });

  it("saves emphasis after typing surrounding spaces and code after typing delimiters", () => {
    for (const [source, text] of [["**重点**", " "], ["*重点*", " "], ["`value`", "`"], ["```text\nvalue\n```", "\n```\nother"]]) {
      const doc = createReferenceDocument(source); let position = 0;
      doc.descendants((node, at) => { if (node.isText) position = at + node.nodeSize; });
      const state = EditorState.create({ doc }), next = state.apply(state.tr.insertText(text, position));
      const restored = createReferenceDocument(referenceDocumentSource(next.doc));
      expect(restored.textContent.trimEnd()).toBe((doc.textContent + text).trimEnd());
      expect(restored.firstChild!.type.name).toBe(doc.firstChild!.type.name);
      let bold = false; restored.descendants(node => { if (node.marks.some(mark => mark.type.name === "strong" || mark.type.name === "em")) bold = true; });
      if (source.startsWith("*")) expect(bold).toBe(true);
    }
  });

  it("keeps escaped formula, HTML and entity characters literal after structural formatting", () => {
    for (const source of ["正文 \\$x\\$", "正文 \\<tag>", "正文 \\&amp;"]) {
      let state = EditorState.create({ doc: createReferenceDocument(source) });
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)));
      toggleMark(state.schema.marks.strong)(state, transaction => { state = state.apply(transaction); });
      const saved = referenceDocumentSource(state.doc), restored = createReferenceDocument(saved);
      expect(restored.textContent).toBe(state.doc.textContent);
      expect(referenceSourceOffset(state.doc, 2)).toBeGreaterThan(0);
    }
  });
});
