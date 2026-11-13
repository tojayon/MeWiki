import { createContext } from "react";
import type { ResearchNote, ResearchNotebookState } from "../domain/researchNotebook.ts";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import type { ResearchTermEntry } from "../domain/researchTerms.ts";

export const ResearchNoteLinkContext = createContext<{
  notes: readonly ResearchNote[];
  symbols: readonly ResearchSymbolEntry[];
  terms: readonly ResearchTermEntry[];
  sourceNoteId: string;
  state: ResearchNotebookState;
  openNote: (noteId: string, blockId?: string, source?: HTMLElement) => void;
} | null>(null);
