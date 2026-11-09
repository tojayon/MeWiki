import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { type ResearchFormulaBlock } from "../domain/researchNotebook.ts";
import { createSymbolEntry, type FormulaPart } from "../domain/researchDictionary.ts";
import { recipeOccurrenceKey, variableRecipeSignature } from "../domain/researchVariableRecipes.ts";
import { buildRecipeTree, layoutRecipeTree, recipeTreePath } from "./researchRecipeTreeModel.ts";

const symbol = (entryId: string, sourceId?: string): Extract<FormulaPart, { type: "symbol" }> => ({ type: "symbol", entryId, bindings: {}, ...(sourceId ? { source: { noteId: "n", formulaId: sourceId, outputId: sourceId } } : {}) });
const equals: FormulaPart = { type: "operator", operator: "equals" };
const plus: FormulaPart = { type: "operator", operator: "plus" };
const owner = (formulaId: string) => ({ noteId: "n", formulaId });
const formula = (id: string, inputs: FormulaPart[]): ResearchFormulaBlock => ({ id, type: "formula", tex: "", parts: [symbol(id), equals, ...inputs], outputs: [{ id, entryId: id, bindings: {} }] });
function fixture() {
  const state = createResearchNotebook();
  state.symbols = ["z", "x", "y", "a", "b"].map(name => createSymbolEntry({ name, notation: name, meaning: name, category: "custom", slots: [] }, name));
  const x = formula("x", [symbol("a"), plus, symbol("b")]);
  x.outputs![0].recipe = { signature: variableRecipeSignature(x), inputs: [{ ...symbol("a"), role: "parameter" }, { ...symbol("b"), role: "observation" }] };
  state.notes = [{ ...state.notes[0], id: "n", title: "配方", blocks: [formula("z", [symbol("x", "x"), plus, symbol("y", "y")]), x, formula("y", [symbol("a")])] }];
  return { state, root: { owner: owner("z"), part: symbol("z"), role: "derived" as const } };
}

