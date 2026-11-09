import { createSymbolFixture } from "../domain/testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import katex from "katex";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSymbolEntry, resolveSymbolEntry } from "../domain/researchDictionary.ts";
import { Formula } from "./Formula.tsx";
import { findSymbolPositionReference, markSymbolDiagram } from "./researchSymbolDiagramModel.ts";

const symbols = createSymbolFixture();
const state = symbols.find(entry => entry.id === "example-rate")!;

describe("symbol explanation diagram", () => {
  it("identifies source positions without grouping the base or changing literal arguments", () => {
    const bindings = { x1: "(p)", x2: "g_h", x3: "[t]" };
    const marked = markSymbolDiagram(state, bindings);
    expect(marked.tex).toBe(resolveSymbolEntry(state, bindings).tex);
    const html = katex.renderToString(marked.markedTex, { trust: context => context.command === "\\htmlClass", strict: "ignore" });
    for (const color of ["#000001", "#000002", "#000003", "#000004"]) expect(html).toContain(`color:${color}`);
    expect(marked.markedTex).not.toContain("\\htmlClass");
    expect(marked.tex).toBe("\\dot{\\boldsymbol{x}}^{(p)}_{g_h}[t]");
  });

  it("never renders empty positions as actual math or appends parentheses", () => {
    const marked = markSymbolDiagram(state, { x1: "", x2: "", x3: "" });
    expect(marked.tex).toBe("\\dot{\\boldsymbol{x}}");
    expect(marked.markedTex).not.toContain("#000002");
    expect(marked.markedTex).not.toContain("#000003");
    expect(marked.markedTex).not.toContain("#000004");
    const argument = symbols.find(entry => entry.id === "time")!;
    expect(markSymbolDiagram(argument, { x1: "", x2: "", x3: "t" }).tex).toBe("t");
  });

  it("uses existing dictionary definitions for uniquely matched values", () => {
    expect(findSymbolPositionReference("g_h", symbols, "example-measure")?.id).toBe("example-subscript");
    expect(findSymbolPositionReference("(p)", symbols, "example-rate")?.id).toBe("example-index");
    expect(findSymbolPositionReference("(t)", symbols, "example-rate")?.id).toBe("time");
    expect(findSymbolPositionReference("unexplained", symbols, "example-rate")).toBeUndefined();
    const p = symbols.find(entry => entry.id === "example-index")!;
    expect(findSymbolPositionReference("p", [...symbols, { ...p, id: "ambiguous" }], "example-rate")).toBeUndefined();
    expect(findSymbolPositionReference("p", symbols, "example-index")).toBeUndefined();
  });

  it("preserves the complete original MathML when annotating compound symbols", () => {
    const compound = createSymbolEntry({ name: "复合符号", notation: "a+b", meaning: "测试复合主体的角标归属", category: "custom", slots: [] });
    for (const entry of [state, compound]) {
      const { tex } = markSymbolDiagram(entry, { x1: "p", x2: "g_h", x3: "(t)" });
      const markedTex = `\\htmlClass{diagram-test}{${tex}}`;
      const original = katex.renderToString(tex, { displayMode: true, throwOnError: false });
      const diagram = renderToStaticMarkup(createElement(Formula, { tex, markedTex, interactive: true, block: true }));
      expect(diagram.match(/<math[\s\S]*?<\/math>/)?.[0]).toBe(original.match(/<math[\s\S]*?<\/math>/)?.[0]);
      expect(diagram).toContain("diagram-test");
      expect(diagram.match(/class="katex"/g)).toHaveLength(1);
    }
  });
});
