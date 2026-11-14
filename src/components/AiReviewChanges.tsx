import { Children, createElement, type ReactNode } from 'react';
import { aiDiffRanges, diffAiText, type AiDiffLine } from '../ai/diff.ts';
import type { TextBlock } from '../ai/reviewContent.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import { t } from '../i18n/locale.ts';
import type { AiReviewLocation } from '../ai/reviewDecisions.ts';

export interface AiReviewPresentation {
  render: (decisions: ReactNode, editable: (content: ReactNode) => ReactNode) => ReactNode;
}
export type AiReviewComparison = (location: AiReviewLocation, before: ReactNode, after: ReactNode, presentation?: AiReviewPresentation) => ReactNode;
type PairRenderer = (before: ReactNode, after: ReactNode, presentation?: AiReviewPresentation) => ReactNode;

export function TextDiff({ lines, block, renderPair }: { lines: AiDiffLine[]; block?: TextBlock; renderPair?: PairRenderer }) {
  const groups: { index: number; lines: AiDiffLine[] }[] = [];
  lines.forEach((line, index) => {
    const last = groups.at(-1);
    if (line.kind !== 'context' && last && last.lines[0].kind !== 'context') last.lines.push(line);
    else groups.push({ index, lines: [line] });
  });
  const row = (line: AiDiffLine, index: number) => {
    const content = line.parts.map((part, i) => part.changed ? line.kind === 'remove'
      ? <del key={i} className="mewiki-ai-inline-change" aria-label={t('删除的内容')}>{part.text}</del>
      : <ins key={i} className="mewiki-ai-inline-change" aria-label={t('新增的内容')}>{part.text}</ins> : <span key={i}>{part.text}</span>);
    return <div key={index} className="mewiki-ai-diff-row" data-review-text-row data-kind={line.kind} data-inline={line.kind !== 'context' && line.parts.some(part => !part.changed) || undefined}>
      <span className="mewiki-ai-diff-number" aria-hidden="true">{line.beforeLine}</span><span className="mewiki-ai-diff-number" aria-hidden="true">{line.afterLine}</span>
      <span className="mewiki-ai-diff-sign" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</span>
      {block ? <div className="mewiki-ai-diff-text">{createElement(block.type === 'heading' ? `h${block.level}` : 'p', undefined, content)}</div>
        : <span className="mewiki-ai-diff-text">{content}</span>}
    </div>;
  };
  const firstChange = groups.find(group => group.lines[0].kind !== 'context')?.index;
  const presentation: AiReviewPresentation = { render: (decisions, editable) => groups.map(group => group.lines[0].kind === 'context'
    ? row(group.lines[0], group.index) : <AiReviewPair key={group.index}
      before={group.lines.filter(line => line.kind === 'remove').map((line, i) => row(line, group.index + i))}
      after={editable(group.lines.filter(line => line.kind === 'add').map((line, i) => row(line, group.index + i)))} between={group.index === firstChange ? decisions : undefined} />) };
  return <div className={`mewiki-ai-text-diff${block ? ' research-markdown mewiki-ai-rendered-text-diff' : ''}`}>{renderPair
    ? renderPair(lines.filter(line => line.kind !== 'add').map(row), lines.filter(line => line.kind !== 'remove').map(row), firstChange !== undefined ? presentation : undefined)
    : presentation.render(undefined, content => content)}</div>;
}

/** Keep the two review surfaces and their decisions together in either layout and playback. */
export function AiReviewPair({ before, after, between, inline = false }: { before?: ReactNode; after?: ReactNode; between?: ReactNode; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return <Tag className={`mewiki-ai-review-pair${inline ? ' mewiki-ai-review-pair-inline' : ''}`} data-has-before={!!Children.toArray(before).length || undefined} data-has-after={!!Children.toArray(after).length || undefined}><Tag className="mewiki-ai-review-before">{before}</Tag>{between && <Tag className="mewiki-ai-review-between">{between}</Tag>}<Tag className="mewiki-ai-review-after">{after}</Tag></Tag>;
}

export function RenderedTextDiff({ before, after, state, originalState = state, onOpenNote, sourceNoteId = '', block, renderPair }: {
  before: string; after: string; state: ResearchNotebookState; originalState?: ResearchNotebookState; sourceNoteId?: string;
  onOpenNote: (id: string, blockId?: string) => void; block?: TextBlock;
  renderPair?: PairRenderer;
}) {
  const lines = diffAiText(before, after);
  const row = (kind: 'remove' | 'add') => {
    const text = kind === 'remove' ? before : after, viewState = kind === 'remove' ? originalState : state;
    if (!text) return null;
    const markdown = <ResearchMarkdown text={text} inline={block?.type === 'heading'} changes={{ kind, ranges: aiDiffRanges(lines, kind), counterpart: kind === 'remove' ? after : before }} />;
    return <div key={kind} className="mewiki-ai-diff-row mewiki-ai-rendered-diff-row" data-review-text-row data-kind={kind}>
      <span className="mewiki-ai-diff-sign" aria-hidden="true">{kind === 'remove' ? '−' : '+'}</span>
      <div className="mewiki-ai-review-rendered-change research-markdown"><ResearchNoteLinkContext.Provider value={{ notes: viewState.notes, symbols: viewState.symbols, terms: viewState.terms ?? [], state: viewState, sourceNoteId, openNote: onOpenNote }}>
        {block?.type === 'heading' ? createElement(`h${block.level}`, undefined, markdown) : markdown}
      </ResearchNoteLinkContext.Provider></div>
    </div>;
  };
  return <div className="mewiki-ai-text-diff mewiki-ai-word-diff">{renderPair ? renderPair(row('remove'), row('add')) : <AiReviewPair before={row('remove')} after={row('add')} />}</div>;
}
export function RenderedChange({ kind, children, added = false }: { kind: 'remove' | 'add'; children: ReactNode; added?: boolean }) {
  return <div className={`mewiki-ai-diff-row mewiki-ai-rendered-diff-row${added ? ' mewiki-ai-review-added-block' : ''}`} data-kind={kind}>
    <span className="mewiki-ai-diff-sign" aria-hidden="true">{kind === 'remove' ? '−' : '+'}</span>
    {kind === 'remove' ? <del className="mewiki-ai-review-rendered-change" aria-label={t('删除的内容')}>{children}</del>
      : <ins className="mewiki-ai-review-rendered-change" aria-label={t('新增的内容')}>{children}</ins>}
  </div>;
}
