import { describe, expect, it } from "vitest";
import { closeReadingPane, createReadingPanes, detachReadingPane, openReadingPane, synchronizeReadingPanes } from "./researchReadingPanes.ts";
import { loadReadingPanes, READING_PANES_STORAGE_KEY, saveReadingPanes } from "./researchReadingPanesStorage.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const chain = () => openReadingPane(
  openReadingPane(createReadingPanes("a"), "primary", "b", "pane-b", "b-result", { blockId: "a-body", linkIndex: 1 }),
  "pane-b", "c", "pane-c", undefined, { blockId: "b-body", linkIndex: 0 },
);

describe("阅读面板会话保存", () => {
  it("restores pane order, active pane, formula target and source relationships", () => {
    const storage = memoryStorage();
    const state = chain();
    saveReadingPanes(state, "library-a", storage);
    expect(loadReadingPanes("a", "library-a", storage)).toEqual(state);
  });

  it("keeps detached branches and intentionally closed layouts across reloads", () => {
    const storage = memoryStorage();
    const detached = detachReadingPane(chain(), "pane-b");
    saveReadingPanes(detached, "library-a", storage);
    expect(closeReadingPane(loadReadingPanes("a", "library-a", storage), "primary").panes.map(pane => pane.noteId)).toEqual(["b", "c"]);
    const closed = closeReadingPane(chain(), "primary");
    saveReadingPanes(closed, "library-a", storage);
    expect(loadReadingPanes("a", "library-a", storage)).toEqual(closed);
  });

  it("isolates library layouts and falls back to the current note without a saved session", () => {
    const storage = memoryStorage();
    saveReadingPanes(chain(), "library-a", storage);
    expect(loadReadingPanes("a", "library-b", storage)).toEqual(createReadingPanes("a"));
    saveReadingPanes(createReadingPanes("d"), "library-b", storage);
    expect(loadReadingPanes("a", "library-a", storage)).toEqual(chain());
    expect(loadReadingPanes("d", "library-b", storage)).toEqual(createReadingPanes("d"));
  });

  it("safely prunes missing notes after the library has loaded while preserving independent panes", () => {
    const storage = memoryStorage();
    const state = detachReadingPane(chain(), "pane-c");
    saveReadingPanes(state, "library-a", storage);
    expect(synchronizeReadingPanes(loadReadingPanes("a", "library-a", storage), "a", new Set(["a", "c"])).panes.map(pane => pane.noteId)).toEqual(["a", "c"]);
  });

  it("recovers from invalid data and unavailable storage without blocking reading", () => {
    const storage = memoryStorage();
    for (const raw of ["{", "null", JSON.stringify({ version: 99, reading: chain() }), JSON.stringify({ version: 1, reading: { ...chain(), panes: [{ id: "primary", noteId: "a", parentId: "primary" }] } }),
      JSON.stringify({ version: 1, reading: { ...chain(), panes: [...chain().panes, chain().panes[1]] } })]) {
      storage.setItem(READING_PANES_STORAGE_KEY + ":library-a", raw);
      expect(loadReadingPanes("a", "library-a", storage)).toEqual(createReadingPanes("a"));
    }
    const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadReadingPanes("a", "library-a", unavailable)).toEqual(createReadingPanes("a"));
    expect(() => saveReadingPanes(chain(), "library-a", unavailable)).not.toThrow();
  });

  it("uses the first remaining pane when the saved active pane no longer exists", () => {
    const storage = memoryStorage();
    saveReadingPanes({ ...chain(), activeId: "missing" }, "library-a", storage);
    expect(loadReadingPanes("a", "library-a", storage).activeId).toBe("primary");
  });
});
