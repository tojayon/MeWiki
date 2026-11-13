import { renderedFormulaTex, type ResearchNote, type ResearchNotebookBlock } from '../domain/researchNotebook.ts';
import type { ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { expandNoteEmbedBlocks } from '../domain/researchNoteEmbed.ts';
import { externalContentText } from '../integrations/externalContent.ts';
import { researchRichText, isResearchRichBlock } from '../domain/researchRichContent.ts';

/** A readable projection, deliberately independent of lossless backup serialization. */
export function readableAiNote(note: ResearchNote, allowedNotes: ResearchNote[], symbols: ResearchSymbolEntry[] = []): string {
  const render = (block: ResearchNotebookBlock): string => {
    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'markdown') return block.text;
    if (block.type === 'external') return externalContentText(block);
    if (block.type === 'examples') return [block.title, ...block.tabs.map(tab => [tab.title, ...tab.blocks.map(render)].join('\n\n'))].filter(Boolean).join('\n\n');
    if (block.type === 'callout') return [block.title, block.text].filter(Boolean).join('\n');
    if (block.type === 'list') return block.items.map(item => `- ${item}`).join('\n');
    if (block.type === 'formula') return [`$$${renderedFormulaTex(block, symbols).tex}$$`, block.caption, block.conditions].filter(Boolean).join('\n');
    if (block.type === 'media') return [block.kind, block.alt, block.caption].filter(Boolean).join(' · ');
    if (block.type === 'bookmark') return [block.title, block.description, block.url].filter(Boolean).join('\n');
    if (isResearchRichBlock(block)) return researchRichText(block);
    if (block.type === 'evidence') return [block.runTitle, `t = ${block.time}`, block.eventLabel, block.note].filter(Boolean).join('\n');
    if (block.type === 'noteEmbed') return '引用内容不在本次授权范围内。';
    const exhaustive: never = block;
    return exhaustive;
  };
  const content = [note.title, ...expandNoteEmbedBlocks(allowedNotes, note.blocks, note.id).map(render)].join('\n\n');
  return content.replace(/<!--[\s\S]*?-->/g, '').replace(/data:[^\s)"'<>]+/gi, '[内联附件已省略]');
}
