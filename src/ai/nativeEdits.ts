import { createResearchContentBlock, deleteResearchNote, insertResearchBlock, normalizeResearchBlock, removeResearchBlock, updateResearchNote, type ResearchNote, type ResearchNotebookBlock, type ResearchNotebookState } from '../domain/researchNotebook.ts';
import { findResearchBlock, flattenResearchBlocks, getResearchBlockContainer, updateResearchBlockTree, type ResearchExampleContainer } from '../domain/researchBlockTree.ts';
import { moveResearchBlock } from '../domain/researchBlockMovement.ts';
import { addSymbolEntry, createSymbolEntry, deleteSymbolEntry, symbolEntryError, updateSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { addTermEntry, createTermEntry, deleteTermEntry, dictionaryReferenceId, dictionaryReferenceKind, researchTermAliases, termEntryError, updateTermEntry, type ResearchTermEntry } from '../domain/researchTerms.ts';
import { applyResearchNoteMetadata, getResearchNoteMetadata, noteMetadataKeys, type ResearchFrontmatter } from '../domain/researchFrontmatter.ts';
import { addTheoryMapDocument, deleteTheoryMapDocument, ensureTheoryMaps, removeTheoryRelation, saveTheoryRelation, theoryRelationError, updateTheoryMapDocument, type ResearchTheoryMapState, type TheoryDocumentView, type TheoryMapDocument, type TheoryMapWorkspace, type TheoryRelation } from '../domain/researchTheoryMap.ts';
import { formulaLatexError } from '../domain/formulaLatex.ts';
import { formulaMetadataError, formulaSourceError, resolveFormulaSource } from '../domain/researchFormulaLinks.ts';
import { normalizeResearchRichBlock } from '../domain/researchRichContent.ts';
import { normalizeMediaBlock } from '../domain/researchMedia.ts';
import { normalizeBookmarkBlock } from '../domain/researchBookmark.ts';
import { normalizeNoteEmbed, noteEmbedSelectionError } from '../domain/researchNoteEmbed.ts';
import { aiBlockFields, aiMapFields, aiNoteFields, aiRelationFields, aiSymbolFields, aiTermFields, validateAiFields, validateAiNativeInput, type AiNativeAction } from './nativeSchema.ts';
import { researchTextNoteLinks } from '../domain/researchNoteLinks.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export type AiNativeTarget = 'note' | 'symbol' | 'term' | 'map';
export type AiNativeEntity = ResearchNote | ResearchSymbolEntry | ResearchTermEntry | TheoryMapDocument;
export interface AiNativeEdit {
  action: AiNativeAction; noteId?: string; blockId?: string; blockType?: ResearchNotebookBlock['type']; tabId?: string;
  entryId?: string; mapId?: string; relationId?: string; title?: string; beforeBlockId?: string; beforeTabId?: string;
  container?: ResearchExampleContainer; fields: Record<string, unknown>; generatedId: string; generatedAt?: string; block?: ResearchNotebookBlock;
}
export type AiNativeEffect = { collection: 'notes' | 'symbols' | 'terms'; id: string; before: AiNativeEntity | null; after: AiNativeEntity | null; index: number }
  | { collection: 'theoryMaps' | 'theoryMap'; before: ResearchNotebookState['theoryMaps'] | ResearchNotebookState['theoryMap'] | null; after: ResearchNotebookState['theoryMaps'] | ResearchNotebookState['theoryMap'] | null };
const clone = <T>(value: T): T => structuredClone(value);
function fail(message: string): never { throw new Error(message); }
const requiredId = (value: string | undefined): string => value?.trim() ? value : fail('AI 操作缺少目标 ID。');
const noteFor = (state: ResearchNotebookState, edit: AiNativeEdit) => state.notes.find(note => note.id === edit.noteId) ?? fail('目标笔记已不存在。');
const blockFor = (state: ResearchNotebookState, edit: AiNativeEdit) => findResearchBlock(noteFor(state, edit).blocks, requiredId(edit.blockId))?.block ?? fail('目标内容块已不存在。');

/** Field order and volatile save timestamps do not change the content baseline. */
export function nativeFingerprint(value: unknown): string {
  const content = value && typeof value === 'object' && !Array.isArray(value) && 'updatedAt' in value ? { ...value, updatedAt: undefined } : value;
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sorted(value)])) : item;
  return JSON.stringify(sorted(content ?? null));
}
/** Approved history may contain either legacy JSON order or the canonical native order. */
export function nativeStoredSnapshotMatches(serialized: string | undefined, value: unknown): boolean {
  if (typeof serialized !== 'string') return false;
  try { return nativeFingerprint(JSON.parse(serialized)) === nativeFingerprint(value); } catch { return false; }
}
export function nativeEditTarget(edit: AiNativeEdit): { target: AiNativeTarget; id: string } {
  if (edit.action.startsWith('symbol-')) return { target: 'symbol', id: edit.entryId ?? edit.generatedId };
  if (edit.action.startsWith('term-')) return { target: 'term', id: edit.entryId ?? edit.generatedId };
  if (edit.action.startsWith('map-') || (edit.action.startsWith('relation-') && edit.mapId)) return { target: 'map', id: edit.mapId ?? edit.generatedId };
  return { target: 'note', id: requiredId(edit.noteId) };
}
export function nativeEntity(state: ResearchNotebookState, target: AiNativeTarget, id: string): AiNativeEntity | null {
  return (target === 'note' ? state.notes : target === 'symbol' ? state.symbols : target === 'term' ? state.terms : ensureAiTheoryMaps(state).theoryMaps?.documents)?.find(item => item.id === id) ?? null;
}
/** AI projections and approval share deterministic system-map initialization. */
export function ensureAiTheoryMaps(state: ResearchNotebookState): ResearchNotebookState {
  if (state.theoryMaps) return state;
  const dates = state.notes.map(note => Date.parse(note.createdAt)).filter(Number.isFinite);
  const stamp = new Date(dates.length ? Math.min(...dates) : Date.UTC(2000, 0, 1)).toISOString();
  const next = ensureTheoryMaps(state);
  return { ...next, theoryMaps: { ...next.theoryMaps!, documents: next.theoryMaps!.documents.map(doc => ({ ...doc, createdAt: stamp, updatedAt: stamp })) } };
}
type ReferenceNode = { type: string; url?: string; identifier?: string; children?: ReferenceNode[] };
const referenceParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
function dictionaryLinks(text: string, kind: AiNativeTarget, id: string): boolean {
  const root = referenceParser.parse(text) as ReferenceNode, definitions = new Map<string, string>();
  const ignored = ['code', 'inlineCode', 'math', 'inlineMath', 'html', 'image'];
  const visit = (node: ReferenceNode, collect: boolean): boolean => {
    if (ignored.includes(node.type)) return false;
    if (!collect && node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url);
    const url = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier ?? '') : undefined;
    return collect && dictionaryReferenceKind(url) === kind && dictionaryReferenceId(url) === id || !!node.children?.some(child => visit(child, collect));
  };
  visit(root, false); return visit(root, true);
}
function blockReferences(block: ResearchNotebookBlock, id: string, target: AiNativeTarget): boolean {
  const privateData = block.type === 'external' || block.type === 'evidence';
  const visit = (value: unknown, key = ''): boolean => {
    if (typeof value === 'string') {
      if ((target === 'note' ? ['noteId', 'sourceNoteId'] : ['entryId']).includes(key) && value === id || privateData && value === id) return true;
      return target === 'note' ? researchTextNoteLinks(value).includes(id) : dictionaryLinks(value, target, id);
    }
    return Array.isArray(value) ? value.some(item => visit(item, key)) : !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => (key !== 'id' || privateData && value !== block) && visit(child, key));
  };
  return visit(block);
}
function referenceGuard(state: ResearchNotebookState, id: string, target: AiNativeTarget) {
  const references = state.notes.filter(note => target !== 'note' || note.id !== id);
  if (references.some(note => target === 'note' && note.basisNoteIds?.includes(id) || flattenResearchBlocks(note.blocks).some(block => blockReferences(block, id, target)))) fail('目标内容仍有引用，请先处理引用。');
  if (target === 'note' && (state.theoryMaps?.documents.some(map => map.noteIds.includes(id)) || theoryReferences(state, id))) fail('目标内容仍有地图引用，请先处理引用。');
}
function theoryReferences(state: ResearchNotebookState, noteId: string, blockIds?: Set<string>): boolean {
  const matches = (ref: { noteId: string; blockId?: string }) => ref.noteId === noteId && (!blockIds || !!ref.blockId && blockIds.has(ref.blockId));
  const knowledge = [...state.notes.map(note => note.theory), ...state.theoryMaps?.documents ?? [], state.theoryMaps?.unresolvedKnowledge, state.theoryMap];
  return knowledge.some(value => value?.annotations.some(item => matches(item.ref)) || value?.relations.some(item => matches(item.source) || matches(item.target)));
}
function guardRemovedContent(before: ResearchNotebookState, after: ResearchNotebookState) {
  for (const note of before.notes) {
    const current = after.notes.find(item => item.id === note.id);
    if (!current) { referenceGuard(after, note.id, 'note'); continue; }
    const removed = new Set(flattenResearchBlocks(note.blocks).filter(block => !findResearchBlock(current.blocks, block.id)).map(block => block.id));
    if (removed.size && (theoryReferences(after, note.id, removed) || after.notes.some(owner => flattenResearchBlocks(owner.blocks).some(block =>
      block.type === 'noteEmbed' && block.sourceNoteId === note.id && block.blockIds?.some(id => removed.has(id)) ||
      block.type === 'formula' && block.parts?.some(part => part.type === 'symbol' && part.source?.noteId === note.id && removed.has(part.source.formulaId)),
    )))) fail('内容仍有引用，无法删除或撤回。');
    for (const block of flattenResearchBlocks(current.blocks)) if (block.type === 'formula') {
      const previous = findResearchBlock(note.blocks, block.id)?.block;
      if (previous?.type === 'formula' && nativeFingerprint(previous.outputs) !== nativeFingerprint(block.outputs)) {
        const error = formulaMetadataError(before, { noteId: note.id, formulaId: block.id }, block.outputs ?? []);
        if (error) fail(error);
      }
    }
  }
}
function checkedBlock(state: ResearchNotebookState, value: ResearchNotebookBlock, ownerNoteId?: string): ResearchNotebookBlock {
  if (value.type === 'external' || value.type === 'evidence') return value;
  let result: ResearchNotebookBlock = value;
  if (value.type === 'citation' || value.type === 'dataset' || value.type === 'diagram') result = normalizeResearchRichBlock(value);
  else if (value.type === 'media') result = normalizeMediaBlock(value);
  else if (value.type === 'bookmark') result = normalizeBookmarkBlock(value);
  else if (value.type === 'noteEmbed') {
    result = normalizeNoteEmbed(value);
    const error = noteEmbedSelectionError(state.notes, { noteId: ownerNoteId ?? '', blockId: value.id }, result);
    if (error) fail(error);
  } else {
    const normalized = normalizeResearchBlock(value);
    if (!normalized || normalized.type !== value.type) fail('内容块字段无效，原内容保持不变。');
    result = normalized;
  }
  if (value.section) result = { ...result, section: value.section };
  if (result.type === 'formula') {
    const error = formulaLatexError(result.tex);
    if (error) fail(error);
    for (const part of result.parts ?? []) {
      if (part.type === 'symbol') {
        if (!state.symbols.some(entry => entry.id === part.entryId)) fail('公式引用的符号已不存在。');
        if (part.source && !resolveFormulaSource(state, part.source)) fail('公式来源已不存在。');
      }
      if (part.type === 'latex') { const error = formulaLatexError(part.tex); if (error) fail(error); }
    }
    if (result.outputs?.some(output => !state.symbols.some(entry => entry.id === output.entryId))) fail('公式结果引用的符号已不存在。');
    if (value.type === 'formula' && value.parts?.length !== undefined && value.parts.length !== result.parts?.length) fail('公式片段无效。');
    const address = { noteId: ownerNoteId ?? '', formulaId: value.id };
    const metadataError = formulaMetadataError(state, address, result.outputs ?? []);
    if (metadataError) fail(metadataError);
    for (const part of result.parts ?? []) if (part.type === 'symbol') {
      const sourceError = formulaSourceError(state, address, part);
      if (sourceError) fail(sourceError);
    }
    if (result.parts?.length === 0) { const { parts: _parts, ...formula } = result; result = formula; }
  }
  return result;
}
function preserveView(previous: ResearchNotebookState, next: ResearchNotebookState): ResearchNotebookState {
  return { ...next, view: previous.view, activeNoteId: next.notes.some(note => note.id === previous.activeNoteId) ? previous.activeNoteId : next.activeNoteId,
    ...(next.theoryMaps && previous.theoryMaps && next.theoryMaps.documents.some(doc => doc.id === previous.theoryMaps!.activeMapId) ? { theoryMaps: { ...next.theoryMaps, activeMapId: previous.theoryMaps.activeMapId } } : {}) };
}
function mapContext(state: ResearchNotebookState, mapId: string): ResearchNotebookState {
  const next = ensureAiTheoryMaps(state);
  if (!next.theoryMaps!.documents.some(doc => doc.id === mapId)) fail('目标理论地图已不存在。');
  return { ...next, view: 'maps', theoryMaps: { ...next.theoryMaps!, activeMapId: mapId } };
}

