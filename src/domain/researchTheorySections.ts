import {
  updateResearchNote,
  type ResearchNotebookBlock,
  type ResearchNotebookState,
  type ResearchTheorySection,
} from "./researchNotebook.ts";

export type TheoryContentArea = ResearchTheorySection | "derivation";
export const theoryAreaLabels: Record<TheoryContentArea, string> = {
  given: "给定条件",
  derivation: "推导过程",
  conclusion: "结论",
};

/** A chapter assignment includes its nested headings, stopping at its next peer. */
export function setTheoryBlockSection(
  state: ResearchNotebookState,
  noteId: string,
  blockId: string,
  area: TheoryContentArea,
) {
  const note = state.notes.find((item) => item.id === noteId);
  const start = note?.blocks.findIndex((block) => block.id === blockId) ?? -1;
  if (!note || start < 0) return state;
  const anchor = note.blocks[start];
  let end = start + 1;
  if (anchor.type === "heading") {
    while (end < note.blocks.length) {
      const block = note.blocks[end];
      if (block.type === "heading" && block.level <= anchor.level) break;
      end++;
    }
  }
  return updateResearchNote(state, noteId, {
    blocks: note.blocks.map((block, index) => {
      if (index < start || index >= end) return block;
      if (area !== "derivation")
        return block.section === area ? block : { ...block, section: area };
      if (!block.section) return block;
      const next = { ...block };
      delete next.section;
      return next;
    }),
  });
}

export function partitionTheoryBlocks(blocks: ResearchNotebookBlock[]) {
  const areas: Record<TheoryContentArea, ResearchNotebookBlock[]> = {
    given: [], derivation: [], conclusion: [],
  };
  for (const block of blocks) areas[block.section ?? "derivation"].push(block);
  return areas;
}

export type TheoryReadingItem =
  | { kind: "content"; block: ResearchNotebookBlock }
  | { kind: "drawer"; section: ResearchTheorySection; blocks: ResearchNotebookBlock[] };

/** Keep a reference for every continuous run, including runs in the middle. */
export function theoryReadingFlow(blocks: ResearchNotebookBlock[]): TheoryReadingItem[] {
  const flow: TheoryReadingItem[] = [];
  for (const block of blocks) {
    if (!block.section) flow.push({ kind: "content", block });
    else {
      const previous = flow.at(-1);
      if (previous?.kind === "drawer" && previous.section === block.section) previous.blocks.push(block);
      else flow.push({ kind: "drawer", section: block.section, blocks: [block] });
    }
  }
  return flow;
}

export function sectionInsertionBefore(blocks: ResearchNotebookBlock[], area: TheoryContentArea) {
  const last = blocks.findLastIndex((block) => (block.section ?? "derivation") === area);
  if (last >= 0) return blocks[last + 1]?.id;
  if (area === "given") return blocks[0]?.id;
  if (area === "derivation") return blocks.find((block) => block.section === "conclusion")?.id;
  return undefined;
}
