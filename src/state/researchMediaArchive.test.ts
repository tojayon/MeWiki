import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { createBrowserMediaArchive, releaseBrowserMediaArchive } from "./researchMediaArchive.ts";
import { browserMediaStore } from "./researchMediaStorage.ts";
import { createResearchNote } from "../domain/researchNotebook.ts";

describe("portable browser image export", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('includes only the selected source attachment in an embedded note Markdown export', async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='), byte => byte.charCodeAt(0));
    const asset = await browserMediaStore.put(new File([bytes], 'source.png', { type: 'image/png' }));
    const b = { ...createResearchNote('来源'), id: 'source-note', blocks: [
      { id: 'chosen', type: 'media' as const, kind: 'image' as const, source: { type: 'asset' as const, assetId: asset.id } },
      { id: 'unrelated', type: 'media' as const, kind: 'image' as const, source: { type: 'asset' as const, assetId: 'f'.repeat(64) } },
    ] };
    const a = { ...createResearchNote('引用'), blocks: [{ id: 'embed', type: 'noteEmbed' as const, sourceNoteId: b.id, blockIds: ['chosen'] }] };
    const state = { ...createResearchNotebook(), notes: [a, b] };
    const archive = await createBrowserMediaArchive(state, 'markdown', a.id);
    const reader = new ZipReader(new BlobReader(archive));
    try {
      const entries = await reader.getEntries();
      expect(entries.some(entry => entry.filename === `assets/${asset.id}.png`)).toBe(true);
      const markdown = entries.find(entry => entry.filename.endsWith('.md'))!;
      expect('getData' in markdown && await markdown.getData(new TextWriter())).toContain(`../assets/${asset.id}.png`);
      expect(entries.some(entry => entry.filename.includes('f'.repeat(64)))).toBe(false);
    } finally { await reader.close(); await releaseBrowserMediaArchive(archive); }
  });
  it("includes independently stored originals and relative Markdown image links", async () => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=="), byte => byte.charCodeAt(0));
    const asset = await browserMediaStore.put(new File([bytes], "moon.png", { type: "image/png" }));
    const note = { ...createResearchNote("月面"), blocks: [{ id: "pic", type: "media" as const, kind: "image" as const, source: { type: "asset" as const, assetId: asset.id }, alt: "月面" }] };
    const state = { ...createResearchNotebook(), notes: [note] };
    const archive = await createBrowserMediaArchive(state, "markdown", note.id);
    const reader = new ZipReader(new BlobReader(archive));
    const entries = await reader.getEntries();
    expect(entries.some(entry => entry.filename === `assets/${asset.id}.png`)).toBe(true);
    const markdown = entries.find(entry => entry.filename.endsWith(".md"))!;
    expect("getData" in markdown && await markdown.getData(new TextWriter())).toContain(`../assets/${asset.id}.png`);
    await reader.close();
  });
  it("uses the image format for archive filenames and keeps arbitrary note IDs inside the notes directory", async () => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=="), byte => byte.charCodeAt(0));
    const asset = await browserMediaStore.put(new File([bytes], "misnamed.jpeg", { type: "image/jpeg" }));
    const note = { ...createResearchNote("portable"), id: "../../outside", blocks: [{ id: "pic", type: "media" as const, kind: "image" as const, source: { type: "asset" as const, assetId: asset.id } }] };
    const reader = new ZipReader(new BlobReader(await createBrowserMediaArchive({ ...createResearchNotebook(), notes: [note] }, "markdown", note.id)));
    const entries = await reader.getEntries();
    expect(entries.some(entry => entry.filename === `assets/${asset.id}.png`)).toBe(true);
    expect(entries.every(entry => !entry.filename.split("/").includes(".."))).toBe(true);
    const markdown = entries.find(entry => entry.filename.endsWith(".md"))!;
    expect("getData" in markdown && await markdown.getData(new TextWriter())).toContain(`../assets/${asset.id}.png`);
    await reader.close();
  });
  it("produces a library archive accepted by the importer without Markdown-only entries", async () => {
    const state = { ...createResearchNotebook(), notes: [createResearchNote("archive")] };
    const reader = new ZipReader(new BlobReader(await createBrowserMediaArchive(state, "library")));
    const entries = await reader.getEntries();
    expect(entries.map(entry => entry.filename)).toEqual(["research-library.webbench.json"]);
    await reader.close();
  });
  it("streams the archive to a temporary file and releases exactly that file", async () => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    const file = {
      createWritable: async () => new WritableStream<Uint8Array>({ write: chunk => { chunks.push(new Uint8Array(chunk)); } }),
      getFile: async () => new File(chunks, "archive.zip", { type: "application/zip" }),
    };
    const directory = { getFileHandle: vi.fn().mockResolvedValue(file), removeEntry };
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } });
    const archive = await createBrowserMediaArchive({ ...createResearchNotebook(), notes: [createResearchNote("disk")] }, "library");
    const reader = new ZipReader(new BlobReader(archive));
    expect((await reader.getEntries())[0].filename).toBe("research-library.webbench.json");
    await reader.close();
    expect(chunks.length).toBeGreaterThan(1);
    expect(removeEntry).not.toHaveBeenCalled();
    await releaseBrowserMediaArchive(archive);
    expect(removeEntry).toHaveBeenCalledWith(directory.getFileHandle.mock.calls[0][0]);
    await releaseBrowserMediaArchive(archive);
    expect(removeEntry).toHaveBeenCalledTimes(1);
  });
  it("refuses large memory-only archives when temporary file storage is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const id = "a".repeat(64);
    const blob = new Blob();
    Object.defineProperty(blob, "size", { value: 40_000_000 });
    vi.spyOn(browserMediaStore, "get").mockResolvedValue({ blob, asset: { id, sha256: id, name: "large.png", mimeType: "image/png", size: blob.size, createdAt: new Date().toISOString() } });
    const note = { ...createResearchNote("large"), blocks: [{ id: "pic", type: "media" as const, kind: "image" as const, source: { type: "asset" as const, assetId: id } }] };
    await expect(createBrowserMediaArchive({ ...createResearchNotebook(), notes: [note] }, "library")).rejects.toThrow(/本地资料库/);
  });
});
