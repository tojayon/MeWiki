import { resolveSymbolEntry, type FormulaOutput, type FormulaSourceReference } from "./researchDictionary.ts";
import type { ResearchFormulaBlock, ResearchNotebookState } from "./researchNotebook.ts";
import { buildFormulaEditModel } from "./formulaEditing.ts";
import { findResearchFormula, formulaSourceKey, listFormulaOutputs, resolveFormulaSource, type FormulaAddress, type FormulaResult, type SymbolPart } from "./researchFormulaLinks.ts";
import type { RecipeInputRole, RecipeKind } from "./researchRecipeMetadata.ts";

export interface RecipeInput { part: SymbolPart; role: RecipeInputRole }
export interface VariableRecipe {
  result?: FormulaResult;
  kind: RecipeKind;
  inputs: RecipeInput[];
  peers: FormulaOutput[];
  warning?: string;
}
export const variableIdentity = (part: Pick<SymbolPart, "entryId" | "bindings">) => JSON.stringify([part.entryId,
  Object.entries(part.bindings).filter(([, value]) => value.trim()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, value.trim()])]);
export const recipeInputKey = (part: Pick<SymbolPart, "entryId" | "bindings" | "source">) => JSON.stringify([variableIdentity(part), part.source ? formulaSourceKey(part.source) : null]);
export const recipeOccurrenceKey = (owner: FormulaAddress, part: SymbolPart) => JSON.stringify([owner.noteId, owner.formulaId, recipeInputKey(part)]);
export const variableRecipeSignature = (formula: ResearchFormulaBlock) => JSON.stringify(formula.parts ?? formula.tex);

export function listVariableRecipes(state: ResearchNotebookState, owner: FormulaAddress, part: SymbolPart) {
  const candidates = listFormulaOutputs(state, part.entryId);
  if (part.source) {
    const selected = resolveFormulaSource(state, part.source);
    const error = !selected ? "来源公式或结果不存在，请修复来源关联。" : selected.output.entryId !== part.entryId ? "来源结果与当前变量不一致。" : undefined;
    return { candidates, selected: error ? undefined : selected, error };
  }
  const own = candidates.filter(result => result.note.id === owner.noteId && result.formula.id === owner.formulaId && variableIdentity(result.output) === variableIdentity(part));
  return { candidates, selected: own.length === 1 ? own[0] : undefined, error: undefined };
}

/** All inputs offered in settings are actual occurrences, never parsed names from a TeX string. */
export function variableRecipeCandidates(state: ResearchNotebookState, formula: ResearchFormulaBlock, output: FormulaOutput): RecipeInput[] {
  const candidates = new Map<string, RecipeInput>();
  const boundIndices: { identity: string; start: number; end: number }[] = [];
  const model = buildFormulaEditModel(formula.parts ?? [], state.symbols, formula.layout);
  for (const region of model.regions) for (const [at, node] of region.nodes.entries()) {
    const base = formula.parts?.[node.start];
    if (base?.type !== "operator" || !["sum", "infimum", "minimum", "maximum"].includes(base.operator)) continue;
    const lower = node.scripts?.find(script => script.region?.kind === "subscript")?.region;
    const first = lower?.nodes[0] && formula.parts?.[lower.nodes[0].start];
    if (first?.type === "symbol" && lower) {
      const boundary = region.nodes.slice(at + 1).find(next => {
        const part = formula.parts?.[next.start];
        return part?.type === "lineBreak" || (part?.type === "operator" && ["plus", "minus", "equals", "comma", "semicolon", "quad"].includes(part.operator));
      });
      boundIndices.push({ identity: variableIdentity(first), start: lower.start, end: boundary?.start ?? region.end });
    }
  }
  for (const [index, part] of (formula.parts ?? []).entries()) {
    if (part.type !== "symbol" || variableIdentity(part) === variableIdentity(output)) continue;
    const key = recipeInputKey(part);
    const dummy = boundIndices.some(range => range.identity === variableIdentity(part) && range.start <= index && index < range.end);
    const role = dummy || state.symbols.find(entry => entry.id === part.entryId)?.category === "index" ? "index" : "derived";
    if (!candidates.has(key) || role === "derived") candidates.set(key, { part, role });
  }
  return [...candidates.values()];
}

