import { isFormulaOperator, type FormulaOperator } from "../domain/researchDictionary.ts";

export const FORMULA_OPERATOR_USAGE_STORAGE_KEY = "mewiki:formula-operator-usage";
const recentLimit = 100;
const frequentLimit = 12;
type UsageStorage = Pick<Storage, "getItem" | "setItem">;

export function loadFormulaOperatorUsage(storage?: Pick<Storage, "getItem">): FormulaOperator[] {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(FORMULA_OPERATOR_USAGE_STORAGE_KEY) ?? "null");
    if (saved?.version !== 1 || !Array.isArray(saved.recent)) return [];
    return saved.recent.filter((id: unknown): id is FormulaOperator => typeof id === "string" && isFormulaOperator(id)).slice(-recentLimit);
  } catch {
    return [];
  }
}

/** Call only after a key has successfully been written to the formula. */
export function recordFormulaOperatorUse(operator: FormulaOperator, storage?: UsageStorage): void {
  try {
    const target = storage ?? localStorage;
    // Read on each click so different open panels do not overwrite old snapshots.
    const recent = [...loadFormulaOperatorUsage(target), operator].slice(-recentLimit);
    target.setItem(FORMULA_OPERATOR_USAGE_STORAGE_KEY, JSON.stringify({ version: 1, recent }));
  } catch {
    // Preferences must never prevent formula input when storage is unavailable.
  }
}

export function frequentFormulaOperators(history: readonly FormulaOperator[]): FormulaOperator[] {
  const uses = new Map<FormulaOperator, { count: number; last: number }>();
  history.slice(-recentLimit).forEach((id, last) => uses.set(id, { count: (uses.get(id)?.count ?? 0) + 1, last }));
  return [...uses].filter(([, use]) => use.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count || b.last - a.last)
    .slice(0, frequentLimit).map(([id]) => id);
}
