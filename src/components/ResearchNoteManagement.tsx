import { useLayoutEffect, useRef, useState } from "react";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import {
  FilterX,
  Filter,
  FilePlus2,
  Info,
  Search,
  Tags,
  X,
} from "lucide-react";
import type {
  ResearchNote,
  ResearchNotebookState,
} from "../domain/researchNotebook.ts";
import {
  defaultResearchNoteFilters,
  filterResearchNotes,
  getNoteReviewStatus,
  getResearchNoteProgress,
  getResearchTagTree,
  noteReviewStates,
  setNoteReviewStatus,
  setResearchNoteTags,
  type NoteReviewStatus,
  type ResearchNoteFilters,
} from "../domain/researchNoteOrganization.ts";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import ResearchNoteMetadata from "./ResearchNoteMetadata.tsx";
import ResearchTagsPopover from "./ResearchTagsPopover.tsx";
import "./ResearchNoteManagement.css";
import {
  libraryFilters,
  libraryNotes,
  setLibraryFilters,
} from "../domain/researchNoteLibraries.ts";

function NoteFilterPopover({
  state,
  filters,
  onChange,
  trigger,
  onClose,
}: {
  state: ResearchNotebookState;
  filters: ResearchNoteFilters;
  onChange: (filters: ResearchNoteFilters) => void;
  trigger: HTMLButtonElement;
  onClose: (focus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  useFormulaPopover({
    ref,
    triggerRef,
    getAnchor: () => trigger.getBoundingClientRect(),
    onCancel: onClose,
  });
  return (
    <div
      ref={ref}
      popover="manual"
      className="research-note-management-popover"
      role="dialog"
      aria-label="筛选研究笔记"
    >
      <header>
        <strong>筛选研究笔记</strong>
        <button
          data-ui="icon-action"
          aria-label="关闭笔记筛选"
          onClick={() => onClose(true)}
          title="关闭笔记筛选"
        >
          <X size={14} />
        </button>
      </header>
      <label>
        核对状态
        <select
          aria-label="筛选核对状态"
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as ResearchNoteFilters["status"],
            })
          }
        >
          <option value="all">全部状态</option>
          {noteReviewStates.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        层级标签
        <select
          aria-label="筛选层级标签"
          value={filters.tag}
          onChange={(event) =>
            onChange({ ...filters, tag: event.target.value })
          }
        >
          <option value="">全部标签</option>
          {filters.tag &&
            !getResearchTagTree(libraryNotes(state)).some(
              (tag) => tag.path === filters.tag,
            ) && <option value={filters.tag}>{filters.tag}（0）</option>}
          {getResearchTagTree(libraryNotes(state)).map((tag) => (
            <option key={tag.path} value={tag.path}>
              {"　".repeat(tag.depth)}
              {tag.path}（{tag.count}）
            </option>
          ))}
        </select>
      </label>
      <p>选择父标签时，同时包含其下所有子标签。</p>
      <button
        data-ui="icon-action"
        className="research-small-button"
        onClick={() => onChange({ ...defaultResearchNoteFilters })}
        aria-label="清除筛选"
        title="清除筛选"
      >
        <FilterX size={15} />
      </button>
    </div>
  );
}

