import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { normalizeResearchNotebook, updateResearchNote, type ResearchNotebookState } from "./researchNotebook.ts";
import {
  buildResearchTheoryGraph,
  getResearchTheoryMap,
  normalizeResearchTheoryMap,
  saveTheoryRelation,
  removeTheoryRelation,
  theoryReferenceKey,
  theoryRelationError,
  type TheoryReference,
} from "./researchTheoryMap.ts";

const gain: TheoryReference = { noteId: "basis", blockId: "gain" };
const command: TheoryReference = { noteId: "scenario", blockId: "command" };
const assumption: TheoryReference = {
  noteId: "scenario",
  blockId: "assumption",
};
function fixture(): ResearchNotebookState {
  const base = createResearchNotebook();
  const dates = {
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
    reviewStatus: "reviewed" as const,
    tags: [],
  };
  const state: ResearchNotebookState = {
    ...base,
    activeNoteId: "scenario",
    notes: [
      {
        ...dates,
        id: "basis",
        title: "通用设计",
        blocks: [
          {
            id: "gain",
            type: "formula",
            tex: "K=P",
            caption: "增益设计",
            outputs: [{ id: "result", entryId: "example-matrix", bindings: {} }],
          },
        ],
      },
      {
        ...dates,
        id: "scenario",
        title: "场景反馈",
        blocks: [
          {
            id: "command",
            type: "formula",
            tex: "u=-Kx",
            caption: "场景控制律",
            parts: [
              {
                type: "symbol",
                entryId: "example-matrix",
                bindings: {},
                source: {
                  noteId: "basis",
                  formulaId: "gain",
                  outputId: "result",
                },
              },
            ],
          },
          {
            id: "assumption",
            type: "callout",
            title: "完整状态采样",
            text: "采用实际采纳时序。",
            appearance: {
              labelBackground: "#123456",
              labelColor: "#ffffff",
              borderColor: "#123456",
              borderStyle: "solid",
              borderWidth: 1,
            },
          },
        ],
      },
      {
        ...dates,
        id: "isolated",
        title: "另一个模型",
        blocks: [
          {
            id: "same-symbol",
            type: "formula",
            tex: "K",
            parts: [{ type: "symbol", entryId: "example-matrix", bindings: {} }],
          },
        ],
      },
    ],
  };
  state.theoryMap = {
    ...getResearchTheoryMap(state),
    open: true,
    expandedNoteIds: ["basis", "scenario"],
    showAllBlocks: true,
  };
  return state;
}

