import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { type ResearchFormulaBlock, type ResearchNotebookState } from "./researchNotebook.ts";
import { formulaPartsToTex, type FormulaPart } from "./researchDictionary.ts";
import {
  FORMULA_CLIPBOARD_MIME,
  cloneFormulaParts,
  moveFormulaSelection,
  normalizeFormulaSelection,
  parseFormulaClipboard,
  parseFormulaClipboardData,
  parseFormulaText,
  replaceFormulaSelection,
  serializeFormulaSelection,
} from "./formulaTransfer.ts";

const op = (operator: Extract<FormulaPart, { type: "operator" }>['operator']): FormulaPart => ({ type: "operator", operator });
const symbol = (entryId: string, bindings: Record<string, string> = {}): Extract<FormulaPart, { type: "symbol" }> => ({ type: "symbol", entryId, bindings });

describe("formula transfer transactions", () => {
  it("preserves custom LaTeX atoms across rendering, selection, clipboard and undoable replacement", () => {
    const parts: FormulaPart[] = [{ type: "latex", tex: "\\mathscr{F}\\!\\left[\\frac{a}{b}\\right]" }];
    expect(formulaPartsToTex(parts, []).tex).toBe("{\\mathscr{F}\\!\\left[\\frac{a}{b}\\right]}");
    const copied = serializeFormulaSelection(parts, [], { start: 0, end: 1 });
    expect(parseFormulaClipboard(copied.custom, []).parts).toEqual(parts);
    const target = [op("one")];
    const replaced = replaceFormulaSelection(target, { start: 0, end: 1 }, parts);
    expect(replaced.error).toBeUndefined();
    expect(replaced.parts).toEqual(parts);
    expect(target).toEqual([op("one")]);
    expect(cloneFormulaParts(parts)).toEqual(parts);
  });

  it("rejects incomplete custom LaTeX before changing the target expression", () => {
    const original = [op("one")];
    for (const tex of ["", "\\sqrt{", "a&b", "a\\\\b", "\\htmlClass{outside}{x}"]) {
      const result = replaceFormulaSelection(original, { start: 0, end: 1 }, [{ type: "latex", tex }]);
      expect(result.error, tex).toBeTruthy();
      expect(result.parts, tex).toBe(original);
    }
  });

  it("parses new radicals and preserves function command boundaries before dictionary variables", () => {
    const state = createResearchNotebook();
    const parsed = parseFormulaText("\\sqrt[3]{9}+\\sqrt{\\alpha^2+1}+\\left\\lfloor\\frac{3}{2}\\right\\rfloor", state.symbols);
    expect(parsed.error).toBeUndefined();
    expect(parsed.parts).toContainEqual(op("squareRoot"));
    expect(parsed.parts).toContainEqual(op("cubeRoot"));
    expect(parsed.parts).toContainEqual(op("floorOpen"));
    const parts = [op("sine"), symbol("example-index")];
    expect(formulaPartsToTex(parts, state.symbols).tex).toBe("\\sin p");
    expect(parseFormulaText(formulaPartsToTex(parts, state.symbols).tex, state.symbols).error).toBeUndefined();
    expect(parseFormulaText("1,\\,2\\cdots3", []).parts).toEqual([op("one"), op("comma"), op("two"), op("centerDots"), op("three")]);
  });

  it("matches a complete pasted TeX equation while retaining literal symbol positions", () => {
    const state = createResearchNotebook();
    const parsed = parseFormulaText("\\[\\boldsymbol{u}(t)=-\\boldsymbol{K}\\boldsymbol{x}(t)+\\frac{1}{2}\\]", state.symbols);
    expect(parsed.error).toBeUndefined();
    expect(parsed.parts).toEqual([
      symbol("example-input", { x1: "", x2: "", x3: "(t)" }), op("equals"), op("minus"),
      symbol("example-matrix", { x1: "", x2: "", x3: "" }), symbol("example-vector", { x1: "", x2: "", x3: "(t)" }), op("plus"),
      op("fractionStart"), op("one"), op("fractionDivide"), op("two"), op("groupClose"),
    ]);
  });

  it("parses wrapped multiline TeX and round-trips a text-only selection", () => {
    const state = createResearchNotebook();
    const parts: FormulaPart[] = [symbol("example-index", { x1: "", x2: "", x3: "" }), { type: "alignmentPoint" }, op("equals"), op("one"), { type: "lineBreak" }, symbol("example-count", { x1: "", x2: "", x3: "" }), { type: "alignmentPoint" }, op("equals"), op("two")];
    const copied = serializeFormulaSelection(parts, state.symbols, { start: 0, end: parts.length });
    expect(parseFormulaText(`$$${copied.text}$$`, state.symbols)).toMatchObject({ parts, layout: "aligned" });
    expect(parseFormulaText("\\(\\begin{gathered}p=1\\\\P=2\\end{gathered}\\)", state.symbols)).toMatchObject({ layout: "centered" });
  });

  it("preserves mixed interval delimiters and rejects missing or mismatched TeX groups", () => {
    const state = createResearchNotebook();
    expect(parseFormulaText("\\left(p+1\\right]", state.symbols).parts).toEqual([op("leftParen"), symbol("example-index", { x1: "", x2: "", x3: "" }), op("plus"), op("one"), op("rightBracket")]);
    for (const text of ["\\left(p+1\\right", "\\left(p+1\\right\\}", "\\frac{1}{2", "p_{h", "p^{1}^{2}"]) {
      expect(parseFormulaText(text, state.symbols).error, text).toBeTruthy();
    }
  });

  it("parses common TeX operator aliases, punctuation and style-only spacing", () => {
    const state = createResearchNotebook();
    expect(parseFormulaText("p\\leq P,\\; h\\neq 0", state.symbols).error).toBeUndefined();
    expect(parseFormulaText("\\dfrac{1}{2}", state.symbols).parts).toEqual([op("fractionStart"), op("one"), op("fractionDivide"), op("two"), op("groupClose")]);
  });

  it("matches one-atom TeX groups inside script arguments and allows either script order", () => {
    const state = createResearchNotebook();
    for (const text of ["1^{p}", "\\frac{1}{2}^{p}", "\\sum_{p=1}^{P}p"]) expect(parseFormulaText(text, state.symbols).error, text).toBeUndefined();
    expect(parseFormulaText("p_{h}^{1}", state.symbols).parts).toEqual([symbol("example-index", { x1: "1", x2: "h", x3: "" })]);
    expect(parseFormulaText("p_1^2", state.symbols).parts).toEqual([symbol("example-index", { x1: "2", x2: "1", x3: "" })]);
    expect(parseFormulaText("p^{1}^{2}", state.symbols).error).toBeTruthy();
    expect(parseFormulaText("p_{1}_{2}", state.symbols).error).toBeTruthy();
  });

  it("limits unbraced scripts to a single TeX atom without swallowing the next script or argument", () => {
    const state = createResearchNotebook();
    for (const [text, expected] of [
      ["1^p_h", "1^{p}_{h}"],
      ["\\frac{1}{2}^p_h", "\\frac{1}{2}^{p}_{h}"],
      ["\\sum^P_p p", "\\sum^{P}_{p}p"],
      ["1_p^h", "1_{p}^{h}"],
      ["1^p(t)", "1^{p}\\left(t\\right)"],
      ["1^\\epsilon_p", "1^{\\epsilon}_{p}"],
    ]) {
      const parsed = parseFormulaText(text, state.symbols);
      expect(parsed.error, text).toBeUndefined();
      expect(formulaPartsToTex(parsed.parts!, state.symbols).tex, text).toBe(expected);
    }
  });

  it("round-trips supported norm, trace and expectation structures through TeX text", () => {
    const state = createResearchNotebook();
    for (const parts of [
      [op("normOpen"), op("one"), op("normCloseSquared")],
      [op("traceOpen"), symbol("example-I", { x1: "", x2: "", x3: "" }), op("traceClose")],
      [op("expectationOpen"), op("one"), op("conditionalBar"), op("two"), op("expectationClose")],
      [op("cardinalityOpen"), symbol("example-empty", { x1: "", x2: "", x3: "" }), op("cardinalityClose")],
    ]) {
      const copied = serializeFormulaSelection(parts, state.symbols, { start: 0, end: parts.length });
      expect(parseFormulaText(copied.text, state.symbols).parts, copied.text).toEqual(parts);
    }
  });

  it("does not guess duplicate dictionary meanings and bounds TeX nesting before parsing", () => {
    const state = createResearchNotebook();
    const entry = state.symbols.find(value => value.id === "example-index")!;
    expect(parseFormulaText("p+1", [...state.symbols, { ...entry, id: "other-p", name: "另一个含义" }]).error).toMatch(/多个|歧义/);
    const text = "\\left(".repeat(5000) + "1" + "\\right)".repeat(5000);
    expect(parseFormulaText(text, state.symbols).error).toMatch(/嵌套层数/);
  });
  it("expands a cross-structure selection to a complete fraction while keeping inner selections local", () => {
    const state = createResearchNotebook();
    const parts: FormulaPart[] = [
      symbol("example-index"),
      op("fractionStart"),
      op("one"),
      op("fractionDivide"),
      symbol("example-count"),
      op("groupClose"),
      op("plus"),
      symbol("time"),
    ];
    expect(normalizeFormulaSelection(parts, state.symbols, 2, 3)).toEqual({ start: 2, end: 3 });
    expect(normalizeFormulaSelection(parts, state.symbols, 2, 5)).toEqual({ start: 1, end: 6 });
    expect(normalizeFormulaSelection(parts, state.symbols, 1, 6)).toEqual({ start: 1, end: 6 });
    expect(normalizeFormulaSelection(parts, state.symbols, 3, 3)).toEqual({ start: 3, end: 3 });
    const scripted = [symbol("example-count"), op("superscriptStart"), op("one"), op("groupClose")];
    expect(normalizeFormulaSelection(scripted, state.symbols, 0, 1)).toEqual({ start: 0, end: 4 });
    expect(normalizeFormulaSelection(scripted, state.symbols, 2, 3)).toEqual({ start: 2, end: 3 });
  });

  it("serializes a deep copy with source provenance and rejects dictionary drift", () => {
    const source = { noteId: "source", formulaId: "gain", outputId: "result" };
    const state = createResearchNotebook();
    const parts: FormulaPart[] = [symbol("example-matrix", { x1: "(p)" }), op("plus"), { ...symbol("example-count"), source }];
    const serialized = serializeFormulaSelection(parts, state.symbols, { start: 0, end: 3 });
    expect(serialized.custom).toContain('"version":1');
    expect(serialized.data).toBe(serialized.custom);
    expect(serialized.text).toContain("+");
    expect(serialized.payload.parts).not.toBe(parts);
    (serialized.payload.parts[0] as Extract<FormulaPart, { type: "symbol" }>).bindings.x1 = "(q)";
    expect((parts[0] as Extract<FormulaPart, { type: "symbol" }>).bindings.x1).toBe("(p)");

    const parsed = parseFormulaClipboard(serialized.custom, state.symbols);
    expect(parsed.error).toBeUndefined();
    expect(parsed.parts).toEqual(parts);
    const changed = state.symbols.map((entry) => entry.id === "example-matrix" ? { ...entry, notation: "Z^{[x1]}_{[x2]}[x3]" } : entry);
    expect(parseFormulaClipboard(serialized.custom, changed).error).toMatch(/改变|不存在/);
    expect(FORMULA_CLIPBOARD_MIME).toBe("application/x-webbench-formula+json");
  });

  it("replaces and moves atomically, preserving the original array on invalid structure or source", () => {
    const state = createResearchNotebook();
    const original: FormulaPart[] = [symbol("example-index"), op("equals"), symbol("time")];
    const replacement = replaceFormulaSelection(original, { start: 1, end: 2 }, [op("plus")], { state });
    expect(replacement.error).toBeUndefined();
    expect(replacement.parts).toEqual([original[0], op("plus"), original[2]]);
    expect(original).toEqual([symbol("example-index"), op("equals"), symbol("time")]);

    const moved = moveFormulaSelection(replacement.parts, { start: 2, end: 3 }, 0, { state });
    expect(moved.error).toBeUndefined();
    expect(moved.parts).toEqual([symbol("time"), symbol("example-index"), op("plus")]);
    expect(moveFormulaSelection(moved.parts, { start: 0, end: 2 }, 1, { state }).changed).toBe(false);

    const bad: FormulaPart[] = [op("fractionStart"), symbol("example-index")];
    const failed = replaceFormulaSelection(original, { start: 0, end: 1 }, bad, { state });
    expect(failed.error).toMatch(/缺少匹配|公式/);
    expect(failed.parts).toBe(original);
  });

  it("rejects a pasted source that would create a derivation cycle", () => {
    const base = createResearchNotebook();
    const sourceFormula: ResearchFormulaBlock = {
      id: "source",
      type: "formula",
      tex: "",
      parts: [{ ...symbol("example-matrix", { x1: "(p)" }), source: { noteId: "note", formulaId: "consumer", outputId: "consumer-result" } }],
      outputs: [{ id: "result", entryId: "example-matrix", bindings: { x1: "(p)" } }],
    };
    const consumerParts: FormulaPart[] = [symbol("example-matrix", { x1: "(q)" },)];
    const consumer: ResearchFormulaBlock = {
      id: "consumer",
      type: "formula",
      tex: "",
      parts: consumerParts,
      outputs: [{ id: "consumer-result", entryId: "example-matrix", bindings: { x1: "(q)" } }],
    };
    const state: ResearchNotebookState = {
      ...base,
      activeNoteId: "note",
      notes: [{ id: "note", title: "循环", createdAt: "today", updatedAt: "today", blocks: [sourceFormula, consumer] }],
    };
    const linked: FormulaPart = { ...symbol("example-matrix", { x1: "(q)" }), source: { noteId: "note", formulaId: "source", outputId: "result" } };
    const result = replaceFormulaSelection(consumerParts, { start: 0, end: 1 }, [linked], { state, owner: { noteId: "note", formulaId: "consumer" } });
    expect(result.error).toMatch(/循环|自身/);
    expect(result.parts).toBe(consumerParts);
  });

  it("accepts dictionary-backed TeX text and rejects unknown commands", () => {
    const state = createResearchNotebook();
    expect(parseFormulaText("+", state.symbols).parts).toEqual([op("plus")]);
    expect(parseFormulaText("\\unknown{K}+1", state.symbols).error).toMatch(/没有对应|未支持/);
    expect(parseFormulaClipboardData({ text: "+" }, state.symbols).parts).toEqual([op("plus")]);
    expect(parseFormulaClipboardData({ custom: "{}", text: "+" }, state.symbols).error).toMatch(/版本/);
  });

  it("does not alias nested bindings during a move", () => {
    const state = createResearchNotebook();
    const original: FormulaPart[] = [symbol("example-index", { x1: "(p)" }), op("plus"), symbol("time", { x3: "(t)" })];
    const moved = moveFormulaSelection(original, { start: 0, end: 1 }, 3, { state });
    expect(moved.parts).toEqual([op("plus"), original[2], original[0]]);
    (moved.parts[2] as Extract<FormulaPart, { type: "symbol" }>).bindings.x1 = "(q)";
    expect((original[0] as Extract<FormulaPart, { type: "symbol" }>).bindings.x1).toBe("(p)");
    expect(cloneFormulaParts(original)).toEqual(original);
  });

  it("inserts at an empty caret range but refuses empty or incomplete copies", () => {
    const state = createResearchNotebook();
    const original: FormulaPart[] = [symbol("example-count")];
    const result = replaceFormulaSelection(original, { start: 1, end: 1 }, [op("plus"), op("one")], { state });
    expect(result.changed).toBe(true);
    expect(result.parts).toEqual([symbol("example-count"), op("plus"), op("one")]);
    expect(() => serializeFormulaSelection(original, state.symbols, { start: 1, end: 1 })).toThrow(/选区/);
    const fraction = [op("fractionStart"), op("one"), op("fractionDivide"), op("two"), op("groupClose")];
    expect(() => serializeFormulaSelection(fraction, state.symbols, { start: 1, end: 4 })).toThrow(/完整/);
    expect(moveFormulaSelection(fraction, { start: 0, end: 1 }, 5, { state }).parts).toBe(fraction);
  });

  it("rejects damaged payloads and unmatched bindings without falling back to plausible text", () => {
    const state = createResearchNotebook();
    const original = [symbol("example-count", { x2: "j" })];
    const payload = serializeFormulaSelection(original, state.symbols, { start: 0, end: 1 }).payload;
    expect(parseFormulaClipboard("broken-json", state.symbols).error).toMatch(/损坏/);
    expect(parseFormulaClipboard(JSON.stringify({ ...payload, version: 999 }), state.symbols).error).toMatch(/版本/);
    expect(parseFormulaClipboard(JSON.stringify({ ...payload, parts: [{ ...original[0], bindings: { x2: 17 } }] }), state.symbols).error).toMatch(/无法识别/);
    const parts = [symbol("example-count", { x2: "{" })];
    const result = replaceFormulaSelection(original, { start: 0, end: 1 }, parts, { state });
    expect(result.error).toMatch(/无法显示|角标/);
    expect(result.parts).toBe(original);
  });

  it("refuses layout markers in nested regions and centered layout", () => {
    const state = createResearchNotebook();
    const fraction = [op("fractionStart"), op("one"), op("fractionDivide"), op("two"), op("groupClose")];
    const nested = replaceFormulaSelection(fraction, { start: 1, end: 1 }, [{ type: "lineBreak" }], { state });
    expect(nested.error).toMatch(/主公式/);
    expect(nested.parts).toBe(fraction);
    const original = [symbol("example-count")];
    const aligned = replaceFormulaSelection(original, { start: 0, end: 0 }, [{ type: "alignmentPoint" }], { state, layout: "centered" });
    expect(aligned.error).toMatch(/居中/);
    expect(aligned.parts).toBe(original);
  });

  it("round-trips a multiline selection and keeps repeated pastes independent", () => {
    const state = createResearchNotebook();
    const selected: FormulaPart[] = [symbol("example-index", { x2: "j" }), op("equals"), op("one"), { type: "lineBreak" }, symbol("example-count"), { type: "alignmentPoint" }, op("equals"), op("two")];
    const serialized = serializeFormulaSelection(selected, state.symbols, { start: 0, end: selected.length });
    const parsed = parseFormulaClipboard(serialized.custom, state.symbols);
    expect(parsed.error).toBeUndefined();
    expect(parsed.text).toContain("\\begin{aligned}");
    const first = replaceFormulaSelection([], { start: 0, end: 0 }, parsed.parts!, { state });
    const second = replaceFormulaSelection(first.parts, { start: first.caret, end: first.caret }, parsed.parts!, { state });
    expect(second.changed).toBe(true);
    expect(second.parts).toHaveLength(2 * selected.length);
    (second.parts[selected.length] as Extract<FormulaPart, { type: "symbol" }>).bindings.x2 = "k";
    expect((second.parts[0] as Extract<FormulaPart, { type: "symbol" }>).bindings.x2).toBe("j");
    expect((parsed.parts![0] as Extract<FormulaPart, { type: "symbol" }>).bindings.x2).toBe("j");
  });

  it("moves numerator content into a denominator and preserves the complete enclosing fraction", () => {
    const state = createResearchNotebook();
    const fraction = [op("fractionStart"), symbol("example-index"), op("plus"), op("one"), op("fractionDivide"), symbol("example-count"), op("groupClose")];
    const range = normalizeFormulaSelection(fraction, state.symbols, 4, 2);
    expect(range).toEqual({ start: 2, end: 4 });
    const result = moveFormulaSelection(fraction, range, 6, { state });
    expect(result.error).toBeUndefined();
    expect(result.parts).toEqual([op("fractionStart"), symbol("example-index"), op("fractionDivide"), symbol("example-count"), op("plus"), op("one"), op("groupClose")]);
    expect(result.selection).toEqual({ start: 4, end: 6 });
  });

  it("rejects missing, mismatched and self-referencing sources without changing the destination", () => {
    const base = createResearchNotebook();
    const original: FormulaPart[] = [symbol("example-count")];
    const state: ResearchNotebookState = {
      ...base,
      notes: [{ id: "note", title: "来源", createdAt: "today", updatedAt: "today", blocks: [
        { id: "source", type: "formula", tex: "", parts: [], outputs: [{ id: "out", entryId: "example-matrix", bindings: {} }] },
        { id: "destination", type: "formula", tex: "", parts: original, outputs: [{ id: "own", entryId: "example-count", bindings: {} }] },
      ] }],
    };
    const options = { state, owner: { noteId: "note", formulaId: "destination" } };
    for (const source of [
      { noteId: "note", formulaId: "missing", outputId: "out" },
      { noteId: "note", formulaId: "source", outputId: "out" },
      { noteId: "note", formulaId: "destination", outputId: "own" },
    ]) {
      const inserted: FormulaPart = { ...symbol("example-count"), source };
      const result = replaceFormulaSelection(original, { start: 0, end: 1 }, [inserted], options);
      expect(result.changed).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.parts).toBe(original);
    }
  });

  it("rejects tampered text and oversized nesting before it reaches the renderer", () => {
    const state = createResearchNotebook();
    const serialized = serializeFormulaSelection([symbol("example-count")], state.symbols, { start: 0, end: 1 });
    const payload = JSON.parse(serialized.custom);
    payload.text = "unrelated";
    expect(parseFormulaClipboard(JSON.stringify(payload), state.symbols).error).toMatch(/校验/);
    const original = [symbol("example-count")];
    const deeplyNested = [...Array.from({ length: 130 }, () => op("leftParen")), op("one"), ...Array.from({ length: 130 }, () => op("rightParen"))];
    const result = replaceFormulaSelection(original, { start: 0, end: 1 }, deeplyNested, { state });
    expect(result.error).toMatch(/嵌套层数/);
    expect(result.parts).toBe(original);
  });

  it("keeps the returned selection complete when a moved symbol acquires an existing exponent", () => {
    const state = createResearchNotebook();
    const original = [symbol("example-count"), op("superscriptStart"), op("one"), op("groupClose"), op("plus"), symbol("example-index")];
    const moved = moveFormulaSelection(original, { start: 5, end: 6 }, 1, { state });
    expect(moved.error).toBeUndefined();
    expect(moved.parts).toEqual([symbol("example-count"), symbol("example-index"), op("superscriptStart"), op("one"), op("groupClose"), op("plus")]);
    expect(moved.selection).toEqual({ start: 1, end: 5 });
    expect(moved.caret).toBe(moved.selection.end);
    const copied = serializeFormulaSelection(moved.parts, state.symbols, moved.selection);
    expect(parseFormulaClipboard(copied.custom, state.symbols).parts).toEqual(moved.parts.slice(1, 5));
    const movedAgain = moveFormulaSelection(moved.parts, moved.selection, 0, { state });
    expect(movedAgain.error).toBeUndefined();
    expect(movedAgain.changed).toBe(true);
    expect(movedAgain.selection).toEqual({ start: 0, end: 4 });
    expect(movedAgain.caret).toBe(movedAgain.selection.end);
    expect(() => serializeFormulaSelection(movedAgain.parts, state.symbols, movedAgain.selection)).not.toThrow();
  });

  it("does not downgrade an empty or whitespace custom payload to text", () => {
    const state = createResearchNotebook();
    for (const custom of ["", "   ", "\n\t"]) {
      const result = parseFormulaClipboardData({ custom, text: "+" }, state.symbols);
      expect(result.parts).toBeUndefined();
      expect(result.error).toMatch(/没有可识别/);
    }
    expect(parseFormulaClipboardData({ custom: undefined, text: "+" }, state.symbols).parts).toEqual([op("plus")]);
  });
});
