import { describe, expect, it } from "vitest";
import { closeReadingPane, createReadingPanes, detachReadingPane, openReadingPane, selectReadingPrimary, synchronizeReadingPanes } from "./researchReadingPanes.ts";

const chain = () => openReadingPane(openReadingPane(createReadingPanes("a"), "primary", "b", "pane-b"), "pane-b", "c", "pane-c");

describe("分屏阅读链", () => {
  it("opens consecutive panes and reuses only a source's direct target", () => {
    const state = chain();
    expect(state.panes.map(pane => pane.noteId)).toEqual(["a", "b", "c"]);
    expect(openReadingPane(state, "primary", "b", "duplicate").panes).toEqual(state.panes);
    const returned = openReadingPane(state, "pane-c", "a", "cycle", "a-result", { blockId: "c-reference", linkIndex: 0 });
    expect(returned.panes.map(pane => pane.noteId)).toEqual(["a", "b", "c", "a"]);
    expect(returned.panes[3]).toMatchObject({ id: "cycle", parentId: "pane-c", blockId: "a-result", source: { blockId: "c-reference", linkIndex: 0 } });
    expect(returned.activeId).toBe("cycle");
    expect(openReadingPane(returned, "pane-c", "a", "duplicate").panes).toEqual(returned.panes);
    expect(closeReadingPane(returned, "cycle").panes).toEqual(state.panes);
  });
  it("tracks the actual reference when reopening a target and removes it on detach", () => {
    const first = { blockId: "a-intro", linkIndex: 0 };
    const second = { blockId: "a-details", linkIndex: 1 };
    const opened = openReadingPane(createReadingPanes("a"), "primary", "b", "pane-b", undefined, first);
    expect(opened.panes[1].source).toEqual(first);
    const reopened = openReadingPane(opened, "primary", "b", "duplicate", undefined, second);
    expect(reopened.panes).toHaveLength(2);
    expect(reopened.panes[1]).toMatchObject({ id: "pane-b", source: second });
    expect(openReadingPane(reopened, "pane-b", "a", "cycle").panes.map(pane => pane.noteId)).toEqual(["a", "b", "a"]);
    expect(detachReadingPane(reopened, "pane-b").panes[1].source).toBeUndefined();
  });
  it("keeps pane identity separate from note identity in mutual and self references", () => {
    const first = openReadingPane(createReadingPanes("a"), "primary", "a", "self");
    expect(first.panes.map(pane => pane.noteId)).toEqual(["a", "a"]);
    expect(first.panes[1].parentId).toBe("primary");
    const state = openReadingPane(openReadingPane(first, "self", "b", "pane-b"), "pane-b", "a", "return-a");
    expect(state.panes.map(pane => pane.noteId)).toEqual(["a", "a", "b", "a"]);
    expect(closeReadingPane(state, "self").panes).toEqual(createReadingPanes("a").panes);
    expect(openReadingPane(state, "missing", "c", "unused")).toBe(state);
  });
  it("closes a source and its attached descendants", () => {
    expect(closeReadingPane(chain(), "pane-b").panes.map(pane => pane.noteId)).toEqual(["a"]);
    expect(closeReadingPane(chain(), "primary").panes).toEqual([]);
  });
  it("keeps a detached pane and its own descendants when the source closes", () => {
    const state = detachReadingPane(chain(), "pane-b");
    const closed = closeReadingPane(state, "primary");
    expect(closed.panes.map(pane => pane.noteId)).toEqual(["b", "c"]);
    expect(closed.panes[0]).toMatchObject({ id: "primary", parentId: null });
    expect(closed.panes[1].parentId).toBe("primary");
    expect(closed.primaryNoteId).toBe("b");
  });
  it("replaces attached branches while retaining independently detached panes", () => {
    const state = detachReadingPane(chain(), "pane-c");
    const changed = openReadingPane(state, "primary", "d", "pane-d");
    expect(changed.panes.map(pane => pane.noteId)).toEqual(["a", "d", "c"]);
    expect(selectReadingPrimary(changed, "e").panes.map(pane => pane.noteId)).toEqual(["e", "c"]);
  });
  it("reopens a closed primary and removes a deleted source with its attached subtree", () => {
    const closed = closeReadingPane(chain(), "primary");
    expect(selectReadingPrimary(closed, "a").panes.map(pane => pane.noteId)).toEqual(["a"]);
    expect(synchronizeReadingPanes(chain(), "a", new Set(["a", "c"])).panes.map(pane => pane.noteId)).toEqual(["a"]);
  });
});
