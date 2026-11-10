import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowUpRight, Braces, Circle, Download, Minus, Pencil, Redo2, Settings2, Square, Type, Undo2 } from "lucide-react";
import { DRAWING_HEIGHT, DRAWING_WIDTH, MAX_DIAGRAM_CODE, MAX_DRAWING_STROKES, MAX_STROKE_POINTS, drawingSvg, mermaidSourceError, normalizeDiagramBlock, researchDiagramTemplates, type ResearchDiagramBlock as DiagramBlock, type ResearchDrawingPoint, type ResearchDrawingStroke, type ResearchDrawingTool } from "../domain/researchDiagram.ts";
import { useResearchLibrary } from "../state/useResearchNotebook.ts";
import { fitDiagramSvgViewport, sanitizeDiagramSvg } from "./researchDiagramSvg.ts";
import "./ResearchDiagramBlock.css";

let mermaidLoader: Promise<typeof import("mermaid")["default"]> | undefined;
function loadMermaid() {
  return mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, htmlLabels: false, fontFamily: "system-ui, sans-serif", theme: "base", flowchart: { htmlLabels: false, useMaxWidth: true }, sequence: { useMaxWidth: true }, themeVariables: { primaryColor: "#eef4fd", primaryTextColor: "#19314f", primaryBorderColor: "#7e9fc8", lineColor: "#41658d", secondaryColor: "#fff4e6", tertiaryColor: "#f4f7fc", fontFamily: "system-ui, sans-serif" } });
    return mermaid;
  }).catch(cause => { mermaidLoader = undefined; throw cause; });
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const filename = (title: string) => (title.trim() || t("绘图")).replace(/[<>:"/\\|?*]/g, "_").replace(/\p{Cc}/gu, "_").slice(0, 100);
function downloadSvg(svg: string, title: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `${filename(title)}.svg`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Stroke({ stroke }: { stroke: ResearchDrawingStroke }) {
  useLocale();
  const a = stroke.points[0], b = stroke.points[stroke.points.length - 1];
  const style = { stroke: stroke.color, strokeWidth: stroke.width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  if (stroke.kind === "text") return <text x={a.x} y={a.y} fill={stroke.color} fontSize={14 + stroke.width * 2} fontFamily="system-ui, sans-serif">{stroke.text?.split(/\r?\n/).map((line, index) => <tspan key={index} x={a.x} dy={index ? "1.3em" : "0"}>{line}</tspan>)}</text>;
  if (stroke.kind === "pen") return stroke.points.length === 1 ? <circle cx={a.x} cy={a.y} r={stroke.width / 2} fill={stroke.color} /> : <polyline points={stroke.points.map(point => `${point.x},${point.y}`).join(" ")} {...style} />;
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), width = Math.abs(b.x - a.x), height = Math.abs(b.y - a.y);
  if (stroke.kind === "rect") return <rect x={left} y={top} width={width} height={height} {...style} />;
  if (stroke.kind === "ellipse") return <ellipse cx={left + width / 2} cy={top + height / 2} rx={width / 2} ry={height / 2} {...style} />;
  const angle = Math.atan2(b.y - a.y, b.x - a.x), length = 9 + stroke.width * 2;
  const triangle = [b, { x: b.x - Math.cos(angle - Math.PI / 6) * length, y: b.y - Math.sin(angle - Math.PI / 6) * length }, { x: b.x - Math.cos(angle + Math.PI / 6) * length, y: b.y - Math.sin(angle + Math.PI / 6) * length }];
  return <><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...style} />{stroke.kind === "arrow" && <polygon points={triangle.map(point => `${point.x},${point.y}`).join(" ")} fill={stroke.color} />}</>;
}
const tools = [
  { kind: "pen", label: "自由笔", icon: Pencil }, { kind: "line", label: "直线", icon: Minus }, { kind: "arrow", label: "箭头", icon: ArrowUpRight },
  { kind: "rect", label: "矩形", icon: Square }, { kind: "ellipse", label: "椭圆", icon: Circle }, { kind: "text", label: "文字", icon: Type },
] as const;

export default function ResearchDiagramBlock({ block, readOnly = false, onPatch }: { block: DiagramBlock; readOnly?: boolean; onPatch: (patch: Partial<DiagramBlock>) => void }) {
  useLocale();
  const library = useResearchLibrary();
  const canEdit = !readOnly && !library.busy && library.status !== "loading";
  const [settings, setSettings] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [preview, setPreview] = useState<{ key: string; svg?: string; error?: string }>();
  const [tool, setTool] = useState<ResearchDrawingTool>("pen");
  const [color, setColor] = useState("#1754a1");
  const [width, setWidth] = useState(3);
  const [draft, setDraft] = useState<ResearchDrawingStroke>();
  const [textEntry, setTextEntry] = useState<{ at: ResearchDrawingPoint; value: string; source: string }>();
  const [drawingError, setDrawingError] = useState("");
  const [history, setHistory] = useState<{ key: string; redo: ResearchDrawingStroke[] }>({ key: "", redo: [] });
  const svgRef = useRef<SVGSVGElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ pointer: number; stroke: ResearchDrawingStroke; source: string } | undefined>(undefined);
  const latest = useRef({ block, canEdit, onPatch });
  const operation = useRef(0);
  const componentId = useId().replace(/[^a-z0-9]/gi, "");
  const previewKey = JSON.stringify([block.id, block.code]);
  const visiblePreview = preview?.key === previewKey ? preview : undefined;
  const sourceError = mermaidSourceError(block.code);
  const historyKey = useMemo(() => JSON.stringify(block.strokes), [block.strokes]);
  const contextKey = JSON.stringify([block.id, block.mode, canEdit, library.directory]);
  const [observedContext, setObservedContext] = useState(contextKey);
  if (observedContext !== contextKey) { setObservedContext(contextKey); setDraft(undefined); setTextEntry(undefined); }
  const redo = history.key === historyKey ? history.redo : [];
  useLayoutEffect(() => { latest.current = { block, canEdit, onPatch }; }, [block, canEdit, onPatch]);
  useLayoutEffect(() => {
    const container = previewRef.current;
    const svg = container?.querySelector("svg");
    if (!container || !svg) return;
    const fit = () => fitDiagramSvgViewport(svg);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [visiblePreview?.svg, block.mode, sourceError]);
  useEffect(() => {
    const token = ++operation.current;
    if (block.mode !== "mermaid" || sourceError || !block.code.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await loadMermaid();
          if (cancelled || token !== operation.current) return;
          const result = await mermaid.render(`research-diagram-${componentId}-${token}`, block.code);
          if (!cancelled && token === operation.current) setPreview({ key: previewKey, svg: sanitizeDiagramSvg(result.svg) });
        } catch (cause) {
          if (!cancelled && token === operation.current) {
            const detail = message(cause).replace(/<[^>]*>/g, "").slice(0, 650);
            setPreview({ key: previewKey, error: `流程图语法有误，请检查标注位置：\n${detail}` });
          }
        }
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [block.mode, block.code, block.id, componentId, previewKey, sourceError]);
  useEffect(() => () => { drawing.current = undefined; }, [block.id, block.mode, canEdit, library.directory]);

  const commit = (stroke: ResearchDrawingStroke) => {
    const current = latest.current;
    if (!current.canEdit || current.block.mode !== "drawing") return;
    try {
      const strokes = [...current.block.strokes, stroke];
      normalizeDiagramBlock({ ...current.block, strokes });
      setHistory({ key: JSON.stringify(strokes), redo: [] });
      current.onPatch({ strokes }); setDrawingError("");
    } catch (cause) { setDrawingError(message(cause)); }
  };
  const point = (event: PointerEvent<SVGSVGElement>): ResearchDrawingPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.round(Math.max(0, Math.min(DRAWING_WIDTH, (event.clientX - bounds.left) * DRAWING_WIDTH / bounds.width)) * 100) / 100, y: Math.round(Math.max(0, Math.min(DRAWING_HEIGHT, (event.clientY - bounds.top) * DRAWING_HEIGHT / bounds.height)) * 100) / 100 };
  };
  const begin = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEdit || event.button !== 0 || drawing.current) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
    const at = point(event);
    if (tool === "text") { setTextEntry({ at, value: "", source: historyKey }); return; }
    if (block.strokes.length >= MAX_DRAWING_STROKES) { setDrawingError("草图最多保存 500 笔，请分成多张绘图。"); return; }
    const stroke: ResearchDrawingStroke = { id: crypto.randomUUID(), kind: tool, points: tool === "pen" ? [at] : [at, at], color, width };
    drawing.current = { pointer: event.pointerId, stroke, source: historyKey }; setDraft(stroke);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const session = drawing.current;
    if (!session || session.pointer !== event.pointerId || !canEdit) return;
    event.preventDefault();
    const at = point(event), previous = session.stroke.points[session.stroke.points.length - 1];
    if (Math.hypot(previous.x - at.x, previous.y - at.y) < 1.2) return;
    if (session.stroke.kind === "pen") {
      if (session.stroke.points.length >= MAX_STROKE_POINTS) { setDrawingError("单笔点数已达上限，请抬起后继续绘制。"); return; }
      session.stroke = { ...session.stroke, points: [...session.stroke.points, at] };
    } else session.stroke = { ...session.stroke, points: [session.stroke.points[0], at] };
    setDraft(session.stroke);
  };
  const finish = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const session = drawing.current;
    if (!session || session.pointer !== event.pointerId) return;
    drawing.current = undefined; setDraft(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && session.source === JSON.stringify(latest.current.block.strokes)) commit(session.stroke);
  };
  const undo = () => {
    if (!canEdit || !block.strokes.length || drawing.current) return;
    const strokes = block.strokes.slice(0, -1);
    setHistory({ key: JSON.stringify(strokes), redo: [block.strokes[block.strokes.length - 1], ...redo] }); onPatch({ strokes });
  };
  const restore = () => {
    if (!canEdit || !redo.length || drawing.current) return;
    const strokes = [...block.strokes, redo[0]];
    setHistory({ key: JSON.stringify(strokes), redo: redo.slice(1) }); onPatch({ strokes });
  };
  const exportSvg = () => {
    if (block.mode === "drawing") downloadSvg(drawingSvg(block.strokes, block.title), block.title || t("草图"));
    else if (visiblePreview?.svg && !sourceError) {
      const svg = previewRef.current?.querySelector("svg");
      if (svg) downloadSvg(svg.outerHTML, block.title || t("流程图"));
    }
  };
  const changeMode = (mode: DiagramBlock["mode"]) => { drawing.current = undefined; setDraft(undefined); setTextEntry(undefined); onPatch({ mode }); };
  return <div className="research-diagram-block" data-diagram-mode={block.mode}>
    <div className="research-diagram-toolbar" role="toolbar" aria-label={t("绘图工具")}>
      {canEdit ? <div className="research-diagram-mode">
        <button type="button" aria-label={t("流程图模式")} title={t("通过 Mermaid 源码编辑流程、时序和结构图")} aria-pressed={block.mode === "mermaid"} onClick={() => changeMode("mermaid")}><Braces size={14} />{t("流程图")}</button>
        <button type="button" aria-label={t("手绘模式")} title={t("自由绘制、图形与文字；两种模式分别保留内容")} aria-pressed={block.mode === "drawing"} onClick={() => changeMode("drawing")}><Pencil size={14} />{t("草图")}</button>
      </div> : <strong>{block.title || (block.mode === "drawing" ? t("草图") : t("流程图"))}</strong>}
      <span className="research-diagram-toolbar-space" />
      {canEdit && block.mode === "mermaid" && <button type="button" data-ui="icon-action" aria-label={sourceOpen ? t("收起流程图源码") : t("编辑流程图源码")} title={t("显示或收起源码")} aria-expanded={sourceOpen} onClick={() => setSourceOpen(value => !value)}><Braces size={15} /></button>}
      <button type="button" data-ui="icon-action" aria-label={t("导出绘图 SVG")} title={t("导出可缩放的矢量图")} disabled={block.mode === "mermaid" && (!visiblePreview?.svg || Boolean(sourceError))} onClick={exportSvg}><Download size={15} /></button>
      {canEdit && <button type="button" data-ui="icon-action" aria-label={t("绘图设置")} title={t("编辑图名")} aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={15} /></button>}
    </div>
    {settings && canEdit && <label className="research-diagram-title">{t("图名")}<input aria-label={t("绘图名称")} maxLength={500} value={block.title ?? ""} onChange={event => onPatch({ title: event.target.value })} /></label>}
    {block.mode === "mermaid" ? <>
      {canEdit && sourceOpen && <div className="research-diagram-source">
        <div className="research-diagram-templates"><select aria-label={t("流程图模板")} title={t("选择模板替换当前源码")} value="" onChange={event => { const key = event.target.value as keyof typeof researchDiagramTemplates; if (researchDiagramTemplates[key]) onPatch({ code: researchDiagramTemplates[key].code }); }}><option value="" disabled>{t("选择模板…")}</option>{Object.entries(researchDiagramTemplates).map(([key, template]) => <option key={key} value={key}>{t(template.label)}</option>)}</select></div>
        <textarea aria-label={t("流程图源码")} spellCheck={false} maxLength={MAX_DIAGRAM_CODE} rows={6} value={block.code} placeholder={t("flowchart LR&#10;  A[开始] --> B[完成]")} onChange={event => onPatch({ code: event.target.value })} />
      </div>}
      {(sourceError || visiblePreview?.error) ? <pre className="research-diagram-error" role="alert">{sourceError || visiblePreview?.error}</pre> : visiblePreview?.svg ? <div ref={previewRef} className="research-diagram-preview" aria-label={block.title || t("流程图预览")} dangerouslySetInnerHTML={{ __html: visiblePreview.svg }} /> : <div className="research-diagram-placeholder" role="status">{block.code.trim() ? t("正在生成图形…") : t("填写源码或选择模板")}</div>}
    </> : <>
      {canEdit && <div className="research-drawing-tools" role="toolbar" aria-label={t("草图工具")}>
        {tools.map(item => <button type="button" key={item.kind} data-ui="icon-action" aria-label={t`草图${item.label}`} title={t(item.label)} aria-pressed={tool === item.kind} onClick={() => { setTool(item.kind); setTextEntry(undefined); }}><item.icon size={15} /></button>)}
        <input type="color" aria-label={t("草图颜色")} title={t("笔画颜色")} value={color} onChange={event => setColor(event.target.value)} />
        <select aria-label={t("草图线宽")} title={t("线宽")} value={width} onChange={event => setWidth(Number(event.target.value))}>{[1, 2, 3, 5, 8, 12, 16].map(value => <option key={value} value={value}>{value} px</option>)}</select>
        <span className="research-diagram-toolbar-space" />
        <button type="button" data-ui="icon-action" aria-label={t("撤销绘图")} title={t("撤销 · Ctrl/Cmd+Z")} disabled={!block.strokes.length} onClick={undo}><Undo2 size={15} /></button>
        <button type="button" data-ui="icon-action" aria-label={t("重做绘图")} title={t("重做 · Ctrl/Cmd+Shift+Z")} disabled={!redo.length} onClick={restore}><Redo2 size={15} /></button>
      </div>}
      <svg ref={svgRef} className="research-drawing-surface" data-editable={canEdit} viewBox={`0 0 ${DRAWING_WIDTH} ${DRAWING_HEIGHT}`} role="img" aria-label={block.title || t("草图画布")} tabIndex={canEdit ? 0 : undefined} onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => { if (!canEdit || !(event.ctrlKey || event.metaKey)) return; if (event.key.toLowerCase() === "z") { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) restore(); else undo(); } else if (event.key.toLowerCase() === "y") { event.preventDefault(); event.stopPropagation(); restore(); } }}>
        <title>{block.title || t("草图")}</title><rect width={DRAWING_WIDTH} height={DRAWING_HEIGHT} fill="#fff" />
        {block.strokes.map(stroke => <Stroke key={stroke.id} stroke={stroke} />)}{draft && canEdit && <Stroke stroke={draft} />}
      </svg>
      {canEdit && textEntry?.source === historyKey && <form className="research-drawing-text-entry" onSubmit={event => { event.preventDefault(); if (!textEntry.value.trim()) return; commit({ id: crypto.randomUUID(), kind: "text", points: [textEntry.at], color, width, text: textEntry.value }); setTextEntry(undefined); }}><input autoFocus aria-label={t("草图文字内容")} maxLength={2000} placeholder={t("输入文字…")} value={textEntry.value} onChange={event => setTextEntry({ ...textEntry, value: event.target.value })} /><button type="submit" disabled={!textEntry.value.trim()}>{t("添加文字")}</button><button type="button" onClick={() => setTextEntry(undefined)}>{t("取消")}</button></form>}
      {drawingError && <p className="research-diagram-error" role="alert">{localizeError(drawingError)}</p>}
    </>}
  </div>;
}
