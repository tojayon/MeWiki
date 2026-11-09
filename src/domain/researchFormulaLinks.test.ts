import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { normalizeResearchNotebook, removeResearchBlock, serializeResearchMarkdown, type ResearchNotebookState, type ResearchFormulaBlock } from "./researchNotebook.ts";
import { deleteSymbolEntry, type FormulaPart } from "./researchDictionary.ts";
import { formulaSourceError, formulaMetadataError, listFormulaConsumers, listFormulaOutputs, resolveFormulaSource, sourceIndexMapping } from "./researchFormulaLinks.ts";

const symbol = (entryId: string, loop = "p"): Extract<FormulaPart, { type: "symbol" }> => ({ type: "symbol", entryId, bindings: { x1: `(${loop})` } });
const source = { noteId: "model", formulaId: "gain", outputId: "gain-result" };
function fixture(): ResearchNotebookState {
  const base = createResearchNotebook();
  const gain: ResearchFormulaBlock = { id: "gain", type: "formula", tex: "", caption: "增益计算", conditions: "离散 LQR", parts: [symbol("example-matrix")], outputs: [{ id: "gain-result", entryId: "example-matrix", bindings: { x1: "(p)" } }] };
  const consumer: ResearchFormulaBlock = { id: "input", type: "formula", tex: "", caption: "控制输入", parts: [{ ...symbol("example-matrix", "q"), source }] };
  const note = { id: "model", title: "模型", createdAt: "today", updatedAt: "today", blocks: [gain] };
  return { ...base, activeNoteId: "derivation", notes: [note, { ...note, id: "derivation", title: "推导", blocks: [consumer] }] };
}
const formula = (state: ResearchNotebookState, note: number) => state.notes[note].blocks[0] as ResearchFormulaBlock;

