import { describe, expect, it } from "vitest";
import {
  DATASET_MAX_CELLS, DATASET_MAX_CHARACTERS, DATASET_MAX_ROWS,
  datasetChartSeries, datasetText, normalizeDatasetBlock, parseDatasetText,
  serializeDatasetCsv, serializeDatasetMarkdown, spreadsheetToDataset, validateDatasetArchive,
} from "./researchDataset.ts";

describe("research dataset text and stored data", () => {
  it("parses BOM, quoted delimiters, escaped quotes, multiline values and CRLF", () => {
    const data = parseDatasetText('\uFEFFtime,label,value\r\n0,"a,b",1\r\n1,"two\r\nlines ""quoted""",2\r\n');
    expect(data).toEqual({ columns: ["time", "label", "value"], rows: [["0", "a,b", "1"], ["1", 'two\r\nlines "quoted"', "2"]] });
    expect(parseDatasetText(serializeDatasetCsv(data))).toEqual(data);
  });
  it("detects TSV, pads short rows and preserves interior blank records", () => {
    expect(parseDatasetText("x\ty\n0\t1\n\n2\n")).toEqual({ columns: ["x", "y"], rows: [["0", "1"], ["", ""], ["2", ""]] });
    expect(parseDatasetText("\n\t\n")).toEqual({ columns: [], rows: [] });
  });
  it.each([";", "\t"])("preserves single-column CSV edits containing %j", delimiter => {
    const data = { columns: [`time${delimiter}seconds`], rows: [["1"], [`2${delimiter}3`]] };
    expect(parseDatasetText(serializeDatasetCsv(data))).toEqual(data);
  });
  it("rejects incomplete or ambiguous quoting and excess columns", () => {
    for (const source of ['x,y\n0,"unfinished', 'x,y\n0,a"b', 'x,y\n0,"a"oops', "x,y\n0,1,2"]) expect(() => parseDatasetText(source)).toThrow();
  });
  it("allows blank blocks and validates sources and chart settings without changing values", () => {
    expect(normalizeDatasetBlock({ id: "d", type: "dataset", columns: [], rows: [] })).toEqual({ id: "d", type: "dataset", columns: [], rows: [] });
    const data = { id: "d", type: "dataset", title: "观测", columns: ["t", "y"], rows: [["0", "2"]], source: { type: "asset", assetId: "a".repeat(64) }, sourceName: "观测.xlsx", sheetName: "观测", chart: { kind: "scatter", x: 0, ys: [1] } };
    expect(normalizeDatasetBlock(data)).toEqual(data);
    for (const patch of [{ columns: ["x", 2] }, { rows: [["1", "2", "3"]] }, { chart: { kind: "line", x: 9, ys: [1] } }, { chart: { kind: "scatter", x: 0, ys: [1, 1] } }, { source: { type: "url", url: "javascript:alert(1)" } }, { title: 7 }]) expect(() => normalizeDatasetBlock({ ...data, ...patch })).toThrow();
  });
  it("bounds rows, cell counts and combined string sizes before rendering", () => {
    expect(() => parseDatasetText("x\n" + "1\n".repeat(DATASET_MAX_ROWS + 1))).toThrow(/行/);
    expect(() => normalizeDatasetBlock({ id: "d", type: "dataset", columns: Array(50).fill("x"), rows: Array(DATASET_MAX_CELLS / 50 + 1).fill(Array(50).fill("1")) })).toThrow(/单元格/);
    expect(() => parseDatasetText("x\n" + "1".repeat(DATASET_MAX_CHARACTERS))).toThrow();
  });
  it("converts actual spreadsheet dates, numbers and blanks without running formulas", () => {
    expect(spreadsheetToDataset([["日期", "值", "说明"], [new Date("2026-01-02T00:00:00.000Z"), 2.5, null], [null, true, "=SUM(A1:A2)"]])).toEqual({ columns: ["日期", "值", "说明"], rows: [["2026-01-02", "2.5", ""], ["", "true", "=SUM(A1:A2)"]] });
    expect(() => spreadsheetToDataset([["x"], [Infinity]])).toThrow();
  });
  it("exports bounded CSV and safe Markdown with the original and chart settings", () => {
    const block = normalizeDatasetBlock({ id: "d", type: "dataset", title: "实测", columns: ["t", "y"], rows: [["0", "```"], ["1", "2"]], source: { type: "asset", assetId: "a".repeat(64) }, chart: { kind: "line", x: 0, ys: [1] } });
    const markdown = serializeDatasetMarkdown(block);
    expect(markdown).toContain("webbench-asset:" + "a".repeat(64));
    expect(markdown).toContain("~~~csv");
    expect(markdown).toContain("折线图");
    expect(datasetText(block)).toContain("实测");
  });
});

describe("dataset chart points", () => {
  it("uses only finite numeric values and keeps missing rows as line gaps", () => {
    const data = normalizeDatasetBlock({ id: "d", type: "dataset", columns: ["t", "y"], rows: [["0", "2"], ["1", ""], ["2", "3"], ["3", "Infinity"], ["4", "0x10"]], chart: { kind: "line", x: 0, ys: [1] } });
    const chart = datasetChartSeries(data);
    expect(chart.series[0].points).toEqual([{ x: 0, y: 2, row: 0, label: "0" }, { x: 2, y: 3, row: 2, label: "2" }]);
    expect(chart.series[0].skipped).toBe(3);
    expect(chart.numericX).toBe(true);
  });
  it("supports categorical bar/line axes while scatter requires numeric x", () => {
    const data = normalizeDatasetBlock({ id: "d", type: "dataset", columns: ["组", "y"], rows: [["甲", "2"], ["乙", "4"]], chart: { kind: "bar", x: 0, ys: [1] } });
    expect(datasetChartSeries(data).series[0].points.map(point => point.x)).toEqual([0, 1]);
    expect(datasetChartSeries({ ...data, chart: { kind: "scatter", x: 0, ys: [1] } }).series[0].points).toEqual([]);
  });
  it("does not turn a partly invalid numeric time axis into row indices", () => {
    const data = normalizeDatasetBlock({ id: "d", type: "dataset", columns: ["t", "y"], rows: [["0", "2"], ["bad", "4"], ["10", "8"]], chart: { kind: "line", x: 0, ys: [1] } });
    expect(datasetChartSeries(data).series[0].points.map(point => point.x)).toEqual([0, 10]);
  });
});

describe("spreadsheet archive bounds", () => {
  it("rejects non-ZIP and archives that declare unsafe expanded contents", () => {
    expect(() => validateDatasetArchive(new ArrayBuffer(10))).toThrow(/Excel/);
    const bytes = new Uint8Array(22 + 46 + 1);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true); view.setUint32(24, 40_000_000, true); view.setUint16(28, 1, true); bytes[46] = 120;
    view.setUint32(47, 0x06054b50, true); view.setUint16(47 + 10, 1, true); view.setUint32(47 + 12, 47, true);
    expect(() => validateDatasetArchive(bytes.buffer)).toThrow(/展开|Excel/);
  });
});
