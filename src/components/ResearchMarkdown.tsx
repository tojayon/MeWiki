import { Children, createElement, isValidElement, memo, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, FileText } from "lucide-react";
import { Formula } from "./Formula.tsx";
import ResearchInlineFormula from "./ResearchInlineFormula.tsx";
import { remarkTableCellBreaks } from "../domain/researchTable.ts";
import type { ResearchOutlineHeading } from "../domain/researchOutline.ts";
import "highlight.js/styles/github.css";
import "./ResearchMarkdown.css";
import "./ResearchNoteLinks.css";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import { researchNoteLinkId } from "../domain/researchNoteLinks.ts";
import { ResearchMediaInlineImage, ResearchMediaInlineLink } from "./ResearchMediaInline.tsx";

function NoteAnchor({ href, children, ...props }: ComponentProps<"a">) {
  const context = useContext(ResearchNoteLinkContext);
  const id = researchNoteLinkId(href);
  if (href?.startsWith("webbench-asset:")) return <ResearchMediaInlineLink href={href}>{children}</ResearchMediaInlineLink>;
  if (id === null) return <a {...props} href={href} target={href?.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>;
  const note = context?.notes.find(note => note.id === id);
  return <a {...props} href={href} className="research-note-link" aria-disabled={!note || undefined}
    title={note ? `在右侧打开：${note.title || "未命名笔记"}` : "目标笔记已移除"}
    onClick={event => { event.preventDefault(); event.stopPropagation(); if (note) context?.openNote(note.id, undefined, event.currentTarget); }}>
    <FileText size={14} aria-hidden="true" />{note ? note.title || "未命名笔记" : children}
  </a>;
}

function CodeBlock({ children }: ComponentProps<"pre">) {
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
    <div className="research-code-toolbar"><span>{language ?? "代码"}</span><button type="button" data-ui="icon-action" className="research-code-copy" aria-label={copied ? "代码已复制" : "复制代码"} title={copied ? "已复制" : "复制代码"} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
    <pre ref={ref}>{children}</pre>
  </div>;
}

const components: Components = {
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
  img: ({ src, alt, title }) => typeof src === "string" && src.startsWith("webbench-asset:") ? <ResearchMediaInlineImage src={src} alt={alt} title={title} /> : src ? <img src={src} alt={alt ?? ""} title={title} loading="lazy" /> : <span className="research-markdown-image-placeholder">{alt || "图片"} · 待填写图片路径</span>,
};
const inlineComponents: Components = { ...components, p: ({ children }) => <>{children}</> };
const remarkPlugins = [remarkGfm, remarkMath, remarkTableCellBreaks];
const rehypePlugins: ComponentProps<typeof Markdown>["rehypePlugins"] = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];
const remarkRehypeOptions = { footnoteLabel: "注释", footnoteBackLabel: "返回正文" };

/** Parse prose and code separately; math plugins never process fenced or inline code. */
export default memo(function ResearchMarkdown({ text, inline = false, headings }: { text: string; inline?: boolean; headings?: readonly ResearchOutlineHeading[] }) {
  const numberedComponents = useMemo<Components>(() => {
    if (!headings?.length) return components;
    const byOffset = new Map(headings.map(heading => [heading.offset, heading]));
    const heading: Components["h1"] = ({ node, children, ...props }) => {
      const entry = node?.position?.start.offset === undefined ? undefined : byOffset.get(node.position.start.offset);
      return createElement(node?.tagName ?? "h1", { ...props, ...(entry ? {
        id: `research-heading-${entry.id}`, "data-outline-id": entry.id, tabIndex: -1,
      } : {}) }, entry ? <><span className="research-heading-number">{entry.number}</span>{" "}{children}</> : children);
    };
    return { ...components, h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading };
  }, [headings]);
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} remarkRehypeOptions={remarkRehypeOptions} components={inline ? inlineComponents : numberedComponents} urlTransform={url => /^webbench-asset:[a-f0-9]{64}(#page=[1-9]\d*)?$/.test(url) ? url : defaultUrlTransform(url)} skipHtml>{text}</Markdown>;
});
