import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ResearchSymbolEntry } from "./researchDictionary.ts";
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from "./researchNotebook.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";
import { invalidateResearchReviews } from "./researchNoteOrganization.ts";
import { normalizeResearchTags } from "./researchTags.ts";

export type ResearchTermStatus = "active" | "deprecated";

export interface ResearchTermAtom {
  id: string;
  text: string;
  meaning: string;
}

export interface ResearchTermAlias {
  id: string;
  name: string;
}

export interface ResearchTermEntry {
  id: string;
  name: string;
  englishName?: string;
  englishAbbreviation?: string;
  chineseAbbreviation?: string;
  aliases: string[];
  aliasEntries?: ResearchTermAlias[];
  meaning: string;
  atoms?: ResearchTermAtom[];
  tags?: string[];
  scope?: string;
  status?: ResearchTermStatus;
}

const createId = () => `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function termNameFields(entry: { englishName?: unknown; englishAbbreviation?: unknown; chineseAbbreviation?: unknown }) {
  return {
    ...(typeof entry.englishName === "string" && entry.englishName.trim() ? { englishName: entry.englishName.trim() } : {}),
    ...(typeof entry.englishAbbreviation === "string" && entry.englishAbbreviation.trim() ? { englishAbbreviation: entry.englishAbbreviation.trim() } : {}),
    ...(typeof entry.chineseAbbreviation === "string" && entry.chineseAbbreviation.trim() ? { chineseAbbreviation: entry.chineseAbbreviation.trim() } : {}),
  };
}

function normalizeTermAliases(value: unknown): ResearchTermAlias[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = new Map<string, ResearchTermAlias>();
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id || typeof record.name !== "string") continue;
    const name = record.name.trim();
    if (!name || result.has(record.id) || names.has(name)) continue;
    result.set(record.id, { id: record.id, name });
    names.add(name);
  }
  return [...result.values()];
}

export function researchTermAliases(entry: ResearchTermEntry): ResearchTermAlias[] {
  return entry.aliasEntries ?? entry.aliases.map(name => ({ id: `legacy:${encodeURIComponent(name)}`, name }));
}

function normalizeTermAtoms(value: unknown): ResearchTermAtom[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = new Map<string, ResearchTermAtom>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.text !== "string" || typeof record.meaning !== "string") continue;
    const text = record.text.trim();
    const meaning = record.meaning.trim();
    if (!text || !meaning || result.has(record.id)) continue;
    result.set(record.id, { id: record.id, text, meaning });
  }
  return [...result.values()];
}

export function createTermEntry(
  entry: Omit<ResearchTermEntry, "id">,
  id = createId(),
): ResearchTermEntry {
  const atoms = normalizeTermAtoms(entry.atoms);
  const aliasEntries = normalizeTermAliases(entry.aliasEntries);
  return {
    id,
    name: entry.name.trim(),
    ...termNameFields(entry),
    aliases: aliasEntries ? aliasEntries.map(alias => alias.name) : [...new Set(entry.aliases.map(alias => alias.trim()).filter(Boolean))],
    ...(aliasEntries ? { aliasEntries } : {}),
    meaning: entry.meaning.trim(),
    ...(atoms?.length ? { atoms } : {}),
    ...(entry.tags?.length ? { tags: normalizeResearchTags(entry.tags) } : {}),
    ...(entry.scope?.trim() ? { scope: entry.scope.trim() } : {}),
    status: entry.status === "deprecated" ? "deprecated" : "active",
  };
}

const comparable = (value: string) => value.trim().toLocaleLowerCase();

export function termEntryError(entry: ResearchTermEntry, existing: readonly ResearchTermEntry[]): string | null {
  if (!entry.name.trim() || !entry.meaning.trim()) return "术语名称和含义不能为空";
  if (entry.aliasEntries) {
    if (entry.aliasEntries.some(alias => !alias.name.trim())) return "术语别名不能为空，请填写或删除空行";
    if (new Set(entry.aliasEntries.map(alias => alias.id)).size !== entry.aliasEntries.length ||
      entry.aliasEntries.length !== entry.aliases.length || entry.aliasEntries.some((alias, index) => alias.name.trim() !== entry.aliases[index]?.trim())) return "术语别名记录无效";
  }
  const labels = [entry.name, ...entry.aliases].map(comparable).filter(Boolean);
  if (new Set(labels).size !== labels.length) return "术语名称和别名不能重复";
  const occupied = new Set(existing.filter(item => item.id !== entry.id).flatMap(item => [item.name, ...item.aliases]).map(comparable).filter(Boolean));
  if (labels.some(label => occupied.has(label))) return "术语名称或别名已存在";
  if (entry.atoms !== undefined) {
    if (!entry.atoms.length || entry.atoms.some(atom => !atom.text.trim() || !atom.meaning.trim())) return "原子词汇名称和解释不能为空";
    if (entry.atoms.map(atom => atom.text.trim()).join("") !== entry.name.trim()) return "原子词汇必须按术语名称顺序完整覆盖";
  }
  return null;
}

export function researchTermAtoms(entry: ResearchTermEntry): ResearchTermAtom[] {
  return entry.atoms?.length ? entry.atoms : [{ id: `${entry.id}:atom:0`, text: entry.name, meaning: entry.meaning }];
}

export function normalizeTermEntries(value: unknown): ResearchTermEntry[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, ResearchTermEntry>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.meaning !== "string") continue;
    if (result.has(record.id)) continue;
    const aliases = Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === "string") : [];
    result.set(record.id, createTermEntry({
      name: record.name,
      ...termNameFields(record),
      aliases,
      ...(Array.isArray(record.aliasEntries) ? { aliasEntries: normalizeTermAliases(record.aliasEntries) } : {}),
      meaning: record.meaning,
      atoms: normalizeTermAtoms(record.atoms),
      tags: Array.isArray(record.tags) ? normalizeResearchTags(record.tags) : undefined,
      ...(typeof record.scope === "string" ? { scope: record.scope } : {}),
      status: record.status === "deprecated" ? "deprecated" : "active",
    }, record.id));
  }
  return [...result.values()].filter(entry => entry.name && entry.meaning);
}

export type DictionaryReferenceKind = "term" | "symbol";
const prefixes: Record<DictionaryReferenceKind, string> = {
  term: "mewiki-term:",
  symbol: "mewiki-symbol:",
};

function encodeId(id: string) {
  return encodeURIComponent(id);
}

function validReferenceId(id: string) {
  return !!id && [...id].every(char => {
    const code = char.charCodeAt(0);
    return code > 0x1f && code !== 0x7f;
  });
}

function decodeId(value: string) {
  try {
    const id = decodeURIComponent(value);
    return validReferenceId(id) ? id : null;
  } catch {
    return null;
  }
}

export function dictionaryReferenceKind(url: string | undefined): DictionaryReferenceKind | null {
  if (!url) return null;
  if (url.startsWith(prefixes.term)) return decodeId(url.slice(prefixes.term.length).split("?", 1)[0]) ? "term" : null;
  if (url.startsWith(prefixes.symbol)) return decodeId(url.slice(prefixes.symbol.length).split("?", 1)[0]) ? "symbol" : null;
  return null;
}

export function dictionaryReferenceId(url: string | undefined): string | null {
  const kind = dictionaryReferenceKind(url);
  if (!kind || !url) return null;
  return decodeId(url.slice(prefixes[kind].length).split("?", 1)[0]);
}

export function dictionaryReferenceBindings(url: string | undefined): Record<string, string> {
  if (dictionaryReferenceKind(url) !== "symbol" || !url) return {};
  const query = url.split("?", 2)[1];
  if (!query) return {};
  const result: Record<string, string> = {};
  try {
    for (const [key, value] of new URLSearchParams(query)) if (["x1", "x2", "x3"].includes(key)) result[key] = value;
  } catch {
    return {};
  }
  return result;
}

export function resolveDictionaryReference(
  url: string | undefined,
  symbols: readonly ResearchSymbolEntry[] = [],
  terms: readonly ResearchTermEntry[] = [],
) {
  const kind = dictionaryReferenceKind(url);
  const id = dictionaryReferenceId(url);
  if (!kind || !id) return { kind: null, id: null, entry: undefined, bindings: {} as Record<string, string> };
  const entry = kind === "term" ? terms.find(item => item.id === id) : symbols.find(item => item.id === id);
  return { kind, id, entry, bindings: dictionaryReferenceBindings(url) };
}

export function dictionaryReferenceUrl(kind: DictionaryReferenceKind, id: string, bindings: Record<string, string> = {}) {
  const base = `${prefixes[kind]}${encodeId(id)}`;
  const query = new URLSearchParams();
  if (kind === "symbol") {
    for (const key of ["x1", "x2", "x3"]) if (bindings[key]) query.set(key, bindings[key]);
  } else {
    const selection = termReferenceSelection(`${base}?${new URLSearchParams(bindings)}`);
    if (selection.form !== "name") query.set("display", selection.form);
    if (selection.form === "alias" && selection.aliasId) query.set("alias", selection.aliasId);
  }
  const encoded = query.toString();
  return encoded ? `${base}?${encoded}` : base;
}

function escapeLabel(label: string) {
  return label.replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
}

export function dictionaryReferenceMarkdown(
  kind: DictionaryReferenceKind,
  entry: Pick<ResearchTermEntry | ResearchSymbolEntry, "id">,
  label: string,
  bindings: Record<string, string> = {},
) {
  return `[${escapeLabel(label)}](${dictionaryReferenceUrl(kind, entry.id, bindings)})`;
}

export type TermReferenceForm = "name" | "full" | "english" | "english-abbreviation" | "chinese-abbreviation" | "alias";
export interface TermReferenceSelection { form: TermReferenceForm; aliasId?: string }

export function termReferenceSelection(url: string | undefined): TermReferenceSelection {
  if (dictionaryReferenceKind(url) !== "term") return { form: "name" };
  const query = new URLSearchParams(url?.split("?", 2)[1] ?? "");
  const form = query.get("display");
  if (form === "full" || form === "english" || form === "english-abbreviation" || form === "chinese-abbreviation") return { form };
  const aliasId = query.get("alias");
  if (form === "alias" && aliasId && validReferenceId(aliasId)) return { form, aliasId };
  return { form: "name" };
}

export function formatTermReference(entry: ResearchTermEntry, selection: TermReferenceSelection = { form: "name" }): string {
  switch (selection.form) {
    case "full": {
      const english = [...new Set([entry.englishName?.trim(), entry.englishAbbreviation?.trim()].filter(Boolean))].join(", ");
      return english ? `${entry.name}（${english}）` : entry.name;
    }
    case "english": return entry.englishName?.trim() || entry.name;
    case "english-abbreviation": return entry.englishAbbreviation?.trim() || entry.name;
    case "chinese-abbreviation": return entry.chineseAbbreviation?.trim() || entry.name;
    case "alias": return researchTermAliases(entry).find(alias => alias.id === selection.aliasId)?.name || entry.name;
    default: return entry.name;
  }
}

export function termReferenceFormats(entry: ResearchTermEntry): TermReferenceSelection[] {
  return [
    { form: "name" }, { form: "full" },
    ...(entry.englishName?.trim() ? [{ form: "english" as const }] : []),
    ...(entry.englishAbbreviation?.trim() ? [{ form: "english-abbreviation" as const }] : []),
    ...(entry.chineseAbbreviation?.trim() ? [{ form: "chinese-abbreviation" as const }] : []),
    ...researchTermAliases(entry).map(alias => ({ form: "alias" as const, aliasId: alias.id })),
  ];
}

export function termReferenceMarkdown(entry: ResearchTermEntry, selection: TermReferenceSelection = { form: "name" }) {
  return dictionaryReferenceMarkdown("term", entry, formatTermReference(entry, selection), {
    display: selection.form, ...(selection.aliasId ? { alias: selection.aliasId } : {}),
  });
}

export interface ResearchTermMention {
  start: number;
  end: number;
  query: string;
}

/** A single # starts a term query; heading markers and Markdown literals keep their meaning. */
export function findResearchTermMention(text: string, caret: number): ResearchTermMention | null {
  const match = /#([^#\n@$￥]{0,80})$/.exec(text.slice(0, caret));
  if (!match || /^[\t ]/.test(match[1]) || /[\]<>]/.test(match[1])) return null;
  const start = caret - match[1].length - 1;
  const prefix = text.slice(0, start);
  const escaped = (index: number) => {
    let count = 0;
    while (text[--index] === "\\") count++;
    return count % 2 === 1;
  };
  if (escaped(start) || text[start - 1] === "#" || text[start + 1] === "#" || /[A-Za-z0-9_./%+-]$/.test(prefix) || /(?:https?:\/\/|www\.)\S*$/i.test(prefix)) return null;
  const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
  if (/\]\([^)]*$/.test(line) || /<[^>]*$/.test(line) || (line.replace(/\\./g, "").match(/`+/g)?.length ?? 0) % 2) return null;
  const ignored: { start: number; end: number }[] = [];
  let blocked = false;
  const visit = (node: TextNode) => {
    const a = node.position?.start.offset, b = node.position?.end.offset;
    if (a !== undefined && b !== undefined && ignoredTypes.has(node.type)) {
      ignored.push({ start: a, end: b });
      if (a <= start && start < b) blocked = true;
      return;
    }
    node.children?.forEach(visit);
  };
  visit(parser.parse(text) as TextNode);
  if (blocked) return null;
  let math = 0;
  for (let index = 0; index < start; index++) {
    const range = ignored.find(range => range.start <= index && index < range.end);
    if (range) { index = range.end - 1; continue; }
    if (text[index] !== "$" || escaped(index)) continue;
    let count = 1;
    while (text[index + count] === "$" && index + count < start) count++;
    const delimiter = count === 1 ? 1 : 2;
    if (math === delimiter) math = 0;
    else if (!math) math = delimiter;
    index += count - 1;
  }
  return math ? null : { start, end: caret, query: match[1] };
}

