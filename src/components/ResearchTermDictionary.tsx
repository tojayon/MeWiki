import { useLocale } from "../i18n/react.ts";
import { localizeError, t } from "../i18n/locale.ts";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlignLeft, ArrowLeft, Atom, Check, Filter, FilterX, Languages, Pencil, Plus, ScanSearch, Search, Trash2 } from "lucide-react";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import {
  addTermEntry,
  createTermEntry,
  deleteTermEntry,
  listTermUses,
  termEntryError,
  updateTermEntry,
  researchTermAtoms,
  researchTermAliases,
  formatTermReference,
  type ResearchTermAlias,
  type ResearchTermAtom,
  type ResearchTermEntry,
} from "../domain/researchTerms.ts";
import { buildResearchTagTree, getResearchTagTree, matchesResearchTag } from "../domain/researchTags.ts";
import { filterResearchChoices, researchTermChoice } from "./researchChoices.ts";
import ResearchClassifiedList from "./ResearchClassifiedList.tsx";
import ResearchTagTreeToolbar from "./ResearchTagTreeToolbar.tsx";
import ResearchDictionaryConsistencyPanel from "./ResearchDictionaryConsistencyPanel.tsx";
import ResearchTermDiagram from "./ResearchTermDiagram.tsx";
import "./ResearchDictionary.css";

function initialDraft() {
  return createTermEntry({ name: "", aliases: [], aliasEntries: [], meaning: "", tags: [], status: "active" });
}

function tagsFromInput(value: string) {
  return [...new Set(value.split(/[\n,，]/).map(tag => tag.trim()).filter(Boolean))];
}