describe("variable recipe tree", () => {
  it("shows one layer at a time and keeps sibling branches when a variable expands", () => {
    const { state, root } = fixture();
    const expanded = new Set(["root"]);
    const initial = buildRecipeTree(state, root, expanded);
    expect(initial.nodes.map(node => node.part.entryId)).toEqual(["z", "x", "y"]);
    const x = initial.nodes.find(node => node.part.entryId === "x")!;
    const y = initial.nodes.find(node => node.part.entryId === "y")!;
    expanded.add(x.id);
    const next = buildRecipeTree(state, root, expanded);
    expect(next.nodes.map(node => node.part.entryId)).toEqual(["z", "x", "a", "b", "y"]);
    expect(next.nodes.find(node => node.part.entryId === "y")?.id).toBe(y.id);
    expect(recipeTreePath(next, next.nodes.find(node => node.part.entryId === "b")!.id).map(node => node.part.entryId)).toEqual(["z", "x", "b"]);
    expanded.add(y.id);
    const both = buildRecipeTree(state, root, expanded);
    const a = both.nodes.filter(node => node.part.entryId === "a");
    expect(a).toHaveLength(2);
    expect(a[0].id).not.toBe(a[1].id);
    expect(a[0].role).toBe("parameter");
    expect(a[0].expandable).toBe(false);
    expanded.delete(x.id);
    expect(buildRecipeTree(state, root, expanded).nodes.map(node => node.part.entryId)).toEqual(["z", "x", "y", "a"]);
  });

  it("keeps unresolved sources unexpanded and stops cycles along each branch", () => {
    const { state, root } = fixture();
    const x = state.notes[0].blocks[1] as ResearchFormulaBlock;
    x.outputs![0].recipe = undefined;
    x.parts = [symbol("x"), equals, symbol("z", "z")];
    const initial = buildRecipeTree(state, root, new Set(["root"]));
    const expanded = new Set(initial.nodes.map(node => node.id));
    const cycle = buildRecipeTree(state, root, expanded);
    const repeated = cycle.nodes.find(node => node.parentId && node.part.entryId === "z")!;
    expect(repeated.cycle).toBe(true);
    expect(repeated.expandable).toBe(false);
    const z = state.notes[0].blocks[0] as ResearchFormulaBlock;
    z.parts![2] = symbol("x", "missing");
    const broken = buildRecipeTree(state, root, new Set(["root"])).nodes.find(node => node.part.entryId === "x")!;
    expect(broken.source.error).toContain("不存在");
    expect(broken.expandable).toBe(false);
    expect(broken.children).toEqual([]);
  });

  it("rebuilds descendants when a different source is selected without carrying over the old branch", () => {
    const { state, root } = fixture();
    state.notes[0].blocks.push({ ...formula("x", [symbol("y", "y")]), id: "alternate-x" });
    const initial = buildRecipeTree(state, root, new Set(["root"]));
    const x = initial.nodes.find(node => node.part.entryId === "x")!;
    const expanded = new Set(["root", x.id]);
    const original = buildRecipeTree(state, root, expanded);
    const originalChildren = original.nodes.find(node => node.id === x.id)!.children;
    originalChildren.forEach(id => expanded.add(id));
    const alternative = buildRecipeTree(state, root, expanded, {
      [recipeOccurrenceKey(x.owner, x.part)]: { noteId: "n", formulaId: "alternate-x", outputId: "x" },
    });
    const changedChildren = alternative.nodes.find(node => node.id === x.id)!.children;
    expect(changedChildren).toHaveLength(1);
    expect(originalChildren).not.toContain(changedChildren[0]);
    expect(alternative.nodes.find(node => node.id === changedChildren[0])).toMatchObject({ part: { entryId: "y" }, expanded: false });
    expect(originalChildren.every(id => !alternative.nodes.some(node => node.id === id))).toBe(true);
  });

  it("lays out parents before their children without overlapping siblings and limits visible work", () => {
    const { state, root } = fixture();
    const initial = buildRecipeTree(state, root, new Set(["root"]));
    const tree = buildRecipeTree(state, root, new Set(initial.nodes.map(node => node.id)));
    const layout = layoutRecipeTree(tree);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      if (node.parentId) expect(node.x).toBeGreaterThan(layout.nodes.find(parent => parent.id === node.parentId)!.x);
      for (const other of layout.nodes.filter(other => other.depth === node.depth && other.id !== node.id)) expect(Math.abs(node.y - other.y)).toBeGreaterThanOrEqual(layout.nodeHeight);
    }
    const limited = buildRecipeTree(state, root, new Set(initial.nodes.map(node => node.id)), {}, { maxNodes: 3 });
    expect(limited.nodes.length).toBeLessThanOrEqual(3);
    expect(limited.truncated).toBe(true);
  });

  it("packs bare symbols tightly while leaving room for longer notation", () => {
    const { state, root } = fixture();
    const initial = buildRecipeTree(state, root, new Set(["root"]));
    const x = initial.nodes.find(node => node.part.entryId === "x")!;
    const tree = buildRecipeTree(state, root, new Set(["root", x.id]));
    const compact = layoutRecipeTree(tree);
    expect(compact.nodeWidth).toBeLessThanOrEqual(44);
    expect(compact.nodeHeight).toBeLessThanOrEqual(44);
    const wide = layoutRecipeTree(tree, { [x.id]: { width: 180, height: 60 } });
    const middle = wide.nodes.find(node => node.id === x.id)!;
    expect(middle.width).toBe(180);
    expect(middle.height).toBe(60);
    for (const child of wide.nodes.filter(node => node.parentId === x.id)) expect(child.x).toBeGreaterThanOrEqual(middle.x + middle.width + wide.columnGap);
    expect(wide.width).toBeGreaterThan(compact.width);
    for (const node of wide.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(wide.width);
      expect(node.y + node.height).toBeLessThanOrEqual(wide.height);
    }
  });
});
