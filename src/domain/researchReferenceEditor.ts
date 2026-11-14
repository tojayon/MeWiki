import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { dictionaryReferenceKind, dictionaryReferenceUrl } from "./researchTerms.ts";
import { researchNoteLinkId } from "./researchNoteLinks.ts";
import { resolveSymbolEntry, type ResearchSymbolEntry } from "./researchDictionary.ts";

export type ResearchReferenceKind = "term" | "symbol" | "note" | "file";
export interface ResearchReferenceToken {
  start: number; end: number; source: string; href: string; label: string; kind: ResearchReferenceKind;
}
interface MarkdownNode {
  type: string; value?: string; url?: string; identifier?: string;
  position?: { start: { offset?: number }; end: { offset?: number } }; children?: MarkdownNode[];
}
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
export const referenceAssetPattern = /^webbench-asset:([a-f0-9]{64})(?:#page=([1-9]\d*))?$/;

export function editedResearchSymbolReference(entry: ResearchSymbolEntry, overrides: Record<string, string>): string {
  const bindings = { ...Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue])), ...overrides };
  const original = dictionaryReferenceUrl("symbol", entry.id, bindings);
  const [base, query] = original.split("?"), parameters = new URLSearchParams(query);
  // Empty and absent differ: x2= explicitly suppresses a nonempty dictionary default.
  for (const slot of entry.slots) if (slot.defaultValue && overrides[slot.key] === "") parameters.set(slot.key, "");
  const href = parameters.size ? `${base}?${parameters}` : base;
  const label = `$${resolveSymbolEntry(entry, bindings).tex}$`.replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
  return `[${label}](${href})`;
}

export function researchReferenceKind(href: string): ResearchReferenceKind | null {
  return dictionaryReferenceKind(href) ?? (researchNoteLinkId(href) ? "note" : referenceAssetPattern.test(href) ? "file" : null);
}

/** Only known, sourced links become atoms. Positions always refer to the unmodified Markdown. */
export function researchReferenceTokens(source: string): ResearchReferenceToken[] {
  const root = parser.parse(source) as MarkdownNode, definitions = new Map<string, string>();
  const collect = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    node.children?.forEach(collect);
  };
  collect(root);
  const result: ResearchReferenceToken[] = [];
  const label = (node: MarkdownNode): string => node.value ?? node.children?.map(label).join("") ?? "";
  const visit = (node: MarkdownNode) => {
    if (["code", "inlineCode", "math", "inlineMath", "html", "image", "imageReference", "definition"].includes(node.type)) return;
    const href = node.type === "link" ? node.url : node.type === "linkReference" ? definitions.get(node.identifier ?? "") : undefined;
    const kind = href && researchReferenceKind(href), start = node.position?.start.offset, end = node.position?.end.offset;
    if (href && kind && start !== undefined && end !== undefined) {
      result.push({ start, end, source: source.slice(start, end), href, kind, label: label(node) });
      return;
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return result;
}

export { referenceEditorSchema, createReferenceDocument, referenceFragmentSource, referenceDocumentSource, referenceClipboardSource, referencePositionAt, referenceSourceOffset, referenceDocumentsEqual } from "./researchRichText.ts";