export function ResearchNoteListTools({
  state,
  onChange,
  onCreateNote,
}: {
  state: ResearchNotebookState;
  onChange: (state: ResearchNotebookState) => void;
  onCreateNote: () => void;
}) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const filters = libraryFilters(state);
  const progress = getResearchNoteProgress(libraryNotes(state));
  const filteredCount = filterResearchNotes(
    libraryNotes(state),
    filters,
  ).length;
  const setFilters = (noteFilters: ResearchNoteFilters) =>
    onChange(setLibraryFilters(state, noteFilters));
  const close = (focus = false) => {
    if (focus) trigger?.focus();
    setTrigger(null);
  };
  return (
    <div className="research-note-list-tools">
      <div className="research-note-search-row">
        <label className="research-note-search">
          <Search size={13} />
          <input
            aria-label="搜索研究笔记"
            placeholder="搜索笔记或标签"
            value={filters.query}
            onChange={(event) =>
              setFilters({ ...filters, query: event.target.value })
            }
          />
        </label>
        <button
          data-ui="icon-action"
          className="research-note-filter-button"
          aria-label="筛选研究笔记"
          aria-expanded={!!trigger}
          data-active={filters.status !== "all" || !!filters.tag}
          title="核对状态与层级标签筛选"
          onClick={(event) =>
            trigger ? close() : setTrigger(event.currentTarget)
          }
        >
          <Filter size={14} />
        </button>
        <button
          type="button"
          data-ui="icon-action"
          className="research-note-filter-button research-note-create-button"
          aria-label="新建笔记"
          title="新建笔记"
          onClick={onCreateNote}
        >
          <FilePlus2 size={15} />
        </button>
      </div>
      <div className="research-note-progress-copy">
        <button
          aria-label="查看已核对笔记"
          onClick={() =>
            setFilters({
              ...filters,
              status: filters.status === "reviewed" ? "all" : "reviewed",
            })
          }
        >
          已核对 {progress.reviewed} / {progress.total}
        </button>
        <span>{filteredCount} 篇</span>
      </div>
      <progress
        aria-label="笔记核对进度"
        value={progress.reviewed}
        max={progress.total || 1}
      />
      {(filters.status !== "all" || filters.tag) && (
        <button
          className="research-note-active-filter"
          title="点击清除筛选"
          aria-label="清除笔记筛选"
          onClick={() => setFilters({ ...defaultResearchNoteFilters })}
        >
          <span>
            {[
              noteReviewStates.find((status) => status.value === filters.status)
                ?.label,
              filters.tag,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <X size={11} />
        </button>
      )}
      {trigger && (
        <NoteFilterPopover
          state={state}
          filters={filters}
          onChange={setFilters}
          trigger={trigger}
          onClose={close}
        />
      )}
    </div>
  );
}

function NoteTagsPopover({ state, note, onChange, trigger, getTrigger, onClose }: {
  state: ResearchNotebookState;
  note: ResearchNote;
  onChange: (state: ResearchNotebookState) => void;
  trigger: HTMLButtonElement;
  getTrigger?: () => HTMLButtonElement;
  onClose: (focus?: boolean) => void;
}) {
  const confirmDelete = useDeleteConfirmation();
  const latestState = useRef(state);
  useLayoutEffect(() => { latestState.current = state; }, [state]);
  return <ResearchTagsPopover noun="笔记" assigned={note.tags ?? []} tree={getResearchTagTree(state.notes)}
    trigger={trigger} getTrigger={getTrigger} onClose={onClose}
    onAdd={tag => onChange(setResearchNoteTags(state, note.id, [...(note.tags ?? []), tag]))}
    onRemove={tag => confirmDelete({ title: "移除笔记标签", description: `确定从当前笔记移除标签“${tag}”吗？` }, () => {
      const current = latestState.current;
      onChange(setResearchNoteTags(current, note.id, (current.notes.find(item => item.id === note.id)?.tags ?? []).filter(value => value !== tag)));
    })} />;
}

export function ResearchNoteReviewStatus({
  state,
  note,
  onChange,
}: {
  state: ResearchNotebookState;
  note: ResearchNote;
  onChange: (state: ResearchNotebookState) => void;
}) {
  const status = getNoteReviewStatus(note);
  return (
    <label
      className="research-note-status-select"
      data-status={status}
      title="点击切换核对状态；修改已核对笔记的正文、公式或引用定义后，自动回到待核对。"
    >
      <select
        aria-label="笔记核对状态"
        value={status}
        onChange={(event) =>
          onChange(
            setNoteReviewStatus(
              state,
              note.id,
              event.target.value as NoteReviewStatus,
            ),
          )
        }
      >
        {noteReviewStates.map((value) => (
          <option key={value.value} value={value.value}>
            {value.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ResearchNoteTags({
  state,
  note,
  onChange,
}: {
  state: ResearchNotebookState;
  note: ResearchNote;
  onChange: (state: ResearchNotebookState) => void;
}) {
  if (!note.tags?.length) return null;
  return (
    <div className="research-note-tag-list" aria-label="笔记层级标签">
      {note.tags.map((tag) => (
        <button
          className="research-note-tag"
          key={tag}
          title={"筛选 " + tag}
          onClick={() =>
            onChange(
              setLibraryFilters(state, {
                ...defaultResearchNoteFilters,
                tag,
              }),
            )
          }
          aria-label={"筛选 " + tag}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}

export function ResearchNoteOrganizationPanel({ state, note, readOnly, onChange, onOpenNote, panel, trigger, getTrigger, onClose }: {
  state: ResearchNotebookState;
  note: ResearchNote;
  readOnly: boolean;
  onChange: (state: ResearchNotebookState) => void;
  onOpenNote: (id: string) => void;
  panel: "tags" | "metadata";
  trigger: HTMLButtonElement;
  getTrigger?: () => HTMLButtonElement;
  onClose: (restoreFocus?: boolean) => void;
}) {
  return panel === "tags"
    ? <NoteTagsPopover state={state} note={note} onChange={onChange} trigger={trigger} getTrigger={getTrigger} onClose={onClose} />
    : <ResearchNoteMetadata state={state} note={note} readOnly={readOnly} onChange={onChange} trigger={trigger} getTrigger={getTrigger} onClose={onClose}
      onOpenNote={id => { onClose(); onOpenNote(id); }} />;
}

export function ResearchNoteOrganizationBar({
  note,
  activePanel,
  onOpenPanel,
}: {
  note: ResearchNote;
  activePanel?: "tags" | "metadata";
  onOpenPanel: (panel: "tags" | "metadata", trigger: HTMLButtonElement) => void;
}) {
  const status = getNoteReviewStatus(note);
  const reviewedTime = note.reviewedAt
    ? `${status === "reviewed" ? "核对时间" : "上次核对"}：${new Date(note.reviewedAt).toLocaleString()}`
    : "";
  return (
    <div className="research-note-organization">
      <button
        data-ui="icon-action"
        className="research-small-button research-note-manage-tags"
        aria-label="管理笔记标签"
        title="管理笔记标签"
        aria-expanded={activePanel === "tags"}
        onClick={event => onOpenPanel("tags", event.currentTarget)}
      >
        <Tags size={15} />
      </button>
      <button
        data-ui="icon-action"
        className="research-small-button research-note-info"
        aria-label="笔记元数据"
        title="笔记元数据"
        aria-expanded={activePanel === "metadata"}
        onClick={event => onOpenPanel("metadata", event.currentTarget)}
      >
        <Info size={15} />
      </button>
      {reviewedTime && (
        <span className="research-note-review-time" title={reviewedTime}>
          {reviewedTime}
        </span>
      )}
    </div>
  );
}
