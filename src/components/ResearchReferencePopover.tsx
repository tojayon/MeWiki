import { useContext, useMemo, useRef, useState } from "react";
import type { Node as EditorNode } from "prosemirror-model";
import { BookOpen, ExternalLink, Trash2, X } from "lucide-react";
import { t, translate, localizeError } from "../i18n/locale.ts";
import { useLocale } from "../i18n/react.ts";
import { dictionaryReferenceBindings, dictionaryReferenceId, formatTermReference, termReferenceMarkdown, termReferenceSelection } from "../domain/researchTerms.ts";
import { resolveSymbolEntry } from "../domain/researchDictionary.ts";
import { researchNoteLinkId, researchNoteLinkMarkdown } from "../domain/researchNoteLinks.ts";
import { flattenResearchBlocks } from "../domain/researchBlockTree.ts";
import { editedResearchSymbolReference, referenceAssetPattern, researchReferenceTokens } from "../domain/researchReferenceEditor.ts";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import ResearchSelectionField from "./ResearchSelectionField.tsx";
import { researchNoteChoice, researchSymbolChoice, researchTermChoice, type ResearchChoice } from "./researchChoices.ts";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import { useResearchMediaSource } from "./useResearchMediaSource.ts";
import { ResearchMediaInlineLink } from "./ResearchMediaInline.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import { termReferenceFormOptions, termReferenceOptionValue } from "./researchTermReferenceForms.ts";

function FileSource({ href }: { href: string }) {
  const match = referenceAssetPattern.exec(href);
  const view = useResearchMediaSource(match ? { type: "asset", assetId: match[1] } : undefined);
  return <div className="research-reference-file-source"><p>{view.asset?.name ?? (view.loading ? t("正在读取") : t("附件未找到"))}</p>
    {view.error && <p role="status">{localizeError(view.error)}</p>}
    <ResearchMediaInlineLink href={href}>{t("打开引用来源")}</ResearchMediaInlineLink></div>;
}

