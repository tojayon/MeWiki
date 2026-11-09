import { describe, expect, it } from "vitest";
import { loadResearchNotebook, saveResearchNotebook, RESEARCH_NOTEBOOK_STORAGE_KEY } from "../state/researchNotebookStorage.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";
import { normalizeResearchNotebook } from "./researchNotebook.ts";
import { createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";
import { openMeWikiManual } from "./meWikiWorkspace.ts";
import { patchTheoryMapView } from "./researchTheoryMap.ts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}

describe("MeWiki independent workspace", () => {
  it("opens the complete manual with generic examples on first use", () => {
    const state = loadResearchNotebook(memoryStorage());
    expect(state.activeNoteId).toBe("mewiki-manual-index");
    expect(state.notes.filter(note => note.tags?.includes("MeWiki/使用手册"))).toHaveLength(20);
    expect(state.symbols.map(entry => entry.id).sort()).toEqual(["example-a", "example-b", "example-x", "example-y"]);
    expect(state.notes.some(note => note.id.startsWith("model-") || note.id.startsWith("thesis-"))).toBe(false);
  });

  it("resolves every manual link to an existing page and preserves heading outlines", () => {
    const state = loadResearchNotebook(memoryStorage());
    const manuals = state.notes.filter(note => note.tags?.includes("MeWiki/使用手册"));
    expect(manuals).toHaveLength(20);
    let count = 0;
    for (const note of manuals) {
      expect(note.blocks.some(block => block.type === "heading")).toBe(true);
      const text = flattenResearchBlocks(note.blocks).flatMap(block => "text" in block ? [block.text] : []).join("\n");
      expect(text).not.toMatch(/\]\([^)]*\.md(?:#[^)]*)?\)/);
      for (const match of text.matchAll(/\]\(#research-note\/([^\s)]+)\)/g)) {
        count++;
        expect(state.notes.some(page => page.id === decodeURIComponent(match[1]))).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(35);
  });

  it("restores missing manual pages only on the help action and keeps user edits", () => {
    const state = loadResearchNotebook(memoryStorage());
    const edited = { ...state, notes: state.notes.filter(note => !["mewiki-manual-index", "mewiki-example-content"].includes(note.id)).map(note => note.id === "mewiki-manual-01-getting-started" ? { ...note, title: "自定义入门" } : note) };
    const help = openMeWikiManual(edited);
    expect(help.activeNoteId).toBe("mewiki-manual-index");
    expect(help.notes.filter(note => note.tags?.includes("MeWiki/使用手册"))).toHaveLength(20);
    expect(help.notes.find(note => note.id === "mewiki-manual-01-getting-started")?.title).toBe("自定义入门");
    expect(help.notes.some(note => note.id === "mewiki-example-content")).toBe(false);
    expect(openMeWikiManual(help)).toEqual(help);
  });

  it("opens manual text even when the previous page was showing its local map", () => {
    const state = patchTheoryMapView(loadResearchNotebook(memoryStorage()), { open: true });
    expect(state.theoryMaps?.noteViewOpen).toBe(true);
    expect(openMeWikiManual(state).theoryMaps?.noteViewOpen).toBe(false);
  });

  it("uses the manual for unsupported or unusable browser cache instead of domain seeds", () => {
    const storage = memoryStorage();
    for (const value of [null, {}, { version: 99, notes: [] }]) {
      storage.setItem(RESEARCH_NOTEBOOK_STORAGE_KEY, JSON.stringify(value));
      expect(loadResearchNotebook(storage).activeNoteId).toBe("mewiki-manual-index");
    }
    storage.setItem(RESEARCH_NOTEBOOK_STORAGE_KEY, JSON.stringify({ version: 8, notes: [], symbols: [] }));
    expect(loadResearchNotebook(storage).notes).toEqual([]);
  });

  it("keeps edits and deleted examples through normalization and reload", () => {
    const storage = memoryStorage();
    const state = loadResearchNotebook(storage);
    const edited = { ...state, notes: state.notes.filter(note => note.id !== "mewiki-example-content").map(note => note.id === state.activeNoteId ? { ...note, title: "我的手册" } : note) };
    saveResearchNotebook(edited, storage);
    expect(loadResearchNotebook(storage)).toEqual(edited);
    expect(normalizeResearchNotebook(edited)).toEqual(edited);
    expect(RESEARCH_NOTEBOOK_STORAGE_KEY).toBe("mewiki:research-notebook");
  });

  it("exchanges the established library format without regenerating original research seeds", async () => {
    const state = loadResearchNotebook(memoryStorage());
    const file = await createResearchLibraryFile(state);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook).toEqual(state);
    expect(file.format).toBe("webbench-research-library");
    expect(restored.notebook.notes.some(note => note.id === "mewiki-manual-index")).toBe(true);
  });
});
