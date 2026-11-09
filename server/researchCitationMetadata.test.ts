import { afterEach, describe, expect, it } from "vitest";
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fetchCitationMetadata, parseCitationMetadata } from "./researchCitationMetadata.ts";

const doi = "10.1234/lunar(2026)";
const record = { DOI: doi, title: "Observation <i>age</i> &amp; control", author: [{ given: "Ming", family: "Li" }, { literal: "Lunar Research Group" }], issued: { "date-parts": [[2026, 3, 1]] }, "container-title": "Research <b>Journal</b>", URL: "https://example.com/article" };
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
async function source(handler: (response: ServerResponse) => void) {
  const server = createServer((_request, response) => handler(response)); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  return {
    calls,
    request: (target: string, headers: Record<string, string>, signal: AbortSignal) => {
      calls.push({ url: target, headers });
      return new Promise<IncomingMessage>((resolve, reject) => get(url, { signal }, resolve).on("error", reject));
    },
  };
}

describe("DOI publication metadata", () => {
  it("extracts plain text, personal and organization authors, publication year and source", () => {
    expect(parseCitationMetadata(record, doi)).toEqual({ doi, title: "Observation age & control", authors: "Ming Li; Lunar Research Group", year: "2026", venue: "Research Journal", url: "https://example.com/article" });
  });
  it("keeps missing fields absent and uses a DOI source when the supplied URL is unsafe", () => {
    expect(parseCitationMetadata({ DOI: doi.toUpperCase(), title: "A report", URL: "javascript:alert(1)", author: [{ family: "王" }], issued: { "date-parts": [["bad"]] } }, doi)).toEqual({ doi, title: "A report", authors: "王", url: "https://doi.org/10.1234/lunar(2026)" });
    expect(parseCitationMetadata({ DOI: doi, title: "报告", "container-title": ["期刊"] }, doi).venue).toBe("期刊");
  });
  it("rejects another DOI, malformed records and overlong metadata before saving", () => {
    for (const value of [null, [], {}, { DOI: "10.1234/other", title: "Other" }, { DOI: doi, title: "<script>text</script>" }, { DOI: doi, title: "x".repeat(16001) }]) expect(() => parseCitationMetadata(value, doi)).toThrow(/元信息|DOI|过长/);
  });
  it("requests standard CSL JSON from a fixed DOI resolver without a local library", async () => {
    const fixture = await source(response => { response.setHeader("Content-Type", "application/vnd.citationstyles.csl+json; charset=utf-8"); response.end(JSON.stringify(record)); });
    expect((await fetchCitationMetadata("https://doi.org/10.1234/lunar(2026)", fixture.request)).title).toBe("Observation age & control");
    expect(fixture.calls).toEqual([{ url: "https://doi.org/10.1234%2Flunar(2026)", headers: { Accept: "application/vnd.citationstyles.csl+json" } }]);
  });
  it("reports missing publications and rate limits without returning invented fields", async () => {
    for (const [status, message] of [[404, /未找到/], [429, /频繁|稍后/], [503, /暂时|服务/]] as const) {
      const fixture = await source(response => { response.writeHead(status); response.end(); });
      await expect(fetchCitationMetadata(doi, fixture.request)).rejects.toThrow(message);
    }
  });
  it("rejects HTML, malformed JSON, compressed and oversized responses", async () => {
    for (const [headers, body] of [
      [{ "Content-Type": "text/html" }, "<h1>Paper</h1>"],
      [{ "Content-Type": "application/json" }, "not json"],
      [{ "Content-Type": "application/json", "Content-Encoding": "gzip" }, "bad"],
      [{ "Content-Type": "application/json" }, "x".repeat(1_048_577)],
    ] as const) {
      const fixture = await source(response => { response.writeHead(200, headers); response.end(body); });
      await expect(fetchCitationMetadata(doi, fixture.request)).rejects.toThrow(/元信息|大小/);
    }
  });
  it("validates before networking and supports cancellation during the response", async () => {
    const fixture = await source(response => { response.writeHead(200, { "Content-Type": "application/json" }); response.write('{"DOI":'); });
    await expect(fetchCitationMetadata("https://127.0.0.1/secret", fixture.request)).rejects.toThrow(/DOI/);
    expect(fixture.calls).toHaveLength(0);
    const abort = new AbortController();
    const pending = fetchCitationMetadata(doi, fixture.request, abort.signal);
    setTimeout(() => abort.abort(), 30);
    await expect(pending).rejects.toThrow();
  });
});
