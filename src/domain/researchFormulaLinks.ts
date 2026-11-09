import { resolveSymbolEntry, type FormulaOutput, type FormulaPart, type FormulaSourceReference, type ResearchSymbolEntry } from "./researchDictionary.ts";
import type { ResearchFormulaBlock, ResearchNote, ResearchNotebookState } from "./researchNotebook.ts";
import { findResearchBlock, flattenResearchBlocks } from "./researchBlockTree.ts";

export interface FormulaAddress { noteId: string; formulaId: string }
export type SymbolPart = Extract<FormulaPart, { type: "symbol" }>;
export interface FormulaResult {
  note: ResearchNote;
  formula: ResearchFormulaBlock;
  output: FormulaOutput;
  reference: FormulaSourceReference;
}

export const formulaSourceKey = (reference: FormulaSourceReference) => JSON.stringify([reference.noteId, reference.formulaId, reference.outputId]);
const addressKey = (address: FormulaAddress) => JSON.stringify([address.noteId, address.formulaId]);

export function findResearchFormula(state: ResearchNotebookState, address: FormulaAddress) {
  const note = state.notes.find((item) => item.id === address.noteId);
  const block = note && findResearchBlock(note.blocks, address.formulaId)?.block;
  return note && block?.type === "formula" ? { note, formula: block } : undefined;
}

export function researchFormulaTitle(formula: ResearchFormulaBlock, note: ResearchNote) {
  return formula.caption?.trim().split("\n")[0] || "公式 " + (flattenResearchBlocks(note.blocks).filter((block) => block.type === "formula").findIndex((block) => block.id === formula.id) + 1);
}

export function resolveFormulaSource(state: ResearchNotebookState, source: FormulaSourceReference): FormulaResult | undefined {
  const found = findResearchFormula(state, source);
  const output = found?.formula.outputs?.find((item) => item.id === source.outputId);
  return found && output ? { ...found, output, reference: source } : undefined;
}

function reachesFormula(state: ResearchNotebookState, from: FormulaAddress, target: FormulaAddress, visited = new Set<string>()): boolean {
  const key = addressKey(from);
  if (key === addressKey(target)) return true;
  if (visited.has(key)) return false;
  visited.add(key);
  return findResearchFormula(state, from)?.formula.parts?.some((part) =>
    part.type === "symbol" && part.source && reachesFormula(state, part.source, target, visited),
  ) ?? false;
}

export function listFormulaOutputs(state: ResearchNotebookState, entryId: string, consumer?: FormulaAddress): FormulaResult[] {
  return state.notes.flatMap((note) => flattenResearchBlocks(note.blocks).flatMap((formula) => {
    if (formula.type !== "formula") return [];
    if (consumer && reachesFormula(state, { noteId: note.id, formulaId: formula.id }, consumer)) return [];
    return (formula.outputs ?? []).filter((output) => output.entryId === entryId).map((output) => ({
      note, formula, output, reference: { noteId: note.id, formulaId: formula.id, outputId: output.id },
    }));
  }));
}

/** The shared dictionary slots identify corresponding indices; each occurrence stores its own local binding. */
export function sourceIndexMapping(entry: ResearchSymbolEntry, output: FormulaOutput, part: SymbolPart) {
  return entry.slots.flatMap((slot) => {
    const from = output.bindings[slot.key]?.trim() ?? "";
    const to = part.bindings[slot.key]?.trim() ?? "";
    if (slot.optional && !from && !to) return [];
    const missing = slot.optional ? "\\varnothing" : "?";
    return [{ key: slot.key, label: slot.label, from: from || missing, to: to || missing }];
  });
}

export function formulaSourceError(state: ResearchNotebookState, consumer: FormulaAddress, part: SymbolPart): string | null {
  if (!part.source) return null;
  const found = resolveFormulaSource(state, part.source);
  if (!found) return "来源公式或结果不存在，请重新选择推导来源。";
  if (found.output.entryId !== part.entryId) return "来源结果与当前符号词条不一致，请重新选择。";
  const entry = state.symbols.find((item) => item.id === part.entryId);
  if (!entry) return "来源结果缺少符号词条。";
  if (resolveSymbolEntry(entry, found.output.bindings).missingSlots.length || resolveSymbolEntry(entry, part.bindings).missingSlots.length) return "来源结果或当前符号的索引不完整。";
  if (reachesFormula(state, part.source, consumer)) return "该来源会形成循环推导，公式不能引用自身或依赖自己的公式。";
  return null;
}

export function listFormulaConsumers(state: ResearchNotebookState, address: FormulaAddress, outputId?: string) {
  return state.notes.flatMap((note) => flattenResearchBlocks(note.blocks).flatMap((formula) => {
    if (formula.type !== "formula") return [];
    return (formula.parts ?? []).flatMap((part, partIndex) =>
      part.type === "symbol" && part.source?.noteId === address.noteId && part.source.formulaId === address.formulaId && (!outputId || part.source.outputId === outputId)
        ? [{ noteId: note.id, noteTitle: note.title, formulaId: formula.id, formula, partIndex, outputId: part.source.outputId }] : [],
    );
  }));
}

export function formulaMetadataError(state: ResearchNotebookState, address: FormulaAddress, outputs: FormulaOutput[]): string | null {
  const ids = new Set<string>();
  const symbols = new Set<string>();
  for (const output of outputs) {
    if (!output.id || ids.has(output.id)) return "结果标识不能为空或重复。";
    ids.add(output.id);
    const entry = state.symbols.find((item) => item.id === output.entryId);
    if (!entry) return "结果符号缺少词典词条。";
    if (resolveSymbolEntry(entry, output.bindings).missingSlots.length) return "请填写结果符号的全部索引。";
    const identity = JSON.stringify([entry.id, entry.slots.map((slot) => output.bindings[slot.key]?.trim() ?? "")]);
    if (symbols.has(identity)) return "结果符号和索引重复，请保留一条结果声明。";
    symbols.add(identity);
  }
  const original = findResearchFormula(state, address)?.formula;
  for (const use of listFormulaConsumers(state, address)) {
    const before = original?.outputs?.find((output) => output.id === use.outputId);
    const after = outputs.find((output) => output.id === use.outputId);
    if (!after || (before && before.entryId !== after.entryId)) return "该结果仍被其他公式引用，请先解除来源关联，再删除或更换结果符号。";
  }
  return null;
}
