import type { ResearchNotebookBlock } from '../domain/researchNotebook.ts';

export type TextBlock = Extract<ResearchNotebookBlock, { type: 'paragraph' | 'heading' | 'markdown' }>;
export function isTextBlock(block: ResearchNotebookBlock | undefined): block is TextBlock {
  return !!block && (block.type === 'paragraph' || block.type === 'heading' || block.type === 'markdown');
}
export function textOf(block: ResearchNotebookBlock | undefined): string {
  return isTextBlock(block) ? block.text : '';
}
