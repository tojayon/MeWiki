import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { Children, createElement, isValidElement, memo, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, FileText, Terminal } from "lucide-react";
import { Formula } from "./Formula.tsx";
import ResearchInlineFormula from "./ResearchInlineFormula.tsx";
import { InlineSymbolDetailsContext } from "./ResearchInlineSymbolContext.ts";
import { remarkTableCellBreaks } from "../domain/researchTable.ts";
import type { ResearchOutlineHeading } from "../domain/researchOutline.ts";
import "highlight.js/styles/github-dark.css";
import "./ResearchMarkdown.css";
import "./ResearchNoteLinks.css";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import { researchNoteLinkId } from "../domain/researchNoteLinks.ts";
import { dictionaryReferenceKind, resolveDictionaryReference, formatTermReference, termReferenceSelection, type ResearchTermEntry, type TermReferenceSelection } from "../domain/researchTerms.ts";
import { resolveSymbolEntry } from "../domain/researchDictionary.ts";
import { ResearchMediaInlineImage, ResearchMediaInlineLink } from "./ResearchMediaInline.tsx";
import ResearchTermPopover from "./ResearchTermPopover.tsx";

function ResearchTermReference({ entry, selection }: { entry: ResearchTermEntry; selection: TermReferenceSelection }) {
  useLocale();
  const root = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const label = formatTermReference(entry, selection);
  useEffect(() => {
    if (!open) return;
    const dismissOther = (event: Event) => { if ((event as CustomEvent).detail !== root.current) setOpen(false); };
    window.addEventListener("research-term-reference-inspect", dismissOther);
    return () => window.removeEventListener("research-term-reference-inspect", dismissOther);
  }, [open]);
  const close = (restore = false) => {
    if (restore) root.current?.focus({ preventScroll: true });
    setOpen(false);
    setTrigger(null);
  };
  return <>
    <button ref={root} type="button" className="research-dictionary-term-reference" aria-label={t`术语：${label}`} title={t`术语：${entry.name} · ${entry.meaning}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        const next = event.currentTarget;
        window.dispatchEvent(new CustomEvent("research-term-reference-inspect", { detail: next }));
        setTrigger(value => open ? null : value === next ? value : next);
        setOpen(value => !value);
      }}>{label}</button>
    {open && trigger && createPortal(<ResearchTermPopover entry={entry} target={trigger} onCancel={close} />, trigger.closest("dialog") ?? document.body)}
  </>;
}

function NoteAnchor({ href, children, ...props }: ComponentProps<"a">) {
  useLocale();
  const context = useContext(ResearchNoteLinkContext);
  const dictionary = resolveDictionaryReference(href, context?.symbols ?? [], context?.terms ?? []);
  if (dictionary.kind === "term") {
    const entry = dictionary.entry as ResearchTermEntry | undefined;
    if (!entry) return <span data-reference-href={href} className="research-dictionary-term-reference is-missing" title={t("词典术语已移除")}>{children}</span>;
    return <span data-reference-href={href}><ResearchTermReference entry={entry} selection={termReferenceSelection(href)} /></span>;
  }
  if (dictionary.kind === "symbol") {
    const entry = dictionary.entry && "notation" in dictionary.entry ? dictionary.entry : undefined;
    if (!entry) return <span data-reference-href={href} className="research-dictionary-symbol-reference is-missing" title={t("词典符号已移除")}>{children}</span>;
    const bindings = { ...Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue])), ...dictionary.bindings };
    return <button type="button" data-reference-href={href} className="research-dictionary-symbol-reference" aria-label={t`符号：${entry.name}`} title={t`符号：${entry.name} · ${entry.meaning}`} onClickCapture={event => {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("research-dictionary-open", { detail: { kind: "symbol", id: entry.id } }));
    }}>
      <InlineSymbolDetailsContext.Provider value={false}>
        <ResearchInlineFormula tex={resolveSymbolEntry(entry, bindings).tex} />
      </InlineSymbolDetailsContext.Provider>
    </button>;
  }
  const id = researchNoteLinkId(href);
  if (href?.startsWith("webbench-asset:")) return <span data-reference-href={href}><ResearchMediaInlineLink href={href}>{children}</ResearchMediaInlineLink></span>;
  if (id === null) return <a {...props} href={href} target={href?.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>;
  const note = context?.notes.find(note => note.id === id);
  return <a {...props} href={href} data-reference-href={href} className="research-note-link" aria-disabled={!note || undefined}
    title={note ? t`在右侧打开：${note.title || t("未命名笔记")}` : t("目标笔记已移除")}
    onClick={event => { event.preventDefault(); event.stopPropagation(); if (note) context?.openNote(note.id, undefined, event.currentTarget); }}>
    <FileText size={14} aria-hidden="true" />{note ? note.title || t("未命名笔记") : children}
  </a>;
}

function CodeBlock({ children }: ComponentProps<"pre">) {
  useLocale();
  const ref = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const code = Children.toArray(children).find((child) => isValidElement<{ className?: string }>(child));
  const language = isValidElement<{ className?: string }>(code) ? /(?:^|\s)language-([^\s]+)/.exec(code.props.className ?? "")?.[1] : undefined;
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? "");
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      if (ref.current) { range.selectNodeContents(ref.current); selection?.removeAllRanges(); selection?.addRange(range); }
    }
  };
  return <div className="research-markdown-code">
    <div className="research-code-toolbar"><span><Terminal size={12} aria-hidden="true" />{language ?? t("代码")}</span><button type="button" data-ui="icon-action" className="research-code-copy" aria-label={copied ? t("代码已复制") : t("复制代码")} title={copied ? t("已复制") : t("复制代码")} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
    <pre ref={ref}>{children}</pre>
  </div>;
}

const components: () => Components = () => ({
  pre: ({ children }) => {
    const code = Children.toArray(children).find((child) => isValidElement<{ className?: string; children?: string }>(child));
    return isValidElement<{ className?: string; children?: string }>(code) && code.props.className?.split(" ").includes("math-display")
      ? <Formula tex={String(code.props.children ?? "").replace(/\n$/, "")} block /> : <CodeBlock>{children}</CodeBlock>;
  },
  code: ({ className, children }) => className?.split(" ").includes("math-inline")
    ? <ResearchInlineFormula tex={String(children ?? "")} /> : <code className={className}>{children}</code>,
  table: ({ children }) => <div className="research-markdown-table"><table>{children}</table></div>,
  th: ({ children, style }) => <th style={style}><span className="research-table-cell-content">{children}</span></th>,
  td: ({ children, style }) => <td style={style}><span className="research-table-cell-content">{children}</span></td>,
  a: ({ node: _node, ...props }) => <NoteAnchor {...props} />,
  img: ({ src, alt, title }) => typeof src === "string" && src.startsWith("webbench-asset:") ? <ResearchMediaInlineImage src={src} alt={alt} title={title} /> : src ? <img src={src} alt={alt ?? ""} title={title} loading="lazy" /> : <span className="research-markdown-image-placeholder">{alt || t("图片")}  {t("· 待填写图片路径")}</span>,
});
const inlineComponents: Components = { ...components(), p: ({ children }) => <>{children}</> };
const remarkPlugins = [remarkGfm, remarkMath, remarkTableCellBreaks];
const rehypePlugins: ComponentProps<typeof Markdown>["rehypePlugins"] = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];
const remarkRehypeOptions = () => ({ footnoteLabel: t("注释"), footnoteBackLabel: t("返回正文") });

/** Parse prose and code separately; math plugins never process fenced or inline code. */
export default memo(function ResearchMarkdown({ text, inline = false, headings }: { text: string; inline?: boolean; headings?: readonly ResearchOutlineHeading[] }) {
  useLocale();
  const numberedComponents = useMemo<Components>(() => {
    if (!headings?.length) return components();
    const byOffset = new Map(headings.map(heading => [heading.offset, heading]));
    const heading: Components["h1"] = ({ node, children, ...props }) => {
      const entry = node?.position?.start.offset === undefined ? undefined : byOffset.get(node.position.start.offset);
      return createElement(node?.tagName ?? "h1", { ...props, ...(entry ? {
        id: `research-heading-${entry.id}`, "data-outline-id": entry.id, tabIndex: -1,
      } : {}) }, entry ? <><span className="research-heading-number">{entry.number}</span>{" "}{children}</> : children);
    };
    return { ...components(), h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading };
  }, [headings]);
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} remarkRehypeOptions={remarkRehypeOptions()} components={inline ? inlineComponents : numberedComponents} urlTransform={url => /^webbench-asset:[a-f0-9]{64}(#page=[1-9]\d*)?$/.test(url) || dictionaryReferenceKind(url) ? url : defaultUrlTransform(url)} skipHtml>{text}</Markdown>;
});
