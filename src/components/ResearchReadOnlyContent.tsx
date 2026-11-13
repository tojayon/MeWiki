import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useState, type ReactNode } from 'react';
import { Link2 } from 'lucide-react';
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from '../domain/researchNotebook.ts';
import type { ResearchOutlineHeading } from '../domain/researchOutline.ts';
import { buildResearchOutline } from '../domain/researchOutline.ts';
import { noteEmbedSelectionError, resolveNoteEmbed, type ResearchNoteEmbedBlock } from '../domain/researchNoteEmbed.ts';
import { isResearchRichBlock } from '../domain/researchRichContent.ts';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import ResearchTextBlock from './ResearchTextBlock.tsx';
import ResearchMathText from './ResearchMathText.tsx';
import ResearchFormulaComposer from './ResearchFormulaComposer.tsx';
import ResearchCallout from './ResearchCallout.tsx';
import ResearchExamples from './ResearchExamples.tsx';
import ResearchMediaBlock from './ResearchMediaBlock.tsx';
import ResearchBookmarkBlock from './ResearchBookmarkBlock.tsx';
import ResearchRichBlock from './ResearchRichBlock.tsx';
import ExternalContentCard from '../integrations/ExternalContentCard.tsx';
import './ResearchNoteEmbed.css';

type OpenNote = (noteId: string, blockId?: string, source?: HTMLElement) => void;
export interface ReadOnlyContentProps {
  block: ResearchNotebookBlock;
  note: ResearchNote;
  state: ResearchNotebookState;
  onOpenNote: OpenNote;
  headings?: readonly ResearchOutlineHeading[];
  selectedTabs?: Record<string, string>;
  onSelectTab?: (blockId: string, tabId: string) => void;
  renderBlocks?: (blocks: ResearchNotebookBlock[]) => ReactNode;
  path?: string[];
  staticView?: boolean;
  allTabs?: boolean;
}

/** Read-only content keeps formula ownership and links tied to the original note. */
export default function ResearchReadOnlyContent({ block, note, state, onOpenNote, headings, selectedTabs, onSelectTab, renderBlocks, path = [], staticView = false, allTabs = false }: ReadOnlyContentProps) {
  useLocale();
  const [tabs, setTabs] = useState<Record<string, string>>({});
  if (block.type === 'noteEmbed') return <ResearchNoteEmbedContent block={block} ownerNoteId={note.id} state={state} onOpenNote={onOpenNote} path={path} staticView={staticView} allTabs={allTabs} selectedTabs={selectedTabs} onSelectTab={onSelectTab} />;
  if (block.type === 'paragraph' || block.type === 'markdown' || block.type === 'heading') return <ResearchTextBlock readOnly label={t("引用内容正文")} value={block.type === 'heading' ? `${'#'.repeat(block.level)} ${block.text}` : block.text} kind={block.type === 'markdown' ? block.kind : block.type} headings={headings} onChange={() => {}} />;
  if (block.type === 'list') return <ul className="research-note-read-list">{block.items.map((item, index) => <li key={index}><ResearchMathText text={item} /></li>)}</ul>;
  if (block.type === 'formula') return <ResearchFormulaComposer block={block} state={state} owner={{ noteId: note.id, formulaId: block.id }} readOnly onPatch={() => {}} onOpenFormula={address => onOpenNote(address.noteId, address.formulaId)} />;
  if (block.type === 'callout') return <ResearchCallout block={block} readOnly onPatch={() => {}} />;
  if (block.type === 'media') return <ResearchMediaBlock block={block} readOnly onPatch={() => {}} />;
  if (block.type === 'bookmark') return <ResearchBookmarkBlock block={block} readOnly onPatch={() => {}} />;
  if (isResearchRichBlock(block)) return <ResearchRichBlock block={block} readOnly onPatch={() => {}} />;
  if (block.type === 'external') return <ExternalContentCard block={block} readOnly />;
  if (block.type === 'evidence') return <article className="research-evidence-block"><strong>{block.runTitle}</strong><span>t = {block.time.toFixed(6)} s</span>{block.note && <ResearchMathText text={block.note} />}</article>;
  const renderChildren = renderBlocks ?? (blocks => <div className="research-reference-blocks">{blocks.map(child => <div className="research-reference-item" key={child.id} data-referenced-block-id={child.id}>
    <ResearchReadOnlyContent block={child} note={note} state={state} onOpenNote={onOpenNote} headings={buildResearchOutline(note.blocks).filter(heading => heading.blockId === child.id)} selectedTabs={selectedTabs} onSelectTab={onSelectTab} path={path} staticView={staticView} allTabs={allTabs} />
  </div>)}</div>);
  if (staticView && allTabs) return <>{block.tabs.map(tab => <ResearchExamples key={tab.id} block={block} readOnly staticView selectedTabId={tab.id} renderBlocks={renderChildren} />)}</>;
  return <ResearchExamples block={block} readOnly staticView={staticView} onPatch={() => {}} selectedTabId={selectedTabs?.[block.id] ?? tabs[block.id]} onSelect={tabId => {
    setTabs(current => ({ ...current, [block.id]: tabId })); onSelectTab?.(block.id, tabId);
  }} renderBlocks={renderChildren} />;
}

