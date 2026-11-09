import {
  formulaOperators,
  formulaPartsToTex,
  isFormulaOperator,
  resolveSymbolEntry,
  type FormulaLayout,
  type FormulaOperator,
  type FormulaPart,
  type ResearchSymbolEntry,
} from "./researchDictionary.ts";
import { buildFormulaEditModel, type FormulaEditNode, type FormulaEditRegion } from "./formulaEditing.ts";
import { formulaSourceError, type FormulaAddress } from "./researchFormulaLinks.ts";
import type { ResearchNotebookState } from "./researchNotebook.ts";
import katex from "katex";
import { findInlineResearchSymbols, type InlineResearchSymbol } from "./researchInlineSymbols.ts";
import { previewFormulaTex } from "./formulaTexPreview.ts";
import { additionalDelimiterPairs, formulaGroupedOperators } from "./formulaOperatorExtensions.ts";
import { formulaLatexError } from "./formulaLatex.ts";

/** MIME type used by formula editors in this application. */
export const FORMULA_CLIPBOARD_MIME = "application/x-webbench-formula+json";
export const FORMULA_CLIPBOARD_VERSION = 1 as const;

export interface FormulaRange {
  start: number;
  end: number;
}

export interface FormulaClipboardPayload {
  version: typeof FORMULA_CLIPBOARD_VERSION;
  kind: "formula-selection";
  layout: FormulaLayout;
  parts: FormulaPart[];
  /** Dictionary identities make a paste fail closed if a notation changed. */
  entries: Record<string, { notation: string }>;
  text: string;
}

export interface SerializedFormulaSelection {
  payload: FormulaClipboardPayload;
  /** Serialized value for FORMULA_CLIPBOARD_MIME. */
  custom: string;
  /** Alias kept for clipboard adapters that call this field data. */
  data: string;
  /** A conservative LaTeX fallback for text/plain. */
  text: string;
  range: FormulaRange;
}

export interface FormulaClipboardParseResult {
  parts?: FormulaPart[];
  layout?: FormulaLayout;
  text?: string;
  error?: string;
  errorRange?: FormulaRange;
}

export interface FormulaTransferOptions {
  state?: ResearchNotebookState;
  symbols?: ResearchSymbolEntry[];
  owner?: FormulaAddress;
  layout?: FormulaLayout;
}

export interface FormulaTransferTransaction {
  parts: FormulaPart[];
  caret: number;
  selection: FormulaRange;
  changed: boolean;
  error?: string;
}

function clonePart(part: FormulaPart): FormulaPart {
  if (part.type === "symbol") {
    return {
      type: "symbol",
      entryId: part.entryId,
      bindings: { ...part.bindings },
      ...(part.source ? { source: { ...part.source } } : {}),
    };
  }
  return { ...part };
}

/** Deep-clone formula parts so clipboard and drag operations cannot alias editor state. */
export function cloneFormulaParts(parts: FormulaPart[]): FormulaPart[] {
  return parts.map(clonePart);
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function regionContains(region: FormulaEditRegion, range: FormulaRange) {
  return region.start <= range.start && range.end <= region.end;
}

function nodeOverlaps(node: FormulaEditNode, range: FormulaRange) {
  return node.start < range.end && range.start < node.end;
}

/**
 * Expand a caret selection to complete AST nodes. A fraction, delimiter, or
 * script cannot be copied half-open; content inside a numerator, denominator,
 * or script remains independently selectable when the range stays inside it.
 */
export function normalizeFormulaSelection(
  parts: FormulaPart[],
  symbols: ResearchSymbolEntry[],
  anchor: number,
  focus: number,
  layout: FormulaLayout = "aligned",
): FormulaRange {
  const safeAnchor = Number.isFinite(anchor) ? Math.trunc(anchor) : 0;
  const safeFocus = Number.isFinite(focus) ? Math.trunc(focus) : 0;
  const first = clamp(Math.min(safeAnchor, safeFocus), 0, parts.length);
  const last = clamp(Math.max(safeAnchor, safeFocus), 0, parts.length);
  if (first === last) return { start: first, end: last };

  const model = buildFormulaEditModel(parts, symbols, layout);
  const containing = model.regions
    .filter((region) => regionContains(region, { start: first, end: last }))
    .sort((a, b) => b.depth - a.depth || (a.end - a.start) - (b.end - b.start));
  const region = containing[0] ?? model.root;
  const selected = region.nodes.filter((node) => nodeOverlaps(node, { start: first, end: last }));
  if (!selected.length) return { start: first, end: last };
  return {
    start: Math.min(...selected.map((node) => node.start)),
    end: Math.max(...selected.map((node) => node.end)),
  };
}

function rangeError(parts: FormulaPart[], range: FormulaRange, allowEmpty = false): string | undefined {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) return "公式选区位置无效。";
  if (range.start < 0 || range.end > parts.length || (allowEmpty ? range.start > range.end : range.start >= range.end)) return "公式选区不能为空或超出范围。";
}

