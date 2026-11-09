import katex from "katex";
import type { InlineResearchSymbol } from "../domain/researchInlineSymbols.ts";

export function markInlineResearchSymbols(tex: string, matches: readonly InlineResearchSymbol[]) {
  let marked = "", cursor = 0;
  for (const [index, match] of matches.entries()) {
    const color = "#" + (0x100001 + index).toString(16);
    const fragment = tex.slice(match.start, match.end).replace(/(\\(?:textcolor|color)\s*\{)[^{}]*(\})/g, (_match, open: string, close: string) => open + color + close);
    marked += tex.slice(cursor, match.start) + `{\\color{${color}}` + fragment + "}";
    cursor = match.end;
  }
  return marked + tex.slice(cursor);
}

/** Mark an off-DOM reference and map only hit ranges onto the untouched original math. */
export function inlineResearchSymbolTargets(formula: HTMLElement, markedTex: string, count: number): (Element | Range)[][] {
  const targets: (Element | Range)[][] = Array.from({ length: count }, () => []);
  const reference = document.createElement("span");
  reference.innerHTML = katex.renderToString(markedTex, { throwOnError: false, output: "html" });
  const original = formula.querySelector(".katex-html"), marked = reference.querySelector(".katex-html");
  if (!original || !marked || reference.querySelector(".katex-error")) return targets;
  const colors = new Map(targets.map((_, index) => {
    const sample = document.createElement("span");
    sample.style.color = "#" + (0x100001 + index).toString(16);
    return [sample.style.color, index];
  }));
  const roleOf = (element: Element | null) => {
    for (let at = element; at; at = at.parentElement) {
      const index = colors.get((at as HTMLElement).style?.color);
      if (index !== undefined) return index;
    }
  };
  const textNodes = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent && node.textContent !== "\u200b") nodes.push(node as Text);
    return nodes;
  };
  const source = textNodes(marked), actual = textNodes(original);
  if (source.map(node => node.data).join("") !== actual.map(node => node.data).join("")) return targets;
  const roles = source.flatMap(node => Array.from(node.data, () => roleOf(node.parentElement)));
  let offset = 0;
  for (const node of actual) {
    const characters = Array.from(node.data);
    let start = 0;
    for (let at = 0; at < characters.length;) {
      const role = roles[offset + at];
      let end = at + 1;
      while (end < characters.length && roles[offset + end] === role) end++;
      const length = characters.slice(at, end).join("").length;
      if (role !== undefined) {
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, start + length);
        targets[role].push(range);
      }
      start += length; at = end;
    }
    offset += characters.length;
  }
  const shapes = "svg, [style*='border']";
  const actualShapes = [...original.querySelectorAll(shapes)], sourceShapes = [...marked.querySelectorAll(shapes)];
  if (actualShapes.length === sourceShapes.length) actualShapes.forEach((element, index) => {
    const role = roleOf(sourceShapes[index]);
    if (role !== undefined) targets[role].push(element);
  });
  return targets;
}
