import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import {
  loadResearchNotebook, LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY, RESEARCH_NOTEBOOK_STORAGE_KEY, saveResearchNotebook, } from "./researchNotebookStorage.ts";


function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("research notebook browser storage", () => {
  it("persists note contents and whether the notebook is open across reloads", () => {
    const storage = memoryStorage();
    const state = createResearchNotebook();
    const edited = {
      ...state,
      open: true,
      notes: [
        {
          ...state.notes[0],
          blocks: [
            ...state.notes[0].blocks,
            { id: "p", type: "paragraph" as const, text: "竞争工况观察" },
          ],
        },
      ],
    };
    saveResearchNotebook(edited, storage);
    expect(loadResearchNotebook(storage)).toEqual(edited);
    expect(storage.getItem(RESEARCH_NOTEBOOK_STORAGE_KEY)).toContain(
      "竞争工况观察",
    );
  });

  it("recovers from invalid JSON and unavailable storage", () => {
    const storage = memoryStorage();
    storage.setItem(RESEARCH_NOTEBOOK_STORAGE_KEY, "{");
    expect(loadResearchNotebook(storage).activeNoteId).toBe("mewiki-manual-index");
    expect(loadResearchNotebook(undefined).activeNoteId).toBe("mewiki-manual-index");
    expect(() => saveResearchNotebook(createResearchNotebook(), undefined)).not.toThrow();
  });

  it("reads earlier notebook data before writing it back in the new structured format", () => {
    const storage = memoryStorage();
    const original = createResearchNotebook();
    const legacy = { version: 1, open: true, activeNoteId: original.notes[0].id, notes: [original.notes[0]] };
    storage.setItem(LEGACY_RESEARCH_NOTEBOOK_STORAGE_KEY, JSON.stringify(legacy));
    const migrated = loadResearchNotebook(storage);
    expect(migrated.version).toBe(8);
    expect(migrated.notes[0]).toEqual(original.notes[0]);
    expect(migrated.notes.filter((note) => note.library === "foundation")).toHaveLength(1);
    saveResearchNotebook(migrated, storage);
    expect(loadResearchNotebook(storage)).toEqual(migrated);
  });
});
