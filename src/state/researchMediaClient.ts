import { sha256 } from "@noble/hashes/sha2.js";
import { MEDIA_CHUNK_BYTES, normalizeMediaUrl, researchMediaAssetIds, validateMediaFile, type ResearchMediaAsset } from "../domain/researchMedia.ts";
import { meWikiManualAsset, readMeWikiManualAsset } from "../domain/meWikiManualAssets.ts";
import { expandNoteEmbedBlocks } from "../domain/researchNoteEmbed.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import type { ResearchWebMetadata } from "../domain/researchBookmark.ts";
import { normalizeCitationDoi, type ResearchCitationMetadata } from "../domain/researchCitation.ts";

export interface MediaProgress { phase: "hashing" | "uploading" | "saving" | "downloading"; loaded: number; total: number }
export interface RemoteMediaJob { id: string; status: "downloading" | "complete" | "error" | "paused"; bytes: number; total?: number; asset?: ResearchMediaAsset; error?: string; message?: string }
export type MediaProgressListener = (progress: MediaProgress) => void;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export async function hashMediaBlob(blob: Blob, onProgress?: MediaProgressListener, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < blob.size; offset += MEDIA_CHUNK_BYTES) {
    signal?.throwIfAborted();
    hash.update(new Uint8Array(await blob.slice(offset, offset + MEDIA_CHUNK_BYTES).arrayBuffer()));
    onProgress?.({ phase: "hashing", loaded: Math.min(offset + MEDIA_CHUNK_BYTES, blob.size), total: blob.size });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  return hex(hash.digest());
}
class MediaRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export class ResearchMediaClient {
  private readonly fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; }
  private async request<T>(route: string, options: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`/api/research-library/media${route}`, { cache: "no-store", ...options,
      headers: { "X-WebBench-Request": "research-library", ...options.headers },
    });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new MediaRequestError("媒体服务尚未加载，请重启 MeWiki 本地服务。", response.status);
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new MediaRequestError(data.error ?? "附件操作失败，请重试。", response.status);
    return data;
  }
  private json<T>(route: string, value: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
  }
  async upload(directory: string, file: File, onProgress?: MediaProgressListener, signal?: AbortSignal, stagingId?: string): Promise<ResearchMediaAsset> {
    const mimeType = validateMediaFile(file);
    const digest = await hashMediaBlob(file, onProgress, signal);
    const session = await this.json<{ uploadId: string; chunkSize: number; received: number[]; asset?: ResearchMediaAsset }>("/uploads", { directory, name: file.name, mimeType, size: file.size, sha256: digest, ...(stagingId ? { stagingId } : {}) }, signal);
    if (session.asset) return this.verify(session.asset, digest, file.size);
    if (!Number.isSafeInteger(session.chunkSize) || session.chunkSize <= 0 || session.chunkSize > MEDIA_CHUNK_BYTES) throw new Error("附件服务返回了无效的分片大小。");
    const count = Math.ceil(file.size / session.chunkSize);
    const received = new Set(session.received.filter(index => Number.isInteger(index) && index >= 0 && index < count));
    let loaded = [...received].reduce((sum, index) => sum + Math.min(session.chunkSize, file.size - index * session.chunkSize), 0);
    onProgress?.({ phase: "uploading", loaded, total: file.size });
    for (let index = 0; index < count; index++) {
      if (received.has(index)) continue;
      signal?.throwIfAborted();
      const chunk = file.slice(index * session.chunkSize, (index + 1) * session.chunkSize);
      const chunkHash = hex(sha256(new Uint8Array(await chunk.arrayBuffer())));
      for (let attempt = 0; ; attempt++) {
        try {
          await this.request(`/uploads/${encodeURIComponent(session.uploadId)}/${index}?${new URLSearchParams({ directory, ...(stagingId ? { stagingId } : {}) })}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Chunk-SHA256": chunkHash }, body: chunk, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
          break;
        } catch (error) {
          if (signal?.aborted || attempt >= 2 || error instanceof MediaRequestError && error.status < 500 && ![408, 429].includes(error.status)) throw error;
          await new Promise<void>(resolve => setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
      loaded += chunk.size;
      onProgress?.({ phase: "uploading", loaded, total: file.size });
    }
    onProgress?.({ phase: "saving", loaded: file.size, total: file.size });
    const asset = await this.json<ResearchMediaAsset>(`/uploads/${encodeURIComponent(session.uploadId)}/complete`, { directory, ...(stagingId ? { stagingId } : {}) }, signal);
    return this.verify(asset, digest, file.size);
  }
  private verify(asset: ResearchMediaAsset, digest: string, size: number) {
    if (asset.sha256 !== digest || asset.id !== digest || asset.size !== size) throw new Error("附件回读校验失败，原笔记内容已保留。");
    return asset;
  }
  async metadata(directory: string, id: string, signal?: AbortSignal): Promise<ResearchMediaAsset> {
    try {
      return await this.request<ResearchMediaAsset>(`/assets/${encodeURIComponent(id)}?${new URLSearchParams({ directory })}`, { signal });
    } catch (cause) {
      // Missing handbook originals can be restored from the application bundle.
      // Other missing assets and service errors keep their existing behaviour.
      if (!(cause instanceof MediaRequestError) || cause.status !== 404 || !meWikiManualAsset(id)) throw cause;
      const bundled = await readMeWikiManualAsset(id, this.fetcher, signal);
      return this.upload(directory, new File([bundled!.blob], bundled!.asset.name, { type: bundled!.asset.mimeType }), undefined, signal);
    }
  }
  fonts(directory: string, signal?: AbortSignal): Promise<ResearchMediaAsset[]> {
    return this.request(`/fonts?${new URLSearchParams({ directory })}`, { signal });
  }
  contentUrl(directory: string, id: string, preview = false, inline = false) {
    return `/api/research-library/media/assets/${encodeURIComponent(id)}/content?${new URLSearchParams({ directory, ...(preview ? { preview: "1" } : {}), ...(inline ? { inline: "1" } : {}) })}`;
  }
  startRemote(directory: string, url: string) { return this.json<RemoteMediaJob>("/remote", { directory, url: normalizeMediaUrl(url) }); }
  webMetadata(url: string, signal?: AbortSignal) { return this.json<ResearchWebMetadata>("/web-metadata", { url: normalizeMediaUrl(url) }, signal); }
  citationMetadata(doi: string, signal?: AbortSignal) { return this.json<ResearchCitationMetadata>("/citation-metadata", { doi: normalizeCitationDoi(doi) }, signal); }
  remote(directory: string, id: string) { return this.request<RemoteMediaJob>(`/remote/${encodeURIComponent(id)}?${new URLSearchParams({ directory })}`); }
  pauseRemote(directory: string, id: string) { return this.json<RemoteMediaJob>(`/remote/${encodeURIComponent(id)}/pause`, { directory }); }
  staging(directory: string) { return this.json<{ id: string }>("/staging", { directory }); }
  async export(directory: string, notebook: ResearchNotebookState, format: "library" | "markdown", noteId?: string) {
    const notes = format === "markdown" && noteId ? notebook.notes.filter(note => note.id === noteId) : notebook.notes;
    const ids = researchMediaAssetIds(notes.flatMap(note => format === "markdown" ? expandNoteEmbedBlocks(notebook.notes, note.blocks, note.id) : note.blocks));
    for (const id of ids) if (meWikiManualAsset(id)) await this.metadata(directory, id);
    const { id } = await this.json<{ id: string }>("/exports", { directory, notebook, format, noteId });
    return `/api/research-library/media/exports/${encodeURIComponent(id)}?${new URLSearchParams({ directory })}`;
  }
  importArchive(directory: string, file: File) {
    return this.request<{ content: string }>(`/import?${new URLSearchParams({ directory })}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  }
}
export const researchMediaClient = new ResearchMediaClient();