/** Validate and freeze generated IDs once, before exposing the concrete review proposal. */
export function prepareNativeEdit(state: ResearchNotebookState, input: unknown): AiNativeEdit {
  validateAiNativeInput(input);
  if (JSON.stringify(input).length > 40000) fail('AI 内容为空或超过允许长度。');
  const edit: AiNativeEdit = { ...clone(input), fields: clone(input.fields ?? {}) as Record<string, unknown>, generatedId: crypto.randomUUID(), generatedAt: new Date().toISOString() } as unknown as AiNativeEdit;
  if (edit.fields.outputs && ['block-insert', 'block-update'].includes(edit.action)) {
    edit.fields.outputs = (edit.fields.outputs as { id?: string }[]).map(output => ({ ...output, id: output.id ?? crypto.randomUUID() }));
  }
  if (edit.action === 'block-insert') {
    const type = edit.blockType ?? fail('请选择要插入的内容类型。');
    if (type === 'external' || type === 'evidence') fail('外部来源内容由用户通过对应插件插入。');
    validateAiFields(edit.fields, aiBlockFields[type]);
    const initial = type === 'noteEmbed' ? { id: edit.generatedId, type: 'noteEmbed' } : createResearchContentBlock(type === 'media' ? 'image' : type) ?? fail('不支持创建此内容类型。');
    edit.block = checkedBlock(state, { ...initial, ...edit.fields, id: edit.generatedId } as ResearchNotebookBlock, edit.noteId);
  }
  if (edit.action === 'term-save') {
    validateAiFields(edit.fields, aiTermFields);
    const before = state.terms?.find(term => term.id === edit.entryId);
    if (edit.fields.aliasEntries) edit.fields.aliasEntries = (edit.fields.aliasEntries as { id?: string; name: string }[]).map(alias => ({ ...alias, id: alias.id ?? researchTermAliases(before ?? { id: '', name: '', meaning: '', aliases: [] }).find(item => item.name === alias.name)?.id ?? crypto.randomUUID() }));
    else if (edit.fields.aliases) edit.fields.aliasEntries = (edit.fields.aliases as string[]).map(name => ({ id: before ? researchTermAliases(before).find(alias => alias.name === name)?.id ?? crypto.randomUUID() : crypto.randomUUID(), name }));
    if (before && typeof edit.fields.name === 'string' && before.name.trim().toLocaleLowerCase() !== edit.fields.name.trim().toLocaleLowerCase()) {
      const aliases = clone(edit.fields.aliasEntries ?? researchTermAliases(before)) as { id: string; name: string }[];
      if (!aliases.some(alias => alias.name.trim().toLocaleLowerCase() === before.name.trim().toLocaleLowerCase())) aliases.push({ id: `legacy:${encodeURIComponent(before.name)}`, name: before.name });
      edit.fields.aliasEntries = aliases;
    }
    if (edit.fields.atoms) edit.fields.atoms = (edit.fields.atoms as { id?: string; text: string; meaning: string }[]).map(atom => ({ ...atom, id: atom.id ?? before?.atoms?.find(item => item.text === atom.text)?.id ?? crypto.randomUUID() }));
  }
  const next = runNativeEdit(state, edit);
  if (!nativeEditEffects(state, next).length) fail('此操作没有产生内容变化，或当前引用不允许执行。');
  return edit;
}

