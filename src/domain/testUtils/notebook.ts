import { createMeWikiExampleNotebook } from "../meWikiExamples.ts";
import type { ResearchSymbolEntry } from "../researchDictionary.ts";
import { positionSlots, symbolPositionSuffix } from "../researchSymbolPositions.ts";
import type { ResearchNotebookState } from "../researchNotebook.ts";

/** Small, explicit mathematical fixtures; no production workspace or private research data. */
export function createSymbolFixture(): ResearchSymbolEntry[] {
  const values: [string, string, string, Record<string, string>?][] = [
    ["example-vector", "状态向量", "\\boldsymbol{x}", {x3:"(t)"}], ["example-input", "输入向量", "\\boldsymbol{u}", {x3:"(t)"}],
    ["example-matrix", "线性映射矩阵", "\\boldsymbol{K}"], ["example-symmetric", "对称矩阵", "\\boldsymbol{P}"],
    ["example-rate", "状态变化率", "\\dot{\\boldsymbol{x}}", {x3:"(t)"}], ["example-index", "序列索引", "p"],
    ["example-count", "元素总数", "P"], ["example-step", "迭代步骤", "h"], ["example-alpha", "参数", "\\alpha"],
    ["example-subscript", "复合索引", "g", {x2:"h"}], ["example-measure", "测量量", "r"],
    ["example-function", "函数值", "\\Delta", {x3:"(t)"}], ["example-timestamp", "记录时刻", "s"],
    ["example-exponential", "自然指数底", "e"], ["time", "时间变量", "", {x3:"t"}],
    ["example-generic", "通用索引", "", {x3:"i"}], ["example-label", "标签", "", {x3:"\\mathrm{TR}"}],
    ["example-delay", "时间间隔", "\\tau", {x1:"\\downarrow",x2:"g"}],
    ["example-B", "输入矩阵", "\\boldsymbol{B}"], ["example-A", "状态矩阵", "\\boldsymbol{A}"], ["example-I", "单位矩阵", "\\boldsymbol{I}"],
    ["example-empty", "空集", "\\emptyset"],
  ];
  return values.map(([id,name,base,defaults]) => ({id,name,meaning:name+"的通用测试定义。",category:"custom",tags:[/vector|input|matrix|rate/.test(id) ? "示例/向量" : "数学/基础"],notation:base+symbolPositionSuffix,slots:positionSlots(defaults)}));
}

export function createNotebookFixture(): ResearchNotebookState {
  const state = createMeWikiExampleNotebook();
  const stamp = "2025-01-01T00:00:00.000Z";
  return { ...state, activeNoteId: state.notes[0].id, symbols: [...state.symbols, ...createSymbolFixture()],
    notes: [...state.notes, ...[ ["fixture-definition","关系定义"], ["fixture-application","关系应用"],
      ["fixture-conditions","适用条件"], ["fixture-summary","结果摘要"], ["fixture-results","结果记录"] ].map(([id,title]) => ({
        id,title,createdAt:stamp,updatedAt:stamp,tags:[],reviewStatus:"pending" as const,
        blocks: id === "fixture-application" ? [{id:id+":formula",type:"formula" as const,tex:"\\boldsymbol{K}",parts:[{type:"symbol" as const,entryId:"example-matrix",bindings:{}}]}] : [{ id:id+":text",type:"paragraph" as const,text:"通用内容。" }]
      }))],
  };
}