export function inspectVariableRecipe(state: ResearchNotebookState, reference: FormulaSourceReference): VariableRecipe {
  const result = resolveFormulaSource(state, reference);
  if (!result) return { kind: "related", inputs: [], peers: [], warning: "来源公式或结果不存在。" };
  return inspectFormulaRecipe(state, result);
}

/** Also accepts an unsaved result draft, so settings can reuse the same interpretation. */
export function inspectFormulaRecipe(state: ResearchNotebookState, result: FormulaResult): VariableRecipe {
  const { formula, output } = result;
  const peers = (formula.outputs ?? []).filter(item => item.id !== output.id);
  if (!formula.parts) return { result, kind: "related", inputs: [], peers, warning: "此公式尚未记录可识别的变量项，请先整理公式或在原文查看。" };
  const candidates = variableRecipeCandidates(state, formula, output);
  for (const part of [output, ...candidates.map(input => input.part)]) {
    const entry = state.symbols.find(entry => entry.id === part.entryId);
    if (!entry) return { result, kind: "related", inputs: [], peers, warning: "公式变量缺少词典定义，请先补充词条。" };
    if (resolveSymbolEntry(entry, part.bindings).missingSlots.length) return { result, kind: "related", inputs: [], peers, warning: "公式变量的角标不完整，请在原公式中补充。" };
  }
  const saved = output.recipe;
  if (saved && saved.signature === variableRecipeSignature(formula)) {
    const inputs = saved.inputs.filter(input => input.role !== "index" && input.role !== "excluded").map(input => ({
      part: { type: "symbol" as const, entryId: input.entryId, bindings: input.bindings, ...(input.source ? { source: input.source } : {}) }, role: input.role,
    }));
    const missing = inputs.some(input => !candidates.some(candidate => recipeInputKey(candidate.part) === recipeInputKey(input.part)));
    return { result, kind: saved.kind ?? infer().kind, inputs, peers, ...(missing ? { warning: "配方输入与当前公式不一致，请在公式设置中复核。" } : {}) };
  }
  const inferred = infer();
  return { result, ...inferred, peers, ...(saved ? { warning: "公式内容已变更，请在公式设置中复核配方输入。" } : {}) };

  function infer(): { kind: RecipeKind; inputs: RecipeInput[] } {
    const model = buildFormulaEditModel(formula.parts!, state.symbols, formula.layout);
    const target = variableIdentity(output);
    const cooutputs = new Set(peers.map(variableIdentity));
    let start = 0;
    for (let end = 0; end <= formula.parts!.length; end++) {
      if (end < formula.parts!.length && formula.parts![end].type !== "lineBreak") continue;
      const top = model.root.nodes.filter(node => node.start >= start && node.end <= end && formula.parts![node.start].type !== "alignmentPoint");
      const equal = top.findIndex(node => {
        const part = formula.parts![node.start];
        return node.kind === "atom" && part.type === "operator" && part.operator === "equals";
      });
      const first = top[0] && formula.parts![top[0].start];
      if (!model.errors.length && equal >= 0) {
        const right = top.slice(equal + 1);
        const tail = right.find(node => {
          const part = formula.parts![node.start];
          return part.type === "operator" && ["comma", "semicolon", "quad"].includes(part.operator);
        });
        const endOfExpression = tail?.start ?? end;
        const equation = top.filter(node => node.start < endOfExpression);
        const equalsCount = equation.filter(node => {
          const part = formula.parts![node.start];
          return node.kind === "atom" && part.type === "operator" && part.operator === "equals";
        }).length;
        const equationParts = formula.parts!.slice(start, endOfExpression);
        const rightParts = formula.parts!.slice(top[equal].end, endOfExpression);
        if (equalsCount === 1 && equationParts.some(part => part.type === "symbol" && variableIdentity(part) === target)) {
          const isolated = equal === 1 && top[0].kind === "atom" && first?.type === "symbol" && variableIdentity(first) === target;
          const implicit = !isolated || rightParts.some(part => part.type === "symbol" && variableIdentity(part) === target);
          const relevant = isolated ? rightParts : equationParts;
          const joint = relevant.some(part => part.type === "symbol" && cooutputs.has(variableIdentity(part)));
          return { kind: joint ? "joint" : implicit ? "implicit" : "explicit", inputs: candidates.filter(input => input.role !== "index" && !cooutputs.has(variableIdentity(input.part)) && relevant.some(part => part.type === "symbol" && recipeInputKey(part) === recipeInputKey(input.part))) };
        }
      }
      start = end + 1;
    }
    return { kind: peers.length ? "joint" : "related", inputs: candidates.filter(input => input.role !== "index" && !cooutputs.has(variableIdentity(input.part))) };
  }
}

