import { positionSlots, symbolPositionSuffix, toPositionalSymbol } from "./researchSymbolPositions.ts";
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from "./researchNotebook.ts";
import { invalidateResearchReviews } from "./researchNoteOrganization.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";
import { initialSymbolTags } from "./researchSymbolOrganization.ts";
import { normalizeResearchTags } from "./researchTags.ts";
import { additionalFormulaOperators, type AdditionalFormulaOperator } from "./formulaOperatorExtensions.ts";
import { joinFormulaTex } from "./formulaLatex.ts";

export type SymbolCategory = "time" | "index" | "state" | "control" | "communication" | "scheduler" | "evaluation" | "custom";
export type IndexDomain = "packet" | "adoption" | "scheduler-event" | "loop" | "time" | "generic";
export interface SymbolIndexSlot {
  key: string;
  label: string;
  domain: IndexDomain;
  defaultValue: string;
  description?: string;
  examples?: string[];
  optional?: boolean;
  placement?: "inline" | "parentheses" | "suffix-subscript";
}
export interface ResearchSymbolEntry {
  id: string;
  name: string;
  aliases?: string[];
  notation: string;
  meaning: string;
  category: SymbolCategory;
  tags?: string[];
  unit?: string;
  scope?: string;
  slots: SymbolIndexSlot[];
}

export type FormulaOperator =
  | AdditionalFormulaOperator
  | "equals" | "plus" | "minus" | "times" | "divide" | "comma" | "semicolon"
  | "leftParen" | "rightParen" | "leftBracket" | "rightBracket"
  | "leftBrace" | "rightBrace" | "lessThan" | "lessEqual" | "greaterThan"
  | "greaterEqual" | "notEqual" | "intersection" | "to" | "implies" | "iff" | "and" | "suchThat" | "quad"
  | "colon" | "dot" | "integral" | "sum" | "juxtapose" | "in"
  | "derivativeDot" | "superscriptStart" | "groupClose" | "transpose" | "inverse"
  | "expectationOpen" | "conditionalBar" | "expectationClose"
  | "fractionStart" | "fractionDivide" | "infimum" | "zero"
  | "normOpen" | "normClose" | "normCloseSquared" | "traceOpen" | "traceClose"
  | "subscriptStart" | "rangeDots" | "differential" | "one"
  | "two"
  | "subsetEqual" | "cardinalityOpen" | "cardinalityClose" | "minimum" | "maximum";
export interface FormulaSourceReference {
  noteId: string;
  formulaId: string;
  outputId: string;
}
export interface FormulaOutput {
  id: string;
  entryId: string;
  bindings: Record<string, string>;
  recipe?: import("./researchRecipeMetadata").FormulaRecipe;
}
export type FormulaLayout = "centered" | "aligned";
export type FormulaPart =
  | { type: "symbol"; entryId: string; bindings: Record<string, string>; source?: FormulaSourceReference }
  | { type: "operator"; operator: FormulaOperator }
  | { type: "latex"; tex: string }
  | { type: "lineBreak" }
  | { type: "alignmentPoint" };

