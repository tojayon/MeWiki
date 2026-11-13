import { useLocale } from "../i18n/react.ts";
import { t, formatDate } from "../i18n/locale.ts";
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
  getNoteReviewStatus,
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
import ResearchTagTreeToolbar from "./ResearchTagTreeToolbar.tsx";
import "./ResearchNoteManagement.css";
import { isMeWikiManualNote } from "../domain/meWikiManual.ts";
import {
  currentNoteLibrary,
  libraryFilters,
  libraryNotes,
  setLibraryFilters,
  type ResearchNoteLibrary,
} from "../domain/researchNoteLibraries.ts";

function NoteFilterPopover({
  state,
  library,
  filters,
  onChange,
  trigger,
  onClose,
}: {
  state: ResearchNotebookState;
  library: ResearchNoteLibrary;
  filters: ResearchNoteFilters;
  onChange: (filters: ResearchNoteFilters) => void;
  trigger: HTMLButtonElement;
  onClose: (focus?: boolean) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const notes = libraryNotes(state, library).filter(note => !isMeWikiManualNote(note));
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
      aria-label={t("筛选研究笔记")}
    >
      <header>
        <strong>{t("筛选研究笔记")}</strong>
        <button
          data-ui="icon-action"
          aria-label={t("关闭笔记筛选")}
          onClick={() => onClose(true)}
          title={t("关闭笔记筛选")}
        >
          <X size={14} />
        </button>
      </header>
      <label>
        {t("核对状态")}<select
          aria-label={t("筛选核对状态")}
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as ResearchNoteFilters["status"],
            })
          }
        >
          <option value="all">{t("全部状态")}</option>
          {noteReviewStates.map((status) => (
            <option key={status.value} value={status.value}>
              {t(status.label)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("层级标签")}<select
          aria-label={t("筛选层级标签")}
          value={filters.tag}
          onChange={(event) =>
            onChange({ ...filters, tag: event.target.value })
          }
        >
          <option value="">{t("全部标签")}</option>
          {filters.tag &&
            !getResearchTagTree(notes).some(
              (tag) => tag.path === filters.tag,
            ) && <option value={filters.tag}>{filters.tag}（0）</option>}
          {getResearchTagTree(notes).map((tag) => (
            <option key={tag.path} value={tag.path}>
              {"　".repeat(tag.depth)}
              {tag.path}（{tag.count}）
            </option>
          ))}
        </select>
      </label>
      <p>{t("选择父标签时，同时包含其下所有子标签。")}</p>
      <button
        data-ui="icon-action"
        className="research-small-button"
        onClick={() => onChange({ ...defaultResearchNoteFilters })}
        aria-label={t("清除筛选")}
        title={t("清除筛选")}
      >
        <FilterX size={15} />
      </button>
    </div>
  );
}

export function ResearchNoteListTools({
  state,
  library = currentNoteLibrary(state),
  onChange,
  onCreateNote,
}: {
  state: ResearchNotebookState;
  library?: ResearchNoteLibrary;
  onChange: (state: ResearchNotebookState) => void;
  onCreateNote: () => void;
}) {
  useLocale();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const filters = libraryFilters(state, library);
  const setFilters = (noteFilters: ResearchNoteFilters) =>
    onChange(setLibraryFilters(state, noteFilters, library));
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
            data-ui="search-input"
            aria-label={t("搜索研究笔记")}
            placeholder={t("搜索笔记或标签")}
            value={filters.query}
            onChange={(event) =>
              setFilters({ ...filters, query: event.target.value })
            }
          />
        </label>
        <button
          data-ui="icon-action"
          className="research-note-filter-button"
          aria-label={t("筛选研究笔记")}
          aria-expanded={!!trigger}
          data-active={filters.status !== "all" || !!filters.tag}
          title={t("核对状态与层级标签筛选")}
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
          aria-label={t("新建笔记")}
          title={t("新建笔记")}
          onClick={onCreateNote}
        >
          <FilePlus2 size={15} />
        </button>
        <ResearchTagTreeToolbar />
      </div>
      {(filters.status !== "all" || filters.tag) && (
        <button
          className="research-note-active-filter"
          title={t("点击清除筛选")}
          aria-label={t("清除笔记筛选")}
          onClick={() => setFilters({ ...defaultResearchNoteFilters })}
        >
          <span>
            {[
              t(noteReviewStates.find((status) => status.value === filters.status)
                ?.label ?? ""),
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
          library={library}
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
  useLocale();
  const confirmDelete = useDeleteConfirmation();
  const latestState = useRef(state);
  useLayoutEffect(() => { latestState.current = state; }, [state]);
  return <ResearchTagsPopover noun="笔记" assigned={note.tags ?? []} tree={getResearchTagTree(state.notes)}
    trigger={trigger} getTrigger={getTrigger} onClose={onClose}
    onAdd={tag => onChange(setResearchNoteTags(state, note.id, [...(note.tags ?? []), tag]))}
    onRemove={tag => confirmDelete({ title: t("移除笔记标签"), description: t`确定从当前笔记移除标签“${tag}”吗？` }, () => {
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
  useLocale();
  const status = getNoteReviewStatus(note);
  return (
    <label
      className="research-note-status-select"
      data-status={status}
      title={t("点击切换核对状态；修改已核对笔记的正文、公式或引用定义后，自动回到待核对。")}
    >
      <select
        aria-label={t("笔记核对状态")}
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
            {t(value.label)}
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
  useLocale();
  if (!note.tags?.length) return null;
  return (
    <div className="research-note-tag-list" aria-label={t("笔记层级标签")}>
      {note.tags.map((tag) => (
        <button
          className="research-note-tag"
          key={tag}
          title={t("筛选 ") + tag}
          onClick={() =>
            onChange(
              setLibraryFilters(state, {
                ...defaultResearchNoteFilters,
                tag,
              }),
            )
          }
          aria-label={t("筛选 ") + tag}
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
  useLocale();
  return panel === "tags"
    ? <NoteTagsPopover state={state} note={note} onChange={onChange} trigger={trigger} getTrigger={getTrigger} onClose={onClose} />
    : <ResearchNoteMetadata state={state} note={note} readOnly={readOnly} onChange={onChange} trigger={trigger} getTrigger={getTrigger} onClose={onClose}
      onOpenNote={id => { onClose(); onOpenNote(id); }} />;
}

export function ResearchNoteOrganizationBar({
  activePanel,
  onOpenPanel,
}: {
  activePanel?: "tags" | "metadata";
  onOpenPanel: (panel: "tags" | "metadata", trigger: HTMLButtonElement) => void;
}) {
  useLocale();
  return (
    <div className="research-note-organization">
      <button
        data-ui="icon-action"
        className="research-small-button research-note-manage-tags"
        aria-label={t("管理笔记标签")}
        title={t("管理笔记标签")}
        aria-expanded={activePanel === "tags"}
        onClick={event => onOpenPanel("tags", event.currentTarget)}
      >
        <Tags size={15} />
      </button>
      <button
        data-ui="icon-action"
        className="research-small-button research-note-info"
        aria-label={t("笔记元数据")}
        title={t("笔记元数据")}
        aria-expanded={activePanel === "metadata"}
        onClick={event => onOpenPanel("metadata", event.currentTarget)}
      >
        <Info size={15} />
      </button>
    </div>
  );
}

export function ResearchNoteReviewTime({ note }: { note: ResearchNote }) {
  useLocale();
  if (!note.reviewedAt) return null;
  const label = getNoteReviewStatus(note) === "reviewed" ? t("核对时间") : t("上次核对");
  const time = formatDate(note.reviewedAt, { dateStyle: "medium", timeStyle: "short" });
  return (
    <span className="research-note-review-time" title={`${label}：${time}`}>
      {label}：<time dateTime={note.reviewedAt}>{time}</time>
    </span>
  );
}
