import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { ChartNoAxesColumn } from 'lucide-react';
import type { AiSession } from '../ai/session.ts';
import { currentAiUsage } from '../ai/usage.ts';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './AiUsagePanel.css';

export default function AiUsagePanel({ session, open, onOpenChange }: { session: AiSession; open: boolean; onOpenChange: (open: boolean) => void }) {
  const locale = useLocale();
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const running = session.status === 'running';
  const records = [...(session.usageHistory ?? []), ...(running ? [currentAiUsage(session)] : [])].reverse();
  const numbers = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });

  useLayoutEffect(() => {
    const control = root.current;
    const workspace = control?.closest('.mewiki-ai-workspace');
    const composer = control?.closest('form');
    if (!open || !control || !workspace || !composer) return;
    const place = () => {
      const headerHeight = control.querySelector('header')?.getBoundingClientRect().height ?? 34;
      control.style.setProperty('--ai-usage-max-height', `${Math.max(0, composer.getBoundingClientRect().top - workspace.getBoundingClientRect().top - headerHeight - 10)}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(workspace); observer.observe(composer);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);

  return <div ref={root} className="mewiki-ai-usage-control" onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); onOpenChange(false); trigger.current?.focus({ preventScroll: true });
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
  }}>
    <button ref={trigger} type="button" data-ui="icon-action" aria-label={t('Token 使用记录')} title={t('Token 使用记录')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => {
      onOpenChange(!open);
    }}><ChartNoAxesColumn size={14} aria-hidden="true" /></button>
    {open && <div id={id} role="dialog" aria-label={t('Token 使用记录')} className="mewiki-ai-usage-panel">
      <header><strong>{t('Token 使用记录')}</strong><span>{t('输入')}</span><span>{t('输出')}</span></header>
      {records.length ? <ol tabIndex={0} aria-label={t('Token 使用记录')} className="mewiki-ai-usage-list">{records.map((entry, index) => <li key={`${entry.completedAt ?? 'current'}-${index}`}>
        <div className="mewiki-ai-usage-task">
          <span title={entry.prompt}>{entry.prompt || t('AI')}</span>
          <small title={`${entry.providerName} · ${entry.model}`}>
            {running && index === 0 ? <span>{t('任务执行中…')}</span> : entry.completedAt ? <time dateTime={entry.completedAt} title={new Date(entry.completedAt).toLocaleString(locale)}>{time.format(new Date(entry.completedAt))}</time> : null}
            <span>{entry.model || entry.providerName}</span>
          </small>
        </div>
        <span className="mewiki-ai-usage-input" title={`${t('输入')} ${entry.inputTokens} tokens`} aria-label={`${t('输入')} ${entry.inputTokens} tokens`}>{numbers.format(entry.inputTokens)}</span>
        <span className="mewiki-ai-usage-output" title={`${t('输出')} ${entry.outputTokens} tokens`} aria-label={`${t('输出')} ${entry.outputTokens} tokens`}>{numbers.format(entry.outputTokens)}</span>
      </li>)}</ol> : <p className="mewiki-ai-usage-empty">{t('暂无使用记录')}</p>}
    </div>}
  </div>;
}
