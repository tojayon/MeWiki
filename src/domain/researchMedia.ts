import { unified } from "unified";
import remarkParse from "remark-parse";
import type { ResearchNotebookBlock } from "./researchNotebook.ts";
import { mediaFileMime, mediaKindFromMime, mediaKindLabels, type ResearchMediaKind } from "./researchMediaFormats.ts";
export { canonicalMediaMime, mediaFileAccept, mediaFileKind, mediaFileMime, mediaHeaderInfo, mediaKindFromMime, mediaKindLabels, mediaMimeExtensions } from "./researchMediaFormats.ts";
export type { ResearchMediaKind } from "./researchMediaFormats.ts";

export const MAX_MEDIA_BYTES = 1_000_000_000;
export const MEDIA_CHUNK_BYTES = 8 * 1024 * 1024;
export const BROWSER_MEDIA_BYTES = 100_000_000;
export const IMAGE_PREVIEW_PIXELS = 40_000_000;
export const mediaAssetIdPattern = /^[a-f0-9]{64}$/;
export interface ResearchMediaAsset {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  preview?: { width: number; height: number; mimeType: string };
}
export type ResearchMediaSource = { type: "asset"; assetId: string } | { type: "url"; url: string };
export interface ResearchMediaBlock {
  id: string;
  type: "media";
  kind: ResearchMediaKind;
  source?: ResearchMediaSource;
  caption?: string;
  alt?: string;
  /** Preserved verbatim when an old local path cannot be read by the browser. */
  legacySource?: string;
  display?: { align?: "left" | "center" | "right"; widthPercent?: number };
  poster?: ResearchMediaSource;
  playback?: { rate?: number; loop?: boolean };
  document?: { page?: number };
}
export function validateMediaFile(file: { name: string; type: string; size: number }, kind?: ResearchMediaKind): string {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("请选择非空媒体文件。");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("单个附件不能超过 1 GB。");
  const mime = mediaFileMime(file);
  const actualKind = mediaKindFromMime(mime);
  if (!actualKind) throw new Error("文件格式无效，请重新选择原文件。");
  if (kind && kind !== "file" && actualKind !== kind) throw new Error(`请选择${mediaKindLabels[kind]}文件，当前内容保持不变。`);
  return mime;
}
export function normalizeMediaUrl(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("请使用不含登录凭据的 HTTP 或 HTTPS 媒体直链。");
  return url.href;
}
export function normalizeMediaBlock(value: unknown): ResearchMediaBlock {
  if (!value || typeof value !== "object") throw new Error("媒体内容无效。");
  const block = value as ResearchMediaBlock;
  if (typeof block.id !== "string" || block.type !== "media" || !["image", "audio", "video", "pdf", "file"].includes(block.kind)) throw new Error("媒体内容类型无效。");
  const normalizeSource = (value: ResearchMediaSource | undefined): ResearchMediaSource | undefined => {
    if (value === undefined) return;
    if (value?.type === "asset" && mediaAssetIdPattern.test(value.assetId)) return { type: "asset", assetId: value.assetId };
    if (value?.type === "url" && typeof value.url === "string") return { type: "url", url: normalizeMediaUrl(value.url) };
    throw new Error("媒体来源无效，附件引用已保留，请检查资料库。");
  };
  const source = normalizeSource(block.source);
  const poster = block.kind === "video" ? normalizeSource(block.poster) : undefined;
  const playback = block.playback && ["audio", "video"].includes(block.kind) ? {
    ...(typeof block.playback.rate === "number" && Number.isFinite(block.playback.rate) ? { rate: Math.min(4, Math.max(0.25, block.playback.rate)) } : {}),
    ...(typeof block.playback.loop === "boolean" ? { loop: block.playback.loop } : {}),
  } : undefined;
  const align = block.display?.align;
  const width = block.display?.widthPercent;
  return { id: block.id, type: "media", kind: block.kind, ...(source ? { source } : {}),
    ...(poster ? { poster } : {}), ...(playback ? { playback } : {}),
    ...(block.kind === "pdf" && block.document ? { document: { ...(Number.isSafeInteger(block.document.page) && block.document.page! > 0 ? { page: block.document.page } : {}) } } : {}),
    ...(typeof block.caption === "string" ? { caption: block.caption } : {}),
    ...(typeof block.alt === "string" ? { alt: block.alt } : {}),
    ...(typeof block.legacySource === "string" ? { legacySource: block.legacySource } : {}),
    ...(block.display ? { display: { ...(["left", "center", "right"].includes(align ?? "") ? { align } : {}), ...(typeof width === "number" && Number.isFinite(width) ? { widthPercent: Math.max(25, Math.min(100, width)) } : {}) } } : {}),
  };
}
const parser = unified().use(remarkParse);
export function legacyResearchImage(block: { id: string; text: string }): ResearchMediaBlock | null {
  const tree = parser.parse(block.text);
  if (tree.children.length !== 1 || tree.children[0].type !== "paragraph" || tree.children[0].children.length !== 1 || tree.children[0].children[0].type !== "image") return null;
  const image = tree.children[0].children[0];
  const result: ResearchMediaBlock = { id: block.id, type: "media", kind: "image", alt: image.alt ?? "", ...(image.title ? { caption: image.title } : {}) };
  if (image.url.startsWith("webbench-asset:") && mediaAssetIdPattern.test(image.url.slice(15))) return { ...result, source: { type: "asset", assetId: image.url.slice(15) } };
  try { return { ...result, source: { type: "url", url: normalizeMediaUrl(image.url) } }; }
  catch { return { ...result, legacySource: block.text }; }
}
export function migrateResearchMediaNotebook<T extends { version: 4 | 5 | 6 | 7 | 8; notes: { blocks: ResearchNotebookBlock[] }[] }>(value: T): Omit<T, "version"> & { version: 8 };
export function migrateResearchMediaNotebook(value: unknown): unknown;
export function migrateResearchMediaNotebook(value: unknown): unknown {
  if (!value || typeof value !== "object" || ![4, 5, 6, 7, 8].includes((value as { version: number }).version) || !Array.isArray((value as { notes: unknown }).notes)) return value;
  const notebook = value as { version: 4 | 5 | 6 | 7 | 8; notes: { blocks: ResearchNotebookBlock[] }[] };
  let changed = notebook.version !== 8;
  const migrate = (blocks: ResearchNotebookBlock[]): ResearchNotebookBlock[] => blocks.map(block => {
    if (block.type === "markdown" && block.kind === "image") {
      const image = legacyResearchImage(block);
      if (image) { changed = true; return { ...image, ...(block.section ? { section: block.section } : {}) }; }
    }
    if (block.type === "examples") return { ...block, tabs: block.tabs.map(tab => ({ ...tab, blocks: migrate(tab.blocks) })) };
    return block;
  });
  const notes = notebook.notes?.map(note => ({ ...note, blocks: migrate(note.blocks) }));
  return changed ? { ...notebook, version: 8, notes } : value;
}
export function serializeResearchMediaMarkdown(block: ResearchMediaBlock): string {
  if (block.legacySource && !block.source) return [block.legacySource, block.caption].filter(Boolean).join("\n\n");
  let url = block.source?.type === "asset" ? `webbench-asset:${block.source.assetId}` : block.source?.url;
  if (!url) return block.caption || block.alt || "";
  if (block.kind === "pdf" && block.document?.page) url = url.split("#")[0] + `#page=${block.document.page}`;
  const escape = (text: string) => text.replace(/[\\[\]]/g, "\\$&").replace(/\r?\n/g, " ");
  const safeUrl = url.replaceAll("(", "%28").replaceAll(")", "%29");
  const media = block.kind === "image" ? `![${escape(block.alt ?? "")}](${safeUrl})` : `[${escape(block.alt || mediaKindLabels[block.kind])}](${safeUrl})`;
  return [media, block.caption].filter(Boolean).join("\n\n");
}
export function researchMediaAssetIds(blocks: ResearchNotebookBlock[]): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") for (const match of value.matchAll(/webbench-asset:([a-f0-9]{64})/g)) ids.add(match[1]);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const source = value as { type?: string; assetId?: string };
      if (source.type === "asset" && typeof source.assetId === "string" && mediaAssetIdPattern.test(source.assetId)) ids.add(source.assetId);
      Object.values(value).forEach(visit);
    }
  };
  visit(blocks);
  return [...ids];
}
