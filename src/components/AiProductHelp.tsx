import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Database, FileText, HelpCircle, Layers, Network, Search, Sigma, X } from 'lucide-react';
import { findAiProductModules, type AiProductModuleId } from '../ai/productCatalog.ts';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './AiProductHelp.css';

export interface AiProductHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenModule: (id: AiProductModuleId) => void;
}

const icons = { symbols: Sigma, terms: BookOpen, foundations: Layers, notes: FileText, maps: Network, library: Database, manual: HelpCircle };

export default function AiProductHelp({ open, onOpenChange, onOpenModule }: AiProductHelpProps) {
  useLocale();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), composing = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);
  function close() {
    onOpenChange(false); trigger.current?.focus({ preventScroll: true });
  }
  return <div ref={root} className="mewiki-ai-product-help-control" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
    if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing || composing.current) return;
    event.preventDefault(); event.stopPropagation(); close();
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
  }}>
    <button ref={trigger} type="button" data-ui="icon-action" aria-label={t('觅维功能')} title={t('觅维功能')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => onOpenChange(!open)}><HelpCircle size={14} aria-hidden="true" /></button>
    {open && <AiProductHelpContent id={id} onClose={close} onOpenModule={moduleId => { onOpenChange(false); onOpenModule(moduleId); }} />}
  </div>;
}

function AiProductHelpContent({ id, onClose, onOpenModule }: { id: string; onClose: () => void; onOpenModule: (id: AiProductModuleId) => void }) {
  const locale = useLocale(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const modules = findAiProductModules(query);
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={root} id={id} role="dialog" aria-label={t('觅维功能')} className="mewiki-ai-product-help-panel">
    <header>
      <div><strong>{t('觅维功能')}</strong><button type="button" data-ui="icon-action" aria-label={t('关闭')} title={t('关闭')} onClick={onClose}><X size={14} aria-hidden="true" /></button></div>
      <label><Search size={14} aria-hidden="true" /><input ref={input} type="search" autoComplete="off" aria-label={t('搜索功能名称或别称')} placeholder={t('搜索功能名称或别称')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); }
      }} /></label>
    </header>
    <div className="mewiki-ai-product-help-content">
      {modules.length ? <ul className="mewiki-ai-product-help-list">{modules.map(module => {
        const Icon = icons[module.id];
        const aliases = module.aliases.filter(alias => /[\u3400-\u9fff]/.test(alias) === (locale === 'zh-CN'));
        return <li key={module.id}>
          <button type="button" onClick={() => onOpenModule(module.id)}><Icon size={15} aria-hidden="true" /><strong>{t(module.name)}</strong><ArrowUpRight size={13} aria-hidden="true" /></button>
          {!!aliases.length && <p className="mewiki-ai-product-help-aliases">{aliases.join(' · ')}</p>}
          <p>{t(module.description)}</p>
          <ul className="mewiki-ai-product-help-actions">{module.actions.map(action => <li key={action}>{t(action)}</li>)}</ul>
        </li>;
      })}</ul> : <p className="mewiki-ai-product-help-empty" role="status">{t('未找到匹配的功能')}</p>}
    </div>
  </div>;
}