function atomId(termId: string) {
  return `${termId}:atom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface ResearchTermFilters {
  query: string;
  tag: string;
}

export default function ResearchTermDictionary({ active, showSidebar, showDetail, filters, setFilters, state, onChange, windowActions, pageControls, onOpen }: {
  active: boolean;
  showSidebar: boolean;
  showDetail: boolean;
  filters: ResearchTermFilters;
  setFilters: (next: ResearchTermFilters) => void;
  state: ResearchNotebookState;
  onChange: (next: ResearchNotebookState) => void;
  windowActions: ReactNode;
  pageControls: ReactNode;
  onOpen: () => void;
}) {
  useLocale();
  const terms = useMemo(() => state.terms ?? [], [state.terms]);
  const confirmDelete = useDeleteConfirmation();
  const latestState = useRef(state);
  useLayoutEffect(() => { latestState.current = state; }, [state]);
  const [draft, setDraft] = useState<ResearchTermEntry | null>(null);
  const [error, setError] = useState("");
  const [consistencyOpen, setConsistencyOpen] = useState(false);
  const selectedId = state.activeTermId || (showDetail ? terms[0]?.id : "") || "";
  const selected = terms.find(entry => entry.id === selectedId) ?? (showDetail ? terms[0] : undefined);
  const choices = useMemo(() => filterResearchChoices(terms.map(researchTermChoice), filters.query)
    .filter(choice => !filters.tag || (choice.tags ?? []).some(tag => matchesResearchTag(tag, filters.tag))), [terms, filters]);
  const tree = useMemo(() => buildResearchTagTree(choices, filters.tag), [choices, filters.tag]);
  const availableTags = useMemo(() => getResearchTagTree(terms), [terms]);
  const filtering = !!filters.query.trim() || !!filters.tag;
  const uses = selected ? listTermUses(state.notes, selected.id) : [];
  const tagTarget = draft ?? selected;
  const title = draft ? draft.name.trim() || t("新术语") : selected?.name || t("术语词典");
  const atoms = selected ? researchTermAtoms(selected) : [];

  const beginCreate = () => { onOpen(); onChange({ ...state, view: "dictionary" }); setDraft(initialDraft()); setError(""); };
  const cancelDraft = () => { setDraft(null); setError(""); };
  const beginEdit = () => {
    if (!selected) return;
    setDraft({ ...selected, aliases: [...selected.aliases], aliasEntries: researchTermAliases(selected).map(alias => ({ ...alias })), tags: [...(selected.tags ?? [])], atoms: researchTermAtoms(selected).map(atom => ({ ...atom })) });
    setError("");
  };
  const updateDraftAtoms = (next: ResearchTermAtom[]) => setDraft(current => current ? { ...current, atoms: next.length ? next : undefined } : current);
  const addDraftAtom = () => {
    if (!draft) return;
    const current = draft.atoms ?? [];
    updateDraftAtoms([...current, { id: atomId(draft.id), text: "", meaning: "" }]);
  };
  const updateDraftAtom = (index: number, patch: Partial<ResearchTermAtom>) => {
    if (!draft) return;
    updateDraftAtoms((draft.atoms ?? []).map((atom, at) => at === index ? { ...atom, ...patch } : atom));
  };
  const removeDraftAtom = (index: number) => {
    if (!draft) return;
    updateDraftAtoms((draft.atoms ?? []).filter((_atom, at) => at !== index));
  };
  const updateDraftAliases = (aliases: ResearchTermAlias[]) => setDraft(current => current ? { ...current, aliases: aliases.map(alias => alias.name), aliasEntries: aliases } : current);
  const saveDraft = () => {
    if (!draft) return;
    const current = terms.find(entry => entry.id === draft.id);
    const issue = termEntryError(draft, terms);
    if (issue) { setError(issue); return; }
    const entry = createTermEntry(draft, draft.id);
    const next = current ? updateTermEntry(state, entry) : addTermEntry(state, entry);
    onChange({ ...next, activeTermId: draft.id, activeSymbolId: "" });
    setDraft(null);
    setError("");
  };
  const removeSelected = () => {
    if (!selected || uses.length) return;
    confirmDelete({ title: t("删除术语词条"), description: t`确定删除术语“${selected.name}”及其定义吗？` }, () => {
      const current = latestState.current;
      const next = deleteTermEntry(current, selected.id);
      onChange({ ...next, activeTermId: next.terms?.[0]?.id, activeSymbolId: "" });
    });
  };

  return <>
    {showSidebar && <aside id="research-term-dictionary-sidebar" className="research-dictionary-sidebar">
      <div className="research-dictionary-toolbar">
        <label className="research-dictionary-search"><Search size={14} /><input data-ui="search-input" aria-label={t("搜索术语词条")} value={filters.query} onChange={event => setFilters({ ...filters, query: event.target.value })} placeholder={t("搜索术语、别名或标签")} /></label>
        <label className="research-dictionary-tag-filter" data-active={!!filters.tag} title={filters.tag || t("筛选术语标签")}>
          <Filter size={14} aria-hidden="true" />
          <select aria-label={t("筛选术语标签")} value={filters.tag} onChange={event => setFilters({ ...filters, tag: event.target.value })}>
            <option value="">{t("全部标签")}</option>
            {availableTags.map(tag => <option key={tag.path} value={tag.path}>{"　".repeat(tag.depth)}{tag.path}</option>)}
          </select>
        </label>
        <button data-ui="icon-action" className="research-note-filter-button" aria-label={t("清除术语筛选")} title={t("清除术语筛选")} disabled={!filtering} onClick={() => setFilters({ query: "", tag: "" })}><FilterX size={14} /></button>
        {!showDetail && <button data-ui="icon-action" className="research-small-button" onClick={beginCreate} aria-label={t("新建术语词条")} title={t("新建术语词条")}><Plus size={14} /></button>}
        <ResearchTagTreeToolbar />
      </div>
      <div className="research-dictionary-list" role="list" aria-label={t("术语列表")}>
        <ResearchClassifiedList choices={choices} branches={tree} foldingItems={terms} selectedId={selected?.id ?? ""} activeTags={selected?.tags} navigation filtering={filtering} filterKey={JSON.stringify(filters)} storageKey="mewiki:research-term-tree-folds" label={t("筛选后的术语词条")}
          onSelect={choice => { onOpen(); setDraft(null); setConsistencyOpen(false); onChange({ ...state, view: "dictionary", activeTermId: choice.id, activeSymbolId: "" }); }}
          empty={<div className="research-note-no-results"><p>{t("没有匹配的术语词条")}</p><button data-ui="icon-action" className="research-small-button" aria-label={t("清除筛选")} title={t("清除筛选")} onClick={() => setFilters({ query: "", tag: "" })}><FilterX size={15} /></button></div>} />
      </div>
    </aside>}
    {showDetail && <div className="research-symbol-pane">
      <div className="research-symbol-definition-actions research-notebook-toolbar research-symbol-header" role="toolbar" aria-label={t("术语管理")}>
        <div className="research-note-header-leading">{pageControls}<div className="research-page-tags"><div className="research-note-tag-list" aria-label={t("术语标签")}>{(tagTarget?.tags ?? []).map(tag => <button type="button" className="research-note-tag" key={tag} onClick={() => setFilters({ query: "", tag })}>{tag}</button>)}</div></div></div>
        <h2 className="research-note-title research-symbol-title" title={title}>{title}</h2>
        <div className="research-note-header-actions"><div className="research-page-tools" role="toolbar" aria-label={t("术语词典功能")}><div className="research-page-tool-actions">
          <button data-ui="icon-action" className="research-small-button" onClick={beginCreate} aria-label={t("新建术语词条")} title={t("新建术语词条")}><Plus size={14} /></button>
          {selected && !draft && <button data-ui="icon-action" className="research-small-button" onClick={() => setConsistencyOpen(true)} aria-label={t("一致性检查")} title={t("一致性检查")}><ScanSearch size={14} /></button>}
          {draft ? <><button data-ui="icon-action" className="research-small-button" onClick={cancelDraft} aria-label={t("返回")} title={t("返回")}><ArrowLeft size={14} /></button><button data-ui="icon-action" className="research-small-button" onClick={saveDraft} aria-label={t("保存术语定义")} title={t("保存术语定义")}><Check size={14} /></button></> : selected && <><button data-ui="icon-action" className="research-small-button" onClick={beginEdit} aria-label={t("编辑术语")} title={t("编辑术语")}><Pencil size={13} /></button><button data-ui="icon-action" data-tone="danger" className="research-small-button is-danger" disabled={uses.length > 0} title={uses.length ? t("正文正在引用此术语") : t("删除术语词条")} onClick={removeSelected} aria-label={t("删除术语词条")}><Trash2 size={13} /></button></>}
        </div></div>{windowActions}</div>
      </div>
      <section className={`research-symbol-detail${draft ? " research-term-editing" : ""}`} aria-label={draft ? t("术语词条编辑器") : t("术语词条详情")}>
        {draft ? <div className="research-term-editor">
          <div className="research-term-editor-columns">
            <section className="research-term-editor-section" aria-labelledby="research-term-naming-heading">
              <div className="research-term-section-heading"><Languages size={18} aria-hidden="true" /><div><h3 id="research-term-naming-heading">{t("命名与引用")}</h3><p>{t("统一名称与写法，方便在笔记中引用。")}</p></div></div>
              <label className="research-term-field"><span className="research-term-field-label">{t("术语名称")}<span className="research-term-field-required">{t("必填")}</span></span><input className="research-term-name-input" aria-label={t("术语名称")} aria-required="true" value={draft.name} onChange={event => {
                const name = event.target.value;
                const nextAtoms = draft.atoms?.length === 1 && draft.atoms[0].text === draft.name ? [{ ...draft.atoms[0], text: name }] : draft.atoms;
                setDraft({ ...draft, name, ...(nextAtoms ? { atoms: nextAtoms } : {}) });
              }} placeholder={t("输入术语名称")} /></label>
              <div className="research-term-language-fields">
                <label className="research-term-field research-term-english-name">{t("英文名称")}<input aria-label={t("术语英文名称")} value={draft.englishName ?? ""} onChange={event => setDraft({ ...draft, englishName: event.target.value })} placeholder={t("例如：Mean squared error")} /></label>
                <label className="research-term-field">{t("英文缩写")}<input aria-label={t("术语英文缩写")} value={draft.englishAbbreviation ?? ""} onChange={event => setDraft({ ...draft, englishAbbreviation: event.target.value })} placeholder={t("例如：MSE")} /></label>
                <label className="research-term-field">{t("中文缩写")}<input aria-label={t("术语中文缩写")} value={draft.chineseAbbreviation ?? ""} onChange={event => setDraft({ ...draft, chineseAbbreviation: event.target.value })} placeholder={t("可留空")} /></label>
              </div>
              <div className="research-term-reference-preview"><span>{t("规范引用预览")}</span><output aria-label={t("规范引用预览")}>{draft.name.trim() ? formatTermReference(draft, { form: "full" }) : t("填写名称后显示引用预览")}</output></div>
              <section className="research-term-alias-editor" aria-label={t("术语别名")}>
                <div className="research-term-alias-heading"><h4>{t("别名")}</h4><button type="button" className="research-small-button research-term-add-button" onClick={() => updateDraftAliases([...(draft.aliasEntries ?? []), { id: `${draft.id}:alias:${crypto.randomUUID()}`, name: "" }])}><Plus size={14} aria-hidden="true" />{t("新增别名")}</button></div>
                <p>{t("每行保存一个别名，可填写中文别名或英文别称并单独引用；修改同一行后，已绑定的引用同步更新。")}</p>
                {draft.aliasEntries?.length ? <div className="research-term-alias-fields">{draft.aliasEntries.map((alias, index) => <div className="research-term-alias-row" key={alias.id}>
                  <input aria-label={t`别名 ${index + 1}`} value={alias.name} onChange={event => updateDraftAliases(draft.aliasEntries!.map(item => item.id === alias.id ? { ...item, name: event.target.value } : item))} placeholder={t("输入一个别名")} />
                  <button type="button" data-ui="icon-action" data-tone="danger" className="research-small-button" aria-label={t`删除别名 ${index + 1}`} title={t`删除别名 ${index + 1}`} onClick={() => updateDraftAliases(draft.aliasEntries!.filter(item => item.id !== alias.id))}><Trash2 size={14} /></button>
                </div>)}</div> : <p className="research-term-editor-empty">{t("尚无别名，可添加旧称或常见写法。")}</p>}
              </section>
            </section>
            <section className="research-term-editor-section" aria-labelledby="research-term-meaning-heading">
              <div className="research-term-section-heading"><AlignLeft size={18} aria-hidden="true" /><div><h3 id="research-term-meaning-heading">{t("含义与使用")}</h3><p>{t("说明概念与使用边界，让定义更清晰。")}</p></div></div>
              <label className="research-term-field"><span className="research-term-field-label">{t("术语含义")}<span className="research-term-field-required">{t("必填")}</span></span><textarea className="research-term-meaning-input" aria-label={t("术语含义")} aria-required="true" rows={6} value={draft.meaning} onChange={event => setDraft({ ...draft, meaning: event.target.value })} placeholder={t("解释这个术语的概念、定义或计算含义")} /></label>
              <label className="research-term-field">{t("适用范围")}<textarea className="research-term-scope-input" aria-label={t("术语适用范围")} rows={3} value={draft.scope ?? ""} onChange={event => setDraft({ ...draft, scope: event.target.value })} placeholder={t("说明使用场景、约束或与相近概念的区别，可留空")} /></label>
              <label className="research-term-field">{t("术语标签")}<input aria-label={t("术语标签")} value={(draft.tags ?? []).join("、")} onChange={event => setDraft({ ...draft, tags: tagsFromInput(event.target.value) })} placeholder={t("例如：模型/定义、写作/规范")} /></label>
            </section>
          </div>
          <section className="research-term-editor-section research-term-atom-editor" aria-labelledby="research-term-atom-editor-heading">
            <div className="research-term-atom-editor-heading"><div className="research-term-section-heading"><Atom size={18} aria-hidden="true" /><h3 id="research-term-atom-editor-heading">{t("术语组成")}</h3></div><button type="button" className="research-small-button research-term-add-button" onClick={addDraftAtom}><Plus size={14} aria-hidden="true" />{t("新增原子词汇")}</button></div>
            <p className="research-term-atom-hint">{t("原子词汇必须按术语名称顺序完整覆盖，片段不能重叠；每个原子词汇都需要单独解释。")}</p>
            {draft.atoms?.length ? <>
              <div className="research-term-atom-fields">{draft.atoms.map((atom, index) => <fieldset className="research-term-atom-field" key={atom.id}>
                <legend className="visually-hidden">{t`原子词汇 ${index + 1}`}</legend>
                <div className="research-term-atom-field-heading"><span className="research-term-atom-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><h4>{t`原子词汇 ${index + 1}`}</h4><button type="button" data-ui="icon-action" data-tone="danger" className="research-small-button" aria-label={t`删除原子词汇 ${index + 1}`} title={t`删除原子词汇 ${index + 1}`} onClick={() => removeDraftAtom(index)}><Trash2 size={14} /></button></div>
                <label className="research-term-field">{t("原子词汇名称")}<input aria-label={t`原子词汇 ${index + 1} 名称`} value={atom.text} onChange={event => updateDraftAtom(index, { text: event.target.value })} /></label>
                <label className="research-term-field">{t("原子词汇解释")}<textarea aria-label={t`原子词汇 ${index + 1} 解释`} rows={3} value={atom.meaning} onChange={event => updateDraftAtom(index, { meaning: event.target.value })} /></label>
              </fieldset>)}</div>
              <div className="research-term-atom-composition"><span>{t("当前组合")}</span><output aria-label={t("当前组合")}>{draft.atoms.map(atom => <span key={atom.id}>{atom.text || t("尚未填写")}</span>)}</output></div>
            </> : <p className="research-term-editor-empty">{t("未拆分时，整个术语作为一个原子词汇。")}</p>}
          </section>
          {error && <p className="research-symbol-error" role="alert">{localizeError(error)}</p>}
          <div className="research-term-editor-footer">
            <label className="research-term-status"><input type="checkbox" aria-label={t("标记为已废弃术语")} checked={draft.status === "deprecated"} onChange={event => setDraft({ ...draft, status: event.target.checked ? "deprecated" : "active" })} /><span>{t("标记为已废弃术语")}<small>{t("停用后仍保留词条与已有引用。")}</small></span></label>
            <div className="research-term-editor-actions"><button type="button" className="research-small-button" onClick={cancelDraft}>{t("取消编辑")}</button><button type="button" className="research-small-button research-term-save-button" onClick={saveDraft}><Check size={15} aria-hidden="true" />{t("保存词条")}</button></div>
          </div>
        </div> : selected ? <div className="research-term-detail">
          <ResearchTermDiagram key={selected.id} active={active} entry={selected} atoms={atoms} />
          <div className="research-term-definition"><h4>{t("术语整体含义")}</h4><p>{selected.meaning}</p></div>
          <dl>{selected.englishName && <><dt>{t("英文名称")}</dt><dd>{selected.englishName}</dd></>}{selected.englishAbbreviation && <><dt>{t("英文缩写")}</dt><dd>{selected.englishAbbreviation}</dd></>}{selected.chineseAbbreviation && <><dt>{t("中文缩写")}</dt><dd>{selected.chineseAbbreviation}</dd></>}{selected.aliases.length > 0 && <><dt>{t("别名")}</dt><dd><ul className="research-term-alias-list">{researchTermAliases(selected).map(alias => <li key={alias.id}>{alias.name}</li>)}</ul></dd></>}{selected.scope && <><dt>{t("适用范围")}</dt><dd className="research-term-scope">{selected.scope}</dd></>}{selected.tags?.length ? <><dt>{t("标签")}</dt><dd>{selected.tags.join("、")}</dd></> : null}{selected.status === "deprecated" && <><dt>{t("状态")}</dt><dd>{t("已废弃")}</dd></>}</dl>
          <span className="research-term-use-count">{uses.length ? t`已在 ${uses.length} 篇笔记中引用，修改名称后会自动同步显示。` : t("尚未在笔记中引用。")}</span>
        </div> : <p className="research-dictionary-empty">{t("选择或创建术语词条。")}</p>}
        {active && consistencyOpen && selected && <ResearchDictionaryConsistencyPanel kind="term" entry={selected} state={state} onChange={onChange} onClose={() => setConsistencyOpen(false)} />}
      </section>
    </div>}
  </>;
}
