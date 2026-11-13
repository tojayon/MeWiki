import { useMemo } from "react";
import { Search, X } from "lucide-react";
import { useLocale } from "../i18n/react.ts";
import { t, translate } from "../i18n/locale.ts";
import { getMeWikiManualCategory, isMeWikiManualNote, MEWIKI_MANUAL_CATEGORIES, MEWIKI_MANUAL_ID } from "../domain/meWikiManual.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { buildResearchTagTree } from "../domain/researchTags.ts";
import ResearchClassifiedList from "./ResearchClassifiedList.tsx";
import ResearchTagTreeToolbar from "./ResearchTagTreeToolbar.tsx";
import { filterResearchChoices, researchNoteChoice } from "./researchChoices.ts";

export default function ResearchManualSidebar({ state, query, onQuery, onOpenNote, onClose }: {
  state: ResearchNotebookState;
  query: string;
  onQuery: (query: string) => void;
  onOpenNote: (id: string) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const allChoices = useMemo(() => state.notes.filter(isMeWikiManualNote)
    .sort((a, b) => a.id === MEWIKI_MANUAL_ID ? -1 : b.id === MEWIKI_MANUAL_ID ? 1 : a.id.localeCompare(b.id, "en", { numeric: true }))
    .map(note => {
      const choice = researchNoteChoice(note, {}, locale);
      const category = getMeWikiManualCategory(note);
      const label = translate(category, [], locale);
      return { ...choice, tags: [label], searchText: `${choice.searchText} ${category} ${label}` };
    }), [state.notes, locale]);
  const choices = useMemo(() => filterResearchChoices(allChoices, query), [allChoices, query]);
  const branches = useMemo(() => {
    const order = new Map(MEWIKI_MANUAL_CATEGORIES.map((category, index) => [translate(category.label, [], locale), index]));
    return buildResearchTagTree(choices).sort((a, b) => (order.get(a.path) ?? order.size) - (order.get(b.path) ?? order.size));
  }, [choices, locale]);
  return <aside id="research-manual-sidebar" className="research-notebook-sidebar" aria-label={t("使用手册")}>
    <div className="research-note-list-tools">
      <div className="research-note-search-row">
        <label className="research-note-search">
          <Search size={13} aria-hidden="true" />
          <input data-ui="search-input" aria-label={t("搜索使用手册")} placeholder={t("搜索手册章节")}
            value={query} onChange={event => onQuery(event.target.value)} />
        </label>
        <button type="button" data-ui="icon-action" className="research-note-filter-button"
          aria-label={t("关闭使用手册")} title={t("关闭使用手册")} onClick={onClose}><X size={15} /></button>
        <ResearchTagTreeToolbar />
      </div>
    </div>
    <ResearchClassifiedList choices={choices} branches={branches} foldingItems={allChoices}
      selectedId={state.activeNoteId} navigation query={query} storageKey="mewiki:manual-tree-folds" label={t("使用手册章节")}
      onSelect={choice => onOpenNote(choice.id)} empty={t("没有匹配的手册章节")} />
  </aside>;
}
