import { describe, expect, it } from "vitest";
import katex from "katex";
import { createSymbolEntry } from "../domain/researchDictionary.ts";
import { findInlineResearchSymbols } from "../domain/researchInlineSymbols.ts";
import { markInlineResearchSymbols } from "./researchInlineSymbolTargets.ts";

const symbols = ["t", "x", "\\sum"].map(base => createSymbolEntry({ name: base, notation: base, meaning: "测试", category: "custom", slots: [] }));
describe("inline symbol hit reference", () => {
  it("keeps valid TeX arguments and operator limits when marking an off-DOM reference", () => {
    for (const tex of ["\\sqrt x", "\\sqrt[3]x", "\\frac x t", "\\sum\\limits_{t=0}^{x}", "\\color{red}x+\\textcolor{blue}{t}"]) {
      const matches = findInlineResearchSymbols(tex, symbols);
      expect(matches.length, tex).toBeGreaterThan(0);
      const marked = markInlineResearchSymbols(tex, matches);
      expect(() => katex.renderToString(marked, { throwOnError: true }), tex).not.toThrow();
    }
  });

  it("leaves matrix formatting arguments intact in the hit reference", () => {
    const entries = ["c", "t"].map(base => createSymbolEntry({ name: base, notation: base, meaning: "测试", category: "custom", slots: [] }));
    for (const tex of ["\\begin{array}{c|c}a & b \\\\ c & t\\end{array}", "\\begin{matrix*}[c]c & t\\end{matrix*}", "\\begin{subarray}{c}c\\\\t\\end{subarray}"]) {
      const marked = markInlineResearchSymbols(tex, findInlineResearchSymbols(tex, entries));
      expect(() => katex.renderToString(marked, { throwOnError: true }), tex).not.toThrow();
    }
  });
});
