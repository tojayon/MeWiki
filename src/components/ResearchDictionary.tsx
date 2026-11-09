import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import { ArrowLeft, Check, FilterX, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import {
  createSymbolEntry,
  deleteSymbolEntry,
  listSymbolUses,
  symbolEntryError,
  updateSymbolEntry,
  type ResearchSymbolEntry,
  type SymbolIndexSlot,
} from "../domain/researchDictionary.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import ResearchSymbolDiagram from "./ResearchSymbolDiagram.tsx";
import { defaultResearchSymbolFilters, filterResearchSymbols, mergeResearchSymbolTags, setResearchSymbolTags, type ResearchSymbolFilters } from "../domain/researchSymbolOrganization.ts";
import { buildResearchTagTree, getResearchTagTree } from "../domain/researchTags.ts";
import ResearchClassifiedList from "./ResearchClassifiedList.tsx";
import { researchSymbolChoice } from './researchChoices.ts';
import ResearchTagsPopover from "./ResearchTagsPopover.tsx";
import "./ResearchDictionary.css";
function initialDraft(): ResearchSymbolEntry {
  return createSymbolEntry({
    name: "",
    notation: "q",
    meaning: "",
    category: "custom",
    slots: [],
  });
}

export default function ResearchDictionary({
  active,
  state,
  onChange,
  windowActions,
  pageControls,
}: {
  active: boolean;
  state: ResearchNotebookState;
  onChange: (next: ResearchNotebookState) => void;
  windowActions: ReactNode;
  pageControls: ReactNode;
}) {
  const filters = state.symbolFilters ?? defaultResearchSymbolFilters;
  const setFilters = (next: ResearchSymbolFilters) => onChange({ ...state, symbolFilters: next });
  const confirmDelete = useDeleteConfirmation();
  const latestState = useRef(state);
  useLayoutEffect(() => { latestState.current = state; }, [state]);
  const [previewState, setPreviewState] = useState<{ entryId: string; bindings: Record<string, string> }>({ entryId: "", bindings: {} });
  const [draft, setDraft] = useState<ResearchSymbolEntry | null>(null);
  const draftInitialTags = useRef<string[]>([]);
  const [error, setError] = useState("");
  const [tagPanel, setTagPanel] = useState<{ entryId: string; trigger: HTMLButtonElement } | null>(null);

  const selectedId = state.activeSymbolId || state.symbols[0]?.id || "";
  const selected = state.symbols.find((entry) => entry.id === selectedId) ?? state.symbols[0];
  const defaults = Object.fromEntries(selected?.slots.map((slot) => [slot.key, slot.defaultValue]) ?? []);
  const previewBindings = selected?.id === previewState.entryId
    ? { ...defaults, ...previewState.bindings }
    : defaults;
  const choices = useMemo(() => filterResearchSymbols(state.symbols, filters).map(researchSymbolChoice), [state.symbols, filters]);
  const tree = useMemo(() => buildResearchTagTree(choices, filters.tag), [choices, filters.tag]);
  const availableTags = useMemo(() => getResearchTagTree(state.symbols), [state.symbols]);
  const filtering = !!filters.query.trim() || !!filters.tag;
  const tagTarget = draft ?? selected;
  const closeTagPanel = (restoreFocus = false) => {
    if (restoreFocus) tagPanel?.trigger.focus({ preventScroll: true });
    setTagPanel(null);
  };
  const changeTags = (tags: string[]) => {
    if (draft) setDraft({ ...draft, tags });
    else if (selected) onChange(setResearchSymbolTags(state, selected.id, tags));
  };
  const removeTag = (tag: string) => {
    if (!tagTarget) return;
    const entryId = tagTarget.id;
    confirmDelete({ title: "移除符号标签", description: `确定从当前符号移除标签“${tag}”吗？` }, () => {
      if (draft) setDraft(current => current?.id === entryId ? { ...current, tags: (current.tags ?? []).filter(value => value !== tag) } : current);
      else {
        const current = latestState.current;
        onChange(setResearchSymbolTags(current, entryId, (current.symbols.find(entry => entry.id === entryId)?.tags ?? []).filter(value => value !== tag)));
      }
    });
  };

  const uses = selected ? listSymbolUses(state.notes, selected.id) : [];
  const title = draft ? draft.name.trim() || "新符号" : selected?.name || "符号词典";
  const beginCreate = () => {
    closeTagPanel();
    draftInitialTags.current = [];
    setDraft(initialDraft());
    setError("");
  };
  const beginEdit = () => {
    if (!selected) return;
    closeTagPanel();
    draftInitialTags.current = [...(selected.tags ?? [])];
    setDraft({ ...selected, tags: [...(selected.tags ?? [])], slots: selected.slots.map((slot) => ({ ...slot, examples: slot.examples ? [...slot.examples] : undefined })) });
    setError("");
  };
  const saveDraft = () => {
    if (!draft) return;
    const currentEntry = state.symbols.find(entry => entry.id === draft.id);
    const savedDraft = currentEntry ? { ...draft, tags: mergeResearchSymbolTags(currentEntry.tags ?? [], draftInitialTags.current, draft.tags ?? []) } : draft;
    const issue = symbolEntryError(savedDraft, state.symbols);
    if (issue) {
      setError(issue);
      return;
    }
    const next = currentEntry
      ? { ...updateSymbolEntry(state, savedDraft), activeSymbolId: draft.id }
      : { ...state, symbols: [...state.symbols, savedDraft], activeSymbolId: draft.id };
    onChange(filterResearchSymbols([savedDraft], filters).length ? next : { ...next, symbolFilters: { ...defaultResearchSymbolFilters } });
    closeTagPanel();
    setPreviewState({ entryId: draft.id, bindings: Object.fromEntries(draft.slots.map((slot) => [slot.key, slot.defaultValue])) });
    setDraft(null);
    setError("");
  };
  const removeSelected = () => {
    if (!selected || uses.length) return;
    confirmDelete({ title: "删除符号词条", description: `确定删除符号词条“${selected.name}”及其定义吗？` }, () => {
      const current = latestState.current;
      if (listSymbolUses(current.notes, selected.id).length) return;
      const next = deleteSymbolEntry(current, selected.id);
      const activeSymbolId = current.activeSymbolId === selected.id ? next.symbols[0]?.id ?? "" : current.activeSymbolId;
      onChange({ ...next, activeSymbolId });
    });
  };

  return (
    <div
      className={`research-dictionary${active ? " is-active" : ""}`}
      aria-label="研究符号词典"
      aria-hidden={!active}
    >
      <aside id="research-dictionary-sidebar" className="research-dictionary-sidebar">
        <div className="research-dictionary-toolbar">
          <div className="research-dictionary-search-row">
          <label className="research-dictionary-search">
            <Search size={14} />
            <input aria-label="搜索符号词条" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="搜索符号或标签" />
          </label>
          </div>
          <div className="research-dictionary-tag-filter">
            <select aria-label="筛选符号层级标签" value={filters.tag} onChange={event => setFilters({ ...filters, tag: event.target.value })}>
              <option value="">全部标签</option>
              {filters.tag && !availableTags.some(tag => tag.path === filters.tag) && <option value={filters.tag}>{filters.tag}（0）</option>}
              {availableTags.map(tag => <option key={tag.path} value={tag.path}>{"　".repeat(tag.depth)}{tag.path}</option>)}
            </select>
            <button data-ui="icon-action" className="research-note-filter-button" aria-label="清除符号筛选" title="清除符号筛选" disabled={!filtering} onClick={() => setFilters({ ...defaultResearchSymbolFilters })}><FilterX size={14} /></button>
          </div>
        </div>
        <div className="research-dictionary-list" role="list" aria-label="符号列表">
          <ResearchClassifiedList choices={choices} branches={tree} selectedId={selected?.id ?? ""} activeTags={selected?.tags} navigation
            filtering={filtering} filterKey={JSON.stringify(filters)} storageKey="mewiki:research-symbol-tree-folds" label="筛选后的符号词条"
            onSelect={entry => { closeTagPanel(); setDraft(null); onChange({ ...state, activeSymbolId: entry.id }); }}
            empty={<div className="research-note-no-results"><p>没有匹配的符号词条</p><button data-ui="icon-action" className="research-small-button" aria-label="清除筛选" title="清除筛选" onClick={() => setFilters({ ...defaultResearchSymbolFilters })}><FilterX size={15} /></button></div>} />
        </div>
      </aside>

      <div className="research-symbol-pane">
        <div className="research-symbol-definition-actions research-notebook-toolbar research-symbol-header" role="toolbar" aria-label="符号管理">
          <div className="research-note-header-leading">
            {pageControls}
            <div className="research-page-tags">
              {!draft && selected?.scope && <span className="research-note-tag">{selected.scope}</span>}
              <div className="research-note-tag-list" aria-label="符号层级标签">
                {(tagTarget?.tags ?? []).map(tag => draft ? <span className="research-note-tag" key={tag}>{tag}</span> : <button className="research-note-tag" key={tag} aria-label={`筛选 ${tag}`} title={`筛选 ${tag}`} onClick={() => setFilters({ ...defaultResearchSymbolFilters, tag })}>{tag}</button>)}
              </div>
            </div>
          </div>
          <h2 className="research-note-title research-symbol-title" title={title}>{title}</h2>
          <div className="research-note-header-actions">
            <div className="research-page-tools" role="toolbar" aria-label="符号词典功能">
              <div className="research-page-tool-actions">
                {tagTarget && <button data-ui="icon-action" className="research-small-button" aria-label="管理符号标签" title="管理符号标签"
                  aria-expanded={!!tagPanel && tagPanel.entryId === tagTarget.id}
                  onClick={event => tagPanel?.entryId === tagTarget.id ? closeTagPanel() : setTagPanel({ entryId: tagTarget.id, trigger: event.currentTarget })}><Tags size={14} /></button>}
                <button data-ui="icon-action" className="research-small-button" onClick={beginCreate} aria-label="新建符号词条" title="新建符号词条"><Plus size={14} /></button>
                {draft ? <>
                  <button data-ui="icon-action" className="research-small-button" onClick={() => { closeTagPanel(); setDraft(null); setError(""); }} aria-label="返回" title="返回"><ArrowLeft size={14} /></button>
                  <button data-ui="icon-action" className="research-small-button" onClick={saveDraft} aria-label="保存定义" title="保存定义"><Check size={14} /></button>
                </> : selected && <>
                  <button data-ui="icon-action" className="research-small-button" onClick={beginEdit} aria-label="编辑" title="编辑"><Pencil size={13} /></button>
                  <button data-ui="icon-action" data-tone="danger" className="research-small-button is-danger" disabled={uses.length > 0} title={uses.length ? "公式正在引用此符号" : "删除词条"} onClick={removeSelected} aria-label="删除词条"><Trash2 size={13} /></button>
                </>}
              </div>
            </div>
            {windowActions}
          </div>
        </div>
        {active && tagPanel && tagTarget?.id === tagPanel.entryId && <ResearchTagsPopover key={tagTarget.id} noun="符号" assigned={tagTarget.tags ?? []} tree={availableTags}
          trigger={tagPanel.trigger} onClose={closeTagPanel} onAdd={tag => changeTags([...(tagTarget.tags ?? []), tag])} onRemove={removeTag} />}
      <section className="research-symbol-detail" aria-label={draft ? "符号词条编辑器" : "符号词条详情"}>
        {draft ? (
          <div className="research-symbol-edit">
            <label>词条名称<input aria-label="符号词条名称" placeholder="输入符号名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>符号模板<input aria-label="符号模板" value={draft.notation} onChange={(event) => setDraft({ ...draft, notation: event.target.value })} /><small>固定模板：符号主体{"^{[x1]}_{[x2]}[x3]"}。三个位置的括号与符号均由输入值完整给出。</small></label>
            <label>本体说明<textarea aria-label="符号含义" rows={3} value={draft.meaning} onChange={(event) => setDraft({ ...draft, meaning: event.target.value })} /></label>
            <label>单位<input aria-label="符号单位" value={draft.unit ?? ""} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} placeholder="可留空" /></label>
            <label>适用范围<input aria-label="适用范围" value={draft.scope ?? ""} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} placeholder="例如：地球控制器" /></label>
            <div className="research-symbol-slots-heading"><strong>各位置的说明与默认值</strong></div>
            <div className="research-symbol-position-fields">
              {draft.slots.map((slot, index) => <fieldset key={slot.key} className="research-symbol-position-field" data-symbol-position={slot.key}>
                <legend>{slot.label}</legend>
                <label>说明<textarea aria-label={slot.label + "说明"} rows={3} value={slot.description ?? ""} onChange={event => updateSlot(index, { description: event.target.value })} placeholder="说明这个位置表示什么，可使用 $…$ 编写数学公式" /></label>
                <label>默认值<input aria-label={slot.label + "默认值"} value={slot.defaultValue} onChange={(event) => updateSlot(index, { defaultValue: event.target.value })} placeholder={slot.key === "x1" ? "例如 (p) 或 p" : slot.key === "x2" ? "例如 g_h 或 j+1" : "例如 (t)、[t] 或 t"} /></label>
              </fieldset>)}
            </div>
            <p className="research-symbol-slot-hint">默认值可留空，说明会独立保留并显示。基础定义省略环路上标，涉及多个环路时再填写 (p)。时间变量需要括号时请填写完整的 (t)。系统不自动添加括号。</p>
            {error && <p className="research-symbol-error" role="alert">{error}</p>}
          </div>
        ) : selected ? (
          <div className="research-symbol-definition">
            <ResearchSymbolDiagram key={selected.id} active={active} entry={selected} entries={state.symbols} bindings={previewBindings}
              onBindingChange={(key, value) => setPreviewState({ entryId: selected.id, bindings: { ...previewBindings, [key]: value } })} />
          </div>
        ) : <p className="research-dictionary-empty">选择或创建符号词条。</p>}
      </section>
      </div>
    </div>
  );

  function updateSlot(index: number, patch: Partial<SymbolIndexSlot>) {
    if (!draft) return;
    setDraft({ ...draft, slots: draft.slots.map((slot, at) => at === index ? { ...slot, ...patch } : slot) });
  }
}
