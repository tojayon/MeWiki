import { createContext } from "react";
import type { ResearchNote, ResearchNotebookState } from "../domain/researchNotebook.ts";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";

export const ResearchNoteLinkContext = createContext<{
  notes: readonly ResearchNote[];
  symbols: readonly ResearchSymbolEntry[];
  sourceNoteId: string;
  state: ResearchNotebookState;
  openNote: (noteId: string, blockId?: string, source?: HTMLElement) => void;
} | null>(null);
