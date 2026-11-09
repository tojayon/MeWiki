import { useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { CheckSquare2, FileText, Square } from 'lucide-react';
import { resolveSymbolEntry } from '../domain/researchDictionary.ts';
import { getNoteReviewStatus, noteReviewStates } from '../domain/researchNoteOrganization.ts';
import { buildResearchTagTree, type ResearchTagBranch } from '../domain/researchTags.ts';
import { Formula } from './Formula.tsx';
import ResearchTagTree from './ResearchTagTree.tsx';
import './ResearchSelection.css';
import type { ResearchChoice } from './researchChoices.ts';
export function ResearchChoiceContent({ choice, multiple, checked }: { choice: ResearchChoice; multiple?: boolean; checked?: boolean }) {
  const entry = choice.symbol;
  const status = choice.note && getNoteReviewStatus(choice.note);
  return <>
    {multiple && <span className="research-choice-checkbox" aria-hidden="true">{checked ? <CheckSquare2 size={14} /> : <Square size={14} />}</span>}
    {entry ? <span className="research-symbol-entry-formula"><Formula tex={resolveSymbolEntry(entry, Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]))).tex} /></span> : <FileText size={14} aria-hidden="true" />}
    <span className={entry ? 'research-symbol-entry-copy' : 'research-note-item-copy'}>{entry ? <strong>{choice.label}</strong> : <span>{choice.label}</span>}{choice.detail && <small>{choice.detail}</small>}</span>
    {status && <span className="research-note-status-dot" data-status={status} role="img" aria-label={noteReviewStates.find(item => item.value === status)!.label} title={noteReviewStates.find(item => item.value === status)!.label} />}
  </>;
}

export interface ResearchChoiceListHandle {
  move: (key: string, focus?: boolean) => void;
  pick: () => void;
}
function ChoiceOption({ choice, selected, highlighted, navigation, multiple, disabled, onActive, onSelect }: {
  choice: ResearchChoice; selected: boolean; highlighted: string; navigation: boolean; multiple: boolean; disabled: boolean;
  onActive: (id: string) => void; onSelect: (choice: ResearchChoice) => void;
}) {
  const id = useId();
  return <button type="button" id={id} data-research-choice="" data-choice-id={choice.id} data-note-id={choice.note?.id} data-symbol-id={choice.symbol?.id}
    className={`${choice.symbol ? 'research-symbol-entry' : 'research-note-item'}${highlighted === id ? ' is-highlighted' : ''}`}
    role={navigation ? undefined : 'option'} aria-label={choice.label} title={[choice.label, choice.detail, choice.symbol?.meaning].filter(Boolean).join('\n')}
    aria-current={selected ? navigation && choice.note ? 'page' : 'true' : undefined}
    aria-selected={navigation ? undefined : selected} disabled={disabled}
    onMouseEnter={() => onActive(id)} onFocus={() => onActive(id)} onClick={() => onSelect(choice)}>
    <ResearchChoiceContent choice={choice} multiple={multiple} checked={selected} />
  </button>;
}

export default function ResearchClassifiedList({ choices, branches: suppliedBranches, selectedId, selectedIds, activeTags, query = '', filtering = !!query.trim(), filterKey = query, storageKey, label, treeLabel = label, navigation = false, listId, className = '', listRef, onActiveChange, onSelect, disabled, empty = '没有匹配的内容' }: {
  choices: ResearchChoice[]; branches?: ResearchTagBranch<ResearchChoice>[]; selectedId?: string; selectedIds?: readonly string[]; activeTags?: string[];
  query?: string; filtering?: boolean; filterKey?: string; storageKey: string; label: string; treeLabel?: string;
  navigation?: boolean; listId?: string; className?: string; listRef?: Ref<ResearchChoiceListHandle>;
  onActiveChange?: (id: string) => void; onSelect: (choice: ResearchChoice) => void; disabled?: (choice: ResearchChoice) => boolean; empty?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState({ filterKey, id: '' });
  const highlighted = highlight.filterKey === filterKey ? highlight.id : '';
  const setHighlighted = (id: string) => setHighlight({ filterKey, id });
  const branches = useMemo(() => suppliedBranches ?? buildResearchTagTree(choices), [suppliedBranches, choices]);
  const selected = selectedIds ?? (selectedId !== undefined ? [selectedId] : []);
  const visible = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button[data-research-choice]:not(:disabled)') ?? [])].filter(button => button.getClientRects().length > 0);
  const activeOption = (options: HTMLButtonElement[]) => options.find(button => button.id === highlighted)
    ?? options.find(button => !!query.trim() && button.getAttribute('aria-label') === query.trim())
    ?? options.find(button => selected.includes(button.dataset.choiceId!))
    ?? (!navigation ? options[0] : undefined);
  const move = (key: string, focus = false) => {
    const options = visible();
    if (!options.length) return;
    const index = options.indexOf(activeOption(options)!);
    const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1 : key === 'ArrowUp' ? (index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length) : (index + 1) % options.length;
    const button = options[next]; setHighlighted(button.id);
    if (focus) button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  useImperativeHandle(listRef, () => ({ move, pick: () => activeOption(visible())?.click() }));
  useLayoutEffect(() => {
    const options = visible();
    const active = activeOption(options);
    const next = active?.id ?? '';
    onActiveChange?.(next);
  });
  return <div ref={root} id={listId} className={`research-classified-list ${className}`} role={navigation ? undefined : 'listbox'} aria-label={label} aria-multiselectable={selectedIds ? true : undefined}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || !(event.target instanceof HTMLButtonElement)) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); move(event.key, true); }
    }}>
    <ResearchTagTree branches={branches} activeId={selected.join('|')} activeTags={activeTags ?? choices.filter(choice => selected.includes(choice.id)).flatMap(choice => choice.tags ?? [])} revealActiveOnMount={!navigation && selected.length > 0}
      filtering={filtering} filterKey={filterKey} storageKey={storageKey} label={treeLabel}
      renderItem={choice => <ChoiceOption choice={choice} selected={selected.includes(choice.id)} highlighted={highlighted} navigation={navigation} multiple={!!selectedIds} disabled={disabled?.(choice) ?? false} onActive={setHighlighted} onSelect={onSelect} />}
      empty={<div className="research-note-no-results">{empty}</div>} />
  </div>;
}
