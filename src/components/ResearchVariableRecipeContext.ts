import { createContext } from "react";
import type { FormulaAddress, SymbolPart } from "../domain/researchFormulaLinks.ts";

export interface VariableRecipeRequest {
  owner: FormulaAddress;
  part: SymbolPart;
  target: HTMLElement;
}

export const ResearchVariableRecipeContext = createContext<((request: VariableRecipeRequest) => void) | null>(null);