export const formulaOperators: { id: FormulaOperator; label: string; tex: string }[] = [
  { id: "equals", label: "= 等于", tex: "=" },
  { id: "plus", label: "+ 加", tex: "+" },
  { id: "minus", label: "− 减", tex: "-" },
  { id: "times", label: "× 乘", tex: "\\times" },
  { id: "divide", label: "/ 除", tex: "/" },
  { id: "comma", label: ", 逗号", tex: ",\\," },
  { id: "semicolon", label: "; 分隔", tex: ";\\," },
  { id: "leftParen", label: "( 左括号", tex: "\\left(" },
  { id: "rightParen", label: ") 右括号", tex: "\\right)" },
  { id: "leftBracket", label: "[ 左方括号", tex: "\\left[" },
  { id: "rightBracket", label: "] 右方括号", tex: "\\right]" },
  { id: "leftBrace", label: "{ 左花括号", tex: "\\left\\{" },
  { id: "rightBrace", label: "} 右花括号", tex: "\\right\\}" },
  { id: "lessThan", label: "< 小于", tex: "<" },
  { id: "lessEqual", label: "≤ 小于等于", tex: "\\le " },
  { id: "greaterThan", label: "> 大于", tex: ">" },
  { id: "greaterEqual", label: "≥ 大于等于", tex: "\\ge " },
  { id: "notEqual", label: "≠ 不等于", tex: "\\ne " },
  { id: "intersection", label: "∩ 交集", tex: "\\cap" },
  { id: "to", label: "→ 指向", tex: "\\to" },
  { id: "implies", label: "⇒ 推出", tex: "\\implies" },
  { id: "iff", label: "⇔ 等价", tex: "\\iff" },
  { id: "and", label: "并且", tex: "\\quad\\text{and}\\quad" },
  { id: "suchThat", label: "满足条件", tex: "\\mid" },
  { id: "quad", label: "间距", tex: "\\quad" },
  { id: "colon", label: ": 冒号", tex: ":" },
  { id: "dot", label: "· 点乘", tex: "\\cdot" },
  { id: "integral", label: "∫ 积分", tex: "\\int" },
  { id: "sum", label: "∑ 求和", tex: "\\sum" },
  { id: "subscriptStart", label: "_ 下标开始", tex: "_{" },
  { id: "rangeDots", label: "… 范围省略", tex: "\\ldots" },
  { id: "differential", label: "d 微分", tex: "\\,\\mathrm{d}" },
  { id: "one", label: "1 常数", tex: "1" },
  { id: "two", label: "2 常数", tex: "2" },
  { id: "juxtapose", label: "相邻乘积", tex: "" },
  { id: "in", label: "∈ 属于", tex: "\\in" },
  { id: "subsetEqual", label: "⊆ 子集", tex: "\\subseteq" },
  { id: "cardinalityOpen", label: "| 集合基数开始", tex: "\\left|" },
  { id: "cardinalityClose", label: "| 集合基数结束", tex: "\\right|" },
  { id: "minimum", label: "min 最小值", tex: "\\min" },
  { id: "maximum", label: "max 最大值", tex: "\\max" },
  { id: "derivativeDot", label: "点导数开始", tex: "\\dot{" },
  { id: "superscriptStart", label: "上标开始", tex: "^{" },
  { id: "groupClose", label: "} 结束分组", tex: "}" },
  { id: "transpose", label: "ᵀ 转置", tex: "^{\\mathsf T}" },
  { id: "inverse", label: "⁻¹ 逆矩阵", tex: "^{-1}" },
  { id: "expectationOpen", label: "E[ 条件期望开始", tex: "\\mathbb{E}\\!\\left[" },
  { id: "conditionalBar", label: "| 条件于", tex: "\\,\\middle|\\," },
  { id: "expectationClose", label: "] 结束期望", tex: "\\right]" },
  { id: "fractionStart", label: "分数开始", tex: "\\frac{" },
  { id: "fractionDivide", label: "分数上下项", tex: "}{" },
  { id: "infimum", label: "inf 下确界", tex: "\\inf" },
  { id: "zero", label: "0 零", tex: "0" },
  { id: "normOpen", label: "范数开始", tex: "\\left\\|" },
  { id: "normClose", label: "二范数结束", tex: "\\right\\|_2" },
  { id: "normCloseSquared", label: "二范数平方结束", tex: "\\right\\|_2^2" },
  { id: "traceOpen", label: "迹开始", tex: "\\operatorname{tr}\\left(" },
  { id: "traceClose", label: "迹结束", tex: "\\right)" },
  ...additionalFormulaOperators,
];
const operatorTex = new Map(formulaOperators.map(({ id, tex }) => [id, tex]));
export const isFormulaOperator = (value: string): value is FormulaOperator => operatorTex.has(value as FormulaOperator);

/** General examples are created only for a new workspace, never while reading saved data. */
export function createDefaultSymbolEntries(): ResearchSymbolEntry[] {
  return [
    ["x", "输入变量", "线性关系中的输入"], ["y", "输出变量", "线性关系的结果"],
    ["a", "比例系数", "输入变化对应的输出比例"], ["b", "偏置", "输入为零时的输出"],
  ].map(([base, name, meaning]) => ({
    id: `example-${base}`, name, meaning, category: "custom", notation: base + symbolPositionSuffix,
    tags: ["示例/数学"], slots: positionSlots({}, { x1: "可选的次数或状态标记", x2: "可选的对象编号", x3: "可选的自变量，如 (t)" }),
  }));
}

