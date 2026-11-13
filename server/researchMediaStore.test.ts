import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { ZipFile } from "yazl";
import { openPromise as openZip } from "yauzl";
import { createResearchNotebook } from "../src/domain/researchNotebook.ts";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";
import { ResearchMediaStore } from "./researchMediaStore.ts";

const roots: string[] = [];
const servers: Server[] = [];
const mediaStores: ResearchMediaStore[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
  "base64",
);
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "webbench-media-test-"));
  roots.push(root);
  const directory = path.join(root, "图片 资料库");
  const library = new ResearchLibraryStore({
    settingsFile: path.join(root, "settings.json"),
  });
  const notebook = createResearchNotebook();
  await library.connect({ directory, mode: "create", notebook });
  return {
    root,
    directory,
    library,
    notebook,
    media: new ResearchMediaStore(library),
  };
}
afterEach(async () => {
  for (const media of mediaStores.splice(0)) await media.dispose();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("webbench-media-test-")
    )
      throw new Error("Invalid test cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});
async function upload(
  media: ResearchMediaStore,
  directory: string,
  data = png,
) {
  const session = await media.startUpload({
    directory,
    name: "试验 图像.png",
    mimeType: "image/png",
    size: data.length,
    sha256: hash(data),
  });
  for (let i = 0; i * session.chunkSize < data.length; i++) {
    const part = data.subarray(
      i * session.chunkSize,
      (i + 1) * session.chunkSize,
    );
    await media.writeChunk(
      directory,
      session.uploadId,
      i,
      Readable.from([part]),
      hash(part),
    );
  }
  return await media.completeUpload(directory, session.uploadId);
}

describe("research media storage", () => {
  it('lists an empty font library without creating assets or accepting an invalid directory', async () => {
    const { directory, media } = await fixture();
    const before = (await readdir(directory)).sort();
    expect(await media.fonts(directory)).toEqual([]);
    expect((await readdir(directory)).sort()).toEqual(before);
    await writeFile(path.join(directory, 'assets'), 'not a directory');
    await expect(media.fonts(directory)).rejects.toThrow(/附件目录/);
  });
  it('keeps imported fonts in the library across reopen and complete backup restore', async () => {
    const { root, directory, library, notebook, media } = await fixture();
    const data = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
    const request = { directory, name: '随库字体.woff2', mimeType: 'font/woff2', size: data.length, sha256: hash(data) };
    const session = await media.startUpload(request);
    await media.writeChunk(directory, session.uploadId, 0, Readable.from([data]), hash(data));
    const asset = await media.completeUpload(directory, session.uploadId);
    expect(await new ResearchMediaStore(library).fonts(directory)).toEqual([asset]);
    expect((await media.startUpload(request)).asset?.id).toBe(asset.id);
    const exporting = await media.createExport({ directory, notebook, format: 'library' });
    const archive = await media.exportArchive(directory, exporting.id);
    const chunks: Buffer[] = [];
    for await (const chunk of archive.stream) chunks.push(Buffer.from(chunk));
    const restoreDirectory = path.join(root, '字体恢复库');
    const restoreLibrary = new ResearchLibraryStore({ settingsFile: path.join(root, 'restore-settings.json') });
    await restoreLibrary.connect({ directory: restoreDirectory, mode: 'create', notebook });
    const restored = new ResearchMediaStore(restoreLibrary);
    await restored.importArchive(restoreDirectory, Readable.from(chunks));
    expect(await restored.fonts(restoreDirectory)).toEqual([asset]);
    expect(await readFile((await restored.content(restoreDirectory, asset.id, false)).filename)).toEqual(data);
    await expect(restored.fonts(directory)).rejects.toThrow();
  });
  it.each(["audio/mpeg", "video/mp4"])("does not publish a webpage disguised as %s", async mimeType => {
    const { directory, media } = await fixture();
    const data = Buffer.from("<html>login</html>");
    const session = await media.startUpload({ directory, name: "not-media", mimeType, size: data.length, sha256: hash(data) });
    await media.writeChunk(directory, session.uploadId, 0, Readable.from([data]), hash(data));
    await expect(media.completeUpload(directory, session.uploadId)).rejects.toThrow(/文件|格式/);
    await expect(media.asset(directory, hash(data))).rejects.toThrow();
  });
  it.each(["audio/wav", "video/mp4"])("downloads a supported remote %s resource without image preview processing", async mimeType => {
    const { directory, library } = await fixture();
    const bytes = mimeType === "audio/wav" ? Buffer.concat([Buffer.from("RIFF0000WAVEfmt "), Buffer.alloc(28)]) : Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]);
    const server = createServer((_request, response) => { response.writeHead(200, { "Content-Type": mimeType }); response.end(bytes); });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const media = new ResearchMediaStore(library, { remoteAddressPolicy: () => true });
    mediaStores.push(media);
    let job = await media.startRemote({ directory, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/sample` });
    for (let attempt = 0; job.status === "downloading" && attempt < 100; attempt++) { await delay(20); job = await media.remoteStatus(directory, job.id); }
    expect(job.status).toBe("complete");
    expect(job.asset?.mimeType).toBe(mimeType);
    expect(job.asset?.preview).toBeUndefined();
    expect(await readFile((await media.content(directory, job.asset!.id, false)).filename)).toEqual(bytes);
  });
  it("generates and repairs previews in deeply nested library directories", async () => {
    const { root, library, notebook, media } = await fixture();
    const directory = path.join(root, "research-images-".repeat(5), "research-images-".repeat(5), "research-images-".repeat(5));
    await library.connect({ directory, mode: "create", notebook });
    const source = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#79a6ff" } }).png().toBuffer();
    const asset = await upload(media, directory, source);
    expect(asset.preview).toMatchObject({ width: 32, height: 24, mimeType: "image/webp" });
    const content = await media.content(directory, asset.id, true);
    expect((await sharp(path.toNamespacedPath(content.filename)).metadata()).width).toBe(32);
    await rm(content.filename);
    const resumed = await media.startUpload({ directory, name: asset.name, mimeType: asset.mimeType, size: source.length, sha256: asset.id });
    expect(resumed.asset?.preview).toBeDefined();
    expect((await sharp(path.toNamespacedPath(content.filename)).metadata()).width).toBe(32);
  });
  it("keeps verified originals separate from notebook JSON and deduplicates copies", async () => {
    const { directory, media } = await fixture();
    const asset = await upload(media, directory);
    expect(asset.id).toBe(hash(png));
    expect(asset.size).toBe(png.length);
    const original = await media.content(directory, asset.id, false);
    expect(await readFile(original.filename)).toEqual(png);
    expect(await upload(media, directory)).toEqual(asset);
    expect(
      (await readdir(path.join(directory, "assets"))).filter((name) =>
        name.endsWith(".png"),
      ),
    ).toHaveLength(1);
    expect(await media.asset(directory, asset.id)).toEqual(asset);
  });

  it("resumes the exact source after service restart and retries chunks idempotently", async () => {
    const { directory, library, media } = await fixture();
    const source = Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024 + 64, 19)]);
    const request = {
      directory,
      name: "large.png",
      mimeType: "image/png",
      size: source.length,
      sha256: hash(source),
    };
    const session = await media.startUpload(request);
    const first = source.subarray(0, session.chunkSize);
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([first]),
      hash(first),
    );
    const restarted = new ResearchMediaStore(library);
    const resumed = await restarted.startUpload(request);
    expect(resumed.received).toEqual([0]);
    await restarted.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([first]),
      hash(first),
    );
    await expect(
      restarted.completeUpload(directory, session.uploadId),
    ).rejects.toThrow("分片");
    const second = source.subarray(session.chunkSize);
    await restarted.writeChunk(
      directory,
      session.uploadId,
      1,
      Readable.from([second]),
      hash(second),
    );
    const asset = await restarted.completeUpload(directory, session.uploadId);
    expect(
      hash(
        await readFile(
          (await restarted.content(directory, asset.id, false)).filename,
        ),
      ),
    ).toBe(hash(source));
  });

  it("rejects overflow, corrupt chunks, source mismatch and unsafe identifiers", async () => {
    const { directory, media } = await fixture();
    await expect(
      media.startUpload({
        directory,
        name: "too-big.png",
        mimeType: "image/png",
        size: 1_000_000_001,
        sha256: hash(png),
      }),
    ).rejects.toThrow("1 GB");
    const session = await media.startUpload({
      directory,
      name: "a.png",
      mimeType: "image/png",
      size: png.length,
      sha256: hash(png),
    });
    await expect(
      media.writeChunk(
        directory,
        session.uploadId,
        0,
        Readable.from([png]),
        "0".repeat(64),
      ),
    ).rejects.toThrow("校验");
    await expect(
      media.writeChunk(
        directory,
        session.uploadId,
        0,
        Readable.from([Buffer.concat([png, png])]),
        hash(png),
      ),
    ).rejects.toThrow("大小");
    await expect(media.asset(directory, "../settings")).rejects.toThrow("标识");
    await expect(
      media.asset(path.dirname(directory), hash(png)),
    ).rejects.toThrow("目录");
    const missing = hash(Buffer.from("missing"));
    await expect(media.asset(directory, missing)).rejects.toThrow("不存在");
  });

  it("does not publish a fake image or an original whose final hash differs", async () => {
    const { directory, media } = await fixture();
    const fake = Buffer.from("<html>login required</html>");
    await expect(upload(media, directory, fake)).rejects.toThrow("图片");
    const session = await media.startUpload({
      directory,
      name: "changed.png",
      mimeType: "image/png",
      size: png.length,
      sha256: "1".repeat(64),
    });
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([png]),
      hash(png),
    );
    await expect(
      media.completeUpload(directory, session.uploadId),
    ).rejects.toThrow("校验");
    await expect(media.asset(directory, "1".repeat(64))).rejects.toThrow(
      "不存在",
    );
  });

  it("detects an original that was removed without exposing internal paths", async () => {
    const { directory, media } = await fixture();
    const asset = await upload(media, directory);
    const original = await media.content(directory, asset.id, false);
    await rm(original.filename);
    await expect(media.content(directory, asset.id, false)).rejects.toThrow(
      "不存在",
    );
    await writeFile(original.filename, png);
    expect((await media.content(directory, asset.id, false)).size).toBe(
      png.length,
    );
  });

  it("generates bounded previews without substituting them for original bytes", async () => {
    const { directory, media } = await fixture();
    const source = await sharp({
      create: { width: 2200, height: 20, channels: 3, background: "#1188cc" },
    })
      .png()
      .toBuffer();
    const asset = await upload(media, directory, source);
    expect(asset.width).toBe(2200);
    expect(asset.preview?.width).toBe(1600);
    const preview = await media.content(directory, asset.id, true);
    expect(preview.mimeType).toBe("image/webp");
    expect((await sharp(preview.filename).metadata()).width).toBe(1600);
    expect(
      await readFile(
        (await media.content(directory, asset.id, false)).filename,
      ),
    ).toEqual(source);
  });

  it("downloads remote images into the library and records provenance", async () => {
    const { directory, library } = await fixture();
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Length", png.length);
      response.end(png);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/image.png`;
    const media = new ResearchMediaStore(library, {
      remoteAddressPolicy: () => true,
    });
    mediaStores.push(media);
    let job = await media.startRemote({ directory, url });
    for (let i = 0; i < 100 && job.status === "downloading"; i++) {
      await delay(10);
      job = await media.remoteStatus(directory, job.id);
    }
    expect(job.status, job.error).toBe("complete");
    expect(job.asset?.sourceUrl).toBe(url);
    expect(
      await readFile(
        (await media.content(directory, job.asset!.id, false)).filename,
      ),
    ).toEqual(png);
    expect((await media.startRemote({ directory, url })).asset?.id).toBe(
      job.asset?.id,
    );
  });

  it("rejects private-network URLs and never treats a returned login page as an image", async () => {
    const { directory, library, media } = await fixture();
    await expect(
      media.startRemote({ directory, url: "file:///etc/passwd" }),
    ).rejects.toThrow("HTTP");
    let job = await media.startRemote({
      directory,
      url: "http://127.0.0.1:1/test.png",
    });
    for (let i = 0; i < 100 && job.status === "downloading"; i++) {
      await delay(10);
      job = await media.remoteStatus(directory, job.id);
    }
    expect(job.status).toBe("error");
    expect(job.error).toContain("网络地址");
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end("<html>login</html>");
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const downloader = new ResearchMediaStore(library, {
      remoteAddressPolicy: () => true,
    });
    mediaStores.push(downloader);
    job = await downloader.startRemote({
      directory,
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}/login`,
    });
    for (let i = 0; i < 100 && job.status === "downloading"; i++) {
      await delay(10);
      job = await downloader.remoteStatus(directory, job.id);
    }
    expect(job.status).toBe("error");
    expect(job.error).toContain("媒体文件");
    expect(job.asset).toBeUndefined();
  });

  it("stages browser attachments before committing a new library binding", async () => {
    const { root, directory, library, media, notebook } = await fixture();
    const target = path.join(root, "new-library");
    const stage = await media.startStaging({ directory: target });
    const request = {
      directory: target,
      stagingId: stage.id,
      name: "browser.png",
      mimeType: "image/png",
      size: png.length,
      sha256: hash(png),
    };
    const session = await media.startUpload(request);
    await media.writeChunk(
      target,
      session.uploadId,
      0,
      Readable.from([png]),
      hash(png),
      stage.id,
    );
    const asset = await media.completeUpload(
      target,
      session.uploadId,
      stage.id,
    );
    expect((await library.read()).directory).toBe(directory);
    await expect(media.asset(target, asset.id)).rejects.toThrow("目录");
    notebook.notes[0].blocks.push({
      id: "browser-media",
      type: "media",
      kind: "image",
      source: { type: "asset", assetId: asset.id },
    });
    await media.prepareConnect({
      directory: target,
      mediaStagingId: stage.id,
      mode: "create",
      notebook,
    });
    await library.connect({ directory: target, mode: "create", notebook });
    expect((await media.asset(target, asset.id)).sha256).toBe(hash(png));
    expect((await library.read()).directory).toBe(target);
  });

  it("exports a streaming ZIP64 backup and restores its verified attachments", async () => {
    const { root, directory, media, notebook } = await fixture();
    const asset = await upload(media, directory);
    notebook.notes[0].blocks.push({
      id: "backup-image",
      type: "media",
      kind: "image",
      source: { type: "asset", assetId: asset.id },
    });
    const prepared = await media.createExport({
      directory,
      notebook,
      format: "library",
    });
    const archive = await media.exportArchive(directory, prepared.id);
    const chunks: Buffer[] = [];
    for await (const chunk of archive.stream) chunks.push(Buffer.from(chunk));
    const data = Buffer.concat(chunks);
    expect(data.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBe(true);
    const archiveFile = path.join(root, "backup.zip");
    await writeFile(archiveFile, data);
    const zip = await openZip(archiveFile, { lazyEntries: true });
    const names: string[] = [];
    for await (const entry of zip.eachEntry()) names.push(entry.fileName);
    expect(names).toContain(`assets/${asset.id}.png`);
    const target = await fixture();
    const imported = await target.media.importArchive(
      target.directory,
      Readable.from([data]),
    );
    expect(
      JSON.parse(imported.content).notebook.notes[0].blocks.some(
        (block: { id: string }) => block.id === "backup-image",
      ),
    ).toBe(true);
    expect(
      await readFile(
        (await target.media.content(target.directory, asset.id, false))
          .filename,
      ),
    ).toEqual(png);
  });

  it("rejects an incomplete archive without publishing even the valid-looking resource", async () => {
    const { directory, media } = await fixture();
    const zip = new ZipFile();
    zip.addBuffer(png, `assets/${hash(png)}.png`);
    zip.end();
    await expect(
      media.importArchive(directory, zip.outputStream as Readable),
    ).rejects.toThrow("备份");
    await expect(media.asset(directory, hash(png))).rejects.toThrow("不存在");
  });

  it("resumes a paused remote image only with the same source validator", async () => {
    const { directory, library } = await fixture();
    const source = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024, 11)]);
    const ranges: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      ranges.push(request.headers.range);
      const start = Number(
        request.headers.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0,
      );
      response.statusCode = start ? 206 : 200;
      response.setHeader("Content-Type", "image/png");
      response.setHeader("ETag", '"stable-source"');
      response.setHeader("Content-Length", source.length - start);
      if (start)
        response.setHeader(
          "Content-Range",
          `bytes ${start}-${source.length - 1}/${source.length}`,
        );
      void (async () => {
        for (
          let offset = start;
          offset < source.length && !response.destroyed;
          offset += 64 * 1024
        ) {
          response.write(source.subarray(offset, offset + 64 * 1024));
          await delay(3);
        }
        if (!response.destroyed) response.end();
      })();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const media = new ResearchMediaStore(library, {
      remoteAddressPolicy: () => true,
    });
    mediaStores.push(media);
    const request = {
      directory,
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}/large.png`,
    };
    let job = await media.startRemote(request);
    for (let i = 0; i < 200 && job.bytes < 1024 * 1024; i++) {
      await delay(5);
      job = await media.remoteStatus(directory, job.id);
    }
    job = await media.pauseRemote(directory, job.id);
    expect(job.status).toBe("paused");
    expect(job.bytes).toBeGreaterThanOrEqual(1024 * 1024);
    expect(job.bytes).toBeLessThan(source.length);
    const pausedBytes = job.bytes;
    const restarted = new ResearchMediaStore(library, {
      remoteAddressPolicy: () => true,
    });
    mediaStores.push(restarted);
    job = await restarted.startRemote(request);
    for (let i = 0; i < 200 && job.status === "downloading"; i++) {
      await delay(5);
      job = await restarted.remoteStatus(directory, job.id);
    }
    expect(job.status).toBe("complete");
    expect(ranges).toEqual([undefined, `bytes=${pausedBytes}-`]);
    expect(job.asset?.sha256).toBe(hash(source));
  });

  it("detects damaged durable chunks on resume so the client can upload them again", async () => {
    const { directory, library, media } = await fixture();
    const request = {
      directory,
      name: "image.png",
      mimeType: "image/png",
      size: png.length,
      sha256: hash(png),
    };
    const session = await media.startUpload(request);
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([png]),
      hash(png),
    );
    await writeFile(
      path.join(directory, ".media-transfers", session.uploadId, "0.part"),
      Buffer.alloc(png.length),
    );
    const resumed = await new ResearchMediaStore(library).startUpload(request);
    expect(resumed.received).toEqual([]);
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([png]),
      hash(png),
    );
    expect((await media.completeUpload(directory, session.uploadId)).id).toBe(
      hash(png),
    );
  });

  it("keeps the original binding when a requested attachment was not migrated", async () => {
    const { root, directory, library, media, notebook } = await fixture();
    notebook.notes[0].blocks.push({
      id: "missing-media",
      type: "media",
      kind: "image",
      source: { type: "asset", assetId: "2".repeat(64) },
    });
    await expect(
      media.prepareConnect({
        directory: path.join(root, "other"),
        mode: "create",
        notebook,
      }),
    ).rejects.toThrow("附件不存在");
    expect((await library.read()).directory).toBe(directory);
  });

  it("repairs a corrupt original only after validating a complete replacement and preserves recovery bytes", async () => {
    const { directory, media } = await fixture();
    const asset = await upload(media, directory);
    const original = await media.content(directory, asset.id, false);
    const corrupt = Buffer.alloc(png.length, 71);
    await writeFile(original.filename, corrupt);
    const beforeMetadata = await readFile(
      path.join(directory, "assets", asset.id + ".json"),
    );
    const repaired = await upload(media, directory);
    expect(repaired).toEqual(asset);
    expect(await readFile(original.filename)).toEqual(png);
    const recoveryRoot = path.join(directory, ".media-recovery", asset.id);
    const revisions = await readdir(recoveryRoot);
    expect(revisions).toHaveLength(1);
    const recovered = path.join(recoveryRoot, revisions[0]);
    expect(await readFile(path.join(recovered, "original.png"))).toEqual(
      corrupt,
    );
    expect(await readFile(path.join(recovered, "metadata.json"))).toEqual(
      beforeMetadata,
    );
    expect(await upload(media, directory)).toEqual(asset);
    expect(await readdir(recoveryRoot)).toHaveLength(1);
  });

  it("repairs a missing original through the same resumed upload without changing the asset identity", async () => {
    const { directory, media, library } = await fixture();
    const asset = await upload(media, directory);
    const original = await media.content(directory, asset.id, false);
    await rm(original.filename);
    const request = {
      directory,
      name: "renamed.png",
      mimeType: "image/png",
      size: png.length,
      sha256: hash(png),
    };
    const session = await media.startUpload(request);
    expect(session.asset).toBeUndefined();
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([png]),
      hash(png),
    );
    const restarted = new ResearchMediaStore(library);
    expect((await restarted.startUpload(request)).received).toEqual([0]);
    expect(await restarted.completeUpload(directory, session.uploadId)).toEqual(
      asset,
    );
    expect(await readFile(original.filename)).toEqual(png);
    expect(await restarted.completeUpload(directory, session.uploadId)).toEqual(
      asset,
    );
  });

  it("leaves corrupt originals and metadata byte-for-byte intact when replacement verification fails", async () => {
    const { directory, media } = await fixture();
    const asset = await upload(media, directory);
    const original = await media.content(directory, asset.id, false);
    const corrupt = Buffer.alloc(png.length - 3, 43);
    await writeFile(original.filename, corrupt);
    const metadataPath = path.join(directory, "assets", asset.id + ".json");
    const metadata = await readFile(metadataPath);
    const session = await media.startUpload({
      directory,
      name: "failed.png",
      mimeType: "image/png",
      size: png.length,
      sha256: hash(png),
    });
    const incorrect = Buffer.alloc(png.length, 91);
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([incorrect]),
      hash(incorrect),
    );
    await expect(
      media.completeUpload(directory, session.uploadId),
    ).rejects.toThrow("校验");
    expect(await readFile(original.filename)).toEqual(corrupt);
    expect(await readFile(metadataPath)).toEqual(metadata);
    await media.writeChunk(
      directory,
      session.uploadId,
      0,
      Readable.from([png]),
      hash(png),
    );
    expect((await media.completeUpload(directory, session.uploadId)).id).toBe(
      asset.id,
    );
    expect(await readFile(original.filename)).toEqual(png);
  });

  it("repairs a corrupt downloaded image when the user downloads its source again", async () => {
    const { directory, library } = await fixture();
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "image/png");
      response.end(png);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const media = new ResearchMediaStore(library, {
      remoteAddressPolicy: () => true,
    });
    mediaStores.push(media);
    const request = {
      directory,
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}/repair.png`,
    };
    let job = await media.startRemote(request);
    for (let i = 0; i < 100 && job.status === "downloading"; i++) {
      await delay(10);
      job = await media.remoteStatus(directory, job.id);
    }
    expect(job.status, job.error).toBe("complete");
    const original = await media.content(directory, job.asset!.id, false);
    await writeFile(original.filename, Buffer.alloc(png.length));
    job = await media.startRemote(request);
    for (let i = 0; i < 100 && job.status === "downloading"; i++) {
      await delay(10);
      job = await media.remoteStatus(directory, job.id);
    }
    expect(job.status, job.error).toBe("complete");
    expect(await readFile(original.filename)).toEqual(png);
  });

  it("prepares a bounded preview before replacing a broken original and keeps the old preview in recovery", async () => {
    const { directory, media } = await fixture();
    const source = await sharp({
      create: { width: 30, height: 25, channels: 3, background: "#ab5421" },
    })
      .png()
      .toBuffer();
    const asset = await upload(media, directory, source);
    expect(asset.preview).toBeDefined();
    const original = await media.content(directory, asset.id, false);
    const preview = await media.content(directory, asset.id, true);
    const previousPreview = await readFile(preview.filename);
    await writeFile(original.filename, Buffer.alloc(source.length));
    expect(await upload(media, directory, source)).toEqual(asset);
    expect(await readFile(original.filename)).toEqual(source);
    expect(await readFile(preview.filename)).toEqual(previousPreview);
    const recoveryRoot = path.join(directory, ".media-recovery", asset.id);
    const [revision] = await readdir(recoveryRoot);
    expect(
      await readFile(path.join(recoveryRoot, revision, "preview.webp")),
    ).toEqual(previousPreview);
  });

  it("regenerates missing or damaged previews from a healthy original without requesting its bytes again", async () => {
    const { directory, media } = await fixture();
    const source = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();
    const asset = await upload(media, directory, source);
    const original = await media.content(directory, asset.id, false);
    const preview = await media.content(directory, asset.id, true);
    const originalMetadata = await readFile(
      path.join(directory, "assets", asset.id + ".json"),
    );
    const request = {
      directory,
      name: "reattached.png",
      mimeType: "image/png",
      size: source.length,
      sha256: asset.id,
    };
    await rm(preview.filename);
    expect((await media.startUpload(request)).asset).toEqual(asset);
    expect((await sharp(preview.filename).metadata()).format).toBe("webp");
    await writeFile(preview.filename, Buffer.from("damaged preview"));
    expect(await media.completeUpload(directory, asset.id)).toEqual(asset);
    expect((await sharp(preview.filename).metadata()).width).toBe(40);
    expect(await readFile(original.filename)).toEqual(source);
    expect(
      await readFile(path.join(directory, "assets", asset.id + ".json")),
    ).toEqual(originalMetadata);
    const recoveryRoot = path.join(directory, ".media-recovery", asset.id);
    for (const revision of await readdir(recoveryRoot))
      expect(await readdir(path.join(recoveryRoot, revision))).not.toContain(
        "original.png",
      );
  });
});
