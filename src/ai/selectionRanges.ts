import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, RootContent } from 'mdast';
import type { ResearchNotebookBlock } from '../domain/researchNotebook.ts';

export interface AiSelectionRange { field: 'text' | 'items'; index?: number; start: number; end: number }
export interface AiSelectionHint { id: string; text: string; prefix: string }
interface Unit { text: string; start: number; end: number }
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const compact = (text: string) => text.replace(/\s/g, '');
const error = () => new Error('选区无法准确定位，请重新选择文字，或使用本行内容菜单。');

/** Keep source positions even when Markdown hides emphasis, escapes or entities. */
function units(source: string): Unit[] {
  const result: Unit[] = [];
  const append = (text: string, start: number, end: number) => {
    for (const character of text) if (!/\s/.test(character)) result.push({ text: character, start, end });
  };
  const visit = (node: Root | RootContent) => {
    if ('children' in node) { node.children.forEach(child => visit(child as RootContent)); return; }
    if (!('value' in node) || typeof node.value !== 'string' || node.type === 'html') return;
    const start = node.position?.start.offset ?? 0, end = node.position?.end.offset ?? start, raw = source.slice(start, end);
    if (node.type !== 'text') {
      const offset = raw.indexOf(node.value);
      if (offset < 0) return;
      for (let i = 0; i < node.value.length;) {
        const character = String.fromCodePoint(node.value.codePointAt(i)!);
        append(character, start + offset + i, start + offset + i + character.length); i += character.length;
      }
      return;
    }
    const mapped: Unit[] = [];
    let decoded = '';
    for (let i = 0; i < raw.length;) {
      const token = /^(?:\\[!-/:-@[-`{-~]|\r\n|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);)/.exec(raw.slice(i))?.[0] ?? String.fromCodePoint(raw.codePointAt(i)!);
      let text = token;
      if (token.startsWith('\\')) text = token.slice(1);
      else if (token === '\r\n') text = '\n';
      else if (token.startsWith('&') && token.length > 1) {
        const paragraph = parser.parse(token).children[0];
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'text') text = paragraph.children[0].value;
      }
      decoded += text;
      for (const character of text) if (!/\s/.test(character)) mapped.push({ text: character, start: start + i, end: start + i + token.length });
      i += token.length;
    }
    if (decoded === node.value) result.push(...mapped);
  };
  visit(parser.parse(source));
  return result;
}
function fields(block: ResearchNotebookBlock) {
  return block.type === 'list' ? block.items.map((source, index) => ({ source, field: 'items' as const, index }))
    : 'text' in block && typeof block.text === 'string' ? [{ source: block.text, field: 'text' as const, index: undefined }] : [];
}
export function locateAiSelection(blocks: ResearchNotebookBlock[], quote: string, hints?: AiSelectionHint[]): Map<string, AiSelectionRange[]> {
  if (hints?.length) {
    const result = new Map<string, AiSelectionRange[]>();
    for (const block of blocks) {
      const hint = hints.find(item => item.id === block.id);
      if (!hint?.text.trim()) throw error();
      const found = locate(blocks.filter(item => item.id === block.id), hint.text, hint.prefix);
      result.set(block.id, found.get(block.id)!);
    }
    return result;
  }
  return locate(blocks, quote);
}
function locate(blocks: ResearchNotebookBlock[], quote: string, prefix?: string) {
  const parts = blocks.flatMap(block => fields(block).map(field => ({ ...field, id: block.id, units: units(field.source) })));
  const projected = parts.flatMap(part => part.units.map(unit => ({ ...unit, part })));
  const text = projected.map(unit => unit.text).join(''), target = compact(quote);
  const occurrences: number[] = [];
  for (let at = text.indexOf(target); target && at >= 0; at = text.indexOf(target, at + 1)) occurrences.push(at);
  const before = prefix === undefined ? undefined : compact(prefix);
  const matches = occurrences.filter(at => before === undefined || text.slice(0, at) === before);
  if (matches.length !== 1) throw error();
  // Use code-point units, rather than UTF-16 string indices, for emoji boundaries.
  const start = [...text.slice(0, matches[0])].length, length = [...target].length;
  const selected = projected.slice(start, start + length), result = new Map<string, AiSelectionRange[]>();
  for (const part of parts) {
    const selectedUnits = selected.filter(unit => unit.part === part);
    if (!selectedUnits.length) continue;
    const range: AiSelectionRange = { field: part.field, ...(part.index !== undefined ? { index: part.index } : {}),
      start: selectedUnits[0].start, end: selectedUnits.at(-1)!.end };
    result.set(part.id, [...result.get(part.id) ?? [], range]);
  }
  if (blocks.some(block => !result.has(block.id))) throw error();
  return result;
}
export function validAiSelectionRanges(value: unknown): value is AiSelectionRange[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 80 && value.every(range => range && ['text', 'items'].includes(range.field)
    && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 0 && range.end > range.start
    && (range.field === 'items' ? Number.isSafeInteger(range.index) && range.index >= 0 : range.index === undefined));
}
export function assertAiSelectionRangesMatch(blocks: { block: ResearchNotebookBlock; ranges?: AiSelectionRange[] }[], quote: string): void {
  const selected: string[] = [];
  for (const { block, ranges } of blocks) {
    if (!ranges || !validAiSelectionRanges(ranges)) throw error();
    let consumed = 0;
    for (const part of fields(block)) {
      const matching = ranges.filter(range => range.field === part.field && range.index === part.index);
      if (matching.length > 1) throw error();
      const range = matching[0];
      if (!range) continue;
      const projected = units(part.source), chosen = projected.filter(unit => unit.start >= range.start && unit.end <= range.end);
      if (!chosen.length || range.start !== chosen[0].start || range.end !== chosen.at(-1)!.end) throw error();
      selected.push(chosen.map(unit => unit.text).join('')); consumed++;
    }
    if (consumed !== ranges.length) throw error();
  }
  if (selected.join('') !== compact(quote)) throw error();
}
export function assertAiSelectedText(block: ResearchNotebookBlock, ranges: AiSelectionRange[], patch: Record<string, unknown>): void {
  for (const { field, index, source } of fields(block)) {
    if (!(field in patch)) continue;
    const after = field === 'items' ? Array.isArray(patch.items) ? patch.items[index!] : undefined : patch.text;
    const selected = ranges.filter(range => range.field === field && range.index === index);
    if (typeof after !== 'string' || selected.length > 1 || selected.some(range => range.end > source.length)) throw error();
    const range = selected[0];
    if (!range ? after !== source : !after.startsWith(source.slice(0, range.start)) || !after.endsWith(source.slice(range.end))
      || after.length < range.start + source.length - range.end) throw new Error('此修改超出选区，请保留未选中的文字和格式。');
  }
  if (block.type === 'list' && 'items' in patch && (!Array.isArray(patch.items) || patch.items.length !== block.items.length)) throw new Error('此修改超出选区，请保留未选中的列表项。');
}
export function completeAiSelectedDraft(source: string, partial: string, range: AiSelectionRange): string {
  const prefix = source.slice(0, range.start), suffix = source.slice(range.end);
  if (!partial.startsWith(prefix)) throw error();
  if (partial.endsWith(suffix) && partial.length >= prefix.length + suffix.length) return partial;
  let overlap = Math.min(suffix.length, partial.length - prefix.length);
  while (overlap > 0 && !partial.endsWith(suffix.slice(0, overlap))) overlap--;
  return partial + suffix.slice(overlap);
}
