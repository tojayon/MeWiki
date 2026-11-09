import { normalizeMediaUrl } from "./researchMedia.ts";

export interface ResearchBookmarkBlock {
  id: string;
  type: "bookmark";
  url?: string;
  title?: string;
  description?: string;
  siteName?: string;
}
export interface ResearchWebMetadata { title: string; description: string; siteName: string }
export function normalizeBookmarkBlock(value: unknown): ResearchBookmarkBlock {
  const block = value as ResearchBookmarkBlock;
  if (!block || typeof block.id !== "string" || block.type !== "bookmark") throw new Error("网页链接内容无效。");
  let url: string | undefined;
  if (block.url !== undefined) {
    try { url = normalizeMediaUrl(block.url); }
    catch { throw new Error("网页链接请使用不含登录凭据的 HTTP 或 HTTPS 网址。"); }
  }
  return { id: block.id, type: "bookmark", ...(url ? { url } : {}), ...Object.fromEntries((["title", "description", "siteName"] as const).filter(key => typeof block[key] === "string").map(key => [key, block[key]])) };
}
export function serializeBookmarkMarkdown(block: ResearchBookmarkBlock): string {
  const title = (block.title || block.url || "网页链接").replace(/[\\[\]]/g, "\\$&").replace(/\r?\n/g, " ");
  const link = block.url ? `[${title}](${block.url.replaceAll("(", "%28").replaceAll(")", "%29")})` : title;
  return [link, block.description, block.siteName].filter(Boolean).join("\n\n");
}