export function insertResearchTermMention(text: string, mention: ResearchTermMention, entry: ResearchTermEntry, selection?: TermReferenceSelection) {
  const link = termReferenceMarkdown(entry, selection);
  return { text: text.slice(0, mention.start) + link + text.slice(mention.end), caret: mention.start + link.length };
}

export function searchResearchTerms(terms: readonly ResearchTermEntry[], query: string) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return terms.filter(entry => {
    const searchable = [entry.name, entry.englishName, entry.englishAbbreviation, entry.chineseAbbreviation, ...entry.aliases, entry.meaning, entry.scope, ...(entry.tags ?? [])].join(" ").toLocaleLowerCase();
    return tokens.every(token => searchable.includes(token));
  });
}

export interface ResearchTermUse {
  noteId: string;
  noteTitle: string;
  blockId: string;
}

function blockText(block: ResearchNotebookBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "markdown":
    case "callout":
      return block.text;
    case "list":
      return block.items.join("\n");
    case "evidence":
      return block.note ?? "";
    default:
      return "";
  }
}

export function listTermUses(notes: readonly ResearchNote[], entryId: string): ResearchTermUse[] {
  const marker = dictionaryReferenceUrl("term", entryId);
  return notes.flatMap(note => flattenResearchBlocks(note.blocks).flatMap(block => blockText(block).includes(marker)
    ? [{ noteId: note.id, noteTitle: note.title, blockId: block.id }]
    : []));
}

