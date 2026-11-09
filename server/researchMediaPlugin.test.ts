import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createResearchNotebook } from "../src/domain/researchNotebook.ts";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";
import { createResearchLibraryMiddleware } from "./researchLibraryPlugin.ts";

const fixtures: { root: string; server: Server }[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    if (
      path.dirname(fixture.root) !== path.resolve(tmpdir()) ||
      !path.basename(fixture.root).startsWith("webbench-media-http-")
    )
      throw new Error("Invalid test cleanup path");
    await rm(fixture.root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "webbench-media-http-"));
  const directory = path.join(root, "library");
  const store = new ResearchLibraryStore({
    settingsFile: path.join(root, "settings.json"),
  });
  await store.connect({
    directory,
    mode: "create",
    notebook: createResearchNotebook(),
  });
  const middleware = createResearchLibraryMiddleware(store);
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  fixtures.push({ root, server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/research-library/media`;
  const send = (route: string, value: unknown) =>
    fetch(url + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WebBench-Request": "research-library",
      },
      body: JSON.stringify(value),
    });
  return { root, directory, store, url, send };
}

describe("research media HTTP endpoints", () => {
  it("serves playable audio ranges inline while keeping the original download available", async () => {
    const { directory, url, send } = await fixture();
    const bytes = Buffer.concat([Buffer.from("RIFF0000WAVEfmt "), Buffer.alloc(28)]);
    const id = hash(bytes);
    await send("/uploads", { directory, name: "recording.wav", mimeType: "audio/wav", size: bytes.length, sha256: id });
    const query = new URLSearchParams({ directory });
    await fetch(`${url}/uploads/${id}/0?${query}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-WebBench-Request": "research-library", "X-Chunk-Sha256": id }, body: bytes });
    expect((await send(`/uploads/${id}/complete`, { directory })).status).toBe(200);
    const content = `${url}/assets/${id}/content?${query}`;
    const partial = await fetch(content + "&inline=1", { headers: { Range: "bytes=8-15" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Type")).toBe("audio/wav");
    expect(partial.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(8, 16));
    expect((await fetch(content, { method: "HEAD" })).headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });
  it("uploads binary chunks independently and supports byte ranges, HEAD and safe previews", async () => {
    const { directory, url, send } = await fixture();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#2196f3" },
    })
      .png()
      .toBuffer();
    const id = hash(image);
    const started = await send("/uploads", {
      directory,
      name: "图像.png",
      mimeType: "image/png",
      size: image.length,
      sha256: id,
    });
    expect(started.status).toBe(200);
    expect((await started.json()).uploadId).toBe(id);
    const query = new URLSearchParams({ directory });
    const written = await fetch(`${url}/uploads/${id}/0?${query}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-WebBench-Request": "research-library",
        "X-Chunk-Sha256": id,
      },
      body: image,
    });
    expect(written.status).toBe(200);
    expect((await send(`/uploads/${id}/complete`, { directory })).status).toBe(
      200,
    );
    const content = `${url}/assets/${id}/content?${query}`;
    const partial = await fetch(content, { headers: { Range: "bytes=2-9" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe(
      `bytes 2-9/${image.length}`,
    );
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(
      image.subarray(2, 10),
    );
    expect(partial.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    const suffix = await fetch(content, { headers: { Range: "bytes=-5" } });
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(image.subarray(-5));
    const head = await fetch(content, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe(String(image.length));
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const invalid = await fetch(content, {
      headers: { Range: `bytes=${image.length}-` },
    });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("Content-Range")).toBe(
      `bytes */${image.length}`,
    );
    const preview = await fetch(content + "&preview=1");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/webp");
    expect(preview.headers.get("Content-Disposition")).toMatch(/^inline;/);
  });

  it("requires local same-origin write intent for both JSON and binary operations", async () => {
    const { directory, url, send } = await fixture();
    const denied = await fetch(url + "/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory }),
    });
    expect(denied.status).toBe(403);
    const otherOrigin = await fetch(url + "/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WebBench-Request": "research-library",
        Origin: "https://example.com",
      },
      body: JSON.stringify({ directory }),
    });
    expect(otherOrigin.status).toBe(403);
    const oversized = await send("/uploads", {
      directory,
      name: "big.png",
      mimeType: "image/png",
      size: 1_000_000_001,
      sha256: "0".repeat(64),
    });
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error).toContain("1 GB");
    expect(
      (
        await fetch(
          url +
            "/assets/" +
            "0".repeat(64) +
            "?" +
            new URLSearchParams({ directory }),
        )
      ).status,
    ).toBe(404);
  });
});
