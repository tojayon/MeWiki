import { describe, expect, it } from "vitest";
import { citationText, formatCitation, normalizeCitationBlock, normalizeCitationDoi, serializeCitationMarkdown } from "./researchCitation.ts";

describe("research literature citation cards", () => {
  it("retains citation fields, an associated PDF and its reading page", () => {
    const source = { type: "asset", assetId: "a".repeat(64) };
    expect(normalizeCitationBlock({ id: "citation", type: "citation", title: "示例观测", authors: "张三；李四", year: "2026", venue: "研究报告", doi: "https://doi.org/10.1234/example.2026", url: "https://example.com/paper", notes: "待核对第 3 页", pdf: source, pdfName: "报告.pdf", pdfPage: 3 })).toEqual({ id: "citation", type: "citation", title: "示例观测", authors: "张三；李四", year: "2026", venue: "研究报告", doi: "10.1234/example.2026", url: "https://example.com/paper", notes: "待核对第 3 页", pdf: source, pdfName: "报告.pdf", pdfPage: 3 });
  });
  it("accepts incomplete and intentionally empty citation fields", () => {
    expect(normalizeCitationBlock({ id: "empty", type: "citation" })).toEqual({ id: "empty", type: "citation" });
    expect(normalizeCitationBlock({ id: "clear", type: "citation", title: "", doi: "", url: "" })).toEqual({ id: "clear", type: "citation", title: "" });
  });
  it("normalizes bare DOI, doi prefixes and resolver links", () => {
    for (const value of ["10.1234/ABC(2026).001", " doi:10.1234/ABC(2026).001 ", "https://dx.doi.org/10.1234/ABC(2026).001"]) expect(normalizeCitationDoi(value)).toBe("10.1234/ABC(2026).001");
    for (const value of ["not a DOI", "10.12/example", "javascript:alert(1)", "10.1234/a b", "https://example.com/10.1234/a"]) expect(() => normalizeCitationDoi(value)).toThrow(/DOI/);
  });
  it("rejects malformed fields, active links and damaged PDF references", () => {
    for (const value of [null, [], {}, { id: "x", type: "bookmark" }, { id: "", type: "citation" }, { id: "x", type: "citation", authors: [] }, { id: "x", type: "citation", url: "javascript:alert(1)" }, { id: "x", type: "citation", url: "https://example-user:example-password@example.com" }, { id: "x", type: "citation", pdf: { type: "asset", assetId: "missing" } }, { id: "x", type: "citation", pdf: { type: "url", url: "file:///paper.pdf" } }, { id: "x", type: "citation", pdfPage: 0 }, { id: "x", type: "citation", pdfPage: 1.5 }, { id: "x", type: "citation", pdfPage: "2" }, { id: "x", type: "citation", title: "a".repeat(16_001) }]) expect(() => normalizeCitationBlock(value)).toThrow();
  });
  it("formats citations without inventing missing publication information", () => {
    expect(formatCitation({ id: "x", type: "citation", title: "Example report", authors: "A. Author; B. Author", year: "2026", venue: "Report series", doi: "10.1234/example" })).toBe("A. Author; B. Author (2026). Example report. Report series. https://doi.org/10.1234/example");
    expect(formatCitation({ id: "x", type: "citation", title: "Unpublished notes" })).toBe("Unpublished notes");
    expect(formatCitation({ id: "x", type: "citation" })).toBe("文献待填写");
  });
  it("exports readable citation, PDF page references and full search text", () => {
    const block = normalizeCitationBlock({ id: "x", type: "citation", title: "报告 [A]", authors: "张三", year: "2026", venue: "来源", doi: "10.1234/paper(2)", url: "https://example.com/source", notes: "阅读记录", pdf: { type: "asset", assetId: "b".repeat(64) }, pdfName: "报告 [A].pdf", pdfPage: 2 });
    const markdown = serializeCitationMarkdown(block);
    expect(markdown).toContain("张三 (2026)");
    expect(markdown).toContain("https://doi.org/10.1234/paper%282%29");
    expect(markdown).toContain(`webbench-asset:${"b".repeat(64)}#page=2`);
    expect(markdown).toContain("报告 \\[A\\].pdf");
    expect(markdown).toContain("https://example.com/source");
    expect(markdown).toContain("阅读记录");
    expect(citationText(block)).toContain("10.1234/paper(2)");
    expect(citationText(block)).toContain("张三");
    expect(citationText(block)).toContain("来源");
  });
});
