import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";
import { createResearchLibraryMiddleware } from "./researchLibraryPlugin.ts";

let server: Server | undefined;
let root = "";
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (
    root &&
    path.dirname(root) === path.resolve(tmpdir()) &&
    path.basename(root).startsWith("webbench-api-test-")
  )
    await rm(root, { recursive: true, force: true });
});
async function start() {
  root = await mkdtemp(path.join(tmpdir(), "webbench-api-test-"));
  const handler = createResearchLibraryMiddleware(
    new ResearchLibraryStore({
      settingsFile: path.join(root, "settings.json"),
    }),
  );
  server = createServer((request, response) => {
    void handler(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" ? address!.port : 0}/api/research-library`;
}
describe("local library HTTP boundary", () => {
  it("serves the unconfigured state without storing browser data", async () => {
    const url = await start();
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ directory: null, file: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-origin mutations and malformed requests before touching files", async () => {
    const url = await start();
    const headers = {
      "Content-Type": "application/json",
      "X-WebBench-Request": "research-library",
    };
    expect(
      (
        await fetch(url + "/inspect", {
          method: "POST",
          headers: { ...headers, Origin: "https://example.com" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url + "/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(url + "/inspect", { method: "POST", headers, body: "{" }))
        .status,
    ).toBe(400);
    expect(
      (
        await fetch(url + "/inspect", {
          method: "POST",
          headers,
          body: JSON.stringify({ directory: "relative" }),
        })
      ).status,
    ).toBe(400);
    expect(await (await fetch(url)).json()).toEqual({
      directory: null,
      file: null,
    });
  });
});
