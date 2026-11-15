import { useEffect, useId, useRef, useState } from 'react';
import { AtSign, BookOpen, Check, FileText, Layers, LibraryBig, Network, Search, Sigma, X } from 'lucide-react';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { searchAiReferences, type AiReferenceItem } from '../ai/references.ts';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './AiReferencePicker.css';

export interface AiReferencePickerProps {
  state: ResearchNotebookState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: AiReferenceItem) => void;
  current?: AiReferenceItem;
  libraryScope: boolean;
  selectionLocked: boolean;
  onPinCurrent: () => void;
  onLibraryScopeChange: (enabled: boolean) => void;
  initialQuery?: string;
  disabled?: boolean;
}

const icons = { module: Layers, note: FileText, symbol: Sigma, term: BookOpen, map: Network };

/** Object references and explicit library authorization share one entry; modules remain metadata. */
export default function AiReferencePicker({ state, open, onOpenChange, onSelect, current, libraryScope, selectionLocked, onPinCurrent, onLibraryScopeChange, initialQuery = '', disabled = false }: AiReferencePickerProps) {
  useLocale();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
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
  function choose(item: AiReferenceItem) {
    if (disabled) return;
    close(); onSelect(item);
  }

  return <div ref={root} className="mewiki-ai-reference-control" onKeyDown={event => {
    if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault(); event.stopPropagation(); close();
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
  }}>
    <button ref={trigger} type="button" data-ui="icon-action" aria-label={t('添加对象引用')} title={t('添加对象引用')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => onOpenChange(!open)}><AtSign size={15} aria-hidden="true" /></button>
    {open && <AiReferenceOptions key={initialQuery} state={state} id={id} initialQuery={initialQuery} disabled={disabled} onSelect={choose} onClose={close} current={current} libraryScope={libraryScope} selectionLocked={selectionLocked} onPinCurrent={() => { close(); onPinCurrent(); }} onLibraryScopeChange={enabled => { close(); onLibraryScopeChange(enabled); }} />}
  </div>;
}

function AiReferenceOptions({ state, id, initialQuery, disabled, onSelect, onClose, current, libraryScope, selectionLocked, onPinCurrent, onLibraryScopeChange }: {
  state: ResearchNotebookState; id: string; initialQuery: string; disabled: boolean;
  onSelect: (item: AiReferenceItem) => void; onClose: () => void;
} & Pick<AiReferencePickerProps, 'current' | 'libraryScope' | 'selectionLocked' | 'onPinCurrent' | 'onLibraryScopeChange'>) {
  useLocale();
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null), composing = useRef(false);
  const [query, setQuery] = useState(initialQuery), [active, setActive] = useState(0);
  const needle = query.normalize('NFKC').toLocaleLowerCase().trim();
  const matches = (words: string[]) => !needle || words.some(word => word.toLocaleLowerCase().includes(needle));
  const currentLabels = { note: t('当前笔记'), symbol: t('当前符号'), term: t('当前术语'), map: t('当前地图'), module: t('当前页面') };
  const results = [
    ...(current && matches([t('当前页面'), currentLabels[current.kind], 'current page', '当前页面', '当前笔记', '当前符号', '当前术语', '当前地图']) ? [{ key: 'current', label: currentLabels[current.kind], detail: current.label, icon: icons[current.kind], blocked: selectionLocked, choose: onPinCurrent }] : []),
    ...(matches([t('整库检索'), '整库检索', '当前资料库', '资料库', '整个资料库', 'library', 'search library']) ? [{ key: 'library', label: t('整库检索'), detail: selectionLocked ? t('选区任务仅处理引用区域') : t('当前资料库，不含使用手册'), icon: LibraryBig, blocked: selectionLocked, choose: () => onLibraryScopeChange(!libraryScope) }] : []),
    ...searchAiReferences(state, query).map(item => ({ key: JSON.stringify([item.kind, item.id]), label: item.label, detail: item.kind === 'module' ? `${t('功能模块')} · ${item.detail}` : item.detail, icon: icons[item.kind], blocked: false, choose: () => onSelect(item) })),
  ], listId = `${id}-list`;
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const container = list.current, option = container?.children[activeIndex];
    if (!container || !(option instanceof HTMLElement)) return;
    const top = option.offsetTop - container.offsetTop, bottom = top + option.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
  }, [activeIndex]);

  return <div ref={root} id={id} role="dialog" aria-label={t('添加对象引用')} className="mewiki-ai-reference-picker">
      <header>
        <div><strong>{t('引用对象')}</strong><button type="button" data-ui="icon-action" aria-label={t('关闭')} title={t('关闭')} onClick={onClose}><X size={14} aria-hidden="true" /></button></div>
        <label><Search size={14} aria-hidden="true" /><input ref={input} type="search" role="combobox" autoComplete="off" aria-label={t('搜索笔记、符号、术语或地图')} aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={results[activeIndex] ? `${id}-option-${activeIndex}` : undefined} placeholder={t('搜索笔记、符号、术语或地图')} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current) { event.stopPropagation(); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); event.stopPropagation();
            setActive(results.length ? (activeIndex + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length : 0);
          } else if (event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation();
            if (results[activeIndex] && !disabled && !results[activeIndex].blocked) results[activeIndex].choose();
          }
        }} /></label>
      </header>
      <ul ref={list} id={listId} role="listbox" aria-label={t('引用对象')} className="mewiki-ai-reference-list">
        {results.map((item, index) => {
          const Icon = item.icon;
          return <li key={item.key} id={`${id}-option-${index}`} role="option" aria-selected={index === activeIndex} aria-disabled={disabled || item.blocked || undefined}>
            <button type="button" tabIndex={-1} aria-label={item.label} aria-pressed={item.key === 'library' ? libraryScope : undefined} disabled={disabled || item.blocked} title={[item.label, item.detail].filter(Boolean).join('\n')} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={item.choose}><Icon size={15} aria-hidden="true" /><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>{item.key === 'library' && libraryScope && <Check size={14} aria-hidden="true" />}</button>
          </li>;
        })}
      </ul>
      {!results.length && <p className="mewiki-ai-reference-empty" role="status">{t('未找到可引用的对象')}</p>}
  </div>;
}
