import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useMemo } from "react";
import { FilterX } from "lucide-react";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { defaultResearchNoteFilters, filterResearchNotes } from "../domain/researchNoteOrganization.ts";
import { buildResearchTagTree } from "../domain/researchTags.ts";
import { currentNoteLibrary, getNoteLibrary, libraryFilters, openLibraryNote, setLibraryFilters, type ResearchNoteLibrary } from "../domain/researchNoteLibraries.ts";
import ResearchClassifiedList from "./ResearchClassifiedList.tsx";
import { researchNoteChoice } from './researchChoices.ts';
import { isMeWikiManualNote } from "../domain/meWikiManual.ts";

export default function ResearchNoteTree({ state, library = currentNoteLibrary(state), onChange }: {
  state: ResearchNotebookState;
  library?: ResearchNoteLibrary;
  onChange: (state: ResearchNotebookState) => void;
}) {
  const locale = useLocale();
  const filters = libraryFilters(state, library);
  const foldingItems = useMemo(() => state.notes.filter(note => !isMeWikiManualNote(note)), [state.notes]);
  const choices = useMemo(() => filterResearchNotes(state.notes.filter(note => getNoteLibrary(note) === library && !isMeWikiManualNote(note)), filters).map(note => researchNoteChoice(note, {}, locale)), [state.notes, library, filters, locale]);
  const branches = useMemo(() => buildResearchTagTree(choices, filters.tag), [choices, filters.tag]);
  return <ResearchClassifiedList choices={choices} branches={branches} foldingItems={foldingItems} selectedId={state.activeNoteId} activeTags={state.notes.find(note => note.id === state.activeNoteId)?.tags} navigation
    filtering={!!filters.query.trim() || filters.status !== "all" || !!filters.tag}
    filterKey={JSON.stringify([filters.query.trim().toLocaleLowerCase(), filters.status, filters.tag.toLocaleLowerCase()])}
    storageKey="mewiki:research-note-tree-folds" label={t("筛选后的研究笔记")}
    onSelect={choice => onChange(openLibraryNote(state, choice.id, false))}
    empty={<div className="research-note-no-results"><p>{t("没有符合条件的笔记")}</p>
      <button data-ui="icon-action" className="research-small-button" onClick={() => onChange(setLibraryFilters(state, { ...defaultResearchNoteFilters }, library))} aria-label={t("清除筛选")} title={t("清除筛选")}><FilterX size={15} /></button>
    </div>} />;
}
