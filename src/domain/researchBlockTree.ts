import type { ResearchNotebookBlock } from "./researchNotebook.ts";

export interface ResearchExampleContainer {
  exampleBlockId: string;
  tabId: string;
}

export interface ResearchBlockLocation {
  block: ResearchNotebookBlock;
  index: number;
  siblings: ResearchNotebookBlock[];
  container?: ResearchExampleContainer;
  path: ResearchExampleContainer[];
}

/** Preorder includes example groups and every tab, including tabs currently hidden. */
export function flattenResearchBlocks(
  blocks: ResearchNotebookBlock[],
): ResearchNotebookBlock[] {
  return blocks.flatMap((block) =>
    block.type === "examples"
      ? [
          block,
          ...block.tabs.flatMap((tab) => flattenResearchBlocks(tab.blocks)),
        ]
      : [block],
  );
}

export function findResearchBlock(
  blocks: ResearchNotebookBlock[],
  id: string,
): ResearchBlockLocation | undefined {
  const find = (
    siblings: ResearchNotebookBlock[],
    path: ResearchExampleContainer[],
  ): ResearchBlockLocation | undefined => {
    for (const [index, block] of siblings.entries()) {
      if (block.id === id)
        return {
          block,
          index,
          siblings,
          ...(path.length ? { container: path.at(-1) } : {}),
          path,
        };
      if (block.type !== "examples") continue;
      for (const tab of block.tabs) {
        const result = find(tab.blocks, [
          ...path,
          { exampleBlockId: block.id, tabId: tab.id },
        ]);
        if (result) return result;
      }
    }
    return undefined;
  };
  return find(blocks, []);
}

export function mapResearchBlocks(
  blocks: ResearchNotebookBlock[],
  transform: (block: ResearchNotebookBlock) => ResearchNotebookBlock,
): ResearchNotebookBlock[] {
  let changed = false;
  const result = blocks.map((block) => {
    let nested = block;
    if (block.type === "examples") {
      const tabs = block.tabs.map((tab) => {
        const children = mapResearchBlocks(tab.blocks, transform);
        return children === tab.blocks ? tab : { ...tab, blocks: children };
      });
      if (tabs.some((tab, index) => tab !== block.tabs[index]))
        nested = { ...block, tabs };
    }
    const updated = transform(nested);
    if (updated !== block) changed = true;
    return updated;
  });
  return changed ? result : blocks;
}

export function updateResearchBlockTree(
  blocks: ResearchNotebookBlock[],
  id: string,
  transform: (block: ResearchNotebookBlock) => ResearchNotebookBlock | null,
): ResearchNotebookBlock[] {
  let changed = false;
  const result = blocks.flatMap((block) => {
    if (block.id === id) {
      const replacement = transform(block);
      if (replacement !== block) changed = true;
      return replacement ? [replacement] : [];
    }
    if (block.type !== "examples") return [block];
    const tabs = block.tabs.map((tab) => {
      const children = updateResearchBlockTree(tab.blocks, id, transform);
      return children === tab.blocks ? tab : { ...tab, blocks: children };
    });
    if (tabs.every((tab, index) => tab === block.tabs[index])) return [block];
    changed = true;
    return [{ ...block, tabs }];
  });
  return changed ? result : blocks;
}

export function getResearchBlockContainer(
  blocks: ResearchNotebookBlock[],
  container?: ResearchExampleContainer,
): ResearchNotebookBlock[] | undefined {
  if (!container) return blocks;
  const group = findResearchBlock(blocks, container.exampleBlockId)?.block;
  return group?.type === "examples"
    ? group.tabs.find((tab) => tab.id === container.tabId)?.blocks
    : undefined;
}

export function replaceResearchBlockContainer(
  blocks: ResearchNotebookBlock[],
  container: ResearchExampleContainer | undefined,
  newBlocks: ResearchNotebookBlock[],
): ResearchNotebookBlock[] {
  if (!container) return newBlocks;
  return updateResearchBlockTree(blocks, container.exampleBlockId, (block) => {
    if (block.type !== "examples") return block;
    const tab = block.tabs.find((tab) => tab.id === container.tabId);
    if (!tab || tab.blocks === newBlocks) return block;
    return {
      ...block,
      tabs: block.tabs.map((tab) =>
        tab.id === container.tabId ? { ...tab, blocks: newBlocks } : tab,
      ),
    };
  });
}
