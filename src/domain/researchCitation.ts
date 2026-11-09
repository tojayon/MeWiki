import { normalizeMediaBlock, normalizeMediaUrl, type ResearchMediaSource } from "./researchMedia.ts";

export interface ResearchCitationBlock {
  id: string;
  type: "citation";
  title?: string;
  authors?: string;
  year?: string;
  venue?: string;
  doi?: string;
  url?: string;
  notes?: string;
  pdf?: ResearchMediaSource;
  pdfName?: string;
  pdfPage?: number;
}

export interface ResearchCitationMetadata {
  doi: string;
  title: string;
  authors?: string;
  year?: string;
  venue?: string;
  url?: string;
}

export function normalizeCitationDoi(value: string): string {
  let doi = value.trim().replace(/^doi:\s*/i, "");
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(doi)) {
    const url = new URL(doi);
    try { doi = decodeURIComponent(url.pathname.slice(1)); }
    catch { throw new Error("DOI 编码无效，请填写完整的 DOI。"); }
  }
  if (!/^10\.\d{4,9}\/[^\s<>"\\]+$/i.test(doi) || doi.length > 2048) throw new Error("请填写完整的 DOI，例如 10.1234/example，也可粘贴 doi.org 链接。");
  return doi;
}

export function normalizeCitationBlock(value: unknown): ResearchCitationBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("文献内容无效。");
  const block = value as Record<string, unknown>;
  if (typeof block.id !== "string" || !block.id || block.type !== "citation") throw new Error("文献内容类型无效。");
  const result: ResearchCitationBlock = { id: block.id, type: "citation" };
  for (const field of ["title", "authors", "year", "venue", "notes", "pdfName"] as const) {
    if (block[field] === undefined) continue;
    if (typeof block[field] !== "string" || block[field].length > (field === "notes" ? 160_000 : 16_000)) throw new Error("文献字段内容无效或过长。");
    result[field] = block[field];
  }
  if (block.doi !== undefined) {
    if (typeof block.doi !== "string") throw new Error("DOI 内容无效。");
    if (block.doi.trim()) result.doi = normalizeCitationDoi(block.doi);
  }
  if (block.url !== undefined) {
    if (typeof block.url !== "string") throw new Error("文献网址无效。");
    if (block.url.trim()) result.url = normalizeMediaUrl(block.url);
  }
  if (block.pdf !== undefined) result.pdf = normalizeMediaBlock({ id: block.id, type: "media", kind: "pdf", source: block.pdf }).source;
  if (block.pdfPage !== undefined) {
    if (!Number.isSafeInteger(block.pdfPage) || (block.pdfPage as number) < 1) throw new Error("PDF 页码必须为正整数。");
    result.pdfPage = block.pdfPage as number;
  }
  return result;
}

export function citationDoiUrl(doi: string): string {
  return `https://doi.org/${encodeURI(normalizeCitationDoi(doi)).replaceAll("#", "%23").replaceAll("?", "%3F")}`;
}

export function formatCitation(block: ResearchCitationBlock): string {
  const author = block.authors?.trim() ?? "";
  const year = block.year?.trim();
  const leading = [author, year ? `(${year})` : ""].filter(Boolean).join(" ");
  return [leading, block.title?.trim(), block.venue?.trim(), block.doi ? citationDoiUrl(block.doi) : block.url].filter(Boolean).join(". ") || "文献待填写";
}

export function citationText(block: ResearchCitationBlock): string {
  return [block.title, block.authors, block.year, block.venue, block.doi, block.url, block.notes, block.pdfName, block.pdf?.type === "asset" ? `webbench-asset:${block.pdf.assetId}` : block.pdf?.url].filter(Boolean).join("\n");
}

const escapeLabel = (value: string) => value.replace(/[\\[\]]/g, "\\$&").replace(/\r?\n/g, " ");
const escapeUrl = (value: string) => value.replaceAll("(", "%28").replaceAll(")", "%29");
export function serializeCitationMarkdown(block: ResearchCitationBlock): string {
  const fields = [[block.authors?.trim(), block.year?.trim() ? `(${block.year.trim()})` : ""].filter(Boolean).join(" "), block.title?.trim(), block.venue?.trim()].filter((value): value is string => Boolean(value));
  const reference = fields.length ? fields.map(escapeLabel).join(". ") : "文献待填写";
  const links: string[] = [];
  if (block.doi) links.push(`[DOI: ${escapeLabel(block.doi)}](${escapeUrl(citationDoiUrl(block.doi))})`);
  if (block.url) links.push(`[来源网页](${escapeUrl(block.url)})`);
  if (block.pdf) {
    const source = block.pdf.type === "asset" ? `webbench-asset:${block.pdf.assetId}` : block.pdf.url;
    const url = block.pdfPage ? source.split("#")[0] + `#page=${block.pdfPage}` : source;
    const label = `${block.pdfName || "PDF 原文"}${block.pdfPage ? ` · 第 ${block.pdfPage} 页` : ""}`;
    links.push(`[${escapeLabel(label)}](${escapeUrl(url)})`);
  }
  return [reference, links.join(" · "), block.notes].filter(Boolean).join("\n\n");
}
