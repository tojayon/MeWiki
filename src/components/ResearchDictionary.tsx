import { useLocale } from "../i18n/react.ts";
import UiInfo from './UiInfo.tsx';
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import { ArrowLeft, Check, Filter, FilterX, Pencil, Plus, ScanSearch, Search, Tags, Trash2 } from "lucide-react";
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
import ResearchTagTreeToolbar from "./ResearchTagTreeToolbar.tsx";
import { researchSymbolChoice } from './researchChoices.ts';
import ResearchTagsPopover from "./ResearchTagsPopover.tsx";
import ResearchTermDictionary, { type ResearchTermFilters } from "./ResearchTermDictionary.tsx";
import ResearchDictionaryConsistencyPanel from "./ResearchDictionaryConsistencyPanel.tsx";
import "./ResearchDictionary.css";
export type ResearchDictionaryKind = "symbol" | "term";
function initialDraft(): ResearchSymbolEntry {
  return createSymbolEntry({
    name: "",
    aliases: [],
    notation: "q",
    meaning: "",
    category: "custom",
    slots: [],
  });
}

function aliasesFromInput(value: string) {
  return [...new Set(value.split(/[\n,，、]/).map(alias => alias.trim()).filter(Boolean))];
}

function ResearchSymbolDictionary({
  active,
  showSidebar,
  showDetail,
  state,
  onChange,
  windowActions,
  onOpen,
}: {
  active: boolean;
  showSidebar: boolean;
  showDetail: boolean;
  state: ResearchNotebookState;
  onChange: (next: ResearchNotebookState) => void;
  windowActions: ReactNode;
  onOpen: () => void;
}) {
  useLocale();
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
  const [consistencyOpen, setConsistencyOpen] = useState(false);

  const selectedId = state.activeSymbolId || (showDetail ? state.symbols[0]?.id : "") || "";
  const selected = state.symbols.find((entry) => entry.id === selectedId) ?? (showDetail ? state.symbols[0] : undefined);
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
    confirmDelete({ title: t("移除符号标签"), description: t`确定从当前符号移除标签“${tag}”吗？` }, () => {
      if (draft) setDraft(current => current?.id === entryId ? { ...current, tags: (current.tags ?? []).filter(value => value !== tag) } : current);
      else {
        const current = latestState.current;
        onChange(setResearchSymbolTags(current, entryId, (current.symbols.find(entry => entry.id === entryId)?.tags ?? []).filter(value => value !== tag)));
      }
    });
  };

  const uses = selected ? listSymbolUses(state.notes, selected.id) : [];
  const title = draft ? draft.name.trim() || t("新符号") : selected?.name || t("符号词典");
  const beginCreate = () => {
    onOpen();
    onChange({ ...state, view: "dictionary" });
    closeTagPanel();
    draftInitialTags.current = [];
    setDraft(initialDraft());
    setError("");
  };
  const beginEdit = () => {
    if (!selected) return;
    closeTagPanel();
    draftInitialTags.current = [...(selected.tags ?? [])];
    setDraft({ ...selected, aliases: [...(selected.aliases ?? [])], tags: [...(selected.tags ?? [])], slots: selected.slots.map((slot) => ({ ...slot, examples: slot.examples ? [...slot.examples] : undefined })) });
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
      ? { ...updateSymbolEntry(state, savedDraft), activeSymbolId: draft.id, activeTermId: undefined }
      : { ...state, symbols: [...state.symbols, savedDraft], activeSymbolId: draft.id, activeTermId: undefined };
    onChange(filterResearchSymbols([savedDraft], filters).length ? next : { ...next, symbolFilters: { ...defaultResearchSymbolFilters } });
    closeTagPanel();
    setPreviewState({ entryId: draft.id, bindings: Object.fromEntries(draft.slots.map((slot) => [slot.key, slot.defaultValue])) });
    setDraft(null);
    setError("");
  };
  const removeSelected = () => {
    if (!selected || uses.length) return;
    confirmDelete({ title: t("删除符号词条"), description: t`确定删除符号词条“${selected.name}”及其定义吗？` }, () => {
      const current = latestState.current;
      if (listSymbolUses(current.notes, selected.id).length) return;
      const next = deleteSymbolEntry(current, selected.id);
      const activeSymbolId = current.activeSymbolId === selected.id ? next.symbols[0]?.id ?? "" : current.activeSymbolId;
      onChange({ ...next, activeSymbolId });
    });
  };

  return (
    <>
      {showSidebar && <aside id="research-dictionary-sidebar" className="research-dictionary-sidebar">
        <div className="research-dictionary-toolbar">
          <label className="research-dictionary-search">
            <Search size={14} />
            <input data-ui="search-input" aria-label={t("搜索符号词条")} value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder={t("搜索符号或标签")} />
          </label>
          <label className="research-dictionary-tag-filter" data-active={!!filters.tag} title={filters.tag || t("筛选符号层级标签")}>
            <Filter size={14} aria-hidden="true" />
            <select aria-label={t("筛选符号层级标签")} value={filters.tag} onChange={event => setFilters({ ...filters, tag: event.target.value })}>
              <option value="">{t("全部标签")}</option>
              {filters.tag && !availableTags.some(tag => tag.path === filters.tag) && <option value={filters.tag}>{filters.tag}（0）</option>}
              {availableTags.map(tag => <option key={tag.path} value={tag.path}>{"　".repeat(tag.depth)}{tag.path}</option>)}
            </select>
          </label>
          <button data-ui="icon-action" className="research-note-filter-button" aria-label={t("清除符号筛选")} title={t("清除符号筛选")} disabled={!filtering} onClick={() => setFilters({ ...defaultResearchSymbolFilters })}><FilterX size={14} /></button>
          {!showDetail && <button data-ui="icon-action" className="research-small-button" onClick={beginCreate} aria-label={t("新建符号词条")} title={t("新建符号词条")}><Plus size={14} /></button>}
          <ResearchTagTreeToolbar />
        </div>
        <div className="research-dictionary-list" role="list" aria-label={t("符号列表")}>
          <ResearchClassifiedList choices={choices} branches={tree} foldingItems={state.symbols} selectedId={selected?.id ?? ""} activeTags={selected?.tags} navigation
            filtering={filtering} filterKey={JSON.stringify(filters)} storageKey="mewiki:research-symbol-tree-folds" label={t("筛选后的符号词条")}
            onSelect={entry => { onOpen(); closeTagPanel(); setConsistencyOpen(false); setDraft(null); onChange({ ...state, view: "dictionary", activeSymbolId: entry.id, activeTermId: undefined }); }}
            empty={<div className="research-note-no-results"><p>{t("没有匹配的符号词条")}</p><button data-ui="icon-action" className="research-small-button" aria-label={t("清除筛选")} title={t("清除筛选")} onClick={() => setFilters({ ...defaultResearchSymbolFilters })}><FilterX size={15} /></button></div>} />
        </div>
      </aside>}

      {showDetail && <div className="research-symbol-pane">
        <div className="research-symbol-definition-actions research-notebook-toolbar research-symbol-header" role="toolbar" aria-label={t("符号管理")}>
          <div className="research-note-header-leading">
            <div className="research-page-tags">
              {!draft && selected?.scope && <span className="research-note-tag">{selected.scope}</span>}
              <div className="research-note-tag-list" aria-label={t("符号层级标签")}>
                {(tagTarget?.tags ?? []).map(tag => draft ? <span className="research-note-tag" key={tag}>{tag}</span> : <button className="research-note-tag" key={tag} aria-label={t`筛选 ${tag}`} title={t`筛选 ${tag}`} onClick={() => setFilters({ ...defaultResearchSymbolFilters, tag })}>{tag}</button>)}
              </div>
            </div>
          </div>
          <h2 className="research-note-title research-symbol-title" title={title}>{title}</h2>
          <div className="research-note-header-actions">
            <div className="research-page-tools" role="toolbar" aria-label={t("符号词典功能")}>
              <div className="research-page-tool-actions">
                {tagTarget && <button data-ui="icon-action" className="research-small-button" aria-label={t("管理符号标签")} title={t("管理符号标签")}
                  aria-expanded={!!tagPanel && tagPanel.entryId === tagTarget.id}
                  onClick={event => tagPanel?.entryId === tagTarget.id ? closeTagPanel() : setTagPanel({ entryId: tagTarget.id, trigger: event.currentTarget })}><Tags size={14} /></button>}
                {selected && !draft && <button data-ui="icon-action" className="research-small-button" aria-label={t("一致性检查")} title={t("一致性检查")} onClick={() => setConsistencyOpen(true)}><ScanSearch size={14} /></button>}
                <button data-ui="icon-action" className="research-small-button" onClick={beginCreate} aria-label={t("新建符号词条")} title={t("新建符号词条")}><Plus size={14} /></button>
                {draft ? <>
                  <button data-ui="icon-action" className="research-small-button" onClick={() => { closeTagPanel(); setDraft(null); setError(""); }} aria-label={t("返回")} title={t("返回")}><ArrowLeft size={14} /></button>
                  <button data-ui="icon-action" className="research-small-button" onClick={saveDraft} aria-label={t("保存定义")} title={t("保存定义")}><Check size={14} /></button>
                </> : selected && <>
                  <button data-ui="icon-action" className="research-small-button" onClick={beginEdit} aria-label={t("编辑")} title={t("编辑")}><Pencil size={13} /></button>
                  <button data-ui="icon-action" data-tone="danger" className="research-small-button is-danger" disabled={uses.length > 0} title={uses.length ? t("公式正在引用此符号") : t("删除词条")} onClick={removeSelected} aria-label={t("删除词条")}><Trash2 size={13} /></button>
                </>}
              </div>
            </div>
            {windowActions}
          </div>
        </div>
        {active && tagPanel && tagTarget?.id === tagPanel.entryId && <ResearchTagsPopover key={tagTarget.id} noun="符号" assigned={tagTarget.tags ?? []} tree={availableTags}
          trigger={tagPanel.trigger} onClose={closeTagPanel} onAdd={tag => changeTags([...(tagTarget.tags ?? []), tag])} onRemove={removeTag} />}
      <section className="research-symbol-detail" aria-label={draft ? t("符号词条编辑器") : t("符号词条详情")}>
        {draft ? (
          <div className="research-symbol-edit">
            <label>{t("词条名称")}<input aria-label={t("符号词条名称")} placeholder={t("输入符号名称")} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>{t("符号别名")}<input aria-label={t("符号别名")} placeholder={t("可用顿号或逗号分隔")} value={(draft.aliases ?? []).join("、")} onChange={(event) => setDraft({ ...draft, aliases: aliasesFromInput(event.target.value) })} /></label>
            <label>{t("符号模板")}<input aria-label={t("符号模板")} value={draft.notation} onChange={(event) => setDraft({ ...draft, notation: event.target.value })} /><small>{t("固定模板：符号主体")}{"^{[x1]}_{[x2]}[x3]"}{t("。三个位置的括号与符号均由输入值完整给出。")}</small></label>
            <label>{t("本体说明")}<textarea aria-label={t("符号含义")} rows={3} value={draft.meaning} onChange={(event) => setDraft({ ...draft, meaning: event.target.value })} /></label>
            <label>{t("单位")}<input aria-label={t("符号单位")} value={draft.unit ?? ""} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} placeholder={t("可留空")} /></label>
            <label>{t("适用范围")}<input aria-label={t("适用范围")} value={draft.scope ?? ""} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} placeholder={t("例如：地球控制器")} /></label>
            <div className="research-symbol-slots-heading"><strong>{t("各位置的说明与默认值")}</strong><UiInfo label={t('符号填写说明')}><p>{t("旧名称和常见写法会用于一致性检查。")}</p><p>{t("默认值可留空，说明会独立保留并显示。基础定义省略环路上标，涉及多个环路时再填写 (p)。时间变量需要括号时请填写完整的 (t)。系统不自动添加括号。")}</p></UiInfo></div>
            <div className="research-symbol-position-fields">
              {draft.slots.map((slot, index) => <fieldset key={slot.key} className="research-symbol-position-field" data-symbol-position={slot.key}>
                <legend>{t(slot.label)}</legend>
                <label>{t("说明")}<textarea aria-label={t(slot.label) + t("说明")} rows={3} value={slot.description ?? ""} onChange={event => updateSlot(index, { description: event.target.value })} placeholder={t("说明这个位置表示什么，可使用 $…$ 编写数学公式")} /></label>
                <label>{t("默认值")}<input aria-label={t(slot.label) + t("默认值")} value={slot.defaultValue} onChange={(event) => updateSlot(index, { defaultValue: event.target.value })} placeholder={slot.key === "x1" ? t("例如 (p) 或 p") : slot.key === "x2" ? t("例如 g_h 或 j+1") : t("例如 (t)、[t] 或 t")} /></label>
              </fieldset>)}
            </div>
            {error && <p className="research-symbol-error" role="alert">{localizeError(error)}</p>}
          </div>
        ) : selected ? (
          <div className="research-symbol-definition">
            <ResearchSymbolDiagram key={selected.id} active={active} entry={selected} entries={state.symbols} bindings={previewBindings}
              onBindingChange={(key, value) => setPreviewState({ entryId: selected.id, bindings: { ...previewBindings, [key]: value } })} />
          </div>
        ) : <p className="research-dictionary-empty">{t("选择或创建符号词条。")}</p>}
        {active && consistencyOpen && selected && <ResearchDictionaryConsistencyPanel kind="symbol" entry={selected} state={state} onChange={onChange} onClose={() => setConsistencyOpen(false)} />}
      </section>
      </div>}
    </>
  );

  function updateSlot(index: number, patch: Partial<SymbolIndexSlot>) {
    if (!draft) return;
    setDraft({ ...draft, slots: draft.slots.map((slot, at) => at === index ? { ...slot, ...patch } : slot) });
  }
}

