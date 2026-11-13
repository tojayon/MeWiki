import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import type { ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { filterResearchSymbols } from '../domain/researchSymbolOrganization.ts';
import ResearchClassifiedList, { type ResearchChoiceListHandle } from './ResearchClassifiedList.tsx';
import { researchSymbolChoice } from './researchChoices.ts';
import './ResearchDictionary.css';

export default function ResearchFormulaSymbolPicker({ entries, selectedId, query, inputRef, inserting, onQueryChange, onSelect }: {
  entries: ResearchSymbolEntry[]; selectedId: string; query: string; inputRef: RefObject<HTMLInputElement | null>; inserting: boolean;
  onQueryChange: (value: string) => void; onSelect: (id: string) => void;
}) {
  useLocale();
  const list = useRef<ResearchChoiceListHandle>(null);
  const [active, setActive] = useState('');
  const id = useId();
  const choices = useMemo(() => filterResearchSymbols(entries, { query, tag: '' }).map(researchSymbolChoice), [entries, query]);
  return <section className="research-formula-symbol-browser" aria-label={t("符号词典选择")} data-popover-no-drag="">
    <div className="research-formula-symbol-search-row"><div className="research-formula-symbol-search">
      <Search size={14} aria-hidden="true" />
      <input ref={inputRef} type="search" data-ui="search-input" aria-label={t("搜索公式符号")} placeholder={t("搜索符号或标签")}
        title={t`按名称、记号、含义或标签定位；方向键选择，回车${inserting ? t('插入') : t('选用')}`}
        aria-controls={id} aria-activedescendant={active || undefined} value={query} onChange={event => onQueryChange(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); list.current?.move(event.key, true); }
          else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); list.current?.pick(); }
        }} />
      {query && <button type="button" aria-label={t("清除符号搜索")} title={t("清除符号搜索")} onClick={() => { onQueryChange(''); inputRef.current?.focus({ preventScroll: true }); }}><X size={13} /></button>}
    </div></div>
    <ResearchClassifiedList choices={choices} selectedId={selectedId} activeTags={entries.find(entry => entry.id === selectedId)?.tags} query={query} listId={id} listRef={list} onActiveChange={setActive}
      className="research-dictionary-list" label={t("候选符号词条")} storageKey="mewiki:research-formula-symbol-tree-folds" onSelect={choice => onSelect(choice.id)} empty={t("没有匹配的符号词条")} />
  </section>;
}
