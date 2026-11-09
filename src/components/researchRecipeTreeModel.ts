import type { FormulaSourceReference } from "../domain/researchDictionary.ts";
import type { FormulaAddress, SymbolPart } from "../domain/researchFormulaLinks.ts";
import { formulaSourceKey } from "../domain/researchFormulaLinks.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import type { RecipeInputRole } from "../domain/researchRecipeMetadata.ts";
import { inspectVariableRecipe, listVariableRecipes, recipeInputKey, recipeOccurrenceKey, type VariableRecipe } from "../domain/researchVariableRecipes.ts";

export interface RecipeStep { owner: FormulaAddress; part: SymbolPart; role: RecipeInputRole }
export type BrowsingSelections = Record<string, FormulaSourceReference>;

export function selectRecipe(state: ResearchNotebookState, step: RecipeStep, selections: BrowsingSelections) {
  const source = listVariableRecipes(state, step.owner, step.part);
  const key = selections[recipeOccurrenceKey(step.owner, step.part)];
  return { ...source, selected: key ? source.candidates.find(candidate => formulaSourceKey(candidate.reference) === formulaSourceKey(key)) : source.selected };
}

export interface RecipeTreeNode extends RecipeStep {
  id: string;
  parentId?: string;
  depth: number;
  children: string[];
  source: ReturnType<typeof selectRecipe>;
  recipe?: VariableRecipe;
  cycle: boolean;
  expandable: boolean;
  expanded: boolean;
  limited: boolean;
}
export interface RecipeTree { nodes: RecipeTreeNode[]; truncated: boolean }

/** Project only requested branches. A basic input is terminal even if another formula defines it. */
export function buildRecipeTree(state: ResearchNotebookState, root: RecipeStep, expanded: ReadonlySet<string>, selections: BrowsingSelections = {}, limits: { maxNodes?: number; maxDepth?: number } = {}): RecipeTree {
  const nodes: RecipeTreeNode[] = [];
  const maxNodes = Math.max(1, limits.maxNodes ?? 160), maxDepth = Math.max(1, limits.maxDepth ?? 64);
  let truncated = false;
  const visit = (step: RecipeStep, id: string, depth: number, ancestors: readonly string[], parentId?: string) => {
    const source = selectRecipe(state, step, selections);
    const recipe = step.role === "derived" && source.selected ? inspectVariableRecipe(state, source.selected.reference) : undefined;
    const key = recipe && source.selected ? formulaSourceKey(source.selected.reference) : undefined;
    const cycle = !!key && ancestors.includes(key);
    const limited = !!recipe?.inputs.length && depth + 1 >= maxDepth;
    const expandable = !!recipe?.inputs.length && !cycle && !limited;
    const node: RecipeTreeNode = { ...step, id, parentId, depth, children: [], source, recipe, cycle, expandable, expanded: expandable && expanded.has(id), limited };
    nodes.push(node);
    if (!node.expanded || !recipe || !source.selected) return;
    for (const input of recipe.inputs) {
      if (nodes.length >= maxNodes) { truncated = true; node.limited = true; break; }
      const childId = id + "/" + encodeURIComponent(JSON.stringify([key, recipeInputKey(input.part), input.role]));
      node.children.push(childId);
      visit({ ...input, owner: source.selected.reference }, childId, depth + 1, key ? [...ancestors, key] : ancestors, id);
    }
  };
  visit(root, "root", 0, []);
  return { nodes, truncated };
}

export function recipeTreePath(tree: RecipeTree, id: string): RecipeTreeNode[] {
  const nodes = new Map(tree.nodes.map(node => [node.id, node]));
  const path: RecipeTreeNode[] = [];
  let node = nodes.get(id);
  while (node) { path.unshift(node); node = node.parentId ? nodes.get(node.parentId) : undefined; }
  return path;
}

export interface RecipeNodeSize { width: number; height: number }
export interface PositionedRecipeNode extends RecipeTreeNode, RecipeNodeSize { x: number; y: number }

/** Place sibling subtrees in separate vertical bands, with every dependency to its parent's right. */
export function layoutRecipeTree(tree: RecipeTree, sizes: Readonly<Record<string, RecipeNodeSize>> = {}) {
  const nodeWidth = 44, nodeHeight = 44, columnGap = 24, rowGap = 8, padding = 12, header = 28;
  const nodes = new Map(tree.nodes.map(node => [node.id, node]));
  const size = (id: string) => ({ width: Math.max(nodeWidth, sizes[id]?.width ?? 0), height: Math.max(nodeHeight, sizes[id]?.height ?? 0) });
  const columns = Array.from({ length: Math.max(0, ...tree.nodes.map(node => node.depth)) + 1 }, (_, depth) => ({ depth, x: 0, width: Math.max(nodeWidth, ...tree.nodes.filter(node => node.depth === depth).map(node => size(node.id).width)) }));
  let right = padding;
  for (const column of columns) { column.x = right; right += column.width + columnGap; }
  const spans = new Map<string, number>(), positions = new Map<string, { x: number; y: number }>();
  const measure = (id: string): number => {
    const node = nodes.get(id)!;
    const height = size(id).height;
    const span = node.children.length ? Math.max(height, node.children.reduce((sum, child) => sum + measure(child), 0) + (node.children.length - 1) * rowGap) : height;
    spans.set(id, span); return span;
  };
  const place = (id: string, top: number) => {
    const node = nodes.get(id)!;
    positions.set(id, { x: columns[node.depth].x + (columns[node.depth].width - size(id).width) / 2, y: header + top + (spans.get(id)! - size(id).height) / 2 });
    for (const child of node.children) { place(child, top); top += spans.get(child)! + rowGap; }
  };
  if (tree.nodes.length) { measure(tree.nodes[0].id); place(tree.nodes[0].id, padding); }
  return {
    nodes: tree.nodes.map(node => ({ ...node, ...positions.get(node.id)!, ...size(node.id) })), nodeWidth, nodeHeight, columnGap, padding, columns,
    width: right - columnGap + padding,
    height: header + padding * 2 + (tree.nodes.length ? spans.get(tree.nodes[0].id)! : nodeHeight),
  };
}
