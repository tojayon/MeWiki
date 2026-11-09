import { formulaOperators, resolveSymbolEntry, type FormulaLayout, type FormulaOperator, type FormulaPart, type ResearchSymbolEntry } from "./researchDictionary.ts";
import { additionalDelimiterPairs, formulaGroupedOperators, formulaLargeOperators } from "./formulaOperatorExtensions.ts";
import { joinFormulaTex } from "./formulaLatex.ts";

const groupedOperators: Partial<Record<FormulaOperator, string>> = formulaGroupedOperators;
const additionalClosers = Object.values(additionalDelimiterPairs).flat();

export interface FormulaEditRegion {
  className: string;
  kind: "root" | "superscript" | "subscript" | "numerator" | "denominator" | "delimited" | "derivative" | "unary";
  start: number;
  end: number;
  depth: number;
  nodes: FormulaEditNode[];
}

export interface FormulaEditNode {
  kind: "atom" | "empty" | "fraction" | "delimited" | "derivative" | "unary" | "scripted";
  start: number;
  end: number;
  className: string;
  regions: FormulaEditRegion[];
  base?: FormulaEditNode;
  scripts?: { index: number; end: number; region?: FormulaEditRegion; fixed?: "transpose" | "inverse" }[];
}

export interface FormulaEditModel {
  tex: string;
  root: FormulaEditRegion;
  cells: { className: string; row: number; column: number; start: number; end: number; nodes: FormulaEditNode[] }[];
  regions: FormulaEditRegion[];
  targets: { index: number; selector: string }[];
  ranges: { start: number; end: number }[];
  positions: number[];
  errors: string[];
}

export interface FormulaCaretRect {
  position: number;
  x: number;
  top: number;
  height: number;
  depth: number;
}

const operatorTex = new Map(formulaOperators.map((item) => [item.id, item.tex]));
const delimiterPairs: Partial<Record<FormulaOperator, FormulaOperator[]>> = {
  ...Object.fromEntries(Object.entries(additionalDelimiterPairs).map(([id, closers]) => [id, [...closers]])),
  leftParen: ["rightParen", "rightBracket"], leftBracket: ["rightBracket", "rightParen"], leftBrace: ["rightBrace"],
  expectationOpen: ["expectationClose"], normOpen: ["normClose", "normCloseSquared"], traceOpen: ["traceClose"], cardinalityOpen: ["cardinalityClose"],
};
const pairedInsertions: Partial<Record<FormulaOperator, FormulaOperator[]>> = {
  ...Object.fromEntries(Object.keys(formulaGroupedOperators).map(id => [id, [id, "groupClose"]])),
  ...Object.fromEntries(Object.entries(additionalDelimiterPairs).map(([id, closers]) => [id, [id, closers[0]]])),
  leftParen: ["leftParen", "rightParen"], leftBracket: ["leftBracket", "rightBracket"], leftBrace: ["leftBrace", "rightBrace"],
  expectationOpen: ["expectationOpen", "expectationClose"], normOpen: ["normOpen", "normClose"], traceOpen: ["traceOpen", "traceClose"], cardinalityOpen: ["cardinalityOpen", "cardinalityClose"],
  fractionStart: ["fractionStart", "fractionDivide", "groupClose"], superscriptStart: ["superscriptStart", "groupClose"],
  subscriptStart: ["subscriptStart", "groupClose"], derivativeDot: ["derivativeDot", "groupClose"],
};

export const formulaInsertionOperators = formulaOperators.filter((item) =>
  !["groupClose", "fractionDivide", "rightParen", "rightBracket", "rightBrace", "expectationClose", "normClose", "normCloseSquared", "traceClose", "cardinalityClose", ...additionalClosers].includes(item.id),
);

