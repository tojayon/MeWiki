import { describe, expect, it } from "vitest";
import katex from "katex";
import { formulaOperatorPalette } from "./formulaOperatorPalette.ts";
import { buildFormulaEditModel, insertFormulaPart, removeFormulaPart } from "../domain/formulaEditing.ts";
import { formulaOperators, formulaPartsToTex, type FormulaPart } from "../domain/researchDictionary.ts";
import { parseFormulaClipboard, serializeFormulaSelection } from "../domain/formulaTransfer.ts";
import { formulaLargeOperators } from "../domain/formulaOperatorExtensions.ts";

describe("expanded formula operator keyboard", () => {
  it("keeps every insertable key in one formal category instead of a fixed frequent list", () => {
    expect(formulaOperatorPalette.some(group => group.label === "常用")).toBe(false);
    const category = (id: string) => formulaOperatorPalette.find(group => group.keys.some(key => key.id === id))?.label;
    const expected = {
      运算: ["plus", "minus", "times", "divide", "dot", "juxtapose", "plusMinus", "tensorProduct", "bigTensorProduct"],
      关系: ["equals", "lessEqual", "approximately"],
      常数: ["zero", "one", "two", "three", "infinity"],
      箭头: ["to", "implies", "iff", "mapsto"],
      矩阵: ["transpose", "inverse", "matrix2x2"],
      修饰: ["derivativeDot", "doubleDotAccent"],
      集合: ["in", "union", "naturalNumbers", "realNumbers", "finiteField", "bigUnion"],
      逻辑: ["forall", "bigLogicalAnd"],
      函数: ["minimum", "infimum", "supremum", "argMin"],
      结构: ["fractionStart", "squareRoot", "casesTemplate", "binomialTemplate"],
    };
    for (const [label, ids] of Object.entries(expected)) for (const id of ids) expect(category(id), id).toBe(label);
    // Closing markers are supplied by paired insertion rather than independent keys.
    const internalMarkers = new Set(["rightParen", "rightBracket", "rightBrace", "groupClose", "expectationClose", "fractionDivide", "normClose", "normCloseSquared", "traceClose", "cardinalityClose", "floorClose", "ceilClose", "angleClose"]);
    expect(formulaOperatorPalette.flatMap(group => group.keys.map(key => key.id)).sort()).toEqual(
      formulaOperators.filter(key => !internalMarkers.has(key.id)).map(key => key.id).sort(),
    );
  });

  it("covers roots, calculus, sets, logic, arrows, Greek letters and matrices", () => {
    const ids = new Set(formulaOperatorPalette.flatMap(group => group.keys.map(key => key.id as string)));
    for (const id of ["squareRoot", "cubeRoot", "hatAccent", "floorOpen", "plusMinus", "approximately", "union", "forall", "mapsto", "alpha", "Gamma", "product", "doubleIntegral", "sine", "logarithm", "realNumbers", "matrix2x2"]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("renders every key and inserts a complete, copyable expression", () => {
    const base: FormulaPart[] = [{ type: "operator", operator: "expectationOpen" }, { type: "operator", operator: "one" }, { type: "operator", operator: "expectationClose" }];
    const ids = new Set<string>();
    for (const group of formulaOperatorPalette) for (const key of group.keys) {
      expect(ids.has(key.id), key.id).toBe(false);
      ids.add(key.id);
      expect(() => katex.renderToString(key.preview, { throwOnError: true }), key.id).not.toThrow();
      const inserted = insertFormulaPart(base, 2, { type: "operator", operator: key.id });
      const model = buildFormulaEditModel(inserted.parts, []);
      expect(model.errors, key.id).toEqual([]);
      expect(() => katex.renderToString(model.tex, { throwOnError: true, trust: context => context.command === "\\htmlClass", strict: "ignore" }), key.id).not.toThrow();
      const copied = serializeFormulaSelection(inserted.parts, [], { start: 0, end: inserted.parts.length });
      expect(parseFormulaClipboard(copied.custom, []).parts, key.id).toEqual(inserted.parts);
      expect(formulaPartsToTex(inserted.parts, []).errors, key.id).toEqual([]);
      expect(base).toHaveLength(3);
    }
  });

  it("keeps new radicals, accents and delimiters intact when removing their opening or closing marker", () => {
    for (const id of ["squareRoot", "cubeRoot", "hatAccent", "vectorAccent", "floorOpen", "ceilOpen", "angleOpen"] as const) {
      const opening = formulaOperatorPalette.flatMap(group => group.keys).find(key => key.id as string === id)!;
      expect(opening, id).toBeDefined();
      const inserted = insertFormulaPart([], 0, { type: "operator", operator: opening.id });
      const filled = insertFormulaPart(inserted.parts, inserted.caret, { type: "operator", operator: "two" });
      expect(removeFormulaPart(filled.parts, 0).parts, id).toEqual([]);
      expect(removeFormulaPart(filled.parts, filled.parts.length - 1).parts, id).toEqual([]);
    }
  });

  it("preserves lower and upper limits on all large operators in interactive rendering", () => {
    const render = (tex: string) => katex.renderToString(tex, { displayMode: true, throwOnError: true, trust: context => context.command === "\\htmlClass", strict: "ignore" });
    for (const key of formulaOperatorPalette.flatMap(group => group.keys).filter(key => formulaLargeOperators.has(key.id))) {
      const parts: FormulaPart[] = [{ type: "operator", operator: key.id }, { type: "operator", operator: "subscriptStart" }, { type: "operator", operator: "one" }, { type: "operator", operator: "groupClose" }, { type: "operator", operator: "superscriptStart" }, { type: "operator", operator: "two" }, { type: "operator", operator: "groupClose" }];
      const plain = render(formulaPartsToTex(parts, []).tex);
      const interactive = render(buildFormulaEditModel(parts, []).tex);
      for (const tag of ["msubsup", "munderover", "munder", "mover"]) {
        expect(interactive.match(new RegExp("<" + tag + "[ >]", "g"))?.length ?? 0, `${key.id}: ${tag}`).toBe(plain.match(new RegExp("<" + tag + "[ >]", "g"))?.length ?? 0);
      }
    }
  });
});
