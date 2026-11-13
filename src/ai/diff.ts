export type AiDiffKind = 'context' | 'remove' | 'add';
export interface AiDiffPart { text: string; changed: boolean }
export interface AiDiffLine {
  kind: AiDiffKind; text: string; beforeLine?: number; afterLine?: number; parts: AiDiffPart[];
}
interface TokenRun { kind: AiDiffKind; tokens: string[] }
interface DiffBudget { cells: number }

/** Trim common edges first; large unrelated regions fall back to an exact coarse diff. */
function tokenDiff(before: string[], after: string[], budget: DiffBudget): TokenRun[] {
  const runs: TokenRun[] = [];
  const push = (kind: AiDiffKind, tokens: string[]) => {
    if (!tokens.length) return;
    const last = runs.at(-1);
    if (last?.kind === kind) for (const token of tokens) last.tokens.push(token);
    else runs.push({ kind, tokens });
  };
  let start = 0, end = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  push('context', before.slice(0, start));
  const left = before.slice(start, before.length - end), right = after.slice(start, after.length - end);
  const cells = (left.length + 1) * (right.length + 1);
  if (!left.length || !right.length || cells > budget.cells) {
    push('remove', left); push('add', right);
  } else {
    budget.cells -= cells;
    const width = right.length + 1, lcs = new Uint32Array(cells);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      lcs[i * width + j] = left[i] === right[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { push('context', [left[i++]]); j++; }
      else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) push('remove', [left[i++]]);
      else push('add', [right[j++]]);
    }
    push('remove', left.slice(i)); push('add', right.slice(j));
  }
  push('context', before.slice(before.length - end));
  return runs;
}
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function inlineParts(before: string, after: string, budget: DiffBudget): [AiDiffPart[], AiDiffPart[]] {
  const tokens = (value: string) => Array.from(graphemes.segment(value), item => item.segment);
  const runs = tokenDiff(tokens(before), tokens(after), budget);
  const parts = (side: 'remove' | 'add') => runs.filter(run => run.kind === 'context' || run.kind === side).map(run => ({ text: run.tokens.join(''), changed: run.kind !== 'context' }));
  return [parts('remove'), parts('add')];
}

/** Both sides reconstruct exactly. The shared work budget bounds quadratic comparisons. */
export function diffAiText(before: string, after: string): AiDiffLine[] {
  const budget = { cells: 500000 };
  const runs = tokenDiff(before === '' ? [] : before.split('\n'), after === '' ? [] : after.split('\n'), budget);
  const partsByRun = new Map<number, (AiDiffPart[] | undefined)[]>();
  for (const [index, run] of runs.entries()) {
    const added = runs[index + 1];
    if (run.kind !== 'remove' || added?.kind !== 'add') continue;
    const pairs = run.tokens.map((text, i) => i < added.tokens.length ? inlineParts(text, added.tokens[i], budget) : undefined);
    partsByRun.set(index, pairs.map(pair => pair?.[0]));
    partsByRun.set(index + 1, pairs.map(pair => pair?.[1]));
  }
  const lines: AiDiffLine[] = [];
  let beforeLine = 1, afterLine = 1;
  for (const [index, run] of runs.entries()) {
    for (const [i, text] of run.tokens.entries()) {
      lines.push({ kind: run.kind, text,
        ...(run.kind !== 'add' ? { beforeLine: beforeLine++ } : {}),
        ...(run.kind !== 'remove' ? { afterLine: afterLine++ } : {}),
        parts: partsByRun.get(index)?.[i] ?? [{ text, changed: run.kind !== 'context' }],
      });
    }
  }
  return lines;
}
