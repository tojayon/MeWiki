import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { resolveSymbolEntry, type ResearchSymbolEntry } from "./researchDictionary.ts";

export interface ResearchSymbolMention { start: number; end: number; query: string }
interface TextNode { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: TextNode[] }
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const literalTypes = new Set(["code", "inlineCode", "link", "linkReference", "image", "html"]);
const escaped = (text: string, index: number) => {
  let backslashes = 0;
  while (text[--index] === "\\") backslashes++;
  return backslashes % 2 === 1;
};

/** A single opening dollar in prose; closing dollars and existing literals stay ordinary text. */
export function findResearchSymbolMention(text: string, caret: number): ResearchSymbolMention | null {
  const match = /\$([^$\n@]{0,80})$/.exec(text.slice(0, caret));
  if (!match) return null;
  const start = caret - match[1].length - 1;
  if (escaped(text, start) || text[start - 1] === "$" || text[start + 1] === "$") return null;
  const ignored: { start: number; end: number }[] = [];
  let insideLiteral = false;
  const visit = (node: TextNode) => {
    const a = node.position?.start.offset, b = node.position?.end.offset;
    if (a !== undefined && b !== undefined && literalTypes.has(node.type)) {
      ignored.push({ start: a, end: b });
      if (a <= start && start < b) insideLiteral = true;
      return;
    }
    if (a !== undefined && b !== undefined && (node.type === "math" || node.type === "inlineMath") && a < start && start < b) insideLiteral = true;
    node.children?.forEach(visit);
  };
  visit(parser.parse(text) as TextNode);
  if (insideLiteral) return null;
  const prefix = text.slice(0, start);
  const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if ((line.replace(/\\./g, "").match(/`+/g)?.length ?? 0) % 2) return null;
  let math = 0;
  for (let index = 0; index < start; index++) {
    const range = ignored.find(range => range.start <= index && index < range.end);
    if (range) { index = range.end - 1; continue; }
    if (text[index] !== "$" || escaped(text, index)) continue;
    let count = 1;
    while (text[index + count] === "$" && index + count < start) count++;
    const delimiter = count === 1 ? 1 : 2;
    if (math === delimiter) math = 0;
    else if (!math) math = delimiter;
    index += count - 1;
  }
  return math ? null : { start, end: caret, query: match[1] };
}

export function insertResearchSymbolMention(text: string, mention: ResearchSymbolMention, entry: ResearchSymbolEntry) {
  const bindings = Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]));
  const insertion = `$${resolveSymbolEntry(entry, bindings).tex}$`;
  const end = text[mention.end] === "$" && text[mention.end + 1] !== "$" ? mention.end + 1 : mention.end;
  return { text: text.slice(0, mention.start) + insertion + text.slice(end), caret: mention.start + insertion.length, end };
}

export function searchResearchSymbols(symbols: readonly ResearchSymbolEntry[], query: string) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return symbols.filter(entry => {
    const defaults = resolveSymbolEntry(entry, Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
    const searchable = [entry.name, entry.notation, defaults, entry.meaning, entry.unit, entry.scope, ...entry.slots.map(slot => slot.description), ...(entry.tags ?? [])].join(" ").toLocaleLowerCase();
    return tokens.every(token => searchable.includes(token));
  });
}
