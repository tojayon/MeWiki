import type {
  ResearchNote,
  ResearchNotebookBlock,
  ResearchNotebookState,
} from "./researchNotebook.ts";
import {
  defaultResearchNoteFilters,
  invalidateResearchReviews,
} from "./researchNoteOrganization.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";

export type ResearchNoteLibrary = "foundation" | "research";
export type ResearchNoteType = "application" | "derivation";
export const noteLibraries = [
  { value: "foundation", label: "基础理论" },
  { value: "research", label: "研究记录" },
] as const;
export const researchNoteTypes = [
  { value: "", label: "一般记录" },
  { value: "application", label: "场景应用" },
  { value: "derivation", label: "本文推导" },
] as const;
export const getNoteLibrary = (
  note: Pick<ResearchNote, "library">,
): ResearchNoteLibrary =>
  note.library === "foundation" ? "foundation" : "research";
export const currentNoteLibrary = (
  state: Pick<ResearchNotebookState, "view">,
): ResearchNoteLibrary =>
  state.view === "foundations" ? "foundation" : "research";
export const libraryNotes = (
  state: Pick<ResearchNotebookState, "notes" | "view">,
) =>
  state.notes.filter(
    (note) => getNoteLibrary(note) === currentNoteLibrary(state),
  );
export const libraryFilters = (state: ResearchNotebookState) =>
  (currentNoteLibrary(state) === "foundation"
    ? state.foundationFilters
    : state.noteFilters) ?? defaultResearchNoteFilters;
export function setLibraryFilters(
  state: ResearchNotebookState,
  filters = { ...defaultResearchNoteFilters },
): ResearchNotebookState {
  return currentNoteLibrary(state) === "foundation"
    ? { ...state, foundationFilters: filters }
    : { ...state, noteFilters: filters };
}

export function selectNoteLibrary(
  state: ResearchNotebookState,
  library: ResearchNoteLibrary,
): ResearchNotebookState {
  const active = state.notes.find((note) => note.id === state.activeNoteId);
  const selections = {
    ...state.librarySelections,
    ...(active ? { [getNoteLibrary(active)]: active.id } : {}),
  };
  const candidates = state.notes.filter(
    (note) => getNoteLibrary(note) === library,
  );
  return {
    ...state,
    librarySelections: selections,
    view: library === "foundation" ? "foundations" : "notes",
    activeNoteId:
      candidates.find((note) => note.id === selections[library])?.id ??
      candidates[0]?.id ??
      state.activeNoteId,
  };
}

export function openLibraryNote(
  state: ResearchNotebookState,
  noteId: string,
  clearFilters = true,
): ResearchNotebookState {
  const note = state.notes.find((note) => note.id === noteId);
  if (!note) return state;
  const next = selectNoteLibrary(state, getNoteLibrary(note));
  const selected = {
    ...next,
    activeNoteId: noteId,
    librarySelections: {
      ...next.librarySelections,
      [getNoteLibrary(note)]: noteId,
    },
  };
  return clearFilters ? setLibraryFilters(selected) : selected;
}

export function prepareLibraryNote(
  note: ResearchNote,
  library: ResearchNoteLibrary,
): ResearchNote {
  if (library !== "foundation") return { ...note, library };
  const blocks: ResearchNotebookBlock[] = [
    "标准结论",
    "成立条件",
    "文献出处",
    "证明摘要（可选）",
  ].flatMap((text, index) => [
    {
      id: `${note.id}:template:${index}:heading`,
      type: "heading",
      level: 2,
      text,
      ...(index === 0 ? { section: "conclusion" as const } : index === 1 ? { section: "given" as const } : {}),
    },
    { id: `${note.id}:template:${index}:text`, type: "paragraph", text: "",
      ...(index === 0 ? { section: "conclusion" as const } : index === 1 ? { section: "given" as const } : {}),
    },
  ]);
  return { ...note, library, blocks };
}

export function setNoteLibrary(
  state: ResearchNotebookState,
  noteId: string,
  library: ResearchNoteLibrary,
): ResearchNotebookState {
  const note = state.notes.find((note) => note.id === noteId);
  if (!note || getNoteLibrary(note) === library) return state;
  return openLibraryNote(
    {
      ...state,
      notes: state.notes.map((note) =>
        note.id === noteId
          ? { ...note, library, updatedAt: new Date().toISOString() }
          : note,
      ),
    },
    noteId,
  );
}

/** Explicit note citations and real formula sources share the same bidirectional navigation. */
export function noteBasisIds(note: ResearchNote): string[] {
  return [
    ...new Set([
      ...(note.basisNoteIds ?? []),
      ...flattenResearchBlocks(note.blocks).flatMap((block) =>
        block.type === "formula"
          ? (block.parts ?? []).flatMap((part) =>
              part.type === "symbol" && part.source ? [part.source.noteId] : [],
            )
          : [],
      ),
    ]),
  ].filter((id) => id !== note.id);
}
export function setNoteBasis(
  state: ResearchNotebookState,
  noteId: string,
  basisNoteIds: string[],
): ResearchNotebookState {
  const note = state.notes.find((note) => note.id === noteId);
  if (!note) return state;
  const ids = [...new Set(basisNoteIds)].filter(
    (id) =>
      id !== note.id &&
      (note.basisNoteIds?.includes(id) ||
        state.notes.some(
          (note) => note.id === id && getNoteLibrary(note) === "foundation",
        )),
  );
  if (JSON.stringify(ids) === JSON.stringify(note.basisNoteIds ?? []))
    return state;
  const notes = invalidateResearchReviews(
    state.notes.map((note) =>
      note.id === noteId
        ? { ...note, basisNoteIds: ids, updatedAt: new Date().toISOString() }
        : note,
    ),
    [noteId],
  );
  return { ...state, notes };
}

/** Initialize only generic library metadata; stored content and references stay in place. */
export function organizeResearchNoteLibraries(input: ResearchNotebookState): ResearchNotebookState {
  return (input.noteLibraryVersion ?? 0) >= 1 ? input : { ...input, noteLibraryVersion: 1 };
}
