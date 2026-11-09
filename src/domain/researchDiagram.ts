export const DRAWING_WIDTH = 960;
export const DRAWING_HEIGHT = 540;
export const MAX_DIAGRAM_CODE = 20_000;
export const MAX_DRAWING_STROKES = 500;
export const MAX_STROKE_POINTS = 4000;
export const MAX_DRAWING_POINTS = 50_000;

export type ResearchDrawingTool = "pen" | "line" | "arrow" | "rect" | "ellipse" | "text";
export interface ResearchDrawingPoint { x: number; y: number }
export interface ResearchDrawingStroke {
  id: string;
  kind: ResearchDrawingTool;
  points: ResearchDrawingPoint[];
  color: string;
  width: number;
  text?: string;
}
export interface ResearchDiagramBlock {
  id: string;
  type: "diagram";
  title?: string;
  mode: "mermaid" | "drawing";
  code: string;
  strokes: ResearchDrawingStroke[];
}

export const researchDiagramTemplates = {
  flow: { label: "流程图", code: "flowchart LR\n  A[开始] --> B[处理]\n  B --> C{是否满足条件}\n  C -->|是| D[完成]\n  C -->|否| B" },
  sequence: { label: "时序图", code: "sequenceDiagram\n  participant S as 传感器\n  participant C as 控制器\n  participant A as 执行器\n  S->>C: 状态采样\n  C->>A: 控制指令\n  A-->>S: 系统响应" },
  structure: { label: "结构图", code: "classDiagram\n  class Sensor {\n    sample()\n  }\n  class Controller {\n    compute()\n  }\n  class Actuator {\n    apply()\n  }\n  Sensor --> Controller : 状态\n  Controller --> Actuator : 指令" },
} as const;

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function fail(message: string): never { throw new Error(message); }
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function normalizeDiagramBlock(value: unknown): ResearchDiagramBlock {
  const block = record(value);
  if (typeof block.id !== "string" || !block.id || block.type !== "diagram" || !["mermaid", "drawing"].includes(String(block.mode))) fail("绘图内容类型无效。");
  if (typeof block.code !== "string" || block.code.length > MAX_DIAGRAM_CODE) fail("流程图源码最多 20,000 字符。");
  if (block.title !== undefined && (typeof block.title !== "string" || block.title.length > 500)) fail("绘图标题最多 500 字符。");
  if (!Array.isArray(block.strokes) || block.strokes.length > MAX_DRAWING_STROKES) fail("草图最多保存 500 笔，请分成多张绘图。");
  const ids = new Set<string>();
  let total = 0;
  const strokes = block.strokes.map(value => {
    const stroke = record(value);
    if (typeof stroke.id !== "string" || !stroke.id || ids.has(stroke.id)) fail("草图包含缺失或重复的笔画标识。");
    ids.add(stroke.id);
    if (!["pen", "line", "arrow", "rect", "ellipse", "text"].includes(String(stroke.kind))) fail("草图笔画类型无效。");
    if (typeof stroke.color !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(stroke.color) || !finite(stroke.width, 1, 16)) fail("草图颜色或线宽无效。");
    if (!Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > MAX_STROKE_POINTS) fail("草图单笔最多保存 4,000 个点。");
    total += stroke.points.length;
    if (total > MAX_DRAWING_POINTS) fail("草图点数已达上限，请分成多张绘图。");
    if (stroke.kind === "text" ? stroke.points.length !== 1 : stroke.kind !== "pen" && stroke.points.length !== 2) fail("草图笔画的坐标数量无效。");
    const points = stroke.points.map(value => {
      const point = record(value);
      if (!finite(point.x, 0, DRAWING_WIDTH) || !finite(point.y, 0, DRAWING_HEIGHT)) fail("草图坐标超出画布或不是有限数值。");
      return { x: point.x, y: point.y } as ResearchDrawingPoint;
    });
    if (stroke.kind === "text" && (typeof stroke.text !== "string" || stroke.text.length > 2000)) fail("草图文字最多 2,000 字符。");
    return { id: stroke.id, kind: stroke.kind, points, color: stroke.color, width: stroke.width, ...(stroke.kind === "text" ? { text: stroke.text } : {}) } as ResearchDrawingStroke;
  });
  return { id: block.id, type: "diagram", ...(block.title !== undefined ? { title: block.title as string } : {}), mode: block.mode as ResearchDiagramBlock["mode"], code: block.code, strokes } as ResearchDiagramBlock;
}

