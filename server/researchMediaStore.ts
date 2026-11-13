import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { expandNoteEmbedBlocks } from '../src/domain/researchNoteEmbed.ts';
import { isUserFontMime, MAX_USER_FONT_BYTES } from '../src/domain/researchFonts.ts';
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { ZipFile } from "yazl";
import { openPromise as openZip } from "yauzl";
import { parse as parseHtml, type DefaultTreeAdapterTypes } from "parse5";
import type { ResearchWebMetadata } from "../src/domain/researchBookmark.ts";
import { fetchCitationMetadata } from "./researchCitationMetadata.ts";
import {
  MAX_MEDIA_BYTES,
  MEDIA_CHUNK_BYTES,
  mediaHeaderInfo,
  canonicalMediaMime,
  mediaFileMime,
  mediaMimeExtensions,
  researchMediaAssetIds,
  type ResearchMediaAsset,
} from "../src/domain/researchMedia.ts";
import {
  serializeResearchMarkdown,
  type ResearchNotebookState,
} from "../src/domain/researchNotebook.ts";
import {
  createResearchLibraryFile,
  parseResearchLibraryFile,
  RESEARCH_LIBRARY_FILENAME,
} from "../src/state/researchLibraryFile.ts";
import {
  ResearchLibraryError,
  ResearchLibraryStore,
} from "./researchLibraryStore.ts";

const extensions = mediaMimeExtensions;
const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";
function fail(message: string, status = 400): never {
  throw new ResearchLibraryError(message, status);
}
const asMessage = (error: unknown) =>
  error instanceof Error ? error.message : "附件操作失败。";
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
// Do not retain open originals in libvips' file cache (notably on Windows).
sharp.cache({ files: 0 });

async function replaceFile(source: string, destination: string) {
  // Windows can briefly deny replacing a file while a polling reader closes its handle.
  // Retry only that transient condition; the old complete file remains in place throughout.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        attempt >= 8 ||
        !["EPERM", "EBUSY"].includes(
          (error as NodeJS.ErrnoException)?.code ?? "",
        )
      )
        throw error;
      await delay(10 * (attempt + 1));
    }
  }
}

async function atomicJson(filename: string, value: unknown) {
  const temporary = filename + "." + crypto.randomUUID() + ".tmp";
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(json(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function regularFile(filename: string) {
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) fail("附件文件无效。", 400);
    return info;
  } catch (error) {
    if (missing(error)) fail("附件不存在，请重新关联原文件。", 404);
    throw error;
  }
}

async function safeDirectory(root: string, ...parts: string[]) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    await mkdir(current, { recursive: true });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail("附件目录无效，不能使用符号链接。", 400);
  }
  return current;
}

async function writeStream(
  source: AsyncIterable<Uint8Array | string>,
  filename: string,
  maximum: number,
  expected?: number,
  digest?: string,
) {
  const handle = await open(filename, "wx");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const value of source) {
      const chunk = typeof value === "string" ? Buffer.from(value) : value;
      bytes += chunk.length;
      if (bytes > maximum) fail("附件传输大小超过限制。", 413);
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length)
        offset += (await handle.write(chunk, offset, chunk.length - offset))
          .bytesWritten;
    }
    if (expected !== undefined && bytes !== expected)
      fail("附件分片大小与声明不一致。");
    const sha256 = hash.digest("hex");
    if (digest !== undefined && sha256 !== digest)
      fail("附件内容校验失败，请重新传输。");
    await handle.sync();
    return { bytes, sha256 };
  } catch (error) {
    await handle.close();
    await rm(filename, { force: true });
    throw error;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function fileHash(filename: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

function checkId(id: string) {
  if (!validHash(id)) fail("附件标识无效。");
  return id;
}
function checkName(name: string) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 512 ||
    [...name].some((character) => character.charCodeAt(0) < 32)
  )
    fail("附件文件名无效。");
  return path.basename(name.replaceAll("\\", "/"));
}
function checkMime(value: string) {
  if (typeof value !== "string" || !Object.hasOwn(extensions, value))
    fail("不支持此附件格式，请重新选择原文件。");
  return value;
}
function checkSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_MEDIA_BYTES)
    fail("单个附件必须大于 0 字节且不超过 1 GB。", 413);
}
function assertAsset(value: unknown): asserts value is ResearchMediaAsset {
  if (!value || typeof value !== "object") fail("附件元数据无效。");
  const item = value as ResearchMediaAsset;
  checkId(item.id);
  checkSize(item.size);
  checkMime(item.mimeType);
  if (isUserFontMime(item.mimeType) && item.size > MAX_USER_FONT_BYTES) fail('单个字体最大 100 MiB，请选择较小的字体文件。', 413);
  checkName(item.name);
  if (
    item.sha256 !== item.id ||
    typeof item.createdAt !== "string" ||
    !Number.isFinite(Date.parse(item.createdAt))
  )
    fail("附件元数据无效。");
  if (
    item.preview &&
    (!Number.isInteger(item.preview.width) ||
      !Number.isInteger(item.preview.height) ||
      item.preview.width < 1 ||
      item.preview.height < 1 ||
      item.preview.width > 1600 ||
      item.preview.height > 1600 ||
      item.preview.mimeType !== "image/webp")
  )
    fail("附件预览元数据无效。");
}

interface UploadSession {
  uploadId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  chunkSize: number;
  received: number[];
  hashes: Record<string, string>;
}
export interface ResearchMediaContent {
  filename: string;
  size: number;
  mimeType: string;
  name: string;
  preview: boolean;
}
export interface RemoteMediaJob {
  id: string;
  status: "downloading" | "complete" | "error" | "paused";
  bytes: number;
  total?: number;
  asset?: ResearchMediaAsset;
  error?: string;
  message?: string;
}
interface StoredRemoteJob extends RemoteMediaJob {
  url: string;
  etag?: string;
  modified?: string;
  name?: string;
  mimeType?: string;
}
interface ExportPlan {
  directory: string;
  createdAt: number;
  filename: string;
  buffers: { name: string; bytes: Buffer }[];
  files: { name: string; filename: string; size: number }[];
}
const MAX_ARCHIVE_BYTES = 100_000_000_000;
const JSON_BYTES = 64 * 1024 * 1024;
const archivedHistoryName = (name: string) =>
  /^[\w.-]+\.webbench\.json$/.test(name) && !name.includes("..");
