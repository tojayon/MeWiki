import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createSymbolEntry } from "./researchDictionary.ts";
import { positionSlots } from "./researchSymbolPositions.ts";
import { findInlineResearchSymbols } from "./researchInlineSymbols.ts";


const symbol = (id: string, base: string, values: Record<string, string> = {}) => createSymbolEntry({
  name: id, notation: base + "^{[x1]}_{[x2]}[x3]", meaning: id + "的说明", category: "custom", slots: positionSlots(values),
}, id);
const symbols = [
  symbol("state", "\\boldsymbol{x}", { x3: "(t)" }),
  symbol("rate", "\\dot{\\boldsymbol{x}}", { x3: "(t)" }),
  symbol("completion", "c", { x2: "h" }),
  symbol("capacity", "c", { x2: "k" }),
  symbol("age", "\\Delta", { x3: "(t)" }),
  symbol("time", "t"),
  symbol("index", "h"),
  symbol("plain-x", "x"),
];
const describeMatches = (tex: string) => findInlineResearchSymbols(tex, symbols).map(match => ({
  tex: tex.slice(match.start, match.end), ids: match.candidates.map(entry => entry.id), bindings: match.bindings,
}));

describe("dictionary symbols in inline math", () => {
  it("recognizes complete notation and favors the exact default instance among shared bodies", () => {
    expect(describeMatches("\\Delta(t)=c_{h}+c_k")).toEqual([
      { tex: "\\Delta(t)", ids: ["age"], bindings: { x1: "", x2: "", x3: "(t)" } },
      { tex: "c_{h}", ids: ["completion"], bindings: { x1: "", x2: "h", x3: "" } },
      { tex: "c_k", ids: ["capacity"], bindings: { x1: "", x2: "k", x3: "" } },
    ]);
  });

  it("reads literal script bindings in either order and complete right arguments", () => {
    const tex = "\\boldsymbol{x}_{g_h}^{(p)}\\left(t\\mid s_g\\right)";
    expect(describeMatches(tex)).toEqual([{ tex, ids: ["state"], bindings: { x1: "(p)", x2: "g_h", x3: "\\left(t\\mid s_g\\right)" } }]);
    expect(describeMatches("\\boldsymbol{x}^q[t]")[0]).toMatchObject({ bindings: { x1: "q", x2: "", x3: "[t]" } });
  });

  it("keeps all definitions as choices when a different local binding is ambiguous", () => {
    expect(describeMatches("c_j")).toEqual([{ tex: "c_j", ids: ["completion", "capacity"], bindings: { x1: "", x2: "j", x3: "" } }]);
    expect(describeMatches("c_h^p")[0].ids).toEqual(["completion", "capacity"]);
  });

  it("recognizes equivalent single-atom grouping and Unicode Greek notation", () => {
    expect(describeMatches("\\boldsymbol x(t)+Δ(t)").map(match => match.ids)).toEqual([["state"], ["age"]]);
  });

  it("recognizes the real dictionary's argument-only time, index and stage entries", () => {
    const entries = createResearchNotebook().symbols;
    expect(findInlineResearchSymbols("t", entries)[0].candidates.map(entry => entry.id)).toEqual(["time"]);
    expect(findInlineResearchSymbols("i", entries)[0].candidates.map(entry => entry.id)).toEqual(["example-generic"]);
    expect(findInlineResearchSymbols("\\mathrm{TR}", entries)[0].candidates.map(entry => entry.id)).toContain("example-label");
  });

  it("takes the longest decorated symbol and scans nested math without linking command or text letters", () => {
    expect(describeMatches("\\frac{\\dot{\\boldsymbol{x}}(t)}{c_h}+\\text{c_h and t}+\\mathrm{cache}+\\theta+z").map(match => match.ids)).toEqual([["rate"], ["completion"]]);
    expect(describeMatches("\\textcolor{red}{t}+\\overline{x}+\\operatorname{t}").map(match => match.ids)).toEqual([["time"]]);
  });

  it("ignores array column specifications while recognizing the mathematical cells", () => {
    expect(describeMatches("\\begin{array}{c|c}a & b \\\\ c & d\\end{array}").map(match => match.tex)).toEqual(["c"]);
    expect(describeMatches("\\begin{array}{lcr}x & c_h & t\\end{array}").map(match => match.tex)).toEqual(["x", "c_h", "t"]);
  });

  it("separates matrix alignment arguments from visible mathematical entries", () => {
    for (const environment of ["matrix*", "pmatrix*", "bmatrix*", "Bmatrix*", "vmatrix*", "Vmatrix*"]) {
      expect(describeMatches(`\\begin{${environment}}[c]c_h & t\\end{${environment}}`).map(match => match.tex)).toEqual(["c_h", "t"]);
    }
    expect(describeMatches("\\begin{subarray}{c}c_h\\\\t\\end{subarray}").map(match => match.tex)).toEqual(["c_h", "t"]);
    expect(describeMatches("\\begin{matrix}[c]c_h & t\\end{matrix}").map(match => match.tex)).toEqual(["c", "c_h", "t"]);
    expect(describeMatches("\\begin{matrix*}c_h & t\\end{matrix*}").map(match => match.tex)).toEqual(["c_h", "t"]);
  });

  it("leaves unknown notation, escaped commands, comments and incomplete scripts alone", () => {
    expect(describeMatches("\\tau+z+\\textrm{t} % t c_h\n+\\thetaxy")).toEqual([]);
    expect(describeMatches("\\boldsymbol{x}_{")).toEqual([]);
    expect(findInlineResearchSymbols("t", [])).toEqual([]);
    expect(describeMatches("\\textup{t}+\\textmd{t}+\\emph{t}")).toEqual([]);
  });
});
