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
  const ref = useRef<HTMLTextAreaElement>(null);
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
    if (!editing || !ref.current) return;
    initialSource.current = ref.current.value;
    ref.current.focus({ preventScroll: true });
    const caret = researchTextEditorState(ref.current.value, kind).caret;
    ref.current.setSelectionRange(caret, caret);
  }, [editing, kind]);

  const save = (input: HTMLTextAreaElement) => {
    const text = input.value.replace(/\r\n?/g, "\n");
    if (text === initialSource.current) return true;
    initialSource.current = text;
    return onChange(text, input.parentElement ?? undefined) !== false;
  };

  if (readOnly) return <div className="research-markdown research-read-text" data-kind={kind} data-plain-text={plainText}>{rendered}</div>;
  return <div className="research-editable-text research-markdown" data-kind={kind} data-plain-text={plainText}
    role={editing ? undefined : "textbox"} aria-label={editing ? undefined : label} aria-multiline={editing ? undefined : true} tabIndex={editing ? undefined : 0}
    onPointerDown={(event) => {
      if (editing || (event.target instanceof Element && event.target.closest("a, button, input"))) return;
      event.preventDefault();
      setEditing(true);
    }}
    onFocus={(event) => { if (event.target === event.currentTarget) setEditing(true); }}
  >{editing ? <ResearchMentionTextarea ref={ref} className="research-text-source" aria-label={label} rows={1} defaultValue={editorSource} spellCheck={kind !== "code"}
    aria-keyshortcuts="Control+Enter Meta+Enter Shift+Enter"
    aria-description={t("Ctrl/Cmd+Enter 完成本块并选择下一内容块；Shift+Enter 续写列表或引用。")}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onBlur={(event) => {
      save(event.currentTarget);
      setEditing(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        // Keep Escape inside the editor so the surrounding dialog cannot close during IME input.
        event.preventDefault();
        if (!event.nativeEvent.isComposing && !composing.current) event.currentTarget.blur();
        return;
      }
      if (event.key !== "Enter" || event.nativeEvent.isComposing || composing.current || event.keyCode === 229 || event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && onComplete) {
        event.preventDefault(); event.stopPropagation();
        const accepted = save(event.currentTarget);
        setEditing(false);
        if (accepted) onComplete();
      } else if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const input = event.currentTarget;
        const next = continueResearchMarkdownLine(input.value, input.selectionStart, input.selectionEnd, kind);
        if (!next) return;
        event.preventDefault(); event.stopPropagation();
        // Insert through the browser's editing transaction so native Undo restores the whole shortcut.
        let start = 0, end = input.value.length, nextEnd = next.text.length;
        while (start < end && start < nextEnd && input.value[start] === next.text[start]) start++;
        while (end > start && nextEnd > start && input.value[end - 1] === next.text[nextEnd - 1]) { end--; nextEnd--; }
        input.setSelectionRange(start, end);
        if (!document.execCommand("insertText", false, next.text.slice(start, nextEnd))) {
          input.setRangeText(next.text.slice(start, nextEnd), start, end, "end");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        input.setSelectionRange(next.caret, next.caret);
      }
    }}
    placeholder={hint}
  /> : rendered}</div>;
}
