import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { mediaAssetIdPattern } from './researchMedia.ts';
import { NOTE_EMBED_MAX_DEPTH, resolveNoteEmbed } from './researchNoteEmbed.ts';
import type { ResearchNotebookBlock, ResearchNotebookState } from './researchNotebook.ts';

export interface PublicationNoteImage {
  id: string;
  name: string;
  source: { type: 'asset'; assetId: string };
  location: string[];
}
type ImageNode = { type: string; children?: ImageNode[]; url?: string; identifier?: string; alt?: string };
const parser = unified().use(remarkParse).use(remarkGfm);

/** Only inspect known visible content fields; no attachment reads or private plugin data. */
export function collectPublicationImages(state: ResearchNotebookState, noteId: string): PublicationNoteImage[] {
  const result: PublicationNoteImage[] = [];
  const note = state.notes.find(item => item.id === noteId);
  if (!note) return result;
  let remaining = 1000;
  const add = (assetId: string, name: string, location: string[]) => {
    if (mediaAssetIdPattern.test(assetId)) result.push({ id: `note-image-${result.length}`, name: name.trim().slice(0, 160), source: { type: 'asset', assetId }, location });
  };
  const visit = (blocks: ResearchNotebookBlock[], ownerId: string, location: string[], stack: Set<string>, depth: number) => {
    for (const block of blocks) {
      if (--remaining < 0) return;
      const address = JSON.stringify([ownerId, block.id]);
      if (stack.has(address)) continue;
      if (block.type === 'media' && block.kind === 'image' && block.source?.type === 'asset') add(block.source.assetId, block.alt || block.caption || '', location);
      else if (block.type === 'examples') {
        const nested = new Set(stack).add(address);
        for (const tab of block.tabs) visit(tab.blocks, ownerId, [...location, tab.title], nested, depth);
      } else if (block.type === 'noteEmbed' && depth < NOTE_EMBED_MAX_DEPTH) {
        const resolved = resolveNoteEmbed(state.notes, block);
        if (resolved.note) visit(resolved.items.flatMap(item => item.block ? [item.block] : []), resolved.note.id, [...location, resolved.note.title], new Set(stack).add(address), depth + 1);
      } else {
        const text = block.type === 'paragraph' || block.type === 'heading' || block.type === 'markdown' || block.type === 'callout' ? block.text : block.type === 'list' ? block.items.join('\n') : '';
        if (!text) continue;
        const tree = parser.parse(text) as ImageNode;
        const definitions = new Map<string, string>();
        const scanDefinitions = (node: ImageNode) => {
          if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier.toLowerCase())) definitions.set(node.identifier.toLowerCase(), node.url);
          node.children?.forEach(scanDefinitions);
        };
        scanDefinitions(tree);
        const images = (node: ImageNode) => {
          const url = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier?.toLowerCase() ?? '') : undefined;
          if (url?.startsWith('webbench-asset:')) add(url.slice(15), node.alt || '', location);
          node.children?.forEach(images);
        };
        images(tree);
      }
    }
  };
  visit(note.blocks, noteId, [note.title], new Set(), 0);
  return result;
}
