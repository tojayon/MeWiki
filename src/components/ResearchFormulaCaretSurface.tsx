import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { CornerDownLeft, AlignCenter, AlignLeft, TextCursorInput, CodeXml } from "lucide-react";
import { Formula } from "./Formula.tsx";
import { formulaOperators, formulaPartsToTex, type FormulaLayout, type FormulaPart } from "../domain/researchDictionary.ts";
import { buildFormulaEditModel, nearestFormulaCaret, type FormulaCaretRect, type FormulaEditModel, type FormulaEditNode, type FormulaEditRegion } from "../domain/formulaEditing.ts";
import { normalizeFormulaSelection, type FormulaRange } from "../domain/formulaTransfer.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import "./ResearchFormulaEditing.css";

export type FormulaSurfaceApi = { focus: () => void; anchor: (index?: number) => { left: number; top: number; bottom: number } };

function measureCarets(canvas: HTMLElement, model: FormulaEditModel): FormulaCaretRect[] {
  const origin = canvas.getBoundingClientRect();
  const candidates: FormulaCaretRect[] = [];
  const target = (index: number) => {
    const entry = model.targets.find((item) => item.index === index);
    return entry ? canvas.querySelector<HTMLElement>(entry.selector) : null;
  };
  const box = (element: Element | null | undefined) => {
    const rect = element?.getBoundingClientRect();
    return rect ? { left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, height: Math.max(12, rect.height) } : undefined;
  };
  type Box = NonNullable<ReturnType<typeof box>>;
  const push = (position: number, x: number, rect: Box, depth: number) => {
    candidates.push({ position, x, top: rect.top, height: rect.height, depth });
  };
  const nodeBox = (node: FormulaEditNode) => box(canvas.querySelector("." + node.className)) ?? box(target(node.start));
  const collectNode = (node: FormulaEditNode, depth: number) => {
    const rect = nodeBox(node);
    if (!rect) return;
    const baseRect = node.base ? nodeBox(node.base) ?? box(target(node.start)) ?? rect : rect;
    push(node.start, rect.left, baseRect, depth);
    push(node.end, rect.right, baseRect, depth);
    if (node.base) collectNode(node.base, depth);
    node.regions.forEach((region) => collectRegion(region, rect));
    node.scripts?.forEach((script) => {
      if (script.region) collectRegion(script.region, rect);
    });
  };
  const collectRegion = (region: FormulaEditRegion, fallback: Box) => {
    const rect = box(canvas.querySelector("." + region.className)) ?? fallback;
    if (region.kind === "root") {
      for (const cell of model.cells) collectSequence(cell.nodes, cell.start, cell.end, 0, box(canvas.querySelector("." + cell.className)) ?? rect);
      return;
    }
    collectSequence(region.nodes, region.start, region.end, region.depth, rect);
  };
  const collectSequence = (nodes: FormulaEditNode[], start: number, end: number, depth: number, rect: Box) => {
    if (!nodes.length) {
      push(start, (rect.left + rect.right) / 2, rect, depth);
      return;
    }
    nodes.forEach((node) => collectNode(node, depth));
    const first = nodeBox(nodes[0]) ?? rect;
    const last = nodeBox(nodes[nodes.length - 1]) ?? rect;
    push(start, first.left, first, depth);
    push(end, last.right, last, depth);
  };
  collectRegion(model.root, { left: 8, right: Math.max(20, origin.width - 8), top: 8, height: 26 });
  const byPosition = new Map<number, FormulaCaretRect[]>();
  for (const candidate of candidates) {
    const saved = byPosition.get(candidate.position) ?? [];
    if (!saved.length || candidate.depth === saved[0].depth) byPosition.set(candidate.position, [...saved, candidate]);
    else if (candidate.depth > saved[0].depth) byPosition.set(candidate.position, [candidate]);
  }
  return [...byPosition.values()].map((items) => ({
    ...items[0],
    x: items.reduce((sum, item) => sum + item.x, 0) / items.length,
    top: Math.min(...items.map((item) => item.top)),
    height: Math.max(...items.map((item) => item.top + item.height)) - Math.min(...items.map((item) => item.top)),
  })).sort((a, b) => a.position - b.position);
}