/** Draft syntax can be invalid while editing; active resources are checked before rendering. */
export function mermaidSourceError(code: string): string {
  if (code.length > MAX_DIAGRAM_CODE) return "流程图源码最多 20,000 字符。";
  if (!code.trim()) return "";
  if (/%%\s*\{/.test(code) || /^\s*---/.test(code)) return "请移除图表配置指令，样式由笔记统一管理。";
  if (/(?:^|[;\n\r])\s*click\b/i.test(code)) return "流程图不支持点击脚本或跳转指令。";
  if (/\b(?:https?|javascript|data|file|mailto):|!\[[^\]]*\]\s*\(|\b(?:img|image)\s*:|\b(?:url|expression)\s*\(|@import/i.test(code) || /<\/?[a-z][\w:-]*(?:\s|>)/i.test(code)) return "流程图只使用本地文字与图形，请移除外链、图片和 HTML。";
  return "";
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const number = (value: number) => Math.round(value * 100) / 100;

/** No foreign objects, linked assets or inherited CSS are needed to reopen this SVG. */
export function drawingStrokeSvg(stroke: ResearchDrawingStroke): string {
  const a = stroke.points[0], b = stroke.points[stroke.points.length - 1];
  const style = `stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  if (stroke.kind === "text") return `<text x="${number(a.x)}" y="${number(a.y)}" fill="${stroke.color}" font-size="${14 + stroke.width * 2}" font-family="system-ui,sans-serif">${(stroke.text ?? "").split(/\r?\n/).map((line, index) => `<tspan x="${number(a.x)}" dy="${index ? "1.3em" : "0"}">${escape(line)}</tspan>`).join("")}</text>`;
  if (stroke.kind === "pen" && stroke.points.length === 1) return `<circle cx="${number(a.x)}" cy="${number(a.y)}" r="${stroke.width / 2}" fill="${stroke.color}" />`;
  if (stroke.kind === "pen") return `<polyline points="${stroke.points.map(point => `${number(point.x)},${number(point.y)}`).join(" ")}" ${style}/>`;
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), width = Math.abs(b.x - a.x), height = Math.abs(b.y - a.y);
  if (stroke.kind === "rect") return `<rect x="${number(left)}" y="${number(top)}" width="${number(width)}" height="${number(height)}" ${style}/>`;
  if (stroke.kind === "ellipse") return `<ellipse cx="${number(left + width / 2)}" cy="${number(top + height / 2)}" rx="${number(width / 2)}" ry="${number(height / 2)}" ${style}/>`;
  const line = `<line x1="${number(a.x)}" y1="${number(a.y)}" x2="${number(b.x)}" y2="${number(b.y)}" ${style}/>`;
  if (stroke.kind === "line") return line;
  const angle = Math.atan2(b.y - a.y, b.x - a.x), length = 9 + stroke.width * 2;
  const points = [b, { x: b.x - Math.cos(angle - Math.PI / 6) * length, y: b.y - Math.sin(angle - Math.PI / 6) * length }, { x: b.x - Math.cos(angle + Math.PI / 6) * length, y: b.y - Math.sin(angle + Math.PI / 6) * length }];
  return `${line}<polygon points="${points.map(point => `${number(point.x)},${number(point.y)}`).join(" ")}" fill="${stroke.color}"/>`;
}

export function drawingSvg(strokes: ResearchDrawingStroke[], title = "草图"): string {
  const safe = normalizeDiagramBlock({ id: "export", type: "diagram", mode: "drawing", code: "", strokes });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DRAWING_WIDTH} ${DRAWING_HEIGHT}" width="${DRAWING_WIDTH}" height="${DRAWING_HEIGHT}" role="img"><title>${escape(title)}</title><rect width="100%" height="100%" fill="white"/>${safe.strokes.map(drawingStrokeSvg).join("")}</svg>`;
}

export function diagramText(block: ResearchDiagramBlock): string {
  return [block.title, block.code, ...block.strokes.filter(stroke => stroke.kind === "text").map(stroke => stroke.text)].filter(Boolean).join("\n");
}

export function serializeDiagramMarkdown(block: ResearchDiagramBlock): string {
  const content = block.mode === "mermaid" ? block.code : drawingSvg(block.strokes, block.title);
  const fence = "`".repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map(match => match[0].length + 1)));
  return [block.title, `${fence}${block.mode === "mermaid" ? "mermaid" : "svg"}\n${content}\n${fence}`].filter(Boolean).join("\n\n");
}
