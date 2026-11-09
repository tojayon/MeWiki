import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { deleteResearchNote, normalizeResearchNotebook, updateResearchNote } from "./researchNotebook.ts";
import {
  activeTheoryMapDocument,
  addTheoryMapDocument,
  buildResearchTheoryGraph,
  copyTheoryMapDocument,
  deleteTheoryMapDocument,
  ensureTheoryMaps,
  getResearchTheoryMap,
  patchTheoryMapView,
  saveNoteViewAsMap,
  saveTheoryRelation,
  theoryReferenceKey,
  updateTheoryMapDocument,
} from "./researchTheoryMap.ts";

describe("independent theory map documents", () => {
  it("retains canonical relations whose target note was already removed before migration", () => {
    const initial = createResearchNotebook();
    const legacy = getResearchTheoryMap(initial);
    const missing = {
      id: "lost-target",
      source: { noteId: "fixture-application" },
      target: { noteId: "removed-note" },
      kind: "adaptation" as const,
      description: "保留说明",
    };
    legacy.relations.push(missing);
    const state = ensureTheoryMaps({ ...initial, theoryMap: legacy });
    expect(
      getResearchTheoryMap({ ...state, view: "maps" }).relations,
    ).toContainEqual(missing);
    expect(
      buildResearchTheoryGraph({ ...state, view: "maps" }).nodes.find(
        (node) => node.ref.noteId === "removed-note",
      )?.missing,
    ).toBe(true);
    expect(
      getResearchTheoryMap(
        normalizeResearchNotebook({ ...state, view: "maps" }),
      ).relations,
    ).toContainEqual(missing);
  });
  it("retains a deleted target note's canonical relationships as unresolved references", () => {
    let state = ensureTheoryMaps(createResearchNotebook());
    state = { ...state, view: "notes", activeNoteId: "fixture-results" };
    const relation = {
      id: "kept-target",
      source: { noteId: "fixture-summary" },
      target: { noteId: "fixture-results" },
      kind: "adaptation" as const,
      description: "评价关联",
    };
    state = saveTheoryRelation(state, relation);
    state = deleteResearchNote(state, "fixture-results");
    expect(
      getResearchTheoryMap({ ...state, view: "maps" }).relations,
    ).toContainEqual(relation);
  });
  it("does not mark an unchanged viewport as a new document version", () => {
    const state = ensureTheoryMaps(createResearchNotebook());
    const doc = activeTheoryMapDocument(state);
    expect(updateTheoryMapDocument(state, structuredClone(doc))).toBe(state);
  });
  it("stores only explicit map role overrides instead of freezing every inherited note role", () => {
    let state = addTheoryMapDocument(
      ensureTheoryMaps(createResearchNotebook()),
      "评价结构",
      ["fixture-summary"],
    );
    const annotations = getResearchTheoryMap(state).annotations.filter(
      (item) => item.ref.noteId !== "fixture-summary" || item.ref.blockId,
    );
    state = patchTheoryMapView(state, {
      annotations: [
        ...annotations,
        { ref: { noteId: "fixture-summary" }, role: "foundation" },
      ],
    });
    expect(activeTheoryMapDocument(state).annotations).toEqual([
      { ref: { noteId: "fixture-summary" }, role: "foundation" },
    ]);
  });
  it("migrates legacy topics and exact layouts once, retaining semantic note relationships", () => {
    const initial = createResearchNotebook();
    const old = getResearchTheoryMap(initial);
    old.topics = [{ id: "control", title: "关系示例", noteIds: ["fixture-definition", "fixture-application"] }, { id: "methods", title: "方法示例", noteIds: [] }, { id: "results", title: "结果示例", noteIds: [] }];
    old.scope = "topic";
    old.topicId = "control";
    old.open = true;
    old.layouts["topic:control"] = {
      positions: {
        [theoryReferenceKey({ noteId: "fixture-application" })]: { x: 45, y: 80 },
      },
      viewport: { x: 2, y: 4, zoom: 0.7 },
    };
    const state = ensureTheoryMaps({ ...initial, theoryMap: old });
    expect(state.theoryMap).toBeUndefined();
    expect(state.theoryMaps!.documents).toHaveLength(4);
    expect(
      state.theoryMaps!.documents.find((item) => item.id === "control")?.view
        .layout,
    ).toEqual(old.layouts["topic:control"]);
    expect(state.notes.flatMap((note) => note.theory?.relations ?? [])).toEqual(
      expect.arrayContaining(old.relations),
    );
    expect(state.view).toBe("maps");
    const deleted = deleteTheoryMapDocument(state, "control");
    expect(
      normalizeResearchNotebook(deleted).theoryMaps!.documents.some(
        (item) => item.id === "control",
      ),
    ).toBe(false);
  });

  it("keeps document annotations and explanatory edges isolated without invalidating note reviews", () => {
    let state = ensureTheoryMaps(createResearchNotebook());
    state = addTheoryMapDocument(state, "我的地图", [
      "fixture-summary",
      "fixture-results",
    ]);
    const first = state.theoryMaps!.activeMapId;
    state.notes = state.notes.map((note) => ({
      ...note,
      reviewStatus: "reviewed",
    }));
    const relation = {
      id: "map-link",
      source: { noteId: "fixture-summary" },
      target: { noteId: "fixture-results" },
      kind: "adaptation" as const,
      description: "讲解路径",
    };
    state = saveTheoryRelation(state, relation);
    expect(state.notes.every((note) => note.reviewStatus === "reviewed")).toBe(
      true,
    );
    state = copyTheoryMapDocument(state, first);
    const second = state.theoryMaps!.activeMapId;
    state = patchTheoryMapView(state, { relations: [] });
    expect(
      state.theoryMaps!.documents.find((item) => item.id === first)?.relations,
    ).toContainEqual(relation);
    expect(
      state.theoryMaps!.documents.find((item) => item.id === second)?.relations,
    ).toEqual([]);
    expect(
      state.notes
        .flatMap((note) => note.theory?.relations ?? [])
        .some((item) => item.id === "map-link"),
    ).toBe(false);
    state = updateResearchNote(state, "fixture-summary", { title: "修改评价" });
    expect(
      state.notes.find((note) => note.id === "fixture-results")?.reviewStatus,
    ).toBe("reviewed");
    expect(deleteTheoryMapDocument(state, second).notes).toEqual(state.notes);
  });

  it("auto-includes new and isolated notes in the protected global map", () => {
    let state = ensureTheoryMaps(createResearchNotebook());
    state = {
      ...state,
      view: "maps",
      theoryMaps: { ...state.theoryMaps!, activeMapId: "global" },
      notes: [
        ...state.notes,
        {
          id: "isolated",
          title: "独立笔记",
          createdAt: "now",
          updatedAt: "now",
          blocks: [],
        },
      ],
    };
    expect(
      buildResearchTheoryGraph(state).nodes.some(
        (node) => node.ref.noteId === "isolated",
      ),
    ).toBe(true);
    expect(deleteTheoryMapDocument(state, "global")).toBe(state);
  });

  it("keeps the note derivation view separate and saves a referenced document on demand", () => {
    let state = ensureTheoryMaps(createResearchNotebook());
    state = { ...state, view: "notes", activeNoteId: "fixture-application" };
    const count = state.theoryMaps!.documents.length;
    state = patchTheoryMapView(state, {
      open: true,
      expandedNoteIds: ["fixture-application"],
      layouts: {
        "local:fixture-application": { positions: { kept: { x: 30, y: 45 } } },
      },
    });
    expect(state.theoryMaps!.documents).toHaveLength(count);
    expect(
      buildResearchTheoryGraph(state).nodes.some(
        (node) => node.ref.noteId === "fixture-application",
      ),
    ).toBe(true);
    state = saveNoteViewAsMap(state, "关系推导专题");
    const doc = state.theoryMaps!.documents.find(
      (item) => item.id === state.theoryMaps!.activeMapId,
    )!;
    expect(doc.title).toBe("关系推导专题");
    expect(doc.view.layout.positions.kept).toEqual({ x: 30, y: 45 });
    expect(doc.noteIds).toContain("fixture-application");
    expect(JSON.stringify(doc)).not.toContain("\\boldsymbol");
  });
});
