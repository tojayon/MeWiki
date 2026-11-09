import type { FormulaSourceReference } from "./researchDictionary.ts";

export const recipeKinds = { explicit: "显式计算", implicit: "隐式求解", joint: "联合求解", related: "共同涉及" } as const;
export type RecipeKind = keyof typeof recipeKinds;
export const recipeInputRoles = {
  derived: "沿来源继续追溯", parameter: "给定参数", initial: "初始条件", observation: "观测数据",
  external: "外部计算结果", index: "仅作索引", excluded: "不作为输入",
} as const;
export type RecipeInputRole = keyof typeof recipeInputRoles;
export interface FormulaRecipeInput {
  entryId: string;
  bindings: Record<string, string>;
  source?: FormulaSourceReference;
  role: RecipeInputRole;
}
export interface FormulaRecipe {
  kind?: RecipeKind;
  inputs: FormulaRecipeInput[];
  signature: string;
}

export function normalizeFormulaRecipe(value: unknown): FormulaRecipe | undefined {
  if (!value || typeof value !== "object") return undefined;
  const recipe = value as Record<string, unknown>;
  if (!Array.isArray(recipe.inputs) || typeof recipe.signature !== "string"
    || (recipe.kind !== undefined && (typeof recipe.kind !== "string" || !Object.hasOwn(recipeKinds, recipe.kind)))) return undefined;
  const inputs: FormulaRecipeInput[] = [];
  for (const value of recipe.inputs) {
    if (!value || typeof value !== "object") return undefined;
    const input = value as Record<string, unknown>;
    if (typeof input.entryId !== "string" || !input.entryId || !input.bindings || typeof input.bindings !== "object" || Array.isArray(input.bindings)
      || Object.values(input.bindings).some(value => typeof value !== "string")
      || typeof input.role !== "string" || !Object.hasOwn(recipeInputRoles, input.role)) return undefined;
    const source = input.source as Record<string, unknown> | undefined;
    if (input.source !== undefined && (!source || typeof source !== "object" || typeof source.noteId !== "string" || !source.noteId
      || typeof source.formulaId !== "string" || !source.formulaId || typeof source.outputId !== "string" || !source.outputId)) return undefined;
    inputs.push({ entryId: input.entryId, bindings: { ...input.bindings as Record<string, string> },
      role: input.role as RecipeInputRole,
      ...(source ? { source: { noteId: source.noteId as string, formulaId: source.formulaId as string, outputId: source.outputId as string } } : {}) });
  }
  return { inputs, signature: recipe.signature, ...(typeof recipe.kind === "string" && Object.hasOwn(recipeKinds, recipe.kind) ? { kind: recipe.kind as RecipeKind } : {}) };
}
