import { createElement, type ReactNode } from 'react';
import type { AiDiffLine } from '../ai/diff.ts';
import type { TextBlock } from '../ai/reviewContent.ts';
import { t } from '../i18n/locale.ts';

export function TextDiff({ lines, block }: { lines: AiDiffLine[]; block?: TextBlock }) {
  return <div className={`mewiki-ai-text-diff${block ? ' research-markdown mewiki-ai-rendered-text-diff' : ''}`}>{lines.map((line, index) => {
    const content = line.parts.map((part, i) => part.changed ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>);
    const change = line.kind === 'remove' ? <del aria-label={t('删除的内容')}>{content}</del> : line.kind === 'add' ? <ins aria-label={t('新增的内容')}>{content}</ins> : content;
    return <div key={index} className="mewiki-ai-diff-row" data-kind={line.kind}>
      <span className="mewiki-ai-diff-number" aria-hidden="true">{line.beforeLine}</span><span className="mewiki-ai-diff-number" aria-hidden="true">{line.afterLine}</span>
      <span className="mewiki-ai-diff-sign" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</span>
      {block ? <div className="mewiki-ai-diff-text">{createElement(block.type === 'heading' ? `h${block.level}` : 'p', undefined, change)}</div>
        : <span className="mewiki-ai-diff-text">{change}</span>}
    </div>;
  })}</div>;
}
export function RenderedChange({ kind, children, added = false }: { kind: 'remove' | 'add'; children: ReactNode; added?: boolean }) {
  return <div className={`mewiki-ai-diff-row mewiki-ai-rendered-diff-row${added ? ' mewiki-ai-review-added-block' : ''}`} data-kind={kind}>
    <span className="mewiki-ai-diff-sign" aria-hidden="true">{kind === 'remove' ? '−' : '+'}</span>
    {kind === 'remove' ? <del className="mewiki-ai-review-rendered-change" aria-label={t('删除的内容')}>{children}</del>
      : <ins className="mewiki-ai-review-rendered-change" aria-label={t('新增的内容')}>{children}</ins>}
  </div>;
}
