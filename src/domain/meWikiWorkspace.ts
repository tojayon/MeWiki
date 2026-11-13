import { parseMarkdownBlocks } from "./researchMarkdown.ts";
import { normalizeResearchBlock, normalizeResearchNotebook, type ResearchNote, type ResearchNotebookState } from "./researchNotebook.ts";
import { flattenResearchBlocks, mapResearchBlocks } from "./researchBlockTree.ts";
import { meWikiManualAssetId } from "./meWikiManualAssets.ts";
import { createMeWikiExampleNotebook } from "./meWikiExamples.ts";
import { openLibraryNote } from "./researchNoteLibraries.ts";
import { researchNoteLinkUrl } from "./researchNoteLinks.ts";
import { ensureTheoryMaps, patchTheoryMapView } from "./researchTheoryMap.ts";
import { MEWIKI_MANUAL_ID } from "./meWikiManual.ts";

export { MEWIKI_MANUAL_ID } from "./meWikiManual.ts";

const manualSources = import.meta.glob("../../docs/wiki/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
function manualId(file: string) {
  const name = file.split("/").at(-1)!.replace(/\.md$/, "");
  return name === "README" ? MEWIKI_MANUAL_ID : `mewiki-manual-${name}`;
}

/** Rich examples remain in the handbook source and become ordinary editable blocks. */
function manualBlocks(source: string, title: string, noteId: string) {
  let index = 0;
  const blocks = mapResearchBlocks(parseMarkdownBlocks(source, title, () => `${noteId}:block:${++index}`), block => {
    if (block.type !== "markdown" || block.kind !== "code") return block;
    const example = /^(`{3,}|~{3,})mewiki-block[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/.exec(block.text);
    if (!example) return block;
    const value = JSON.parse(example[2], (key, value: unknown) => key === "assetId" && typeof value === "string" && value.startsWith("manual:") ? meWikiManualAssetId(value.slice(7)) : value);
    const normalized = normalizeResearchBlock(value);
    if (!normalized || normalized.type !== value.type) throw new Error(`手册示例内容块无效：${noteId}`);
    return normalized;
  });
  const ids = flattenResearchBlocks(blocks).map(block => block.id);
  if (new Set(ids).size !== ids.length) throw new Error(`手册示例内容块标识重复：${noteId}`);
  return blocks;
}

export function createMeWikiManual(now = new Date().toISOString()): ResearchNote[] {
  return Object.entries(manualSources).sort(([a], [b]) => a.endsWith("/README.md") ? -1 : b.endsWith("/README.md") ? 1 : a.localeCompare(b)).map(([file, source]) => {
    const id = manualId(file), title = /^# (.+)$/m.exec(source)?.[1] ?? "MeWiki 使用手册";
    const linked = source.replace(/\]\((?:\.\/)?([\w-]+\.md)(?:#[^)]*)?\)/g, (_match, target: string) => `](${researchNoteLinkUrl(manualId(target))})`)
      .replace(/webbench-asset:manual:([\w.-]+)/g, (_match, name: string) => `webbench-asset:${meWikiManualAssetId(name)}`);
    return { id, title, library: "research", createdAt: now, updatedAt: now, tags: ["MeWiki/使用手册"], reviewStatus: "pending",
      blocks: manualBlocks(linked, title, id) };
  });
}

export function createMeWikiNotebook(): ResearchNotebookState {
  const examples = createMeWikiExampleNotebook();
  const manual = createMeWikiManual();
  return normalizeResearchNotebook(ensureTheoryMaps({ ...examples, activeNoteId: MEWIKI_MANUAL_ID, notes: [...manual, ...examples.notes] }));
}

/** Only an explicit help action restores missing manual pages; existing edits stay intact. */
export function ensureMeWikiManual(state: ResearchNotebookState): ResearchNotebookState {
  const existing = new Set(state.notes.map(note => note.id));
  const missing = createMeWikiManual().filter(note => !existing.has(note.id));
  return missing.length ? { ...state, notes: [...state.notes, ...missing] } : state;
}

export function openMeWikiManual(state: ResearchNotebookState): ResearchNotebookState {
  return patchTheoryMapView(openLibraryNote(ensureMeWikiManual(state), MEWIKI_MANUAL_ID), { open: false });
}