/** Uses the same domain operations as user editing; never saves or mutates its input. */
export function runNativeEdit(state: ResearchNotebookState, edit: AiNativeEdit): ResearchNotebookState {
  const fields = edit.fields;
  switch (edit.action) {
    case 'note-update': {
      validateAiFields(fields, aiNoteFields);
      const note = noteFor(state, edit), metadata = getResearchNoteMetadata(note);
      const { frontmatter, ...patch } = fields;
      if (frontmatter !== undefined) {
        const custom = frontmatter as ResearchFrontmatter;
        if (Object.keys(custom).some(key => [...noteMetadataKeys, 'id', 'blocks', 'frontmatter', '__proto__', 'prototype', 'constructor'].includes(key as typeof noteMetadataKeys[number]))) fail('自定义属性不能覆盖笔记内部字段。');
        for (const key of Object.keys(note.frontmatter ?? {})) delete metadata[key];
        Object.assign(metadata, custom);
      }
      return preserveView(state, applyResearchNoteMetadata(state, note.id, { ...metadata, ...patch } as ResearchFrontmatter));
    }
    case 'note-delete': {
      const note = noteFor(state, edit); referenceGuard(state, note.id, 'note');
      const next = deleteResearchNote(state, note.id);
      if (next.notes.some(item => item.id === note.id)) fail('笔记仍有引用或为最后一篇笔记，无法删除。');
      return next;
    }
    case 'block-insert': {
      const note = noteFor(state, edit);
      if (!edit.block || !getResearchBlockContainer(note.blocks, edit.container)) fail('目标标签页或插入内容无效。');
      if (edit.block.id !== edit.generatedId || edit.block.type !== edit.blockType || ['external', 'evidence'].includes(edit.block.type)) fail('AI 插入内容标识无效。');
      const next = insertResearchBlock(state, note.id, checkedBlock(state, edit.block, note.id), edit.beforeBlockId, edit.container);
      if (next === state) fail('插入位置无效或内容 ID 已存在。');
      return next;
    }
    case 'block-update': {
      const note = noteFor(state, edit), block = blockFor(state, edit);
      validateAiFields(fields, aiBlockFields[block.type]);
      const candidate = checkedBlock(state, { ...block, ...fields,
        ...(block.type === 'formula' && typeof fields.tex === 'string' && fields.parts === undefined ? { parts: undefined } : {}),
        ...('appearance' in fields && 'appearance' in block ? { appearance: { ...(block.appearance ?? {}), ...fields.appearance as object } } : {}),
      } as ResearchNotebookBlock, note.id);
      return updateResearchNote(state, note.id, { blocks: updateResearchBlockTree(note.blocks, block.id, () => candidate) });
    }
    case 'block-delete': {
      const block = blockFor(state, edit), next = removeResearchBlock(state, requiredId(edit.noteId), block.id);
      if (next === state) fail('内容块仍有引用，无法删除。');
      guardRemovedContent(state, next);
      return next;
    }
    case 'block-move': {
      blockFor(state, edit);
      const next = moveResearchBlock(state, requiredId(edit.noteId), requiredId(edit.blockId), { container: edit.container, beforeBlockId: edit.beforeBlockId });
      if (next === state) fail('移动位置无效，或不能把容器放入自身。');
      return next;
    }
    case 'tab-insert': case 'tab-update': case 'tab-delete': case 'tab-move': {
      const note = noteFor(state, edit), block = blockFor(state, edit);
      if (block.type !== 'examples') fail('目标内容不是标签页容器。');
      const tab = block.tabs.find(tab => tab.id === edit.tabId);
      if (edit.action !== 'tab-insert' && !tab) fail('目标标签页已不存在。');
      let tabs = block.tabs;
      if (edit.action === 'tab-delete') {
        if (tabs.length <= 1) fail('请至少保留一个标签页。');
        tabs = tabs.filter(item => item.id !== tab!.id);
      } else if (edit.action === 'tab-update') {
        if (!edit.title?.trim()) fail('标签页标题不能为空。');
        tabs = tabs.map(item => item.id === tab!.id ? { ...item, title: edit.title! } : item);
      } else {
        if (edit.beforeTabId && !tabs.some(item => item.id === edit.beforeTabId)) fail('标签页排序位置已不存在。');
        const moved = edit.action === 'tab-insert' ? { id: edit.generatedId, title: edit.title?.trim() || '标签页', blocks: [] } : tab!;
        tabs = tabs.filter(item => item.id !== moved.id);
        const index = edit.beforeTabId ? tabs.findIndex(item => item.id === edit.beforeTabId) : tabs.length;
        if (index < 0) fail('不能将标签页移动到自身之前。');
        tabs = [...tabs.slice(0, index), moved, ...tabs.slice(index)];
      }
      const next = updateResearchNote(state, note.id, { blocks: updateResearchBlockTree(note.blocks, block.id, () => ({ ...block, tabs })) });
      if (edit.action === 'tab-delete') guardRemovedContent(state, next);
      return next;
    }
    case 'symbol-save': {
      validateAiFields(fields, aiSymbolFields);
      if (fields.slots && (fields.slots as { key: string }[]).some((slot, index) => slot.key !== ['x1', 'x2', 'x3'][index])) fail('符号位置字段必须按 x1、x2、x3 排列。');
      const before = edit.entryId ? state.symbols.find(item => item.id === edit.entryId) ?? fail('目标符号已不存在。') : null;
      const candidate = createSymbolEntry({ ...(before ?? { name: '', meaning: '', notation: '', category: 'custom', slots: [] }), ...fields } as Omit<ResearchSymbolEntry, 'id'>, before?.id ?? edit.generatedId);
      const error = symbolEntryError(candidate, state.symbols); if (error) fail(error);
      const next = before ? updateSymbolEntry(state, candidate) : addSymbolEntry(state, candidate);
      if (next === state) fail('符号字段无效或没有变化。');
      return next;
    }
    case 'symbol-delete': {
      const id = requiredId(edit.entryId);
      if (!state.symbols.some(entry => entry.id === id)) fail('目标符号已不存在。');
      referenceGuard(state, id, 'symbol');
      const next = deleteSymbolEntry(state, id);
      if (next === state) fail('符号仍有引用，无法删除。');
      return next;
    }
    case 'term-save': {
      validateAiFields(fields, aiTermFields);
      for (const key of ['aliasEntries', 'atoms'] as const) if (fields[key]) {
        const entries = fields[key] as { id: string }[];
        if (entries.some(entry => !entry.id?.trim()) || new Set(entries.map(entry => entry.id)).size !== entries.length) fail('术语子项标识不能为空或重复。');
      }
      const before = edit.entryId ? state.terms?.find(item => item.id === edit.entryId) ?? fail('目标术语已不存在。') : null;
      const candidate = createTermEntry({ ...(before ?? { name: '', meaning: '', aliases: [] }), ...fields } as Omit<ResearchTermEntry, 'id'>, before?.id ?? edit.generatedId);
      const error = termEntryError(candidate, state.terms ?? []); if (error) fail(error);
      return before ? updateTermEntry(state, candidate) : addTermEntry(state, candidate);
    }
    case 'term-delete': {
      const id = requiredId(edit.entryId);
      if (!state.terms?.some(entry => entry.id === id)) fail('目标术语已不存在。');
      referenceGuard(state, id, 'term');
      const next = deleteTermEntry(state, id);
      // The legacy domain guard matches URL prefixes; exact references were checked above.
      return next === state ? { ...state, terms: state.terms!.filter(entry => entry.id !== id) } : next;
    }
    case 'map-create': case 'map-update': {
      validateAiFields(fields, aiMapFields);
      let next = edit.action === 'map-create' ? addTheoryMapDocument(ensureAiTheoryMaps(state), typeof fields.title === 'string' ? fields.title : '未命名地图', fields.noteIds as string[] | undefined) : mapContext(state, requiredId(edit.mapId));
      const existing = next.theoryMaps!.documents.find(doc => doc.id === next.theoryMaps!.activeMapId)!;
      const id = edit.action === 'map-create' ? edit.generatedId : existing.id;
      if (edit.action === 'map-create') next = { ...next, theoryMaps: { ...next.theoryMaps!, documents: next.theoryMaps!.documents.map(doc => doc.id === existing.id ? { ...doc, id } : doc), activeMapId: id } };
      const document = { ...existing, ...fields, id, ...(fields.view ? { view: { ...existing.view, ...fields.view as object } } : {}) } as TheoryMapDocument;
      if (document.noteIds.some(id => !state.notes.some(note => note.id === id))) fail('地图引用的笔记已不存在。');
      next = updateTheoryMapDocument(next, document);
      if (edit.action === 'map-create') {
        const stamp = edit.generatedAt ?? state.notes[0]?.createdAt ?? '2000-01-01T00:00:00.000Z';
        next = { ...next, theoryMaps: { ...next.theoryMaps!, documents: next.theoryMaps!.documents.map(doc => doc.id === id ? { ...doc, createdAt: stamp, updatedAt: stamp } : doc) } };
      }
      return preserveView(state, next);
    }
    case 'map-delete': {
      const id = requiredId(edit.mapId); mapContext(state, id);
      if (id === 'global') fail('全局理论地图不能删除。');
      return preserveView(state, deleteTheoryMapDocument(ensureAiTheoryMaps(state), id));
    }
    case 'relation-save': case 'relation-delete': {
      if (!!edit.mapId === !!edit.noteId) fail('请选择一个笔记或理论地图保存关系。');
      const context = edit.mapId ? mapContext(state, edit.mapId) : { ...ensureAiTheoryMaps(state), view: 'notes' as const, activeNoteId: noteFor(state, edit).id };
      if (edit.action === 'relation-save') {
        validateAiFields(fields, aiRelationFields, ['source', 'target', 'kind', 'description']);
        const relation = { ...fields, id: edit.relationId ?? edit.generatedId } as unknown as TheoryRelation;
        if (edit.noteId && relation.target.noteId !== edit.noteId) fail('笔记关系必须保存在目标笔记中。');
        const error = theoryRelationError(context, relation); if (error) fail(error);
        return preserveView(state, saveTheoryRelation(context, relation));
      }
      const relationId = requiredId(edit.relationId);
      const relations = edit.mapId ? nativeEntity(state, 'map', edit.mapId) as TheoryMapDocument : noteFor(state, edit).theory;
      if (!relations?.relations.some(relation => relation.id === relationId)) fail('目标关系已不存在。');
      return preserveView(state, removeTheoryRelation(context, relationId));
    }
    default: { const exhaustive: never = edit.action; return exhaustive; }
  }
}

