import { describe, expect, it } from "vitest";
import { ResearchMediaClient, hashMediaBlob } from "./researchMediaClient.ts";
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");

describe("media file transfer", () => {
  it("requests publication metadata using a normalized DOI and cancellable local request", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const metadata = { doi: "10.1234/test", title: "研究报告" };
    const client = new ResearchMediaClient(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(metadata), { headers: { "content-type": "application/json" } });
    });
    const abort = new AbortController();
    expect(await client.citationMetadata("https://doi.org/10.1234/test", abort.signal)).toEqual(metadata);
    expect(calls[0].url).toBe("/api/research-library/media/citation-metadata");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ doi: "10.1234/test" });
    expect(new Headers(calls[0].init?.headers).get("x-webbench-request")).toBe("research-library");
    abort.abort();
    expect(calls[0].init?.signal?.aborted).toBe(true);
  });
  it("hashes blob slices without reading the whole file at once", async () => {
    const blob = new Blob([new Uint8Array(8 * 1024 * 1024 + 13).fill(37)]);
    const sizes: number[] = [];
    const original = blob.slice.bind(blob);
    blob.slice = (start, end, type) => { const part = original(start, end, type); sizes.push(part.size); return part; };
    expect(await hashMediaBlob(blob)).toBe(await digest(new Uint8Array(await original().arrayBuffer())));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(sizes.length).toBeGreaterThan(1);
  });
  it("resumes received slices and only publishes a verified complete attachment", async () => {
    const file = new File([new Uint8Array(8 * 1024 * 1024 + 7).fill(3)], "test.png", { type: "image/png" });
    const calls: { url: string; init?: RequestInit }[] = [];
    const sha256 = await hashMediaBlob(file);
    const asset = { id: sha256, sha256, name: file.name, size: file.size, mimeType: file.type, createdAt: new Date().toISOString() };
    const client = new ResearchMediaClient(async (input, init) => {
      const url = String(input); calls.push({ url, init });
      return new Response(JSON.stringify(url.endsWith("/uploads") ? { uploadId: "u", chunkSize: 8 * 1024 * 1024, received: [0] } : url.includes("/complete") ? asset : { received: [0, 1] }), { headers: { "content-type": "application/json" } });
    });
    expect(await client.upload("D:/library", file)).toEqual(asset);
    const chunks = calls.filter(call => call.init?.method === "PUT");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].url).toContain("/uploads/u/1?");
    expect((chunks[0].init!.body as Blob).size).toBe(7);
    expect(new Headers(chunks[0].init?.headers).get("x-chunk-sha256")).toBe(await digest(new Uint8Array(7).fill(3)));
  });
  it("does not publish after cancellation or a rejected slice", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(hashMediaBlob(new Blob(["image"]), undefined, abort.signal)).rejects.toThrow();
    const client = new ResearchMediaClient(async input => new Response(JSON.stringify(String(input).endsWith("/uploads") ? { uploadId: "u", chunkSize: 8 * 1024 * 1024, received: [] } : { error: "分片校验失败" }), { status: String(input).endsWith("/uploads") ? 200 : 422, headers: { "content-type": "application/json" } }));
    await expect(client.upload("D:/library", new File(["bad"], "test.png", { type: "image/png" }))).rejects.toThrow("分片校验失败");
  });
});
