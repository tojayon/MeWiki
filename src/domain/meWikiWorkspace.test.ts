import { describe, expect, it } from "vitest";
import { loadResearchNotebook, saveResearchNotebook, RESEARCH_NOTEBOOK_STORAGE_KEY } from "../state/researchNotebookStorage.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";
import { normalizeResearchNotebook, parseResearchMarkdown, researchContentType, serializeResearchMarkdown } from "./researchNotebook.ts";
import { createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";
import { ensureMeWikiManual, openMeWikiManual } from "./meWikiWorkspace.ts";
import { patchTheoryMapView } from "./researchTheoryMap.ts";
import { getMeWikiManualCategory, isMeWikiManualNote, MEWIKI_MANUAL_CATEGORIES } from "./meWikiManual.ts";

const manualPageCount = Object.keys(import.meta.glob("../../docs/wiki/*.md", { query: "?raw", import: "default" })).length;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}

describe("MeWiki independent workspace", () => {
  it("assigns every shipped manual chapter to one subject category independent of saved metadata", () => {
    const manuals = loadResearchNotebook(memoryStorage()).notes.filter(isMeWikiManualNote);
    const chapterIds = MEWIKI_MANUAL_CATEGORIES.flatMap(category => category.chapters.map(chapter => `mewiki-manual-${chapter}`));
    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    expect([...chapterIds].sort()).toEqual(manuals.map(note => note.id).sort());
    expect(getMeWikiManualCategory({ id: "mewiki-manual-01-getting-started" })).toBe("入门与界面");
    const edited = { ...manuals.find(note => note.id === "mewiki-manual-01-getting-started")!, title: "我的入门说明", tags: ["自定义标签"] };
    expect(getMeWikiManualCategory(edited)).toBe("入门与界面");
    expect(edited.tags).toEqual(["自定义标签"]);
    expect(getMeWikiManualCategory({ id: "mewiki-manual-future-chapter" })).toBe("其他手册");
  });

  it("opens the complete manual with generic examples on first use", () => {
    const state = loadResearchNotebook(memoryStorage());
    expect(state.activeNoteId).toBe("mewiki-manual-index");
    expect(state.notes.filter(note => note.tags?.includes("MeWiki/使用手册"))).toHaveLength(manualPageCount);
    expect(state.symbols.map(entry => entry.id).sort()).toEqual(["example-a", "example-b", "example-x", "example-y"]);
    expect(state.notes.some(note => note.id.startsWith("model-") || note.id.startsWith("thesis-"))).toBe(false);
  });

  it("resolves every manual link to an existing page and preserves heading outlines", () => {
    const state = loadResearchNotebook(memoryStorage());
    const manuals = state.notes.filter(note => note.tags?.includes("MeWiki/使用手册"));
    expect(manuals).toHaveLength(manualPageCount);
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

  it("includes a real content showcase with every supported content type and portable references", () => {
    const state = loadResearchNotebook(memoryStorage());
    const note = state.notes.find(note => note.id === "mewiki-manual-21-content-showcase");
    expect(note?.title).toBe("内容类型展示");
    const blocks = flattenResearchBlocks(note!.blocks);
    expect(new Set(blocks.map(researchContentType))).toEqual(new Set([
      "heading", "paragraph", "list", "orderedList", "taskList", "quote", "code", "table", "divider", "markdown",
      "callout", "examples", "formula", "image", "audio", "video", "pdf", "file", "bookmark", "citation", "dataset", "diagram", "noteEmbed", "external", "evidence",
    ]));
    expect(blocks.filter(block => block.type === "heading").map(block => block.level)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]));
    expect(blocks.filter(block => block.type === "diagram").map(block => block.mode)).toEqual(expect.arrayContaining(["mermaid", "drawing"]));
    expect(blocks.filter(block => block.type === "dataset").map(block => block.chart?.kind)).toEqual(expect.arrayContaining(["line", "bar", "scatter"]));
    expect(new Set(blocks.map(block => block.id)).size).toBe(blocks.length);
    for (const block of blocks) {
      if (block.type !== "noteEmbed") continue;
      const source = state.notes.find(note => note.id === block.sourceNoteId);
      expect(source).toBeDefined();
      expect(block.blockIds.every(id => flattenResearchBlocks(source!.blocks).some(item => item.id === id && item.type !== "noteEmbed"))).toBe(true);
    }
    const restored = parseResearchMarkdown(serializeResearchMarkdown(note!, state.symbols, state.notes));
    expect(restored.blocks).toEqual(note!.blocks.map(block => block.type === "noteEmbed" ? { ...block, sourceNoteId: restored.id } : block));
  });

  it("adds the showcase through help without replacing edited chapters or restoring deleted examples", () => {
    const state = loadResearchNotebook(memoryStorage());
    const existing = { ...state, notes: state.notes.filter(note => !["mewiki-manual-21-content-showcase", "mewiki-example-content"].includes(note.id)) };
    const restored = ensureMeWikiManual(existing);
    expect(restored.notes.slice(0, -1)).toEqual(existing.notes);
    expect(restored.notes.at(-1)?.id).toBe("mewiki-manual-21-content-showcase");
    expect(ensureMeWikiManual(restored)).toBe(restored);
  });

  it("restores missing manual pages only on the help action and keeps user edits", () => {
    const state = loadResearchNotebook(memoryStorage());
    const edited = { ...state, notes: state.notes.filter(note => !["mewiki-manual-index", "mewiki-example-content"].includes(note.id)).map(note => note.id === "mewiki-manual-01-getting-started" ? { ...note, title: "自定义入门" } : note) };
    const help = openMeWikiManual(edited);
    expect(help.activeNoteId).toBe("mewiki-manual-index");
    expect(help.notes.filter(note => note.tags?.includes("MeWiki/使用手册"))).toHaveLength(manualPageCount);
    expect(help.notes.find(note => note.id === "mewiki-manual-01-getting-started")?.title).toBe("自定义入门");
    expect(help.notes.some(note => note.id === "mewiki-example-content")).toBe(false);
    expect(openMeWikiManual(help)).toEqual(help);
  });

  it("opens manual text even when the previous page was showing its local map", () => {
    const state = patchTheoryMapView(loadResearchNotebook(memoryStorage()), { open: true });
    expect(state.theoryMaps?.noteViewOpen).toBe(true);
    expect(openMeWikiManual(state).theoryMaps?.noteViewOpen).toBe(false);
  });

  it("restores chapters without navigating or resetting the open content and filters", () => {
    const initial = loadResearchNotebook(memoryStorage());
    const state = { ...initial, view: "dictionary" as const, noteFilters: { query: "保留筛选", status: "pending" as const, tag: "我的分类" },
      notes: initial.notes.filter(note => note.id !== "mewiki-manual-index").map(note => note.id === "mewiki-manual-01-getting-started" ? { ...note, title: "自定义入门", tags: ["我的标记"] } : note) };
    const restored = ensureMeWikiManual(state);
    expect(restored).toEqual({ ...state, notes: [...state.notes, expect.objectContaining({ id: "mewiki-manual-index" })] });
    expect(restored.notes.find(note => note.id === "mewiki-manual-01-getting-started")).toBe(state.notes.find(note => note.id === "mewiki-manual-01-getting-started"));
    expect(ensureMeWikiManual(restored)).toBe(restored);
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