export function ResearchNoteEmbedContent({ block, ownerNoteId, state, onOpenNote, actions, path = [], staticView = false, allTabs = false, selectedTabs, onSelectTab }: {
  block: ResearchNoteEmbedBlock; ownerNoteId: string; state: ResearchNotebookState; onOpenNote: OpenNote; actions?: ReactNode; path?: string[]; staticView?: boolean; allTabs?: boolean; selectedTabs?: Record<string, string>; onSelectTab?: (blockId: string, tabId: string) => void;
}) {
  useLocale();
  const source = resolveNoteEmbed(state.notes, block);
  const address = JSON.stringify([ownerNoteId, block.id]);
  const error = path.includes(address) ? t('循环引用已停止展开，请调整引用范围。') : noteEmbedSelectionError(state.notes, { noteId: ownerNoteId, blockId: block.id }, block, false);
  const title = source.note?.title || block.sourceTitle || t('来源笔记');
  return <article className="research-note-embed" data-note-embed={block.id} data-source-note-id={block.sourceNoteId}>
    <header className="research-note-embed-header">
      <Link2 size={14} aria-hidden="true" />
      <button type="button" disabled={!source.note} className="research-note-embed-source" title={t("打开来源笔记，可在来源处修改内容")} aria-label={t`打开引用来源：${title}`} onClick={event => onOpenNote(block.sourceNoteId, source.items.find(item => item.block)?.id, event.currentTarget)}>{title}</button>
      <span className="research-note-embed-sync" title={t("此处只读显示来源的最新内容；修改来源后自动更新")}>{t("同步引用")}</span>
      {actions}
    </header>
    {error ? <p className="research-note-embed-error" role="status">{localizeError(error)}</p> : !source.note ? <p className="research-note-embed-error" role="status">{t("来源笔记已删除或不在当前资料库中，请重新选择来源。")}</p> :
      <ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, terms: state.terms ?? [], state, sourceNoteId: source.note.id, openNote: onOpenNote }}>
        <div className="research-reference-blocks">{source.items.map(item => <div className="research-reference-item" data-referenced-block-id={item.id} key={item.id}>
          {item.block ? <ResearchReadOnlyContent block={item.block} note={source.note!} state={state} onOpenNote={onOpenNote} path={[...path, address]} headings={buildResearchOutline(source.note!.blocks).filter(heading => heading.blockId === item.id)} staticView={staticView} allTabs={allTabs} selectedTabs={selectedTabs} onSelectTab={onSelectTab} /> : <p className="research-note-embed-error" role="status">{t("所引用的内容已删除，请调整引用范围。")}</p>}
        </div>)}</div>
      </ResearchNoteLinkContext.Provider>}
  </article>;
}
