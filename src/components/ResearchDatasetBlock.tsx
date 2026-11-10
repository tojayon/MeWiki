import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Pencil, RefreshCw, Settings2, Upload, X } from "lucide-react";
import { DATASET_MAX_CHARACTERS, DATASET_MAX_FILE_BYTES, datasetChartSeries, defaultDatasetChart, parseDatasetText, serializeDatasetCsv, type DatasetChart, type ResearchDatasetBlock as DatasetBlock } from "../domain/researchDataset.ts";
import type { DatasetImportResult, DatasetWorkerResult } from "../domain/researchDatasetImport.ts";
import { researchMediaClient } from "../state/researchMediaClient.ts";
import { browserMediaStore } from "../state/researchMediaStorage.ts";
import { refreshResearchMediaAsset, useResearchMediaSource } from "./useResearchMediaSource.ts";
import "./ResearchDatasetBlock.css";

const colors = ["#1547c0", "#d1522a", "#398356", "#8a4fa0", "#b17a15", "#227b90", "#bf4669", "#606c2f", "#685aaa", "#7b503a"];
const PAGE_ROWS = 20;
const formatNumber = (value: number) => value !== 0 && (Math.abs(value) >= 1_000_000 || Math.abs(value) < 0.001) ? value.toExponential(2) : Number(value.toPrecision(4)).toString();
const sourceKey = (block: DatasetBlock) => JSON.stringify(block.source ?? null);
const contentKey = (block: DatasetBlock) => JSON.stringify([block.columns, block.rows, block.source]);
const filename = (title: string, extension: string) => Array.from(title || t("研究数据"), character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? "_" : character).join("").slice(0, 100) + extension;
function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function parseFile(file: File, signal: AbortSignal): Promise<DatasetImportResult> {
  if (!file.size || file.size > DATASET_MAX_FILE_BYTES) throw new Error("数据预览支持不超过 10 MB 的文件；更大的原件请使用附件内容块。");
  const buffer = await file.arrayBuffer();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./researchDataset.worker.ts", import.meta.url), { type: "module" });
    const finish = (result?: DatasetImportResult, error?: unknown) => {
      clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException(t("导入已取消"), "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error("数据读取超时，请缩减数据或将原件作为附件保存。")), 30_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<DatasetWorkerResult>) => "result" in event.data ? finish(event.data.result) : finish(undefined, new Error(event.data.error));
    worker.onerror = event => { event.preventDefault(); finish(undefined, new Error("数据读取失败，请检查文件格式后重试。")); };
    worker.postMessage({ buffer, name: file.name }, [buffer]);
  });
}

async function fetchOriginal(url: string, name: string, signal: AbortSignal): Promise<File> {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok || !response.body) throw new Error("数据原件未能读取，请重新选择文件。");
  if (Number(response.headers.get("content-length")) > DATASET_MAX_FILE_BYTES) { await response.body.cancel(); throw new Error("数据预览仅支持不超过 10 MB 的文件。"); }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > DATASET_MAX_FILE_BYTES) throw new Error("数据原件超过 10 MB，请另存较小的工作簿后导入。");
      chunks.push(new Uint8Array(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return new File(chunks, name, { type: response.headers.get("content-type") ?? "application/octet-stream" });
}

/** Rescale before subtraction so extreme but finite research values cannot overflow an axis. */
function axis(values: number[], start: number, end: number, zero = false) {
  let min = zero ? 0 : Infinity, max = zero ? 0 : -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  const magnitude = Math.max(Math.abs(min), Math.abs(max)) || 1;
  let low = min / magnitude, high = max / magnitude;
  const padding = (high - low || Math.abs(low) * 0.1 || 1) * 0.06;
  low = Math.max(-Number.MAX_VALUE / magnitude, low - padding);
  high = Math.min(Number.MAX_VALUE / magnitude, high + padding);
  return {
    at: (value: number) => start + (value / magnitude - low) / (high - low) * (end - start),
    ticks: Array.from({ length: 6 }, (_, index) => {
      const fraction = index / 5;
      return { at: start + fraction * (end - start), value: Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, ((1 - fraction) * low + fraction * high) * magnitude)) };
    }),
  };
}