describe("formula result and derivation links", () => {
  it("finds results by symbol identity across notes and maps index variants without a new entry", () => {
    const state = fixture();
    const part = formula(state, 1).parts![0] as Extract<FormulaPart, { type: "symbol" }>;
    const candidates = listFormulaOutputs(state, "example-matrix", { noteId: "derivation", formulaId: "input" });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reference).toEqual(source);
    expect(resolveFormulaSource(state, source)?.formula.caption).toBe("增益计算");
    expect(sourceIndexMapping(state.symbols.find((entry) => entry.id === part.entryId)!, candidates[0].output, part)).toEqual([
      { key: "x1", label: "右上角标 x1", from: "(p)", to: "(q)" },
    ]);
    expect(sourceIndexMapping(
      state.symbols.find((entry) => entry.id === part.entryId)!,
      candidates[0].output,
      { ...part, bindings: { ...part.bindings, x2: "j" } },
    )).toContainEqual({ key: "x2", label: "右下角标 x2", from: "\\varnothing", to: "j" });
    expect(formulaSourceError(state, { noteId: "derivation", formulaId: "input" }, part)).toBeNull();
  });

  it("retains results, conditions, source IDs and index mappings after persistence", () => {
    const state = fixture();
    const restored = normalizeResearchNotebook(JSON.parse(JSON.stringify(state)));
    expect(restored.notes).toEqual(state.notes.map((note) => ({ ...note, reviewStatus: "pending", tags: [] })));
    expect(formula(restored, 1).parts![0]).toMatchObject({ source, bindings: { x1: "(q)" } });
  });

  it("allows multiple alternative definitions and multiple outputs without guessing an equals side", () => {
    const state = fixture();
    const original = formula(state, 0);
    original.outputs!.push({ id: "implicit-p", entryId: "example-symmetric", bindings: { x1: "(p)" } });
    state.notes[0].blocks.push({ ...original, id: "other-gain", caption: "另一个假设下的增益" });
    expect(listFormulaOutputs(state, "example-matrix")).toHaveLength(2);
    expect(listFormulaOutputs(state, "example-symmetric")).toHaveLength(2);
    expect(listFormulaOutputs(state, "example-A")).toHaveLength(0);
  });

  it("explains dangling and semantically mismatched sources rather than choosing another definition", () => {
    const state = fixture();
    const owner = { noteId: "derivation", formulaId: "input" };
    expect(formulaSourceError(state, owner, { ...symbol("example-A"), source })).toMatch(/符号/);
    expect(formulaSourceError(state, owner, { ...symbol("example-matrix"), source: { ...source, outputId: "missing" } })).toMatch(/不存在|失效/);
    state.notes = state.notes.slice(1);
    const restored = normalizeResearchNotebook(state);
    expect(formula(restored, 0).parts![0]).toMatchObject({ source });
    expect(resolveFormulaSource(restored, source)).toBeUndefined();
  });

  it("prevents self and transitive derivation cycles while leaving acyclic alternatives available", () => {
    const state = fixture();
    const consumer = formula(state, 1);
    consumer.outputs = [{ id: "input-result", entryId: "example-matrix", bindings: { x1: "(q)" } }];
    const downstream = { noteId: "derivation", formulaId: "input", outputId: "input-result" };
    expect(formulaSourceError(state, { noteId: "model", formulaId: "gain" }, { ...symbol("example-matrix"), source: downstream })).toMatch(/循环|自身/);
    expect(formulaSourceError(state, { noteId: "model", formulaId: "gain" }, { ...symbol("example-matrix"), source })).toMatch(/循环|自身/);
    expect(listFormulaOutputs(state, "example-matrix", { noteId: "model", formulaId: "gain" })).toHaveLength(0);
  });

  it("protects referenced formulas and output identities and provides reverse uses", () => {
    const state = fixture();
    expect(listFormulaConsumers(state, { noteId: "model", formulaId: "gain" })).toMatchObject([{ noteId: "derivation", formulaId: "input", partIndex: 0 }]);
    expect(removeResearchBlock(state, "model", "gain")).toBe(state);
    expect(formulaMetadataError(state, { noteId: "model", formulaId: "gain" }, [])).toMatch(/引用/);
    expect(formulaMetadataError(state, { noteId: "model", formulaId: "gain" }, [{ id: "gain-result", entryId: "example-A", bindings: { x1: "(p)" } }])).toMatch(/引用/);
    expect(formulaMetadataError(state, { noteId: "model", formulaId: "gain" }, formula(state, 0).outputs!)).toBeNull();
    state.notes[1].blocks = [];
    expect(removeResearchBlock(state, "model", "gain").notes[0].blocks).toHaveLength(0);
  });

  it("validates results against the dictionary and protects symbols declared only as outputs", () => {
    const state = fixture();
    const gain = formula(state, 0);
    gain.parts = [];
    state.notes[1].blocks = [];
    expect(deleteSymbolEntry(state, "example-matrix")).toBe(state);
    expect(formulaMetadataError(state, { noteId: "model", formulaId: "gain" }, [{ id: "result", entryId: "missing", bindings: {} }])).toMatch(/词条/);
    expect(formulaMetadataError(state, { noteId: "model", formulaId: "gain" }, [{ id: "result", entryId: "example-matrix", bindings: {} }])).toBeNull();
  });

  it("exports readable results and provenance and identifies a missing result in Markdown", () => {
    const state = fixture();
    const markdown = serializeResearchMarkdown(state.notes[0], state.symbols, state.notes);
    expect(markdown).toContain("适用条件：离散 LQR");
    expect(markdown).toContain("结果符号：$\\boldsymbol{K}^{(p)}$");
    expect(serializeResearchMarkdown(state.notes[1], state.symbols, state.notes)).toContain("$\\boldsymbol{K}^{(q)}$ 的推导来源：模型 · 增益计算");
    formula(state, 0).outputs = [];
    expect(serializeResearchMarkdown(state.notes[1], state.symbols, state.notes)).toContain("推导来源：来源失效");
  });

  it("distinguishes multiple indexed results while rejecting duplicate declarations", () => {
    const state = fixture();
    const first = formula(state, 0).outputs![0];
    const owner = { noteId: "model", formulaId: "gain" };
    expect(formulaMetadataError(state, owner, [first, { ...first, id: "other" }])).toMatch(/重复/);
    expect(formulaMetadataError(state, owner, [first, { ...first, id: "other", bindings: { x1: "(q)" } }])).toBeNull();
    expect(formulaMetadataError(state, owner, [
      { id: "riccati-a", entryId: "example-symmetric", bindings: { x1: "(p)" } },
      { id: "riccati-b", entryId: "example-symmetric", bindings: { x1: "(p)", x2: "" } },
    ])).toMatch(/重复/);
  });
});