/** Keep limits and exponents attached to their bases while annotating complete math structures. */
export function buildFormulaEditModel(parts: FormulaPart[], symbols: ResearchSymbolEntry[], layout: FormulaLayout = "aligned"): FormulaEditModel {
  let cursor = 0;
  const regions: FormulaEditRegion[] = [];
  const targets: FormulaEditModel["targets"] = [];
  const ranges: FormulaEditModel["ranges"] = [];
  const errors: string[] = [];
  const operatorAt = (index: number) => parts[index]?.type === "operator" ? parts[index].operator : undefined;
  const texAt = (index: number) => {
    const part = parts[index];
    if (part?.type === "lineBreak") return "\\\\";
    if (part?.type === "alignmentPoint") return layout === "centered" ? "" : "&";
    if (part?.type === "operator") return operatorTex.get(part.operator) ?? "";
    if (part?.type === "latex") return `{${part.tex}}`;
    const entry = part?.type === "symbol" ? symbols.find((item) => item.id === part.entryId) : undefined;
    return entry && part?.type === "symbol" ? resolveSymbolEntry(entry, part.bindings).tex : "\\color{#bb243b}{?}";
  };
  const consumeClose = (expected: FormulaOperator[]) => {
    if (expected.includes(operatorAt(cursor)!)) cursor += 1;
    else errors.push("公式第 " + (cursor + 1) + " 项缺少匹配的结束标记");
  };
  const sequence = (kind: FormulaEditRegion["kind"], depth: number, stops: FormulaOperator[] = []): FormulaEditRegion => {
    const region: FormulaEditRegion = { className: "research-formula-region-" + regions.length, kind, start: cursor, end: cursor, depth, nodes: [] };
    regions.push(region);
    while (cursor < parts.length && !stops.includes(operatorAt(cursor)!)) {
      const start = cursor++;
      if (parts[start].type === "lineBreak" || parts[start].type === "alignmentPoint") {
        if (kind !== "root") errors.push("换行和对齐点只能放在主公式中");
        if (parts[start].type === "alignmentPoint" && layout === "centered") errors.push("居中多行公式不能包含对齐点");
      }
      const operator = operatorAt(start);
      let node: FormulaEditNode = { kind: "atom", start, end: cursor, className: "research-formula-part-" + start, regions: [] };
      if (["superscriptStart", "subscriptStart", "transpose", "inverse"].includes(operator ?? "")) {
        // TeX permits a script with an empty base at the start of a cell. It
        // belongs to that cell, never to the preceding row/column separator.
        cursor = start;
        node = { ...node, kind: "empty", end: start, className: "research-formula-empty-base-" + start };
      } else if (operator === "fractionStart") {
        const numerator = sequence("numerator", depth + 1, ["fractionDivide"]);
        consumeClose(["fractionDivide"]);
        const denominator = sequence("denominator", depth + 1, ["groupClose"]);
        consumeClose(["groupClose"]);
        node = { kind: "fraction", start, end: cursor, className: "research-formula-structure-" + start + "-" + cursor, regions: [numerator, denominator] };
        ranges.push({ start, end: cursor });
      } else if (groupedOperators[operator!] || delimiterPairs[operator!]) {
        const kind = operator === "derivativeDot" ? "derivative" : groupedOperators[operator!] ? "unary" : "delimited";
        const closers = groupedOperators[operator!] ? ["groupClose" as const] : delimiterPairs[operator!]!;
        const body = sequence(kind, depth + 1, closers);
        consumeClose(closers);
        node = { kind, start, end: cursor, className: "research-formula-structure-" + start + "-" + cursor, regions: [body] };
        ranges.push({ start, end: cursor });
      } else if (["groupClose", "fractionDivide", "rightParen", "rightBracket", "rightBrace", "expectationClose", "normClose", "normCloseSquared", "traceClose", "cardinalityClose", ...additionalClosers].includes(operator ?? "")) {
        errors.push("公式第 " + (start + 1) + " 项的结束标记没有对应结构");
      }

      const scripts: NonNullable<FormulaEditNode["scripts"]> = [];
      while (parts[start].type !== "lineBreak" && parts[start].type !== "alignmentPoint" && ["superscriptStart", "subscriptStart", "transpose", "inverse"].includes(operatorAt(cursor) ?? "")) {
        const index = cursor++;
        const scriptOperator = operatorAt(index)!;
        if (scriptOperator === "transpose" || scriptOperator === "inverse") {
          scripts.push({ index, end: cursor, fixed: scriptOperator });
        } else {
          const body = sequence(scriptOperator === "superscriptStart" ? "superscript" : "subscript", depth + 1, ["groupClose"]);
          consumeClose(["groupClose"]);
          scripts.push({ index, end: cursor, region: body });
          ranges.push({ start: index, end: cursor });
        }
      }
      if (scripts.length) {
        node = { kind: "scripted", start, end: cursor, className: "research-formula-structure-" + start + "-" + cursor, regions: [], base: node, scripts };
        ranges.push({ start, end: cursor });
      }
      region.nodes.push(node);
    }
    region.end = cursor;
    return region;
  };
  const root = sequence("root", 0);
  // Layout separators belong to the root AST, but each visual cell needs its
  // own box. In particular, trailing and consecutive empty rows have no atom
  // from which the editor could otherwise measure a caret.
  const cells: FormulaEditModel["cells"] = [];
  let cell: FormulaEditModel["cells"][number] = { className: "research-formula-cell-0", row: 0, column: 0, start: 0, end: 0, nodes: [] };
  for (const node of root.nodes) {
    const part = parts[node.start];
    if (part.type === "lineBreak" || part.type === "alignmentPoint") {
      cell.end = node.start;
      cells.push(cell);
      cell = { className: "research-formula-cell-" + cells.length, row: cell.row + (part.type === "lineBreak" ? 1 : 0), column: part.type === "lineBreak" ? 0 : cell.column + 1, start: node.end, end: node.end, nodes: [] };
    } else cell.nodes.push(node);
  }
  cell.end = root.end;
  cells.push(cell);
  const wrap = (className: string, tex: string) => "\\htmlClass{" + className + "}{" + tex + "}";
  const markPart = (index: number, tex: string) => {
    targets.push({ index, selector: ".research-formula-part-" + index });
    return wrap("research-formula-part-" + index, tex);
  };
  const renderRegion = (region: FormulaEditRegion): string => {
    if (region.kind === "root") {
      const body = cells.map((cell, index) => {
        const separator = !index ? "" : cell.row !== cells[index - 1].row ? "\\\\" : layout === "centered" ? "" : "&";
        return separator + wrap(cell.className, joinFormulaTex(cell.nodes.map((node) => renderNode(node))) || "\\vphantom{x}\\mkern4mu");
      }).join("");
      const environment = layout === "centered" ? "gathered" : "aligned";
      return wrap(region.className, cells.length > 1 ? `\\begin{${environment}}${body}\\end{${environment}}` : body);
    }
    const body = joinFormulaTex(region.nodes.map((node) => renderNode(node))) || "\\vphantom{x}\\mkern4mu";
    // A middle delimiter must remain at the TeX group level of its left/right delimiters.
    return region.kind === "delimited" ? body : wrap(region.className, body);
  };
  const renderNode = (node: FormulaEditNode, bareLargeOperator = false): string => {
    if (node.kind === "empty") return "{}";
    if (node.kind === "atom") {
      if (parts[node.start].type === "lineBreak" || parts[node.start].type === "alignmentPoint") return texAt(node.start);
      if (operatorAt(node.start) === "conditionalBar" || operatorAt(node.start) === "juxtapose") return texAt(node.start);
      if (bareLargeOperator) return texAt(node.start);
      return markPart(node.start, texAt(node.start));
    }
    if (node.kind === "scripted") {
      const largeOperator = node.base!.kind === "atom" && formulaLargeOperators.has(operatorAt(node.start) ?? "");
      const base = renderNode(node.base!, largeOperator);
      if (largeOperator) targets.push({ index: node.start, selector: "." + node.className + " .op-symbol, ." + node.className + " > .mop" });
      const scripts = node.scripts!.map((script) => {
        if (script.fixed) return "^{" + markPart(script.index, script.fixed === "transpose" ? "\\mathsf T" : "-1") + "}";
        return (script.region!.kind === "superscript" ? "^{" : "_{") + renderRegion(script.region!) + "}";
      }).join("");
      return wrap(node.className, base + scripts);
    }
    if (node.kind === "fraction") {
      return wrap(node.className, "\\frac{" + renderRegion(node.regions[0]) + "}{" + renderRegion(node.regions[1]) + "}");
    }
    if (node.kind === "derivative" || node.kind === "unary") {
      return wrap(node.className, texAt(node.start) + renderRegion(node.regions[0]) + "}");
    }
    targets.push({ index: node.start, selector: "." + node.className + " > .minner > .mopen, ." + node.className + " > .mopen" });
    targets.push({ index: node.end - 1, selector: "." + node.className + " > .minner > .mclose, ." + node.className + " > .mclose" });
    return wrap(node.className, texAt(node.start) + renderRegion(node.regions[0]) + texAt(node.end - 1));
  };
  return { tex: renderRegion(root), root, cells, regions, targets, ranges, positions: Array.from({ length: parts.length + 1 }, (_, index) => index), errors };
}

