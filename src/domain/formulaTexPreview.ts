import katex from "katex";
import type { FormulaLayout } from "./researchDictionary.ts";

export interface FormulaTexDiagnostic {
  message: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

/** Strip display wrappers while retaining offsets into the user's draft. */
export function normalizeFormulaTex(source: string): { tex: string; layout: FormulaLayout; sourceOffset: number; array?: { columns: string; sourceOffset: number } } {
  // Replace comments with equal-length whitespace. Escaped percent signs are
  // consumed separately, so both inline comments and CRLF offsets stay intact.
  let tex = source.replace(/\\[\s\S]|%[^\r\n]*/g, match => match.startsWith("%") ? " ".repeat(match.length) : match);
  let sourceOffset = 0;
  const trim = () => {
    const leading = tex.length - tex.trimStart().length;
    sourceOffset += leading;
    tex = tex.trim();
  };
  trim();
  const delimiter = [["\\[", "\\]"], ["\\(", "\\)"], ["$$", "$$"], ["$", "$"]].find(([open, close]) => tex.startsWith(open) && tex.endsWith(close) && tex.length >= open.length + close.length);
  if (delimiter) {
    sourceOffset += delimiter[0].length;
    tex = tex.slice(delimiter[0].length, -delimiter[1].length);
    trim();
  }
  const environment = /^(\\begin\{(aligned|gathered|array)\})([\s\S]*)\\end\{\2\}$/.exec(tex);
  if (environment) {
    sourceOffset += environment[1].length;
    tex = environment[3];
    trim();
  }
  const array = environment?.[2] === "array" ? { columns: "", sourceOffset } : undefined;
  if (array && tex.startsWith("{")) {
    let depth = 0;
    for (let index = 0; index < tex.length; index++) {
      if (tex[index] === "\\") { index++; continue; }
      if (tex[index] === "{") depth++;
      if (tex[index] === "}" && --depth === 0) {
        array.columns = tex.slice(0, index + 1);
        sourceOffset += index + 1;
        tex = tex.slice(index + 1);
        trim();
        break;
      }
    }
  } else if (array && tex) {
    // Like other TeX arguments, the column declaration may be a single atom
    // without braces. Keep it out of the dictionary expression as well.
    array.columns = /^(?:\\[a-zA-Z]+|\\[\s\S]|[\s\S])/u.exec(tex)![0];
    sourceOffset += array.columns.length;
    tex = tex.slice(array.columns.length);
    trim();
  }
  return { tex, layout: environment?.[2] === "gathered" ? "centered" : "aligned", sourceOffset, ...(array ? { array } : {}) };
}

export function formulaTexDiagnostic(source: string, message: string, start: number, end = start): FormulaTexDiagnostic {
  start = Math.max(0, Math.min(source.length, start));
  end = Math.max(start, Math.min(source.length, end));
  const lines = source.slice(0, start).split(/\r\n|\r|\n/);
  return { message, start, end, line: lines.length, column: Array.from(lines.at(-1) ?? "").length + 1 };
}

export function previewFormulaTex(source: string): ReturnType<typeof normalizeFormulaTex> & { html?: string; diagnostic?: FormulaTexDiagnostic } {
  if (source.length > 1_000_000) return { tex: "", layout: "aligned", sourceOffset: 0, diagnostic: formulaTexDiagnostic(source, "公式过大，无法预览。", 0) };
  const normalized = normalizeFormulaTex(source);
  const { tex, layout, sourceOffset } = normalized;
  if (!tex) return normalized;
  let depth = 0, tokens = 0;
  for (const match of tex.matchAll(/\\[a-zA-Z]+|\\[\s\S]|[^\s]/g)) {
    if (["{", "(", "[", "\\{"].includes(match[0])) depth++;
    else if (["}", ")", "]", "\\}"].includes(match[0])) depth = Math.max(0, depth - 1);
    const message = depth > 128 ? "公式嵌套层数过多，无法预览。" : ++tokens > 40_000 ? "公式过大，无法预览。" : undefined;
    if (message) return { ...normalized, diagnostic: formulaTexDiagnostic(source, message, sourceOffset + match.index, sourceOffset + match.index + match[0].length) };
  }
  const environment = normalized.array ? "array" : layout === "centered" ? "gathered" : "aligned";
  const header = `\\begin{${environment}}`;
  const prefix = header + (normalized.array?.columns ?? "");
  try {
    const html = katex.renderToString(prefix + tex + `\\end{${environment}}`, { displayMode: true, throwOnError: true, strict: "ignore", trust: false });
    return { ...normalized, html };
  } catch (error) {
    const problem = error as { message?: string; position?: number; length?: number };
    const position = problem.position ?? prefix.length + tex.length;
    const at = Math.max(0, Math.min(tex.length, position - prefix.length));
    const end = Math.min(tex.length, at + (problem.length ?? (at < tex.length ? 1 : 0)));
    const detail = (problem.message ?? "请检查括号、角标或命令是否完整。")
      .replace(/^KaTeX parse error:\s*/, "").split(/ at position \d+| at end of input/)[0]
      .replace("Undefined control sequence:", "未支持的命令：");
    const columnError = normalized.array && position >= header.length && position < prefix.length;
    const start = columnError ? normalized.array!.sourceOffset + position - header.length : sourceOffset + at;
    return { ...normalized, diagnostic: formulaTexDiagnostic(source, "LaTeX 语法错误：" + detail, start, columnError ? start + (problem.length ?? 1) : sourceOffset + end) };
  }
}
