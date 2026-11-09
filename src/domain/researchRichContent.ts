import { citationText, normalizeCitationBlock, serializeCitationMarkdown, type ResearchCitationBlock } from "./researchCitation.ts";
import { datasetText, normalizeDatasetBlock, serializeDatasetMarkdown, type ResearchDatasetBlock } from "./researchDataset.ts";
import { diagramText, normalizeDiagramBlock, serializeDiagramMarkdown, type ResearchDiagramBlock } from "./researchDiagram.ts";

export type ResearchRichContentBlock = ResearchCitationBlock | ResearchDatasetBlock | ResearchDiagramBlock;
export const richContentTypes = ["citation", "dataset", "diagram"] as const;
export function isResearchRichBlock(value: { type: string }): value is ResearchRichContentBlock {
  return richContentTypes.some(type => type === value.type);
}
export function normalizeResearchRichBlock(value: unknown): ResearchRichContentBlock {
  switch ((value as { type?: string } | null)?.type) {
    case "citation": return normalizeCitationBlock(value);
    case "dataset": return normalizeDatasetBlock(value);
    case "diagram": return normalizeDiagramBlock(value);
    default: throw new Error("不支持此研究内容类型。");
  }
}
export function serializeResearchRichMarkdown(block: ResearchRichContentBlock): string {
  switch (block.type) {
    case "citation": return serializeCitationMarkdown(block);
    case "dataset": return serializeDatasetMarkdown(block);
    case "diagram": return serializeDiagramMarkdown(block);
  }
}
export function researchRichText(block: ResearchRichContentBlock): string {
  switch (block.type) {
    case "citation": return citationText(block);
    case "dataset": return datasetText(block);
    case "diagram": return diagramText(block);
  }
}