const documentNavigation = ['expandedNoteIds', 'showAllBlocks', 'selectedNodeId'] as const;
const legacyNavigation = ['open', 'scope', 'topicId', 'depth', ...documentNavigation] as const;
const changed = (before: unknown, after: unknown) => nativeFingerprint(before) !== nativeFingerprint(after);
function viewProjection(view: TheoryDocumentView, before?: TheoryDocumentView, after?: TheoryDocumentView, all = false) {
  return {
    ...Object.fromEntries(documentNavigation.filter(key => all || before && after && changed(before[key], after[key])).map(key => [key, view[key]])),
    layout: { positions: view.layout.positions, ...(all || before && after && changed(before.layout.viewport, after.layout.viewport) ? { viewport: view.layout.viewport } : {}) },
  };
}
function mapWorkspaceProjection(value: TheoryMapWorkspace | null | undefined, before?: TheoryMapWorkspace | null, after?: TheoryMapWorkspace | null, all = false) {
  return value ? { ...value, activeMapId: undefined, noteViewOpen: undefined, noteViews: undefined,
    documents: value.documents.map(doc => ({ ...doc, updatedAt: undefined,
      view: viewProjection(doc.view, before?.documents.find(item => item.id === doc.id)?.view, after?.documents.find(item => item.id === doc.id)?.view, all),
    })),
  } : null;
}
function legacyMapProjection(value: ResearchTheoryMapState | null | undefined, before?: ResearchTheoryMapState | null, after?: ResearchTheoryMapState | null) {
  if (!value) return null;
  return { ...value, ...Object.fromEntries(legacyNavigation.filter(key => !(before && after && changed(before[key], after[key]))).map(key => [key, undefined])),
    layouts: Object.fromEntries(Object.entries(value.layouts).flatMap(([key, layout]) => {
      const viewportChanged = before && after && changed(before.layouts[key]?.viewport, after.layouts[key]?.viewport);
      return Object.keys(layout.positions).length || viewportChanged ? [[key, { positions: layout.positions, ...(viewportChanged ? { viewport: layout.viewport } : {}) }]] : [];
    })),
  };
}
function mapEffectProjection(effect: Extract<AiNativeEffect, { collection: 'theoryMaps' | 'theoryMap' }>, value: unknown) {
  return effect.collection === 'theoryMaps'
    ? mapWorkspaceProjection(value as TheoryMapWorkspace | null, effect.before as TheoryMapWorkspace | null, effect.after as TheoryMapWorkspace | null)
    : legacyMapProjection(value as ResearchTheoryMapState | null, effect.before as ResearchTheoryMapState | null, effect.after as ResearchTheoryMapState | null);
}
function restoreDocumentNavigation(value: TheoryDocumentView, current: TheoryDocumentView, before?: TheoryDocumentView, after?: TheoryDocumentView): TheoryDocumentView {
  const next = clone(value);
  for (const key of documentNavigation) if (!(before && after && changed(before[key], after[key]))) Object.assign(next, { [key]: clone(current[key]) });
  if (!(before && after && changed(before.layout.viewport, after.layout.viewport))) next.layout.viewport = clone(current.layout.viewport);
  return next;
}
function restoreMapNavigation(value: TheoryMapWorkspace, current: TheoryMapWorkspace, before: TheoryMapWorkspace | null, after: TheoryMapWorkspace | null): TheoryMapWorkspace {
  return { ...value,
    activeMapId: value.documents.some(doc => doc.id === current.activeMapId) ? current.activeMapId : value.documents.some(doc => doc.id === value.activeMapId) ? value.activeMapId : value.documents.find(doc => doc.kind === 'global')?.id ?? value.documents[0].id,
    noteViewOpen: current.noteViewOpen, noteViews: clone(current.noteViews),
    documents: value.documents.map(doc => {
      const existing = current.documents.find(item => item.id === doc.id);
      return existing ? { ...doc, view: restoreDocumentNavigation(doc.view, existing.view, before?.documents.find(item => item.id === doc.id)?.view, after?.documents.find(item => item.id === doc.id)?.view) } : doc;
    }),
  };
}
function restoreLegacyNavigation(value: ResearchTheoryMapState | null, current: ResearchTheoryMapState | undefined, after: ResearchTheoryMapState | null): ResearchTheoryMapState | undefined {
  if (!value || !current) return clone(value) ?? undefined;
  const next = clone(value);
  for (const key of legacyNavigation) if (!(after && changed(value[key], after[key]))) Object.assign(next, { [key]: clone(current[key]) });
  for (const key of new Set([...Object.keys(next.layouts), ...Object.keys(current.layouts)])) {
    if (after && changed(value.layouts[key]?.viewport, after.layouts[key]?.viewport)) continue;
    const layout = next.layouts[key] ?? { positions: {} };
    next.layouts[key] = { ...layout, viewport: clone(current.layouts[key]?.viewport) };
  }
  return next;
}

