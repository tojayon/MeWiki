import { resolveSymbolEntry, type ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import { symbolPositionSuffix } from "../domain/researchSymbolPositions.ts";
import katex from "katex";

export type SymbolDiagramPart = "body" | "x1" | "x2" | "x3";
export type SymbolDiagramTargets = Record<SymbolDiagramPart, (Element | Range)[]>;
const markerColors: Record<SymbolDiagramPart, string> = { body: "#000001", x1: "#000002", x2: "#000003", x3: "#000004" };

/** Transparent color switches identify source ranges in an off-DOM reference. */
export function markSymbolDiagram(entry: ResearchSymbolEntry, bindings: Record<string, string>) {
  const mark = (part: SymbolDiagramPart, value: string) => value ? `\\color{${markerColors[part]}}` + value.replace(/(\\(?:textcolor|color)\s*\{)[^{}]*(\})/g, (_match, open: string, close: string) => open + markerColors[part] + close) : "";
  const tex = resolveSymbolEntry(entry, bindings).tex;
  if (!entry.notation.endsWith(symbolPositionSuffix)) return { tex, markedTex: mark("body", tex) };
  const base = entry.notation.slice(0, -symbolPositionSuffix.length);
  return {
    tex,
    markedTex: mark("body", base)
      + (bindings.x1 ? `^{${mark("x1", bindings.x1)}}` : "")
      + (bindings.x2 ? `_{${mark("x2", bindings.x2)}}` : "")
      + mark("x3", bindings.x3 ?? ""),
  };
}

/** Transfer only hit targets to the original KaTeX DOM, preserving its layout,
 * authored colors, and accessible MathML. Ranges also handle combined glyphs. */
export function annotateSymbolDiagram(formula: HTMLElement, markedTex: string): SymbolDiagramTargets {
  const targets: SymbolDiagramTargets = { body: [], x1: [], x2: [], x3: [] };
  formula.querySelectorAll(".symbol-diagram-part").forEach(element => element.classList.remove("symbol-diagram-part", ...Object.keys(targets).map(part => `symbol-diagram-part-${part}`)));
  const reference = document.createElement("div");
  reference.innerHTML = katex.renderToString(markedTex, { displayMode: true, throwOnError: false, output: "html" });
  const original = formula.querySelector(".katex-html"), marked = reference.querySelector(".katex-html");
  if (!original || !marked) return targets;
  const colors = new Map(Object.entries(markerColors).map(([part, color]) => {
    const sample = document.createElement("span");
    sample.style.color = color;
    return [sample.style.color, part as SymbolDiagramPart];
  }));
  const partOf = (element: Element | null): SymbolDiagramPart | undefined => {
    for (let current = element; current; current = current.parentElement) {
      const part = colors.get((current as HTMLElement).style?.color);
      if (part) return part;
    }
  };
  const textNodes = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent && node.textContent !== "\u200b") nodes.push(node as Text);
    return nodes;
  };
  const sourceText = textNodes(marked), actualText = textNodes(original);
  if (sourceText.map(node => node.data).join("") !== actualText.map(node => node.data).join("")) return targets;
  const roles = sourceText.flatMap(node => Array.from(node.data, () => partOf(node.parentElement)));
  const addClass = (element: Element, part: SymbolDiagramPart) => element.classList.add("symbol-diagram-part", `symbol-diagram-part-${part}`);
  let offset = 0;
  for (const node of actualText) {
    const characters = Array.from(node.data);
    let start = 0;
    for (let at = 0; at < characters.length;) {
      const part = roles[offset + at];
      let end = at + 1;
      while (end < characters.length && roles[offset + end] === part) end++;
      const length = characters.slice(at, end).join("").length;
      if (part) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + length);
        targets[part].push(range);
        if (at === 0 && end === characters.length && node.parentElement) addClass(node.parentElement, part);
      }
      start += length;
      at = end;
    }
    offset += characters.length;
  }
  // Fraction bars, radicals, and other drawn strokes have no text nodes.
  const shapes = "svg, [style*='border']";
  const actualShapes = [...original.querySelectorAll(shapes)], sourceShapes = [...marked.querySelectorAll(shapes)];
  if (actualShapes.length === sourceShapes.length) actualShapes.forEach((element, index) => {
    const part = partOf(sourceShapes[index]);
    if (part) { targets[part].push(element); addClass(element, part); }
  });
  return targets;
}

function comparableValue(tex: string) {
  const value = tex.trim().replace(/^\(([^()]*)\)$/, "$1");
  return value.replace(/\{([a-zA-Z0-9])\}/g, "$1").replace(/\s+/g, "");
}

export function findSymbolPositionReference(value: string, entries: readonly ResearchSymbolEntry[], currentId: string) {
  if (!value.trim()) return undefined;
  const expected = comparableValue(value);
  const matches = entries.filter(entry => entry.id !== currentId
    && comparableValue(resolveSymbolEntry(entry, Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]))).tex) === expected);
  return matches.length === 1 ? matches[0] : undefined;
}
