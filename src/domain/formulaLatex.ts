import katex from "katex";

/** A custom fragment is one self-contained atom inside the editable formula. */
export function formulaLatexError(tex: string): string | undefined {
  if (!tex.trim()) return "请输入 LaTeX 数学符号或表达式。";
  if (tex.length > 16_000) return "LaTeX 内容过长，请分段插入。";
  if (/\\(?:html\w*|href|url|includegraphics|def|gdef|edef|xdef|let|global|newcommand|renewcommand|providecommand)\b/.test(tex)) return "请只输入数学符号或表达式。";
  let environments = 0;
  for (const match of tex.matchAll(/\\(?:begin|end)\{[A-Za-z*]+\}|\\[A-Za-z]+|\\.|&/g)) {
    if (match[0].startsWith("\\begin{")) environments++;
    else if (match[0].startsWith("\\end{")) environments--;
    else if (environments === 0 && ["&", "\\\\"].includes(match[0])) return "换行和对齐请使用矩阵、分段或多行环境。";
  }
  try {
    katex.renderToString(tex, { throwOnError: true, strict: "ignore", trust: false, maxExpand: 1000 });
  } catch {
    return "LaTeX 无法显示，请检查命令、括号和角标。";
  }
}

/** Preserve command boundaries, e.g. a sine followed by p must be \sin p. */
export function joinFormulaTex(fragments: string[]): string {
  return fragments.reduce((result, fragment) => result + (/\\[A-Za-z]+$/.test(result) && /^[A-Za-z]/.test(fragment) ? " " : "") + fragment, "");
}