describe("research theory map", () => {
  it("checks an edited note relation after removing its old direction", () => {
    let state = fixture();
    state = saveTheoryRelation(state, {
      id: "move",
      source: { noteId: "isolated" },
      target: { noteId: "basis" },
      kind: "derivation",
      description: "",
    });
    state = saveTheoryRelation(state, {
      id: "next",
      source: { noteId: "basis" },
      target: { noteId: "scenario" },
      kind: "derivation",
      description: "",
    });
    expect(
      theoryRelationError(state, {
        id: "move",
        source: { noteId: "scenario" },
        target: { noteId: "isolated" },
        kind: "derivation",
        description: "",
      }),
    ).toBeNull();
  });
  it("projects only explicit result sources, and reads content live without duplicating formulas", () => {
    let state = fixture();
    const graph = buildResearchTheoryGraph(state);
    expect(
      graph.edges.filter((edge) => edge.origin === "formula"),
    ).toMatchObject([
      {
        source: theoryReferenceKey(gain),
        target: theoryReferenceKey(command),
        kind: "derivation",
      },
    ]);
    expect(graph.nodes.some((node) => node.ref.noteId === "isolated")).toBe(
      false,
    );
    const source = state.notes[0].blocks[0];
    if (source.type !== "formula")
      throw new Error("Expected the gain formula in the fixture");
    state = updateResearchNote(state, "basis", {
      blocks: [{ ...source, tex: "K=2P", caption: "修改后的增益" }],
    });
    expect(
      buildResearchTheoryGraph(state).nodes.find(
        (node) => node.id === theoryReferenceKey(gain),
      )?.title,
    ).toBe("修改后的增益");
    expect(JSON.stringify(state.theoryMap)).not.toContain("K=2P");
  });

  it("stores assumptions and adaptation as different relations, rejects duplicate links and derivation cycles", () => {
    let state = fixture();
    state = saveTheoryRelation(state, {
      id: "condition",
      source: assumption,
      target: command,
      kind: "assumption",
      description: "依照包内完整状态计算。",
    });
    state = saveTheoryRelation(state, {
      id: "adapt",
      source: gain,
      target: command,
      kind: "adaptation",
      description: "沿用增益，改变状态依据及输入切换时刻。",
    });
    expect(
      buildResearchTheoryGraph(state).edges.map((edge) => edge.kind),
    ).toEqual(
      expect.arrayContaining(["derivation", "assumption", "adaptation"]),
    );
    expect(
      theoryRelationError(state, {
        id: "again",
        source: assumption,
        target: command,
        kind: "assumption",
        description: "",
      }),
    ).toMatch(/已有|重复/);
    expect(
      theoryRelationError(state, {
        id: "cycle",
        source: command,
        target: gain,
        kind: "derivation",
        description: "",
      }),
    ).toMatch(/循环/);
    expect(
      theoryRelationError(state, {
        id: "self",
        source: command,
        target: command,
        kind: "adaptation",
        description: "",
      }),
    ).toMatch(/自身/);
    expect(
      removeTheoryRelation(state, "condition").notes.map((note) => note.blocks),
    ).toEqual(state.notes.map((note) => note.blocks));
  });

  it("shares references across topics, scopes local neighbors, and includes isolated notes in the global overview", () => {
    const state = fixture();
    state.theoryMap = {
      ...state.theoryMap!,
      scope: "topic",
      topicId: "one",
      expandedNoteIds: [],
      topics: [
        { id: "one", title: "控制", noteIds: ["basis", "scenario"] },
        { id: "two", title: "其他", noteIds: ["basis", "isolated"] },
      ],
    };
    expect(
      buildResearchTheoryGraph(state)
        .nodes.map((node) => node.ref.noteId)
        .sort(),
    ).toEqual(["basis", "scenario"]);
    state.theoryMap.topicId = "two";
    expect(
      buildResearchTheoryGraph(state)
        .nodes.map((node) => node.ref.noteId)
        .sort(),
    ).toEqual(["basis", "isolated"]);
    state.theoryMap.scope = "global";
    expect(buildResearchTheoryGraph(state).nodes).toHaveLength(3);
    state.theoryMap.scope = "local";
    expect(
      buildResearchTheoryGraph(state)
        .nodes.map((node) => node.ref.noteId)
        .sort(),
    ).toEqual(["basis", "scenario"]);
  });

  it("collapses formulas to their note without losing the cross-note relationship", () => {
    const state = fixture();
    state.theoryMap!.expandedNoteIds = [];
    const graph = buildResearchTheoryGraph(state);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toMatchObject([
      {
        source: theoryReferenceKey({ noteId: "basis" }),
        target: theoryReferenceKey({ noteId: "scenario" }),
      },
    ]);
    state.theoryMap!.expandedNoteIds = ["basis", "scenario"];
    expect(
      buildResearchTheoryGraph(state).nodes.some(
        (node) => node.id === theoryReferenceKey(command),
      ),
    ).toBe(true);
  });

  it("includes isolated formulas when explicitly requested, and allows a block role to inherit the note role", () => {
    const state = fixture();
    state.theoryMap = {
      ...state.theoryMap!,
      scope: "global",
      expandedNoteIds: ["isolated"],
      showAllBlocks: true,
      annotations: [{ ref: { noteId: "isolated" }, role: "foundation" }],
    };
    const graph = buildResearchTheoryGraph(state);
    expect(
      graph.nodes.find((node) => node.ref.blockId === "same-symbol")?.role,
    ).toBe("foundation");
    expect(
      graph.edges.some(
        (edge) =>
          edge.source.includes("isolated") || edge.target.includes("isolated"),
      ),
    ).toBe(false);
  });

  it("preserves missing endpoints visibly rather than silently redirecting to another formula", () => {
    let state = fixture();
    state = saveTheoryRelation(state, {
      id: "condition",
      source: assumption,
      target: command,
      kind: "assumption",
      description: "条件",
    });
    state.notes[1].blocks = state.notes[1].blocks.filter(
      (block) => block.id !== "assumption",
    );
    const node = buildResearchTheoryGraph(state).nodes.find(
      (value) => value.id === theoryReferenceKey(assumption),
    );
    expect(node?.missing).toBe(true);
    expect(getResearchTheoryMap(state).relations[0].source).toEqual(assumption);
    state.notes[0].blocks = [];
    expect(
      buildResearchTheoryGraph(state).edges.some(
        (edge) => edge.origin === "formula" && edge.error,
      ),
    ).toBe(true);
  });

  it("retains view, topics, role annotations, node positions and viewport across notebook persistence", () => {
    const state = fixture();
    state.theoryMap = {
      ...state.theoryMap!,
      scope: "global",
      selectedNodeId: theoryReferenceKey(command),
      annotations: [{ ref: command, role: "model" }],
      layouts: {
        global: {
          positions: { [theoryReferenceKey(command)]: { x: 321, y: 123 } },
          viewport: { x: -10, y: 25, zoom: 0.8 },
        },
      },
    };
    const saved = normalizeResearchNotebook(JSON.parse(JSON.stringify(state)));
    expect(getResearchTheoryMap(saved).selectedNodeId).toEqual(
      state.theoryMap.selectedNodeId,
    );
    expect(getResearchTheoryMap(saved).layouts.global).toEqual(
      state.theoryMap.layouts.global,
    );
    const malformed = normalizeResearchTheoryMap(
      {
        ...state.theoryMap,
        layouts: {
          global: {
            positions: { bad: { x: "a", y: Infinity } },
            viewport: { x: 1, y: 2, zoom: -1 },
          },
        },
      },
      state.notes,
    );
    expect(malformed.layouts.global.positions).toEqual({});
    expect(malformed.layouts.global.viewport).toBeUndefined();
  });

  it("invalidates downstream reviews when a manually associated assumption changes, while view changes preserve them", () => {
    let state = fixture();
    state = saveTheoryRelation(state, {
      id: "external",
      source: { noteId: "isolated", blockId: "same-symbol" },
      target: command,
      kind: "assumption",
      description: "记录依据",
    });
    state.notes = state.notes.map((note) => ({
      ...note,
      reviewStatus: "reviewed",
    }));
    state = updateResearchNote(state, "isolated", { title: "修改条件说明" });
    expect(
      state.notes.find((note) => note.id === "scenario")?.reviewStatus,
    ).toBe("pending");
    expect(state.notes.find((note) => note.id === "basis")?.reviewStatus).toBe(
      "reviewed",
    );
  });
});
