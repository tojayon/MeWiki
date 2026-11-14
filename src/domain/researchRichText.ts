import { Fragment, Schema, type Mark, type Node as EditorNode } from "prosemirror-model";
import { defaultMarkdownSerializer, MarkdownSerializer } from "prosemirror-markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { RootContent, PhrasingContent } from "mdast";
import { researchReferenceTokens } from "./researchReferenceEditor.ts";

type Point = { position: number; offset: number };
type Projection = { source: string; points: Point[] };
type Built = { node: EditorNode; points: Point[] };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const gap = { default: null };
const safeHref = (href: string) => /^(?:https?:|mailto:|#|webbench-asset:)/i.test(href) ? href : "";

/** Real document structure: Markdown punctuation never becomes the editable heading or emphasis. */
export const referenceEditorSchema = new Schema({
  nodes: {
    doc: { content: "block+", attrs: { original: { default: null }, source: { default: null }, points: { default: null } } },
    paragraph: { content: "inline*", group: "block", attrs: { gap }, toDOM: () => ["p", { class: "research-reference-line" }, 0], parseDOM: [{ tag: "p", preserveWhitespace: "full" }, { tag: "div", preserveWhitespace: "full" }] },
    heading: { content: "inline*", group: "block", defining: true, attrs: { gap, level: { default: 2 } },
      toDOM: node => [`h${node.attrs.level}`, 0], parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${level}`, attrs: { level }, preserveWhitespace: "full" as const })) },
    blockquote: { content: "block+", group: "block", defining: true, attrs: { gap }, toDOM: () => ["blockquote", 0], parseDOM: [{ tag: "blockquote" }] },
    bullet_list: { content: "list_item+", group: "block", attrs: { gap, tight: { default: true } }, toDOM: node => ["ul", { "data-tight": String(node.attrs.tight) }, 0], parseDOM: [{ tag: "ul", getAttrs: dom => ({ tight: dom.getAttribute("data-tight") !== "false" }) }] },
    ordered_list: { content: "list_item+", group: "block", attrs: { gap, order: { default: 1 }, tight: { default: true } },
      toDOM: node => ["ol", { start: node.attrs.order, "data-tight": String(node.attrs.tight) }, 0], parseDOM: [{ tag: "ol", getAttrs: dom => ({ order: Number(dom.getAttribute("start") ?? 1), tight: dom.getAttribute("data-tight") !== "false" }) }] },
    list_item: { content: "paragraph block*", defining: true, attrs: { gap, checked: { default: null } },
      toDOM: node => ["li", node.attrs.checked === null ? {} : { class: "task-list-item", "data-checked": String(node.attrs.checked) }, 0], parseDOM: [{ tag: "li", getAttrs: dom => ({ checked: dom.hasAttribute("data-checked") ? dom.getAttribute("data-checked") === "true" : null }) }] },
    code_block: { content: "text*", group: "block", marks: "", code: true, defining: true, attrs: { gap, language: { default: "" }, meta: { default: null } },
      toDOM: node => ["pre", { "data-language": node.attrs.language }, ["code", 0]], parseDOM: [{ tag: "pre", preserveWhitespace: "full" }] },
    horizontal_rule: { group: "block", attrs: { gap }, toDOM: () => ["hr"], parseDOM: [{ tag: "hr" }] },
    math_block: { group: "block", atom: true, attrs: { gap, source: {}, tex: {} }, toDOM: node => ["div", { "data-math-source": node.attrs.source }, node.attrs.tex] },
    raw_block: { group: "block", atom: true, attrs: { gap, source: {}, hidden: { default: false } }, toDOM: node => ["div", { "data-markdown-source": node.attrs.source, ...(node.attrs.hidden ? { hidden: "" } : {}) }] },
    text: { group: "inline" },
    hard_break: { inline: true, group: "inline", selectable: false, linebreakReplacement: true, toDOM: () => ["br"], parseDOM: [{ tag: "br" }] },
    inline_math: { inline: true, group: "inline", atom: true, attrs: { source: {}, tex: {} }, toDOM: node => ["span", { "data-math-source": node.attrs.source }, node.attrs.tex], leafText: node => node.attrs.tex },
    image: { inline: true, group: "inline", atom: true, attrs: { source: {}, src: {}, alt: { default: "" }, title: { default: null } },
      toDOM: node => ["img", { src: safeHref(node.attrs.src), alt: node.attrs.alt, title: node.attrs.title }], leafText: node => node.attrs.alt },
    reference: { inline: true, group: "inline", atom: true, selectable: true, draggable: false, attrs: { source: {}, href: {}, kind: {}, label: {} },
      toDOM: node => ["span", { "data-mewiki-reference": node.attrs.source, "data-reference-kind": node.attrs.kind, contenteditable: "false" }, node.attrs.label], leafText: node => node.attrs.label },
  },
  marks: {
    strong: { attrs: { delimiter: { default: "**" } }, toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }, { tag: "b" }] },
    em: { attrs: { delimiter: { default: "*" } }, toDOM: () => ["em", 0], parseDOM: [{ tag: "em" }, { tag: "i" }] },
    strike: { toDOM: () => ["del", 0], parseDOM: [{ tag: "del" }, { tag: "s" }] },
    code: { code: true, excludes: "_", attrs: { delimiter: { default: "`" } }, toDOM: () => ["code", 0], parseDOM: [{ tag: "code" }] },
    link: { inclusive: false, attrs: { href: {}, title: { default: null } }, toDOM: mark => ["a", { href: safeHref(mark.attrs.href), title: mark.attrs.title }, 0], parseDOM: [{ tag: "a[href]", getAttrs: dom => ({ href: safeHref(dom.getAttribute("href") ?? ""), title: dom.getAttribute("title") }) }] },
    literal: { inclusive: false, attrs: { source: {}, value: {} }, toDOM: () => ["span", 0] },
  },
});

/** Escapes, entities and quote/list continuation prefixes have unequal visible/source lengths. */
function decodedPoints(raw: string, value: string, offset: number, position = 0): Point[] {
  const points: Point[] = [];
  let cursor = 0;
  for (let i = 0; i < raw.length && cursor < value.length;) {
    const token = /^(?:\\[!-/:-@[-`{-~]|\r\n|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);)/.exec(raw.slice(i))?.[0] ?? String.fromCodePoint(raw.codePointAt(i)!);
    let decoded = token.startsWith("\\") ? token.slice(1) : token === "\r\n" ? "\n" : token;
    if (token.startsWith("&") && token.length > 1) {
      const paragraph = parser.parse(token).children[0];
      if (paragraph?.type === "paragraph" && paragraph.children[0]?.type === "text") decoded = paragraph.children[0].value;
    }
    if (value.startsWith(decoded, cursor)) {
      for (let j = 0; j < decoded.length; j++) points.push({ position: position + cursor + j, offset: offset + i });
      cursor += decoded.length;
      points.push({ position: position + cursor, offset: offset + i + token.length });
    }
    i += token.length;
  }
  return points;
}

function codePoints(raw: string, value: string, offset: number, position = 0): Point[] {
  const points: Point[] = []; let cursor = 0;
  for (let i = 0; i < value.length; i++) {
    const found = raw.indexOf(value[i], cursor);
    if (found >= 0) cursor = found;
    points.push({ position: position + i, offset: offset + cursor }); cursor++;
  }
  points.push({ position: position + value.length, offset: offset + cursor }); return points;
}

export function createReferenceDocument(source: string): EditorNode {
  const tree = parser.parse(source), tokens = new Map(researchReferenceTokens(source).map(token => [token.start, token]));
  const definitions = new Map<string, { url: string; title?: string | null }>();
  const collectDefinitions = (node: { type: string; identifier?: string; url?: string; title?: string | null; children?: unknown[] }) => {
    if (node.type === "definition" && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, { url: node.url, title: node.title });
    node.children?.forEach(child => collectDefinitions(child as Parameters<typeof collectDefinitions>[0]));
  };
  collectDefinitions(tree);
  const start = (node: RootContent | PhrasingContent) => node.position?.start.offset ?? 0;
  const end = (node: RootContent | PhrasingContent) => node.position?.end.offset ?? start(node);
  const inline = (children: PhrasingContent[], marks: readonly Mark[] = []): { nodes: EditorNode[]; points: Point[] } => {
    const nodes: EditorNode[] = [], points: Point[] = [];
    let size = 0;
    const push = (node: EditorNode, map: Point[]) => { nodes.push(node); points.push(...map.map(point => ({ ...point, position: point.position + size }))); size += node.nodeSize; };
    for (const ast of children) {
      const from = start(ast), to = end(ast), raw = source.slice(from, to), token = tokens.get(from);
      if (token) { push(referenceEditorSchema.nodes.reference.create(token, null, marks), [{ position: 0, offset: from }, { position: 1, offset: to }]); continue; }
      if (ast.type === "strong" || ast.type === "emphasis" || ast.type === "delete" || ast.type === "link" || ast.type === "linkReference") {
        const type = ast.type === "strong" ? "strong" : ast.type === "emphasis" ? "em" : ast.type === "delete" ? "strike" : "link";
        const definition = ast.type === "linkReference" ? definitions.get(ast.identifier) : undefined;
        const attrs = type === "strong" || type === "em" ? { delimiter: raw.slice(0, type === "strong" ? 2 : 1) }
          : type === "link" ? { href: ast.type === "link" ? ast.url : definition?.url ?? "", title: ast.type === "link" ? ast.title : definition?.title } : null;
        const content = inline(ast.children, [...marks, referenceEditorSchema.marks[type].create(attrs)]);
        nodes.push(...content.nodes); points.push(...content.points.map(point => ({ ...point, position: point.position + size }))); size += content.nodes.reduce((sum, node) => sum + node.nodeSize, 0);
      } else if (ast.type === "text" || ast.type === "inlineCode") {
        if (!ast.value) continue;
        const code = ast.type === "inlineCode", delimiter = /^`+/.exec(raw)?.[0] ?? "`";
        const inner = raw.slice(delimiter.length, -delimiter.length), padding = code && inner.startsWith(" ") && inner.endsWith(" ") && !/^ +$/.test(inner) ? 1 : 0;
        const mapped = code ? codePoints(inner.slice(padding).replaceAll("\n", " "), ast.value, from + delimiter.length + padding) : decodedPoints(raw, ast.value, from);
        const extra = code ? referenceEditorSchema.marks.code.create({ delimiter }) : raw !== ast.value ? referenceEditorSchema.marks.literal.create({ source: raw, value: ast.value }) : null;
        push(referenceEditorSchema.text(ast.value, extra ? [...marks, extra] : marks), mapped);
      } else if (ast.type === "break") push(referenceEditorSchema.nodes.hard_break.create(null, null, marks), [{ position: 0, offset: from }, { position: 1, offset: to }]);
      else if (ast.type === "inlineMath") push(referenceEditorSchema.nodes.inline_math.create({ source: raw, tex: ast.value }, null, marks), [{ position: 0, offset: from }, { position: 1, offset: to }]);
      else if (ast.type === "image" || ast.type === "imageReference") push(referenceEditorSchema.nodes.image.create({ source: raw, src: ast.type === "image" ? ast.url : definitions.get(ast.identifier)?.url ?? "", alt: ast.alt, title: ast.type === "image" ? ast.title : null }, null, marks), [{ position: 0, offset: from }, { position: 1, offset: to }]);
      else if (raw) push(referenceEditorSchema.text(raw, marks), Array.from({ length: raw.length + 1 }, (_, i) => ({ position: i, offset: from + i })));
    }
    return { nodes, points };
  };
  const block = (ast: RootContent, previousEnd: number): Built => {
    const from = start(ast), to = end(ast), attrs = { gap: source.slice(previousEnd, from) };
    if (ast.type === "paragraph" || ast.type === "heading") {
      const content = inline(ast.children), type = ast.type === "heading" ? "heading" : "paragraph";
      const node = referenceEditorSchema.nodes[type].create({ ...attrs, ...(ast.type === "heading" ? { level: ast.depth } : {}) }, content.nodes);
      return { node, points: content.points.length ? content.points.map(point => ({ ...point, position: point.position + 1 })) : [{ position: 1, offset: to }] };
    }
    if (ast.type === "blockquote" || ast.type === "list" || ast.type === "listItem") {
      const type = ast.type === "blockquote" ? "blockquote" : ast.type === "listItem" ? "list_item" : ast.ordered ? "ordered_list" : "bullet_list";
      const children = ast.children.map((child, index) => block(child as RootContent, index ? end(ast.children[index - 1] as RootContent) : from));
      if (!children.length) children.push({ node: referenceEditorSchema.nodes.paragraph.create(), points: [{ position: 1, offset: to }] });
      const points: Point[] = []; let offset = 1;
      children.forEach(child => { points.push(...child.points.map(point => ({ ...point, position: point.position + offset }))); offset += child.node.nodeSize; });
      return { node: referenceEditorSchema.nodes[type].create({ ...attrs, ...(ast.type === "listItem" ? { checked: ast.checked ?? null } : ast.type === "list" ? { order: ast.start ?? 1, tight: !ast.spread } : {}) }, children.map(child => child.node)), points };
    }
    if (ast.type === "code") {
      const raw = source.slice(from, to), fence = /^(?:`{3,}|~{3,})[^\n]*\n/.exec(raw);
      const at = from + (fence?.[0].length ?? 0);
      return { node: referenceEditorSchema.nodes.code_block.create({ ...attrs, language: ast.lang ?? "", meta: ast.meta ?? null }, ast.value ? referenceEditorSchema.text(ast.value) : null), points: codePoints(source.slice(at, to), ast.value, at, 1) };
    }
    if (ast.type === "thematicBreak") return { node: referenceEditorSchema.nodes.horizontal_rule.create(attrs), points: [] };
    if (ast.type === "math") return { node: referenceEditorSchema.nodes.math_block.create({ ...attrs, source: source.slice(from, to), tex: ast.value }), points: [] };
    return { node: referenceEditorSchema.nodes.raw_block.create({ ...attrs, source: source.slice(from, to), hidden: ast.type === "definition" || ast.type === "html" }), points: [] };
  };
  const children = tree.children.map((ast, index) => block(ast, index ? end(tree.children[index - 1]) : 0));
  if (!children.length) children.push({ node: referenceEditorSchema.nodes.paragraph.create(), points: [{ position: 1, offset: source.length }] });
  const points: Point[] = []; let position = 0;
  children.forEach(child => { points.push(...child.points.map(point => ({ ...point, position: point.position + position }))); position += child.node.nodeSize; });
  const content = Fragment.from(children.map(child => child.node));
  return referenceEditorSchema.nodes.doc.create({ original: content.toJSON(), source, points }, content);
}

const projections = new WeakMap<EditorNode, Projection>();
const pointIndexes = new WeakMap<Point[], Map<number, { min: number; max: number }>>();
function offsetAt(points: Point[], position: number, bias = 1): number {
  let index = pointIndexes.get(points);
  if (!index) {
    index = new Map(); points.forEach(point => { const existing = index!.get(point.position); index!.set(point.position, { min: Math.min(existing?.min ?? Infinity, point.offset), max: Math.max(existing?.max ?? -Infinity, point.offset) }); });
    pointIndexes.set(points, index);
  }
  const exact = index.get(position);
  if (exact) return bias > 0 ? exact.max : exact.min;
  const closest = points.reduce<Point | null>((best, point) => !best || Math.abs(point.position - position) < Math.abs(best.position - position) ? point : best, null);
  return closest?.offset ?? 0;
}
type Edit = { from: number; to: number; start: number; end: number; text: string; raw: string; offsets: number[] };
function originalProjection(doc: EditorNode): Projection | null {
  if (typeof doc.attrs.source !== "string" || !doc.attrs.original) return null;
  const original = Fragment.fromJSON(referenceEditorSchema, doc.attrs.original), points = doc.attrs.points as Point[], edits: Edit[] = [];
  const visit = (before: EditorNode, after: EditorNode, position: number, code = false): boolean => {
    if (before.eq(after)) return true;
    if (before.type !== after.type || !before.sameMarkup(after) || before.childCount !== after.childCount) return false;
    if (before.isText) {
      const old = before.text!, next = after.text!; let from = 0, tail = 0;
      while (from < old.length && from < next.length && old[from] === next[from]) from++;
      while (tail < old.length - from && tail < next.length - from && old[old.length - tail - 1] === next[next.length - tail - 1]) tail++;
      const start = offsetAt(points, position + from, from === old.length ? -1 : 1), end = offsetAt(points, position + old.length - tail, -1);
      const text = next.slice(from, next.length - tail);
      const literalCode = code || before.marks.some(mark => mark.type.name === "code");
      let raw = ""; const offsets: number[] = [];
      for (const char of text) { offsets.push(raw.length); if (!literalCode && /[\\`*_[\]~$<>!#&|]/.test(char)) raw += "\\"; raw += char; if (char.length === 2) offsets.push(raw.length - 1); }
      offsets.push(raw.length);
      edits.push({ from: position + from, to: position + old.length - tail, start, end: Math.max(start, end), text, raw, offsets }); return true;
    }
    let offset = position + 1;
    for (let i = 0; i < before.childCount; i++) { if (!visit(before.child(i), after.child(i), offset, code || !!before.type.spec.code)) return false; offset += before.child(i).nodeSize; }
    return true;
  };
  if (original.childCount !== doc.childCount) return null;
  let position = 0;
  for (let i = 0; i < original.childCount; i++) { if (!visit(original.child(i), doc.child(i), position)) return null; position += original.child(i).nodeSize; }
  let source = doc.attrs.source as string;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.raw + source.slice(edit.end);
  if (edits.length && !referenceDocumentsEqual(doc, createReferenceDocument(source))) return null;
  const shifted = (value: number, coordinate: "source" | "position") => value + edits.reduce((sum, edit) => sum + (value >= (coordinate === "source" ? edit.end : edit.to) ? coordinate === "source" ? edit.raw.length - (edit.end - edit.start) : edit.text.length - (edit.to - edit.from) : 0), 0);
  const mapped = points.filter(point => !edits.some(edit => point.position >= edit.from && point.position <= edit.to)).map(point => ({ position: shifted(point.position, "position"), offset: shifted(point.offset, "source") }));
  for (const edit of edits) {
    const before = edits.filter(other => other !== edit && other.from < edit.from);
    const at = edit.from + before.reduce((sum, other) => sum + other.text.length - (other.to - other.from), 0);
    const start = edit.start + before.reduce((sum, other) => sum + other.raw.length - (other.end - other.start), 0);
    for (let i = 0; i <= edit.text.length; i++) mapped.push({ position: at + i, offset: start + edit.offsets[i] });
  }
  return { source, points: mapped };
}

/** The CommonMark serializer handles whitespace, escaping and delimiter boundaries. */
function serializer(clipboard: boolean) {
  return new MarkdownSerializer({
    ...defaultMarkdownSerializer.nodes,
    code_block(state, node) {
      const runs = [...node.textContent.matchAll(/`+/g)].map(match => match[0].length + 1);
      const fence = String.fromCharCode(96).repeat(Math.max(3, ...runs));
      state.write(fence + node.attrs.language + (node.attrs.meta ? " " + node.attrs.meta : "") + "\n"); state.text(node.textContent, false); state.write("\n" + fence); state.closeBlock(node);
    },
    bullet_list(state, node) { state.renderList(node, "  ", () => "- "); },
    list_item(state, node) { if (node.attrs.checked !== null) state.write(node.attrs.checked ? "[x] " : "[ ] "); state.renderContent(node); },
    reference(state, node) {
      let raw = String(node.attrs.source);
      if (clipboard && (/[\t\r\n]/.test(raw) || !researchReferenceTokens(raw).length)) {
        const label = String(node.attrs.label).replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
        const href = String(node.attrs.href).replace(/[\s()<>"\\]/g, char => char === "(" ? "%28" : char === ")" ? "%29" : encodeURIComponent(char));
        raw = "[" + label + "](" + href + ")";
      }
      state.write(raw);
    },
    inline_math(state, node) { state.write(node.attrs.source); },
    image(state, node) { state.write(node.attrs.source); },
    math_block(state, node) { state.write(node.attrs.source); state.closeBlock(node); },
    raw_block(state, node) { state.write(node.attrs.source); state.closeBlock(node); },
  }, {
    ...defaultMarkdownSerializer.marks,
    strong: { ...defaultMarkdownSerializer.marks.strong, open: (_state, mark) => mark.attrs.delimiter, close: (_state, mark) => mark.attrs.delimiter },
    em: { ...defaultMarkdownSerializer.marks.em, open: (_state, mark) => mark.attrs.delimiter, close: (_state, mark) => mark.attrs.delimiter },
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    link: { open: "[", close: (_state, mark) => "](<" + String(mark.attrs.href).replace(/[<>\\\r\n]/g, char => encodeURIComponent(char)) + ">" + (mark.attrs.title ? " \"" + String(mark.attrs.title).replaceAll("\"", "\\\"") + "\"" : "") + ")" },
    literal: { open: "", close: "", mixable: true },
  }, { escapeExtraCharacters: /[$<&|]/g });
}
function sourceUnits(doc: EditorNode): { key: string; from: number; to: number }[] {
  const result: { key: string; from: number; to: number }[] = [];
  doc.descendants((node, at) => {
    if (node.isText) for (let i = 0; i < node.text!.length; i++) result.push({ key: node.text![i], from: at + i, to: at + i + 1 });
    else if (node.isLeaf && node.isInline) result.push({ key: node.type.name + (node.attrs.source ?? ""), from: at, to: at + node.nodeSize });
  });
  return result;
}
function canonical(fragment: Fragment, clipboard = false): Projection {
  const inline = fragment.firstChild?.isInline;
  const content = inline ? Fragment.from(referenceEditorSchema.nodes.paragraph.create(null, fragment)) : fragment;
  const doc = referenceEditorSchema.nodes.doc.create(null, content);
  const source = serializer(clipboard).serialize(doc, { tightLists: true });
  const parsed = createReferenceDocument(source), parsedPoints = parsed.attrs.points as Point[];
  const before = sourceUnits(doc), after = sourceUnits(parsed), points: Point[] = [];
  // Text and atoms retain their order even when a serializer merges adjacent marked runs.
  if (before.length === after.length && before.every((unit, index) => unit.key === after[index].key)) {
    before.forEach((unit, i) => {
      points.push({ position: unit.from - (inline ? 1 : 0), offset: offsetAt(parsedPoints, after[i].from) });
      points.push({ position: unit.to - (inline ? 1 : 0), offset: offsetAt(parsedPoints, after[i].to, -1) });
    });
  }
  // Empty paragraphs and newly split list items also need a valid caret position.
  const empty: number[] = [], parsedEmpty: number[] = [];
  doc.descendants((node, at) => { if (node.isTextblock && !node.content.size) empty.push(at + 1); });
  parsed.descendants((node, at) => { if (node.isTextblock && !node.content.size) parsedEmpty.push(at + 1); });
  empty.forEach((position, i) => points.push({ position, offset: parsedEmpty[i] !== undefined ? offsetAt(parsedPoints, parsedEmpty[i]) : source.length }));
  return { source, points };
}

function projection(doc: EditorNode): Projection {
  let result = projections.get(doc);
  if (!result) { result = originalProjection(doc) ?? canonical(doc.content); projections.set(doc, result); }
  return result;
}
export function referenceDocumentSource(doc: EditorNode): string { return projection(doc).source; }
export function referenceFragmentSource(fragment: Fragment): string { return canonical(fragment).source; }
export function referenceClipboardSource(fragment: Fragment): string { return canonical(fragment, true).source; }
export function referenceSourceOffset(doc: EditorNode, position: number): number { return offsetAt(projection(doc).points, position); }
export function referencePositionAt(doc: EditorNode, offset: number, bias = 1): number {
  const points = projection(doc).points;
  if (!points.length) return 0;
  const sorted = [...points].sort((a, b) => a.offset - b.offset);
  const exact = sorted.filter(point => point.offset === offset);
  if (exact.length) return (bias > 0 ? exact.at(-1) : exact[0])!.position;
  const before = sorted.filter(point => point.offset < offset).at(-1), after = sorted.find(point => point.offset > offset);
  return (bias > 0 ? after ?? before : before ?? after)!.position;
}

/** Source snapshots and spelling of delimiters do not require replacing the live document. */
export function referenceDocumentsEqual(a: EditorNode, b: EditorNode): boolean {
  const semantic = (node: EditorNode): unknown => ({ type: node.type.name, text: node.text,
    attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !["original", "source", "points", "gap", "tight"].includes(key))),
    marks: node.marks.filter(mark => mark.type.name !== "literal").map(mark => ({ type: mark.type.name, ...(mark.type.name === "link" ? { href: mark.attrs.href, title: mark.attrs.title } : {}) })),
    children: Array.from({ length: node.childCount }, (_, index) => semantic(node.child(index))) });
  return JSON.stringify(semantic(a)) === JSON.stringify(semantic(b));
}
