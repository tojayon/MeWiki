import { expect, it } from "vitest";
import { createServer } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pdfResourcesPlugin } from "./pdfResourcesPlugin.ts";

async function removeTemporaryDirectory(directory: string) {
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("webbench-pdf-resources-")) throw new Error("Invalid test cleanup path");
  await rm(directory, { recursive: true, force: true });
}

it("serves local PDF decoder modules with executable MIME types", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "webbench-pdf-resources-"));
  const server = await createServer({
    configFile: false,
    envDir: false,
    publicDir: false,
    appType: "custom",
    cacheDir: path.join(temporary, "vite-cache"),
    plugins: [pdfResourcesPlugin()],
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("PDF resource server did not start");
    const base = `http://127.0.0.1:${address.port}`;
    for (const [resource, mime] of [
      ["wasm/openjpeg_nowasm_fallback.js", "text/javascript"],
      ["wasm/openjpeg.wasm", "application/wasm"],
      ["cmaps/Adobe-GB1-UCS2.bcmap", "application/octet-stream"],
    ]) {
      const response = await fetch(`${base}/pdfjs/${resource}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(mime);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  } finally {
    await server.close();
    await removeTemporaryDirectory(temporary);
  }
}, 10_000);
