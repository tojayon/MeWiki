import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { appendResearchBlock, createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, removeResearchBlock, serializeResearchMarkdown, updateResearchNote } from "./researchNotebook.ts";
import { buildResearchNoteTree, filterResearchNotes, getNoteReviewStatus, getResearchNoteProgress, getResearchTagTree, normalizeResearchTags, setNoteReviewStatus, setResearchNoteTags } from "./researchNoteOrganization.ts";
import { updateSymbolEntry } from "./researchDictionary.ts";

describe("research note review and hierarchical tags", () => {
  it("groups notes by complete tag paths and keeps untagged notes together", () => {
    const lqr = { ...createResearchNote("LQR"), tags: ["模型/控制/LQR", "论文/第3章"] };
    const overview = { ...createResearchNote("控制概述"), tags: ["模型/控制"] };
    const untagged = createResearchNote("观察记录");
    const tree = buildResearchNoteTree([lqr, overview, untagged]);
    const models = tree.find((branch) => branch.path === "模型")!;
    expect(models.count).toBe(2);
    expect(models.children[0]).toMatchObject({ path: "模型/控制", label: "控制", count: 2, notes: [overview] });
    expect(models.children[0].children[0]).toMatchObject({ path: "模型/控制/LQR", label: "LQR", count: 1, notes: [lqr] });
    expect(tree.find((branch) => branch.path === "论文")?.children[0].notes).toEqual([lqr]);
    expect(tree.at(-1)).toMatchObject({ path: "", label: "未分类", count: 1, notes: [untagged], children: [] });
  });

  it("counts a multi-tag note once per ancestor and merges equivalent tag prefixes", () => {
    const note = { ...createResearchNote("控制笔记"), tags: ["模型/Control/LQR", " 模型 / control / 离散化 ", "模型/CONTROL/LQR"] };
    const tree = buildResearchNoteTree([note]);
    expect(tree).toHaveLength(1);
    expect(tree[0].count).toBe(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].count).toBe(1);
    expect(tree[0].children[0].children).toHaveLength(2);
    expect(tree[0].children[0].children.every((branch) => branch.notes.length === 1)).toBe(true);
  });

  it("shows matching tag locations only and prunes empty branches for combined filters", () => {
    const note = { ...createResearchNote("LQR"), tags: ["模型/控制/LQR", "论文/第3章"], reviewStatus: "reviewed" as const };
    const other = { ...createResearchNote("FIFO"), tags: ["模型/调度/FIFO"] };
    const filters = { query: "LQR", status: "reviewed" as const, tag: "论文" };
    const tree = buildResearchNoteTree([note, other, createResearchNote("无标签")], filters);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ path: "论文", count: 1 });
    expect(tree[0].children[0].notes).toEqual([note]);
    expect(buildResearchNoteTree([note, other], { ...filters, query: "不存在" })).toEqual([]);
  });

  it("starts notes as pending and does not claim existing models have been reviewed", () => {
    const state = createResearchNotebook();
    expect(getNoteReviewStatus(createResearchNote())).toBe("pending");
    expect(state.notes.every((note) => getNoteReviewStatus(note) === "pending")).toBe(true);
    expect(state.notes.find((note) => note.id === "fixture-application")?.tags).toEqual([]);
    expect(getResearchNoteProgress(state.notes)).toEqual({ total: state.notes.length, pending: state.notes.length, reviewing: 0, reviewed: 0 });
  });

  it("tracks manual review independently of edits and preserves the last review time", () => {
    const initial = createResearchNotebook();
    const id = initial.activeNoteId;
    const when = "2026-11-05T02:30:00.000Z";
    const checking = setNoteReviewStatus(initial, id, "reviewing", when);
    const checked = setNoteReviewStatus(checking, id, "reviewed", when);
    expect(checked.notes[0]).toMatchObject({ reviewStatus: "reviewed", reviewedAt: when, updatedAt: initial.notes[0].updatedAt });
    expect(setNoteReviewStatus(checked, id, "reviewed")).toBe(checked);
    expect(updateResearchNote(checked, id, { blocks: structuredClone(checked.notes[0].blocks) })).toBe(checked);
    const tagged = setResearchNoteTags(checked, id, ["研究/模型"]);
    expect(getNoteReviewStatus(tagged.notes[0])).toBe("reviewed");
    const revised = updateResearchNote(tagged, id, { title: "修改后的笔记" });
    expect(revised.notes[0]).toMatchObject({ reviewStatus: "pending", reviewedAt: when });
    expect(getNoteReviewStatus(updateResearchNote(checking, id, { title: "继续核对" }).notes[0])).toBe("reviewing");
    expect(setNoteReviewStatus(initial, "missing", "reviewed")).toBe(initial);
  });

  it("invalidates completed reviews for additions, removals and referenced dictionary edits", () => {
    const initial = createResearchNotebook();
    const id = "fixture-application";
    const checked = setNoteReviewStatus(initial, id, "reviewed");
    const changed = appendResearchBlock(checked, id, { id: "new", type: "paragraph", text: "新的控制假设" });
    expect(getNoteReviewStatus(changed.notes.find((note) => note.id === id)!)).toBe("pending");
    const rechecked = setNoteReviewStatus(changed, id, "reviewed");
    const removed = removeResearchBlock(rechecked, id, "new");
    expect(getNoteReviewStatus(removed.notes.find((note) => note.id === id)!)).toBe("pending");
    const gain = initial.symbols.find((symbol) => symbol.id === "example-matrix")!;
    const updated = updateSymbolEntry(checked, { ...gain, meaning: "重新核对增益定义" });
    expect(getNoteReviewStatus(updated.notes.find((note) => note.id === id)!)).toBe("pending");
    expect(getNoteReviewStatus(checked.notes.find((note) => note.id === id)!)).toBe("reviewed");
  });

  it("normalizes multiple tag paths and counts each note once per ancestor", () => {
    expect(normalizeResearchTags([" 模型 / 控制 / LQR ", "模型//控制/LQR", "模型/控制/离散化", "", null, 3])).toEqual(["模型/控制/LQR", "模型/控制/离散化"]);
    const a = { ...createResearchNote("a"), tags: ["模型/控制/LQR", "模型/控制/离散化"] };
    const b = { ...createResearchNote("b"), tags: ["模型/通信/LQR"] };
    expect(getResearchTagTree([a, b])).toEqual(expect.arrayContaining([
      { path: "模型", depth: 0, count: 2 }, { path: "模型/控制", depth: 1, count: 1 },
      { path: "模型/控制/LQR", depth: 2, count: 1 }, { path: "模型/通信/LQR", depth: 2, count: 1 },
    ]));
    expect(filterResearchNotes([a, b], { query: "", status: "all", tag: "模型/控制" }).map((note) => note.title)).toEqual(["a"]);
    expect(filterResearchNotes([a, b], { query: "", status: "all", tag: "模型/控" })).toEqual([]);
  });

  it("combines status, text and parent-tag filters", () => {
    const a = { ...createResearchNote("LQR 模型"), tags: ["模型/控制/LQR"], reviewStatus: "reviewed" as const };
    const b = { ...createResearchNote("LQR 对比"), tags: ["模型/控制/比较"], reviewStatus: "reviewing" as const };
    expect(filterResearchNotes([a, b], { query: "lqr", status: "reviewed", tag: "模型" })).toEqual([a]);
    expect(filterResearchNotes([a, b], { query: "控制", status: "all", tag: "" })).toEqual([a, b]);
    expect(getResearchNoteProgress([a, b])).toEqual({ total: 2, pending: 0, reviewing: 1, reviewed: 1 });
  });

  it("persists organization without restoring explicitly removed tags or losing formula sources", () => {
    let state = createResearchNotebook();
    state = setResearchNoteTags(state, "fixture-application", []);
    state = setNoteReviewStatus(state, "fixture-application", "reviewed", "2026-11-05T02:30:00.000Z");
    const snapshot = { ...state, noteFilters: { query: "LQR", status: "reviewed" as const, tag: "模型/控制" } };
    expect(normalizeResearchNotebook(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(snapshot.notes.find((note) => note.id === "fixture-application")?.tags).toEqual([]);
    const legacy = { ...state, notes: state.notes.map(({ tags: _tags, reviewStatus: _status, ...note }) => note) };
    const loaded = normalizeResearchNotebook(legacy);
    expect(getNoteReviewStatus(loaded.notes[0])).toBe("pending");
    expect(loaded.notes.find((note) => note.id === "fixture-application")?.tags).toEqual([]);
  });

  it("exports and restores review and tag metadata in Markdown", () => {
    const note = { ...createResearchNote("控制笔记"), tags: ["模型/控制/LQR", "论文/第3章"], reviewStatus: "reviewed" as const, reviewedAt: "2026-11-05T02:30:00.000Z" };
    note.blocks = [{ id: "equation", type: "formula", tex: "x(t)=0" }];
    const markdown = serializeResearchMarkdown(note);
    const imported = parseResearchMarkdown(markdown, note.title);
    expect(imported).toMatchObject({ tags: note.tags, reviewStatus: "reviewed", reviewedAt: note.reviewedAt });
    expect(imported.blocks).toEqual([{ id: expect.any(String), type: "formula", tex: "x(t)=0" }]);
  });

  it("invalidates dependent derivations without marking unrelated notes as changed", () => {
    const initial = createResearchNotebook();
    const source = { ...createResearchNote("来源"), id: "source", reviewStatus: "reviewed" as const };
    const dependent = { ...createResearchNote("推导"), id: "dependent", reviewStatus: "reviewed" as const, blocks: [{ id: "use", type: "formula" as const, tex: "K", parts: [{ type: "symbol" as const, entryId: "example-matrix", bindings: {}, source: { noteId: source.id, formulaId: "gain", outputId: "result" } }] }] };
    const unrelated = { ...createResearchNote("其他"), reviewStatus: "reviewed" as const };
    const updated = updateResearchNote({ ...initial, notes: [source, dependent, unrelated] }, source.id, { title: "更新后的来源" });
    expect(updated.notes.map(getNoteReviewStatus)).toEqual(["pending", "pending", "reviewed"]);
    expect(updated.notes[1].updatedAt).toBe(dependent.updatedAt);
    expect(updated.notes[2]).toBe(unrelated);
  });
});