export default function ResearchDictionary(props: {
  active: boolean;
  sidebarKind: ResearchDictionaryKind | null;
  onOpenKind: (kind: ResearchDictionaryKind) => void;
  state: ResearchNotebookState;
  onChange: (next: ResearchNotebookState) => void;
  windowActions: ReactNode;
}) {
  useLocale();
  const entryKey = JSON.stringify([props.state.activeSymbolId, props.state.activeTermId]);
  const selectedKind: ResearchDictionaryKind = props.state.activeTermId ? "term" : "symbol";
  const [navigation, setNavigation] = useState({ entryKey, detailKind: selectedKind });
  const [termFilters, setTermFilters] = useState<ResearchTermFilters>({ query: "", tag: "" });
  const detailKind = navigation.entryKey === entryKey ? navigation.detailKind : selectedKind;
  const openKind = (next: ResearchDictionaryKind) => {
    setNavigation({ entryKey, detailKind: next });
    props.onOpenKind(next);
  };
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: ResearchDictionaryKind; id?: string } | string>).detail;
      const target = typeof detail === "string" ? "symbol" : detail?.kind;
      if (target === "symbol" || target === "term") setNavigation({ entryKey, detailKind: target });
    };
    window.addEventListener("research-dictionary-open", open);
    return () => window.removeEventListener("research-dictionary-open", open);
  }, [entryKey]);
  const visible = props.active || props.sidebarKind !== null;
  return <div className={`research-dictionary${visible ? " is-active" : ""}`} aria-label={t("符号词典")} aria-hidden={!visible}>
    <ResearchSymbolDictionary key={`symbol:${props.state.activeSymbolId}`} {...props} showSidebar={props.sidebarKind === "symbol"} showDetail={props.active && detailKind === "symbol"} onOpen={() => openKind("symbol")} />
    <ResearchTermDictionary key={`term:${props.state.activeTermId ?? ""}`} {...props} filters={termFilters} setFilters={setTermFilters} showSidebar={props.sidebarKind === "term"} showDetail={props.active && detailKind === "term"} onOpen={() => openKind("term")} />
  </div>;
}