function symbolsFor(options: FormulaTransferOptions): ResearchSymbolEntry[] {
  return options.state?.symbols ?? options.symbols ?? [];
}

/** Return a user-facing error without mutating the source formula. */
export function formulaTransferError(
  parts: FormulaPart[],
  state: ResearchNotebookState,
  owner?: FormulaAddress,
  layout: FormulaLayout = "aligned",
): string | null {
  const inputError = formulaInputError(parts);
  if (inputError) return inputError;
  const model = buildFormulaEditModel(parts, state.symbols, layout);
  if (model.errors.length) return model.errors.join("；");
  const rendered = formulaPartsToTex(parts, state.symbols, layout);
  if (rendered.errors.length) return rendered.errors.join("；");
  const texError = renderedTexError(rendered.tex);
  if (texError) return texError;
  if (owner) {
    for (const part of parts) {
      if (part.type !== "symbol") continue;
      const error = formulaSourceError(state, owner, part);
      if (error) return error;
    }
  }
  return null;
}

function validateParts(parts: FormulaPart[], options: FormulaTransferOptions): string | undefined {
  const inputError = formulaInputError(parts);
  if (inputError) return inputError;
  const symbols = symbolsFor(options);
  const model = buildFormulaEditModel(parts, symbols, options.layout ?? "aligned");
  if (model.errors.length) return model.errors.join("；");
  const rendered = formulaPartsToTex(parts, symbols, options.layout ?? "aligned");
  if (rendered.errors.length) return rendered.errors.join("；");
  const texError = renderedTexError(rendered.tex);
  if (texError) return texError;
  if (options.state && options.owner) {
    for (const part of parts) {
      if (part.type !== "symbol") continue;
      const error = formulaSourceError(options.state, options.owner, part);
      if (error) return error;
    }
  }
  return undefined;
}

function formulaInputError(parts: FormulaPart[]): string | undefined {
  if (parts.length > 10_000 || parts.some((part) => !validPart(part))) return "公式包含无法识别的项。";
  const opening = new Set(["fractionStart", "superscriptStart", "subscriptStart", "leftParen", "leftBracket", "leftBrace", "expectationOpen", "normOpen", "traceOpen", "cardinalityOpen", ...Object.keys(formulaGroupedOperators), ...Object.keys(additionalDelimiterPairs)]);
  const closing = new Set(["groupClose", "rightParen", "rightBracket", "rightBrace", "expectationClose", "normClose", "normCloseSquared", "traceClose", "cardinalityClose", ...Object.values(additionalDelimiterPairs).flat()]);
  let depth = 0;
  for (const part of parts) {
    if (part.type === "latex") {
      const error = formulaLatexError(part.tex);
      if (error) return error;
    }
    if (part.type !== "operator") continue;
    if (opening.has(part.operator)) depth += 1;
    if (closing.has(part.operator)) depth = Math.max(0, depth - 1);
    if (depth > 128) return "公式嵌套层数过多，无法完成此操作。";
  }
  return undefined;
}

function renderedTexError(tex: string): string | undefined {
  try {
    katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: "ignore" });
  } catch {
    return "公式包含无法显示的记号，请检查角标与分组。";
  }
  return undefined;
}

function isCompleteSelection(parts: FormulaPart[], range: FormulaRange, symbols: ResearchSymbolEntry[], layout: FormulaLayout) {
  const normalized = normalizeFormulaSelection(parts, symbols, range.start, range.end, layout);
  return normalized.start === range.start && normalized.end === range.end;
}