function archiveEntryLimit(name: string) {
  if (
    name === RESEARCH_LIBRARY_FILENAME ||
    /^(history|migration-backups)\/[\w.-]+\.json$/.test(name)
  )
    return JSON_BYTES;
  if (/^assets\/[a-f0-9]{64}\.json$/.test(name)) return 256 * 1024;
  if (/^assets\/[a-f0-9]{64}\.preview\.webp$/.test(name))
    return 8 * 1024 * 1024;
  const original = /^assets\/[a-f0-9]{64}\.([a-z0-9]+)$/.exec(name);
  if (original && Object.values(extensions).includes(original[1]))
    return MAX_MEDIA_BYTES;
  return fail("备份中包含不支持或不安全的文件路径。");
}

function publicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Public global unicast IPv6 only. Mapped IPv4, loopback, local and multicast fail closed.
  return (
    version === 6 &&
    /^[23][a-f0-9]{0,3}:/i.test(address) &&
    !address.toLowerCase().startsWith("2001:db8:")
  );
}
function remoteUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("请输入完整的 HTTP 或 HTTPS 图片直链。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 8192
  )
    fail("仅支持不含登录凭据的 HTTP 或 HTTPS 图片直链。");
  url.hash = "";
  return url;
}
function publicJob(value: StoredRemoteJob): RemoteMediaJob {
  const { id, status, bytes, total, asset, error, message } = value;
  return {
    id,
    status,
    bytes,
    ...(total === undefined ? {} : { total }),
    ...(asset ? { asset } : {}),
    ...(error ? { error } : {}),
    ...(message ? { message } : {}),
  };
}

export class ResearchMediaStore {
  private readonly library: ResearchLibraryStore;
  private readonly queues = new Map<string, Promise<unknown>>();
  private previews: Promise<unknown> = Promise.resolve();
  private readonly remoteAddressPolicy: (address: string) => boolean;
  private readonly downloads = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly exports = new Map<string, ExportPlan>();
  constructor(
    library: ResearchLibraryStore,
    options: { remoteAddressPolicy?: (address: string) => boolean } = {},
  ) {
    this.library = library;
    this.remoteAddressPolicy = options.remoteAddressPolicy ?? publicAddress;
  }

