import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserMediaStore, browserMediaStore, imageHeaderInfo, prepareBrowserMediaMigration } from "./researchMediaStorage.ts";
import { researchMediaClient } from "./researchMediaClient.ts";
import { createResearchNote } from "../domain/researchNotebook.ts";

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=="), byte => byte.charCodeAt(0));
describe("browser media storage", () => {
  afterEach(() => vi.restoreAllMocks());
  it("reads dimensions before decoding an image", () => {
    expect(imageHeaderInfo(png)).toEqual({ mimeType: "image/png", width: 1, height: 1 });
    expect(() => imageHeaderInfo(new TextEncoder().encode("<html>login</html>"))).toThrow(/图片/);
  });
  it("keeps an independent original in IndexedDB and deduplicates repeat inserts", async () => {
    const name = crypto.randomUUID();
    const first = new BrowserMediaStore(name);
    const asset = await first.put(new File([png], "original.png", { type: "image/png" }));
    const reopened = new BrowserMediaStore(name);
    const stored = await reopened.get(asset.id);
    expect(stored?.asset.sha256).toBe(asset.id);
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(new Uint8Array(png));
    expect((await reopened.put(new File([png], "renamed.png", { type: "image/png" }))).id).toBe(asset.id);
    expect(await reopened.count()).toBe(1);
  });
  it("stores audio without image decoding and reopens its independent bytes", async () => {
    const wav = new Uint8Array(44);
    wav.set(new TextEncoder().encode("RIFF")); wav.set(new TextEncoder().encode("WAVEfmt "), 8);
    const store = new BrowserMediaStore(crypto.randomUUID());
    const asset = await store.put(new File([wav], "recording.wav", { type: "audio/x-wav" }));
    expect(asset.mimeType).toBe("audio/wav");
    expect(asset.preview).toBeUndefined();
    const stored = await store.get(asset.id);
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(wav);
    expect(stored!.blob.type).toBe("audio/wav");
  });
  it.each(["audio/mpeg", "video/mp4"])("refuses a webpage disguised as %s without saving an asset", async type => {
    const store = new BrowserMediaStore(crypto.randomUUID());
    await expect(store.put(new File(["<html>login</html>"], "wrong", { type }))).rejects.toThrow(/文件|格式/);
    expect(await store.count()).toBe(0);
  });
  it("preserves the stored media kind when identical container bytes are relabeled as another kind", async () => {
    const bytes = new Uint8Array(24); new DataView(bytes.buffer).setUint32(0, 24); bytes.set(new TextEncoder().encode("ftypisom"), 4);
    const store = new BrowserMediaStore(crypto.randomUUID());
    const asset = await store.put(new File([bytes], "audio.m4a", { type: "audio/mp4" }));
    await expect(store.put(new File([bytes], "video.mp4", { type: "video/mp4" }))).rejects.toThrow(/格式|类型/);
    expect((await store.get(asset.id))?.asset.mimeType).toBe("audio/mp4");
    expect(await store.count()).toBe(1);
  });
  it("asks for a local library before attempting to store an oversized browser attachment", async () => {
    const store = new BrowserMediaStore(crypto.randomUUID());
    await expect(store.put({ name: "huge.png", type: "image/png", size: 100_000_001 } as File)).rejects.toThrow(/本地资料库/);
  });
  it("migrates a connected library when browser attachment storage is unavailable", async () => {
    const id = "a".repeat(64);
    const asset = { id, sha256: id, name: "local.png", mimeType: "image/png", size: png.length, createdAt: new Date().toISOString() };
    const get = vi.spyOn(browserMediaStore, "get").mockRejectedValue(new Error("IndexedDB disabled"));
    vi.spyOn(researchMediaClient, "metadata").mockResolvedValue(asset);
    const state = { ...createResearchNotebook(), notes: [{ ...createResearchNote("local"), blocks: [{ id: "pic", type: "media" as const, kind: "image" as const, source: { type: "asset" as const, assetId: id } }] }] };
    await expect(prepareBrowserMediaMigration("new-library", state, "old-library")).resolves.toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });
});
