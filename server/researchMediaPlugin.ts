import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type { ResearchNotebookState } from "../src/domain/researchNotebook.ts";
import { ResearchLibraryError } from "./researchLibraryStore.ts";
import { ResearchMediaStore } from "./researchMediaStore.ts";

export const researchMediaPrefix = "/api/research-library/media";
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
function authorize(request: IncomingMessage) {
  const host = new URL(`http://${request.headers.host ?? "invalid"}`);
  if (
    !localHosts.has(host.hostname) ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      request.socket.remoteAddress ?? "",
    )
  )
    throw new ResearchLibraryError("附件接口仅允许本机访问。", 403);
  if (request.headers.origin && request.headers.origin !== host.origin)
    throw new ResearchLibraryError("附件接口只接受当前工作台的请求。", 403);
  if (
    !["GET", "HEAD"].includes(request.method ?? "") &&
    request.headers["x-webbench-request"] !== "research-library"
  )
    throw new ResearchLibraryError("附件保存请求来源无效。", 403);
}
function requireType(request: IncomingMessage, expected: string) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== expected)
    throw new ResearchLibraryError("附件请求内容类型无效。", 415);
}
async function body(request: IncomingMessage) {
  requireType(request, "application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024)
      throw new ResearchLibraryError("附件操作的笔记信息超过大小限制。", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ResearchLibraryError("附件操作不是有效的 JSON。");
  }
}
function disposition(mode: "attachment" | "inline", filename: string) {
  const ascii =
    filename.replace(/[^a-zA-Z0-9._ -]/g, "-").slice(0, 160) || "media";
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase())}`;
}
function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return undefined;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    (!match[1] && Number(match[2]) === 0)
  )
    return undefined;
  return { start, end };
}

export function createResearchMediaMiddleware(store: ResearchMediaStore) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(request.url ?? "", "http://127.0.0.1");
    if (
      url.pathname !== researchMediaPrefix &&
      !url.pathname.startsWith(researchMediaPrefix + "/")
    ) {
      next();
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    try {
      authorize(request);
      const route = url.pathname.slice(researchMediaPrefix.length);
      const directory = url.searchParams.get("directory") ?? "";
      const stagingId = url.searchParams.get("stagingId") ?? undefined;
      const asset = /^\/assets\/([a-f0-9]{64})(\/content)?$/.exec(route);
      const chunk = /^\/uploads\/([a-f0-9]{64})\/(\d+)$/.exec(route);
      const complete = /^\/uploads\/([a-f0-9]{64})\/complete$/.exec(route);
      const remote = /^\/remote\/([a-f0-9]{64})(\/pause)?$/.exec(route);
      const exporting = /^\/exports\/([a-f0-9-]{36})$/.exec(route);
      let result: unknown;
      if ((request.method === "GET" || request.method === "HEAD") && asset) {
        if (!asset[2]) result = await store.asset(directory, asset[1]);
        else {
          const content = await store.content(
            directory,
            asset[1],
            url.searchParams.get("preview") === "1",
          );
          response.setHeader("Content-Type", content.mimeType);
          response.setHeader("Accept-Ranges", "bytes");
          response.setHeader(
            "Content-Disposition",
            disposition(
              content.preview || url.searchParams.get("inline") === "1" && (/^(audio|video)\//.test(content.mimeType) || content.mimeType === "application/pdf") ? "inline" : "attachment",
              content.name,
            ),
          );
          const etag = `"${asset[1]}${content.preview ? "-preview" : ""}"`;
          response.setHeader("ETag", etag);
          const rangeHeader = request.headers.range;
          let selected: { start: number; end: number } | undefined;
          if (
            rangeHeader &&
            (!request.headers["if-range"] ||
              request.headers["if-range"] === etag)
          ) {
            selected = byteRange(rangeHeader, content.size);
            if (!selected) {
              response.setHeader("Content-Range", `bytes */${content.size}`);
              throw new ResearchLibraryError("请求的附件范围无效。", 416);
            }
            response.statusCode = 206;
            response.setHeader(
              "Content-Range",
              `bytes ${selected.start}-${selected.end}/${content.size}`,
            );
          }
          response.setHeader(
            "Content-Length",
            selected ? selected.end - selected.start + 1 : content.size,
          );
          if (request.method === "HEAD") response.end();
          else
            await pipeline(
              createReadStream(content.filename, selected),
              response,
            );
          return;
        }
      } else if (request.method === "GET" && remote && !remote[2])
        result = await store.remoteStatus(directory, remote[1]);
      else if (request.method === "GET" && exporting) {
        const archive = await store.exportArchive(directory, exporting[1]);
        response.setHeader("Content-Type", "application/zip");
        response.setHeader(
          "Content-Disposition",
          disposition("attachment", archive.filename),
        );
        await pipeline(archive.stream, response);
        return;
      } else if (request.method === "PUT" && chunk) {
        requireType(request, "application/octet-stream");
        request.setTimeout(60_000);
        result = await store.writeChunk(
          directory,
          chunk[1],
          Number(chunk[2]),
          request,
          String(request.headers["x-chunk-sha256"] ?? ""),
          stagingId,
        );
      } else if (request.method === "POST" && route === "/import") {
        requireType(request, "application/octet-stream");
        request.setTimeout(60_000);
        result = await store.importArchive(directory, request);
      } else if (request.method === "POST") {
        const value = await body(request);
        if (route === "/web-metadata" || route === "/citation-metadata") {
          if (route === "/web-metadata" && (typeof value.url !== "string" || value.url.length > 8192)) throw new ResearchLibraryError("网页网址无效。");
          if (route === "/citation-metadata" && (typeof value.doi !== "string" || value.doi.length > 8192)) throw new ResearchLibraryError("DOI 无效。");
          const abort = new AbortController();
          const closed = () => { if (!response.writableEnded) abort.abort(); };
          response.once("close", closed);
          try { result = route === "/web-metadata" ? await store.webMetadata(value.url as string, abort.signal) : await store.citationMetadata(value.doi as string, abort.signal); }
          finally { response.removeListener("close", closed); }
        } else if (route === "/staging")
          result = await store.startStaging(value as { directory: string });
        else if (route === "/uploads")
          result = await store.startUpload(
            value as Parameters<ResearchMediaStore["startUpload"]>[0],
          );
        else if (complete)
          result = await store.completeUpload(
            value.directory as string,
            complete[1],
            value.stagingId as string | undefined,
          );
        else if (route === "/remote")
          result = await store.startRemote(
            value as { directory: string; url: string },
          );
        else if (remote?.[2])
          result = await store.pauseRemote(
            value.directory as string,
            remote[1],
          );
        else if (route === "/exports")
          result = await store.createExport(
            value as {
              directory: string;
              notebook: ResearchNotebookState;
              format: "library" | "markdown";
              noteId?: string;
            },
          );
        else throw new ResearchLibraryError("附件接口不存在。", 404);
      } else throw new ResearchLibraryError("附件接口不存在。", 404);
      if (request.method === "HEAD") response.end();
      else response.end(JSON.stringify(result));
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.removeHeader("Content-Length");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.statusCode =
        error instanceof ResearchLibraryError ? error.status : 400;
      response.end(
        JSON.stringify({
          error:
            error instanceof ResearchLibraryError
              ? error.message
              : (error as NodeJS.ErrnoException)?.code === "ENOSPC"
                ? "磁盘空间不足，附件尚未保存完整。"
                : "附件操作失败，请检查文件或保存目录后重试。",
        }),
      );
    }
  };
}
