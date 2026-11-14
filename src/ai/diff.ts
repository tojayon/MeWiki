export type AiDiffKind = 'context' | 'remove' | 'add';
export interface AiDiffPart { text: string; changed: boolean }
export interface AiDiffLine {
  kind: AiDiffKind; text: string; beforeLine?: number; afterLine?: number; parts: AiDiffPart[]; newlineChanged?: boolean;
}
interface TokenRun { kind: AiDiffKind; tokens: string[] }
interface DiffBudget { cells: number }

/** Sparse edits stay precise even when a long unchanged middle exceeds the LCS grid. */
function sparseDiff(before: string[], after: string[], budget: DiffBudget): TokenRun[] | null {
  const frontier = new Map<number, number>([[1, 0]]), trace: Map<number, number>[] = [];
  for (let distance = 0; distance <= before.length + after.length; distance++) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (--budget.cells < 0) return null;
      let x = diagonal === -distance || diagonal !== distance && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1)
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        if (--budget.cells < 0) return null;
        x++; y++;
      }
      frontier.set(diagonal, x);
      if (x < before.length || y < after.length) continue;
      const steps: { kind: AiDiffKind; token: string }[] = [];
      for (let d = trace.length - 1; d >= 0; d--) {
        const previous = trace[d], k = x - y;
        const previousK = k === -d || k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK;
        while (x > previousX && y > previousY) { steps.push({ kind: 'context', token: before[--x] }); y--; }
        if (d > 0) {
          if (x === previousX) steps.push({ kind: 'add', token: after[--y] });
          else steps.push({ kind: 'remove', token: before[--x] });
        }
      }
      const result: TokenRun[] = [];
      for (const step of steps.reverse()) {
        const last = result.at(-1);
        if (last?.kind === step.kind) last.tokens.push(step.token);
        else result.push({ kind: step.kind, tokens: [step.token] });
      }
      return result;
    }
  }
  return null;
}

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
  if (!left.length || !right.length) {
    push('remove', left); push('add', right);
  } else if (cells > budget.cells) {
    const sparse = sparseDiff(left, right, budget);
    if (sparse) for (const run of sparse) push(run.kind, run.tokens);
    else { push('remove', left); push('add', right); }
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

interface InlineLine { parts: AiDiffPart[]; newlineChanged?: boolean }
function splitParts(parts: AiDiffPart[]): InlineLine[] {
  const lines: InlineLine[] = [{ parts: [] }];
  for (const part of parts) for (const [index, text] of part.text.split('\n').entries()) {
    if (index) { lines.at(-1)!.newlineChanged = part.changed || undefined; lines.push({ parts: [] }); }
    if (!text) continue;
    const line = lines.at(-1)!.parts, last = line.at(-1);
    if (last?.changed === part.changed) last.text += text;
    else line.push({ text, changed: part.changed });
  }
  return lines;
}

export interface AiDiffRange { start: number; end: number }
/** UTF-16 offsets match Markdown node positions; all boundaries retain whole graphemes. */
export function aiDiffRanges(lines: AiDiffLine[], side: 'remove' | 'add'): AiDiffRange[] {
  const ranges: AiDiffRange[] = [];
  let offset = 0;
  for (const line of lines) {
    if (line.kind === (side === 'remove' ? 'add' : 'remove')) continue;
    for (const part of line.parts) {
      if (part.changed && part.text.length) ranges.push({ start: offset, end: offset + part.text.length });
      offset += part.text.length;
    }
    if (line.newlineChanged) ranges.push({ start: offset, end: offset + 1 });
    offset++;
  }
  return ranges;
}

/** Both sides reconstruct exactly. The shared work budget bounds quadratic comparisons. */
export function diffAiText(before: string, after: string): AiDiffLine[] {
  const budget = { cells: 500000 };
  const runs = tokenDiff(before === '' ? [] : before.split('\n'), after === '' ? [] : after.split('\n'), budget);
  const partsByRun = new Map<number, InlineLine[]>();
  for (const [index, run] of runs.entries()) {
    const added = runs[index + 1];
    if (run.kind !== 'remove' || added?.kind !== 'add') continue;
    const [removedParts, addedParts] = inlineParts(run.tokens.join('\n'), added.tokens.join('\n'), budget);
    partsByRun.set(index, splitParts(removedParts));
    partsByRun.set(index + 1, splitParts(addedParts));
  }
  const lines: AiDiffLine[] = [];
  let beforeLine = 1, afterLine = 1;
  for (const [index, run] of runs.entries()) {
    for (const [i, text] of run.tokens.entries()) {
      lines.push({ kind: run.kind, text,
        ...(run.kind !== 'add' ? { beforeLine: beforeLine++ } : {}),
        ...(run.kind !== 'remove' ? { afterLine: afterLine++ } : {}),
        parts: partsByRun.get(index)?.[i]?.parts ?? [{ text, changed: run.kind !== 'context' }],
        ...(partsByRun.get(index)?.[i]?.newlineChanged ? { newlineChanged: true } : {}),
      });
    }
  }
  return lines;
}
