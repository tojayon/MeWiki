import { createDefaultSymbolEntries, formulaPartsToTex, type FormulaPart } from "./researchDictionary.ts";
import type { ResearchNote, ResearchNotebookState } from "./researchNotebook.ts";
import { researchNoteLinkUrl } from "./researchNoteLinks.ts";
import { defaultCalloutAppearance } from "./researchCallout.ts";

const emptyBindings = { x1: "", x2: "", x3: "" };
const symbol = (name: string): FormulaPart => ({ type: "symbol", entryId: `example-${name}`, bindings: { ...emptyBindings } });
export function createMeWikiExampleNotebook(): ResearchNotebookState {
  const parts: FormulaPart[] = [symbol("y"), { type: "operator", operator: "equals" }, symbol("a"), symbol("x"), { type: "operator", operator: "plus" }, symbol("b")];
  const now = new Date().toISOString();
  const symbols = createDefaultSymbolEntries();
  const tex = formulaPartsToTex(parts, symbols).tex;
  const notes: ResearchNote[] = [
    { id: "mewiki-example-foundation", title: "线性关系基础示例", library: "foundation", tags: ["示例/数学"], reviewStatus: "pending", createdAt: now, updatedAt: now,
      blocks: [
        { id: "example:given", type: "paragraph", section: "given", text: "设 $a$ 与 $b$ 为给定常数，$x$ 为输入。本例用于学习词典、公式与引用，不代表实际观测数据。" },
        { id: "example:linear", type: "formula", section: "conclusion", tex, parts, caption: "线性关系", outputs: [{ id: "linear-y", entryId: "example-y", bindings: { ...emptyBindings } }] },
        { id: "example:explain", type: "paragraph", text: "修改输入或系数会改变关系的含义。可在公式中点击符号查看解释，在右侧检查引用。" }
      ] },
    { id: "mewiki-example-content", title: "内容块与引用示例", library: "research", tags: ["示例/入门"], reviewStatus: "pending", createdAt: now, updatedAt: now, basisNoteIds: ["mewiki-example-foundation"],
      blocks: [
        { id: "example:intro", type: "paragraph", text: `参照[线性关系基础示例](${researchNoteLinkUrl("mewiki-example-foundation")})，点击行内变量 $x_i(t)$ 查看词典解释。` },
        { id: "example:use", type: "formula", tex: "y", caption: "使用来源公式的结果", parts: [{ ...symbol("y"), source: { noteId: "mewiki-example-foundation", formulaId: "example:linear", outputId: "linear-y" } } as FormulaPart] },
        { id: "example:data", type: "dataset", title: "演示数据", columns: ["输入", "输出"], rows: [["0", "1"], ["1", "3"], ["2", "5"]], chart: { kind: "line", x: 0, ys: [1] } },
        { id: "example:diagram", type: "diagram", mode: "mermaid", code: "flowchart LR\n  A[输入 x] --> B[线性关系]\n  B --> C[输出 y]", strokes: [] },
        { id: "example:tip", type: "callout", title: "开始整理自己的知识", text: "切换编辑模式修改这些示例。完成后可以删除示例，普通刷新不会重新生成。", appearance: { ...defaultCalloutAppearance } },
        { id: "example:tabs", type: "examples", title: "两种阅读视角", tabs: [
          { id: "example:tab1", title: "定义", blocks: [{ id: "example:definition", type: "paragraph", text: "先定义符号和条件，再填写公式。" }] },
          { id: "example:tab2", title: "检查", blocks: [{ id: "example:check", type: "paragraph", text: "通过反向链接和理论地图检查来源。" }] }
        ] }
      ] }
  ];
  return { version: 8, open: true, view: "notes", activeNoteId: "mewiki-example-content",
    activeSymbolId: symbols[0].id, symbols, notes, noteLibraryVersion: 1 };
}
