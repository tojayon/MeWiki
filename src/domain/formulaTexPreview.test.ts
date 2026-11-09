import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { normalizeFormulaTex, previewFormulaTex } from "./formulaTexPreview.ts";
import { parseFormulaText } from "./formulaTransfer.ts";


describe("LaTeX preview and source diagnostics", () => {
  it("renders wrapped multiline input and preserves source offsets through comments", () => {
    const source = "  \\[\n% comment\n\\begin{aligned}\np&=1\\\\\nP&=2\n\\end{aligned}\n\\]  ";
    const normalized = normalizeFormulaTex(source);
    expect(normalized.tex).toBe("p&=1\\\\\nP&=2");
    expect(normalized.sourceOffset).toBe(source.indexOf("p&"));
    expect(previewFormulaTex(source).html).toContain("katex");
    expect(previewFormulaTex(source).diagnostic).toBeUndefined();
  });

  it("keeps inline comments and escaped percent signs at their original offsets", () => {
    const source = "$$\np+\\% % ignored text\n+\\unknown\n$$";
    const normalized = normalizeFormulaTex(source);
    expect(normalized.tex).toContain("\\%");
    const preview = previewFormulaTex(source);
    expect(preview.diagnostic).toMatchObject({ start: source.indexOf("\\unknown"), end: source.indexOf("\\unknown") + 8, line: 3, column: 2 });
    expect(preview.html).toBeUndefined();
  });

  it("keeps array column declarations out of both the formula and dictionary matching", () => {
    const state = createResearchNotebook();
    const source = "\\[\n\\begin{array}{cc}\np&=1\\\\P&=2\n\\end{array}\n\\]";
    expect(normalizeFormulaTex(source)).toMatchObject({ tex: "p&=1\\\\P&=2", sourceOffset: source.indexOf("p&") });
    const preview = previewFormulaTex(source);
    expect(preview.diagnostic).toBeUndefined();
    expect(preview.html).not.toContain("<mi>c</mi>");
    expect(parseFormulaText(source, state.symbols).error).toBeUndefined();
    const ungrouped = "\\begin{array}c p=1\\end{array}";
    expect(normalizeFormulaTex(ungrouped)).toMatchObject({ tex: "p=1", sourceOffset: ungrouped.indexOf("p=") });
    expect(parseFormulaText(ungrouped, state.symbols).parts).toHaveLength(3);
    const invalid = "\\begin{array}{q}p&=1\\end{array}";
    expect(previewFormulaTex(invalid).diagnostic).toMatchObject({ start: invalid.indexOf("q") });
  });

  it("points missing closing groups at the end of the original formula body", () => {
    const source = "  \\[\n\\frac{1}{2\n\\] ";
    const preview = previewFormulaTex(source);
    const end = source.indexOf("2") + 1;
    expect(preview.diagnostic).toMatchObject({ start: end, end, line: 2, column: 11 });
  });

  it("returns syntax and dictionary match locations in the original pasted text", () => {
    const state = createResearchNotebook();
    for (const source of ["  $$\np+\\unknown\n$$", "\\[\np+\\mathscr{Z}\n\\]"]) {
      const parsed = parseFormulaText(source, state.symbols);
      expect(parsed.error).toBeTruthy();
      expect(parsed.errorRange?.start).toBe(source.indexOf("\\", source.indexOf("p+")));
      expect(parsed.errorRange!.end).toBeGreaterThan(parsed.errorRange!.start);
    }
  });

  it("locates an ambiguous dictionary symbol as a complete source fragment", () => {
    const state = createResearchNotebook();
    const entry = state.symbols.find(entry => entry.id === "example-index")!;
    const source = "$$\n1+p\n$$";
    const parsed = parseFormulaText(source, [...state.symbols, { ...entry, id: "another-p" }]);
    expect(parsed.error).toContain("多个词典匹配");
    expect(parsed.errorRange).toEqual({ start: source.indexOf("p"), end: source.indexOf("p") + 1 });
  });

  it("does not treat an empty draft as a syntax error and rejects oversized input", () => {
    expect(previewFormulaTex(" \n")).toEqual({ tex: "", layout: "aligned", sourceOffset: 2 });
    expect(previewFormulaTex("x".repeat(1_000_001)).diagnostic?.message).toContain("过大");
  });
});
