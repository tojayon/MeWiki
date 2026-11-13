import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { isPlainResearchText } from "../domain/researchMarkdown.ts";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import ResearchTableBlock from "./ResearchTableBlock.tsx";
import { parseResearchTable } from "../domain/researchTable.ts";
import type { ResearchOutlineHeading } from "../domain/researchOutline.ts";
import ResearchMentionTextarea from "./ResearchMentionTextarea.tsx";
import ResearchReferenceEditor, { type ResearchReferenceEditorHandle } from "./ResearchReferenceEditor.tsx";
import { researchTextEditorState } from "../domain/researchTextPlaceholders.ts";
import { continueResearchMarkdownLine, researchListEditorSource } from "../domain/researchMarkdownEditing.ts";

interface TextBlockProps {
  value: string;
  label: string;
  readOnly?: boolean;
  kind?: string;
  placeholder?: string;
  headings?: readonly ResearchOutlineHeading[];
  onChange: (text: string, focusOnCancel?: HTMLElement) => boolean | void;
  onComplete?: () => void;
}

export default function ResearchTextBlock(props: TextBlockProps) {
  useLocale();
  const value = props.readOnly ? props.value : researchTextEditorState(props.value, props.kind).source;
  const table = useMemo(() => props.kind !== "list" && !props.readOnly && value.includes("|") ? parseResearchTable(value) : null, [props.kind, props.readOnly, value]);
  return table ? <ResearchTableBlock value={value} model={table} label={props.label} headings={props.headings} onChange={props.onChange} onComplete={props.onComplete} /> : <SourceTextBlock {...props} />;
}

function SourceTextBlock({ value, label, readOnly = false, kind = "paragraph", placeholder, headings, onChange, onComplete }: TextBlockProps) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const ref = useRef<ResearchReferenceEditorHandle>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const pendingReference = useRef<{ href: string; occurrence: number } | null>(null);
  const composing = useRef(false);
  const draft = researchTextEditorState(value, kind);
  const source = readOnly ? value : draft.source;
  const editorSource = kind === "list" ? researchListEditorSource(source) : source;
  const hint = placeholder ?? draft.placeholder;
  const initialSource = useRef(editorSource);
  const plainText = useMemo(() => kind !== "list" && isPlainResearchText(source), [kind, source]);
  const rendered = !readOnly && draft.empty && hint ? <p><span className="research-text-placeholder">{hint}</span></p> : kind === "list" ? <ul className="research-note-read-list">
    {source.split("\n").map((item, index) => <li key={index}><ResearchMathText text={item} /></li>)}
  </ul> : plainText ? <p>{source}</p> : <ResearchMarkdown text={source} headings={headings} />;
  useLayoutEffect(() => {
    const input = kind === "code" ? codeRef.current : ref.current;
    if (!editing || !input) return;
    initialSource.current = input.value;
    input.focus({ preventScroll: true });
    const caret = researchTextEditorState(input.value, kind).caret;
    input.setSelectionRange(caret, caret);
    if (kind !== "code" && pendingReference.current) {
      ref.current?.inspectReference(pendingReference.current.href, pendingReference.current.occurrence);
      pendingReference.current = null;
    }
  }, [editing, kind]);

  const save = (input: ResearchReferenceEditorHandle | HTMLTextAreaElement) => {
    const text = input.value.replace(/\r\n?/g, "\n");
    if (text === initialSource.current) return true;
    initialSource.current = text;
    const element = "element" in input ? input.element : input;
    return onChange(text, element.parentElement ?? undefined) !== false;
  };

  const handleKeys = (event: KeyboardEvent, input: ResearchReferenceEditorHandle | HTMLTextAreaElement) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!event.isComposing && !composing.current) input.blur();
      return;
    }
    if (event.key !== "Enter" || event.isComposing || composing.current || event.keyCode === 229 || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && onComplete) {
      event.preventDefault(); event.stopPropagation();
      const accepted = save(input);
      setEditing(false);
      if (accepted) onComplete();
    } else if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const next = continueResearchMarkdownLine(input.value, input.selectionStart, input.selectionEnd, kind);
      if (!next) return;
      event.preventDefault(); event.stopPropagation();
      let start = 0, end = input.value.length, nextEnd = next.text.length;
      while (start < end && start < nextEnd && input.value[start] === next.text[start]) start++;
      while (end > start && nextEnd > start && input.value[end - 1] === next.text[nextEnd - 1]) { end--; nextEnd--; }
      if ("replaceRange" in input) input.replaceRange(next.text.slice(start, nextEnd), start, end, next.caret);
      else {
        input.setSelectionRange(start, end);
        if (!document.execCommand("insertText", false, next.text.slice(start, nextEnd))) {
          input.setRangeText(next.text.slice(start, nextEnd), start, end, "end");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        input.setSelectionRange(next.caret, next.caret);
      }
    }
  };

  if (readOnly) return <div className="research-markdown research-read-text" data-kind={kind} data-plain-text={plainText}>{rendered}</div>;
  return <div className="research-editable-text research-markdown" data-kind={kind} data-plain-text={plainText}
    role={editing ? undefined : "textbox"} aria-label={editing ? undefined : label} aria-multiline={editing ? undefined : true} tabIndex={editing ? undefined : 0}
    onClickCapture={event => {
      if (editing || kind === "code" || !(event.target instanceof Element)) return;
      const reference = event.target.closest<HTMLElement>("[data-reference-href]");
      if (!reference?.dataset.referenceHref) return;
      event.preventDefault(); event.stopPropagation();
      const matching = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-reference-href]")].filter(element => element.dataset.referenceHref === reference.dataset.referenceHref);
      pendingReference.current = { href: reference.dataset.referenceHref, occurrence: matching.indexOf(reference) };
      setEditing(true);
    }}
    onPointerDown={(event) => {
      if (editing || (event.target instanceof Element && event.target.closest("a, button, input"))) return;
      event.preventDefault();
      setEditing(true);
    }}
    onFocus={(event) => { if (event.target === event.currentTarget) setEditing(true); }}
  >{editing ? kind === "code" ? <ResearchMentionTextarea ref={codeRef} className="research-text-source" aria-label={label} rows={1} defaultValue={editorSource} spellCheck={false}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onBlur={event => { save(event.currentTarget); setEditing(false); }}
    onKeyDown={event => handleKeys(event.nativeEvent, event.currentTarget)} placeholder={hint} /> : <ResearchReferenceEditor ref={ref} className="research-text-source" aria-label={label} defaultValue={editorSource}
    aria-keyshortcuts="Control+Enter Meta+Enter Shift+Enter F2"
    aria-description={t("Ctrl/Cmd+Enter 完成本块并选择下一内容块；Shift+Enter 续写列表或引用。") + " " + t("光标位于引用旁时按 F2 修改引用。")}
    onBlur={(input) => {
      save(input);
      setEditing(false);
    }}
    onKeyDown={handleKeys}
    placeholder={hint}
  /> : rendered}</div>;
}
