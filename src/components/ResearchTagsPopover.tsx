import { useLocale } from "../i18n/react.ts";
import {t, localizeError } from "../i18n/locale.ts";
import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { normalizeResearchTags, type getResearchTagTree } from "../domain/researchTags.ts";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import "./ResearchNoteManagement.css";

export default function ResearchTagsPopover({ noun, assigned, tree, onAdd, onRemove, trigger, getTrigger, onClose }: {
  noun: "笔记" | "符号";
  assigned: string[];
  tree: ReturnType<typeof getResearchTagTree>;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  trigger: HTMLButtonElement;
  getTrigger?: () => HTMLButtonElement;
  onClose: (restoreFocus?: boolean) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const listId = useId();
  const has = (path: string) => assigned.some(tag => tag.toLocaleLowerCase() === path.toLocaleLowerCase());
  const add = (value: string) => {
    const tag = normalizeResearchTags([value])[0];
    if (!tag) { setMessage("请输入标签名称，用 / 分隔层级。"); return; }
    const existing = tree.find(item => item.path.toLocaleLowerCase() === tag.toLocaleLowerCase())?.path ?? tag;
    if (has(existing)) { setMessage("此标签已添加。"); return; }
    onAdd(existing);
    setDraft("");
    setMessage("");
    ref.current?.querySelector("input")?.focus();
  };
  useFormulaPopover({ ref, triggerRef, getAnchor: () => {
    triggerRef.current = getTrigger?.() ?? trigger;
    return triggerRef.current.getBoundingClientRect();
  }, onCancel: onClose });
  return <div ref={ref} popover="manual" className="research-note-management-popover research-note-tags-popover" role="dialog" aria-label={t`管理${t(noun)}标签`}>
    <header><strong>{t("层级标签")}</strong><button data-ui="icon-action" aria-label={t("关闭标签管理")} onClick={() => onClose(true)} title={t("关闭标签管理")}><X size={14} /></button></header>
    <p>{t("用 / 分隔层级，例如 模型/控制/LQR；")}{noun === "笔记" ? t("一篇笔记") : t("一个符号")}{t("可关联多个标签。")}</p>
    <form className="research-note-tag-form" onSubmit={event => { event.preventDefault(); add(draft); }}>
      <input aria-label={t("新增层级标签")} placeholder={t("模型/控制/LQR")} value={draft} list={listId} onChange={event => { setDraft(event.target.value); setMessage(""); }} />
      <datalist id={listId}>{tree.map(tag => <option key={tag.path} value={tag.path} />)}</datalist>
      <button data-ui="icon-action" className="research-small-button" type="submit" aria-label={t`添加${t(noun)}标签`} disabled={!draft.trim()} title={t`添加${t(noun)}标签`}><Plus size={15} /></button>
    </form>
    {message && <p role="status">{localizeError(message)}</p>}
    <div className="research-note-assigned-tags" aria-label={t`当前${t(noun)}标签`}>
      {assigned.map(tag => <span className="research-note-tag" key={tag}><span>{tag}</span><button data-ui="icon-action" aria-label={t`移除标签 ${tag}`} title={t("移除此标签")} onClick={() => onRemove(tag)}><X size={12} /></button></span>)}
      {!assigned.length && <p>{t("尚未添加标签。")}</p>}
    </div>
    {tree.some(tag => !has(tag.path)) && <><strong className="research-note-tag-suggestions-heading">{t("复用已有标签")}</strong>
      <div className="research-note-tag-suggestions">{tree.filter(tag => !has(tag.path) && tag.path.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase())).slice(0, 12).map(tag => <button key={tag.path} onClick={() => add(tag.path)}><span>{tag.path}</span><small>{tag.count}</small></button>)}</div>
    </>}
  </div>;
}