export function FormulaCaretSurface({
  parts, symbols, position, selection, layout, onPosition, onSelect, onInsert, onInsertStructure, onLayout, onEdit, onRemove, onRemoveSelection, onCopy, onCut, onPaste, onMove, onHistory, onTexInput, texInputId, texInputOpen, apiRef,
}: {
  parts: FormulaPart[];
  symbols: ResearchNotebookState["symbols"];
  position: number;
  selection: FormulaRange | null;
  layout: FormulaLayout;
  onPosition: (position: number, extend?: boolean) => void;
  onSelect: (range: FormulaRange | null) => void;
  onInsert: (query?: string) => void;
  onInsertStructure: (part: FormulaPart) => void;
  onLayout: (layout: FormulaLayout) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onRemoveSelection: () => void;
  onCopy: (clipboard: DataTransfer, range?: FormulaRange) => void;
  onCut: (clipboard: DataTransfer, range?: FormulaRange) => void;
  onPaste: (clipboard: DataTransfer) => void;
  onMove: (range: FormulaRange, target: number, snapshot: string) => void;
  onHistory: (direction: "undo" | "redo") => void;
  onTexInput: () => void;
  texInputId: string;
  texInputOpen: boolean;
  apiRef: RefObject<FormulaSurfaceApi | null>;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const measured = useRef<FormulaCaretRect[]>([]);
  const [caret, setCaret] = useState<FormulaCaretRect | null>(null);
  const [drag, setDrag] = useState<{ range: FormulaRange; target: FormulaCaretRect | null; kind: "move" | "select" } | null>(null);
  const gesture = useRef<{ pointerId: number; x: number; y: number; range: FormulaRange; snapshot: string; active: boolean; target: FormulaCaretRect | null; kind: "move" | "select" } | null>(null);
  const suppressClick = useRef(false);
  const copyRange = useRef<FormulaRange | null>(null);
  const snapshot = JSON.stringify(parts);
  const model = useMemo(() => buildFormulaEditModel(parts, symbols, layout), [parts, symbols, layout]);
  const canInsertAtRoot = !model.regions.some((region) => region.kind !== "root" && region.start <= position && position <= region.end);
  const hasAlignmentPoint = parts.some((part) => part.type === "alignmentPoint");
  const focus = () => surfaceRef.current?.focus({ preventScroll: true });
  useImperativeHandle(apiRef, () => ({
    focus,
    anchor: (index) => {
      const canvas = canvasRef.current!;
      const target = index !== undefined ? canvas.querySelector<HTMLElement>('[data-formula-index="' + index + '"]') : null;
      if (target) return target.getBoundingClientRect();
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left + (caret?.x ?? 8), top: rect.top + (caret?.top ?? 8), bottom: rect.top + (caret?.top ?? 8) + (caret?.height ?? 26) };
    },
  }));
  useEffect(focus, []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    for (const { index, selector } of model.targets) {
      const element = canvas.querySelector<HTMLElement>(selector);
      if (!element) continue;
      element.dataset.formulaIndex = String(index);
      const part = parts[index];
      const name = part.type === "symbol" ? symbols.find((entry) => entry.id === part.entryId)?.name : part.type === "operator" ? formulaOperators.find((entry) => entry.id === part.operator)?.label : part.type === "latex" ? `LaTeX：${part.tex}` : undefined;
      element.title = (name ?? "公式项") + " · 单击选择 · 拖选多项 · 拖动已选内容移动 · 双击编辑";
    }
    const measure = () => {
      measured.current = measureCarets(canvas, model);
      const next = measured.current.find((item) => item.position === position) ?? measured.current[measured.current.length - 1];
      setCaret((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next ?? null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    document.fonts.ready.then(() => { if (canvas.isConnected) measure(); });
    return () => observer.disconnect();
  }, [model, parts, symbols, position]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    canvas.querySelectorAll(".research-formula-selected, .research-formula-drag-source").forEach((element) => element.classList.remove("research-formula-selected", "research-formula-drag-source"));
    const range = drag?.range ?? selection;
    if (!range) return;
    const highlight = (node: FormulaEditNode) => {
      if (range.start <= node.start && node.end <= range.end) {
        canvas.querySelector("." + node.className)?.classList.add(drag?.kind === "move" ? "research-formula-drag-source" : "research-formula-selected");
        return;
      }
      if (node.base) highlight(node.base);
      node.regions.forEach((region) => region.nodes.forEach(highlight));
      node.scripts?.forEach((script) => script.region?.nodes.forEach(highlight));
    };
    model.root.nodes.forEach(highlight);
  }, [model, selection, drag]);
  useLayoutEffect(() => {
    if (selection || !caret || !surfaceRef.current || !canvasRef.current) return;
    const surface = surfaceRef.current;
    const viewport = surface.getBoundingClientRect();
    const x = canvasRef.current.getBoundingClientRect().left + caret.x;
    if (x < viewport.left + 8) surface.scrollLeft -= viewport.left + 8 - x;
    else if (x > viewport.right - 8) surface.scrollLeft += x - viewport.right + 8;
  }, [caret, selection]);

  const placeCaret = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); return; }
    if ((event.target as Element).closest(".research-formula-caret")) return;
    const target = (event.target as Element).closest<HTMLElement>("[data-formula-index]");
    if (target && !event.shiftKey && event.detail === 1) {
      const box = target.getBoundingClientRect();
      const offset = event.clientX - box.left;
      // Scripted symbols consist of several inline fragments. Keep only a
      // narrow edge for caret placement so the base glyph is selectable too.
      if (offset > 3 && offset < box.width - 3) {
        const index = Number(target.dataset.formulaIndex);
        onSelect(normalizeFormulaSelection(parts, symbols, index, index + 1, layout));
        focus();
        return;
      }
    }
    event.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const nearest = nearestFormulaCaret(measured.current, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (nearest) onPosition(nearest.position, event.shiftKey);
    focus();
  };
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      if (gesture.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
      else if (selection) { event.preventDefault(); event.stopPropagation(); onSelect(null); }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "a") { event.preventDefault(); event.stopPropagation(); onSelect({ start: 0, end: parts.length }); }
      else if (key === "z" || key === "y") { event.preventDefault(); event.stopPropagation(); cancelDrag(); onHistory(key === "y" || event.shiftKey ? "redo" : "undo"); }
      else if ((key === "c" || key === "x") && !selection && parts.length) {
        const index = Math.max(0, Math.min(parts.length - 1, position < parts.length ? position : position - 1));
        copyRange.current = normalizeFormulaSelection(parts, symbols, index, index + 1, layout);
      }
      return;
    }
    if (event.altKey) return;
    const positions = measured.current.map((item) => item.position);
    const current = positions.indexOf(position);
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = !event.shiftKey && selection && (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ? event.key === "ArrowLeft" ? selection.start : selection.end
        : event.key === "Home" ? positions[0] : event.key === "End" ? positions[positions.length - 1] : positions[Math.max(0, Math.min(positions.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)))];
      if (next !== undefined) onPosition(next, event.shiftKey);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (!caret) return;
      const candidates = measured.current.filter((item) => event.key === "ArrowUp" ? item.top + item.height / 2 < caret.top : item.top > caret.top + caret.height / 2);
      const next = nearestFormulaCaret(candidates, { x: caret.x, y: caret.top + (event.key === "ArrowUp" ? -8 : caret.height + 8) });
      if (next) onPosition(next.position, event.shiftKey);
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      onInsertStructure({ type: "lineBreak" });
    } else if (event.key === "Enter" || event.key === "Insert" || event.key === " ") {
      event.preventDefault();
      onInsert();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      if (selection) onRemoveSelection();
      else onRemove(event.key === "Backspace" ? position - 1 : position);
    } else if (event.key.length === 1) {
      event.preventDefault();
      onInsert(event.key);
    }
  };

  const cancelDrag = () => {
    const pending = gesture.current;
    gesture.current = null;
    if (pending?.active) suppressClick.current = true;
    if (pending && surfaceRef.current?.hasPointerCapture(pending.pointerId)) surfaceRef.current.releasePointerCapture(pending.pointerId);
    setDrag(null);
  };
  useEffect(() => { cancelDrag(); }, [snapshot]);
  useEffect(() => {
    const cancel = () => cancelDrag();
    const releaseOutside = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId && !(event.target instanceof Node && surfaceRef.current?.contains(event.target))) cancelDrag();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current?.active) { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
    };
    const visibility = () => { if (document.visibilityState === "hidden") cancelDrag(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("pointerup", releaseOutside);
    window.addEventListener("pointercancel", cancel);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("pointerup", releaseOutside); window.removeEventListener("pointercancel", cancel); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("keydown", escape, true); };
  }, []);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (event.button !== 0 || event.shiftKey || !event.isPrimary) return;
    const target = (event.target as Element).closest<HTMLElement>("[data-formula-index]");
    if (!target) return;
    const index = Number(target.dataset.formulaIndex);
    const isSelected = !!selection && selection.start <= index && index < selection.end;
    const range = isSelected ? selection : normalizeFormulaSelection(parts, symbols, index, index + 1, layout);
    if (range.start === range.end) return;
    event.preventDefault();
    focus();
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, range, snapshot, active: false, target: null, kind: isSelected ? "move" : "select" };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pending = gesture.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) { cancelDrag(); return; }
    if (!pending.active && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
    event.preventDefault();
    pending.active = true;
    suppressClick.current = true;
    if (!surfaceRef.current!.hasPointerCapture(event.pointerId)) surfaceRef.current!.setPointerCapture(event.pointerId);
    const surface = surfaceRef.current!;
    const viewport = surface.getBoundingClientRect();
    const inside = event.clientX >= viewport.left && event.clientX <= viewport.right && event.clientY >= viewport.top && event.clientY <= viewport.bottom;
    if (inside && (event.clientX < viewport.left + 24 || event.clientX > viewport.right - 24)) surface.scrollLeft += event.clientX < viewport.left + 24 ? -18 : 18;
    const rect = canvasRef.current!.getBoundingClientRect();
    const nearest = inside ? nearestFormulaCaret(measured.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }) ?? null : null;
    pending.target = nearest;
    const anchor = nearest && nearest.position <= pending.range.start ? pending.range.end : pending.range.start;
    const range = pending.kind === "select" && nearest ? normalizeFormulaSelection(parts, symbols, anchor, nearest.position, layout) : pending.range;
    setDrag({ range, target: nearest, kind: pending.kind });
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const pending = gesture.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (surfaceRef.current?.hasPointerCapture(event.pointerId)) surfaceRef.current.releasePointerCapture(event.pointerId);
    setDrag(null);
    if (pending.active) {
      event.preventDefault();
      suppressClick.current = true;
      if (pending.kind === "select") {
        const focusPosition = pending.target?.position;
        if (focusPosition !== undefined) {
          const anchor = focusPosition <= pending.range.start ? pending.range.end : pending.range.start;
          const selected = normalizeFormulaSelection(parts, symbols, anchor, focusPosition, layout);
          if (selected.start !== selected.end) onSelect(selected);
        }
        return;
      }
      if (pending.target) onMove(pending.range, pending.target.position, pending.snapshot);
    }
  };
  const clipboard = (event: ClipboardEvent<HTMLDivElement>, action: (data: DataTransfer, range?: FormulaRange) => void) => {
    event.preventDefault(); event.stopPropagation(); cancelDrag();
    const range = copyRange.current ?? undefined;
    copyRange.current = null;
    action(event.clipboardData, range);
  };
  return (
    <div className="research-formula-editor-surface">
      <div ref={surfaceRef} className={"research-formula-interactive-expression" + (drag ? drag.kind === "move" ? " is-dragging-formula" : " is-selecting-formula" : "")} role="textbox" aria-label="公式光标编辑器" aria-multiline="true" tabIndex={0}
        title="单击选择 · 边缘定位 · 拖动选择多项 · 拖动已选内容移动 · Ctrl/Cmd+C/V 复制粘贴 · 双击编辑"
        data-selection-start={selection?.start} data-selection-end={selection?.end}
        onClick={placeCaret} onKeyDown={handleKeys}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (gesture.current) cancelDrag(); }}
        onCopy={(event) => clipboard(event, onCopy)} onCut={(event) => clipboard(event, onCut)} onPaste={(event) => clipboard(event, onPaste)}
        onDragStart={(event) => event.preventDefault()}
        onDoubleClick={(event) => {
          const target = (event.target as Element).closest<HTMLElement>("[data-formula-index]");
          if (target) { event.preventDefault(); onEdit(Number(target.dataset.formulaIndex)); }
        }}>
        <div ref={canvasRef} className="research-formula-math-canvas">
          <Formula tex={formulaPartsToTex(parts, symbols, layout).tex} markedTex={model.tex} block interactive />
          {caret && !drag && <button className={"research-formula-caret" + (selection ? " has-selection" : "")} type="button" data-position={position} aria-label="在光标处插入公式项"
            style={{ left: caret.x, top: caret.top, height: caret.height }}
            onClick={(event) => { event.stopPropagation(); onInsert(); }} />}
          {drag?.kind === "move" && drag.target && <span className={"research-formula-drop-caret" + (drag.range.start <= drag.target.position && drag.target.position <= drag.range.end ? " is-unchanged" : "")} data-position={drag.target.position} aria-hidden="true"
            style={{ left: drag.target.x, top: drag.target.top, height: drag.target.height }} />}
        </div>
      </div>
      {selection && <span className="research-formula-selection-status" role="status">已选择 {selection.end - selection.start} 项 · Ctrl/Cmd+C 复制 · Ctrl/Cmd+X 剪切</span>}
      <div className="research-formula-layout-toolbar" role="toolbar" aria-label="多行公式工具">
        <div className="research-formula-layout-modes" role="group" aria-label="公式对齐方式">
          <button data-ui="icon-action" type="button" aria-label="居中多行" aria-pressed={layout === "centered"} disabled={hasAlignmentPoint} title={hasAlignmentPoint ? "居中多行 · 请先移除公式中的对齐点" : "居中多行"} onClick={() => onLayout("centered")}><AlignCenter size={15} /></button>
          <button data-ui="icon-action" type="button" aria-label="等号对齐" title="等号对齐" aria-pressed={layout === "aligned"} onClick={() => onLayout("aligned")}><AlignLeft size={15} /></button>
        </div>
        <button data-ui="icon-action" type="button" aria-label="插入换行" title="插入换行 · Shift+Enter" disabled={!canInsertAtRoot} onClick={() => onInsertStructure({ type: "lineBreak" })}><CornerDownLeft size={15} /></button>
        <button data-ui="icon-action" type="button" aria-label="插入对齐点" title="插入对齐点 · 将等号等关系符对齐" disabled={layout === "centered" || !canInsertAtRoot} onClick={() => onInsertStructure({ type: "alignmentPoint" })}><TextCursorInput size={15} /></button>
        <button data-ui="icon-action" type="button" aria-label="粘贴 LaTeX 公式" title="粘贴 LaTeX 公式 · 预览后插入" aria-expanded={texInputOpen} aria-controls={texInputOpen ? texInputId : undefined} onClick={onTexInput}><CodeXml size={15} /></button>
      </div>
    </div>
  );
}
