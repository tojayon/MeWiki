import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { ResearchLibraryStore } from "./researchLibraryStore.ts";
import { ResearchMediaStore } from "./researchMediaStore.ts";
import { createResearchMediaMiddleware } from "./researchMediaPlugin.ts";
import { createResearchNotebook } from "../src/domain/researchNotebook.ts";

const roots: string[] = [], servers: Server[] = [], stores: ResearchMediaStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("webbench-doc-test-")) throw new Error("Invalid cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});
async function serving(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "webbench-doc-test-")); roots.push(root);
  const directory = path.join(root, "资料库");
  const library = new ResearchLibraryStore({ settingsFile: path.join(root, "settings.json") });
  const notebook = createResearchNotebook();
  await library.connect({ directory, mode: "create", notebook });
  const media = new ResearchMediaStore(library, { remoteAddressPolicy: () => true }); stores.push(media);
  return { directory, library, notebook, media };
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function upload(media: ResearchMediaStore, directory: string, name: string, mimeType: string, bytes: Buffer) {
  const session = await media.startUpload({ directory, name, mimeType, size: bytes.length, sha256: hash(bytes) });
  await media.writeChunk(directory, session.uploadId, 0, Readable.from([bytes]), hash(bytes));
  return media.completeUpload(directory, session.uploadId);
}

