import { readFile } from "node:fs/promises";
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import manifest from "../docs/wiki/assets/manifest.json" with { type: "json" };
import { meWikiManualAsset, readMeWikiManualAsset } from "../src/domain/meWikiManualAssets.ts";
import { createMeWikiManual } from "../src/domain/meWikiWorkspace.ts";
import { researchMediaAssetIds } from "../src/domain/researchMedia.ts";
import { createBrowserMediaArchive } from "../src/state/researchMediaArchive.ts";
import { ResearchMediaClient } from "../src/state/researchMediaClient.ts";
import { BrowserMediaStore } from "../src/state/researchMediaStorage.ts";

const assetFolder = new URL("../docs/wiki/assets/", import.meta.url);
const localFetch: typeof fetch = async input => {
  const url = String(input);
  const name = Object.keys(manifest).find(name => meWikiManualAsset(manifest[name as keyof typeof manifest].id)?.url === url);
  if (!name) throw new Error(`Unexpected request: ${url}`);
  return new Response(await readFile(new URL(name, assetFolder)));
};

describe("offline manual originals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ships a small, intact original for every media reference in the manual", async () => {
    const notes = createMeWikiManual();
    const ids = researchMediaAssetIds(notes.flatMap(note => note.blocks));
    expect(new Set(ids)).toEqual(new Set(Object.values(manifest).map(asset => asset.id)));
    let total = 0;
    for (const id of ids) {
      const stored = await readMeWikiManualAsset(id, localFetch);
      expect(stored).toBeDefined();
      expect(meWikiManualAsset(id)!.url).not.toMatch(/^https?:/);
      expect(stored!.blob.type).toBe(stored!.asset.mimeType);
      expect(stored!.blob.size).toBe(stored!.asset.size);
      if (stored!.asset.mimeType === "image/png") expect(stored!.previewBlob).toBe(stored!.blob);
      expect(createHash("sha256").update(new Uint8Array(await stored!.blob.arrayBuffer())).digest("hex")).toBe(id);
      total += stored!.asset.size;
    }
    expect(ids).toHaveLength(5);
    expect(total).toBeLessThan(250_000);
  });

  it("exports all showcase originals before any media has been opened or cached", async () => {
    vi.stubGlobal("fetch", localFetch);
    const note = createMeWikiManual().find(note => note.id === "mewiki-manual-21-content-showcase")!;
    const archive = await createBrowserMediaArchive({ version: 8, open: true, view: "notes", activeNoteId: note.id, activeSymbolId: "", symbols: [], notes: [note] }, "markdown", note.id);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    for (const asset of Object.values(manifest)) {
      expect(JSON.parse(new TextDecoder().decode(files[`assets/${asset.id}.json`]))).toEqual(asset);
      const filename = Object.keys(files).find(name => name.startsWith(`assets/${asset.id}.`) && !name.endsWith(".json"))!;
      expect(createHash("sha256").update(files[filename]).digest("hex")).toBe(asset.id);
    }
    const markdown = new TextDecoder().decode(files[Object.keys(files).find(name => name.endsWith(".md"))!]);
    expect(markdown).not.toContain("webbench-asset:");
    expect(markdown).toContain(`../assets/${manifest["showcase-image.png"].id}.png`);
  });

  it("keeps a user-imported copy independent and prefers it over the bundled original", async () => {
    const original = await readMeWikiManualAsset(manifest["showcase-data.csv"].id, localFetch);
    const fetcher = vi.fn(localFetch);
    vi.stubGlobal("fetch", fetcher);
    const store = new BrowserMediaStore(crypto.randomUUID());
    const asset = await store.put(new File([original!.blob], "我的演示数据.csv", { type: "text/csv" }));
    expect(asset.name).toBe("我的演示数据.csv");
    expect(await store.count()).toBe(1);
    fetcher.mockClear();
    expect((await store.get(asset.id))?.asset.name).toBe("我的演示数据.csv");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a damaged bundled file and never substitutes unknown user originals", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("not the original"));
    await expect(readMeWikiManualAsset(manifest["showcase-image.png"].id, fetcher)).rejects.toThrow(/校验/);
    fetcher.mockClear();
    expect(await readMeWikiManualAsset("f".repeat(64), fetcher)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("materializes a missing manual original through the existing local upload protocol", async () => {
    const asset = manifest["showcase-data.csv"];
    const calls: string[] = [], chunks: Blob[] = [];
    const client = new ResearchMediaClient(async (input, init) => {
      const url = String(input); calls.push(url);
      if (url === meWikiManualAsset(asset.id)!.url) return localFetch(input, init);
      const headers = { "content-type": "application/json" };
      if (url.includes("/assets/")) return new Response(JSON.stringify({ error: "附件未找到" }), { status: 404, headers });
      if (url.endsWith("/uploads")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ sha256: asset.id, size: asset.size, directory: "test-library" });
        return new Response(JSON.stringify({ uploadId: "demo-upload", chunkSize: 4096, received: [] }), { headers });
      }
      if (init?.method === "PUT") chunks.push(init.body as Blob);
      return new Response(JSON.stringify(url.endsWith("/complete") ? asset : {}), { headers });
    });
    expect(await client.metadata("test-library", asset.id)).toEqual(asset);
    expect(await new Blob(chunks).text()).toBe(await (await localFetch(meWikiManualAsset(asset.id)!.url)).text());
    expect(calls.some(url => url.endsWith("/complete"))).toBe(true);
  });

  it("keeps service errors and missing user originals visible without fetching bundled files", async () => {
    for (const [id, status] of [[manifest["showcase-image.png"].id, 503], ["f".repeat(64), 404]] as const) {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "原错误" }), { status, headers: { "content-type": "application/json" } }));
      await expect(new ResearchMediaClient(fetcher).metadata("test-library", id)).rejects.toThrow("原错误");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
