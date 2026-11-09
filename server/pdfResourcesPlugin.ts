import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** Keep PDF fonts, CMaps and decoders local in development and production. */
export function pdfResourcesPlugin(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const folders = ["cmaps", "standard_fonts", "wasm", "iccs"];
  return {
    name: "local-pdf-resources",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/pdfjs\/([a-z_]+)\/([a-zA-Z0-9_.-]+)$/.exec((request.url ?? "").split("?")[0]);
        if (!match || !folders.includes(match[1]) || match[2].includes("..")) return next();
        const extension = path.extname(match[2]);
        response.setHeader("Content-Type", extension === ".js" ? "text/javascript" : extension === ".wasm" ? "application/wasm" : "application/octet-stream");
        response.setHeader("X-Content-Type-Options", "nosniff");
        const stream = createReadStream(path.join(root, match[1], match[2]));
        stream.on("error", () => { if (!response.headersSent) response.statusCode = 404; response.end(); });
        stream.pipe(response);
      });
    },
    async generateBundle() {
      for (const folder of folders) for (const file of await readdir(path.join(root, folder), { withFileTypes: true })) {
        if (file.isFile()) this.emitFile({ type: "asset", fileName: `pdfjs/${folder}/${file.name}`, source: await readFile(path.join(root, folder, file.name)) });
      }
    },
  };
}
