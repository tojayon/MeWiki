import { useId, useRef } from 'react';
import { Brain, X } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import './AiMemoryPanel.css';

export default function AiMemoryPanel({ value, count, open, disabled, onOpenChange, onChange }: {
  value: string; count: number; open: boolean; disabled: boolean; onOpenChange: (open: boolean) => void; onChange: (value: string) => void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  return <div ref={root} className="mewiki-ai-memory-control" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); onOpenChange(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" data-ui="icon-action" aria-label={t('对话记忆')} title={t('对话记忆')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}><Brain size={14} /></button>
    {open && <div id={id} role="dialog" aria-label={t('对话记忆')} className="mewiki-ai-memory-panel">
      <header><strong>{t('对话记忆')}</strong><button type="button" data-ui="icon-action" aria-label={t('关闭')} onClick={() => { onOpenChange(false); trigger.current?.focus(); }}><X size={14} /></button></header>
      <div className="mewiki-ai-memory-content">
        <p>{t`已保留 ${count} 条消息`}</p>
        <label htmlFor={`${id}-instructions`}>{t('本对话固定要求')}</label>
        <textarea id={`${id}-instructions`} rows={3} maxLength={4000} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} placeholder={t('例如：保留公式，使用简体中文，修改前先核对来源。')} />
        <p>{t('完整聊天保存在本机。AI 使用当前范围内的历史摘录和最近对话；关键要求请写在上方。')}</p>
      </div>
    </div>}
  </div>;
}
