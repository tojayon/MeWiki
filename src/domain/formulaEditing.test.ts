import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import katex from "katex";

import { formulaPartsToTex, type FormulaPart } from "./researchDictionary.ts";
import { buildFormulaEditModel, insertFormulaPart, removeFormulaPart, nearestFormulaCaret } from "./formulaEditing.ts";

const op = (operator: Extract<FormulaPart, { type: "operator" }>["operator"]): FormulaPart => ({ type: "operator", operator });
const symbol = (entryId: string): FormulaPart => ({ type: "symbol", entryId, bindings: {} });
const render = (tex: string) => katex.renderToString(tex, { displayMode: true, throwOnError: true, trust: (context) => context.command === "\\htmlClass", strict: "ignore" });
const state = createResearchNotebook();

describe("formula caret editing", () => {
  it("preserves fractions, limits and attached exponents in every seeded equation", () => {
    const formulas = state.notes.flatMap((note) => note.blocks.filter((block) => block.type === "formula" && block.parts));
    for (const formula of formulas) {
      if (formula.type !== "formula") continue;
      const model = buildFormulaEditModel(formula.parts!, state.symbols);
      expect(model.errors, formula.caption).toEqual([]);
      const interactive = render(model.tex);
      const plain = render(formulaPartsToTex(formula.parts!, state.symbols).tex);
      for (const tag of ["mfrac", "msup", "msub", "msubsup", "munderover", "munder", "mover"]) {
        expect(interactive.match(new RegExp("<" + tag + "[ >]", "g"))?.length ?? 0, formula.caption + ": " + tag)
          .toBe(plain.match(new RegExp("<" + tag + "[ >]", "g"))?.length ?? 0);
      }
    }
  });

  it("inserts between existing items without changing their dictionary bindings", () => {
    const parts: FormulaPart[] = [symbol("example-index"), op("equals"), symbol("example-count")];
    const result = insertFormulaPart(parts, 1, op("plus"));
    expect(result.parts).toEqual([parts[0], op("plus"), parts[1], parts[2]]);
    expect(result.caret).toBe(2);
    expect(parts).toHaveLength(3);
  });

  it("keeps row breaks and alignment points as editable positions in the rendered equation", () => {
    const parts: FormulaPart[] = [symbol("example-index"), op("equals"), symbol("time")];
    const broken = insertFormulaPart(parts, 2, { type: "lineBreak" });
    expect(broken.caret).toBe(3);
    expect(broken.parts[2]).toEqual({ type: "lineBreak" });

    const aligned = insertFormulaPart(broken.parts, 1, { type: "alignmentPoint" });
    const model = buildFormulaEditModel(aligned.parts, state.symbols, "aligned");
    expect(model.errors).toEqual([]);
    expect(model.positions).toHaveLength(aligned.parts.length + 1);
    expect(() => render(model.tex)).not.toThrow();
    expect(model.tex).toContain("\\begin{aligned}");
    expect(model.tex).toContain("&");
    expect(removeFormulaPart(aligned.parts, 1).parts).toEqual(broken.parts);
  });

  it("keeps row breaks and alignment points out of nested mathematical structures", () => {
    const parts: FormulaPart[] = [op("fractionStart"), symbol("example-index"), { type: "lineBreak" }, op("fractionDivide"), symbol("example-count"), op("groupClose")];
    expect(buildFormulaEditModel(parts, state.symbols).errors).toContain("换行和对齐点只能放在主公式中");

    const incompatible = buildFormulaEditModel([{ type: "alignmentPoint" }, symbol("example-index")], state.symbols, "centered");
    expect(incompatible.errors).toContain("居中多行公式不能包含对齐点");
    expect(() => render(incompatible.tex)).not.toThrow();
  });

  it("renders and exposes scripts at the start of a row or alignment cell", () => {
    for (const separator of ["lineBreak", "alignmentPoint"] as const) {
      for (const script of ["superscriptStart", "subscriptStart"] as const) {
        const parts: FormulaPart[] = [op("one"), { type: separator }, op(script), op("two"), op("groupClose")];
        const model = buildFormulaEditModel(parts, state.symbols);
        expect(model.errors).toEqual([]);
        expect(model.cells[1]).toMatchObject({ start: 2, end: 5 });
        expect(model.targets).toContainEqual({ index: 3, selector: ".research-formula-part-3" });
        expect(render(model.tex)).toContain(">2<");
        expect(() => render(model.tex)).not.toThrow();
      }
    }
  });

  it("provides separate insertion regions for numerator, denominator and exponent", () => {
    const parts = [symbol("example-alpha"), op("superscriptStart"), op("fractionStart"), op("one"), op("fractionDivide"), symbol("example-count"), op("groupClose"), op("groupClose")];
    const model = buildFormulaEditModel(parts, state.symbols);
    expect(model.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "superscript", start: 2, end: 7 }),
      expect.objectContaining({ kind: "numerator", start: 3, end: 4 }),
      expect.objectContaining({ kind: "denominator", start: 5, end: 6 }),
    ]));
    expect(model.positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const inserted = insertFormulaPart(parts, 5, op("one"));
    expect(formulaPartsToTex(inserted.parts, state.symbols).tex).toBe("\\alpha^{\\frac{1}{1P}}");
    expect(() => render(buildFormulaEditModel(inserted.parts, state.symbols).tex)).not.toThrow();
  });

  it("inserts paired structures and places the caret in their editable body", () => {
    for (const operator of ["fractionStart", "superscriptStart", "subscriptStart", "leftParen", "normOpen", "expectationOpen", "derivativeDot"] as const) {
      const result = insertFormulaPart([symbol("example-count")], 1, op(operator));
      expect(result.caret).toBe(2);
      expect(buildFormulaEditModel(result.parts, state.symbols).errors).toEqual([]);
      expect(() => render(buildFormulaEditModel(result.parts, state.symbols).tex)).not.toThrow();
    }
  });

  it("removes a matched structure without leaving unmatched delimiters or exponents", () => {
    const parts = [symbol("example-index"), op("equals"), op("fractionStart"), op("one"), op("fractionDivide"), symbol("example-count"), op("groupClose"), op("plus"), op("one")];
    expect(removeFormulaPart(parts, 4).parts).toEqual([parts[0], parts[1], parts[7], parts[8]]);
    const scripted = [symbol("example-count"), op("superscriptStart"), op("one"), op("groupClose")];
    expect(removeFormulaPart(scripted, 0).parts).toEqual([]);
    expect(removeFormulaPart(scripted, 3).parts).toEqual([scripted[0]]);
  });

  it("chooses the nearby visual lane rather than a fraction with the same horizontal position", () => {
    const candidates = [
      { position: 3, x: 40, top: 10, height: 14, depth: 2 },
      { position: 5, x: 40, top: 45, height: 14, depth: 2 },
      { position: 8, x: 70, top: 25, height: 25, depth: 0 },
    ];
    expect(nearestFormulaCaret(candidates, { x: 41, y: 52 })?.position).toBe(5);
    expect(nearestFormulaCaret(candidates, { x: 41, y: 15 })?.position).toBe(3);
  });
});
