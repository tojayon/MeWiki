import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useMemo } from "react";
import { FilterX } from "lucide-react";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { defaultResearchNoteFilters, filterResearchNotes } from "../domain/researchNoteOrganization.ts";
import { buildResearchTagTree } from "../domain/researchTags.ts";
import { currentNoteLibrary, getNoteLibrary, libraryFilters, setLibraryFilters } from "../domain/researchNoteLibraries.ts";
import ResearchClassifiedList from "./ResearchClassifiedList.tsx";
import { researchNoteChoice } from './researchChoices.ts';

export default function ResearchNoteTree({ state, onChange }: {
  state: ResearchNotebookState;
  onChange: (state: ResearchNotebookState) => void;
}) {
  const locale = useLocale();
  const filters = libraryFilters(state);
  const library = currentNoteLibrary(state);
  const choices = useMemo(() => filterResearchNotes(state.notes.filter(note => getNoteLibrary(note) === library), filters).map(note => researchNoteChoice(note, {}, locale)), [state.notes, library, filters, locale]);
  const branches = useMemo(() => buildResearchTagTree(choices, filters.tag), [choices, filters.tag]);
  return <ResearchClassifiedList choices={choices} branches={branches} selectedId={state.activeNoteId} activeTags={state.notes.find(note => note.id === state.activeNoteId)?.tags} navigation
    filtering={!!filters.query.trim() || filters.status !== "all" || !!filters.tag}
    filterKey={JSON.stringify([filters.query.trim().toLocaleLowerCase(), filters.status, filters.tag.toLocaleLowerCase()])}
    storageKey="mewiki:research-note-tree-folds" label={t("筛选后的研究笔记")}
    onSelect={choice => onChange({ ...state, activeNoteId: choice.id })}
    empty={<div className="research-note-no-results"><p>{t("没有符合条件的笔记")}</p>
      <button data-ui="icon-action" className="research-small-button" onClick={() => onChange(setLibraryFilters(state, { ...defaultResearchNoteFilters }))} aria-label={t("清除筛选")} title={t("清除筛选")}><FilterX size={15} /></button>
    </div>} />;
}
