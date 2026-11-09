import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createResearchContentBlock, createResearchNote, convertResearchBlockType, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown, type ResearchContentType, type ResearchNotebookBlock } from "./researchNotebook.ts";
import { researchMediaAssetIds } from "./researchMedia.ts";
import { createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";

const assetId = "d".repeat(64);
const fixtures = [
  { id: "reference", type: "citation", title: "Lunar observations", authors: "Li, Wang", year: "2026", venue: "Journal", doi: "10.1234/lunar", notes: "轨迹说明", pdf: { type: "asset", assetId }, pdfName: "观测报告.pdf", pdfPage: 3 },
  { id: "data", type: "dataset", title: "实验数据", columns: ["time", "age"], rows: [["0", "2"], ["1", "4"]], source: { type: "asset", assetId }, sourceName: "原始记录.csv", chart: { kind: "line", x: 0, ys: [1] } },
  { id: "drawing", type: "diagram", title: "处理流程", mode: "mermaid", code: "flowchart LR\n A[接收] --> B[完成]", strokes: [] },
] as const;

describe("remaining research content integration", () => {
  it("creates real citation, data and diagram blocks", () => {
    for (const type of ["citation", "dataset", "diagram"] as ResearchContentType[]) {
      expect(createResearchContentBlock(type)).toMatchObject({ type });
    }
  });
  it("keeps rich blocks and their attachment references through nested Markdown and library backups", async () => {
    const blocks = structuredClone(fixtures) as unknown as ResearchNotebookBlock[];
    const note = { ...createResearchNote("扩展内容"), blocks: [{ id: "rich-tabs", type: "examples" as const, title: "研究资料", tabs: [{ id: "rich-tab", title: "数据与文献", blocks }] }] };
    const state = normalizeResearchNotebook({ ...createResearchNotebook(), notes: [note] });
    expect(state.version).toBe(8);
    expect(state.notes.find(item => item.id === note.id)?.blocks).toEqual(note.blocks);
    const markdown = serializeResearchMarkdown(note);
    expect(markdown).toContain("10.1234/lunar");
    expect(markdown).toContain("原始记录.csv");
    expect(markdown).toContain("flowchart LR");
    expect(parseResearchMarkdown(markdown).blocks).toEqual(note.blocks);
    const restored = await parseResearchLibraryFile(JSON.stringify(await createResearchLibraryFile(state)));
    expect(restored.notebook.notes.find(item => item.id === note.id)?.blocks).toEqual(note.blocks);
    expect(researchMediaAssetIds(blocks)).toEqual([assetId]);
    for (const block of blocks) expect(convertResearchBlockType(block, "paragraph")).toMatchObject({ text: expect.any(String) });
  });
  it("preserves existing PDF and data file originals when converting content types", () => {
    const source = { type: "asset" as const, assetId };
    const citation = convertResearchBlockType({ id: "pdf", type: "media", kind: "pdf", source, alt: "报告.pdf", document: { page: 3 } }, "citation" as ResearchContentType);
    expect(citation).toMatchObject({ type: "citation", pdf: source, pdfPage: 3 });
    expect(convertResearchBlockType(citation!, "pdf")).toMatchObject({ type: "media", kind: "pdf", source, document: { page: 3 } });
    const dataset = convertResearchBlockType({ id: "data", type: "media", kind: "file", source, alt: "records.xlsx" }, "dataset" as ResearchContentType);
    expect(dataset).toMatchObject({ type: "dataset", source });
    expect(convertResearchBlockType(dataset!, "file")).toMatchObject({ type: "media", kind: "file", source });
  });
  it("keeps every citation field when converting an associated PDF into an attachment", () => {
    const citation = structuredClone(fixtures[0]) as unknown as ResearchNotebookBlock;
    for (const type of ["pdf", "file"] as const) {
      const result = convertResearchBlockType(citation, type);
      expect(result).toMatchObject({ caption: expect.stringContaining("Li, Wang") });
      expect(result).toMatchObject({ caption: expect.stringContaining("10.1234/lunar") });
      expect(result).toMatchObject({ caption: expect.stringContaining("Lunar observations") });
    }
  });
  it("rejects oversized type conversions before the caller can replace the original block", () => {
    for (const [type, length] of [["citation", 160001], ["dataset", 2001], ["diagram", 20001]] as const) {
      const original: ResearchNotebookBlock = { id: "unchanged", type: "paragraph", text: "a".repeat(length) };
      expect(() => convertResearchBlockType(original, type)).toThrow();
      expect(original.text).toHaveLength(length);
    }
  });
  it("keeps both stored diagram modes when converting into ordinary text", () => {
    for (const mode of ["mermaid", "drawing"] as const) {
      const block: ResearchNotebookBlock = { id: "both-modes", type: "diagram", mode, code: "flowchart LR\n A[MERMAID_SENTINEL]", strokes: [{ id: "label", kind: "text", points: [{ x: 20, y: 40 }], color: "#1547c0", width: 2, text: "DRAWING_SENTINEL" }] };
      expect(convertResearchBlockType(block, "paragraph")).toMatchObject({ text: expect.stringContaining("MERMAID_SENTINEL") });
      expect(convertResearchBlockType(block, "paragraph")).toMatchObject({ text: expect.stringContaining("DRAWING_SENTINEL") });
    }
  });
  it("rejects corrupted rich library blocks while retaining malformed browser content as text", async () => {
    for (const block of [
      { ...fixtures[0], pdf: { type: "url", url: "javascript:alert(1)" } },
      { ...fixtures[1], rows: [["0", 3]] },
      { ...fixtures[2], strokes: [{ id: "bad", kind: "pen", color: "red", width: 2, points: [{ x: Infinity, y: 1 }] }] },
    ]) {
      const note = { ...createResearchNote("内容恢复"), blocks: [block] };
      const raw = { ...createResearchNotebook(), notes: [note] };
      await expect(createResearchLibraryFile(raw as unknown as ReturnType<typeof createResearchNotebook>)).rejects.toThrow();
      const restored = normalizeResearchNotebook(raw).notes.find(item => item.id === note.id)!;
      expect(restored.blocks[0]).toMatchObject({ type: "paragraph", text: expect.stringContaining(block.id) });
    }
  });
  it("upgrades verified version 7 files to 8 and still rejects modified originals", async () => {
    const file = await createResearchLibraryFile(createResearchNotebook());
    const older = { ...file, notebook: { ...file.notebook, version: 7 } };
    const bytes = new TextEncoder().encode(JSON.stringify({ format: older.format, version: older.version, revision: older.revision, savedAt: older.savedAt, notebook: older.notebook }));
    older.checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    expect((await parseResearchLibraryFile(JSON.stringify(older))).notebook.version).toBe(8);
    older.notebook.notes[0].title = "unauthorized change";
    await expect(parseResearchLibraryFile(JSON.stringify(older))).rejects.toThrow(/校验/);
  });
});