  private async serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve();
    const operation = before.catch(() => {}).then(task);
    this.queues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.queues.get(key) === operation) this.queues.delete(key);
    }
  }
  private async directory(expected: string, stagingId?: string) {
    if (stagingId) return await this.stagingDirectory(expected, stagingId);
    return await this.library.attachmentDirectory(expected);
  }
  private async assetAt(directory: string, id: string) {
    checkId(id);
    const base = await safeDirectory(directory, "assets");
    const filename = path.join(base, id + ".json");
    try {
      await regularFile(filename);
      const value: unknown = JSON.parse(await readFile(filename, "utf8"));
      assertAsset(value);
      if (value.id !== id) fail("附件元数据校验失败。");
      return value;
    } catch (error) {
      if (missing(error)) fail("附件不存在，请重新关联原文件。", 404);
      throw error;
    }
  }
  async asset(expected: string, id: string): Promise<ResearchMediaAsset> {
    return await this.assetAt(await this.directory(expected), id);
  }
  async fonts(expected: string): Promise<ResearchMediaAsset[]> {
    const directory = await this.directory(expected);
    const base = path.join(directory, 'assets');
    let entries: string[];
    try {
      // Reading interface settings must not initialize attachment storage.
      const info = await lstat(base);
      if (!info.isDirectory() || info.isSymbolicLink()) fail('附件目录无效，不能使用符号链接。', 400);
      entries = await readdir(base);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    const fonts: ResearchMediaAsset[] = [];
    for (const name of entries) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const asset = await this.assetAt(directory, name.slice(0, -5));
      if (isUserFontMime(asset.mimeType)) fonts.push(asset);
    }
    return fonts.sort((a, b) => a.name.localeCompare(b.name));
  }
  private async optionalAsset(directory: string, id: string) {
    try {
      return await this.assetAt(directory, id);
    } catch (error) {
      if (error instanceof ResearchLibraryError && error.status === 404)
        return undefined;
      throw error;
    }
  }
  private async healthyOriginal(directory: string, asset: ResearchMediaAsset) {
    const filename = path.join(
      directory,
      "assets",
      `${asset.id}.${extensions[asset.mimeType]}`,
    );
    try {
      const info = await regularFile(filename);
      return (
        info.size === asset.size && (await fileHash(filename)) === asset.sha256
      );
    } catch (error) {
      if (error instanceof ResearchLibraryError && error.status === 404)
        return false;
      throw error;
    }
  }
  private async healthyPreview(directory: string, asset: ResearchMediaAsset) {
    if (!asset.preview) return true;
    const filename = path.join(directory, "assets", `${asset.id}.preview.webp`);
    try {
      const info = await regularFile(filename);
      if (!info.size || info.size > 8 * 1024 * 1024) return false;
    } catch (error) {
      if (error instanceof ResearchLibraryError && error.status === 404)
        return false;
      throw error;
    }
    try {
      const image = sharp(path.toNamespacedPath(filename), {
        limitInputPixels: 1600 * 1600,
        pages: 1,
        sequentialRead: true,
      }).timeout({ seconds: 5 });
      const metadata = await image.metadata();
      if (
        metadata.format !== "webp" ||
        metadata.width !== asset.preview.width ||
        metadata.height !== asset.preview.height
      )
        return false;
      // Fully decode only the bounded preview so truncated image payloads are detected too.
      await image.stats();
      return true;
    } catch {
      return false;
    }
  }
  private async refreshExistingPreview(
    directory: string,
    asset: ResearchMediaAsset,
  ) {
    if (await this.healthyPreview(directory, asset)) return asset;
    const filename = path.join(
      directory,
      "assets",
      `${asset.id}.${extensions[asset.mimeType]}`,
    );
    return await this.publish(directory, filename, asset);
  }
  async content(
    expected: string,
    id: string,
    preview: boolean,
  ): Promise<ResearchMediaContent> {
    const directory = await this.directory(expected);
    return await this.contentAt(directory, id, preview);
  }
  private async contentAt(
    directory: string,
    id: string,
    preview: boolean,
  ): Promise<ResearchMediaContent> {
    const asset = await this.assetAt(directory, id);
    if (preview && !asset.preview)
      fail("无法生成此图片的安全预览，可下载原件查看。", 404);
    const filename = path.join(
      directory,
      "assets",
      preview ? `${id}.preview.webp` : `${id}.${extensions[asset.mimeType]}`,
    );
    const info = await regularFile(filename);
    if (!preview && info.size !== asset.size)
      fail("附件大小与记录不一致，请重新关联文件。", 409);
    return {
      filename,
      size: info.size,
      mimeType: preview ? "image/webp" : asset.mimeType,
      name: asset.name,
      preview,
    };
  }
  private async uploadDirectory(directory: string, id: string) {
    checkId(id);
    return await safeDirectory(directory, ".media-transfers", id);
  }
  private async session(directory: string, id: string): Promise<UploadSession> {
    const base = await this.uploadDirectory(directory, id);
    try {
      const value = JSON.parse(
        await readFile(path.join(base, "upload.json"), "utf8"),
      ) as UploadSession;
      if (
        value.uploadId !== id ||
        value.sha256 !== id ||
        value.chunkSize !== MEDIA_CHUNK_BYTES ||
        !Array.isArray(value.received)
      )
        fail("附件传输记录损坏，请重新选择原件。");
      checkSize(value.size);
      checkMime(value.mimeType);
      checkName(value.name);
      return value;
    } catch (error) {
      if (missing(error)) fail("附件传输会话不存在，请重新选择文件。", 404);
      throw error;
    }
  }
  async startUpload(request: {
    directory: string;
    name: string;
    mimeType: string;
    size: number;
    sha256: string;
    stagingId?: string;
  }) {
    const directory = await this.directory(
      request.directory,
      request.stagingId,
    );
    const id = checkId(request.sha256);
    const name = checkName(request.name);
    const mimeType = checkMime(request.mimeType);
    if (isUserFontMime(mimeType) && request.size > MAX_USER_FONT_BYTES) fail('单个字体最大 100 MiB，请选择较小的字体文件。', 413);
    checkSize(request.size);
    return await this.serial(directory + id, async () => {
      const asset = await this.optionalAsset(directory, id);
      if (asset) {
        if (asset.size !== request.size || asset.mimeType !== mimeType)
          fail("同一附件的来源信息不一致，请重新选择文件。", 409);
        if (await this.healthyOriginal(directory, asset))
          return {
            uploadId: id,
            chunkSize: MEDIA_CHUNK_BYTES,
            received: [] as number[],
            asset: await this.refreshExistingPreview(directory, asset),
          };
      }
      const base = await this.uploadDirectory(directory, id);
      let session: UploadSession;
      try {
        session = await this.session(directory, id);
        if (session.size !== request.size || session.mimeType !== mimeType)
          fail("同一附件的来源信息不一致，请重新选择文件。", 409);
        // Verify durable chunk files on resume; a crash after writing a chunk need not discard it.
        session.received = [];
        session.hashes ??= {};
        for (
          let index = 0;
          index < Math.ceil(session.size / session.chunkSize);
          index++
        ) {
          try {
            const filename = path.join(base, `${index}.part`);
            const info = await regularFile(filename);
            if (
              info.size ===
                Math.min(
                  session.chunkSize,
                  session.size - index * session.chunkSize,
                ) &&
              validHash(session.hashes[index]) &&
              (await fileHash(filename)) === session.hashes[index]
            )
              session.received.push(index);
            else {
              await rm(filename, { force: true });
              delete session.hashes[index];
            }
          } catch (error) {
            if (!(
              error instanceof ResearchLibraryError && error.status === 404
            ))
              throw error;
          }
        }
      } catch (error) {
        if (!(error instanceof ResearchLibraryError && error.status === 404))
          throw error;
        session = {
          uploadId: id,
          name,
          mimeType,
          size: request.size,
          sha256: id,
          chunkSize: MEDIA_CHUNK_BYTES,
          received: [],
          hashes: {},
        };
      }
      await atomicJson(path.join(base, "upload.json"), session);
      return session;
    });
  }
  async writeChunk(
    expected: string,
    id: string,
    index: number,
    source: AsyncIterable<Uint8Array | string>,
    sha256: string,
    stagingId?: string,
  ) {
    const directory = await this.directory(expected, stagingId);
    checkId(id);
    checkId(sha256);
    return await this.serial(directory + id, async () => {
      const session = await this.session(directory, id);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= Math.ceil(session.size / session.chunkSize)
      )
        fail("附件分片编号无效。");
      const base = await this.uploadDirectory(directory, id);
      const temporary = path.join(base, `${index}.${crypto.randomUUID()}.tmp`);
      const size = Math.min(
        session.chunkSize,
        session.size - index * session.chunkSize,
      );
      try {
        await writeStream(source, temporary, size, size, sha256);
        await rename(temporary, path.join(base, `${index}.part`));
        session.received = [...new Set([...session.received, index])].sort(
          (a, b) => a - b,
        );
        session.hashes ??= {};
        session.hashes[index] = sha256;
        await atomicJson(path.join(base, "upload.json"), session);
        return { received: session.received };
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  private async checkFileType(filename: string, mimeType: string) {
    const handle = await open(filename, "r");
    const bytes = Buffer.alloc(1024 * 1024);
    try {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const info = mediaHeaderInfo(bytes.subarray(0, bytesRead), mimeType, (await handle.stat()).size);
      if (info.mimeType !== mimeType)
        fail("文件内容不是声明格式的媒体，请选择原始文件。");
    } finally {
      await handle.close();
    }
  }
  private async publish(
    directory: string,
    filename: string,
    item: {
      name: string;
      mimeType: string;
      size: number;
      sha256: string;
      sourceUrl?: string;
    },
  ) {
    const existing = await this.optionalAsset(directory, item.sha256);
    let replaceOriginal = true;
    if (existing) {
      if (existing.size !== item.size || existing.mimeType !== item.mimeType)
        fail("同一附件的来源信息不一致，已停止发布。", 409);
      replaceOriginal = !(await this.healthyOriginal(directory, existing));
      if (!replaceOriginal && (await this.healthyPreview(directory, existing)))
        return existing;
    }
    // Repair is allowed only with a separately verified complete replacement. Existing
    // metadata never substitutes for validating the incoming bytes.
    if (
      (await regularFile(filename)).size !== item.size ||
      (await fileHash(filename)) !== item.sha256
    )
      fail("替换附件的完整性校验失败，原有文件保持不变。", 409);
    await this.checkFileType(filename, item.mimeType);
    const base = await safeDirectory(directory, "assets");
    const asset: ResearchMediaAsset = existing
      ? { ...existing }
      : {
          id: item.sha256,
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
          sha256: item.sha256,
          createdAt: new Date().toISOString(),
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        };
    delete asset.preview;
    const staging = await safeDirectory(
      directory,
      ".media-transfers",
      "publish-" + crypto.randomUUID(),
    );
    const stagedPreview = path.join(staging, "preview.webp");
    const stagedMetadata = path.join(staging, "metadata.json");
    const original = path.join(
      base,
      `${asset.id}.${extensions[asset.mimeType]}`,
    );
    try {
      if (asset.mimeType.startsWith("image/")) {
        const preview = this.previews
          .catch(() => {})
          .then(async () => {
            try {
              const options = {
                limitInputPixels: 20_000_000,
                pages: 1,
                sequentialRead: true,
              };
              const metadata = await sharp(
                path.toNamespacedPath(filename),
                options,
              ).metadata();
              asset.width = metadata.width;
              asset.height = metadata.height;
              const info = await sharp(path.toNamespacedPath(filename), options)
                .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
                .webp({ quality: 82 })
                .timeout({ seconds: 20 })
                .toFile(path.toNamespacedPath(stagedPreview));
              asset.preview = {
                width: info.width,
                height: info.height,
                mimeType: "image/webp",
              };
            } catch {
              /* A verified original remains available even when decoding is unsafe or unavailable. */
            }
          });
        this.previews = preview;
        await preview;
      }
      await atomicJson(stagedMetadata, asset);
      const destinations = [
        ...(replaceOriginal
          ? [
              {
                target: original,
                source: filename,
                backupName: `original.${extensions[asset.mimeType]}`,
              },
            ]
          : []),
        ...(asset.preview
          ? [
              {
                target: path.join(base, `${asset.id}.preview.webp`),
                source: stagedPreview,
                backupName: "preview.webp",
              },
            ]
          : []),
        {
          target: path.join(base, `${asset.id}.json`),
          source: stagedMetadata,
          backupName: "metadata.json",
        },
      ];
      const previous: { target: string; backup?: string }[] = [];
      let recovery: string | undefined;
      // Snapshot every prior file before replacing any of them. A failed backup leaves
      // both original and metadata untouched; damaged bytes remain available for recovery.
      for (const destination of destinations) {
        try {
          await regularFile(destination.target);
          recovery ??= await safeDirectory(
            directory,
            ".media-recovery",
            asset.id,
            crypto.randomUUID(),
          );
          const backup = path.join(recovery, destination.backupName);
          await copyFile(destination.target, backup);
          if ((await fileHash(backup)) !== (await fileHash(destination.target)))
            fail("附件在恢复备份期间发生变化，已停止替换。", 409);
          previous.push({ target: destination.target, backup });
        } catch (error) {
          if (error instanceof ResearchLibraryError && error.status === 404)
            previous.push({ target: destination.target });
          else throw error;
        }
      }
      if (recovery)
        await atomicJson(path.join(recovery, "recovery.json"), {
          id: asset.id,
          createdAt: new Date().toISOString(),
          reason: "missing-or-corrupt-original",
          files: previous.map((item) => ({
            name: path.basename(item.target),
            present: Boolean(item.backup),
          })),
        });
      let committed = 0;
      try {
        for (const destination of destinations) {
          await replaceFile(destination.source, destination.target);
          committed++;
        }
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const prior of previous.slice(0, committed).reverse()) {
          try {
            if (prior.backup) {
              const rollback = path.join(
                staging,
                crypto.randomUUID() + ".rollback",
              );
              await copyFile(prior.backup, rollback);
              await replaceFile(rollback, prior.target);
            } else await rm(prior.target, { force: true });
          } catch (failure) {
            rollbackErrors.push(failure);
          }
        }
        if (rollbackErrors.length)
          fail(
            "附件替换未完成；原有文件和元数据的恢复副本已保留在 .media-recovery 中。",
            500,
          );
        throw error;
      }
      return asset;
    } finally {
      if (
        path.dirname(staging) === path.join(directory, ".media-transfers") &&
        path.basename(staging).startsWith("publish-")
      )
        await rm(staging, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        }).catch(() => {});
    }
  }
  async completeUpload(
    expected: string,
    id: string,
    stagingId?: string,
  ): Promise<ResearchMediaAsset> {
    const directory = await this.directory(expected, stagingId);
    checkId(id);
    return await this.serial(directory + id, async () => {
      const existing = await this.optionalAsset(directory, id);
      if (existing && (await this.healthyOriginal(directory, existing)))
        return await this.refreshExistingPreview(directory, existing);
      const session = await this.session(directory, id);
      const base = await this.uploadDirectory(directory, id);
      const count = Math.ceil(session.size / session.chunkSize);
      const parts: string[] = [];
      for (let index = 0; index < count; index++) {
        const filename = path.join(base, `${index}.part`);
        try {
          const info = await regularFile(filename);
          if (
            info.size !==
            Math.min(
              session.chunkSize,
              session.size - index * session.chunkSize,
            )
          )
            fail("附件分片大小错误，请重新上传。");
        } catch (error) {
          if (error instanceof ResearchLibraryError && error.status === 404)
            fail("附件分片尚未传输完整。");
          throw error;
        }
        parts.push(filename);
      }
      const temporary = path.join(base, `assembled-${crypto.randomUUID()}.tmp`);
      async function* input() {
        for (const filename of parts) yield* createReadStream(filename);
      }
      try {
        await writeStream(
          input(),
          temporary,
          session.size,
          session.size,
          session.sha256,
        );
        // Verify the binding again after long-running merge and before publication.
        await this.directory(expected, stagingId);
        const asset = await this.publish(directory, temporary, session);
        for (const filename of parts) await rm(filename, { force: true });
        return asset;
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  async startStaging(request: { directory: string }) {
    const target = await this.library.inspect(request.directory);
    const id = crypto.randomUUID();
    const base = await safeDirectory(target.directory, ".media-staging", id);
    await atomicJson(path.join(base, "stage.json"), {
      id,
      directory: target.directory,
      createdAt: new Date().toISOString(),
    });
    return { id };
  }
  private async stagingDirectory(expected: string, id: string) {
    if (
      typeof id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        id,
      ) ||
      typeof expected !== "string" ||
      !path.isAbsolute(expected)
    )
      fail("附件迁移阶段标识无效。");
    const directory = path.resolve(expected.trim());
    const base = await safeDirectory(directory, ".media-staging", id);
    let record: { id: string; directory: string };
    try {
      record = JSON.parse(
        await readFile(path.join(base, "stage.json"), "utf8"),
      );
    } catch {
      return fail("附件迁移记录不存在，请重新选择保存目录。", 404);
    }
    if (record.id !== id || record.directory !== directory)
      fail("附件迁移目标目录已改变。", 409);
    return base;
  }
  private async copyAssets(source: string, target: string) {
    if (source === target) return;
    const sourceBase = await safeDirectory(source, "assets");
    const targetBase = await safeDirectory(target, "assets");
    for (const name of await readdir(sourceBase)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const id = name.slice(0, -5);
      const asset = await this.assetAt(source, id);
      const original = await this.contentAt(source, id, false);
      const existing = await this.optionalAsset(target, id);
      if (existing) {
        const saved = await this.contentAt(target, id, false);
        if ((await fileHash(saved.filename)) !== id)
          fail("目标资料库附件校验失败，已停止迁移。", 409);
        continue;
      }
      const temporary = path.join(
        targetBase,
        `${id}.${crypto.randomUUID()}.tmp`,
      );
      try {
        await copyFile(original.filename, temporary);
        if ((await fileHash(temporary)) !== id)
          fail("附件迁移校验失败，已保留原资料库。", 409);
        await rename(
          temporary,
          path.join(targetBase, `${id}.${extensions[asset.mimeType]}`),
        );
      } finally {
        await rm(temporary, { force: true });
      }
      if (asset.preview) {
        try {
          const preview = await this.contentAt(source, id, true);
          if (preview.size > 8 * 1024 * 1024) fail("预览文件过大。");
          await copyFile(
            preview.filename,
            path.join(targetBase, `${id}.preview.webp`),
          );
        } catch {
          delete asset.preview;
        }
      }
      await atomicJson(path.join(targetBase, `${id}.json`), asset);
    }
  }
  async prepareConnect(
    request: {
      directory: string;
      mode: "create" | "open";
      notebook: ResearchNotebookState;
      mediaStagingId?: string;
    },
    libraryId = "default",
    sourceDirectory?: string | null,
  ) {
    await this.library.validateConnection(request.directory, libraryId);
    const target = await this.library.inspect(request.directory);
    if (request.mode === "create" && target.exists)
      fail("该目录已有资料库，请选择打开，已停止覆盖。", 409);
    if (request.mode === "open" && !target.exists)
      fail("该目录没有资料库，请先检查路径。", 409);
    if (request.mediaStagingId)
      await this.copyAssets(
        await this.stagingDirectory(target.directory, request.mediaStagingId),
        target.directory,
      );
    const source =
      sourceDirectory === undefined
        ? (await this.library.read(libraryId)).directory
        : sourceDirectory;
    if (source) await this.copyAssets(source, target.directory);
    for (const id of new Set(
      request.notebook.notes.flatMap((note) =>
        researchMediaAssetIds(note.blocks),
      ),
    )) {
      const original = await this.contentAt(target.directory, id, false);
      if ((await fileHash(original.filename)) !== id)
        fail("附件迁移校验失败，笔记保存位置尚未更改。", 409);
    }
  }
  async finishConnect(request: { directory: string; mediaStagingId?: string }) {
    if (!request.mediaStagingId) return;
    // A committed binding is required before disposing this exact, token-verified stage.
    const directory = await this.directory(request.directory);
    const stage = await this.stagingDirectory(
      directory,
      request.mediaStagingId,
    );
    if (path.dirname(stage) === path.join(directory, ".media-staging"))
      await rm(stage, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
  }

  async createExport(request: {
    directory: string;
    notebook: ResearchNotebookState;
    format: "library" | "markdown";
    noteId?: string;
  }) {
    const directory = await this.directory(request.directory);
    if (request.format !== "library" && request.format !== "markdown")
      fail("请选择完整资料库或 Markdown 附件导出。");
    const file = await createResearchLibraryFile(request.notebook);
    const plan: ExportPlan = {
      directory,
      createdAt: Date.now(),
      filename:
        request.format === "library"
          ? "research-library.zip"
          : "research-note.zip",
      buffers: [],
      files: [],
    };
    const ids = new Set<string>();
    if (request.format === "library") {
      plan.buffers.push({
        name: RESEARCH_LIBRARY_FILENAME,
        bytes: Buffer.from(json(file)),
      });
      for (const note of request.notebook.notes)
        for (const id of researchMediaAssetIds(note.blocks)) ids.add(id);
      const assetBase = await safeDirectory(directory, "assets");
      for (const name of await readdir(assetBase))
        if (/^[a-f0-9]{64}\.json$/.test(name)) ids.add(name.slice(0, -5));
      for (const folder of ["history", "migration-backups"]) {
        const base = await safeDirectory(directory, folder);
        for (const name of await readdir(base)) {
          if (
            folder === "history"
              ? !archivedHistoryName(name)
              : !/^[\w.-]+\.json$/.test(name) || name.includes("..")
          )
            continue;
          const filename = path.join(base, name);
          const info = await regularFile(filename);
          if (info.size > JSON_BYTES) fail("历史备份文件超过大小限制。");
          try {
            const history = await parseResearchLibraryFile(
              await readFile(filename, "utf8"),
            );
            for (const note of history.notebook.notes)
              for (const id of researchMediaAssetIds(note.blocks)) ids.add(id);
            plan.files.push({
              name: folder + "/" + name,
              filename,
              size: info.size,
            });
          } catch (error) {
            if (folder === "history") throw error;
            // Keep damaged/raw recovery artifacts on disk; do not represent them as validated backup snapshots.
          }
        }
      }
    } else {
      const note = request.notebook.notes.find(
        (note) => note.id === request.noteId,
      );
      if (!note) fail("要导出的笔记不存在。", 404);
      for (const id of researchMediaAssetIds(expandNoteEmbedBlocks(request.notebook.notes, note.blocks, note.id))) ids.add(id);
      let markdown = serializeResearchMarkdown(
        note,
        request.notebook.symbols,
        request.notebook.notes,
      );
      for (const id of ids) {
        const asset = await this.assetAt(directory, id);
        markdown = markdown.replaceAll(
          `webbench-asset:${id}`,
          `assets/${id}.${extensions[asset.mimeType]}`,
        );
      }
      const name = [
        ...(note.title || "research-note").replace(/[\\/:*?"<>|]/g, "-"),
      ]
        .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
        .join("")
        .slice(0, 120);
      plan.filename = name + ".zip";
      plan.buffers.push({ name: name + ".md", bytes: Buffer.from(markdown) });
    }
    for (const id of ids) {
      const asset = await this.assetAt(directory, id);
      const original = await this.contentAt(directory, id, false);
      if ((await fileHash(original.filename)) !== asset.sha256)
        fail("附件在导出前完整性校验失败，请先修复资料库。", 409);
      plan.files.push({
        name: `assets/${id}.${extensions[asset.mimeType]}`,
        filename: original.filename,
        size: original.size,
      });
      if (request.format === "library") {
        plan.buffers.push({
          name: `assets/${id}.json`,
          bytes: Buffer.from(json(asset)),
        });
        if (asset.preview) {
          try {
            const preview = await this.contentAt(directory, id, true);
            if (preview.size <= 8 * 1024 * 1024)
              plan.files.push({
                name: `assets/${id}.preview.webp`,
                filename: preview.filename,
                size: preview.size,
              });
          } catch {
            /* Original bytes are still included; a preview can be regenerated on restore. */
          }
        }
      }
    }
    for (const [id, entry] of this.exports)
      if (Date.now() - entry.createdAt > 5 * 60_000) this.exports.delete(id);
    while (this.exports.size >= 3)
      this.exports.delete(this.exports.keys().next().value!);
    const id = crypto.randomUUID();
    this.exports.set(id, plan);
    return { id };
  }
  async exportArchive(expected: string, id: string) {
    const directory = await this.directory(expected);
    const plan = this.exports.get(id);
    if (
      !plan ||
      plan.directory !== directory ||
      Date.now() - plan.createdAt > 5 * 60_000
    )
      fail("导出准备已过期，请重新点击导出。", 404);
    const zip = new ZipFile();
    const stream = zip.outputStream as Readable;
    let cancelled = false;
    const readers = new Set<Readable>();
    stream.on("close", () => {
      cancelled = true;
      for (const reader of readers) reader.destroy();
    });
    zip.on("error", (error) => stream.destroy(error));
    for (const item of plan.buffers)
      zip.addBuffer(item.bytes, item.name, { compress: false });
    for (const item of plan.files)
      zip.addReadStreamLazy(
        item.name,
        { size: item.size, compress: false },
        (callback) => {
          if (cancelled) {
            callback(new Error("导出已取消。"), Readable.from([]));
            return;
          }
          const reader = createReadStream(item.filename);
          readers.add(reader);
          reader.on("close", () => readers.delete(reader));
          callback(null, reader);
        },
      );
    zip.end({
      forceZip64Format: true,
      comment: "WebBench research media backup",
    });
    return { filename: plan.filename, stream };
  }
  async importArchive(
    expected: string,
    source: AsyncIterable<Uint8Array | string>,
  ) {
    const directory = await this.directory(expected);
    return await this.serial(directory + "archive-import", async () => {
      const base = await safeDirectory(directory, ".media-transfers");
      const temporary = await safeDirectory(
        base,
        "import-" + crypto.randomUUID(),
      );
      const archive = path.join(temporary, "archive.zip");
      try {
        await writeStream(source, archive, MAX_ARCHIVE_BYTES);
        const extracted = await safeDirectory(temporary, "extracted");
        const entries = new Map<string, string>();
        let total = 0;
        const zip = await openZip(archive, {
          lazyEntries: true,
          validateEntrySizes: true,
          strictFileNames: true,
        });
        try {
          for await (const entry of zip.eachEntry()) {
            if (
              entries.size >= 20_000 ||
              entry.isEncrypted() ||
              ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000 ||
              entries.has(entry.fileName)
            )
              fail("备份包含重复、加密或不安全的文件。");
            const limit = archiveEntryLimit(entry.fileName);
            if (
              !Number.isSafeInteger(entry.uncompressedSize) ||
              entry.uncompressedSize < 0 ||
              entry.uncompressedSize > limit
            )
              fail("备份中的附件超过大小限制。", 413);
            total += entry.uncompressedSize;
            if (total > MAX_ARCHIVE_BYTES)
              fail("备份解压总量超过大小限制。", 413);
            const filename = path.join(extracted, ...entry.fileName.split("/"));
            await safeDirectory(
              extracted,
              ...entry.fileName.split("/").slice(0, -1),
            );
            const input = await zip.openReadStreamPromise(entry);
            await writeStream(input, filename, limit, entry.uncompressedSize);
            entries.set(entry.fileName, filename);
          }
        } finally {
          zip.close();
        }
        const main = entries.get(RESEARCH_LIBRARY_FILENAME);
        if (!main) fail("此文件不是包含附件的完整资料库备份。");
        const file = await parseResearchLibraryFile(
          await readFile(main, "utf8"),
        );
        const assets = new Map<
          string,
          { asset: ResearchMediaAsset; filename: string }
        >();
        const snapshots = [file];
        for (const [name, filename] of entries) {
          if (/^assets\/[a-f0-9]{64}\.json$/.test(name)) {
            const asset: unknown = JSON.parse(await readFile(filename, "utf8"));
            assertAsset(asset);
            if (name !== `assets/${asset.id}.json`)
              fail("备份附件标识不一致。");
            const original = entries.get(
              `assets/${asset.id}.${extensions[asset.mimeType]}`,
            );
            if (
              !original ||
              (await stat(original)).size !== asset.size ||
              (await fileHash(original)) !== asset.sha256
            )
              fail("备份附件缺失或完整性校验失败。");
            await this.checkFileType(original, asset.mimeType);
            assets.set(asset.id, { asset, filename: original });
          }
          if (
            name.startsWith("history/") ||
            name.startsWith("migration-backups/")
          )
            snapshots.push(
              await parseResearchLibraryFile(await readFile(filename, "utf8")),
            );
        }
        for (const snapshot of snapshots)
          for (const note of snapshot.notebook.notes)
            for (const id of researchMediaAssetIds(note.blocks))
              if (!assets.has(id)) fail("备份缺少笔记引用的附件，已停止导入。");
        await this.directory(expected);
        // Only validated originals are published. Failure before this point cannot alter visible notes or resources.
        for (const { asset, filename } of assets.values()) {
          const published = await this.serial(directory + asset.id, () =>
            this.publish(directory, filename, asset),
          );
          const metadata = {
            ...asset,
            width: published.width,
            height: published.height,
            preview: published.preview,
          };
          await atomicJson(
            path.join(directory, "assets", asset.id + ".json"),
            metadata,
          );
        }
        for (const [name, filename] of entries)
          if (
            name.startsWith("history/") ||
            name.startsWith("migration-backups/")
          ) {
            const [folder, basename] = name.split("/");
            const destination = path.join(
              await safeDirectory(directory, folder),
              basename,
            );
            try {
              await regularFile(destination);
            } catch (error) {
              if (error instanceof ResearchLibraryError && error.status === 404)
                await copyFile(filename, destination);
              else throw error;
            }
          }
        return { content: json(file) };
      } finally {
        if (
          path.dirname(temporary) === base &&
          path.basename(temporary).startsWith("import-")
        )
          await rm(temporary, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
      }
    });
  }

  private async remoteDirectory(directory: string, id: string) {
    checkId(id);
    return await safeDirectory(directory, ".media-transfers", "remote-" + id);
  }
  private async storedRemote(
    directory: string,
    id: string,
  ): Promise<StoredRemoteJob> {
    const base = await this.remoteDirectory(directory, id);
    try {
      const value = JSON.parse(
        await readFile(path.join(base, "job.json"), "utf8"),
      ) as StoredRemoteJob;
      if (
        value.id !== id ||
        typeof value.url !== "string" ||
        !["downloading", "complete", "error", "paused"].includes(
          value.status,
        ) ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes < 0 ||
        value.bytes > MAX_MEDIA_BYTES
      )
        fail("网络媒体下载记录损坏。");
      remoteUrl(value.url);
      return value;
    } catch (error) {
      if (missing(error)) fail("网络媒体下载记录不存在。", 404);
      throw error;
    }
  }
  async remoteStatus(expected: string, id: string) {
    const directory = await this.directory(expected);
    const job = await this.storedRemote(directory, id);
    if (job.status === "downloading" && !this.downloads.has(directory + id)) {
      job.status = "paused";
      job.message = "下载已暂停，可继续上次的下载。";
    }
    return publicJob(job);
  }
  async startRemote(request: { directory: string; url: string }) {
    const directory = await this.directory(request.directory);
    const url = remoteUrl(request.url);
    const id = createHash("sha256").update(url.href).digest("hex");
    return await this.serial(directory + "remote" + id, async () => {
      const base = await this.remoteDirectory(directory, id);
      let job: StoredRemoteJob;
      try {
        job = await this.storedRemote(directory, id);
      } catch (error) {
        if (!(error instanceof ResearchLibraryError && error.status === 404))
          throw error;
        job = { id, url: url.href, bytes: 0, status: "paused" };
      }
      if (job.status === "complete" && job.asset) {
        try {
          const original = await this.content(directory, job.asset.id, false);
          if ((await fileHash(original.filename)) !== job.asset.sha256)
            fail("已保存的网络媒体校验值不一致，请重新下载。", 409);
          return publicJob(job);
        } catch {
          job.asset = undefined;
          job.bytes = 0;
        }
      }
      if (this.downloads.has(directory + id)) return publicJob(job);
      job.status = "downloading";
      delete job.error;
      await atomicJson(path.join(base, "job.json"), job);
      const controller = new AbortController();
      const promise = this.downloadRemote(directory, job, controller.signal)
        .catch(() => {})
        .finally(() => this.downloads.delete(directory + id));
      this.downloads.set(directory + id, { controller, promise });
      return publicJob(job);
    });
  }
  async pauseRemote(expected: string, id: string) {
    const directory = await this.directory(expected);
    checkId(id);
    const active = this.downloads.get(directory + id);
    if (active) {
      active.controller.abort();
      await active.promise;
    }
    const job = await this.storedRemote(directory, id);
    if (job.status !== "complete") {
      job.status = "paused";
      delete job.error;
      await atomicJson(
        path.join(await this.remoteDirectory(directory, id), "job.json"),
        job,
      );
    }
    return publicJob(job);
  }
  private async requestRemote(
    value: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    let url = remoteUrl(value);
    for (let redirect = 0; redirect <= 5; redirect++) {
      signal.throwIfAborted();
      const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
        all: true,
      });
      if (
        !addresses.length ||
        addresses.some((item) => !this.remoteAddressPolicy(item.address))
      )
        fail("此网络地址不可用于远程附件下载。");
      const address = addresses[0];
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        // Resolve once, validate, then pin the connection to that IP to prevent DNS rebinding.
        const send = url.protocol === "https:" ? httpsRequest : httpRequest;
        const outgoing = send(
          {
            protocol: url.protocol,
            hostname: address.address,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            servername: url.hostname,
            path: url.pathname + url.search,
            method: "GET",
            maxHeaderSize: 16 * 1024,
            headers: {
              Host: url.host,
              Accept: Object.keys(extensions).join(","),
              "Accept-Encoding": "identity",
              ...headers,
            },
            signal,
          },
          resolve,
        );
        outgoing.setTimeout(30_000, () =>
          outgoing.destroy(new Error("网络媒体下载长时间没有进展，请重试。")),
        );
        outgoing.on("error", reject);
        outgoing.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.destroy();
        if (!response.headers.location || redirect === 5)
          fail("网络媒体重定向次数过多或地址无效。");
        url = remoteUrl(new URL(response.headers.location, url).href);
        continue;
      }
      return response;
    }
    return fail("网络媒体地址无效。");
  }
  async citationMetadata(value: string, signal?: AbortSignal) {
    return fetchCitationMetadata(value, this.requestRemote.bind(this), signal);
  }
  async webMetadata(
    value: string,
    signal?: AbortSignal,
  ): Promise<ResearchWebMetadata> {
    const url = remoteUrl(value);
    const abort = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    const response = await this.requestRemote(
      url.href,
      { Accept: "text/html,application/xhtml+xml" },
      abort,
    );
    try {
      if (response.statusCode !== 200)
        fail(
          `读取网页失败（HTTP ${response.statusCode ?? "未知"}），可手动填写标题和摘要。`,
        );
      const type = response.headers["content-type"] ?? "";
      if (
        !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(type) ||
        (response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity")
      )
        fail("该地址未返回可读取的网页，请手动填写标题和摘要。");
      const maximum = 1024 * 1024;
      if (Number(response.headers["content-length"]) > maximum)
        fail("网页超过大小限制，请手动填写标题和摘要。");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        abort.throwIfAborted();
        size += chunk.length;
        if (size > maximum) fail("网页超过大小限制，请手动填写标题和摘要。");
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const charset =
        /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] ||
        /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(
          bytes.subarray(0, 4096).toString("ascii"),
        )?.[1] ||
        "utf-8";
      let html: string;
      try {
        html = new TextDecoder(charset).decode(bytes);
      } catch {
        html = new TextDecoder().decode(bytes);
      }
      const tree = parseHtml(html, { scriptingEnabled: false });
      const clean = (text: string, limit: number) =>
        text
          .replace(/\p{Cc}/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, limit);
      const meta = new Map<string, string>();
      let title = "";
      const nodes: DefaultTreeAdapterTypes.Node[] = [tree];
      while (nodes.length) {
        const node = nodes.pop()!;
        if (
          "tagName" in node &&
          ["script", "style", "body", "template"].includes(node.tagName)
        )
          continue;
        if ("tagName" in node && node.tagName === "meta") {
          const attributes = Object.fromEntries(
            node.attrs.map((attr) => [attr.name, attr.value]),
          );
          const key = (
            attributes.property ||
            attributes.name ||
            ""
          ).toLowerCase();
          if (attributes.content && !meta.has(key))
            meta.set(key, attributes.content);
        }
        if ("tagName" in node && node.tagName === "title")
          title = node.childNodes
            .filter(
              (item): item is DefaultTreeAdapterTypes.TextNode =>
                item.nodeName === "#text",
            )
            .map((item) => item.value)
            .join("");
        if ("childNodes" in node)
          for (let index = node.childNodes.length - 1; index >= 0; index--)
            nodes.push(node.childNodes[index]);
      }
      return {
        title: clean(meta.get("og:title") || title || url.hostname, 1000),
        description: clean(
          meta.get("og:description") || meta.get("description") || "",
          4000,
        ),
        siteName: clean(meta.get("og:site_name") || url.hostname, 300),
      };
    } finally {
      response.destroy();
    }
  }
  private async downloadRemote(
    directory: string,
    job: StoredRemoteJob,
    signal: AbortSignal,
  ) {
    const base = await this.remoteDirectory(directory, job.id);
    const temporary = path.join(base, "download.part");
    const record = path.join(base, "job.json");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      try {
        job.bytes = (await regularFile(temporary)).size;
      } catch (error) {
        if (!(error instanceof ResearchLibraryError && error.status === 404))
          throw error;
        job.bytes = 0;
      }
      let canResume = job.bytes > 0 && Boolean(job.etag || job.modified);
      let response = await this.requestRemote(
        job.url,
        canResume
          ? {
              Range: `bytes=${job.bytes}-`,
              "If-Range": job.etag || job.modified!,
            }
          : {},
        signal,
      );
      let range = response.headers["content-range"]?.match(
        /^bytes (\d+)-(\d+)\/(\d+)$/,
      );
      const sameValidator = job.etag
        ? response.headers.etag === job.etag
        : !job.modified || response.headers["last-modified"] === job.modified;
      if (
        canResume &&
        (response.statusCode !== 206 ||
          !range ||
          Number(range[1]) !== job.bytes ||
          !sameValidator ||
          (job.total !== undefined && job.total !== Number(range[3])))
      ) {
        response.destroy();
        canResume = false;
        job.message = "源站不支持继续下载或文件已变化，已重新下载。";
        response = await this.requestRemote(job.url, {}, signal);
        range = undefined;
      }
      if (
        (!canResume && response.statusCode !== 200) ||
        (canResume && response.statusCode !== 206)
      ) {
        response.destroy();
        fail(`网络媒体下载失败（HTTP ${response.statusCode ?? "未知"}）。`);
      }
      let basename = "";
      try {
        const disposition = response.headers["content-disposition"] ?? "";
        const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition)?.[1];
        const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
        basename = checkName(
          utf8
            ? decodeURIComponent(utf8.trim())
            : plain?.[1] ||
                plain?.[2]?.trim() ||
                decodeURIComponent(
                  new URL(job.url).pathname.split("/").pop() || "",
                ),
        );
      } catch {
        /* Use a safe default after the response format is known. */
      }
      const declared = canonicalMediaMime(
        response.headers["content-type"] ?? "",
      );
      const mimeType = mediaFileMime({ name: basename, type: declared });
      if (
        !Object.hasOwn(extensions, mimeType) ||
        ["text/html", "application/xhtml+xml"].includes(declared) ||
        (response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity")
      ) {
        response.destroy();
        fail("该地址未返回受支持的媒体文件，可能是网页或登录页。");
      }
      const totalHeader = canResume
        ? range?.[3]
        : response.headers["content-length"];
      const total = totalHeader === undefined ? undefined : Number(totalHeader);
      if (
        total !== undefined &&
        (!Number.isSafeInteger(total) || total < 1 || total > MAX_MEDIA_BYTES)
      ) {
        response.destroy();
        fail("网络附件超过 1 GB 大小限制。", 413);
      }
      if (!canResume) job.bytes = 0;
      job.total = total;
      job.mimeType = mimeType;
      job.etag =
        typeof response.headers.etag === "string" &&
        !response.headers.etag.startsWith("W/")
          ? response.headers.etag
          : undefined;
      job.modified =
        typeof response.headers["last-modified"] === "string" &&
        Number.isFinite(Date.parse(response.headers["last-modified"]))
          ? response.headers["last-modified"]
          : undefined;
      job.name = basename || "网络附件." + extensions[mimeType];
      handle = await open(temporary, canResume ? "a" : "w");
      await atomicJson(record, job);
      let savedBytes = job.bytes;
      for await (const chunk of response) {
        signal.throwIfAborted();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (job.bytes + bytes.length > MAX_MEDIA_BYTES)
          fail("网络附件超过 1 GB 大小限制。", 413);
        let offset = 0;
        while (offset < bytes.length)
          offset += (await handle.write(bytes, offset, bytes.length - offset))
            .bytesWritten;
        job.bytes += bytes.length;
        if (job.bytes - savedBytes >= 1024 * 1024) {
          await atomicJson(record, job);
          savedBytes = job.bytes;
        }
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      checkSize(job.bytes);
      if (job.total !== undefined && job.bytes !== job.total)
        fail("网络媒体下载不完整，请继续下载。");
      await this.directory(directory);
      const sha256 = await fileHash(temporary);
      job.asset = await this.serial(directory + sha256, () =>
        this.publish(directory, temporary, {
          name: job.name!,
          mimeType,
          size: job.bytes,
          sha256,
          sourceUrl: job.url,
        }),
      );
      job.status = "complete";
      job.total = job.bytes;
      delete job.error;
      await rm(temporary, { force: true });
    } catch (error) {
      job.status = signal.aborted ? "paused" : "error";
      if (!signal.aborted) job.error = asMessage(error);
      else delete job.error;
    } finally {
      await handle?.close().catch(() => {});
      await atomicJson(record, job).catch(() => {});
    }
  }
  async dispose() {
    const active = [...this.downloads.values()];
    for (const download of active) download.controller.abort();
    await Promise.allSettled(active.map((download) => download.promise));
    await this.previews.catch(() => {});
  }
}
