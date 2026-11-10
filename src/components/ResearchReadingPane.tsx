import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ResearchRichBlock from "./ResearchRichBlock.tsx";
import { isResearchRichBlock } from "../domain/researchRichContent.ts";
import { FileText, Unlink, X } from "lucide-react";
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from "../domain/researchNotebook.ts";
import { buildResearchOutline } from "../domain/researchOutline.ts";
import { findResearchBlock } from "../domain/researchBlockTree.ts";
import type { ResearchReadingPane as ReadingPane } from "../state/researchReadingPanes.ts";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import ResearchTextBlock from "./ResearchTextBlock.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import ExternalContentCard from '../integrations/ExternalContentCard.tsx';
import ResearchCallout from "./ResearchCallout.tsx";
import ResearchExamples from "./ResearchExamples.tsx";
import ResearchFormulaComposer from "./ResearchFormulaComposer.tsx";
import ResearchMediaBlock from "./ResearchMediaBlock.tsx";
import ResearchBookmarkBlock from "./ResearchBookmarkBlock.tsx";
import { ResearchNoteEmbedContent } from './ResearchReadOnlyContent.tsx';

export interface ReadingContentTarget { blockId: string; headingId?: string }
export default function ResearchReadingPane({ pane, note, state, active, target, onActivate, onClose, onDetach, onOpenNote, onContentRef }: {
  pane: ReadingPane; note: ResearchNote; state: ResearchNotebookState; active: boolean;
  target?: ReadingContentTarget;
  onActivate: () => void; onClose: () => void; onDetach: () => void;
  onOpenNote: (id: string, blockId?: string, source?: HTMLElement) => void;
  onContentRef: (element: HTMLDivElement | null) => void;
}) {
  useLocale();
  const content = useRef<HTMLDivElement>(null);
  const effectiveTarget = useMemo(() => target ?? (pane.blockId ? { blockId: pane.blockId } : undefined), [target, pane.blockId]);
  const [tabs, setTabs] = useState<{ target: ReadingContentTarget | undefined; selected: Record<string, string> }>({ target: undefined, selected: {} });
  if (effectiveTarget !== tabs.target) {
    const location = effectiveTarget && findResearchBlock(note.blocks, effectiveTarget.blockId);
    setTabs({ target: effectiveTarget, selected: { ...tabs.selected, ...Object.fromEntries((location?.path ?? []).map(owner => [owner.exampleBlockId, owner.tabId])) } });
  }
  const outline = useMemo(() => buildResearchOutline(note.blocks), [note.blocks]);
  useLayoutEffect(() => {
    if (!effectiveTarget) return;
    const block = [...(content.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [])].find(element => element.dataset.blockId === effectiveTarget.blockId);
    const element = effectiveTarget.headingId ? [...(block?.querySelectorAll<HTMLElement>("[data-outline-id]") ?? [])].find(element => element.dataset.outlineId === effectiveTarget.headingId) : block;
    if (!element) return;
    element.scrollIntoView({ block: "center", inline: "nearest" });
    // A restored location must not steal focus from the saved active pane.
    if (target) element.focus({ preventScroll: true });
    const animation = element.animate([{ backgroundColor: "#dce9ff" }, { backgroundColor: "#dce9ff", offset: 0.8 }, { backgroundColor: "transparent" }], { duration: 1500 });
    return () => animation.cancel();
  }, [effectiveTarget, note.id, target]);
  const render = (block: ResearchNotebookBlock): ReactNode => <section key={block.id} className={`research-note-block is-${block.type}`} data-block-id={block.id} tabIndex={-1}>
    {(block.type === "paragraph" || block.type === "markdown" || block.type === "heading") && <ResearchTextBlock readOnly label={t("分屏笔记正文")} value={block.type === "heading" ? `${"#".repeat(block.level)} ${block.text}` : block.text} headings={outline.filter(heading => heading.blockId === block.id)} onChange={() => {}} />}
    {block.type === "list" && <ul className="research-note-read-list">{block.items.map((item, index) => <li key={index}><ResearchMathText text={item} /></li>)}</ul>}
    {block.type === "callout" && <ResearchCallout block={block} readOnly onPatch={() => {}} />}
    {block.type === "media" && <ResearchMediaBlock block={block} readOnly onPatch={() => {}} />}
    {block.type === "bookmark" && <ResearchBookmarkBlock block={block} readOnly onPatch={() => {}} />}
    {isResearchRichBlock(block) && <ResearchRichBlock block={block} readOnly onPatch={() => {}} />}
    {block.type === "formula" && <ResearchFormulaComposer block={block} state={state} owner={{ noteId: note.id, formulaId: block.id }} readOnly onPatch={() => {}} onOpenFormula={address => onOpenNote(address.noteId, address.formulaId)} />}
    {block.type === "examples" && <ResearchExamples block={block} readOnly onPatch={() => {}} selectedTabId={tabs.selected[block.id]} onSelect={tabId => setTabs(current => ({ ...current, selected: { ...current.selected, [block.id]: tabId } }))} renderBlocks={blocks => <div className="research-note-blocks">{blocks.map(render)}</div>} />}
    {block.type === "evidence" && <article className="research-evidence-block"><strong>{block.runTitle}</strong><span>t = {block.time.toFixed(6)} s</span>{block.note && <ResearchMathText text={block.note} />}</article>}
    {block.type === 'external' && <ExternalContentCard block={block} />}
    {block.type === 'noteEmbed' && <ResearchNoteEmbedContent block={block} ownerNoteId={note.id} state={state} onOpenNote={onOpenNote} />}
  </section>;
  return <ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, state, sourceNoteId: note.id, openNote: onOpenNote }}>
    <section className="research-reading-pane is-readonly" data-reading-pane-id={pane.id} data-reading-note-id={note.id} data-reading-active={active} aria-label={t`阅读笔记 ${note.title || t("未命名笔记")}`} onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
      <header className="research-reading-pane-header"><FileText size={15} aria-hidden="true" /><strong title={note.title}>{note.title || t("未命名笔记")}</strong>
        {pane.parentId ? <button type="button" data-ui="icon-action" aria-label={t`解绑阅读笔记 ${note.title}`} title={t("解绑后，关闭来源笔记时保留此屏及其下游")} onClick={onDetach}><Unlink size={14} /></button> : <span className="research-reading-independent">{t("独立")}</span>}
        <button type="button" data-ui="icon-action" aria-label={t`关闭阅读笔记 ${note.title}`} title={t("关闭此屏及仍绑定的下游笔记")} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="research-note-page" ref={element => { content.current = element; onContentRef(element); }}><div className="research-note-scroll"><div className="research-note-blocks">{note.blocks.map(render)}{!note.blocks.length && <p className="research-empty-note">{t("这篇笔记暂无内容。")}</p>}</div></div></div>
      <footer className="research-reading-pane-footer">{t("只读对照")}<span>{pane.parentId ? t("随来源关闭 · 可解绑") : t("独立阅读")}</span></footer>
    </section>
  </ResearchNoteLinkContext.Provider>;
}
