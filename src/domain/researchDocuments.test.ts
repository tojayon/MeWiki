import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { mediaFileKind, mediaHeaderInfo, normalizeMediaBlock, validateMediaFile } from "./researchMedia.ts";
import { createResearchContentBlock, createResearchNote, convertResearchBlockType, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown } from "./researchNotebook.ts";
import { createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";

describe("research documents and links", () => {
  it("recognizes PDF, Office, archives and opaque attachments without making active files into images", () => {
    expect(mediaFileKind({ name: "paper.pdf", type: "application/pdf" })).toBe("pdf");
    expect(mediaFileKind({ name: "table.xlsx", type: "" })).toBe("file");
    expect(validateMediaFile({ name: "package.zip", type: "application/zip", size: 100 })).toBe("application/zip");
    expect(validateMediaFile({ name: "result.dat", type: "", size: 1_000_000_000 })).toBe("application/octet-stream");
    expect(mediaFileKind({ name: "page.html", type: "text/html" })).toBe("file");
    expect(mediaFileKind({ name: "drawing.svg", type: "image/svg+xml" })).toBe("file");
  });
  it("verifies PDF headers and never guesses PDF from ordinary bytes", () => {
    expect(mediaHeaderInfo(new TextEncoder().encode("%PDF-1.7\n"), "application/pdf")).toEqual({ mimeType: "application/pdf" });
    expect(mediaHeaderInfo(new TextEncoder().encode("\uFEFF\n%PDF-1.7\n"), "application/pdf")).toEqual({ mimeType: "application/pdf" });
    expect(() => mediaHeaderInfo(new TextEncoder().encode("<html>wrong</html>"), "application/pdf")).toThrow(/PDF/);
    expect(mediaHeaderInfo(new TextEncoder().encode("ordinary data"), "application/octet-stream")).toEqual({ mimeType: "application/octet-stream" });
  });
  it("creates and preserves documents and bookmarks through nested Markdown and library backups", async () => {
    const pdf = { id: "pdf", type: "media" as const, kind: "pdf" as const, source: { type: "asset" as const, assetId: "c".repeat(64) }, alt: "研究报告.pdf", document: { page: 3 }, caption: "第三页" };
    const bookmark = { id: "link", type: "bookmark" as const, url: "https://example.com/paper", title: "文章", description: "摘要", siteName: "来源" };
    expect(createResearchContentBlock("pdf" as never)).toMatchObject({ type: "media", kind: "pdf" });
    expect(createResearchContentBlock("file" as never)).toMatchObject({ type: "media", kind: "file" });
    expect(createResearchContentBlock("bookmark" as never)).toMatchObject({ type: "bookmark" });
    expect(normalizeMediaBlock(pdf)).toEqual(pdf);
    expect(convertResearchBlockType(pdf, "file")).toMatchObject({ kind: "file", source: pdf.source });
    const note = { ...createResearchNote("资料"), blocks: [{ id: "tabs", type: "examples" as const, tabs: [{ id: "tab", title: "资料", blocks: [pdf, bookmark] }] }] };
    const state = normalizeResearchNotebook({ ...createResearchNotebook(), notes: [note] });
    expect(state.version).toBe(8);
    expect(state.notes.find(n => n.id === note.id)?.blocks).toEqual(note.blocks);
    expect(parseResearchMarkdown(serializeResearchMarkdown(note as never)).blocks).toEqual(note.blocks);
    const restored = await parseResearchLibraryFile(JSON.stringify(await createResearchLibraryFile(state)));
    expect(restored.notebook.notes[0].blocks).toEqual(note.blocks);
    expect(convertResearchBlockType(pdf as never, "paragraph")).toMatchObject({ text: expect.stringContaining("#page=3") });
    expect(convertResearchBlockType(bookmark as never, "paragraph")).toMatchObject({ text: expect.stringContaining("https://example.com/paper") });
  });
  it("rejects unsafe bookmark links without discarding the rest of a browser note", async () => {
    const note = { ...createResearchNote("链接"), blocks: [{ id: "unsafe", type: "bookmark", url: "javascript:alert(1)", title: "保留标题" }] };
    const base = { ...createResearchNotebook(), notes: [note] };
    await expect(createResearchLibraryFile(base as never)).rejects.toThrow(/网址|链接/);
    const normalized = normalizeResearchNotebook(base);
    expect(normalized.notes.find(n => n.id === note.id)?.blocks[0]).toMatchObject({ type: "paragraph", text: expect.stringContaining("保留标题") });
  });
});