export default function ResearchReferencePopover({ node, target, onApply, onDelete, onCancel }: {
  node: EditorNode; target: HTMLElement; onApply: (source: string) => void; onDelete: () => void; onCancel: (restore?: boolean) => void;
}) {
  const locale = useLocale();
  const context = useContext(ResearchNoteLinkContext), ref = useRef<HTMLDivElement>(null), triggerRef = useRef(target);
  const kind = node.attrs.kind as "term" | "symbol" | "note" | "file", href = String(node.attrs.href);
  const originalId = kind === "note" ? researchNoteLinkId(href) ?? "" : kind === "file" ? referenceAssetPattern.exec(href)?.[1] ?? "" : dictionaryReferenceId(href) ?? "";
  const originalPage = referenceAssetPattern.exec(href)?.[2] ?? "";
  const [selected, setSelected] = useState(originalId), [form, setForm] = useState(() => JSON.stringify(termReferenceSelection(href)));
  const [bindings, setBindings] = useState(() => dictionaryReferenceBindings(href));
  const [page, setPage] = useState(originalPage);
  const term = context?.terms.find(item => item.id === selected), symbol = context?.symbols.find(item => item.id === selected), note = context?.notes.find(item => item.id === selected);
  const files = useMemo(() => {
    const result = new Map<string, ResearchChoice>();
    if (kind !== "file") return result;
    for (const owner of context?.notes ?? []) for (const block of flattenResearchBlocks(owner.blocks)) {
      if (block.type === "media" && block.source?.type === "asset") result.set(block.source.assetId, { id: block.source.assetId, label: block.caption || block.alt || owner.title || translate("附件", [], locale), searchText: [owner.title, block.caption, block.alt].join(" "), tags: owner.tags });
      const texts = "text" in block && typeof block.text === "string" ? [block.text] : block.type === "list" ? block.items : [];
      for (const text of texts) for (const token of researchReferenceTokens(text)) {
        if (token.kind !== "file") continue;
        const assetId = referenceAssetPattern.exec(token.href)![1];
        if (!result.has(assetId)) result.set(assetId, { id: assetId, label: token.label, searchText: [owner.title, token.label].join(" "), tags: owner.tags });
      }
    }
    if (!result.has(originalId)) result.set(originalId, { id: originalId, label: String(node.attrs.label), searchText: String(node.attrs.label) });
    return result;
  }, [context?.notes, kind, originalId, node.attrs.label, locale]);
  const choices = kind === "term" ? (context?.terms ?? []).map(researchTermChoice) : kind === "symbol" ? (context?.symbols ?? []).map(researchSymbolChoice) : kind === "note" ? (context?.notes ?? []).filter(item => item.id !== context?.sourceNoteId).map(item => researchNoteChoice(item)) : [...files.values()];
  const formats = term ? termReferenceFormOptions(term) : [];
  const selectedForm = formats.find(item => JSON.stringify(item.selection) === form)?.selection ?? { form: "name" as const };
  const selectedHref = kind === "file" ? `webbench-asset:${selected}${page ? `#page=${page}` : ""}` : href;
  const validPage = !page || /^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page));
  const canApply = kind === "term" ? !!term : kind === "symbol" ? !!symbol : kind === "note" ? !!note : !!selected && validPage;
  const apply = () => {
    if (!canApply) return;
    if (kind === "term" && term) onApply(termReferenceMarkdown(term, selectedForm));
    else if (kind === "symbol" && symbol) {
      onApply(editedResearchSymbolReference(symbol, bindings));
    } else if (kind === "note" && note) onApply(researchNoteLinkMarkdown(note));
    else {
      let label = selected === originalId ? String(node.attrs.label) : files.get(selected)?.label ?? String(node.attrs.label);
      if (selected !== originalId || page !== originalPage) {
        label = label.replace(/(?:\s*·\s*)?(?:第\s*\d+\s*页|\bPage\s+\d+)$/i, "").trimEnd() || t("附件");
        if (page) label += t` · 第 ${page} 页`;
      }
      onApply(`[${label.replace(/[\\[\]]/g, "\\$&")}](${selectedHref})`);
    }
  };
  useFormulaPopover({ ref, triggerRef, getAnchor: () => target.getBoundingClientRect(), onCancel: (restore = false) => {
    // A nested classified picker is part of this editing session.
    if (!restore && document.querySelector('.research-selection-popup:popover-open, .research-media-preview-dialog')) return;
    onCancel(restore);
  } });
  return <div ref={ref} className="research-reference-popover" role="dialog" aria-label={t("编辑引用")} popover="manual"
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <header><strong>{t("编辑引用")}</strong><button type="button" data-ui="icon-action" aria-label={t("关闭引用编辑")} onClick={() => onCancel(true)}><X size={15} /></button></header>
    <div className="research-reference-popover-body">
      <label className="research-reference-field"><span>{t("引用来源")}</span><ResearchSelectionField label={t("更换引用来源")} choices={choices} value={selected} storageKey={`mewiki:reference-${kind}-folds`} onChange={id => { if (id !== selected) setBindings({}); setSelected(id); }} /></label>
      {kind === "term" && term && <>
        <p className="research-reference-description"><ResearchMathText text={term.meaning} /></p>
        {term.atoms?.map(atom => <p className="research-reference-atom-description" key={atom.id}><strong>{atom.text}</strong>{atom.meaning}</p>)}
        <label className="research-reference-field"><span>{t("术语引用形式")}</span><select aria-label={t("术语引用形式")} value={termReferenceOptionValue(selectedForm)} onChange={event => {
          const next = formats.find(item => item.value === event.target.value); if (next && !next.disabled) setForm(JSON.stringify(next.selection));
        }}>{formats.map(item => <option key={item.value} value={item.value} disabled={item.disabled}>{item.label}</option>)}</select></label>
        <p className="research-reference-preview" aria-label={t("本次引用预览")}>{formatTermReference(term, selectedForm)}</p>
        <p className="research-reference-description">{t("不同位置可引用同一术语并分别选择显示形式；缺少的名称请在词典中填写。")}</p>
      </>}
      {kind === "symbol" && symbol && <><p className="research-reference-description"><ResearchMathText text={symbol.meaning} /></p>
        {symbol.slots.map(slot => <label className="research-reference-field" key={slot.key}><span>{slot.label}{slot.description ? ` · ${slot.description}` : ""}</span><input aria-label={t`本次引用：${slot.label}`} value={bindings[slot.key] ?? slot.defaultValue} onChange={event => setBindings(previous => ({ ...previous, [slot.key]: event.target.value }))} /></label>)}
        <p className="research-reference-preview"><ResearchMathText text={`$${resolveSymbolEntry(symbol, { ...Object.fromEntries(symbol.slots.map(slot => [slot.key, slot.defaultValue])), ...bindings }).tex}$`} /></p>
      </>}
      {kind === "note" && note && <p className="research-reference-description">{note.title}</p>}
      {kind === "file" && <><label className="research-reference-field"><span>{t("PDF 页码（可选）")}</span><input aria-label={t("PDF 页码（可选）")} type="number" min="1" step="1" value={page} aria-invalid={!validPage || undefined} onChange={event => setPage(event.target.value)} /></label><FileSource href={selectedHref} /></>}
      {kind !== "file" && !canApply && <p role="status">{t("引用来源已移除")}</p>}
      {(kind === "term" && term || kind === "symbol" && symbol) && <button type="button" className="research-reference-source-action" onClick={() => { onCancel(); window.dispatchEvent(new CustomEvent("research-dictionary-open", { detail: { kind, id: selected } })); }}><BookOpen size={14} />{t("打开词典词条")}</button>}
      {kind === "note" && note && <button type="button" className="research-reference-source-action" onClick={() => { onCancel(); context?.openNote(note.id); }}><ExternalLink size={14} />{t("打开引用来源")}</button>}
    </div>
    <footer><button type="button" className="research-reference-remove" onClick={onDelete}><Trash2 size={14} />{t("删除此引用")}</button><span /><button type="button" onClick={() => onCancel(true)}>{t("取消")}</button><button type="button" className="is-primary" disabled={!canApply} onClick={apply}>{t("应用引用修改")}</button></footer>
  </div>;
}
