import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createResearchContentBlock, createResearchNote, convertResearchBlockType, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown } from "./researchNotebook.ts";
import { normalizeMediaBlock, researchMediaAssetIds, serializeResearchMediaMarkdown, validateMediaFile } from "./researchMedia.ts";
import { createResearchLibraryFile, parseResearchLibraryFile } from "../state/researchLibraryFile.ts";

const assetId = "a".repeat(64);
const image = { id: "picture", type: "media" as const, kind: "image" as const, source: { type: "asset" as const, assetId }, caption: "示例照片", alt: "示例景物", display: { align: "left" as const, widthPercent: 75 } };

describe("research media", () => {
  it("creates a media image instead of an editable Markdown path", () => {
    expect(createResearchContentBlock("image")).toMatchObject({ type: "media", kind: "image" });
  });
  it("keeps caption and attachment when converting back to text", () => {
    const result = convertResearchBlockType(image, "paragraph");
    expect(result).toMatchObject({ id: "picture", type: "paragraph" });
    expect(result && "text" in result && result.text).toContain(`webbench-asset:${assetId}`);
    expect(convertResearchBlockType({ id: "text", type: "paragraph", text: "需要保留的说明" }, "image")).toMatchObject({ type: "media", kind: "image", caption: "需要保留的说明" });
  });
  it("rejects executable URLs and malformed asset identifiers without silently removing content", () => {
    expect(() => normalizeMediaBlock({ ...image, source: { type: "url", url: "javascript:alert(1)" } })).toThrow();
    expect(() => normalizeMediaBlock({ ...image, source: { type: "asset", assetId: "../secret" } })).toThrow();
    expect(normalizeMediaBlock(image)).toEqual(image);
  });
  it("validates supported images and the exact 1 GB upper bound", () => {
    expect(() => validateMediaFile({ name: "x.png", type: "image/png", size: 1_000_000_001 })).toThrow(/1 GB/);
    expect(() => validateMediaFile({ name: "x.svg", type: "image/svg+xml", size: 100 }, "image")).toThrow();
    expect(validateMediaFile({ name: "x.png", type: "image/png", size: 1_000_000_000 })).toBe("image/png");
  });
  it.each([
    ["recording.mp3", "audio/mp3", "audio/mpeg"],
    ["recording.wav", "audio/x-wav", "audio/wav"],
    ["recording.ogg", "", "audio/ogg"],
    ["recording.m4a", "audio/x-m4a", "audio/mp4"],
    ["recording.weba", "audio/webm", "audio/webm"],
    ["replay.mp4", "video/mp4", "video/mp4"],
    ["replay.webm", "application/octet-stream", "video/webm"],
  ])("accepts a supported media file %s with a canonical MIME type", (name, type, mime) => {
    expect(validateMediaFile({ name, type, size: 100 })).toBe(mime);
  });
  it("rejects a file of another kind before replacing an existing media source", () => {
    expect(() => validateMediaFile({ name: "x.png", type: "image/png", size: 100 }, "video")).toThrow(/视频/);
    expect(() => validateMediaFile({ name: "x.mp4", type: "video/mp4", size: 100 }, "audio")).toThrow(/音频/);
    expect(() => validateMediaFile({ name: "x.html", type: "text/html", size: 100 }, "video")).toThrow();
    expect(() => validateMediaFile({ name: "x.constructor", type: "constructor", size: 100 })).toThrow(/文件/);
  });
  it("preserves video poster and playback preferences through library and Markdown round trips", async () => {
    const poster = { type: "asset" as const, assetId: "b".repeat(64) };
    const video = { ...image, kind: "video" as const, poster, playback: { rate: 1.5, loop: true } };
    expect(normalizeMediaBlock(video)).toEqual(video);
    expect(() => normalizeMediaBlock({ ...video, poster: { type: "url", url: "javascript:alert(1)" } })).toThrow();
    const note = { ...createResearchNote("视频"), blocks: [video] };
    const old = { ...createResearchNotebook(), version: 5, notes: [note] };
    const state = normalizeResearchNotebook(old);
    expect(state.version).toBe(8);
    expect(state.notes.find(n => n.id === note.id)?.blocks).toEqual([video]);
    expect(parseResearchMarkdown(serializeResearchMarkdown(note)).blocks).toEqual([video]);
    expect((await parseResearchLibraryFile(JSON.stringify(await createResearchLibraryFile(state)))).notebook.notes[0].blocks).toEqual([video]);
    expect(researchMediaAssetIds([video]).sort()).toEqual([poster.assetId, assetId].sort());
  });
  it("preserves media settings and nested references through normalization and Markdown", () => {
    const note = { ...createResearchNote("图片"), blocks: [image] };
    const state = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
    expect(normalizeResearchNotebook(state).notes.find(n => n.id === note.id)?.blocks).toEqual([image]);
    const markdown = serializeResearchMarkdown(note);
    expect(markdown).toContain(`webbench-asset:${assetId}`);
    expect(parseResearchMarkdown(markdown).blocks).toEqual([image]);
    expect(serializeResearchMediaMarkdown(image)).toContain("示例照片");
    expect(researchMediaAssetIds([{ id: "tabs", type: "examples", tabs: [{ id: "t", title: "图", blocks: [image, { ...image, id: "p2" }] }] }])).toEqual([assetId]);
    expect(researchMediaAssetIds([{ id: "list", type: "list", items: [`![图](webbench-asset:${assetId})`] }])).toEqual([assetId]);
  });
  it("retains unrelated browser notes when a damaged media source needs relinking", () => {
    const note = { ...createResearchNote("重要笔记"), blocks: [{ ...image, source: { type: "url", url: "file:///C:/photo.png" } }] };
    const result = normalizeResearchNotebook({ ...createResearchNotebook(), notes: [note] });
    expect(result.notes.find(n => n.id === note.id)?.blocks[0]).toMatchObject({ id: image.id, type: "media", legacySource: expect.stringContaining("file:///C:/photo.png") });
  });
  it("keeps a new caption together with an old local picture path in text conversion", () => {
    expect(serializeResearchMediaMarkdown({ id: "local", type: "media", kind: "image", legacySource: "![原件](D:/pictures/a.png)", caption: "新图注" })).toContain("新图注");
  });
  it("migrates version four standalone image links without changing the block id", async () => {
    const old = { ...createResearchNotebook(), version: 4, notes: [{ ...createResearchNote("旧图"), id: "legacy-note", blocks: [{ id: "legacy-image", type: "markdown", kind: "image", text: "![观测图](https://example.com/image.png)" }] }] };
    const bytes = new TextEncoder().encode(JSON.stringify({ format: "webbench-research-library", version: 1, revision: "old", savedAt: "2026-11-08T00:00:00.000Z", notebook: old }));
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    const parsed = await parseResearchLibraryFile(JSON.stringify({ format: "webbench-research-library", version: 1, revision: "old", savedAt: "2026-11-08T00:00:00.000Z", notebook: old, checksum }));
    expect(parsed.notebook.version).toBe(8);
    expect(parsed.notebook.notes[0].blocks[0]).toMatchObject({ id: "legacy-image", type: "media", kind: "image", alt: "观测图", source: { type: "url", url: "https://example.com/image.png" } });
    await expect(parseResearchLibraryFile(JSON.stringify({ ...parsed, checksum: "broken" }))).rejects.toThrow(/完整性/);
    expect((await createResearchLibraryFile(parsed.notebook)).notebook.version).toBe(8);
  });
});
