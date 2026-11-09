import { describe, expect, it } from "vitest";
import { diagramText, drawingSvg, mermaidSourceError, normalizeDiagramBlock, serializeDiagramMarkdown, type ResearchDiagramBlock } from "./researchDiagram.ts";

const drawing: ResearchDiagramBlock = { id: "figure", type: "diagram", title: "状态转移", mode: "drawing", code: "", strokes: [
  { id: "arrow", kind: "arrow", points: [{ x: 10, y: 20 }, { x: 150, y: 90 }], color: "#1457b0", width: 3 },
  { id: "text", kind: "text", points: [{ x: 20, y: 60 }], color: "#15243b", width: 2, text: "状态 <更新> & \"采纳\"" },
] };

describe("research diagrams", () => {
  it("retains the exact vector strokes and dormant Mermaid source in a drawing", () => {
    const value = { ...drawing, code: "flowchart LR\nA --> B" };
    expect(normalizeDiagramBlock(value)).toEqual(value);
    expect(diagramText(value)).toContain("状态 <更新>");
    expect(serializeDiagramMarkdown(value)).toContain("```svg");
  });
  it("exports escaped vector text and self-contained arrows without external resources", () => {
    const svg = drawingSvg(drawing.strokes, "图 <一>");
    expect(svg).toContain('viewBox="0 0 960 540"');
    expect(svg).toContain("状态 &lt;更新&gt; &amp; &quot;采纳&quot;");
    expect(svg).toContain("<polygon");
    expect(svg).not.toContain("href");
    expect(svg).toContain("图 &lt;一&gt;");
  });
  it("preserves invalid Mermaid drafts for correction and uses an unambiguous code fence", () => {
    const block: ResearchDiagramBlock = { id: "f", type: "diagram", mode: "mermaid", code: "flowchart LR\nA [bad\n```", strokes: [] };
    expect(normalizeDiagramBlock(block).code).toBe(block.code);
    expect(serializeDiagramMarkdown(block)).toContain("````mermaid");
    expect(diagramText(block)).toContain("A [bad");
  });
  it.each([null, [], {}, { ...drawing, mode: "iframe" }, { ...drawing, code: 3 }, { ...drawing, strokes: "bad" }])("rejects malformed stored drawings %#", value => {
    expect(() => normalizeDiagramBlock(value)).toThrow();
  });
  it.each([
    { ...drawing.strokes[0], points: [{ x: NaN, y: 2 }, { x: 5, y: 6 }] },
    { ...drawing.strokes[0], points: [{ x: 961, y: 2 }, { x: 5, y: 6 }] },
    { ...drawing.strokes[0], width: Infinity },
    { ...drawing.strokes[0], width: 20 },
    { ...drawing.strokes[0], color: 'url("https://example.com/a")' },
    { ...drawing.strokes[0], kind: "script" },
    { ...drawing.strokes[0], points: [{ x: 1, y: 2 }] },
    { ...drawing.strokes[1], text: undefined },
  ])("rejects unsafe geometry and styling %#", stroke => {
    expect(() => normalizeDiagramBlock({ ...drawing, strokes: [stroke] })).toThrow();
  });
  it("rejects duplicate stroke ids and oversized contents without truncating the original", () => {
    expect(() => normalizeDiagramBlock({ ...drawing, strokes: [drawing.strokes[0], drawing.strokes[0]] })).toThrow();
    expect(() => normalizeDiagramBlock({ ...drawing, code: "a".repeat(20_001) })).toThrow();
    expect(() => normalizeDiagramBlock({ ...drawing, strokes: Array.from({ length: 501 }, (_, i) => ({ ...drawing.strokes[0], id: String(i) })) })).toThrow();
  });
  it("bounds the per-stroke and total number of freehand points", () => {
    const pen = { id: "p", kind: "pen", color: "#123", width: 1, points: Array.from({ length: 4001 }, () => ({ x: 1, y: 2 })) };
    expect(() => normalizeDiagramBlock({ ...drawing, strokes: [pen] })).toThrow(/4,000/);
    const strokes = Array.from({ length: 13 }, (_, index) => ({ ...pen, id: String(index), points: pen.points.slice(0, 4000) }));
    expect(() => normalizeDiagramBlock({ ...drawing, strokes })).toThrow(/点数/);
  });
  it("exports a tap as a round dot and keeps multiline text inside tspan elements", () => {
    const strokes = [{ id: "p", kind: "pen" as const, color: "#123", width: 2, points: [{ x: 1, y: 2 }] }, { ...drawing.strokes[1], text: "第一行\n第二行" }];
    const svg = drawingSvg(strokes);
    expect(svg).toContain('<circle cx="1" cy="2" r="1"');
    expect(svg).toContain('dy="1.3em">第二行</tspan>');
  });
  it.each([
    "flowchart LR\nA[开始] --> B[完成]",
    "sequenceDiagram\nparticipant A\nparticipant B\nA->>B: 采样",
    "classDiagram\nclass Controller",
  ])("permits local flow, sequence and structure definitions", code => {
    expect(mermaidSourceError(code)).toBe("");
  });
  it.each([
    "%%{init: {securityLevel: 'loose'}}%%\nflowchart LR\nA --> B",
    "---\nconfig: {securityLevel: loose}\n---\nflowchart LR\nA --> B",
    'flowchart LR\nA-->B; click A "https://example.com"',
    'flowchart LR\nA@{ img: "https://example.com/a.png" }',
    'flowchart LR\nA["<img src=x onerror=alert(1)>"]',
    'flowchart LR\nA["![pic](//example.com/x)"]',
    'flowchart LR\nA["javascript:alert(1)"]',
    'flowchart LR\nA --> B\nclassDef remote fill:url(//example.com/pattern.svg)',
    'flowchart LR\nA --> B\nclassDef remote font-family:expression(alert(1))',
  ])("blocks diagram directives, interactive links and external images", code => {
    expect(mermaidSourceError(code)).not.toBe("");
  });
});
