import { formulaSourceKey, researchFormulaTitle, type FormulaResult } from '../domain/researchFormulaLinks.ts';
import { researchNoteChoice } from './researchChoices.ts';

export function researchFormulaChoices(results: FormulaResult[]) {
  return results.map(result => {
    const duplicates = results.filter(other => other.note.id === result.note.id && other.formula.id === result.formula.id).length > 1;
    const bindings = Object.entries(result.output.bindings).map(([key, value]) => `${key}=${value}`).join('，');
    return researchNoteChoice(result.note, { id: formulaSourceKey(result.reference), label: `${result.note.title} · ${researchFormulaTitle(result.formula, result.note)}${duplicates ? `（${bindings || result.output.id}）` : ''}` });
  });
}
