import { describe, expect, it } from "vitest";
import { formulaOperatorPalette } from "../components/formulaOperatorPalette.ts";
import {
  FORMULA_OPERATOR_USAGE_STORAGE_KEY, frequentFormulaOperators, loadFormulaOperatorUsage, recordFormulaOperatorUse,
} from "./formulaOperatorUsage.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("recent formula operator preferences", () => {
  it("only promotes repeated entries, ranking frequency first and most recent use second", () => {
    expect(frequentFormulaOperators([])).toEqual([]);
    expect(frequentFormulaOperators(["plus", "minus", "times"])).toEqual([]);
    expect(frequentFormulaOperators(["plus", "minus", "plus", "minus", "times", "times", "plus", "zero"]))
      .toEqual(["plus", "times", "minus"]);
  });

  it("ages out older inputs and bounds the quick list to twelve entries", () => {
    expect(frequentFormulaOperators(["plus", "plus", ...Array(99).fill("minus"), "plus"]))
      .toEqual(["minus"]);
    const ids = formulaOperatorPalette.flatMap(group => group.keys.map(key => key.id)).slice(0, 15);
    expect(frequentFormulaOperators([...ids, ...ids])).toEqual(ids.slice(-12).reverse());
  });

  it("retains rapid clicks and reads the newest history when another panel records a key", () => {
    const storage = memoryStorage();
    for (const id of ["plus", "plus", "minus", "plus"] as const) recordFormulaOperatorUse(id, storage);
    expect(loadFormulaOperatorUsage(storage)).toEqual(["plus", "plus", "minus", "plus"]);
    expect(frequentFormulaOperators(loadFormulaOperatorUsage(storage))).toEqual(["plus"]);
    for (let index = 0; index < 100; index++) recordFormulaOperatorUse("minus", storage);
    expect(loadFormulaOperatorUsage(storage)).toEqual(Array(100).fill("minus"));
  });

  it("ignores unknown IDs, malformed or newer-version data, and unavailable storage", () => {
    const storage = memoryStorage();
    storage.setItem(FORMULA_OPERATOR_USAGE_STORAGE_KEY, JSON.stringify({ version: 1, recent: ["plus", null, "deleted-operator", 3, {}, "plus"] }));
    expect(loadFormulaOperatorUsage(storage)).toEqual(["plus", "plus"]);
    for (const raw of ["{", "null", "[]", JSON.stringify({ version: 2, recent: ["plus", "plus"] }), JSON.stringify({ version: 1, recent: {} })]) {
      storage.setItem(FORMULA_OPERATOR_USAGE_STORAGE_KEY, raw);
      expect(loadFormulaOperatorUsage(storage)).toEqual([]);
    }
    const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadFormulaOperatorUsage(unavailable)).toEqual([]);
    expect(() => recordFormulaOperatorUse("plus", unavailable)).not.toThrow();
    expect(() => recordFormulaOperatorUse("plus")).not.toThrow();
  });
});
