import { mediaAssetIdPattern, normalizeMediaUrl, type ResearchMediaSource } from "./researchMedia.ts";

export * from "./researchDatasetValues.ts";
import { checkedString, checkedValues, type DatasetValues } from "./researchDatasetValues.ts";

export interface DatasetChart { kind: "line" | "scatter" | "bar"; x: number; ys: number[] }
export interface ResearchDatasetBlock extends DatasetValues {
  id: string;
  type: "dataset";
  title?: string;
  source?: ResearchMediaSource;
  sourceName?: string;
  sheetName?: string;
  chart?: DatasetChart;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("数据内容无效。");
  return value as Record<string, unknown>;
}
export function normalizeDatasetBlock(value: unknown): ResearchDatasetBlock {
  const block = object(value);
  if (block.type !== "dataset" || typeof block.id !== "string" || !block.id) throw new Error("数据内容标识无效。");
  const data = checkedValues(block.columns, block.rows);
  let source: ResearchMediaSource | undefined;
  if (block.source !== undefined) {
    const input = object(block.source);
    if (input.type === "asset" && typeof input.assetId === "string" && mediaAssetIdPattern.test(input.assetId)) source = { type: "asset", assetId: input.assetId };
    else if (input.type === "url" && typeof input.url === "string") source = { type: "url", url: normalizeMediaUrl(input.url) };
    else throw new Error("数据原件引用无效。");
  }
  let chart: DatasetChart | undefined;
  if (block.chart !== undefined) {
    const input = object(block.chart);
    const index = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < data.columns.length;
    if (!["line", "scatter", "bar"].includes(String(input.kind)) || !index(input.x) || !Array.isArray(input.ys) || !input.ys.length || input.ys.length > 10 || !input.ys.every(index) || new Set(input.ys).size !== input.ys.length) throw new Error("图表列或类型无效，请重新选择数据列。");
    chart = { kind: input.kind as DatasetChart["kind"], x: input.x, ys: [...input.ys] };
  }
  return { id: block.id, type: "dataset", ...data,
    ...(block.title !== undefined ? { title: checkedString(block.title, 2000, "数据标题") } : {}),
    ...(block.sourceName !== undefined ? { sourceName: checkedString(block.sourceName, 2000, "原件名称") } : {}),
    ...(block.sheetName !== undefined ? { sheetName: checkedString(block.sheetName, 2000, "工作表名称") } : {}),
    ...(source ? { source } : {}), ...(chart ? { chart } : {}),
  };
}

export function serializeDatasetCsv(data: DatasetValues): string {
  const valid = checkedValues(data.columns, data.rows);
  const quote = (value: string) => /[",;\t\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  return valid.columns.length ? [valid.columns, ...valid.rows].map(row => row.map(quote).join(",")).join("\r\n") : "";
}
export function datasetText(block: ResearchDatasetBlock): string {
  return [block.title, block.sourceName, block.sheetName, block.source?.type === "asset" ? `webbench-asset:${block.source.assetId}` : block.source?.url, ...block.columns, ...block.rows.map(row => row.join(" "))].filter(Boolean).join("\n");
}
export function serializeDatasetMarkdown(value: ResearchDatasetBlock): string {
  const block = normalizeDatasetBlock(value);
  const csv = serializeDatasetCsv(block);
  let longestFence = 0;
  for (const match of csv.matchAll(/~+/g)) longestFence = Math.max(longestFence, match[0].length);
  const fence = "~".repeat(Math.max(3, longestFence + 1));
  const escaped = (text: string) => text.replace(/[\\[\]*_]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const source = block.source?.type === "asset" ? `webbench-asset:${block.source.assetId}` : block.source?.url;
  const result = [block.title ? `**${escaped(block.title)}**` : "", csv ? `${fence}csv\n${csv}\n${fence}` : "数据待导入", block.chart ? `图表：${{ line: "折线图", scatter: "散点图", bar: "柱状图" }[block.chart.kind]}；X：${escaped(block.columns[block.chart.x])}；Y：${block.chart.ys.map(index => escaped(block.columns[index])).join("、")}` : "", source ? `[${escaped(block.sourceName || "数据原件")}](${source.replaceAll("(", "%28").replaceAll(")", "%29")})` : ""].filter(Boolean).join("\n\n");
  if (result.length > 5_000_000) throw new Error("数据 Markdown 超过导出限制，请使用含附件备份保留原件。");
  return result;
}

export function datasetNumber(value: string): number | undefined {
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}
export function defaultDatasetChart(data: DatasetValues): DatasetChart | undefined {
  if (!data.columns.length || !data.rows.length) return;
  const candidates = data.columns.map((_, index) => index).filter(index => index !== 0 && data.rows.some(row => datasetNumber(row[index]) !== undefined));
  const ys = candidates.length ? candidates.slice(0, 3) : data.rows.some(row => datasetNumber(row[0]) !== undefined) ? [0] : [];
  return ys.length ? { kind: "line", x: 0, ys } : undefined;
}
export interface DatasetPoint { x: number; y: number; row: number; label: string }
export function datasetChartSeries(block: ResearchDatasetBlock): { numericX: boolean; chart?: DatasetChart; series: { column: number; label: string; points: DatasetPoint[]; skipped: number }[] } {
  const chart = block.chart ?? defaultDatasetChart(block);
  if (!chart) return { numericX: false, series: [] };
  const numericX = chart.kind === "scatter" || chart.kind !== "bar" && block.rows.some(row => datasetNumber(row[chart.x] ?? "") !== undefined);
  return { chart, numericX, series: chart.ys.map(column => {
    const points: DatasetPoint[] = [];
    for (const [index, row] of block.rows.entries()) {
      const y = datasetNumber(row[column] ?? "");
      const x = numericX ? datasetNumber(row[chart.x] ?? "") : index;
      if (x !== undefined && y !== undefined) points.push({ x, y, row: index, label: row[chart.x] ?? "" });
    }
    return { column, label: block.columns[column], points, skipped: block.rows.length - points.length };
  }) };
}
