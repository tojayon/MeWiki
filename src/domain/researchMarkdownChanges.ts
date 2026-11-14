import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, RootContent } from 'mdast';

export interface ResearchMarkdownChanges {
  kind: 'remove' | 'add';
  ranges: readonly { start: number; end: number }[];
  counterpart?: string;
}
type Node = Root | RootContent;
const entityParser = unified().use(remarkParse);
const structureParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const decodedEntities = new Map<string, string>();
const atomic = new Set(['inlineMath', 'math', 'inlineCode', 'code', 'image', 'imageReference', 'link', 'linkReference', 'footnoteReference', 'break', 'thematicBreak']);
const formatting = new Set(['strong', 'emphasis', 'delete', 'heading', 'list', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell']);
const blockNodes = new Set(['paragraph', 'math', 'code', 'thematicBreak', 'heading', 'list', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell']);
function structure(node: Node): unknown {
  return [node.type, 'depth' in node ? node.depth : undefined, 'ordered' in node ? node.ordered : undefined, 'checked' in node ? node.checked : undefined,
    'children' in node ? node.children.map(child => structure(child)) : undefined];
}

/** View-only annotations: source text and persisted Markdown remain unchanged. */
export function remarkResearchMarkdownChanges({ source, counterpart, kind, ranges }: ResearchMarkdownChanges & { source: string }) {
  return (tree: Root) => {
    const firstRange = (start: number) => {
      let low = 0, high = ranges.length;
      while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid].end <= start) low = mid + 1; else high = mid; }
      return low;
    };
    const intersects = (start: number, end: number) => ranges[firstRange(start)]?.start < end;
    const changed = (node: Node) => intersects(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
    const definitions = new Set<string>();
    const collectDefinitions = (node: Node) => {
      if (node.type === 'definition' && changed(node)) definitions.add(node.identifier);
      if ('children' in node) node.children.forEach(child => collectDefinitions(child));
    };
    collectDefinitions(tree);
    const wrap = (node: Node) => ({ type: 'researchTextChange', data: { hName: kind === 'remove' ? 'del' : 'ins', hProperties: { className: ['mewiki-ai-inline-change'] } }, children: [node] }) as unknown as RootContent;
    const mark = (node: Node): RootContent[] => {
      if (!blockNodes.has(node.type)) return [wrap(node)];
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, 'data-ai-change': kind } };
      return [node as RootContent];
    };
    const markText = (node: Extract<RootContent, { type: 'text' }>): RootContent[] => {
      const start = node.position?.start.offset ?? 0, end = node.position?.end.offset ?? start;
      if (!intersects(start, end)) return [node];
      const raw = source.slice(start, end), pieces: { start: number; end: number; text: string }[] = [];
      if (raw === node.value) {
        for (let index = 0; index < raw.length;) {
          const text = String.fromCodePoint(raw.codePointAt(index)!);
          pieces.push({ start: start + index, end: start + index + text.length, text }); index += text.length;
        }
      } else {
        // Map escapes/entities back to their full displayed character rather than marking the whole leaf.
        for (let index = 0; index < raw.length;) {
          const rest = raw.slice(index);
          const token = /^(?:\\[!-/:-@[-`{-~]|\r\n|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);)/.exec(rest)?.[0] ?? String.fromCodePoint(raw.codePointAt(index)!);
          let text = token;
          if (token.startsWith('\\')) text = token.slice(1);
          else if (token === '\r\n') text = '\n';
          else if (token.startsWith('&') && token.length > 1) {
            text = decodedEntities.get(token) ?? '';
            if (!text) {
              const paragraph = entityParser.parse(token).children[0];
              text = paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'text' ? paragraph.children[0].value : token;
              if (decodedEntities.size < 256) decodedEntities.set(token, text);
            }
          }
          pieces.push({ start: start + index, end: start + index + token.length, text }); index += token.length;
        }
        if (pieces.map(piece => piece.text).join('') !== node.value) return [wrap(node)];
      }
      const result: RootContent[] = [];
      let text = '', marked = false;
      const flush = () => { if (text) { const value: RootContent = { type: 'text', value: text }; result.push(marked ? wrap(value) : value); text = ''; } };
      for (const piece of pieces) {
        const next = intersects(piece.start, piece.end);
        if (next !== marked) { flush(); marked = next; }
        text += piece.text;
      }
      flush();
      return result;
    };
    const visit = (node: Node): RootContent[] => {
      if (node.type === 'text') return markText(node);
      const children = 'children' in node ? node.children : [];
      const referenceChanged = (node.type === 'linkReference' || node.type === 'imageReference') && definitions.has(node.identifier);
      const ownRanges = () => {
        const start = node.position?.start.offset ?? 0, end = node.position?.end.offset ?? 0;
        const matches = [];
        for (let index = firstRange(start); index < ranges.length && ranges[index].start < end; index++) matches.push(ranges[index]);
        return matches;
      };
      if (referenceChanged || changed(node) && (atomic.has(node.type) || formatting.has(node.type) && ownRanges().some(range => {
        const start = Math.max(range.start, node.position?.start.offset ?? 0), end = Math.min(range.end, node.position?.end.offset ?? 0);
        if (start >= end) return false;
        let cursor = start;
        for (const child of children) {
          const childStart = child.position?.start.offset ?? cursor, childEnd = child.position?.end.offset ?? cursor;
          if (childStart > cursor) return true;
          cursor = Math.max(cursor, childEnd);
          if (cursor >= end) return false;
        }
        return cursor < end;
      }))) return mark(node);
      if ('children' in node) node.children = children.flatMap(child => visit(child)) as typeof node.children;
      return [node as RootContent];
    };
    const layoutChanged = counterpart !== undefined && source !== counterpart && ranges.every(range => !source.slice(range.start, range.end).trim())
      && JSON.stringify(structure(structureParser.parse(source))) !== JSON.stringify(structure(structureParser.parse(counterpart)));
    tree.children = tree.children.flatMap(node => layoutChanged && blockNodes.has(node.type) ? mark(node) : visit(node));
  };
}