export function variableRoleInFormula(state: ResearchNotebookState, owner: FormulaAddress, part: SymbolPart): RecipeInputRole {
  const found = findResearchFormula(state, owner);
  if (!found) return "derived";
  if (found.formula.outputs?.some(output => variableIdentity(output) === variableIdentity(part))) return "derived";
  const roles = new Set(found.formula.outputs?.flatMap(output => {
    const recipe = inspectFormulaRecipe(state, { ...found, output, reference: { ...owner, outputId: output.id } });
    if (recipe.warning) return [];
    const saved = output.recipe?.inputs.find(input => recipeInputKey(input) === recipeInputKey(part));
    if (saved) return [saved.role];
    const input = recipe.inputs.find(input => recipeInputKey(input.part) === recipeInputKey(part));
    if (input) return [input.role];
    return variableRecipeCandidates(state, found.formula, output).filter(input => input.role === "index" && recipeInputKey(input.part) === recipeInputKey(part)).map(input => input.role);
  }));
  if (roles.size === 1) return [...roles][0];
  return state.symbols.find(entry => entry.id === part.entryId)?.category === "index" ? "index" : "derived";
}

export interface RecipeSummaryItem { part: SymbolPart; owner: FormulaAddress; role: RecipeInputRole; reason: string }
export function summarizeVariableInputs(state: ResearchNotebookState, reference: FormulaSourceReference, options: {
  maxRecipes?: number;
  selections?: Record<string, FormulaSourceReference>;
} = {}) {
  const basic = new Map<string, RecipeSummaryItem>(), unresolved = new Map<string, RecipeSummaryItem>();
  const visited = new Set<string>(), path = new Set<string>();
  const errors: string[] = [];
  let truncated = false;
  const addUnknown = (part: SymbolPart, owner: FormulaAddress, reason: string) => unresolved.set(recipeOccurrenceKey(owner, part), { part, owner, role: "derived", reason });
  const visit = (reference: FormulaSourceReference, via?: RecipeSummaryItem) => {
    const key = formulaSourceKey(reference);
    if (path.has(key)) { if (via) addUnknown(via.part, via.owner, "发现循环来源，已停止回溯。"); return; }
    if (visited.has(key)) return;
    if (visited.size >= (options.maxRecipes ?? 160)) { truncated = true; if (via) addUnknown(via.part, via.owner, "已到本次回溯上限，可逐层继续查看。"); return; }
    const recipe = inspectVariableRecipe(state, reference);
    const target = recipe.result ? { type: "symbol" as const, ...recipe.result.output } : via?.part;
    if (recipe.warning || recipe.kind === "related") {
      if (target) addUnknown(target, reference, recipe.warning ?? "仅确定公式共同涉及的变量，输入关系待确认。");
      else errors.push(recipe.warning ?? "来源公式不存在。");
      return;
    }
    visited.add(key); path.add(key);
    for (const input of recipe.inputs) {
      const owner = { noteId: reference.noteId, formulaId: reference.formulaId };
      if (input.role !== "derived") {
        const item = { ...input, owner, reason: "" };
        basic.set(JSON.stringify([owner.noteId, variableIdentity(input.part), input.role]), item);
        continue;
      }
      const source = listVariableRecipes(state, owner, input.part);
      const selected = options.selections?.[recipeOccurrenceKey(owner, input.part)] ?? source.selected?.reference;
      if (selected) {
        const match = resolveFormulaSource(state, selected);
        if (match?.output.entryId !== input.part.entryId) addUnknown(input.part, owner, "所选配方失效，请重新选择。");
        else visit(selected, { ...input, owner, reason: "" });
      } else addUnknown(input.part, owner, source.error ?? (source.candidates.length ? "存在可选配方，尚未选择。" : "尚未关联来源或标明基础输入类型。"));
    }
    path.delete(key);
  };
  visit(reference);
  return { basic: [...basic.values()], unresolved: [...unresolved.values()], errors, recipes: visited.size, truncated, complete: !unresolved.size && !errors.length && !truncated };
}
