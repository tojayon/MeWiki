import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { forwardRef, useContext, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject, type TextareaHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import { findResearchNoteMention, insertResearchNoteMention } from "../domain/researchNoteLinks.ts";
import { findResearchSymbolMention, insertResearchSymbolMention, searchResearchSymbols } from "../domain/researchSymbolMentions.ts";
import { findResearchTermMention, insertResearchTermMention, searchResearchTerms, formatTermReference, termReferenceFormats, type TermReferenceForm, type TermReferenceSelection } from "../domain/researchTerms.ts";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import type { ResearchNote } from "../domain/researchNotebook.ts";
import type { ResearchTermEntry } from "../domain/researchTerms.ts";
import { getNoteLibrary } from "../domain/researchNoteLibraries.ts";
import ResearchClassifiedList, { type ResearchChoiceListHandle } from "./ResearchClassifiedList.tsx";
import { researchNoteChoice, researchSymbolChoice, researchTermChoice, type ResearchChoice } from './researchChoices.ts';
import { termReferenceForms, termReferenceFormLabel } from "./researchTermReferenceForms.ts";
import "./ResearchNoteLinks.css";

export type TextMention = { kind: "note" | "term" | "symbol"; start: number; end: number; query: string };
export type MentionChoice = { kind: "note"; note: ResearchNote } | { kind: "term"; term: ResearchTermEntry } | { kind: "symbol"; symbol: ResearchSymbolEntry };

function caretAnchor(input: HTMLTextAreaElement) {
  const style = getComputedStyle(input), rect = input.getBoundingClientRect();
  const mirror = document.createElement("div");
  for (const key of ["boxSizing", "width", "font", "letterSpacing", "lineHeight", "padding", "border", "textIndent", "wordSpacing", "tabSize"] as const) mirror.style[key] = style[key];
  Object.assign(mirror.style, { position: "fixed", left: "0", top: "0", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement("span"); marker.textContent = "\u200b"; mirror.append(marker); document.body.append(mirror);
  const bounds = marker.getBoundingClientRect(); mirror.remove();
  return { left: Math.min(rect.right - 12, Math.max(rect.left, rect.left + bounds.left - input.scrollLeft)), top: rect.top + bounds.top - input.scrollTop, bottom: rect.top + bounds.bottom - input.scrollTop };
}

export function MentionPicker({ getAnchor, popupRef, kind, choices, total, active, listRef, onActiveChange, id, query, onQuery, onPick, onCancel, onKeyDown, onSessionBlur, onComposition }: {
  getAnchor: () => { left: number; top: number; bottom: number }; popupRef: RefObject<HTMLDivElement | null>;
  kind: TextMention["kind"]; choices: MentionChoice[]; total: number; active: string; id: string; query: string;
  listRef: RefObject<ResearchChoiceListHandle | null>; onActiveChange: (id: string) => void;
  onQuery: (query: string) => void; onPick: (choice: MentionChoice, selection?: TermReferenceSelection) => void; onCancel: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void; onSessionBlur: (event: FocusEvent<HTMLElement>) => void; onComposition: (active: boolean) => void;
}) {
  useLocale();
  const symbol = kind === "symbol";
  const term = kind === "term";
  const [termForm, setTermForm] = useState<TermReferenceForm>("name");
  const anchorRef = useRef(getAnchor);
  useLayoutEffect(() => { anchorRef.current = getAnchor; });
  const displayChoices: (ResearchChoice & { termSelection?: TermReferenceSelection })[] = choices.flatMap(choice => {
    if (choice.kind === "note") return [researchNoteChoice(choice.note)];
    if (choice.kind === "symbol") return [researchSymbolChoice(choice.symbol)];
    const base = researchTermChoice(choice.term);
    return termReferenceFormats(choice.term).filter(selection => selection.form === termForm).map(selection => ({
      ...base,
      id: selection.form === "alias" ? JSON.stringify([base.id, selection.aliasId]) : base.id,
      label: formatTermReference(choice.term, selection),
      detail: selection.form === "name" ? base.detail : [choice.term.name, choice.term.meaning].join(" · "),
      termSelection: selection,
    }));
  });
  useLayoutEffect(() => {
    const popup = popupRef.current!;
    popup.showPopover();
    const place = () => {
      const anchor = anchorRef.current(), bounds = popup.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      popup.style.maxHeight = `${Math.min(400, Math.max(80, height - 24))}px`;
      popup.style.left = Math.max(left + 8, Math.min(left + width - bounds.width - 8, anchor.left)) + "px";
      popup.style.top = Math.max(top + 8, Math.min(top + height - bounds.height - 8, anchor.bottom + bounds.height + 8 < top + height ? anchor.bottom + 6 : anchor.top - bounds.height - 6)) + "px";
    };
    place(); const observer = new ResizeObserver(place); observer.observe(popup);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place); window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place); window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [popupRef]);
  useLayoutEffect(() => { popupRef.current?.querySelector('.is-highlighted')?.scrollIntoView({ block: "nearest" }); }, [active, query, popupRef]);
  return <div ref={popupRef} id={id} popover="manual" className="research-note-mention-picker" role="dialog" aria-label={symbol ? t("插入词典符号") : term ? t("插入术语") : t("插入笔记引用")}
    onBlur={onSessionBlur}
    onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); if (!event.nativeEvent.isComposing) onCancel(); } }}
    onPointerDown={event => { if (!(event.target instanceof Element) || !event.target.closest("input, select, option")) event.preventDefault(); }}>
    <header><strong>{symbol ? t("插入词典符号") : term ? t("插入术语") : t("插入笔记")}</strong><button type="button" aria-label={symbol ? t("取消符号选择") : term ? t("取消术语选择") : t("取消笔记选择")} title={t("取消选择")} onClick={onCancel}><X size={14} /></button></header>
    <label className="research-mention-search"><Search size={14} aria-hidden="true" /><input type="search" data-ui="search-input" data-research-text-picker-search aria-label={symbol ? t("搜索符号") : term ? t("搜索术语") : t("搜索笔记")} placeholder={symbol ? t("搜索名称、LaTeX、含义或标签") : term ? t("搜索术语、英文、缩写、别名或标签") : t("搜索标题、标签或所属库")} value={query}
      aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active || undefined}
      onChange={event => onQuery(event.target.value)} onKeyDown={onKeyDown}
      onCompositionStart={() => onComposition(true)} onCompositionEnd={() => onComposition(false)} /></label>
    {term && <label className="research-term-mention-format"><span>{t("术语引用形式")}</span><select aria-label={t("术语引用形式")} value={termForm} onChange={event => setTermForm(event.target.value as TermReferenceForm)}>
      {termReferenceForms.map(form => <option key={form} value={form}>{termReferenceFormLabel(form)}</option>)}
    </select></label>}
    <ResearchClassifiedList choices={displayChoices} filterKey={JSON.stringify([query, termForm])}
      className="research-mention-options" listId={`${id}-list`} listRef={listRef} query={query} label={symbol ? t("选择要插入的符号") : term ? t("选择要插入的术语") : t("选择要引用的笔记")}
      storageKey={`mewiki:mention-${kind}-folds`} onActiveChange={onActiveChange}
      onSelect={choice => onPick(choice.note ? { kind: 'note', note: choice.note } : choice.term ? { kind: 'term', term: choice.term } : { kind: 'symbol', symbol: choice.symbol! }, displayChoices.find(item => item.id === choice.id)?.termSelection)}
      empty={t`${symbol ? t('没有匹配的符号') : term ? t('没有匹配的术语') : t('没有匹配的笔记')}，可调整搜索词或按 Escape 取消。`} />
    <footer>{total > choices.length ? t`显示前 ${choices.length} 项，共 ${total} 项 · 可继续搜索` : t("↑↓ 选择 · Enter 插入 · Esc 取消")}{symbol && <span>{t("按词典默认角标插入行内公式")}</span>}</footer>
  </div>;
}

const ResearchMentionTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function ResearchMentionTextarea(props, forwardedRef) {
  useLocale();
  const context = useContext(ResearchNoteLinkContext);
  const input = useRef<HTMLTextAreaElement>(null), popup = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => input.current!);
  const composing = useRef(false), searchComposing = useRef(false);
  const compositionFrame = useRef<number | null>(null);
  const cancelCompositionUpdate = () => {
    if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current);
    compositionFrame.current = null;
  };
  useLayoutEffect(() => () => {
    if (compositionFrame.current !== null) cancelAnimationFrame(compositionFrame.current);
  }, []);
  const dismissed = useRef<{ text: string; caret: number } | null>(null);
  const [mention, setMention] = useState<TextMention | null>(null);
  const [active, setActive] = useState(''), [search, setSearch] = useState("");
  const choicesRef = useRef<ResearchChoiceListHandle>(null);
  const id = useId();
  const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const allChoices: MentionChoice[] = !mention ? [] : mention.kind === "symbol"
    ? searchResearchSymbols(context?.symbols ?? [], search).map(symbol => ({ kind: "symbol", symbol }))
    : mention.kind === "term" ? searchResearchTerms(context?.terms ?? [], search).map(term => ({ kind: "term", term }))
    : context?.notes.filter(note => note.id !== context.sourceNoteId && tokens.every(token => [note.title, ...(note.tags ?? []), getNoteLibrary(note) === "foundation" ? t("基础理论") : t("研究记录")].join(" ").toLocaleLowerCase().includes(token))).map(note => ({ kind: "note", note })) ?? [];
  const choices = allChoices;
  const findMention = (element: HTMLTextAreaElement): TextMention | null => {
    if (!context) return null;
    const detectors = [
      ["note", findResearchNoteMention], ["term", findResearchTermMention], ["symbol", findResearchSymbolMention],
    ] as const;
    let latest: TextMention | null = null;
    for (const [kind, detect] of detectors) {
      const found = detect(element.value, element.selectionStart);
      if (found && (!latest || found.start > latest.start)) latest = { ...found, kind };
    }
    return latest;
  };
  const update = (element: HTMLTextAreaElement) => {
    if (popup.current?.contains(document.activeElement)) return;
    if (dismissed.current?.text === element.value && dismissed.current.caret === element.selectionStart) { setMention(null); return; }
    dismissed.current = null;
    if (!context || composing.current || compositionFrame.current !== null || props.readOnly || props.disabled || element.selectionStart !== element.selectionEnd) { setMention(null); return; }
    const next = findMention(element);
    if (next?.start !== mention?.start || next?.end !== mention?.end || next?.query !== mention?.query || next?.kind !== mention?.kind) {
      setMention(next); setSearch(next?.query ?? ""); setActive('');
    }
  };
  const cancel = () => {
    const element = input.current;
    if (element) dismissed.current = { text: element.value, caret: element.selectionStart };
    setMention(null); searchComposing.current = false;
    element?.focus({ preventScroll: true });
  };
  const pick = (choice: MentionChoice, selection?: TermReferenceSelection) => {
    const element = input.current;
    if (!element || !mention || props.readOnly || props.disabled) return;
    const current = findMention(element);
    if (!current || current.start !== mention.start || current.end !== mention.end || current.kind !== mention.kind) { cancel(); return; }
    const result = choice.kind === "note" ? { ...insertResearchNoteMention(element.value, current, choice.note), end: current.end } : choice.kind === "term" ? { ...insertResearchTermMention(element.value, current, choice.term, selection), end: current.end } : insertResearchSymbolMention(element.value, current, choice.symbol);
    dismissed.current = { text: result.text, caret: result.caret };
    element.setRangeText(result.text.slice(current.start, result.caret), current.start, result.end, "end");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    setMention(null); searchComposing.current = false;
    element.focus({ preventScroll: true }); element.setSelectionRange(result.caret, result.caret);
  };
  const mentionKeys = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!mention || event.nativeEvent.isComposing || composing.current || searchComposing.current || event.keyCode === 229) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation(); choicesRef.current?.move(event.key); return true;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return true; }
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choicesRef.current?.pick(); return true; }
    return false;
  };
  const sessionBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.relatedTarget === input.current || popup.current?.contains(event.relatedTarget)) return;
    setMention(null); searchComposing.current = false;
    // Leaving the whole picker/editor session must reach the source textarea's existing save handler.
    input.current?.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, relatedTarget: event.relatedTarget }));
  };
  return <><textarea {...props} ref={input}
    aria-controls={mention ? `${id}-list` : undefined} aria-expanded={mention ? true : undefined} aria-autocomplete={context ? "list" : undefined} aria-activedescendant={mention && active ? active : undefined}
    onInput={event => {
      props.onInput?.(event);
      if ((event.nativeEvent as InputEvent).isComposing) { setMention(null); return; }
      cancelCompositionUpdate(); update(event.currentTarget);
    }}
    onSelect={event => { props.onSelect?.(event); update(event.currentTarget); }}
    onBlur={event => { if (popup.current?.contains(event.relatedTarget)) return; cancelCompositionUpdate(); setMention(null); props.onBlur?.(event); }}
    onCompositionStart={event => { cancelCompositionUpdate(); composing.current = true; setMention(null); props.onCompositionStart?.(event); }}
    onCompositionEnd={event => {
      composing.current = false; props.onCompositionEnd?.(event);
      const element = event.currentTarget;
      cancelCompositionUpdate();
      // IMEs commit before or after compositionend. The final input handles the latter;
      // a frame reads committed text for the former without inspecting transient candidates.
      compositionFrame.current = requestAnimationFrame(() => {
        compositionFrame.current = null;
        if (input.current === element && document.activeElement === element) update(element);
      });
    }}
    onKeyDown={event => {
      if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.stopPropagation(); return; }
      if (mention && event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); popup.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); return; }
      if (!mentionKeys(event)) props.onKeyDown?.(event);
    }}
  />{mention && <MentionPicker key={id + mention.kind} id={id} getAnchor={() => caretAnchor(input.current!)} popupRef={popup} kind={mention.kind} choices={choices} total={allChoices.length} active={active} listRef={choicesRef} onActiveChange={setActive} query={search}
    onQuery={query => { setSearch(query); setActive(''); }} onPick={pick} onCancel={cancel} onKeyDown={mentionKeys} onSessionBlur={sessionBlur} onComposition={active => { searchComposing.current = active; }} />}</>;
});
export default ResearchMentionTextarea;