function DatasetChartView({ block, svgRef }: { block: DatasetBlock; svgRef: React.RefObject<SVGSVGElement | null> }) {
  useLocale();
  const result = useMemo(() => datasetChartSeries(block), [block]);
  const { chart, series, numericX } = result;
  const count = series.reduce((sum, item) => sum + item.points.length, 0);
  if (!chart || !count) return <p className="research-dataset-empty">{block.rows.length ? t("当前列没有可绘制的数值，请在图表设置中选择数据列。散点图的横轴也需要数值。") : t("添加数据后即可生成图表。")}</p>;
  const width = 760, height = 380 + Math.ceil(series.length / 3) * 19, top = 24 + Math.ceil(series.length / 3) * 19, left = 74, right = width - 24, bottom = height - 56;
  const xs = axis(series.flatMap(item => item.points.map(point => point.x)), left, right);
  const ys = axis(series.flatMap(item => item.points.map(point => point.y)), bottom, top, chart.kind === "bar");
  const skipped = series.reduce((sum, item) => sum + item.skipped, 0);
  const pointPath = (x: number, y: number) => `M${(x - 2).toFixed(2)},${y.toFixed(2)}a2,2 0 1,0 4,0a2,2 0 1,0 -4,0`;
  const labelX = (value: number) => numericX ? formatNumber(value) : block.rows[Math.max(0, Math.min(block.rows.length - 1, Math.round(value)))]?.[chart.x] ?? "";
  return <>
    <div className="research-dataset-chart-scroll"><svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="research-dataset-chart" role="img" aria-label={t("数据图表")} xmlns="http://www.w3.org/2000/svg" style={{ background: "#ffffff", color: "#152944", fontFamily: "Arial, 'Microsoft YaHei', sans-serif", fontSize: 12 }}>
      <title>{block.title || t("数据图表")}</title>
      <rect width={width} height={height} fill="#fff" />
      {series.map((item, index) => <g key={item.column}><line x1={left + index % 3 * 220} x2={left + index % 3 * 220 + 18} y1={16 + Math.floor(index / 3) * 19} y2={16 + Math.floor(index / 3) * 19} stroke={colors[index % colors.length]} strokeWidth={3} /><text x={left + index % 3 * 220 + 24} y={20 + Math.floor(index / 3) * 19} fill="#152944">{item.label.slice(0, 22)}<title>{item.label}</title></text></g>)}
      {ys.ticks.map((tick, index) => <g key={`y${index}`}><line x1={left} x2={right} y1={tick.at} y2={tick.at} stroke="#dde5ef" /><text x={left - 8} y={tick.at + 4} textAnchor="end" fill="#4a5d74">{formatNumber(tick.value)}</text></g>)}
      {xs.ticks.map((tick, index) => <g key={`x${index}`}><line x1={tick.at} x2={tick.at} y1={top} y2={bottom} stroke="#eef2f7" /><text x={tick.at} y={bottom + 21} textAnchor="middle" fill="#4a5d74">{labelX(tick.value).slice(0, 14)}<title>{labelX(tick.value)}</title></text></g>)}
      <path d={`M${left},${top}V${bottom}H${right}`} fill="none" stroke="#526780" />
      {series.map((item, index) => {
        const color = colors[index % colors.length];
        let previousRow = -2;
        const path = item.points.map(point => {
          const x = xs.at(point.x), y = ys.at(point.y);
          if (chart.kind === "scatter") return pointPath(x, y);
          if (chart.kind === "bar") {
            const slot = (right - left) / Math.max(1, block.rows.length + 1), barWidth = Math.max(0.4, Math.min(48, slot * 0.8 / series.length));
            const x1 = x + (index - series.length / 2) * barWidth, x2 = x1 + barWidth;
            return `M${x1.toFixed(2)},${ys.at(0).toFixed(2)}V${y.toFixed(2)}H${x2.toFixed(2)}V${ys.at(0).toFixed(2)}Z`;
          }
          const command = point.row === previousRow + 1 ? "L" : "M";
          previousRow = point.row;
          return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
        }).join("");
        return <g key={item.column}><path data-dataset-series={item.column} d={path} fill={chart.kind === "line" ? "none" : color} stroke={chart.kind === "line" ? color : "none"} strokeWidth={2}><title>{item.label} · {item.points.length.toLocaleString()}  {t("个点")}</title></path>{chart.kind === "line" && <path d={item.points.map(point => pointPath(xs.at(point.x), ys.at(point.y))).join("")} fill={color} />}</g>;
      })}
      <text x={(left + right) / 2} y={height - 12} textAnchor="middle" fill="#152944">{block.columns[chart.x].slice(0, 50)}<title>{block.columns[chart.x]}</title></text>
    </svg></div>
    {skipped > 0 && <p className="research-dataset-status" role="status">{t("已跳过")} {skipped.toLocaleString()}  {t("个空值或非数值项；折线在缺失处断开。")}</p>}
  </>;
}

