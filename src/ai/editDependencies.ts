import { findResearchBlock } from '../domain/researchBlockTree.ts';
import { getResearchNoteMetadata } from '../domain/researchFrontmatter.ts';
import type { ResearchNote } from '../domain/researchNotebook.ts';
import { nativeFingerprint, type AiNativeEdit } from './nativeEdits.ts';

const equal = (a: unknown, b: unknown) => nativeFingerprint(a) === nativeFingerprint(b);
const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};
function fieldsUnchanged(before: unknown, current: unknown, fields: Record<string, unknown>): boolean {
  const a = record(before), b = record(current);
  return Object.keys(fields).every(key => key === 'appearance'
    ? Object.keys(record(fields[key])).every(nested => equal(record(a[key])[nested], record(b[key])[nested]))
    : equal(a[key], b[key]));
}

/** Check what this operation actually depends on, without replacing the current entity. */
export function noteEditDependenciesUnchanged(before: ResearchNote, current: ResearchNote, edit: Pick<AiNativeEdit, 'action' | 'blockId' | 'fields' | 'tabId' | 'container' | 'beforeBlockId'>): boolean {
  if (before.id !== current.id || (before.library ?? 'research') !== (current.library ?? 'research')) return false;
  if (edit.action === 'note-update') return fieldsUnchanged({ ...getResearchNoteMetadata(before), frontmatter: before.frontmatter }, { ...getResearchNoteMetadata(current), frontmatter: current.frontmatter }, edit.fields);
  const location = (note: ResearchNote, id: string) => {
    const found = findResearchBlock(note.blocks, id);
    return found && { path: found.path, type: found.block.type, section: found.block.section,
      parents: found.path.map(parent => {
        const block = findResearchBlock(note.blocks, parent.exampleBlockId)?.block;
        return { id: parent.exampleBlockId, type: block?.type, section: block?.section };
      }) };
  };
  if (edit.action === 'block-insert') {
    if (!edit.container) return equal(before.blocks.map(block => block.id), current.blocks.map(block => block.id));
    const a = findResearchBlock(before.blocks, edit.container.exampleBlockId), b = findResearchBlock(current.blocks, edit.container.exampleBlockId);
    if (!a || !b || a.block.type !== 'examples' || b.block.type !== 'examples' || !equal(location(before, a.block.id), location(current, b.block.id))) return false;
    // A tab title does not affect its identity or the insertion position. Keep
    // every other container field and its full content/order under strict checks.
    const withoutTitles = (block: typeof a.block) => ({ ...block, tabs: block.tabs.map(({ title: _title, ...tab }) => tab) });
    return equal(withoutTitles(a.block), withoutTitles(b.block));
  }
  const a = findResearchBlock(before.blocks, edit.blockId ?? ''), b = findResearchBlock(current.blocks, edit.blockId ?? '');
  if (!a || !b || !equal(location(before, a.block.id), location(current, b.block.id))) return false;
  if (edit.action === 'block-update') {
    const dependencies = { ...edit.fields };
    // Changing TeX clears parts; changing parts may also normalize the TeX.
    if (a.block.type === 'formula' && ('tex' in dependencies || 'parts' in dependencies)) Object.assign(dependencies, { tex: true, parts: true });
    return fieldsUnchanged(a.block, b.block, dependencies);
  }
  if (edit.action === 'tab-update' && a.block.type === 'examples' && b.block.type === 'examples') {
    const x = a.block.tabs.find(tab => tab.id === edit.tabId), y = b.block.tabs.find(tab => tab.id === edit.tabId);
    return !!x && !!y && x.title === y.title;
  }
  // Destructive and structural operations retain the full local container order.
  return equal(a.block, b.block) && equal(a.siblings.map(block => block.id), b.siblings.map(block => block.id));
}
