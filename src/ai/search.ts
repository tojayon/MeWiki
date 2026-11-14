import type { AiToolContext } from './tools.ts';
import { budgetAiRead, nativeBlockLocation } from './nativeTools.ts';
import { readableAiNote } from './readable.ts';
import { flattenResearchBlocks } from '../domain/researchBlockTree.ts';
import { researchNoteLinkUrl } from '../domain/researchNoteLinks.ts';

export const aiSearchPageFields = (max: number) => ({ offset: { type: 'integer', minimum: 0, maximum: 1000000 }, limit: { type: 'integer', minimum: 1, maximum: max } });
function page<T>(context: AiToolContext, items: T[], args: Record<string, unknown>, max: number) {
  const offset = typeof args.offset === 'number' ? args.offset : 0, limit = typeof args.limit === 'number' ? args.limit : max;
  return budgetAiRead(context, { items: items.slice(offset, offset + limit), total: items.length, offset, limit, nextOffset: offset + limit < items.length ? offset + limit : null });
}
const lower = (text: string) => text.toLocaleLowerCase();
export function listAiNotes(context: AiToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? lower(args.query.trim()) : '';
  const items = context.state.notes.filter(note => context.noteIds.has(note.id) && lower(`${note.title} ${note.tags?.join(' ')}`).includes(query))
    .sort((a, b) => a.id.localeCompare(b.id)).map(note => ({ id: note.id, title: note.title.slice(0, 1000), tags: note.tags?.slice(0, 50).map(tag => tag.slice(0, 100)), url: researchNoteLinkUrl(note.id) }));
  return page(context, items, args, 50);
}
export function searchAiNotes(context: AiToolContext, args: Record<string, unknown>) {
  const query = lower(String(args.query).trim());
  if (!query || query.length > 200) throw new Error('请输入 1～200 字的检索词。');
  const words = query.split(/\s+/).filter(Boolean), matches = (text: string) => words.every(word => lower(text).includes(word));
  const allowed = context.state.notes.filter(note => context.noteIds.has(note.id));
  const items = allowed.flatMap(note => {
    const blocks = flattenResearchBlocks(note.blocks).flatMap(block => {
      const own = block.type === 'examples' ? { ...block, tabs: block.tabs.map(tab => ({ ...tab, blocks: [] })) } : block;
      const text = readableAiNote({ ...note, title: '', blocks: [own] }, allowed, context.state.symbols);
      if (!matches(text)) return [];
      const index = lower(text).indexOf(words[0]), location = nativeBlockLocation(note, block, false);
      return [{ blockId: block.id, type: block.type, path: location.path, excerpt: text.slice(Math.max(0, index - 80), index + 320) }];
    });
    const titleMatch = matches(note.title), tagMatch = matches(note.tags?.join(' ') ?? '');
    if (!titleMatch && !tagMatch && !blocks.length) return [];
    const score = (lower(note.title) === query ? 120 : titleMatch ? 60 : 0) + (tagMatch ? 30 : 0) + Math.min(20, blocks.length * 2);
    return [{ id: note.id, title: note.title.slice(0, 1000), url: researchNoteLinkUrl(note.id), score, excerpt: blocks[0]?.excerpt ?? note.title.slice(0, 400), matches: blocks.slice(0, 3), matchCount: blocks.length }];
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const result = page(context, items, args, 20);
  result.items.forEach(note => context.sourceIds.add(note.id));
  return result;
}
