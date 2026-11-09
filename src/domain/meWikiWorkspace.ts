import { parseMarkdownBlocks } from "./researchMarkdown.ts";
import { normalizeResearchNotebook, type ResearchNote, type ResearchNotebookState } from "./researchNotebook.ts";
import { createMeWikiExampleNotebook } from "./meWikiExamples.ts";
import { openLibraryNote } from "./researchNoteLibraries.ts";
import { researchNoteLinkUrl } from "./researchNoteLinks.ts";
import { ensureTheoryMaps, patchTheoryMapView } from "./researchTheoryMap.ts";

const manualSources = import.meta.glob("../../docs/wiki/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const MEWIKI_MANUAL_ID = "mewiki-manual-index";
function manualId(file: string) {
  const name = file.split("/").at(-1)!.replace(/\.md$/, "");
  return name === "README" ? MEWIKI_MANUAL_ID : `mewiki-manual-${name}`;
}

export function createMeWikiManual(now = new Date().toISOString()): ResearchNote[] {
  return Object.entries(manualSources).sort(([a], [b]) => a.endsWith("/README.md") ? -1 : b.endsWith("/README.md") ? 1 : a.localeCompare(b)).map(([file, source]) => {
    const id = manualId(file), title = /^# (.+)$/m.exec(source)?.[1] ?? "MeWiki 使用手册";
    const linked = source.replace(/\]\((?:\.\/)?([\w-]+\.md)(?:#[^)]*)?\)/g, (_match, target: string) => `](${researchNoteLinkUrl(manualId(target))})`);
    let index = 0;
    return { id, title, library: "research", createdAt: now, updatedAt: now, tags: ["MeWiki/使用手册"], reviewStatus: "pending",
      blocks: parseMarkdownBlocks(linked, title, () => `${id}:block:${++index}`) };
  });
}

export function createMeWikiNotebook(): ResearchNotebookState {
  const examples = createMeWikiExampleNotebook();
  const manual = createMeWikiManual();
  return normalizeResearchNotebook(ensureTheoryMaps({ ...examples, activeNoteId: MEWIKI_MANUAL_ID, notes: [...manual, ...examples.notes] }));
}

/** Only an explicit help action restores missing manual pages; existing edits stay intact. */
export function openMeWikiManual(state: ResearchNotebookState): ResearchNotebookState {
  const existing = new Set(state.notes.map(note => note.id));
  const notes = [...state.notes, ...createMeWikiManual().filter(note => !existing.has(note.id))];
  return patchTheoryMapView(openLibraryNote({ ...state, notes }, MEWIKI_MANUAL_ID), { open: false });
}
