import type { CSSProperties, ReactNode, Ref } from 'react';
import type { PublicationOptions } from '../domain/publicationTypes.ts';
import type { ResearchNotebookState, ResearchNotebookBlock } from '../domain/researchNotebook.ts';
import { buildResearchOutline } from '../domain/researchOutline.ts';
import { documentTheme } from '../styles/documentTheme.ts';
import { publicationFontFamily } from '../domain/researchFonts.ts';
import { ResearchContentLibraryContext } from '../state/ResearchContentLibraryContext.ts';
import ResearchReadOnlyContent from './ResearchReadOnlyContent.tsx';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import { publicationContentSize } from '../domain/publicationFrames.ts';

/** The same read-only components as the page, mounted only for this frozen selection. */
export default function PublicationReadingSurface({ state, noteId, directory, selected, options, selectedTabs, pdfPages, allTabs, surfaceRef }: {
  state: ResearchNotebookState; noteId: string; selected: readonly string[]; options: PublicationOptions;
  directory: string | null;
  selectedTabs: Record<string, string>; allTabs: boolean; surfaceRef: Ref<HTMLDivElement>;
  pdfPages?: Readonly<Record<string, number>>;
}) {
  const note = state.notes.find(item => item.id === noteId)!;
  const headings = buildResearchOutline(note.blocks);
  const render = (block: ResearchNotebookBlock): ReactNode => <section key={block.id} className={`research-note-block is-${block.type}`} data-block-id={block.id}>
    <ResearchReadOnlyContent block={block} note={note} state={state} onOpenNote={() => {}} headings={headings.filter(heading => heading.blockId === block.id)} selectedTabs={selectedTabs} allTabs={allTabs} staticView
      renderBlocks={blocks => <div className="research-note-blocks">{blocks.map(render)}</div>} />
  </section>;
  const fallbackFont = options.fontFamily === 'serif' ? '"Noto Serif SC Variable",serif' : documentTheme.fontFamily;
  const fontFamily = options.fontAssetId ? `${publicationFontFamily(options.fontAssetId)},${fallbackFont}` : fallbackFont;
  const style = {
    position: 'fixed', left: '-100000px', top: 0, display: 'block', width: (publicationContentSize(options).width - 2 * options.margin) * documentTheme.fontSize / options.fontSize,
    height: 'auto', maxHeight: 'none', overflow: 'visible', pointerEvents: 'none', background: options.background,
    fontFamily, fontSynthesis: options.fontAssetId ? 'weight' : 'none',
    fontSize: documentTheme.fontSize, color: options.textColor,
    '--mewiki-document-font-family': fontFamily,
    '--mewiki-interface-font-family': fontFamily, '--mewiki-interface-font-size': '14px',
    '--mewiki-interface-font-synthesis': options.fontAssetId ? 'weight' : 'none',
    '--mewiki-interface-unit': '1px', '--mewiki-document-unit': '1px', '--mewiki-document-font-size': `${documentTheme.fontSize}px`,
    '--mewiki-document-text': options.textColor, '--mewiki-document-heading': options.headingColor,
    '--mewiki-document-accent': options.accentColor, '--mewiki-document-line-height': options.lineHeight,
  } as CSSProperties;
  return <ResearchContentLibraryContext.Provider value={{ notebook: state, directory, busy: false, status: directory ? 'saved' : 'browser', pixelRatio: options.fontSize / documentTheme.fontSize, pdfPages }}><ResearchNoteLinkContext.Provider value={{ notes: state.notes, symbols: state.symbols, terms: state.terms ?? [], state, sourceNoteId: noteId, openNote: () => {} }}>
    <div ref={surfaceRef} className="publication-reading-surface research-notebook-editor is-readonly" style={style} aria-hidden="true" inert>
      <div className="research-note-blocks" style={{ marginLeft: 0 }}>{note.blocks.filter(block => selected.includes(block.id)).map(render)}</div>
    </div>
  </ResearchNoteLinkContext.Provider></ResearchContentLibraryContext.Provider>;
}
