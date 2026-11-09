import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Download, GitBranch, MoreHorizontal, Trash2, Upload, X } from "lucide-react";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import "./ResearchNoteMoreMenu.css";

export interface ResearchNoteMenuAction {
  label: string;
  icon: ReactNode;
  onSelect: (trigger: HTMLButtonElement) => void;
}

interface NoteMoreMenuProps {
  empty: boolean;
  readOnly: boolean;
  mapOpen: boolean;
  deleteDisabled: boolean;
  deleteTitle: string;
  onToggleMap: () => void;
  onImport: () => void;
  onExport: () => void;
  onExportMedia?: () => void;
  onDelete: () => void;
  onCloseReading?: () => void;
  extraActions?: ResearchNoteMenuAction[];
}

function NoteMorePopover({ id, trigger, onClose, ...actions }: NoteMoreMenuProps & {
  id: string;
  trigger: HTMLButtonElement;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  useFormulaPopover({ ref, triggerRef, getAnchor: () => trigger.getBoundingClientRect(), onCancel: onClose });
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, []);
  const run = (action: () => void) => {
    onClose(true);
    action();
  };
  return <div ref={ref} id={id} popover="manual" className="research-note-more-menu" role="menu" aria-label="更多笔记功能"
    onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {actions.extraActions?.map(action => <button key={action.label} type="button" role="menuitem" onClick={() => run(() => action.onSelect(trigger))}>
      {action.icon}<span>{action.label}</span>
    </button>)}
    {!!actions.extraActions?.length && <div role="separator" />}
    {!actions.empty && <button type="button" role="menuitem" onClick={() => run(actions.onToggleMap)}>
      {actions.mapOpen ? <BookOpen size={15} /> : <GitBranch size={15} />}
      <span>{actions.mapOpen ? "返回笔记正文" : "本篇推导图"}</span>
    </button>}
    <button type="button" role="menuitem" onClick={() => run(actions.onImport)}><Upload size={15} /><span>导入 Markdown</span></button>
    <button type="button" role="menuitem" disabled={actions.empty} onClick={() => run(actions.onExport)}><Download size={15} /><span>导出 Markdown</span></button>
    {actions.onExportMedia && <button type="button" role="menuitem" disabled={actions.empty} onClick={() => run(actions.onExportMedia!)}><Download size={15} /><span>导出 Markdown 与附件</span></button>}
    {actions.onCloseReading && <button type="button" role="menuitem" onClick={() => run(actions.onCloseReading!)}><X size={15} /><span>关闭当前阅读笔记</span></button>}
    {!actions.empty && !actions.readOnly && <>
      <div role="separator" />
      <button type="button" role="menuitem" className="research-note-more-delete" disabled={actions.deleteDisabled}
        title={actions.deleteTitle} onClick={() => run(actions.onDelete)}><Trash2 size={15} /><span>删除笔记</span></button>
    </>}
  </div>;
}

export default function ResearchNoteMoreMenu(props: NoteMoreMenuProps) {
  const id = useId();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const close = (restoreFocus = false) => {
    if (restoreFocus) trigger?.focus({ preventScroll: true });
    setTrigger(null);
  };
  return <>
    <button type="button" data-ui="icon-action" className="research-note-more-toggle" aria-label="更多笔记功能" title="更多功能"
      aria-haspopup="menu" aria-expanded={!!trigger} aria-controls={trigger ? id : undefined}
      onClick={event => trigger ? close() : setTrigger(event.currentTarget)}
      onKeyDown={event => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        setTrigger(event.currentTarget);
      }}><MoreHorizontal size={16} /></button>
    {trigger && <NoteMorePopover {...props} id={id} trigger={trigger} onClose={close} />}
  </>;
}