export default function ResearchDatasetBlock({ block, readOnly = false, onPatch }: { block: DatasetBlock; readOnly?: boolean; onPatch: (patch: Partial<DatasetBlock>) => void }) {
  useLocale();
  const view = useResearchMediaSource(block.source);
  const key = contentKey(block), originalKey = sourceKey(block);
  const [editing, setEditing] = useState(false), [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState({ key, value: serializeDatasetCsv(block) });
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string>();
  const [page, setPage] = useState(0);
  const [cache, setCache] = useState<{ source: string; data: DatasetImportResult }>();
  const inputRef = useRef<HTMLInputElement>(null), svgRef = useRef<SVGSVGElement>(null);
  const operation = useRef<{ token: number; abort?: AbortController }>({ token: 0 });
  const blocked = view.busy || view.status === "loading";
  const canEdit = !readOnly && !blocked;
  const contextKey = JSON.stringify([block.id, key, view.directory, readOnly, blocked]);
  const latest = useRef({ block, readOnly, blocked, directory: view.directory });
  useLayoutEffect(() => { latest.current = { block, readOnly, blocked, directory: view.directory }; }, [block, readOnly, blocked, view.directory]);
  useEffect(() => {
    const current = operation.current;
    const cancel = () => { current.token++; current.abort?.abort(); current.abort = undefined; };
    cancel(); return cancel;
  }, [block.id, key, view.directory, readOnly, blocked]);
  const loading = pending === contextKey;
  const text = draft.key === key ? draft.value : serializeDatasetCsv(block);
  const chart = block.chart ?? defaultDatasetChart(block);
  const pages = Math.max(1, Math.ceil(block.rows.length / PAGE_ROWS)), currentPage = Math.min(page, pages - 1);
  const workbook = cache?.source === originalKey ? cache.data : undefined;
  const updateChart = (patch: Partial<DatasetChart>) => {
    if (!canEdit || !block.columns.length) return;
    onPatch({ chart: { kind: "line", x: 0, ys: [Math.min(1, block.columns.length - 1)], ...chart, ...patch } });
  };
  const applyText = () => {
    if (!canEdit || loading) return;
    try {
      const data = parseDatasetText(text);
      onPatch({ ...data, chart: defaultDatasetChart(data) }); setEditing(false); setPage(0); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "数据格式无效。"); }
  };
  const readFile = async (file: File | undefined, reload = false) => {
    if (!canEdit || loading || (!file && !reload)) return;
    const currentOperation = operation.current;
    currentOperation.abort?.abort();
    const controller = new AbortController(), token = ++currentOperation.token;
    currentOperation.abort = controller;
    const original = block, directory = view.directory;
    const current = () => !controller.signal.aborted && token === currentOperation.token && !latest.current.readOnly && !latest.current.blocked && latest.current.block.id === original.id && latest.current.directory === directory && contentKey(latest.current.block) === key;
    setPending(contextKey); setError("");
    try {
      const input = file ?? await fetchOriginal(view.originalUrl!, block.sourceName || view.asset?.name || t("数据.xlsx"), controller.signal);
      const result = await parseFile(input, controller.signal);
      if (!current()) return;
      if (reload) { setCache({ source: originalKey, data: result }); return; }
      const first = result.sheets.find(sheet => sheet.columns.length) ?? result.sheets[0];
      if (!first || !first.columns.length) throw new Error("文件中没有可导入的数据，请至少提供一行列名。");
      const asset = directory ? await researchMediaClient.upload(directory, input, undefined, controller.signal) : await browserMediaStore.put(input, undefined, controller.signal);
      if (!current()) return;
      const source = { type: "asset" as const, assetId: asset.id };
      refreshResearchMediaAsset(directory, asset.id);
      setCache({ source: JSON.stringify(source), data: result });
      onPatch({ columns: first.columns, rows: first.rows, source, sourceName: input.name, sheetName: first.name || undefined, chart: defaultDatasetChart(first), ...(latest.current.block.title === original.title && !original.title ? { title: input.name.replace(/\.[^.]+$/, "") } : {}) });
      setEditing(false); setPage(0);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "文件读取失败，原数据已保留。"); }
    finally { if (token === currentOperation.token) { currentOperation.abort = undefined; setPending(undefined); } }
  };
  const selectSheet = (name: string) => {
    if (!canEdit || !workbook || loading) return;
    const sheet = workbook.sheets.find(item => item.name === name);
    if (sheet) { onPatch({ columns: sheet.columns, rows: sheet.rows, sheetName: sheet.name || undefined, chart: defaultDatasetChart(sheet) }); setPage(0); setError(""); }
  };
  const exportCsv = () => {
    try { downloadFile(new Blob(["\uFEFF", serializeDatasetCsv(block)], { type: "text/csv;charset=utf-8" }), filename(block.title || t("研究数据"), ".csv")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "数据导出失败。"); }
  };
  return <div className="research-dataset-block" aria-busy={loading}>
    <div className="research-dataset-toolbar">
      <FileSpreadsheet size={17} aria-hidden="true" />
      {canEdit ? <input className="research-dataset-title" aria-label={t("数据标题")} placeholder={t("数据与图表")} maxLength={2000} value={block.title ?? ""} onChange={event => onPatch({ title: event.target.value })} /> : <strong>{block.title || t("数据与图表")}</strong>}
      <span className="research-dataset-tools">
        {canEdit && <><input ref={inputRef} type="file" hidden aria-label={t("选择数据文件")} accept=".csv,.tsv,.txt,.xlsx" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void readFile(file); }} /><button type="button" data-ui="icon-action" aria-label={t("导入数据文件")} title={t("导入 CSV、TSV 或 Excel .xlsx；最多 10 MB、10,000 行、50 列、200,000 个单元格")} disabled={loading} onClick={() => inputRef.current?.click()}><Upload size={15} /></button><button type="button" data-ui="icon-action" aria-label={t("编辑数据")} title={t("编辑或粘贴 CSV 数据；第一行为列名")} aria-expanded={editing || !block.columns.length} disabled={loading} onClick={() => setEditing(value => !value)}><Pencil size={15} /></button></>}
        {!!block.columns.length && <button type="button" data-ui="icon-action" aria-label={t("导出 CSV")} title={t("导出当前数据为 CSV")} onClick={exportCsv}><Download size={15} /></button>}
        {!!block.rows.length && <button type="button" data-ui="icon-action" aria-label={t("导出图表 SVG")} title={t("导出当前图表 SVG")} disabled={!chart} onClick={() => { if (svgRef.current) downloadFile(new Blob([new XMLSerializer().serializeToString(svgRef.current)], { type: "image/svg+xml;charset=utf-8" }), filename(block.title || t("研究图表"), ".svg")); }}><BarChart3 size={15} /></button>}
        {canEdit && !!block.columns.length && <button type="button" data-ui="icon-action" aria-label={t("图表设置")} title={t("选择图表类型、横轴和数据系列")} aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={15} /></button>}
      </span>
    </div>
    {loading && <div className="research-dataset-progress"><span role="status">{t("正在读取并保存数据…")}</span><button type="button" data-ui="icon-action" aria-label={t("取消数据导入")} title={t("取消导入，保留原数据")} onClick={() => { operation.current.token++; operation.current.abort?.abort(); operation.current.abort = undefined; setPending(undefined); }}><X size={14} /></button></div>}
    {error && <p role="alert" className="research-dataset-error">{localizeError(error)}</p>}
    {canEdit && (editing || !block.columns.length) && <div className="research-dataset-editor"><textarea aria-label={t("CSV 数据")} placeholder={t('时间,观测值\n0,1.2\n1,2.4')} rows={6} spellCheck={false} maxLength={DATASET_MAX_CHARACTERS} value={text} onChange={event => setDraft({ key, value: event.target.value })} /><div><button type="button" disabled={loading || !text.trim()} onClick={applyText}>{t("应用数据")}</button>{block.columns.length > 0 && <button type="button" onClick={() => { setDraft({ key, value: serializeDatasetCsv(block) }); setEditing(false); setError(""); }}>{t("取消")}</button>}</div></div>}
    {canEdit && workbook && workbook.sheets.length > 1 && <label className="research-dataset-sheet">{t("工作表")}<select aria-label={t("Excel 工作表")} disabled={loading} value={block.sheetName ?? ""} onChange={event => selectSheet(event.target.value)}>{workbook.sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name || t("数据")}</option>)}</select></label>}
    {canEdit && !workbook && /\.xlsx$/i.test(block.sourceName ?? "") && view.originalUrl && <button className="research-dataset-reload" type="button" aria-label={t("重新读取工作表")} title={t("从保留的 Excel 原件读取工作表列表；不更改当前数据")} disabled={loading} onClick={() => void readFile(undefined, true)}><RefreshCw size={13} />{t("选择其他工作表")}</button>}
    {canEdit && settings && !!block.columns.length && <div className="research-dataset-settings"><label>{t("图表类型")}<select aria-label={t("图表类型")} value={chart?.kind ?? "line"} onChange={event => { const next = { ...(chart ?? { x: 0, ys: [Math.min(1, block.columns.length - 1)] }), kind: event.target.value as DatasetChart["kind"] }; onPatch({ chart: next }); }}><option value="line">{t("折线图")}</option><option value="scatter">{t("散点图")}</option><option value="bar">{t("柱状图")}</option></select></label><label>{t("横轴")}<select aria-label={t("横轴列")} value={chart?.x ?? 0} onChange={event => updateChart({ x: Number(event.target.value) })}>{block.columns.map((column, index) => <option key={index} value={index}>{column || t`列 ${index + 1}`}</option>)}</select></label><fieldset><legend>{t("数据系列")}</legend>{block.columns.map((column, index) => <label key={index}><input type="checkbox" aria-label={t`数据系列 ${column || t`列 ${index + 1}`}`} checked={chart?.ys.includes(index) ?? false} disabled={chart?.ys.includes(index) ? chart.ys.length === 1 : (chart?.ys.length ?? 0) >= 10} onChange={event => { const ys = event.target.checked ? [...(chart?.ys ?? []), index] : (chart?.ys ?? []).filter(item => item !== index); if (ys.length) onPatch({ chart: { kind: chart?.kind ?? "line", x: chart?.x ?? 0, ys } }); }} />{column || t`列 ${index + 1}`}</label>)}</fieldset></div>}
    {!!block.columns.length && <>
      <DatasetChartView block={block} svgRef={svgRef} />
      <div className="research-dataset-table-scroll"><table aria-label={t("数据表预览")}><thead><tr><th scope="col">{t("行")}</th>{block.columns.map((column, index) => <th scope="col" key={index}>{column || t`列 ${index + 1}`}</th>)}</tr></thead><tbody>{block.rows.slice(currentPage * PAGE_ROWS, (currentPage + 1) * PAGE_ROWS).map((row, index) => <tr key={currentPage * PAGE_ROWS + index}><th scope="row">{currentPage * PAGE_ROWS + index + 1}</th>{row.map((cell, column) => <td key={column} title={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
      <div className="research-dataset-footer"><span>{block.rows.length.toLocaleString()}  {t("行 ·")} {block.columns.length}  {t("列")}{block.sheetName ? ` · ${block.sheetName}` : ""}</span>{pages > 1 && <span className="research-dataset-pages"><button type="button" data-ui="icon-action" aria-label={t("数据上一页")} title={t("上一页数据")} disabled={!currentPage} onClick={() => setPage(value => Math.max(0, value - 1))}><ChevronLeft size={14} /></button><span>{currentPage + 1} / {pages}</span><button type="button" data-ui="icon-action" aria-label={t("数据下一页")} title={t("下一页数据")} disabled={currentPage >= pages - 1} onClick={() => setPage(value => Math.min(pages - 1, value + 1))}><ChevronRight size={14} /></button></span>}{view.originalUrl && <a href={view.originalUrl} download={block.sourceName ?? view.asset?.name} title={t("下载导入时保存的数据原件")}>{block.sourceName || t("数据原件")}</a>}</div>
    </>}
  </div>;
}