describe("research documents and webpage services", () => {
  it("exposes DOI lookup to local workbench requests and rejects invalid input and origins", async () => {
    const { media } = await fixture();
    const metadata = { doi: "10.1234/test", title: "来源文献" };
    const lookup = vi.spyOn(media, "citationMetadata").mockResolvedValue(metadata);
    const middleware = createResearchMediaMiddleware(media);
    const base = await serving((request, response) => void middleware(request, response, () => response.end()));
    const url = base + "/api/research-library/media/citation-metadata";
    const headers = { "Content-Type": "application/json", "X-WebBench-Request": "research-library" };
    const result = await fetch(url, { method: "POST", headers, body: JSON.stringify({ doi: "10.1234/test" }) });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(metadata);
    expect(lookup.mock.calls[0][0]).toBe("10.1234/test");
    expect(lookup.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    const invalid = await fetch(url, { method: "POST", headers, body: JSON.stringify({ doi: 123 }) });
    expect(invalid.status).toBe(400);
    const foreign = await fetch(url, { method: "POST", headers: { ...headers, Origin: "https://example.com" }, body: JSON.stringify({ doi: "10.1234/test" }) });
    expect(foreign.status).toBe(403);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("backs up originals referenced only by literature and dataset blocks", async () => {
    const { directory, media, notebook } = await fixture();
    const pdf = await upload(media, directory, "来源.pdf", "application/pdf", Buffer.from("%PDF-1.7\ncitation fixture"));
    const data = await upload(media, directory, "数据.csv", "text/csv", Buffer.from("t,y\n0,1\n1,2"));
    const blocks = [
      { id: "citation", type: "citation" as const, title: "文献", pdf: { type: "asset" as const, assetId: pdf.id }, pdfPage: 2 },
      { id: "dataset", type: "dataset" as const, source: { type: "asset" as const, assetId: data.id }, columns: ["t", "y"], rows: [["0", "1"], ["1", "2"]], chart: { kind: "line" as const, x: 0, ys: [1] } },
      { id: "diagram", type: "diagram" as const, mode: "mermaid" as const, code: "flowchart LR\n A --> B", strokes: [] },
    ];
    const state = { ...notebook, notes: [{ ...notebook.notes[0], blocks }] };
    const job = await media.createExport({ directory, notebook: state, format: "library" });
    const archive = await media.exportArchive(directory, job.id);
    const chunks: Buffer[] = []; for await (const chunk of archive.stream) chunks.push(Buffer.from(chunk));
    const destination = await fixture();
    const restored = await destination.media.importArchive(destination.directory, Readable.from([Buffer.concat(chunks)]));
    expect(JSON.parse(restored.content).notebook.notes[0].blocks).toEqual(blocks);
    expect((await destination.media.content(destination.directory, pdf.id, false)).size).toBe(pdf.size);
    expect((await destination.media.content(destination.directory, data.id, false)).size).toBe(data.size);
  });
  it("round trips PDF and generic files through a complete attachment archive", async () => {
    const { directory, media, notebook } = await fixture();
    const pdf = await upload(media, directory, "论文.pdf", "application/pdf", Buffer.from("%PDF-1.7\nfixture"));
    const file = await upload(media, directory, "原始结果.dat", "application/octet-stream", Buffer.from("raw research data"));
    const jsonFile = await upload(media, directory, "results.json", "application/json", Buffer.from('{"samples":[1,2,3]}'));
    expect((await media.content(directory, jsonFile.id, false)).filename).toMatch(/\.jsondata$/);
    const state = { ...notebook, notes: [{ ...notebook.notes[0], blocks: [
      { id: "p", type: "media" as const, kind: "pdf" as const, source: { type: "asset" as const, assetId: pdf.id }, document: { page: 2 } },
      { id: "f", type: "media" as const, kind: "file" as const, source: { type: "asset" as const, assetId: file.id } },
      { id: "link", type: "bookmark" as const, url: "https://example.com/", title: "来源网页" },
      { id: "json", type: "media" as const, kind: "file" as const, source: { type: "asset" as const, assetId: jsonFile.id } },
    ] }] };
    const job = await media.createExport({ directory, notebook: state, format: "library" });
    const archive = await media.exportArchive(directory, job.id);
    const chunks: Buffer[] = []; for await (const chunk of archive.stream) chunks.push(Buffer.from(chunk));
    const restored = await media.importArchive(directory, Readable.from([Buffer.concat(chunks)]));
    expect(JSON.parse(restored.content).notebook.notes[0].blocks).toEqual(state.notes[0].blocks);
  });
  it("serves PDF byte ranges inline and keeps active generic attachments as downloads", async () => {
    const { directory, media } = await fixture();
    const pdf = await upload(media, directory, "论文.pdf", "application/pdf", Buffer.from("%PDF-1.7\nfixture"));
    const file = await upload(media, directory, "网页.html", "application/octet-stream", Buffer.from("<script>alert(1)</script>"));
    const middleware = createResearchMediaMiddleware(media);
    const base = await serving((request, response) => void middleware(request, response, () => response.end()));
    const query = new URLSearchParams({ directory, inline: "1" });
    const response = await fetch(`${base}/api/research-library/media/assets/${pdf.id}/content?${query}`, { headers: { Range: "bytes=0-7" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(await response.text()).toBe("%PDF-1.7");
    const ordinary = await fetch(`${base}/api/research-library/media/assets/${file.id}/content?${query}`);
    expect(ordinary.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(ordinary.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("recognizes binary PDF downloads and preserves the source filename", async () => {
    const { directory, media } = await fixture();
    const base = await serving((_request, response) => { response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf" }); response.end("%PDF-1.7\nremote"); });
    let job = await media.startRemote({ directory, url: base + "/download" });
    for (let attempt = 0; job.status === "downloading" && attempt < 100; attempt++) { await delay(20); job = await media.remoteStatus(directory, job.id); }
    expect(job.status).toBe("complete");
    expect(job.asset).toMatchObject({ name: "报告.pdf", mimeType: "application/pdf" });
  });
  it("extracts webpage text without scripts or external image requests and bounds responses", async () => {
    const { media } = await fixture();
    let imageRequests = 0;
    const base = await serving((request, response) => {
      if (request.url === "/image") imageRequests++;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(request.url === "/large" ? "x".repeat(1_048_577) : '<html><head><title>研究 &amp; 结果</title><meta property="og:description" content="月面观测 &lt;记录&gt;"><meta property="og:site_name" content="资料站"><meta property="og:image" content="/image"></head><body><script>throw 1</script></body></html>');
    });
    expect(await media.webMetadata(base + "/paper")).toEqual({ title: "研究 & 结果", description: "月面观测 <记录>", siteName: "资料站" });
    await expect(media.webMetadata(base + "/large")).rejects.toThrow(/大小|过大|限制/);
    expect(imageRequests).toBe(0);
  });
  it("rejects private network requests and does not follow redirects around the address policy", async () => {
    const { library } = await fixture();
    const strict = new ResearchMediaStore(library); stores.push(strict);
    await expect(strict.webMetadata("http://127.0.0.1/private")).rejects.toThrow(/地址/);
    await expect(strict.webMetadata("file:///C:/secret")).rejects.toThrow();
    let lookups = 0;
    const limited = new ResearchMediaStore(library, { remoteAddressPolicy: () => ++lookups < 2 }); stores.push(limited);
    const base = await serving((_request, response) => { response.writeHead(302, { Location: "/second" }); response.end(); });
    await expect(limited.webMetadata(base + "/first")).rejects.toThrow(/地址/);
  });
});
