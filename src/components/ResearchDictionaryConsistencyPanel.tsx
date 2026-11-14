import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { Link2, RefreshCw, ScanSearch, X } from "lucide-react";
import { flattenResearchBlocks, findResearchBlock, updateResearchBlockTree } from "../domain/researchBlockTree.ts";
import { resolveSymbolEntry, type ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import { updateResearchNote, type ResearchNotebookBlock, type ResearchNotebookState } from "../domain/researchNotebook.ts";
import {
  dictionaryReferenceMarkdown,
  replaceResearchDictionaryText,
  scanResearchDictionaryText,
  type DictionaryReferenceKind,
  type ResearchDictionaryTextHit,
  type ResearchTermEntry,
} from "../domain/researchTerms.ts";
import "./ResearchDictionary.css";
import UiInfo from './UiInfo.tsx';

type DictionaryEntry = ResearchSymbolEntry | ResearchTermEntry;
type DictionaryTextField = "text" | "callout-title" | "note" | "list";

interface DictionaryTextTarget {
  key: string;
  noteId: string;
  noteTitle: string;
  blockId: string;
  field: DictionaryTextField;
  listIndex?: number;
  text: string;
}

type DictionaryHit = ResearchDictionaryTextHit & DictionaryTextTarget;

function collectTextTargets(state: ResearchNotebookState): DictionaryTextTarget[] {
  const targets: DictionaryTextTarget[] = [];
  for (const note of state.notes) for (const block of flattenResearchBlocks(note.blocks)) {
    const base = { noteId: note.id, noteTitle: note.title };
    if (block.type === "paragraph" || block.type === "heading" || block.type === "markdown")
      targets.push({ ...base, key: `${note.id}:${block.id}:text`, blockId: block.id, field: "text", text: block.text });
    else if (block.type === "callout") {
      targets.push({ ...base, key: `${note.id}:${block.id}:title`, blockId: block.id, field: "callout-title", text: block.title });
      targets.push({ ...base, key: `${note.id}:${block.id}:text`, blockId: block.id, field: "text", text: block.text });
    } else if (block.type === "list") {
      block.items.forEach((text, listIndex) => targets.push({ ...base, key: `${note.id}:${block.id}:list:${listIndex}`, blockId: block.id, field: "list", listIndex, text }));
    } else if ((block.type === "evidence" || block.type === "external") && block.note) {
      targets.push({ ...base, key: `${note.id}:${block.id}:note`, blockId: block.id, field: "note", text: block.note });
    }
  }
  return targets;
}

function readTargetText(block: ResearchNotebookBlock, target: Pick<DictionaryTextTarget, "field" | "listIndex">) {
  if (target.field === "list" && block.type === "list") return block.items[target.listIndex ?? -1] ?? "";
  if (target.field === "callout-title" && block.type === "callout") return block.title;
  if (target.field === "note" && (block.type === "evidence" || block.type === "external")) return block.note ?? "";
  if (target.field === "text" && (block.type === "paragraph" || block.type === "heading" || block.type === "markdown" || block.type === "callout")) return block.text;
  return "";
}

function replaceTargetText(state: ResearchNotebookState, target: DictionaryTextTarget, hit: ResearchDictionaryTextHit, replacement: string) {
  const note = state.notes.find(item => item.id === target.noteId);
  const location = note && findResearchBlock(note.blocks, target.blockId);
  if (!note || !location) return state;
  const source = readTargetText(location.block, target);
  const currentHit = source.slice(hit.start, hit.end) === hit.matchedText
    ? hit
    : scanResearchDictionaryText(source, state.symbols, state.terms ?? []).find(item => item.kind === hit.kind && item.entryId === hit.entryId && item.matchedText === hit.matchedText);
  if (!currentHit) return state;
  const nextText = replaceResearchDictionaryText(source, currentHit, replacement);
  if (nextText === source) return state;
  return updateResearchNote(state, target.noteId, {
    blocks: updateResearchBlockTree(note.blocks, target.blockId, block => {
      if (target.field === "list" && block.type === "list" && target.listIndex !== undefined)
        return { ...block, items: block.items.map((item, index) => index === target.listIndex ? nextText : item) };
      if (target.field === "callout-title" && block.type === "callout") return { ...block, title: nextText };
      if (target.field === "note" && (block.type === "evidence" || block.type === "external")) return { ...block, note: nextText };
      if (target.field === "text" && (block.type === "paragraph" || block.type === "heading" || block.type === "markdown" || block.type === "callout")) return { ...block, text: nextText };
      return block;
    }),
  });
}

function renderContext(context: string, matchedText: string) {
  const index = context.toLocaleLowerCase().indexOf(matchedText.toLocaleLowerCase());
  if (index < 0) return context;
  return <>{context.slice(0, index)}<mark>{context.slice(index, index + matchedText.length)}</mark>{context.slice(index + matchedText.length)}</>;
}

export default function ResearchDictionaryConsistencyPanel({ kind, entry, state, onChange, onClose }: {
  kind: DictionaryReferenceKind;
  entry: DictionaryEntry;
  state: ResearchNotebookState;
  onChange: (next: ResearchNotebookState) => void;
  onClose: () => void;
}) {
  useLocale();
  const targets = collectTextTargets(state);
  const hits: DictionaryHit[] = targets.flatMap(target => scanResearchDictionaryText(target.text, state.symbols, state.terms ?? [])
    .filter(hit => hit.kind === kind && hit.entryId === entry.id)
    .map(hit => ({ ...hit, ...target })));
  const defaults = kind === "symbol" && "slots" in entry ? Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue])) : {};
  const boundLabel = kind === "symbol" && "slots" in entry
    ? `$${resolveSymbolEntry(entry, defaults).tex}$`
    : entry.name;
  const apply = (hit: DictionaryHit, mode: "bind" | "replace") => {
    const replacement = mode === "bind"
      ? dictionaryReferenceMarkdown(kind, entry, boundLabel, defaults)
      : entry.name;
    onChange(replaceTargetText(state, hit, hit, replacement));
  };
  return <section className="research-dictionary-consistency" aria-label={t("一致性检查")}>
    <header className="research-dictionary-consistency-header">
      <div><ScanSearch size={15} aria-hidden="true" /><strong>{t("一致性检查")}</strong><span>{hits.length}</span><UiInfo label={t('一致性检查说明')}><p>{t("扫描正文中的名称、别名、英文名称和缩写；代码、链接、数学公式与 URL 会自动跳过。绑定后按词典名称显示，替换只修改当前文字。")}</p></UiInfo></div>
      <button type="button" data-ui="icon-action" className="research-small-button" aria-label={t("关闭一致性检查")} title={t("关闭一致性检查")} onClick={onClose}><X size={14} /></button>
    </header>
    {hits.length ? <ul className="research-dictionary-consistency-list">
      {hits.map(hit => <li key={`${hit.key}:${hit.start}:${hit.end}`} className="research-dictionary-consistency-hit">
        <div className="research-dictionary-consistency-context">{renderContext(hit.context, hit.matchedText)}</div>
        <div className="research-dictionary-consistency-meta"><span>{hit.noteTitle || t("未命名笔记")}</span><span>{hit.matchedText}</span></div>
        <div className="research-dictionary-consistency-actions">
          <button type="button" className="research-small-button" onClick={() => apply(hit, "bind")}><Link2 size={13} />{t("绑定这处文本")}</button>
          <button type="button" className="research-small-button" onClick={() => apply(hit, "replace")}><RefreshCw size={13} />{t("替换这处文本")}</button>
        </div>
      </li>)}
    </ul> : <p className="research-dictionary-consistency-empty">{t("没有发现需要处理的旧名称或别名。")}</p>}
  </section>;
}
