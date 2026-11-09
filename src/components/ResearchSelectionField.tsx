import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import ResearchClassifiedList, { ResearchChoiceContent, type ResearchChoiceListHandle } from './ResearchClassifiedList.tsx';
import { filterResearchChoices, type ResearchChoice } from './researchChoices.ts';

function SelectionPopup({ label, choices, selectedId, placeholder, onSelect, onClose, anchor, id }: {
  label: string; choices: ResearchChoice[]; selectedId: string; placeholder: string; onSelect: (choice: ResearchChoice) => void; onClose: () => void; anchor: HTMLButtonElement; id: string;
}) {
  const popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), list = useRef<ResearchChoiceListHandle>(null);
  const [query, setQuery] = useState(''), [active, setActive] = useState('');
  const filtered = filterResearchChoices(choices, query);
  useLayoutEffect(() => {
    const element = popup.current!;
    const place = () => {
      const viewport = window.visualViewport, offsetLeft = viewport?.offsetLeft ?? 0, offsetTop = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      element.style.maxHeight = `${Math.max(100, Math.min(420, height - 24))}px`;
      const from = anchor.getBoundingClientRect(), rect = element.getBoundingClientRect();
      element.style.left = `${Math.max(offsetLeft + 12, Math.min(from.left, offsetLeft + width - rect.width - 12))}px`;
      element.style.top = `${Math.max(offsetTop + 12, Math.min(from.bottom + 6, offsetTop + height - rect.height - 12))}px`;
    };
    element.showPopover(); place(); search.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place); observer.observe(element);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [anchor]);
  return <div ref={popup} id={id} popover="auto" role="dialog" aria-label={label} className="research-selection-popup" data-popover-no-drag=""
    onToggle={event => { if (event.newState === 'closed') onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); onClose(); anchor.focus({ preventScroll: true }); } }}>
    <header><strong>{label}</strong><button type="button" aria-label={`关闭${label}`} title="关闭" onClick={() => { onClose(); anchor.focus({ preventScroll: true }); }}><X size={14} /></button></header>
    <label className="research-choice-search"><Search size={14} aria-hidden="true" /><input ref={search} type="search" aria-label={`搜索${label}`} placeholder={placeholder} value={query}
      aria-controls={`${id}-list`} aria-activedescendant={active || undefined} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); list.current?.move(event.key); }
        if (event.key === 'Enter') { event.preventDefault(); list.current?.pick(); }
      }} /></label>
    <ResearchClassifiedList choices={filtered} selectedId={selectedId} activeTags={choices.find(choice => choice.id === selectedId)?.tags} query={query} label={label} storageKey={`mewiki:selection-folds:${label}`} listId={`${id}-list`} listRef={list} onActiveChange={setActive} onSelect={choice => { onSelect(choice); onClose(); anchor.focus({ preventScroll: true }); }} />
  </div>;
}

export default function ResearchSelectionField({ label, choices, value, onChange, placeholder = '搜索名称或标签', emptyLabel = '请选择', disabled = false, title }: {
  label: string; choices: ResearchChoice[]; value: string; onChange: (id: string) => void; placeholder?: string; emptyLabel?: string; disabled?: boolean; title?: string;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const choice = choices.find(item => item.id === value);
  return <span className="research-selection-field" data-popover-no-drag="">
    <button ref={setAnchor} type="button" className="research-selection-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls={open ? id : undefined} title={title ?? (choice ? [choice.label, choice.detail].filter(Boolean).join(' · ') : emptyLabel)} disabled={disabled} onClick={() => setOpen(previous => !previous)}>
      <span className="research-selection-current">{choice ? <ResearchChoiceContent choice={choice} /> : <span>{emptyLabel}</span>}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && !disabled && anchor && <SelectionPopup id={id} label={label} choices={choices} selectedId={value} placeholder={placeholder} anchor={anchor} onSelect={choice => onChange(choice.id)} onClose={() => setOpen(false)} />}
  </span>;
}
