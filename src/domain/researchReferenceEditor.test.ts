import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { createReferenceDocument, referenceDocumentSource, referencePositionAt, referenceSourceOffset, researchReferenceTokens, referenceEditorSchema, referenceClipboardSource, editedResearchSymbolReference } from "./researchReferenceEditor.ts";
import { createSymbolEntry } from "./researchDictionary.ts";
import { dictionaryReferenceBindings } from "./researchTerms.ts";

const term = "[旧名](mewiki-term:term-a?display=alias&alias=alias-a)";
const symbol = "[$x_i$](mewiki-symbol:symbol-a?x2=i)";
const note = "[旧标题](#research-note/note-a)";
const file = `[文献第 3 页](webbench-asset:${"a".repeat(64)}#page=3)`;

describe("rendered reference documents", () => {
  it("keeps original Markdown verbatim while representing sourced references as atoms", () => {
    const source = `**前文** ${term}，${symbol}，${note}，${file}\n后文  \n`;
    const doc = createReferenceDocument(source);
    expect(referenceDocumentSource(doc)).toBe(source);
    const references: string[] = [];
    doc.descendants(node => { if (node.type.name === "reference") { expect(node.isAtom).toBe(true); references.push(node.attrs.kind); } });
    expect(references).toEqual(["term", "symbol", "note", "file"]);
    expect(doc.textContent).not.toContain("mewiki-term:");
  });

  it("ignores escaped links, code, math, images, external and unknown links", () => {
    const source = ["`" + term + "`", "```md\n" + term + "\n```", "$" + term + "$", "\\" + term, "!" + file, "[网页](https://example.com)", "[未知](mewiki-future:a)"].join("\n\n");
    expect(researchReferenceTokens(source)).toEqual([]);
    expect(referenceDocumentSource(createReferenceDocument(source))).toBe(source);
  });

  it("supports reference-style links without rewriting definitions or escaping", () => {
    const source = "[名称\\[A\\]][one]\n\n[one]: mewiki-term:term-a \"标题\"\n";
    const tokens = researchReferenceTokens(source);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: "term", label: "名称[A]", href: "mewiki-term:term-a", source: "[名称\\[A\\]][one]" });
    expect(referenceDocumentSource(createReferenceDocument(source))).toBe(source);
  });

  it("maps source positions to either side of an atom without placing a caret in its source", () => {
    const doc = createReferenceDocument(`前${term}后`);
    expect(referencePositionAt(doc, 1)).toBe(2);
    expect(referencePositionAt(doc, 5, -1)).toBe(2);
    expect(referencePositionAt(doc, 5, 1)).toBe(3);
    expect(referenceSourceOffset(doc, 2)).toBe(1);
    expect(referenceSourceOffset(doc, 3)).toBe(1 + term.length);
  });

  it("deletes and restores a whole reference in one history transaction", () => {
    let state = EditorState.create({ doc: createReferenceDocument(`前${term}后`), plugins: [history()] });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    state = state.apply(state.tr.delete(2, 3));
    expect(referenceDocumentSource(state.doc)).toBe("前后");
    expect(undo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(referenceDocumentSource(state.doc)).toBe(`前${term}后`);
    expect(redo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(referenceDocumentSource(state.doc)).toBe("前后");
  });

  it("preserves every line when browsers insert separate paragraphs or breaks", () => {
    const paragraph = referenceEditorSchema.nodes.paragraph;
    const doc = referenceEditorSchema.nodes.doc.create(null, [paragraph.create(null, referenceEditorSchema.text("第一行")), paragraph.create(null, referenceEditorSchema.text("第二行"))]);
    expect(referenceDocumentSource(doc)).toBe("第一行\n第二行");
    expect(referenceSourceOffset(doc, 6)).toBe(4);
    expect(referencePositionAt(doc, 4)).toBe(6);
  });

  it("makes reference-style links self-contained on the clipboard without changing their original source", () => {
    const source = "[术语][one]\n\n[one]: mewiki-term:term-a?display=full";
    const doc = createReferenceDocument(source);
    const selection = doc.slice(1, 2);
    const copied = referenceClipboardSource(selection.content);
    expect(copied).toBe("[术语](mewiki-term:term-a?display=full)");
    expect(researchReferenceTokens(copied)).toHaveLength(1);
    expect(referenceDocumentSource(doc)).toBe(source);
  });

  it("uses the first reference definition like the reading renderer", () => {
    const tokens = researchReferenceTokens("[名称][one]\n\n[one]: mewiki-term:term-a\n[one]: mewiki-term:term-b");
    expect(tokens[0].href).toBe("mewiki-term:term-a");
  });

  it("does not expose separators inside one copied reference to table paste", () => {
    const doc = createReferenceDocument("[旧\n名称](mewiki-term:term-a)");
    const copied = referenceClipboardSource(doc.firstChild!.content);
    expect(copied).not.toMatch(/[\t\r\n]/);
    expect(researchReferenceTokens(copied)).toHaveLength(1);
    expect(researchReferenceTokens(copied)[0].href).toBe("mewiki-term:term-a");
  });

  it("encodes unbalanced parentheses when copying legacy definition URLs", () => {
    const doc = createReferenceDocument("[旧][one]\n\n[one]: <mewiki-term:term(a>");
    const copied = referenceClipboardSource(doc.slice(1, 2).content);
    expect(copied).toBe("[旧](mewiki-term:term%28a)");
    expect(researchReferenceTokens(copied)).toHaveLength(1);
  });

  it("can clear a nonempty default slot for one reference without changing the dictionary", () => {
    const entry = createSymbolEntry({ name: "样本", notation: "x_{[x2]}", meaning: "样本值", category: "custom", slots: [] }, "clear-slot");
    const slot = entry.slots.find(item => item.key === "x2")!; slot.defaultValue = "n";
    const result = editedResearchSymbolReference(entry, { x2: "" });
    const token = researchReferenceTokens(result)[0];
    expect(dictionaryReferenceBindings(token.href)).toMatchObject({ x2: "" });
    expect(slot.defaultValue).toBe("n");
    expect(result).not.toContain("_n");
  });
});