export function insertFormulaPart(parts: FormulaPart[], position: number, part: FormulaPart) {
  const at = Math.max(0, Math.min(parts.length, position));
  const operators = part.type === "operator" ? pairedInsertions[part.operator] : undefined;
  const inserted: FormulaPart[] = operators
    ? operators.map((operator) => ({ type: "operator", operator }))
    : [part.type === "symbol" ? { ...part, bindings: { ...part.bindings } } : { ...part }];
  return { parts: [...parts.slice(0, at), ...inserted, ...parts.slice(at)], caret: at + 1 };
}

export function removeFormulaPart(parts: FormulaPart[], index: number) {
  if (index < 0 || index >= parts.length) return { parts, caret: Math.max(0, Math.min(parts.length, index)) };
  const model = buildFormulaEditModel(parts, []);
  const part = parts[index];
  const structural = part.type === "operator" && (
    pairedInsertions[part.operator] || ["groupClose", "fractionDivide", "rightParen", "rightBracket", "rightBrace", "expectationClose", "normClose", "normCloseSquared", "traceClose", "cardinalityClose", ...additionalClosers].includes(part.operator)
  );
  const range = model.ranges
    .filter((range) => structural ? range.start <= index && index < range.end : range.start === index)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  const start = range?.start ?? index;
  const end = range?.end ?? index + 1;
  return { parts: [...parts.slice(0, start), ...parts.slice(end)], caret: start };
}

export function nearestFormulaCaret(candidates: FormulaCaretRect[], point: { x: number; y: number }) {
  let nearest: FormulaCaretRect | undefined;
  let best = Infinity;
  for (const candidate of candidates) {
    const dy = Math.max(candidate.top - point.y, point.y - candidate.top - candidate.height, 0);
    const distance = (candidate.x - point.x) ** 2 + (dy * 3) ** 2;
    if (distance < best || (distance === best && candidate.depth > (nearest?.depth ?? -1))) {
      nearest = candidate;
      best = distance;
    }
  }
  return nearest;
}
