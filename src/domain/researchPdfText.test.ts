import { describe, expect, it } from "vitest";
import { findPdfText, indexPdfText } from "./researchPdfText.ts";

describe("PDF searchable text", () => {
  it("matches a phrase across real line endings and highlights both text items", () => {
    const index = indexPdfText([{ str: "Lunar", hasEOL: true }, { str: "observation" }]);
    expect(index.text).toBe("lunar observation");
    const matches = findPdfText(index, "Lunar  observation");
    expect(matches).toEqual([{ start: 0, end: 17 }]);
    expect(index.spans.filter(span => matches.some(match => match.start < span.end && match.end > span.start))).toHaveLength(2);
    expect(findPdfText(index, "Lunarobservation")).toEqual([]);
  });
  it("preserves word fragments and caps matches while ignoring marked content", () => {
    const index = indexPdfText([{ type: "beginMarkedContent" }, { str: "Adop" }, { str: "tion\t age " }, { str: "age" }]);
    expect(findPdfText(index, "adoption age")).toEqual([{ start: 0, end: 12 }]);
    expect(findPdfText(index, "age", 1)).toHaveLength(1);
    expect(index.spans).toHaveLength(3);
    expect(findPdfText(index, " ")).toEqual([]);
  });
});
