import { updateResearchNote, type ResearchNotebookBlock, type ResearchNotebookState } from "./researchNotebook.ts";
import {
  findResearchBlock,
  flattenResearchBlocks,
  getResearchBlockContainer,
  replaceResearchBlockContainer,
  updateResearchBlockTree,
  type ResearchExampleContainer,
} from "./researchBlockTree.ts";
import { sectionInsertionBefore, type TheoryContentArea } from "./researchTheorySections.ts";

export interface ResearchBlockDropTarget {
  beforeBlockId?: string;
  area?: TheoryContentArea;
  container?: ResearchExampleContainer;
}

export function moveResearchBlock(
  state: ResearchNotebookState,
  noteId: string,
  blockId: string,
  target: ResearchBlockDropTarget,
): ResearchNotebookState {
  return moveResearchBlocks(state, noteId, [blockId], target);
}

/** A selected example owns its descendants; a batch always keeps document order. */
export function moveResearchBlocks(
  state: ResearchNotebookState,
  noteId: string,
  blockIds: readonly string[],
  target: ResearchBlockDropTarget,
): ResearchNotebookState {
  const note = state.notes.find((item) => item.id === noteId);
  if (!note || blockIds.length === 0) return state;
  const selectedIds = new Set(blockIds);
  const selected = flattenResearchBlocks(note.blocks).filter((block) => selectedIds.has(block.id));
  if (selected.length !== selectedIds.size) return state;
  const roots = selected.filter((block) => !findResearchBlock(note.blocks, block.id)!.path.some((container) => selectedIds.has(container.exampleBlockId)));
  const rootIds = new Set(roots.map((block) => block.id));
  const originalTarget = getResearchBlockContainer(note.blocks, target.container);
  if (!originalTarget) return state;

  if (target.container) {
    const owner = findResearchBlock(note.blocks, target.container.exampleBlockId)!;
    if (rootIds.has(owner.block.id) || owner.path.some((container) => rootIds.has(container.exampleBlockId))) return state;
  }
  const beforeIndex = target.beforeBlockId === undefined ? -1 : originalTarget.findIndex((block) => block.id === target.beforeBlockId);
  if (target.beforeBlockId !== undefined && (beforeIndex < 0 || (!target.container && target.area !== undefined && (originalTarget[beforeIndex].section ?? "derivation") !== target.area))) return state;

  let remaining = note.blocks;
  for (const block of roots) remaining = updateResearchBlockTree(remaining, block.id, () => null);
  const siblings = getResearchBlockContainer(remaining, target.container)!;
  const beforeId = target.beforeBlockId === undefined
    ? (!target.container && target.area !== undefined ? sectionInsertionBefore(siblings, target.area) : undefined)
    : originalTarget.slice(beforeIndex).find((block) => !rootIds.has(block.id))?.id;
  const index = beforeId === undefined ? siblings.length : siblings.findIndex((block) => block.id === beforeId);
  if (index < 0) return state;
  const moved = roots.map((block) => assignTargetSection(block, target));
  const blocks = replaceResearchBlockContainer(remaining, target.container, [
    ...siblings.slice(0, index), ...moved, ...siblings.slice(index),
  ]);
  return updateResearchNote(state, noteId, { blocks });
}

function assignTargetSection(block: ResearchNotebookBlock, target: ResearchBlockDropTarget): ResearchNotebookBlock {
  if (!target.container && target.area === undefined) return block;
  const section = target.container || target.area === "derivation" ? undefined : target.area;
  if (block.section === section) return block;
  const moved = { ...block };
  if (section === undefined) delete moved.section;
  else moved.section = section;
  return moved;
}
