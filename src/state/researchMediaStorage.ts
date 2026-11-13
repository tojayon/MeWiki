import { BROWSER_MEDIA_BYTES, IMAGE_PREVIEW_PIXELS, validateMediaFile, type ResearchMediaAsset } from "../domain/researchMedia.ts";
import { hashMediaBlob, researchMediaClient, type MediaProgressListener } from "./researchMediaClient.ts";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { researchMediaAssetIds } from "../domain/researchMedia.ts";
import { mediaHeaderInfo, type MediaHeaderInfo } from "../domain/researchMediaFormats.ts";
import { meWikiManualAsset, readMeWikiManualAsset } from "../domain/meWikiManualAssets.ts";
import { isUserFontMime, MAX_USER_FONT_BYTES } from '../domain/researchFonts.ts';

export { imageHeaderInfo } from "../domain/researchMediaFormats.ts";
export interface StoredBrowserMedia { asset: ResearchMediaAsset; blob: Blob; previewBlob?: Blob }
async function previewImage(blob: Blob, info: MediaHeaderInfo): Promise<{ blob: Blob; width: number; height: number } | undefined> {
  if (!info.width || !info.height || info.width * info.height > IMAGE_PREVIEW_PIXELS || typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return;
  let bitmap: ImageBitmap | undefined;
  try {
    const scale = Math.min(1, 1600 / Math.max(info.width, info.height));
    const width = Math.max(1, Math.round(info.width * scale));
    const height = Math.max(1, Math.round(info.height * scale));
    bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(bitmap, 0, 0);
    return { blob: await canvas.convertToBlob({ type: "image/webp", quality: 0.85 }), width, height };
  } catch { return; }
  finally { bitmap?.close(); }
}
export class BrowserMediaStore {
  private database?: Promise<IDBDatabase>;
  private readonly name: string;
  constructor(name = "mewiki-research-media") { this.name = name; }
  private db() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore("assets", { keyPath: "asset.id" }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("浏览器附件存储不可用，请选择本地资料库。"));
      request.onblocked = () => reject(new Error("浏览器附件存储正被其他页面占用，请关闭其他工作台页面重试。"));
    });
  }
  async get(id: string): Promise<StoredBrowserMedia | undefined> {
    try {
      const stored = await this.stored(id);
      if (stored) return stored;
    } catch (cause) {
      if (!meWikiManualAsset(id)) throw cause;
    }
    return readMeWikiManualAsset(id);
  }
  private async stored(id: string): Promise<StoredBrowserMedia | undefined> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction("assets", "readonly").objectStore("assets").get(id);
      request.onsuccess = () => resolve(request.result as StoredBrowserMedia | undefined);
      request.onerror = () => reject(new Error("无法读取浏览器附件。"));
    });
  }
  async count(): Promise<number> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction("assets", "readonly").objectStore("assets").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async listFonts(): Promise<ResearchMediaAsset[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction('assets', 'readonly').objectStore('assets').getAll();
      request.onsuccess = () => resolve((request.result as StoredBrowserMedia[]).map(item => item.asset).filter(asset => isUserFontMime(asset.mimeType)).sort((a, b) => a.name.localeCompare(b.name)));
      request.onerror = () => reject(new Error('无法读取已导入字体。'));
    });
  }
  async put(file: File, onProgress?: MediaProgressListener, signal?: AbortSignal): Promise<ResearchMediaAsset> {
    const mime = validateMediaFile(file);
    if (isUserFontMime(mime)) {
      if (file.size > MAX_USER_FONT_BYTES) throw new Error('单个字体最大 100 MiB，请选择较小的字体文件。');
    } else if (file.size > BROWSER_MEDIA_BYTES) throw new Error("超过 100 MB 的附件请先在“设置 → 存储位置”中选择本地资料库；本地资料库支持单文件不超过 1 GB。");
    const quota = await globalThis.navigator?.storage?.estimate?.();
    if (quota?.quota && quota.usage !== undefined && quota.quota - quota.usage < file.size * 1.2) throw new Error("浏览器存储空间不足，请先选择本地资料库。");
    const info = mediaHeaderInfo(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()), mime, file.size);
    const digest = await hashMediaBlob(file, onProgress, signal);
    const existing = await this.stored(digest);
    if (existing) {
      if (existing.asset.mimeType !== info.mimeType || existing.asset.size !== file.size) throw new Error("同一原件已按另一种媒体格式保存，请使用原格式；当前内容保持不变。");
      return existing.asset;
    }
    const preview = info.mimeType.startsWith("image/") ? await previewImage(file, info) : undefined;
    signal?.throwIfAborted();
    const asset: ResearchMediaAsset = { id: digest, sha256: digest, name: file.name, mimeType: info.mimeType, size: file.size, createdAt: new Date().toISOString(), ...(info.width && info.height ? { width: info.width, height: info.height } : {}), ...(preview ? { preview: { width: preview.width, height: preview.height, mimeType: preview.blob.type } } : {}) };
    onProgress?.({ phase: "saving", loaded: file.size, total: file.size });
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("assets", "readwrite");
      transaction.objectStore("assets").put({ asset, blob: file.slice(0, file.size, info.mimeType), ...(preview ? { previewBlob: preview.blob } : {}) } satisfies StoredBrowserMedia);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("浏览器附件保存失败或空间不足，请选择本地资料库。"));
    });
    const stored = await this.stored(asset.id);
    if (!stored || stored.blob.size !== file.size) throw new Error("浏览器附件保存后校验失败。");
    return asset;
  }
}
export const browserMediaStore = new BrowserMediaStore();
const browserFontStores = new Map<string, BrowserMediaStore>();
export function browserFontStore(libraryId: string): BrowserMediaStore {
  let store = browserFontStores.get(libraryId);
  if (!store) { store = new BrowserMediaStore(`mewiki:library:${encodeURIComponent(libraryId)}:fonts`); browserFontStores.set(libraryId, store); }
  return store;
}
export async function prepareBrowserMediaMigration(directory: string, notebook: ResearchNotebookState, sourceDirectory: string | null, libraryId = 'default'): Promise<string | undefined> {
  const ids = researchMediaAssetIds(notebook.notes.flatMap(note => note.blocks));
  const fontStore = browserFontStore(libraryId);
  const fonts = !sourceDirectory && typeof indexedDB !== 'undefined' ? await fontStore.listFonts() : [];
  ids.push(...fonts.map(font => font.id).filter(id => !ids.includes(id)));
  let stagingId: string | undefined;
  for (const id of ids) {
    // A connected library is authoritative; migrating it must not depend on a
    // browser cache that may have been cleared or disabled.
    if (sourceDirectory) {
      try { await researchMediaClient.metadata(sourceDirectory, id); continue; }
      catch { /* An independent browser original may still repair a missing file. */ }
    }
    const stored = fonts.some(font => font.id === id) ? await fontStore.get(id) : await browserMediaStore.get(id);
    if (!stored) {
      if (sourceDirectory) throw new Error("当前本地资料库有媒体原件缺失，请恢复附件或重新关联文件；保存目录尚未切换。");
      throw new Error("有媒体原件未能在浏览器中找到，请先恢复附件或重新关联文件；资料库目录尚未切换。");
    }
    stagingId ??= (await researchMediaClient.staging(directory)).id;
    const asset = await researchMediaClient.upload(directory, new File([stored.blob], stored.asset.name, { type: stored.asset.mimeType }), undefined, undefined, stagingId);
    if (asset.id !== id) throw new Error("迁移媒体的完整性校验失败，原资料库已保留。");
  }
  return stagingId;
}
