import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import {
  ResearchLibraryError,
  ResearchLibraryStore,
} from "./researchLibraryStore.ts";
import { ResearchMediaStore } from "./researchMediaStore.ts";
import {
  createResearchMediaMiddleware,
  researchMediaPrefix,
} from "./researchMediaPlugin.ts";

const prefix = "/api/research-library";
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
function requireLocalRequest(request: IncomingMessage) {
  const host = new URL(`http://${request.headers.host ?? "invalid"}`);
  const remote = request.socket.remoteAddress;
  if (
    !loopback.has(host.hostname) ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? "")
  )
    throw new ResearchLibraryError("资料库保存接口仅允许本机访问。", 403);
  if (request.headers.origin && request.headers.origin !== host.origin)
    throw new ResearchLibraryError(
      "资料库保存接口只接受当前工作台的请求。",
      403,
    );
  if (
    request.method !== "GET" &&
    (request.headers["x-webbench-request"] !== "research-library" ||
      !request.headers["content-type"]?.startsWith("application/json"))
  )
    throw new ResearchLibraryError("资料库保存请求来源无效。", 403);
}
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024 * 1024)
      throw new ResearchLibraryError(
        "资料库超过单次保存的 64 MiB 大小限制。",
        413,
      );
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ResearchLibraryError("保存请求不是有效的 JSON。");
  }
}

export function createResearchLibraryMiddleware(store: ResearchLibraryStore) {
  const media = new ResearchMediaStore(store);
  const mediaHandler = createResearchMediaMiddleware(media);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const route = request.url?.split("?")[0] ?? "";
    if (
      route === researchMediaPrefix ||
      route.startsWith(researchMediaPrefix + "/")
    ) {
      await mediaHandler(request, response, next);
      return;
    }
    if (route !== prefix && !route.startsWith(prefix + "/")) {
      next();
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      requireLocalRequest(request);
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const libraryId = url.searchParams.get("library") ?? "default";
      let result: unknown;
      if (request.method === "GET" && route === prefix + "/catalog")
        result = await store.catalog();
      else if (request.method === "GET" && route === prefix)
        result = await store.read(libraryId);
      else if (request.method === "GET" && route === prefix + "/history")
        result = await store.history(libraryId);
      else {
        const value = await body(request);
        if (request.method === "POST" && route === prefix + "/catalog")
          result = await store.registerLibrary(
            value as unknown as Parameters<
              ResearchLibraryStore["registerLibrary"]
            >[0],
          );
        else if (request.method === "PATCH" && route === prefix + "/catalog")
          result = await store.updateLibrary(value.id as string, value);
        else if (request.method === "DELETE" && route === prefix + "/catalog")
          result = await store.removeLibrary(value.id as string);
        else if (request.method === "POST" && route === prefix + "/inspect")
          result = await store.inspect(value.directory as string);
        else if (request.method === "POST" && route === prefix + "/connect") {
          result = await store.connect(
            value as unknown as Parameters<ResearchLibraryStore["connect"]>[0],
            libraryId,
            (sourceDirectory) =>
              media.prepareConnect(
                value as Parameters<ResearchMediaStore["prepareConnect"]>[0],
                libraryId,
                sourceDirectory,
              ),
          );
          // A cleanup failure cannot turn an already committed save into an apparent failed connection.
          await media
            .finishConnect(
              value as { directory: string; mediaStagingId?: string },
            )
            .catch(() => {});
        } else if (request.method === "PUT" && route === prefix)
          result = await store.save(
            value as unknown as Parameters<ResearchLibraryStore["save"]>[0],
            libraryId,
          );
        else if (request.method === "POST" && route === prefix + "/restore")
          result = await store.restore(
            value as unknown as Parameters<ResearchLibraryStore["restore"]>[0],
            libraryId,
          );
        else if (request.method === "POST" && route === prefix + "/import")
          result = await store.importBackup(
            value as unknown as Parameters<
              ResearchLibraryStore["importBackup"]
            >[0],
            libraryId,
          );
        else throw new ResearchLibraryError("资料库接口不存在。", 404);
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode =
        error instanceof ResearchLibraryError ? error.status : 400;
      response.end(
        JSON.stringify({
          error:
            error instanceof Error ? error.message : "本地资料库保存失败。",
        }),
      );
    }
  };
}

export function researchLibraryPlugin(): Plugin {
  let root = process.cwd();
  let middleware: ReturnType<typeof createResearchLibraryMiddleware>;
  const handler = () =>
    (middleware ??= createResearchLibraryMiddleware(
      new ResearchLibraryStore({
        settingsFile:
          process.env.MEWIKI_RESEARCH_SETTINGS ??
          path.join(root, ".mewiki", "research-library-settings.json"),
      }),
    ));
  return {
    name: "mewiki-local-research-library",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(handler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler());
    },
  };
}
