import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { normalizeResearchNotebook, type ResearchFormulaBlock } from "./researchNotebook.ts";
import { createSymbolEntry, type FormulaOutput, type FormulaPart } from "./researchDictionary.ts";
import { inspectVariableRecipe, listVariableRecipes, recipeOccurrenceKey, summarizeVariableInputs, variableRecipeSignature, variableRoleInFormula } from "./researchVariableRecipes.ts";
import { createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";

const bindings = { x1: "", x2: "", x3: "" };
const symbol = (entryId: string, x2 = ""): Extract<FormulaPart, { type: "symbol" }> => ({ type: "symbol", entryId, bindings: { ...bindings, x2 } });
const op = (operator: Extract<FormulaPart, { type: "operator" }>["operator"]): FormulaPart => ({ type: "operator", operator });
const output = (entryId: string, x2 = ""): FormulaOutput => ({ id: entryId + x2, entryId, bindings: { ...bindings, x2 } });
const formula = (id: string, parts: FormulaPart[], outputs = [output(id)]): ResearchFormulaBlock => ({ id, type: "formula", tex: "", parts, outputs, caption: id + "计算" });
function fixture() {
  const state = createResearchNotebook();
  state.symbols = ["z", "x", "y", "a", "b", "p", "j"].map(name => createSymbolEntry({ name, notation: name, meaning: name + "含义", category: name === "j" ? "index" : "custom", slots: [] }, name));
  state.notes = [{ ...state.notes[0], id: "n", title: "配方笔记", blocks: [] }];
  return state;
}
const address = (formulaId: string) => ({ noteId: "n", formulaId });
const ref = (formulaId: string, outputId = formulaId) => ({ ...address(formulaId), outputId });

describe("variable recipe projection", () => {
  it("extracts only the result row, skips condition tails and keeps distinct indexed inputs", () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), symbol("x", "j"), op("plus"), symbol("x", "j+1"), op("comma"), symbol("j"), op("in"), symbol("a"), { type: "lineBreak" }, symbol("b"), op("equals"), symbol("y")]);
    state.notes[0].blocks = [block];
    const recipe = inspectVariableRecipe(state, ref("z"));
    expect(recipe.kind).toBe("explicit");
    expect(recipe.inputs.map(input => [input.part.entryId, input.part.bindings.x2])).toEqual([["x", "j"], ["x", "j+1"]]);
    expect(listVariableRecipes(state, address("z"), symbol("z")).selected?.reference).toEqual(ref("z"));
  });

  it("marks implicit and joint relations without creating self dependencies", () => {
    const state = fixture();
    state.notes[0].blocks = [formula("p", [symbol("p"), op("equals"), symbol("a"), symbol("p"), op("plus"), symbol("b")]), formula("joint", [symbol("x"), op("plus"), symbol("y"), op("equals"), symbol("z")], [output("x"), output("y")])];
    expect(inspectVariableRecipe(state, ref("p"))).toMatchObject({ kind: "implicit", inputs: [{ part: { entryId: "a" } }, { part: { entryId: "b" } }] });
    expect(inspectVariableRecipe(state, ref("joint", "x"))).toMatchObject({ kind: "joint", inputs: [{ part: { entryId: "z" } }] });
  });

  it("preserves explicit sources, reports broken sources and leaves alternative recipes unselected", () => {
    const state = fixture();
    state.notes[0].blocks = [formula("x", [symbol("x"), op("equals"), symbol("a")]), formula("other", [symbol("x"), op("equals"), symbol("b")], [output("x")])];
    expect(listVariableRecipes(state, address("consumer"), symbol("x")).selected).toBeUndefined();
    expect(listVariableRecipes(state, address("consumer"), symbol("x")).candidates).toHaveLength(2);
    expect(listVariableRecipes(state, address("consumer"), { ...symbol("x"), source: ref("x") }).selected?.reference).toEqual(ref("x"));
    const broken = listVariableRecipes(state, address("consumer"), { ...symbol("x"), source: ref("missing") });
    expect(broken.error).toContain("不存在");
    expect(broken.selected).toBeUndefined();
  });

  it("summarizes shared classified inputs once and keeps missing sources separate", () => {
    const state = fixture();
    const a = symbol("a"), b = symbol("b");
    const x = formula("x", [symbol("x"), op("equals"), a, op("plus"), b]);
    x.outputs![0].recipe = { inputs: [{ ...a, role: "parameter" }, { ...b, role: "observation" }], signature: variableRecipeSignature(x) };
    const y = formula("y", [symbol("y"), op("equals"), a]);
    y.outputs![0].recipe = { inputs: [{ ...a, role: "parameter" }], signature: variableRecipeSignature(y) };
    const z = formula("z", [symbol("z"), op("equals"), { ...symbol("x"), source: ref("x") }, op("plus"), { ...symbol("y"), source: ref("y") }, op("plus"), symbol("p")]);
    state.notes[0].blocks = [x, y, z];
    const summary = summarizeVariableInputs(state, ref("z"));
    expect(summary.basic.map(item => [item.part.entryId, item.role])).toEqual([["a", "parameter"], ["b", "observation"]]);
    expect(summary.unresolved.map(item => item.part.entryId)).toEqual(["p"]);
    expect(summary.complete).toBe(false);
    expect(summary.recipes).toBe(3);
  });

  it("does not count indices as ingredients and flags confirmed inputs after formula changes", () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), symbol("x"), op("plus"), symbol("j")]);
    state.notes[0].blocks = [block];
    expect(inspectVariableRecipe(state, ref("z")).inputs.map(item => item.part.entryId)).toEqual(["x"]);
    block.outputs![0].recipe = { inputs: [{ ...symbol("x"), role: "parameter" }], signature: variableRecipeSignature(block) };
    block.parts!.push(op("plus"), symbol("y"));
    expect(inspectVariableRecipe(state, ref("z")).warning).toContain("复核");
    expect(summarizeVariableInputs(state, ref("z")).complete).toBe(false);
  });

  it("terminates imported cycles and limits large traversals without claiming a complete summary", () => {
    const state = fixture();
    state.notes[0].blocks = [formula("x", [symbol("x"), op("equals"), { ...symbol("y"), source: ref("y") }]), formula("y", [symbol("y"), op("equals"), { ...symbol("x"), source: ref("x") }])];
    const cycle = summarizeVariableInputs(state, ref("x"));
    expect(cycle.unresolved.some(item => item.reason.includes("循环"))).toBe(true);
    expect(cycle.complete).toBe(false);
    const limited = summarizeVariableInputs(state, ref("x"), { maxRecipes: 1 });
    expect(limited.truncated).toBe(true);
  });

  it("preserves optional per-result input roles across notebook normalization", () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), symbol("a")]);
    const recipe = { kind: "implicit" as const, inputs: [{ entryId: "a", bindings: { ...bindings }, role: "initial" as const }], signature: variableRecipeSignature(block) };
    block.outputs![0].recipe = recipe;
    state.notes[0].blocks = [block];
    const restored = normalizeResearchNotebook(JSON.parse(JSON.stringify(state)));
    const found = restored.notes.find(note => note.id === "n")!.blocks.find(item => item.id === "z") as ResearchFormulaBlock;
    expect(found.outputs![0].recipe).toEqual(recipe);
  });

  it("reports a missing root and honors browsing selections consistently", () => {
    const state = fixture();
    expect(summarizeVariableInputs(state, ref("missing")).complete).toBe(false);
    const first = formula("x", [symbol("x"), op("equals"), symbol("a")]);
    first.outputs![0].recipe = { inputs: [{ ...symbol("a"), role: "parameter" }], signature: variableRecipeSignature(first) };
    const other = formula("other", [symbol("x"), op("equals"), symbol("b")], [output("x")]);
    other.outputs![0].recipe = { inputs: [{ ...symbol("b"), role: "observation" }], signature: variableRecipeSignature(other) };
    const input = { ...symbol("x"), source: ref("x") };
    state.notes[0].blocks = [first, other, formula("z", [symbol("z"), op("equals"), input])];
    const selections = { [recipeOccurrenceKey(address("z"), input)]: ref("other", "x") };
    const summary = summarizeVariableInputs(state, ref("z"), { selections });
    expect(summary.basic.map(item => item.part.entryId)).toEqual(["b"]);
  });

  it("does not turn another jointly solved result or a sum's dummy index into an ingredient", () => {
    const state = fixture();
    const joint = formula("joint", [symbol("x"), op("equals"), symbol("a"), symbol("y")], [output("x"), output("y")]);
    const sum = formula("z", [symbol("z"), op("equals"), op("sum"), op("subscriptStart"), symbol("p"), op("equals"), op("one"), op("groupClose"), op("superscriptStart"), symbol("b"), op("groupClose"), symbol("a", "p")]);
    state.notes[0].blocks = [joint, sum];
    expect(inspectVariableRecipe(state, ref("joint", "x"))).toMatchObject({ kind: "joint", inputs: [{ part: { entryId: "a" } }] });
    expect(inspectVariableRecipe(state, ref("z")).inputs.map(input => input.part.entryId)).toEqual(["b", "a"]);
  });

  it("ignores a malformed role annotation as a whole instead of silently dropping inputs", () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), symbol("a")]);
    block.outputs![0].recipe = { inputs: [{ entryId: "a", bindings: { ...bindings }, role: "unknown" }], signature: variableRecipeSignature(block) } as never;
    state.notes[0].blocks = [block];
    const restored = normalizeResearchNotebook(JSON.parse(JSON.stringify(state)));
    expect(summarizeVariableInputs(restored, ref("z")).complete).toBe(false);
  });

  it("preserves input roles and sources in complete library backup files", async () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), { ...symbol("a"), source: ref("a") }]);
    block.outputs![0].recipe = { kind: "explicit", inputs: [{ entryId: "a", bindings: { ...bindings }, source: ref("a"), role: "external" }], signature: variableRecipeSignature(block) };
    state.notes[0].blocks = [block];
    const file = await createResearchLibraryFile(state);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect((restored.notebook.notes[0].blocks[0] as ResearchFormulaBlock).outputs).toEqual(block.outputs);
    const invalid = structuredClone(state);
    (invalid.notes[0].blocks[0] as ResearchFormulaBlock).outputs![0].recipe!.inputs[0].role = "invalid" as never;
    await expect(createResearchLibraryFile(invalid)).rejects.toThrow("格式");
  });

  it("keeps a variable used outside a sum and recognizes excluded or dummy items when clicked", () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), op("sum"), op("subscriptStart"), symbol("p"), op("equals"), op("one"), op("groupClose"), symbol("a", "p"), op("plus"), symbol("p")]);
    state.notes[0].blocks = [block];
    expect(inspectVariableRecipe(state, ref("z")).inputs.map(input => input.part.entryId)).toEqual(["p", "a"]);
    block.outputs![0].recipe = { signature: variableRecipeSignature(block), inputs: [{ ...symbol("a", "p"), role: "excluded" }, { ...symbol("p"), role: "index" }] };
    expect(variableRoleInFormula(state, address("z"), symbol("a", "p"))).toBe("excluded");
    expect(variableRoleInFormula(state, address("z"), symbol("p"))).toBe("index");
  });

  it("flags missing dictionary definitions instead of reporting a complete input list", () => {
    const state = fixture();
    const block = formula("z", [symbol("z"), op("equals"), symbol("a")]);
    block.outputs![0].recipe = { signature: variableRecipeSignature(block), inputs: [{ ...symbol("a"), role: "parameter" }] };
    state.notes[0].blocks = [block];
    state.symbols = state.symbols.filter(entry => entry.id !== "a");
    expect(inspectVariableRecipe(state, ref("z")).warning).toContain("词典");
    expect(summarizeVariableInputs(state, ref("z")).complete).toBe(false);
  });

  it("recognizes an implicit equation and leaves chained equalities for confirmation", () => {
    const state = fixture();
    const implicit = formula("z", [symbol("z"), op("plus"), symbol("x"), op("equals"), op("zero")]);
    const chain = formula("chain", [symbol("y"), op("equals"), symbol("a"), op("equals"), symbol("b")], [output("y")]);
    state.notes[0].blocks = [implicit, chain];
    expect(inspectVariableRecipe(state, ref("z"))).toMatchObject({ kind: "implicit", inputs: [{ part: { entryId: "x" } }] });
    expect(inspectVariableRecipe(state, ref("chain", "y")).kind).toBe("related");
    expect(summarizeVariableInputs(state, ref("chain", "y")).complete).toBe(false);
  });
});
