import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlignCenter, AlignLeft, AlignRight, Code2, Columns3, Plus, Redo2, Rows3, TableProperties, Trash2, Undo2, X } from "lucide-react";
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, parseResearchTable, parseTableClipboard, pasteTableCells, serializeResearchTable, setTableAlignment, setTableCell, type ResearchTable } from "../domain/researchTable.ts";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import "./ResearchTableBlock.css";
import type { ResearchOutlineHeading } from "../domain/researchOutline.ts";
import ResearchMentionTextarea from "./ResearchMentionTextarea.tsx";

type Position = { row: number; column: number };
type CellEditor = Position & { id: number; cell: HTMLTableCellElement; host: HTMLDivElement; style: CSSProperties; initial: string };
type History = { past: string[]; future: string[] };

function editorStyle(cell: HTMLTableCellElement, host: HTMLDivElement): CSSProperties {
  const rect = cell.getBoundingClientRect(), bounds = host.getBoundingClientRect(), style = getComputedStyle(cell);
  return {
    left: rect.left - bounds.left + host.scrollLeft - host.clientLeft,
    top: rect.top - bounds.top + host.scrollTop - host.clientTop,
    width: rect.width, height: rect.height, padding: style.padding, color: style.color,
    font: style.font, letterSpacing: style.letterSpacing, textAlign: style.textAlign as CSSProperties["textAlign"],
  };
}

