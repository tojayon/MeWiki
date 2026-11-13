import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ResearchNote, ResearchNotebookBlock } from "./researchNotebook.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";

const prefix = "#research-note/";
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type TextNode = {
  type: string; value?: string; url?: string; identifier?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: TextNode[];
};

export function researchNoteLinkUrl(id: string) {
  return prefix + encodeURIComponent(id);
}
export function researchNoteLinkId(url: string | undefined): string | null {
  if (!url?.startsWith(prefix)) return null;
  try {
    const id = decodeURIComponent(url.slice(prefix.length));
    return id && !Array.from(id).some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127) ? id : null;
  } catch { return null; }
}
export function researchNoteLinkMarkdown(note: Pick<ResearchNote, "id" | "title">) {
  const title = (note.title || "未命名笔记").replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
  return `[${title}](${researchNoteLinkUrl(note.id)})`;
}

export function researchTextNoteLinks(text: string): string[] {
  const root = parser.parse(text) as TextNode;
  const definitions = new Map<string, string>();
  const result = new Set<string>();
  const visit = (node: TextNode, collect: boolean) => {
    if (["code", "inlineCode", "math", "inlineMath", "html"].includes(node.type)) return;
    if (!collect && node.type === "definition" && node.identifier && node.url) definitions.set(node.identifier, node.url);
    if (collect) {
      const url = node.type === "link" ? node.url : node.type === "linkReference" ? definitions.get(node.identifier ?? "") : undefined;
      const id = researchNoteLinkId(url);
      if (id) result.add(id);
    }
    node.children?.forEach(child => visit(child, collect));
  };
  visit(root, false); visit(root, true);
  return [...result];
}

export interface ResearchNoteMention { start: number; end: number; query: string }
export function findResearchNoteMention(text: string, caret: number): ResearchNoteMention | null {
  const before = text.slice(0, caret);
  const match = /@([^\n@#￥]{0,80})$/.exec(before);
  if (!match || /[\]<>$]/.test(match[1])) return null;
  const start = caret - match[1].length - 1;
  const preceding = before.slice(0, start);
  // Chinese prose can touch @ directly; an email local part or escape cannot.
  if (/[A-Za-z0-9._%+\\-]$/.test(preceding)) return null;
  const line = preceding.slice(preceding.lastIndexOf("\n") + 1);
  if (/\]\([^)]*$/.test(line)) return null;
  let fence = "";
  for (const line of preceding.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!marker) continue;
    if (!fence) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
  }
  if (fence || (line.replace(/\\./g, "").match(/`+/g)?.length ?? 0) % 2 || (preceding.replace(/\\./g, "").match(/\${1,2}/g)?.length ?? 0) % 2) return null;
  const insideLiteral = (node: TextNode): boolean => {
    const a = node.position?.start.offset, b = node.position?.end.offset;
    if (a !== undefined && b !== undefined && start >= a && start < b && ["code", "inlineCode", "math", "inlineMath", "link", "linkReference", "image", "html"].includes(node.type)) return true;
    return node.children?.some(insideLiteral) ?? false;
  };
  return insideLiteral(parser.parse(text) as TextNode) ? null : { start, end: caret, query: match[1] };
}

export function insertResearchNoteMention(text: string, mention: ResearchNoteMention, note: Pick<ResearchNote, "id" | "title">) {
  const link = researchNoteLinkMarkdown(note);
  return { text: text.slice(0, mention.start) + link + text.slice(mention.end), caret: mention.start + link.length };
}

function blockText(block: ResearchNotebookBlock): string {
  switch (block.type) {
    case "paragraph": case "heading": case "markdown": case "callout": return block.text;
    case "list": return block.items.join("\n");
    case "evidence": return block.note ?? "";
    case 'noteEmbed': return `引用笔记内容 · ${block.sourceTitle || '来源笔记'}`;
    default: return "";
  }
}
export interface ResearchNoteBacklink { noteId: string; blockId: string; excerpt: string }
export function buildResearchNoteBacklinks(notes: readonly ResearchNote[], targetId: string): ResearchNoteBacklink[] {
  return notes.flatMap(note => {
    const block = flattenResearchBlocks(note.blocks).find(block => {
      if (block.type === 'noteEmbed') return block.sourceNoteId === targetId;
      // List items are rendered independently, so definitions and code cannot spill between items.
      const texts = block.type === "list" ? block.items : [block.type === "heading" ? `${"#".repeat(block.level)} ${block.text}` : blockText(block)];
      return texts.some(text => researchTextNoteLinks(text).includes(targetId));
    });
    return block ? [{ noteId: note.id, blockId: block.id, excerpt: blockText(block).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").slice(0, 140) }] : [];
  });
}
