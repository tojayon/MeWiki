import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, Scissors } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import type { ResearchNotebookState, ResearchNotebookBlock } from '../domain/researchNotebook.ts';
import { buildResearchOutline } from '../domain/researchOutline.ts';
import { ResearchContentLibraryContext } from '../state/ResearchContentLibraryContext.ts';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import ResearchReadOnlyContent from './ResearchReadOnlyContent.tsx';
import UiInfo from './UiInfo.tsx';
import type { PublicationContentDiagnostic, PublicationDiagnosticCode } from '../domain/publicationDiagnostics.ts';

const diagnosticMessages: Record<PublicationDiagnosticCode, string> = {
  'horizontal-overflow': '内容超宽，滚动区域会被截断。',
  'vertical-overflow': '内容超高，滚动区域会被截断。',
  'page-overflow': '此内容无法完整放入一页。',
};

export default function PublicationContentSelection({ state, noteId, directory, selected, breaks, allTabs, selectedTabs, pdfPages, paged, disabled, diagnostics, problemTarget, onSelect, onBreak, onAll, onAllTabs, onSelectTab, onSelectPdfPage }: {
  state: ResearchNotebookState; noteId: string; directory: string | null; selected: ReadonlySet<string>; breaks: ReadonlySet<string>;
  allTabs: boolean; selectedTabs: Record<string, string>; paged: boolean; disabled: boolean;
  diagnostics: readonly PublicationContentDiagnostic[]; problemTarget: { id: string } | null;
  pdfPages: Record<string, number>; onSelectPdfPage: (blockId: string, page: number) => void;
  onSelect: (id: string, checked: boolean) => void; onBreak: (id: string, checked: boolean) => void;
  onAll: (checked: boolean) => void; onAllTabs: (checked: boolean) => void; onSelectTab: (id: string, tabId: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!problemTarget || disabled) return;
    const item = [...root.current!.querySelectorAll<HTMLElement>('[data-publication-block]')].find(element => element.dataset.publicationBlock === problemTarget.id);
    item?.scrollIntoView({ block: 'start' }); item?.focus({ preventScroll: true });
  }, [problemTarget, disabled]);
  const note = state.notes.find(item => item.id === noteId)!;
  const headings = buildResearchOutline(note.blocks);
  const renderContent = (block: ResearchNotebookBlock) => <ResearchReadOnlyContent block={block} note={note} state={state} onOpenNote={() => {}} headings={headings.filter(heading => heading.blockId === block.id)} selectedTabs={selectedTabs} onSelectTab={onSelectTab} staticView allTabs={allTabs}
    renderBlocks={blocks => <div className="research-note-blocks">{blocks.map(renderNested)}</div>} />;
  const renderNested = (block: ResearchNotebookBlock): ReactNode => <section key={block.id} className={`research-note-block is-${block.type}`} data-block-id={block.id}>{renderContent(block)}</section>;
  return <section ref={root} aria-label={t('原文与内容选择')} className="mewiki-publication-source">
    <fieldset className="mewiki-publication-scope-actions" disabled={disabled}>
      <button type="button" onClick={() => onAll(true)}>{t('全选')}</button><button type="button" onClick={() => onAll(false)}>{t('清空选择')}</button>
      <label title={t('展开全部标签页（默认仅当前页签）')}><input type="checkbox" aria-label={t('展开全部标签页（默认仅当前页签）')} checked={allTabs} onChange={event => onAllTabs(event.target.checked)} />{t('全部标签页')}</label>
      <UiInfo label={t('内容选择说明')}><p>{t('在原文旁勾选要导出的内容，剪刀标记表示在此内容前另起一页。')}</p></UiInfo>
    </fieldset>
    <ResearchContentLibraryContext.Provider value={{ notebook: state, directory, busy: disabled, status: directory ? 'saved' : 'browser', pdfPages, onSelectPdfPage }}><ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, terms: state.terms ?? [], state, sourceNoteId: noteId, openNote: () => {} }}>
      <div className="mewiki-publication-source-paper research-notebook-editor is-readonly" inert={disabled}>
        <h1 className="research-note-title">{note.title}</h1>
        <div className="research-note-blocks mewiki-publication-source-blocks">{note.blocks.map((block, index) => {
          const issues = diagnostics.filter(issue => issue.blockId === block.id);
          return <div key={block.id} className="mewiki-publication-source-item" data-publication-block={block.id} data-selected={selected.has(block.id)} data-publication-issue={!!issues.length} tabIndex={issues.length ? -1 : undefined} aria-describedby={issues.length ? `publication-issue-${index}` : undefined}>
          <div className="mewiki-publication-source-checks">
            <label title={t`导出此内容：${index + 1}`}><input type="checkbox" aria-label={t`导出此内容：${index + 1}`} disabled={disabled} checked={selected.has(block.id)} onChange={event => onSelect(block.id, event.target.checked)} /><span>{index + 1}</span></label>
            {paged && <label title={t('此前分页')} className="mewiki-publication-source-break"><input type="checkbox" aria-label={t`在此内容前分页：${index + 1}`} disabled={disabled || !selected.has(block.id)} checked={breaks.has(block.id)} onChange={event => onBreak(block.id, event.target.checked)} /><Scissors size={13} aria-hidden="true" /></label>}
          </div>
          <div className="mewiki-publication-source-body">
            {!!issues.length && <p id={`publication-issue-${index}`} className="mewiki-publication-source-diagnostic"><AlertTriangle size={16} aria-hidden="true" /><span>{issues.map(issue => t(diagnosticMessages[issue.code])).join(' ')} {t('调整画幅或字号，或取消勾选此内容，然后重新生成预览。')}</span></p>}
            <section className={`research-note-block is-${block.type}`} data-block-id={block.id} aria-describedby={issues.length ? `publication-issue-${index}` : undefined}>{renderContent(block)}</section>
          </div>
        </div>; })}</div>
      </div>
    </ResearchNoteLinkContext.Provider></ResearchContentLibraryContext.Provider>
  </section>;
}
