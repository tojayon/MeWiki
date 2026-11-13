import { Fragment, Schema, type Node as EditorNode } from "prosemirror-model";
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

export const referenceEditorSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", whitespace: "pre", toDOM: () => ["div", { class: "research-reference-line" }, 0], parseDOM: [{ tag: "div", preserveWhitespace: "full" }] },
    text: { group: "inline" },
    hard_break: { inline: true, group: "inline", selectable: false, linebreakReplacement: true, toDOM: () => ["br"], parseDOM: [{ tag: "br" }] },
    reference: {
      group: "inline", inline: true, atom: true, selectable: true, draggable: false,
      attrs: { source: {}, href: {}, kind: {}, label: {} },
      // Clipboard parsing is handled explicitly; pasted HTML can never inject an arbitrary node.
      toDOM: node => ["span", { "data-mewiki-reference": node.attrs.source, "data-reference-kind": node.attrs.kind, contenteditable: "false" }, node.attrs.label],
      leafText: node => node.attrs.label,
    },
  },
});

export function createReferenceDocument(source: string): EditorNode {
  const nodes: EditorNode[] = [];
  let cursor = 0;
  for (const token of researchReferenceTokens(source)) {
    if (token.start > cursor) nodes.push(referenceEditorSchema.text(source.slice(cursor, token.start)));
    const { source: raw, href, kind, label } = token;
    nodes.push(referenceEditorSchema.nodes.reference.create({ source: raw, href, kind, label })); cursor = token.end;
  }
  if (cursor < source.length) nodes.push(referenceEditorSchema.text(source.slice(cursor)));
  return referenceEditorSchema.nodes.doc.create(null, referenceEditorSchema.nodes.paragraph.create(null, nodes));
}

export function referenceFragmentSource(fragment: Fragment): string {
  let source = "";
  fragment.forEach((node, _offset, index) => {
    if (index > 0 && node.isBlock) source += "\n";
    source += node.type.name === "reference" ? node.attrs.source : node.type.name === "hard_break" ? "\n" : node.isText ? node.text : referenceFragmentSource(node.content);
  });
  return source;
}
export function referenceDocumentSource(doc: EditorNode): string { return referenceFragmentSource(doc.content); }

/** A copied atom must carry its source even if the original used a definition elsewhere in the block. */
export function referenceClipboardSource(fragment: Fragment): string {
  let source = "";
  fragment.forEach((node, _offset, index) => {
    if (index > 0 && node.isBlock) source += "\n";
    if (node.type.name === "reference") {
      const raw = String(node.attrs.source);
      const label = String(node.attrs.label).replace(/[\t\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
      const href = String(node.attrs.href).replace(/[\\\s()<>"]/g, char => char === "(" ? "%28" : char === ")" ? "%29" : encodeURIComponent(char));
      source += !/[\t\r\n]/.test(raw) && researchReferenceTokens(raw).length ? raw : `[${label}](${href})`;
    } else source += node.isText ? node.text : node.type.name === "hard_break" ? "\n" : referenceClipboardSource(node.content);
  });
  return source;
}

/** Snap offsets inside a reference to its boundaries; no public operation can split its Markdown. */
export function referencePositionAt(doc: EditorNode, offset: number, bias = 1): number {
  let source = 0, result = 1;
  doc.forEach((block, blockOffset, index) => {
    if (index > 0) source++;
    if (offset >= source) result = blockOffset + 1;
    block.forEach((node, position) => {
      const size = node.type.name === "reference" ? String(node.attrs.source).length : node.isText ? node.text!.length : 1;
      if (offset > source + size) result = blockOffset + position + node.nodeSize + 1;
      else if (offset >= source) result = blockOffset + position + 1 + (node.isText ? Math.max(0, offset - source) : offset === source ? 0 : offset === source + size || bias > 0 ? node.nodeSize : 0);
      source += size;
    });
  });
  return Math.min(doc.content.size - 1, result);
}
export function referenceSourceOffset(doc: EditorNode, position: number): number {
  let source = 0;
  doc.forEach((block, blockOffset, index) => {
    if (position < blockOffset + 1) return;
    if (index > 0) source++;
    block.forEach((node, offset) => {
      if (position <= blockOffset + offset + 1) return;
      source += node.isText ? Math.min(node.nodeSize, position - blockOffset - offset - 1) : node.type.name === "reference" ? String(node.attrs.source).length : 1;
    });
  });
  return source;
}
