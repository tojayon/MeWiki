import type { ResearchNotebookBlock } from "./researchNotebook.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";
import { researchMarkdownHeadings } from "./researchMarkdown.ts";

export interface ResearchOutlineHeading {
  id: string;
  blockId: string;
  text: string;
  level: number;
  depth: number;
  offset: number;
  number: string;
}

export function buildResearchOutline(blocks: ResearchNotebookBlock[]): ResearchOutlineHeading[] {
  const headings = flattenResearchBlocks(blocks).flatMap(block => {
    const source = block.type === "heading" ? `${"#".repeat(block.level)} ${block.text}`
      : block.type === "paragraph" || block.type === "markdown" ? block.text : undefined;
    return source === undefined ? [] : researchMarkdownHeadings(source).map(heading => ({
      ...heading, blockId: block.id, id: `${block.id}:${heading.offset}`,
    }));
  });
  const base = headings.reduce((minimum, heading) => Math.min(minimum, heading.level), 6);
  const counters: number[] = [];
  return headings.map(heading => {
    const depth = heading.level - base;
    counters.length = Math.min(counters.length, depth + 1);
    while (counters.length < depth) counters.push(1);
    counters[depth] = (counters[depth] ?? 0) + 1;
    return { ...heading, depth, number: `${counters.join(".")}.` };
  });
}
