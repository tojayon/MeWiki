import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createResearchNotebook } from "../src/domain/researchNotebook.ts";
import { MEDIA_CHUNK_BYTES } from "../src/domain/researchMedia.ts";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";
import { ResearchMediaStore } from "./researchMediaStore.ts";

// Explicit opt-in: exercises real 100 MB, 500 MB and 1 GB files and requires ~3 GB free disk space.
const enabled = process.env.MEWIKI_MEDIA_LARGE_TESTS === "1";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("webbench-media-large-")
    )
      throw new Error("Invalid large-media test cleanup path");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

describe.skipIf(!enabled)("large media round-trip acceptance", () => {
  it.each([[100_000_000, "image"], [500_000_000, "image"], [1_000_000_000, "image"], [1_000_000_000, "file"]] as const)(
    "round-trips %i bytes of %s through resumed upload and ZIP64 backup without whole-file buffers",
    async (size, kind) => {
      const initialRSS = process.memoryUsage().rss;
      let peakRSS = initialRSS;
      const sampleMemory = () => {
        peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
      };
      const root = await mkdtemp(path.join(tmpdir(), "webbench-media-large-"));
      roots.push(root);
      const directory = path.join(root, "source");
      const library = new ResearchLibraryStore({
        settingsFile: path.join(root, "source-settings.json"),
      });
      const notebook = createResearchNotebook();
      await library.connect({ directory, mode: "create", notebook });
      const media = new ResearchMediaStore(library);
      const body = Buffer.alloc(MEDIA_CHUNK_BYTES, 0x3a);
      const first = Buffer.from(body);
      if (kind === "image") Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
        "base64",
      ).copy(first);
      const part = (index: number) =>
        (index === 0 ? first : body).subarray(
          0,
          Math.min(MEDIA_CHUNK_BYTES, size - index * MEDIA_CHUNK_BYTES),
        );
      const wholeHash = createHash("sha256");
      const count = Math.ceil(size / MEDIA_CHUNK_BYTES);
      for (let i = 0; i < count; i++) wholeHash.update(part(i));
      const sha256 = wholeHash.digest("hex");
      const request = {
        directory,
        name: `${size}.${kind === "image" ? "png" : "dat"}`,
        mimeType: kind === "image" ? "image/png" : "application/octet-stream",
        size,
        sha256,
      };
      const session = await media.startUpload(request);
      const send = async (store: ResearchMediaStore, index: number) => {
        const bytes = part(index);
        await store.writeChunk(
          directory,
          session.uploadId,
          index,
          Readable.from([bytes]),
          createHash("sha256").update(bytes).digest("hex"),
        );
        sampleMemory();
      };
      await send(media, 0);
      const restarted = new ResearchMediaStore(library);
      expect((await restarted.startUpload(request)).received).toEqual([0]);
      for (let i = 1; i < count; i++) await send(restarted, i);
      const asset = await restarted.completeUpload(directory, session.uploadId);
      expect(asset.size).toBe(size);
      expect(asset.sha256).toBe(sha256);
      notebook.notes[0].blocks.push({
        id: "large-media",
        type: "media",
        kind,
        source: { type: "asset", assetId: asset.id },
      });
      const targetDirectory = path.join(root, "restored");
      const targetLibrary = new ResearchLibraryStore({
        settingsFile: path.join(root, "restored-settings.json"),
      });
      await targetLibrary.connect({
        directory: targetDirectory,
        mode: "create",
        notebook: createResearchNotebook(),
      });
      const target = new ResearchMediaStore(targetLibrary);
      const prepared = await restarted.createExport({
        directory,
        notebook,
        format: "library",
      });
      const archive = await restarted.exportArchive(directory, prepared.id);
      let exportedBytes = 0;
      async function* transfer() {
        for await (const chunk of archive.stream) {
          exportedBytes += chunk.length;
          sampleMemory();
          yield chunk;
        }
      }
      const restored = await target.importArchive(targetDirectory, transfer());
      expect(
        JSON.parse(restored.content).notebook.notes[0].blocks.some(
          (block: { id: string }) => block.id === "large-media",
        ),
      ).toBe(true);
      const content = await target.content(targetDirectory, asset.id, false);
      const actual = createHash("sha256");
      for await (const bytes of createReadStream(content.filename)) {
        actual.update(bytes);
        sampleMemory();
      }
      expect(actual.digest("hex")).toBe(sha256);
      expect(exportedBytes).toBeGreaterThan(size);
      expect(peakRSS - initialRSS).toBeLessThan(384 * 1024 * 1024);
      console.info(
        `媒体往返 ${size} 字节；峰值 RSS ${Math.round(peakRSS / 1024 / 1024)} MiB；较开始增加 ${Math.round((peakRSS - initialRSS) / 1024 / 1024)} MiB。`,
      );
      await Promise.all([
        media.dispose(),
        restarted.dispose(),
        target.dispose(),
      ]);
    },
    240_000,
  );
});
