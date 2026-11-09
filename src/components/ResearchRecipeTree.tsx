import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, GitBranch, LocateFixed } from "lucide-react";
import { recipeInputRoles } from "../domain/researchRecipeMetadata.ts";
import type { SymbolPart } from "../domain/researchFormulaLinks.ts";
import { layoutRecipeTree, recipeTreePath, type RecipeNodeSize, type RecipeTree, type RecipeTreeNode } from "./researchRecipeTreeModel.ts";

const recipeMapHelp = "点击符号逐层展开并查看配方，可在图内横向或纵向滚动。\n蓝色表示当前路径，橙色表示基础输入，虚线表示关系待确认。";

function nodeStatus(node: RecipeTreeNode) {
  if (node.role !== "derived") return recipeInputRoles[node.role];
  if (node.cycle) return "循环来源 · 停止展开";
  if (node.limited) return "已达展开上限";
  if (node.source.error) return "来源失效";
  if (node.recipe?.warning) return "配方待补充或复核";
  if (node.recipe) return node.recipe.kind === "related" ? "共同涉及 · 待确认" : `${node.recipe.inputs.length} 项输入`;
  return node.source.candidates.length ? "待选择配方" : "来源待补充";
}

export default function ResearchRecipeTree({ tree, selectedId, name, renderVariable, onSelect, onCollapse }: {
  tree: RecipeTree; selectedId: string;
  name: (part: SymbolPart) => string;
  renderVariable: (part: SymbolPart) => ReactNode;
  onSelect: (id: string) => void;
  onCollapse: (id: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [sizes, setSizes] = useState<Record<string, RecipeNodeSize>>({});
  const layout = useMemo(() => layoutRecipeTree(tree, sizes), [tree, sizes]);
  useLayoutEffect(() => {
    const symbols = new Map<Element, string>();
    const observer = new ResizeObserver(entries => setSizes(previous => {
      let next = previous;
      for (const entry of entries) {
        const id = symbols.get(entry.target)!;
        const size = { width: Math.max(44, Math.ceil(entry.contentRect.width) + 8), height: Math.max(44, Math.ceil(entry.contentRect.height) + 8) };
        if (previous[id]?.width !== size.width || previous[id]?.height !== size.height) {
          if (next === previous) next = { ...previous };
          next[id] = size;
        }
      }
      return next;
    }));
    for (const [id, button] of buttons.current) {
      const symbol = button.querySelector(".recipe-variable-label");
      if (symbol) { symbols.set(symbol, id); observer.observe(symbol); }
    }
    return () => observer.disconnect();
  }, [tree]);
  const nodes = new Map(tree.nodes.map(node => [node.id, node]));
  const path = new Set(recipeTreePath(tree, selectedId).map(node => node.id));
  const selected = tree.nodes.find(node => node.id === selectedId) ?? tree.nodes[0];
  useLayoutEffect(() => {
    const node = layout.nodes.find(node => node.id === selectedId), element = viewport.current;
    if (!node || !element) return;
    buttons.current.get(node.id)?.focus({ preventScroll: true });
    const left = node.x < element.scrollLeft ? node.x - 12 : node.x + node.width + 12 > element.scrollLeft + element.clientWidth ? node.x + node.width + 12 - element.clientWidth : element.scrollLeft;
    element.scrollTo({ left: Math.max(0, left), top: Math.max(0, node.y - (element.clientHeight - node.height) / 2) });
  }, [layout, selectedId]);
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, node: RecipeTreeNode) => {
    const index = tree.nodes.findIndex(item => item.id === node.id);
    let next: string | undefined;
    switch (event.key) {
      case "ArrowRight": if (!node.expanded) { event.preventDefault(); event.stopPropagation(); onSelect(node.id); return; } next = node.children[0]; break;
      case "ArrowLeft": if (node.expanded) { event.preventDefault(); event.stopPropagation(); onCollapse(node.id); return; } next = node.parentId; break;
      case "ArrowUp": next = tree.nodes[index - 1]?.id; break;
      case "ArrowDown": next = tree.nodes[index + 1]?.id; break;
      case "Home": next = tree.nodes[0]?.id; break;
      case "End": next = tree.nodes.at(-1)?.id; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
    if (next) onSelect(next);
  };
  return <section className="recipe-tree" aria-label="变量关系图">
    <div className="recipe-tree-toolbar"><strong title={recipeMapHelp}><GitBranch size={14} />变量关系</strong><div role="group" aria-label="关系图操作">
      <button type="button" aria-label="收起当前分支" title="收起当前变量的输入 · ←" disabled={!selected?.expanded} onClick={() => selected && onCollapse(selected.id)}><ChevronLeft size={14} /></button>
      <button type="button" aria-label="回到目标变量" title="回到目标变量" onClick={() => onSelect("root")}><LocateFixed size={14} /></button>
    </div></div>
    <div className="recipe-tree-viewport" ref={viewport}>
      <div className="recipe-tree-canvas" role="tree" aria-label="变量配方依赖树" aria-description={recipeMapHelp} style={{ width: layout.width, height: layout.height }}>
        {layout.columns.map(column => <span key={column.depth} className="recipe-tree-column" aria-hidden="true" style={{ left: column.x, width: column.width }}>{column.depth === 0 ? "目标" : column.depth === 1 ? "依赖" : `第 ${column.depth} 层`}</span>)}
        <svg className="recipe-tree-edges" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.nodes.filter(node => node.parentId).map(node => {
            const parent = layout.nodes.find(parent => parent.id === node.parentId)!;
            const x = parent.x + parent.width, y = parent.y + parent.height / 2, endY = node.y + node.height / 2;
            return <path key={node.id} data-recipe-edge data-selected={path.has(node.id)} data-related={parent.recipe?.kind === "related" || !!parent.recipe?.warning} d={`M${x},${y} C${x + 14},${y} ${node.x - 14},${endY} ${node.x},${endY}`} />;
          })}
        </svg>
        {layout.nodes.map(node => <button key={node.id} ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }}
          type="button" role="treeitem" className="recipe-tree-node" data-basic={node.role !== "derived"} data-root={node.id === "root"} data-on-path={path.has(node.id)} data-warning={!!node.source.error || node.cycle || !!node.recipe?.warning}
          style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
          aria-label={`查看配方 ${name(node.part)}`} aria-level={node.depth + 1} aria-posinset={node.parentId ? nodes.get(node.parentId)!.children.indexOf(node.id) + 1 : 1} aria-setsize={node.parentId ? nodes.get(node.parentId)!.children.length : 1}
          aria-selected={node.id === selectedId} aria-expanded={node.expandable ? node.expanded : undefined} aria-description={nodeStatus(node)} tabIndex={node.id === selectedId ? 0 : -1}
          title={`${name(node.part)} · ${nodeStatus(node)}`} onClick={() => onSelect(node.id)} onKeyDown={event => keyDown(event, node)}>
          {renderVariable(node.part)}
        </button>)}
      </div>
    </div>
    {tree.truncated && <p className="recipe-notice" role="status">已达当前关系图的显示上限，可收起其他分支后继续展开。</p>}
  </section>;
}