export function addTermEntry(state: ResearchNotebookState, entry: ResearchTermEntry): ResearchNotebookState {
  const terms = state.terms ?? [];
  if (termEntryError(entry, terms)) return state;
  return { ...state, terms: [...terms, entry] };
}

export function updateTermEntry(state: ResearchNotebookState, entry: ResearchTermEntry): ResearchNotebookState {
  const terms = state.terms ?? [];
  const current = terms.find(item => item.id === entry.id);
  if (!current || termEntryError(entry, terms)) return state;
  if (JSON.stringify(current) === JSON.stringify(entry)) return state;
  const notes = JSON.stringify(current) === JSON.stringify(entry) ? state.notes : invalidateResearchReviews(state.notes, listTermUses(state.notes, entry.id).map(use => use.noteId));
  return { ...state, terms: terms.map(item => item.id === entry.id ? entry : item), notes };
}

export function deleteTermEntry(state: ResearchNotebookState, entryId: string): ResearchNotebookState {
  if (!state.terms?.some(item => item.id === entryId) || listTermUses(state.notes, entryId).length) return state;
  return { ...state, terms: state.terms.filter(item => item.id !== entryId) };
}

export interface ResearchDictionaryTextHit {
  kind: DictionaryReferenceKind;
  entryId: string;
  matchedText: string;
  start: number;
  end: number;
  context: string;
}