/** Full v1 snapshots retain content; workspace navigation does not create an edit effect. */
export function nativeEditEffects(before: ResearchNotebookState, after: ResearchNotebookState): AiNativeEffect[] {
  const effects: AiNativeEffect[] = [];
  for (const collection of ['notes', 'symbols', 'terms'] as const) {
    const left = before[collection] ?? [], right = after[collection] ?? [];
    for (const id of new Set([...left, ...right].map(item => item.id))) {
      const a = left.find(item => item.id === id) ?? null, b = right.find(item => item.id === id) ?? null;
      if (nativeFingerprint(a) !== nativeFingerprint(b)) effects.push({ collection, id, before: clone(a), after: clone(b), index: Math.max(0, left.findIndex(item => item.id === id)) });
    }
  }
  const beforeMaps = before.theoryMaps ?? (after.theoryMaps ? ensureAiTheoryMaps(before).theoryMaps : undefined);
  if (changed(mapWorkspaceProjection(beforeMaps, undefined, undefined, true), mapWorkspaceProjection(after.theoryMaps, undefined, undefined, true))) {
    effects.push({ collection: 'theoryMaps', before: clone(beforeMaps ?? null), after: clone(after.theoryMaps ?? null) });
  }
  if (changed(legacyMapProjection(before.theoryMap), legacyMapProjection(after.theoryMap))) effects.push({ collection: 'theoryMap', before: clone(before.theoryMap ?? null), after: clone(after.theoryMap ?? null) });
  return effects;
}
export function restoreNativeEffects(state: ResearchNotebookState, effects: AiNativeEffect[]): ResearchNotebookState {
  for (const effect of effects) {
    const current = 'id' in effect ? state[effect.collection]?.find(item => item.id === effect.id) ?? null : state[effect.collection] ?? null;
    if (changed('id' in effect ? current : mapEffectProjection(effect, current), 'id' in effect ? effect.after : mapEffectProjection(effect, effect.after))) fail('目标内容或关联内容已变化，无法安全撤回。');
    if ('id' in effect && effect.before && effect.collection === 'symbols') { const error = symbolEntryError(effect.before as ResearchSymbolEntry, state.symbols); if (error) fail(error); }
    if ('id' in effect && effect.before && effect.collection === 'terms') { const error = termEntryError(effect.before as ResearchTermEntry, state.terms ?? []); if (error) fail(error); }
  }
  let next = { ...state };
  for (const effect of effects) {
    if ('id' in effect) {
      const items: AiNativeEntity[] = [...next[effect.collection] ?? []].filter(item => item.id !== effect.id);
      if (effect.before) items.splice(effect.index, 0, clone(effect.before));
      next = { ...next, [effect.collection]: items };
    } else next = { ...next, [effect.collection]: effect.collection === 'theoryMap'
      ? restoreLegacyNavigation(effect.before as ResearchTheoryMapState | null, state.theoryMap, effect.after as ResearchTheoryMapState | null)
      : clone(effect.before) ?? undefined };
  }
  const maps = effects.find(effect => effect.collection === 'theoryMaps');
  if (maps && !('id' in maps)) {
    if (next.theoryMap && effects.some(effect => effect.collection === 'theoryMap' && effect.before && !effect.after)) {
      const { theoryMaps: _maps, ...legacy } = next;
      next = ensureAiTheoryMaps(legacy);
    } else if (!next.theoryMaps) next = ensureAiTheoryMaps(next);
    if (state.theoryMaps) next = { ...next, theoryMaps: restoreMapNavigation(next.theoryMaps!, state.theoryMaps, maps.before as TheoryMapWorkspace | null, maps.after as TheoryMapWorkspace | null) };
  }
  guardRemovedContent(state, next);
  for (const effect of effects) if ('id' in effect && effect.before === null) referenceGuard(next, effect.id, effect.collection === 'notes' ? 'note' : effect.collection === 'symbols' ? 'symbol' : 'term');
  return preserveView(state, next);
}