export function createSymbolEntry(entry: Omit<ResearchSymbolEntry, "id">, id = `symbol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`): ResearchSymbolEntry {
  const aliases = [...new Set((entry.aliases ?? []).map(alias => alias.trim()).filter(Boolean))];
  return toPositionalSymbol({ ...entry, id, ...(aliases.length ? { aliases } : {}), tags: entry.tags === undefined ? initialSymbolTags(entry.category) : normalizeResearchTags(entry.tags) });
}

export function resolveSymbolEntry(entry: ResearchSymbolEntry, bindings: Record<string, string>) {
  const tex = entry.notation.replace(/\^\{\[x1\]\}|_\{\[x2\]\}|\[x3\]/g, (placeholder) => {
    const key = placeholder.includes("x1") ? "x1" : placeholder.includes("x2") ? "x2" : "x3";
    const value = bindings[key] ?? "";
    return !value ? "" : key === "x1" ? `^{${value}}` : key === "x2" ? `_{${value}}` : value;
  });
  return { tex, bindings: { ...bindings }, missingSlots: [] as string[] };
}

export function symbolEntryError(entry: ResearchSymbolEntry, existing: ResearchSymbolEntry[]): string | null {
  if (!entry.name.trim() || !entry.meaning.trim() || !entry.notation.trim()) return "名称、符号和含义均不能为空";
  if (!entry.notation.endsWith(symbolPositionSuffix) || /\[[a-zA-Z0-9_-]+\]/.test(entry.notation.slice(0, -symbolPositionSuffix.length))) return "符号模板必须使用三个位置：^{[x1]}_{[x2]}[x3]";
  if (entry.slots.length !== 3 || entry.slots.some((slot, index) => slot.key !== ["x1", "x2", "x3"][index])) return "只保留右上角、右下角、右侧三个固定槽位";
  const signature = (value: ResearchSymbolEntry) => JSON.stringify([value.notation.replace(/\s+/g, ""), value.slots.map((slot) => slot.defaultValue)]);
  if (existing.some((value) => value.id !== entry.id && signature(value) === signature(entry))) return "已存在相同的符号模板和默认位置取值，请编辑原词条或补充该符号的含义差异";
  const labels = [entry.name, ...(entry.aliases ?? [])].map(value => value.trim().toLocaleLowerCase()).filter(Boolean);
  if (new Set(labels).size !== labels.length) return "符号名称和别名不能重复";
  const occupied = new Set(existing.filter(value => value.id !== entry.id).flatMap(value => [value.name, ...(value.aliases ?? [])]).map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
  if (labels.some(label => occupied.has(label))) return "符号名称或别名已存在";
  return null;
}

export function formulaPartsToTex(parts: FormulaPart[], entries: ResearchSymbolEntry[], layout: FormulaLayout = "aligned") {
  const errors: string[] = [];
  const tex = joinFormulaTex(parts.map((part) => {
    if (part.type === "lineBreak") return "\\\\";
    if (part.type === "alignmentPoint") {
      if (layout === "centered") {
        errors.push("居中多行公式不能包含对齐点");
        return "";
      }
      return "&";
    }
    if (part.type === "operator") {
      const value = operatorTex.get(part.operator);
      if (value === undefined) errors.push(`未知公式运算符：${String(part.operator)}`);
      return value ?? "";
    }
    if (part.type === "latex") return `{${part.tex}}`;
    const entry = entries.find((value) => value.id === part.entryId);
    if (!entry) {
      errors.push(`缺少符号词条：${part.entryId}`);
      return "\\color{#bb243b}{?}";
    }
    const resolved = resolveSymbolEntry(entry, part.bindings);
    if (resolved.missingSlots.length) errors.push(`${entry.name}缺少索引：${resolved.missingSlots.join("、")}`);
    return resolved.tex;
  }));
  const hasLayout = parts.some((part) => part.type === "lineBreak" || part.type === "alignmentPoint");
  if (!hasLayout) return { tex, errors };
  const environment = layout === "centered" ? "gathered" : "aligned";
  return { tex: `\\begin{${environment}}${tex}\\end{${environment}}`, errors };
}

function formulaBlocks(note: ResearchNote): Extract<ResearchNotebookBlock, { type: "formula" }>[] {
  return flattenResearchBlocks(note.blocks).filter((block): block is Extract<ResearchNotebookBlock, { type: "formula" }> => block.type === "formula");
}

export function listSymbolUses(notes: ResearchNote[], entryId: string) {
  return notes.flatMap((note) => formulaBlocks(note).flatMap((block) =>
    block.parts?.some((part) => part.type === "symbol" && part.entryId === entryId) || block.outputs?.some((output) => output.entryId === entryId)
      ? [{ noteId: note.id, noteTitle: note.title, blockId: block.id }] : []));
}

export function addSymbolEntry(state: ResearchNotebookState, entry: ResearchSymbolEntry): ResearchNotebookState {
  if (symbolEntryError(entry, state.symbols)) return state;
  return { ...state, symbols: [...state.symbols, entry] };
}

export function updateSymbolEntry(state: ResearchNotebookState, entry: ResearchSymbolEntry): ResearchNotebookState {
  const current = state.symbols.find((value) => value.id === entry.id);
  if (!current) return state;
  const aliases = new Set((entry.aliases ?? []).map(value => value.trim()).filter(Boolean));
  if (current.name.trim() && current.name.trim() !== entry.name.trim()) aliases.add(current.name.trim());
  const nextEntry = { ...entry, ...(aliases.size ? { aliases: [...aliases] } : {}) };
  if (symbolEntryError(nextEntry, state.symbols)) return state;
  if (JSON.stringify(current) === JSON.stringify(nextEntry)) return state;
  const { tags: _oldTags, ...oldDefinition } = current;
  const { tags: _newTags, ...newDefinition } = nextEntry;
  return { ...state, symbols: state.symbols.map((value) => value.id === entry.id ? nextEntry : value),
    notes: JSON.stringify(oldDefinition) === JSON.stringify(newDefinition) ? state.notes : invalidateResearchReviews(state.notes, listSymbolUses(state.notes, entry.id).map((use) => use.noteId)) };
}

export function deleteSymbolEntry(state: ResearchNotebookState, entryId: string): ResearchNotebookState {
  if (listSymbolUses(state.notes, entryId).length) return state;
  return { ...state, symbols: state.symbols.filter((entry) => entry.id !== entryId) };
}

export function normalizeSymbolEntries(value: unknown): ResearchSymbolEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Map<string, ResearchSymbolEntry>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.notation !== "string" || typeof entry.meaning !== "string" || !Array.isArray(entry.slots)) continue;
    const slots = entry.slots.flatMap((slot): SymbolIndexSlot[] => {
      if (!slot || typeof slot !== "object") return [];
      const value = slot as Record<string, unknown>;
      if (typeof value.key !== "string" || typeof value.defaultValue !== "string") return [];
      return [{ key: value.key, label: typeof value.label === "string" ? value.label : value.key, defaultValue: value.defaultValue, ...(typeof value.description === "string" ? { description: value.description } : {}), domain: value.domain as IndexDomain ?? "generic", ...(value.placement ? { placement: value.placement as SymbolIndexSlot["placement"] } : {}) }];
    });
    const candidate = toPositionalSymbol({
      id: entry.id, name: entry.name, notation: entry.notation, meaning: entry.meaning,
      ...(Array.isArray(entry.aliases) ? { aliases: [...new Set(entry.aliases.filter((value): value is string => typeof value === "string").map(value => value.trim()).filter(Boolean))] } : {}),
      category: ["time", "index", "state", "control", "communication", "scheduler", "evaluation", "custom"].includes(String(entry.category)) ? entry.category as SymbolCategory : "custom",
      tags: entry.tags === undefined ? initialSymbolTags(entry.category as SymbolCategory) : normalizeResearchTags(entry.tags),
      ...(typeof entry.unit === "string" ? { unit: entry.unit } : {}), ...(typeof entry.scope === "string" ? { scope: entry.scope } : {}), slots,
    });
    normalized.set(candidate.id, candidate);
  }
  return [...normalized.values()];
}
