import { useEffect, useId, useRef } from 'react';
import { Check, History, MessageSquare, Plus } from 'lucide-react';
import { aiConversationTitle } from '../ai/conversations.ts';
import type { AiSession } from '../ai/session.ts';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './AiConversationPanel.css';

export default function AiConversationPanel({ sessions, currentId, open, disabled, onOpenChange, onSelect, onCreate }: {
  sessions: AiSession[]; currentId: string; open: boolean; disabled: boolean;
  onOpenChange: (open: boolean) => void; onSelect: (session: AiSession) => void; onCreate: () => void;
}) {
  const locale = useLocale();
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);

  return <div ref={root} className="mewiki-ai-conversation-control" onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); onOpenChange(false); trigger.current?.focus({ preventScroll: true });
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
  }}>
    <button ref={trigger} type="button" data-ui="icon-action" aria-label={t('对话历史')} title={t('对话历史')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}><History size={14} aria-hidden="true" /></button>
    {open && <div id={id} role="dialog" aria-label={t('对话历史')} className="mewiki-ai-conversation-panel">
      <header><strong>{t('对话历史')}</strong><button type="button" disabled={disabled} onClick={onCreate}><Plus size={14} aria-hidden="true" /><span>{t('新建对话')}</span></button></header>
      <ol className="mewiki-ai-conversation-list" tabIndex={0} aria-label={t('对话历史')}>
        {sessions.map(session => <li key={session.conversationId}>
          <button type="button" aria-label={aiConversationTitle(session) || t('新对话')} aria-current={session.conversationId === currentId ? 'true' : undefined} disabled={disabled} title={aiConversationTitle(session) || t('新对话')} onClick={() => onSelect(session)}>
            <MessageSquare size={14} aria-hidden="true" /><span>{aiConversationTitle(session) || t('新对话')}</span>
            {session.conversationId === currentId ? <Check size={14} aria-hidden="true" /> : session.updatedAt ? <time dateTime={session.updatedAt} title={new Date(session.updatedAt).toLocaleString(locale)}>{date.format(new Date(session.updatedAt))}</time> : null}
          </button>
        </li>)}
      </ol>
    </div>}
  </div>;
}