export function replaceResearchDictionaryText(text: string, hit: Pick<ResearchDictionaryTextHit, "start" | "end">, replacement: string) {
  if (hit.start < 0 || hit.end < hit.start || hit.end > text.length) return text;
  return text.slice(0, hit.start) + replacement + text.slice(hit.end);
}

type TextNode = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: TextNode[];
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const ignoredTypes = new Set(["code", "inlineCode", "link", "linkReference", "image", "html", "math", "inlineMath", "definition"]);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scanRanges(text: string) {
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: TextNode, blocked = false) => {
    const nextBlocked = blocked || ignoredTypes.has(node.type);
    if (!nextBlocked && node.type === "text" && typeof node.value === "string" && node.position?.start.offset !== undefined && node.position.end.offset !== undefined)
      ranges.push({ start: node.position.start.offset, end: node.position.end.offset });
    node.children?.forEach(child => visit(child, nextBlocked));
  };
  visit(parser.parse(text) as TextNode);
  return ranges;
}

export function scanResearchDictionaryText(
  text: string,
  symbols: readonly ResearchSymbolEntry[] = [],
  terms: readonly ResearchTermEntry[] = [],
): ResearchDictionaryTextHit[] {
  const legacyLabels = (name: string, aliases: readonly string[] | undefined) => [...new Set([name, ...(aliases ?? [])])];
  const definitions: { kind: DictionaryReferenceKind; id: string; label: string }[] = [
    ...terms.flatMap(entry => legacyLabels(entry.name, [...entry.aliases, entry.englishName ?? "", entry.englishAbbreviation ?? "", entry.chineseAbbreviation ?? ""])
      .map(label => ({ kind: "term" as const, id: entry.id, label })).filter(item => item.label)),
    ...symbols.flatMap(entry => {
      const value = entry as ResearchSymbolEntry & { aliases?: string[] };
      return legacyLabels(value.name, value.aliases).map(label => ({ kind: "symbol" as const, id: entry.id, label })).filter(item => item.label);
    }),
  ].sort((a, b) => b.label.length - a.label.length);
  if (!definitions.length) return [];
  const urlRanges = [...text.matchAll(/https?:\/\/[^\s)]+/gi)].map(match => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
  const hits: ResearchDictionaryTextHit[] = [];
  for (const range of scanRanges(text)) {
    const source = text.slice(range.start, range.end);
    for (const definition of definitions) {
      const pattern = new RegExp(escapeRegExp(definition.label), "giu");
      for (const match of source.matchAll(pattern)) {
        const start = range.start + (match.index ?? 0);
        const end = start + match[0].length;
        if (/^[A-Za-z0-9_]/.test(definition.label) && /[A-Za-z0-9_]/.test(text[start - 1] ?? "")) continue;
        if (/[A-Za-z0-9_]$/.test(definition.label) && /[A-Za-z0-9_]/.test(text[end] ?? "")) continue;
        if (urlRanges.some(url => start < url.end && end > url.start)) continue;
        if (hits.some(hit => start < hit.end && end > hit.start)) continue;
        hits.push({
          kind: definition.kind,
          entryId: definition.id,
          matchedText: match[0],
          start,
          end,
          context: text.slice(Math.max(0, start - 24), Math.min(text.length, end + 24)).replace(/\s+/g, " "),
        });
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start || b.end - a.end);
}
