import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createResearchContentBlock, createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown, type ResearchNotebookBlock } from "./researchNotebook.ts";
import { defaultResearchNoteFilters, filterResearchNotes } from "./researchNoteOrganization.ts";
import { resolveTheoryReference } from "./researchTheoryMap.ts";
import { assertResearchLibraryNotebook, createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";

const appearance = {
  borderColor: "#447755", backgroundColor: "#f6fbf7", headerBackground: "#e7f3ea",
  labelBackground: "#245c38", labelColor: "#ffffff", accentColor: "#287547",
};
const group = {
  id: "tabs", type: "examples" as const, title: "方法 [比较]", appearance,
  tabs: [{ id: "one", title: "解析法", blocks: [{ id: "text", type: "paragraph" as const, text: "保留内容" }] }],
};
function notebook(block: ResearchNotebookBlock = group) {
  const state = createResearchNotebook();
  state.notes = [{ ...createResearchNote("通用分栏"), id: "note", blocks: [block] }];
  state.activeNoteId = "note";
  return state;
}

describe("general-purpose tabs", () => {
  it("creates neutral titles for a general tabs block", () => {
    expect(createResearchContentBlock("examples")).toMatchObject({ title: "标签页", tabs: [{ title: "标签 1" }, { title: "标签 2" }] });
  });

  it("preserves custom names and appearance through browser normalization", () => {
    expect(normalizeResearchNotebook(notebook()).notes[0].blocks).toEqual([group]);
  });

  it("keeps the identity, content and existing names of legacy examples", () => {
    const legacy = { id: "old", type: "examples" as const, tabs: [{ id: "a", title: "例 1", blocks: [] }] };
    expect(normalizeResearchNotebook(notebook(legacy)).notes[0].blocks).toEqual([legacy]);
  });

  it.each(["left", "center", "right"] as const)("preserves the %s label position through browser, nested backup and Markdown round trips", async labelPosition => {
    const positioned = { ...group, labelPosition, tabs: [{ id: "outer", title: "外层", blocks: [{ ...group, id: "nested", labelPosition: "right" as const }] }] };
    const state = notebook(positioned);
    expect(normalizeResearchNotebook(state).notes[0].blocks).toEqual([positioned]);
    const note = state.notes[0];
    expect(parseResearchMarkdown(serializeResearchMarkdown(note), note.title).blocks).toEqual([positioned]);
    const file = await createResearchLibraryFile(state);
    expect((await parseResearchLibraryFile(JSON.stringify(file))).notebook.notes[0].blocks).toEqual([positioned]);
  });

  it("ignores an unsupported label position in browser data but rejects it in a full backup", () => {
    const state = notebook({ ...group, labelPosition: "top" } as unknown as ResearchNotebookBlock);
    expect(normalizeResearchNotebook(state).notes[0].blocks).toEqual([group]);
    expect(() => assertResearchLibraryNotebook(state)).toThrow("格式错误");
  });

  it("normalizes colors and rejects CSS expressions instead of storing them as styles", () => {
    const state = notebook({ ...group, appearance: { ...appearance, borderColor: " #ABC ", backgroundColor: "url(example)", labelColor: "invalid" } });
    expect(normalizeResearchNotebook(state).notes[0].blocks[0]).toMatchObject({ appearance: { ...appearance, borderColor: "#aabbcc", backgroundColor: "#ffffff", labelColor: "#ffffff" } });
  });

  it("preserves names and appearance in the full backup including nested tabs", async () => {
    const nested = { ...group, tabs: [{ id: "outer", title: "外层", blocks: [{ ...group, id: "nested" }] }] };
    const file = await createResearchLibraryFile(notebook(nested));
    expect((await parseResearchLibraryFile(JSON.stringify(file))).notebook.notes[0].blocks).toEqual([nested]);
  });

  it("validates the appearance in every nested tab before saving", () => {
    const nested = { ...group, tabs: [{ id: "outer", title: "外层", blocks: [{ ...group, id: "nested", appearance: { ...appearance, borderColor: 42 } }] }] };
    expect(() => assertResearchLibraryNotebook(notebook(nested as unknown as ResearchNotebookBlock))).toThrow("格式错误");
  });

  it("exports the visible group title and restores all appearance settings", () => {
    const note = notebook().notes[0];
    const markdown = serializeResearchMarkdown(note);
    expect(markdown).toContain("> **方法 \\[比较\\]**");
    expect(parseResearchMarkdown(markdown, note.title).blocks).toEqual([group]);
  });

  it("finds custom panel titles through search and shows them in the theory map", () => {
    const state = notebook();
    expect(filterResearchNotes(state.notes, { ...defaultResearchNoteFilters, query: "方法 [比较]" })).toHaveLength(1);
    expect(resolveTheoryReference(state, { noteId: "note", blockId: "tabs" }).title).toBe("方法 [比较] · 解析法");
  });
});