function TableTools({ trigger, selected, model, history, onAction, onHistory, onSource, onClose }: {
  trigger: HTMLButtonElement;
  selected: Position;
  model: ResearchTable | null;
  history: History;
  onAction: (operation: (table: ResearchTable) => ResearchTable, target?: Position) => void;
  onHistory: (redo: boolean) => void;
  onSource: () => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const confirmDelete = useDeleteConfirmation();
  const triggerRef = useRef<HTMLElement>(trigger);
  useFormulaPopover({ ref, triggerRef, getAnchor: () => trigger.getBoundingClientRect(), onCancel: onClose });
  const { row, column } = selected;
  const item = (label: string, icon: ReactNode, action: () => void, disabled = false) =>
    <button type="button" aria-label={label} disabled={disabled} onClick={action}>{icon}<span>{label}</span></button>;
  return <div ref={ref} popover="manual" role="dialog" aria-label={t("表格操作")} className="research-table-tools">
    <header><strong>{t("表格操作")}<span>{t("第")} {row + 1}  {t("行 · 第")} {column + 1}  {t("列")}</span></strong><button type="button" data-ui="icon-action" aria-label={t("关闭表格操作")} onClick={() => onClose(true)}><X size={14} /></button></header>
    <div className="research-table-structure">
      {item(t("下方插入行"), <><Rows3 size={15} /><Plus size={10} /></>, () => onAction(table => insertTableRow(table, row + 1), { row: row + 1, column }), !model)}
      {item(t("删除当前行"), <Trash2 size={15} />, () => confirmDelete({ title: t("删除表格行"), description: t`确定删除第 ${row + 1} 行及其中的全部单元格吗？` }, () => onAction(table => deleteTableRow(table, row))), !model || row === 0)}
      {item(t("右侧插入列"), <><Columns3 size={15} /><Plus size={10} /></>, () => onAction(table => insertTableColumn(table, column + 1), { row, column: column + 1 }), !model)}
      {item(t("删除当前列"), <Trash2 size={15} />, () => confirmDelete({ title: t("删除表格列"), description: t`确定删除第 ${column + 1} 列及其中的全部单元格吗？` }, () => onAction(table => deleteTableColumn(table, column))), !model || model.align.length < 2)}
    </div>
    <div className="research-table-alignment" role="group" aria-label={t("当前列对齐方式")}><span>{t("列对齐")}</span>{([
      ["left", t("左对齐"), AlignLeft], ["center", t("居中对齐"), AlignCenter], ["right", t("右对齐"), AlignRight],
    ] as const).map(([alignment, label, Icon]) => <button type="button" key={alignment} data-ui="icon-action" aria-label={label} title={label}
      aria-pressed={(model?.align[column] ?? "left") === alignment} disabled={!model} onClick={() => onAction(table => setTableAlignment(table, column, alignment))}><Icon size={15} /></button>)}</div>
    <footer>
      <button type="button" data-ui="icon-action" aria-label={t("撤销表格操作")} title={t("撤销表格操作")} disabled={!history.past.length} onClick={() => onHistory(false)}><Undo2 size={15} /></button>
      <button type="button" data-ui="icon-action" aria-label={t("重做表格操作")} title={t("重做表格操作")} disabled={!history.future.length} onClick={() => onHistory(true)}><Redo2 size={15} /></button>
      <button type="button" className="research-table-source-toggle" onClick={onSource}><Code2 size={15} />{t("编辑表格源码")}</button>
    </footer>
  </div>;
}

export default function ResearchTableBlock({ value, model, label, headings, onChange, onComplete }: {
  value: string;
  model: ResearchTable;
  label: string;
  headings?: readonly ResearchOutlineHeading[];
  onChange: (text: string, focusOnCancel?: HTMLElement) => boolean | void;
  onComplete?: () => void;
}) {
  useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  const modelRef = useRef<ResearchTable | null>(model);
  const changeRef = useRef(onChange);
  const activeRef = useRef<CellEditor | null>(null);
  const sequence = useRef(0);
  const frame = useRef(0);
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const historyRef = useRef(history);
  const [active, setActive] = useState<CellEditor | null>(null);
  const [selected, setSelected] = useState<Position>({ row: 0, column: 0 });
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const sourceActive = useRef(false);
  useLayoutEffect(() => { valueRef.current = value; modelRef.current = model; changeRef.current = onChange; }, [value, model, onChange]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); activeRef.current?.cell.removeAttribute("data-research-table-editing"); }, []);

  const updateHistory = (next: History) => { historyRef.current = next; setHistory(next); };
  const publish = (next: ResearchTable | string, record = true) => {
    const source = typeof next === "string" ? next : serializeResearchTable(next);
    if (source === valueRef.current) return true;
    // A rejected commit is awaiting deletion confirmation; keep the table and history intact.
    if (changeRef.current(source, rootRef.current ?? undefined) === false) return false;
    if (record) updateHistory({ past: [...historyRef.current.past.slice(-99), valueRef.current], future: [] });
    valueRef.current = source;
    modelRef.current = typeof next === "string" ? parseResearchTable(next) : next;
    return true;
  };
  const closeCell = (save: boolean) => {
    const current = activeRef.current;
    if (!current) return modelRef.current;
    activeRef.current = null;
    current.cell.removeAttribute("data-research-table-editing");
    const text = inputRef.current?.value ?? current.initial;
    setActive(null);
    if (save && modelRef.current && text !== current.initial) publish(setTableCell(modelRef.current, current.row, current.column, text));
    return modelRef.current;
  };
  const activate = (position: Position, reveal = false) => {
    if (activeRef.current?.row === position.row && activeRef.current.column === position.column) return;
    closeCell(true);
    const table = rootRef.current?.querySelector<HTMLTableElement>(":scope > .research-markdown-table > table");
    const cell = table?.rows[position.row]?.cells[position.column];
    const host = cell?.closest<HTMLDivElement>(".research-markdown-table");
    const current = modelRef.current;
    if (!cell || !host || !current) return;
    if (reveal) cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    const editor = { ...position, id: ++sequence.current, cell, host, style: editorStyle(cell, host), initial: current.rows[position.row]?.[position.column] ?? "" };
    cell.dataset.researchTableEditing = "true";
    activeRef.current = editor;
    setSelected(position);
    setActive(editor);
  };
  const scheduleEdit = (position: Position) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => activate(position, true));
  };
  useLayoutEffect(() => {
    if (!active) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.setSelectionRange(active.initial.length, active.initial.length);
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => {
      if (activeRef.current?.id !== active.id) return;
      Object.assign(inputRef.current?.style ?? {}, Object.fromEntries(Object.entries(editorStyle(active.cell, active.host)).map(([key, entry]) => [key, typeof entry === "number" ? `${entry}px` : entry])));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(active.cell);
    observer.observe(active.host);
    if (active.cell.closest("table")) observer.observe(active.cell.closest("table")!);
    const root = rootRef.current;
    root?.addEventListener("load", place, true);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); root?.removeEventListener("load", place, true); window.removeEventListener("resize", place); };
  }, [active, value]);

  const apply = (operation: (table: ResearchTable) => ResearchTable, target?: Position) => {
    const current = closeCell(true);
    if (!current) return;
    const next = operation(current);
    if (next !== current) publish(next);
    const position = target ?? selected;
    setSelected({ row: Math.min(position.row, next.rows.length - 1), column: Math.min(position.column, next.align.length - 1) });
    setTrigger(null);
    if (target) scheduleEdit(target);
    else rootRef.current?.focus({ preventScroll: true });
  };
  const restoreHistory = (redo: boolean) => {
    closeCell(true);
    const current = historyRef.current;
    const source = redo ? current.future[0] : current.past.at(-1);
    if (source === undefined) return;
    updateHistory(redo ? { past: [...current.past, valueRef.current], future: current.future.slice(1) }
      : { past: current.past.slice(0, -1), future: [valueRef.current, ...current.future] });
    publish(source, false);
    const restored = modelRef.current;
    if (restored) setSelected({ row: Math.min(selected.row, restored.rows.length - 1), column: Math.min(selected.column, restored.align.length - 1) });
    setTrigger(null);
    rootRef.current?.focus({ preventScroll: true });
  };
  const handleKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!["Escape", "Tab", "Enter"].includes(event.key)) return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === "Escape") event.preventDefault(); return; }
    if (event.key === "Enter" && event.shiftKey) return;
    const current = activeRef.current;
    if (!current) return;
    event.preventDefault();
    if (event.key === "Escape") { closeCell(false); rootRef.current?.focus({ preventScroll: true }); return; }
    const table = closeCell(true);
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && onComplete) { onComplete(); return; }
    if (event.key === "Tab" && table) {
      const index = current.row * table.align.length + current.column + (event.shiftKey ? -1 : 1);
      if (index >= 0 && index < table.rows.length * table.align.length) {
        scheduleEdit({ row: Math.floor(index / table.align.length), column: index % table.align.length });
        return;
      }
    }
    rootRef.current?.focus({ preventScroll: true });
  };
  const openSource = () => { closeCell(true); setTrigger(null); sourceActive.current = true; setSourceMode(true); };
  const finishSource = (save: boolean) => {
    if (!sourceActive.current) return true;
    sourceActive.current = false;
    const accepted = !save || !sourceRef.current || publish(sourceRef.current.value.replace(/\r\n?/g, "\n"));
    setSourceMode(false);
    rootRef.current?.focus({ preventScroll: true });
    return accepted;
  };
  useLayoutEffect(() => { if (sourceMode) sourceRef.current?.focus({ preventScroll: true }); }, [sourceMode]);

  return <div ref={rootRef} className="research-table-editor research-editable-text research-markdown" role="group" aria-label={label} tabIndex={0}
    aria-description={t("点击单元格编辑，Tab 切换单元格，Enter 保存，Ctrl/Cmd+Enter 完成本块并选择下一内容块，Shift+Enter 换行，Esc 放弃当前输入。聚焦表格后按 Enter 开始编辑。")}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && onComplete) { event.preventDefault(); onComplete(); }
      else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) { event.preventDefault(); restoreHistory(event.shiftKey || event.key.toLowerCase() === "y"); }
      else if (["Enter", "F2"].includes(event.key)) { event.preventDefault(); activate(selected, true); }
    }}
    onPointerDown={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || !(event.target instanceof Element) || event.target.closest("textarea, button, a.research-note-link")) return;
      const cell = event.target.closest<HTMLTableCellElement>("td, th");
      if (!cell) {
        if (event.target.closest("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, img") && !event.target.closest("a, input, select")) { event.preventDefault(); openSource(); }
        return;
      }
      if (cell.closest("table") !== rootRef.current?.querySelector(":scope > .research-markdown-table > table")) return;
      event.preventDefault();
      activate({ row: (cell.parentElement as HTMLTableRowElement).rowIndex, column: cell.cellIndex });
    }}
    onClick={event => { if (event.target instanceof Element && event.target.closest("td, th")?.closest("table") === rootRef.current?.querySelector(":scope > .research-markdown-table > table") && !event.ctrlKey && !event.metaKey) event.preventDefault(); }}>
    {!sourceMode && <button type="button" data-ui="icon-action" className="research-table-options" aria-label={t("表格操作")} title={t("表格行列、对齐与源码")} aria-expanded={!!trigger}
      onPointerDown={event => event.preventDefault()} onClick={event => { closeCell(true); setTrigger(trigger ? null : event.currentTarget); }}><TableProperties size={15} /></button>}
    {sourceMode ? <div className="research-table-source">
      <header><strong>{t("表格源码")}</strong><button type="button" onPointerDown={event => event.preventDefault()} onClick={() => finishSource(true)}>{t("返回表格")}</button></header>
      <ResearchMentionTextarea ref={sourceRef} aria-label={t("表格 Markdown 源码")} defaultValue={value} rows={Math.min(16, value.split("\n").length + 1)} spellCheck={false}
        onBlur={() => finishSource(true)} onKeyDown={event => {
          if (event.key !== "Escape" && !(event.key === "Enter" && (event.ctrlKey || event.metaKey))) return;
          event.stopPropagation(); event.preventDefault();
          if (!event.nativeEvent.isComposing && event.keyCode !== 229) {
            const accepted = finishSource(event.key !== "Escape");
            if (accepted && event.key === "Enter" && !event.shiftKey && !event.altKey) onComplete?.();
          }
        }} />
    </div> : <ResearchMarkdown text={value} headings={headings} />}
    {active && createPortal(<ResearchMentionTextarea key={active.id} ref={inputRef} className="research-table-cell-editor" aria-label={t("单元格内容")}
      aria-description={t("支持文字、行内 Markdown 和公式。Enter 保存，Esc 取消，Tab 切换，Shift+Enter 换行。")} spellCheck={false}
      style={active.style} rows={1} defaultValue={active.initial} onBlur={() => closeCell(true)} onKeyDown={handleKeys}
      onPaste={event => {
        const text = event.clipboardData.getData("text/plain");
        if (!/[\t\r\n]/.test(text) || !modelRef.current) return;
        event.preventDefault();
        const position = { row: active.row, column: active.column };
        closeCell(false);
        publish(pasteTableCells(modelRef.current!, position.row, position.column, parseTableClipboard(text)));
        rootRef.current?.focus({ preventScroll: true });
      }} />, active.host)}
    {trigger && <TableTools trigger={trigger} selected={selected} model={model} history={history} onAction={apply} onHistory={restoreHistory} onSource={openSource}
      onClose={restore => { setTrigger(null); if (restore) trigger.focus({ preventScroll: true }); }} />}
  </div>;
}
