import type { IncomingMessage } from "node:http";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { citationDoiUrl, normalizeCitationDoi, type ResearchCitationMetadata } from "../src/domain/researchCitation.ts";
import { normalizeMediaUrl } from "../src/domain/researchMedia.ts";
import { ResearchLibraryError } from "./researchLibraryStore.ts";

type RemoteRequest = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<IncomingMessage>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function plainText(value: unknown): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return;
  if (value.length > 16000) throw new ResearchLibraryError("文献元信息字段过长，请手动填写。");
  const root = parseFragment(value);
  const parts: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if (node.nodeName === "#text") parts.push((node as DefaultTreeAdapterTypes.TextNode).value);
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) return;
    if ("tagName" in node && ["br", "p", "div"].includes(node.tagName)) parts.push(" ");
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return parts.join("").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim() || undefined;
}

/** CSL JSON is shared by DOI registration agencies; no publisher HTML is rendered. */
export function parseCitationMetadata(value: unknown, requestedDoi: string): ResearchCitationMetadata {
  const doi = normalizeCitationDoi(requestedDoi), input = record(value);
  let received: string;
  try { received = normalizeCitationDoi(typeof input.DOI === "string" ? input.DOI : ""); }
  catch { throw new ResearchLibraryError("文献元信息缺少有效 DOI，请手动填写。"); }
  if (received.toLowerCase() !== doi.toLowerCase()) throw new ResearchLibraryError("返回的文献 DOI 不一致，原有资料已保留。");
  const title = plainText(input.title);
  if (!title) throw new ResearchLibraryError("未找到可用的文献元信息，请手动填写。");
  const authors = Array.isArray(input.author) ? input.author.map(value => {
    const author = record(value);
    return plainText(author.literal) || [plainText(author.given), plainText(author.family)].filter(Boolean).join(" ");
  }).filter(Boolean).join("; ") : undefined;
  if (authors && authors.length > 16000) throw new ResearchLibraryError("文献作者元信息过长，请手动填写。");
  const dates = record(input.issued)["date-parts"];
  const year = Array.isArray(dates) && Array.isArray(dates[0]) ? dates[0][0] : undefined;
  const venue = plainText(input["container-title"]);
  let url = citationDoiUrl(doi);
  try { if (typeof input.URL === "string" && input.URL.length <= 8192) url = normalizeMediaUrl(input.URL); }
  catch { /* A malformed source URL does not prevent using the verified DOI. */ }
  return { doi, title, ...(authors ? { authors } : {}), ...(Number.isInteger(year) && year > 0 && year <= 9999 ? { year: String(year) } : {}), ...(venue ? { venue } : {}), url };
}

export async function fetchCitationMetadata(value: string, request: RemoteRequest, signal?: AbortSignal): Promise<ResearchCitationMetadata> {
  let doi: string;
  try { doi = normalizeCitationDoi(value); }
  catch (cause) { throw new ResearchLibraryError(cause instanceof Error ? cause.message : "DOI 无效。"); }
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  let response: IncomingMessage | undefined;
  try {
    abort.throwIfAborted();
    response = await request(`https://doi.org/${encodeURIComponent(doi)}`, { Accept: "application/vnd.citationstyles.csl+json" }, abort);
    if (response.statusCode === 404) throw new ResearchLibraryError("未找到此 DOI 的文献元信息，请检查 DOI 或手动填写。", 404);
    if (response.statusCode === 429) throw new ResearchLibraryError("DOI 查询过于频繁，请稍后重试。", 429);
    if (response.statusCode !== 200) throw new ResearchLibraryError("DOI 元信息服务暂时不可用，请稍后重试或手动填写。", 502);
    const type = response.headers["content-type"] ?? "";
    if (!/^application\/(?:vnd\.citationstyles\.csl\+json|json)(?:;|$)/i.test(type) || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") throw new ResearchLibraryError("该 DOI 未返回可读取的文献元信息，请手动填写。", 502);
    const maximum = 1024 * 1024;
    if (Number(response.headers["content-length"]) > maximum) throw new ResearchLibraryError("文献元信息超过大小限制，请手动填写。", 502);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      abort.throwIfAborted();
      size += chunk.length;
      if (size > maximum) throw new ResearchLibraryError("文献元信息超过大小限制，请手动填写。", 502);
      chunks.push(Buffer.from(chunk));
    }
    let data: unknown;
    try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new ResearchLibraryError("文献元信息格式无效，请手动填写。", 502); }
    return parseCitationMetadata(data, doi);
  } catch (cause) {
    if (signal?.aborted) throw signal.reason;
    if (abort.aborted) throw new ResearchLibraryError("DOI 元信息查询超时，请稍后重试。", 504);
    if (cause instanceof ResearchLibraryError) throw cause;
    throw new ResearchLibraryError("暂时无法获取 DOI 元信息，请检查网络后重试或手动填写。", 502);
  } finally { response?.destroy(); }
}
