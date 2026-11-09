import {
  normalizeResearchNotebook,
  type ResearchNotebookState,
} from "../domain/researchNotebook.ts";
import { createMeWikiNotebook } from "../domain/meWikiWorkspace.ts";

export const RESEARCH_NOTEBOOK_STORAGE_KEY = "mewiki:research-notebook";
export const LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY =
  "mewiki:research-notebook:v1";

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadResearchNotebook(
  storage: Storage | undefined = browserStorage(),
  key = RESEARCH_NOTEBOOK_STORAGE_KEY,
): ResearchNotebookState {
  try {
    const value =
      storage?.getItem(key) ??
      (key === RESEARCH_NOTEBOOK_STORAGE_KEY
        ? storage?.getItem(LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY)
        : null);
    return value
      ? normalizeResearchNotebook(JSON.parse(value), createMeWikiNotebook)
      : createMeWikiNotebook();
  } catch {
    return createMeWikiNotebook();
  }
}

export function saveResearchNotebook(
  state: ResearchNotebookState,
  storage: Storage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(RESEARCH_NOTEBOOK_STORAGE_KEY, JSON.stringify(state));
    storage?.removeItem(LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY);
  } catch {
    // Keep notebook editing usable in private mode or when browser storage is full.
  }
}
