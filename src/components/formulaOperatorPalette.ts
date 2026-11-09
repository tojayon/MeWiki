import { formulaOperators, type FormulaOperator } from "../domain/researchDictionary.ts";
import { additionalFormulaOperatorGroups, formulaGroupedOperators } from "../domain/formulaOperatorExtensions.ts";

const groups: { label: string; shortLabel?: string; ids: FormulaOperator[] }[] = [
  { label: "运算", ids: ["plus", "minus", "times", "divide", "dot", "juxtapose"] },
  { label: "关系", ids: ["equals", "lessThan", "lessEqual", "greaterThan", "greaterEqual", "notEqual"] },
  { label: "结构", ids: ["fractionStart", "superscriptStart", "subscriptStart", "leftParen", "leftBracket", "leftBrace"] },
  { label: "集合", ids: ["in", "subsetEqual", "intersection", "cardinalityOpen", "suchThat"] },
  { label: "逻辑", ids: ["and"] },
  { label: "函数", ids: ["minimum", "maximum", "infimum", "expectationOpen", "conditionalBar", "normOpen", "traceOpen"] },
  { label: "微积", ids: ["sum", "integral", "differential"] },
  { label: "箭头", ids: ["to", "implies", "iff"] }, { label: "希腊", ids: [] }, { label: "常数", ids: ["zero", "one", "two"] },
  { label: "修饰", ids: ["derivativeDot"] }, { label: "矩阵", ids: ["transpose", "inverse"] },
  { label: "标点与间距", shortLabel: "标点", ids: ["comma", "semicolon", "colon", "quad", "rangeDots"] },
];

// Structural markers need a complete example to render as a keyboard key.
const examples: Partial<Record<FormulaOperator, string>> = {
  ...Object.fromEntries(Object.entries(formulaGroupedOperators).map(([id, prefix]) => [id, `${prefix}x}`])),
  floorOpen: "\\lfloor x\\rfloor", ceilOpen: "\\lceil x\\rceil", angleOpen: "\\langle x\\rangle",
  fractionStart: "\\frac{a}{b}", superscriptStart: "x^a", subscriptStart: "x_a",
  leftParen: "(a)", leftBracket: "[a]", leftBrace: "\\{a\\}",
  derivativeDot: "\\dot{x}", transpose: "x^{\\mathsf T}", inverse: "x^{-1}",
  expectationOpen: "\\mathbb{E}[x]", conditionalBar: "a\\mid b",
  normOpen: "\\lVert x\\rVert", traceOpen: "\\operatorname{tr}(A)", cardinalityOpen: "|A|",
  juxtapose: "ab", quad: "a\\;b", and: "\\land",
  thinSpace: "a\\,b", mediumSpace: "a\\:b", thickSpace: "a\\;b", doubleSpace: "a\\qquad b", negativeSpace: "a\\!b",
};

export const formulaOperatorPalette = groups.map(group => ({
  label: group.label,
  shortLabel: group.shortLabel ?? group.label,
  keys: [...group.ids, ...additionalFormulaOperatorGroups.filter(extra => extra.label === (group.shortLabel ?? group.label)).flatMap(extra => extra.keys.map(key => key[0]))].map(id => {
    const operator = formulaOperators.find(item => item.id === id)!;
    return { ...operator, preview: examples[id] ?? operator.tex };
  }),
}));