/** Serialize a normalized, non-empty range for the custom clipboard MIME. */
export function serializeFormulaSelection(
  parts: FormulaPart[],
  symbols: ResearchSymbolEntry[],
  range: FormulaRange,
  layout: FormulaLayout = "aligned",
): SerializedFormulaSelection {
  const error = rangeError(parts, range);
  if (error) throw new Error(error);
  if (!isCompleteSelection(parts, range, symbols, layout)) throw new Error("请选择完整的公式结构后复制。");
  const selected = cloneFormulaParts(parts.slice(range.start, range.end));
  const selectedError = validateParts(selected, { symbols, layout });
  if (selectedError) throw new Error(selectedError);
  const rendered = formulaPartsToTex(selected, symbols, layout);
  if (rendered.errors.length) throw new Error(rendered.errors.join("；"));
  const entries: FormulaClipboardPayload["entries"] = Object.create(null) as FormulaClipboardPayload["entries"];
  for (const part of selected) {
    if (part.type !== "symbol") continue;
    const entry = symbols.find((item) => item.id === part.entryId);
    if (!entry) throw new Error(`缺少符号词条：${part.entryId}`);
    entries[entry.id] = { notation: entry.notation };
  }
  const payload: FormulaClipboardPayload = {
    version: FORMULA_CLIPBOARD_VERSION,
    kind: "formula-selection",
    layout,
    parts: selected,
    entries,
    text: rendered.tex,
  };
  const custom = JSON.stringify(payload);
  return { payload, custom, data: custom, text: rendered.tex, range: { ...range } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validSource(value: unknown) {
  return isRecord(value) && typeof value.noteId === "string" && !!value.noteId && typeof value.formulaId === "string" && !!value.formulaId && typeof value.outputId === "string" && !!value.outputId;
}

function validPart(value: unknown): value is FormulaPart {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "lineBreak" || value.type === "alignmentPoint") return true;
  if (value.type === "operator") return typeof value.operator === "string" && isFormulaOperator(value.operator);
  if (value.type === "latex") return typeof value.tex === "string";
  if (value.type !== "symbol" || typeof value.entryId !== "string" || !isRecord(value.bindings)) return false;
  if (Object.values(value.bindings).some((item) => typeof item !== "string")) return false;
  return value.source === undefined || validSource(value.source);
}

/** Parse and strictly validate a custom clipboard payload. Unknown identities fail closed. */
export function parseFormulaClipboard(custom: string, symbols: ResearchSymbolEntry[]): FormulaClipboardParseResult {
  if (!custom.trim()) return { error: "剪贴板中没有可识别的公式片段。" };
  if (custom.length > 1_000_000) return { error: "剪贴板公式过大，无法粘贴。" };
  let value: unknown;
  try {
    value = JSON.parse(custom);
  } catch {
    return { error: "剪贴板公式数据已损坏。" };
  }
  if (!isRecord(value) || value.version !== FORMULA_CLIPBOARD_VERSION || value.kind !== "formula-selection" || !Array.isArray(value.parts) || !isRecord(value.entries)) {
    return { error: "剪贴板公式版本不受支持。" };
  }
  if (value.layout !== "aligned" && value.layout !== "centered") return { error: "剪贴板公式布局无效。" };
  if (!value.parts.length || value.parts.length > 10_000 || value.parts.some((part) => !validPart(part))) return { error: "剪贴板公式包含无法识别的项。" };
  if (typeof value.text !== "string") return { error: "剪贴板公式缺少文本表示。" };
  const entries = value.entries as Record<string, unknown>;
  for (const part of value.parts as FormulaPart[]) {
    if (part.type !== "symbol") continue;
    const entry = symbols.find((item) => item.id === part.entryId);
    const identity = entries[part.entryId];
    if (!entry || !isRecord(identity) || identity.notation !== entry.notation) {
      return { error: `符号词条“${part.entryId}”已不存在或记号已改变，无法粘贴。` };
    }
  }
  const parts = cloneFormulaParts(value.parts as FormulaPart[]);
  const error = validateParts(parts, { symbols, layout: value.layout });
  if (error) return { error };
  const rendered = formulaPartsToTex(parts, symbols, value.layout);
  if (rendered.errors.length || rendered.tex !== value.text) return { error: "剪贴板公式校验失败，原公式未改变。" };
  return { parts, layout: value.layout, text: value.text };
}

type FormulaTexToken = { text: string; start: number; end: number };

function tokenizeFormulaTex(tex: string): FormulaTexToken[] {
  const tokens: FormulaTexToken[] = [];
  const pattern = /\\[a-zA-Z]+|\\\\|\\[\s\S]|[{}^_&()[\]|,:;+=<>*/-]|[^\s]/g;
  for (const match of tex.matchAll(pattern)) {
    const value = match[0];
    if (/^\s/.test(value)) continue;
    const start = match.index ?? 0;
    tokens.push({ text: value, start, end: start + value.length });
  }
  return tokens;
}

function matchTokenSequence(tokens: FormulaTexToken[], at: number, expected: string[]) {
  return expected.every((value, offset) => tokens[at + offset]?.text === value) ? at + expected.length : undefined;
}

function chooseMatchedSymbol(match: InlineResearchSymbol, source: string, symbols: ResearchSymbolEntry[]) {
  const candidates = match.candidates.filter((entry) => symbols.some((value) => value.id === entry.id));
  if (candidates.length === 0) return { error: "TeX 中的符号没有对应的词典词条。" };
  // TeX allows x^a_b and x_b^a. Compare the three positions independently;
  // the token matcher already checked the symbol body and literal bindings.
  const defaults = candidates.filter((entry) => {
    const bindings = match.bindingsByEntryId?.[entry.id] ?? match.bindings;
    return entry.slots.every((slot) => comparableTex(slot.defaultValue) === comparableTex(bindings[slot.key] ?? ""));
  });
  const unique = defaults.length ? defaults : candidates;
  if (unique.length !== 1) return { error: `TeX 中的符号“${source}”存在多个词典匹配，请先在词典中区分含义。` };
  const bindings = match.bindingsByEntryId?.[unique[0].id] ?? match.bindings;
  return { part: { type: "symbol", entryId: unique[0].id, bindings: { x1: "", x2: "", x3: "", ...bindings } } as FormulaPart };
}

function comparableTex(tex: string) {
  return tex.replace(/\\(?:left|right)\b/g, "").replace(/\s+/g, "").replace(/\{([^{}]*)\}/g, "$1");
}

/** Parse a conservative, dictionary-backed TeX expression into formula parts. */
function parseFormulaTex(text: string, symbols: ResearchSymbolEntry[]): FormulaClipboardParseResult {
  const unwrapped = previewFormulaTex(text);
  if (unwrapped.diagnostic) return { error: unwrapped.diagnostic.message, errorRange: { start: unwrapped.diagnostic.start, end: unwrapped.diagnostic.end } };
  if (!unwrapped.tex) return { error: "剪贴板中没有可识别的公式片段。" };
  const tokens = tokenizeFormulaTex(unwrapped.tex);
  let depth = 0;
  for (const token of tokens) {
    if (["{", "(", "[", "\\{"].includes(token.text)) depth++;
    else if (["}", ")", "]", "\\}"].includes(token.text)) depth = Math.max(0, depth - 1);
    if (depth > 128) return { error: "公式嵌套层数过多，无法完成此操作。" };
  }
  if (tokens.length > 40_000) return { error: "剪贴板公式过大，无法粘贴。" };
  // Validate the original syntax before the positional matcher can normalize
  // it, so duplicate scripts and malformed groups cannot be silently repaired.
  const matchesByToken = new Map<number, { match: InlineResearchSymbol; end: number }>();
  const tokenStarts = new Map(tokens.map((token, index) => [token.start, index]));
  const tokenEnds = new Map(tokens.map((token, index) => [token.end, index]));
  const addSymbolMatches = (text: string, offset = 0) => {
    for (const found of findInlineResearchSymbols(text, symbols)) {
      const match = { ...found, start: found.start + offset, end: found.end + offset };
      const start = tokenStarts.get(match.start), end = tokenEnds.get(match.end);
      if (start !== undefined && end !== undefined && end >= start) {
        matchesByToken.set(start, { match, end: end + 1 });
        // A redundant single-atom group such as {p} is one dictionary match.
        // Script/fraction parsing consumes its opening brace separately.
        if (tokens[start].text === "{" && tokens[end].text === "}") {
          matchesByToken.set(start + 1, { match: { ...match, start: tokens[start + 1].start, end: tokens[end - 1].end }, end });
        }
      }
    }
  };
  addSymbolMatches(unwrapped.tex);
  const structureClosers: Partial<Record<FormulaOperator, FormulaOperator[]>> = {
    ...Object.fromEntries(Object.entries(additionalDelimiterPairs).map(([id, closers]) => [id, [...closers]])),
    expectationOpen: ["expectationClose"], normOpen: ["normCloseSquared", "normClose"], traceOpen: ["traceClose"], cardinalityOpen: ["cardinalityClose"],
  };
  const operatorTokens = (id: FormulaOperator) => tokenizeFormulaTex(formulaOperators.find((entry) => entry.id === id)!.tex).map((token) => token.text);
  const structures = formulaOperators.filter((entry) => structureClosers[entry.id]).map((entry) => ({
    operator: entry.id, tokens: operatorTokens(entry.id), closers: structureClosers[entry.id]!.map((id) => ({ operator: id, tokens: operatorTokens(id) })),
  }));
  const operatorEntries = formulaOperators
    .filter((entry) => entry.tex.trim() && !(entry.id in formulaGroupedOperators) && !structureClosers[entry.id] && !["fractionStart", "fractionDivide", "groupClose", "rightParen", "rightBracket", "rightBrace", "expectationClose", "normClose", "normCloseSquared", "traceClose", "cardinalityClose", "superscriptStart", "subscriptStart", "leftParen", "leftBracket", "leftBrace", ...Object.values(additionalDelimiterPairs).flat()].includes(entry.id))
    .map((entry) => ({ entry, tokens: operatorTokens(entry.id) }))
    .filter((value) => value.tokens.length)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  const operatorAliases: Record<string, FormulaOperator> = {
    "\\leq": "lessEqual", "\\leqslant": "lessEqual", "\\geq": "greaterEqual", "\\geqslant": "greaterEqual",
    "\\neq": "notEqual", "\\ne": "notEqual", "\\cdotp": "dot", "\\dots": "rangeDots", "\\ldots": "rangeDots",
    ",": "comma", ";": "semicolon",
  };
  const spacingCommands = new Set(["\\,", "\\!", "\\:", "\\;", "\\quad", "\\qquad"]);
  const unaryOperators = Object.entries(formulaGroupedOperators).map(([id, prefix]) => ({ id: id as FormulaOperator, tokens: tokenizeFormulaTex(prefix.slice(0, -1)).map(token => token.text) }))
    .sort((a, b) => b.tokens.length - a.tokens.length);
  let cursor = 0;
  let failure: string | undefined;
  let failureRange: FormulaRange | undefined;
  const parseSequence = (stop: (token: string | undefined) => boolean): FormulaPart[] => {
    const result: FormulaPart[] = [];
    while (cursor < tokens.length && !stop(tokens[cursor].text)) {
      const before = cursor;
      const matched = matchesByToken.get(cursor);
      const structure = structures.find((candidate) => matchTokenSequence(tokens, cursor, candidate.tokens));
      const unary = unaryOperators.find(candidate => matchTokenSequence(tokens, cursor, candidate.tokens));
      if (matched) {
        const source = unwrapped.tex.slice(matched.match.start, matched.match.end);
        const chosen = chooseMatchedSymbol(matched.match, source, symbols);
        if (chosen.error) { failure = chosen.error; failureRange = { start: matched.match.start, end: matched.match.end }; return result; }
        result.push(chosen.part!); cursor = matched.end;
      } else if (structure) {
        cursor += structure.tokens.length;
        const body = parseSequence(() => structure.closers.some((candidate) => matchTokenSequence(tokens, cursor, candidate.tokens) !== undefined));
        if (failure) return result;
        const closing = structure.closers.find((candidate) => matchTokenSequence(tokens, cursor, candidate.tokens));
        if (!closing) { failure = "TeX 公式结构缺少匹配的结束标记。"; return result; }
        cursor += closing.tokens.length;
        result.push({ type: "operator", operator: structure.operator }, ...body, { type: "operator", operator: closing.operator });
      } else if (["\\frac", "\\dfrac", "\\tfrac"].includes(tokens[cursor].text)) {
        cursor += 1;
        const numerator = parseGroup();
        const denominator = parseGroup();
        if (!numerator || !denominator) return result;
        result.push({ type: "operator", operator: "fractionStart" }, ...numerator, { type: "operator", operator: "fractionDivide" }, ...denominator, { type: "operator", operator: "groupClose" });
      } else if (unary) {
        cursor += unary.tokens.length;
        const body = parseGroup();
        if (!body) return result;
        result.push({ type: "operator", operator: unary.id }, ...body, { type: "operator", operator: "groupClose" });
      } else if (tokens[cursor].text === "\\left") {
        const delimiter = tokens[cursor + 1]?.text;
        const opening = delimiter === "(" ? "leftParen" : delimiter === "[" ? "leftBracket" : delimiter === "\\{" ? "leftBrace" : undefined;
        if (!opening) { failure = `不支持的 TeX 分隔符：${delimiter ?? ""}`; return result; }
        cursor += 2;
        const body = parseSequence((token) => token === "\\right");
        if (tokens[cursor]?.text !== "\\right") { failure = "TeX 分隔符缺少匹配的 \\right。"; return result; }
        const closing = tokens[cursor + 1]?.text;
        const ending = closing === ")" ? "rightParen" : closing === "]" ? "rightBracket" : closing === "\\}" ? "rightBrace" : undefined;
        if (!ending || (opening === "leftBrace") !== (ending === "rightBrace")) { failure = "TeX 分隔符左右不匹配。"; return result; }
        cursor += 2;
        result.push({ type: "operator", operator: opening }, ...body, { type: "operator", operator: ending });
      } else if (tokens[cursor].text === "(") {
        cursor += 1;
        const body = parseSequence((token) => token === ")");
        if (tokens[cursor]?.text !== ")") { failure = "TeX 圆括号缺少匹配的右括号。"; return result; }
        cursor += 1; result.push({ type: "operator", operator: "leftParen" }, ...body, { type: "operator", operator: "rightParen" });
      } else if (tokens[cursor].text === "[") {
        cursor += 1;
        const body = parseSequence((token) => token === "]");
        if (tokens[cursor]?.text !== "]") { failure = "TeX 方括号缺少匹配的右括号。"; return result; }
        cursor += 1; result.push({ type: "operator", operator: "leftBracket" }, ...body, { type: "operator", operator: "rightBracket" });
      } else if (tokens[cursor].text === "^" || tokens[cursor].text === "_") {
        const operator = tokens[cursor].text === "^" ? "superscriptStart" : "subscriptStart";
        cursor += 1; const body = tokens[cursor]?.text === "{" ? parseGroup() : parseSingle();
        if (!body) return result;
        result.push({ type: "operator", operator }, ...body, { type: "operator", operator: "groupClose" });
      } else {
        const alias = operatorAliases[tokens[cursor].text];
        const operator = operatorEntries.find((candidate) => matchTokenSequence(tokens, cursor, candidate.tokens));
        if (operator && (!alias || operator.tokens.length > 1)) {
          cursor += operator.tokens.length;
          result.push({ type: "operator", operator: operator.entry.id });
        } else if (alias) {
          cursor += 1;
          result.push({ type: "operator", operator: alias });
        } else if (tokens[cursor].text === "\\middle" && tokens[cursor + 1]?.text === "|") {
          cursor += 2; result.push({ type: "operator", operator: "conditionalBar" });
        } else if (spacingCommands.has(tokens[cursor].text)) {
          cursor += 1;
        } else if (tokens[cursor].text === "\\\\") {
          cursor += 1; result.push({ type: "lineBreak" });
        } else if (tokens[cursor].text === "&") {
          cursor += 1; result.push({ type: "alignmentPoint" });
        } else {
          failure = `TeX 片段“${tokens[cursor].text}”没有对应的符号或运算符。`;
          return result;
        }
      }
      if (cursor === before) { failure = "TeX 解析没有前进。"; return result; }
    }
    return result;
  };
  const parseGroup = (): FormulaPart[] | undefined => {
    if (tokens[cursor]?.text !== "{") { failure = "TeX 分组缺少左花括号。"; return; }
    cursor += 1; const result = parseSequence((token) => token === "}");
    if (failure) return;
    if (tokens[cursor]?.text !== "}") { failure = "TeX 分组缺少右花括号。"; return; }
    cursor += 1; return result;
  };
  const parseSingle = (): FormulaPart[] | undefined => {
    const start = cursor;
    // Without braces TeX reads exactly one atom, not that atom's following
    // script or function argument. The full-expression matcher is intentionally
    // greedy, so match this bounded slice independently (1^p_h = 1^{p}_{h}).
    const argumentCounts: Record<string, number> = {
      "\\frac": 2, "\\dfrac": 2, "\\tfrac": 2,
      "\\boldsymbol": 1, "\\mathbf": 1, "\\mathrm": 1, "\\mathit": 1, "\\mathsf": 1, "\\mathtt": 1, "\\mathcal": 1, "\\mathbb": 1, "\\mathfrak": 1, "\\mathscr": 1, "\\bm": 1, "\\bold": 1,
      "\\dot": 1, "\\ddot": 1, "\\hat": 1, "\\widehat": 1, "\\tilde": 1, "\\widetilde": 1, "\\vec": 1, "\\bar": 1, "\\overline": 1, "\\underline": 1, "\\breve": 1, "\\check": 1, "\\acute": 1, "\\grave": 1,
    };
    const atomEnd = (at: number): number | undefined => {
      const token = tokens[at]?.text;
      if (!token || ["}", "^", "_"].includes(token)) return;
      if (token === "{") {
        let depth = 1;
        for (let index = at + 1; index < tokens.length; index++) {
          if (tokens[index].text === "{") depth++;
          if (tokens[index].text === "}" && --depth === 0) return index + 1;
        }
        return;
      }
      let end = at + 1;
      for (let argument = 0; argument < (argumentCounts[token] ?? 0); argument++) {
        const next = atomEnd(end);
        if (next === undefined) return;
        end = next;
      }
      return end;
    };
    const end = atomEnd(start);
    if (end === undefined) { failure = "TeX 角标缺少完整的内容。"; return; }
    const parsed = parseFormulaTex(unwrapped.tex.slice(tokens[start].start, tokens[end - 1].end), symbols);
    if (parsed.error || !parsed.parts?.length) {
      failure = parsed.error ?? "TeX 角标无法匹配。";
      if (parsed.errorRange) failureRange = { start: tokens[start].start + parsed.errorRange.start, end: tokens[start].start + parsed.errorRange.end };
      return;
    }
    const greedyMatch = matchesByToken.get(start);
    if (greedyMatch && end < greedyMatch.end) {
      // The original greedy match hid symbols in the following argument, e.g.
      // t in 1^p(t). Those tokens belong to the outer expression again.
      addSymbolMatches(unwrapped.tex.slice(tokens[end].start, tokens[greedyMatch.end - 1].end), tokens[end].start);
    }
    cursor = end;
    return parsed.parts;
  };
  const parts = parseSequence(() => false);
  if (failure || cursor !== tokens.length) {
    const range = failureRange ?? tokens[cursor] ?? { start: unwrapped.tex.length, end: unwrapped.tex.length };
    return { error: failure ?? "TeX 公式未完整解析。", errorRange: { start: unwrapped.sourceOffset + range.start, end: unwrapped.sourceOffset + range.end } };
  }
  const error = validateParts(parts, { symbols, layout: unwrapped.layout });
  return error ? { error } : { parts, layout: unwrapped.layout, text: unwrapped.tex };
}

export function parseFormulaText(text: string, symbols: ResearchSymbolEntry[]): FormulaClipboardParseResult {
  const value = text.trim();
  if (!value) return { error: "剪贴板中没有可识别的公式片段。" };
  if (value.length > 1_000_000) return { error: "剪贴板公式过大，无法粘贴。" };
  const operators = formulaOperators.filter((item) => item.tex.trim() === value);
  const symbolCandidates = symbols.flatMap((entry) => {
    const bindings = Object.fromEntries(entry.slots.map((slot) => [slot.key, slot.defaultValue]));
    const empty = Object.fromEntries(entry.slots.map((slot) => [slot.key, ""]));
    const candidates = JSON.stringify(bindings) === JSON.stringify(empty) ? [bindings] : [bindings, empty];
    return candidates.filter((candidate) => resolveSymbolEntry(entry, candidate).tex.trim() === value).map((candidate) => ({ entry, bindings: candidate }));
  });
  if (operators.length + symbolCandidates.length !== 1) {
    return parseFormulaTex(text, symbols);
  }
  if (operators.length) {
    const parts: FormulaPart[] = [{ type: "operator", operator: operators[0].id }];
    const error = validateParts(parts, { symbols });
    return error ? { error } : { parts, layout: "aligned", text: value };
  }
  const candidate = symbolCandidates[0];
  const parts: FormulaPart[] = [{ type: "symbol", entryId: candidate.entry.id, bindings: { ...candidate.bindings } }];
  const error = validateParts(parts, { symbols });
  return error ? { error } : { parts, layout: "aligned", text: value };
}

export function parseFormulaClipboardData(
  data: { custom?: string; text?: string },
  symbols: ResearchSymbolEntry[],
): FormulaClipboardParseResult {
  if (data.custom !== undefined) {
    return parseFormulaClipboard(data.custom, symbols);
  }
  return parseFormulaText(data.text ?? "", symbols);
}

function normalizedRange(parts: FormulaPart[], range: FormulaRange, allowEmpty = false): FormulaRange | undefined {
  return rangeError(parts, range, allowEmpty) ? undefined : { start: range.start, end: range.end };
}

/** Atomically replace a selection. On any validation failure, the original array is returned. */
export function replaceFormulaSelection(
  parts: FormulaPart[],
  range: FormulaRange,
  inserted: FormulaPart[],
  options: FormulaTransferOptions = {},
): FormulaTransferTransaction {
  const validRange = normalizedRange(parts, range, true);
  if (!validRange) return { parts, caret: range.start, selection: range, changed: false, error: rangeError(parts, range, true) };
  if (!isCompleteSelection(parts, validRange, symbolsFor(options), options.layout ?? "aligned")) {
    return { parts, caret: validRange.start, selection: validRange, changed: false, error: "请选择完整的公式结构后替换。" };
  }
  const next = [...parts.slice(0, validRange.start), ...cloneFormulaParts(inserted), ...parts.slice(validRange.end)];
  const error = options.state ? formulaTransferError(next, options.state, options.owner, options.layout) : validateParts(next, options);
  if (error) return { parts, caret: validRange.start, selection: validRange, changed: false, error };
  const caret = validRange.start + inserted.length;
  if (JSON.stringify(next) === JSON.stringify(parts)) return { parts, caret, selection: { start: validRange.start, end: caret }, changed: false };
  return { parts: next, caret, selection: { start: validRange.start, end: caret }, changed: true };
}

/** Atomically move a complete selection to a caret position in the same formula. */
export function moveFormulaSelection(
  parts: FormulaPart[],
  range: FormulaRange,
  target: number,
  options: FormulaTransferOptions = {},
): FormulaTransferTransaction {
  const validRange = normalizedRange(parts, range);
  if (!validRange || !Number.isInteger(target) || target < 0 || target > parts.length) {
    return { parts, caret: validRange?.start ?? 0, selection: validRange ?? range, changed: false, error: "公式拖动位置无效。" };
  }
  if (!isCompleteSelection(parts, validRange, symbolsFor(options), options.layout ?? "aligned")) {
    return { parts, caret: validRange.start, selection: validRange, changed: false, error: "请选择完整的公式结构后拖动。" };
  }
  if (target >= validRange.start && target <= validRange.end) return { parts, caret: validRange.start, selection: validRange, changed: false };
  const selected = cloneFormulaParts(parts.slice(validRange.start, validRange.end));
  const remaining = [...parts.slice(0, validRange.start), ...parts.slice(validRange.end)];
  const insertion = target > validRange.end ? target - (validRange.end - validRange.start) : target;
  const next = [...remaining.slice(0, insertion), ...selected, ...remaining.slice(insertion)];
  const error = options.state ? formulaTransferError(next, options.state, options.owner, options.layout) : validateParts(next, options);
  if (error) return { parts, caret: validRange.start, selection: validRange, changed: false, error };
  const selection = normalizeFormulaSelection(next, symbolsFor(options), insertion, insertion + selected.length, options.layout ?? "aligned");
  return {
    parts: next,
    caret: selection.end,
    selection,
    changed: true,
  };
}
