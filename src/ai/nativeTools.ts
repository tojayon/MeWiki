import type { AiToolContext } from './tools.ts';
import type { AiToolDefinition } from './types.ts';
import { aiBlockFields, aiMapFields, aiNativeEditSchema, aiNoteFields, aiObject, aiRelationFields, aiString, aiSymbolFields, aiSymbolSnapshotFields, aiTermFields, validateAiFields, type AiNativeAction } from './nativeSchema.ts';
import { createNativeProposal } from './nativeProposals.ts';
import { ensureAiTheoryMaps } from './nativeEdits.ts';
import { findResearchBlock, flattenResearchBlocks, getResearchBlockContainer, type ResearchExampleContainer } from '../domain/researchBlockTree.ts';
import { getResearchNoteMetadata } from '../domain/researchFrontmatter.ts';
import type { TheoryMapDocument } from '../domain/researchTheoryMap.ts';
import { readableAiNote } from './readable.ts';
import { isMeWikiManualNote } from '../domain/meWikiManual.ts';
import type { ResearchNote, ResearchNotebookBlock } from '../domain/researchNotebook.ts';
import type { ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { aiSymbolConventions, aiSymbolNotation, assertAiProposalSymbolNotation } from './symbolNotation.ts';

export type AiExecutableTool = AiToolDefinition & { execute: (ctx: AiToolContext, args: Record<string, unknown>) => unknown };
function fail(message: string): never { throw new Error(message); }
const id = (value: unknown) => typeof value === 'string' && value.trim() ? value : fail('AI 工具缺少目标 ID。');
export const nativeReadNote = (ctx: AiToolContext, noteId: unknown): ResearchNote => {
  const note = ctx.state.notes.find(note => note.id === noteId);
  if (!note || !ctx.noteIds.has(note.id)) fail('笔记不在本次授权范围内。');
  return note;
};
const fullReadRequired = (ctx: AiToolContext, noteId: unknown): ResearchNote => {
  const note = nativeReadNote(ctx, noteId);
  if (!ctx.readFullNoteIds.has(note.id)) fail('请先完整读取目标笔记的原文、属性和内容块分页。');
  return note;
};
export const cleanAiReadable = (value: unknown): unknown => typeof value === 'string' ? value.replace(/data:[^\s)"'<>]+/gi, '[内联附件已省略]')
  : Array.isArray(value) ? value.map(cleanAiReadable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, value]) => [key, cleanAiReadable(value)])) : value;
export function budgetAiRead<T>(ctx: AiToolContext, result: T): T {
  const safe = cleanAiReadable(result) as T, length = JSON.stringify(safe).length;
  if (length + ctx.readCharacters > 100000 || length > 60000) fail('本次资料读取已达到上限，请缩小范围或分段读取。');
  ctx.readCharacters += length;
  return safe;
}
const blockKey = (noteId: string, blockId: string) => JSON.stringify([noteId, blockId]);
function blockReadRequired(ctx: AiToolContext, note: ResearchNote, blockId: unknown): ResearchNotebookBlock {
  const block = findResearchBlock(note.blocks, id(blockId))?.block ?? fail('目标内容块已不存在。');
  if (!ctx.readBlockIds.has(blockKey(note.id, block.id))) fail('请先完整读取目标内容块再提出修改。');
  return block;
}
/** Project nested native structures through the same explicit field contract used for edits. */
function project(value: unknown, contract: unknown): unknown {
  if (!contract || typeof contract !== 'object') return undefined;
  const rule = contract as Record<string, unknown>;
  if (Array.isArray(rule.anyOf)) {
    const match = rule.anyOf.find(candidate => {
      const properties = (candidate as { properties?: Record<string, { const?: unknown; enum?: unknown[] }> }).properties;
      return properties && value && typeof value === 'object' && Object.entries(properties).every(([key, item]) => !('const' in item) || (value as Record<string, unknown>)[key] === item.const)
        && (!properties.type?.enum || properties.type.enum.includes((value as Record<string, unknown>).type));
    });
    return match ? project(value, match) : undefined;
  }
  if (Array.isArray(value)) return value.map(item => project(item, rule.items)).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    if (rule.properties && typeof rule.properties === 'object') return projectAiFields(value, rule.properties as Record<string, unknown>);
    if (rule.additionalProperties && typeof rule.additionalProperties === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, project(item, rule.additionalProperties)]).filter(([, item]) => item !== undefined));
    return undefined;
  }
  return value;
}
export function projectAiFields(value: object, properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(properties, key)).map(([key, item]) => [key, project(item, properties[key])]).filter(([, item]) => item !== undefined));
}
export function nativeBlockLocation(note: ResearchNote, block: ResearchNotebookBlock, includeTabs = true) {
  const location = findResearchBlock(note.blocks, block.id)!;
  return { id: block.id, type: block.type, editableText: ['paragraph', 'heading', 'markdown'].includes(block.type),
    path: location.path.map(container => {
      const parent = findResearchBlock(note.blocks, container.exampleBlockId)?.block;
      return { ...container, title: parent?.type === 'examples' ? (parent.tabs.find(tab => tab.id === container.tabId)?.title ?? '').slice(0, 1000) : '' };
    }),
    operations: ['block-update', 'block-delete', 'block-move', ...(block.type === 'examples' ? ['tab-insert', 'tab-update', 'tab-delete', 'tab-move'] : [])],
    ...(block.type === 'examples' ? { tabCount: block.tabs.length, ...(includeTabs ? { tabs: block.tabs.map(tab => ({ id: tab.id, title: tab.title, blockIds: tab.blocks.map(child => child.id) })) } : {}) } : {}),
  };
}
function blockFields(block: ResearchNotebookBlock) {
  if (block.type === 'external') return { title: block.title, summary: block.summary, note: block.note };
  if (block.type === 'evidence') return { runTitle: block.runTitle, time: block.time, eventLabel: block.eventLabel, note: block.note };
  return projectAiFields(block, aiBlockFields[block.type]);
}
function knownAssets(ctx: AiToolContext): Set<string> {
  const result = new Set<string>();
  const textAssets = (value: unknown): void => {
    if (typeof value === 'string') for (const match of value.matchAll(/webbench-asset:([a-f0-9]{64})\b/g)) result.add(match[1]);
    else if (Array.isArray(value)) value.forEach(textAssets);
    else if (value && typeof value === 'object') Object.values(value).forEach(textAssets);
  };
  for (const note of ctx.state.notes.filter(note => ctx.noteIds.has(note.id))) for (const block of flattenResearchBlocks(note.blocks)) {
    textAssets(blockFields(block));
    const sources = block.type === 'media' ? [block.source, block.poster] : block.type === 'citation' ? [block.pdf] : block.type === 'dataset' ? [block.source] : [];
    for (const source of sources) if (source?.type === 'asset' && /^[a-f0-9]{64}$/.test(source.assetId)) result.add(source.assetId);
  }
  return result;
}
function dictionaryReadRequired(ctx: AiToolContext, kind: 'symbol' | 'term', entryId: unknown): void {
  const target = id(entryId), entries = kind === 'symbol' ? ctx.state.symbols : ctx.state.terms;
  if (!entries?.some(entry => entry.id === target)) fail('目标词条已不存在。');
  if (!ctx.readDictionaryIds.has(`${kind}:${target}`)) fail('请先完整读取目标词条再提出修改或引用。');
}
function referenceReadRequired(ctx: AiToolContext, reference: unknown): void {
  if (!reference || typeof reference !== 'object') fail('引用目标无效。');
  const ref = reference as { noteId?: unknown; blockId?: unknown };
  const note = fullReadRequired(ctx, ref.noteId);
  if (ref.blockId !== undefined) blockReadRequired(ctx, note, ref.blockId);
}
function nodeReference(value: unknown): { noteId: string; blockId?: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && parts.length === 2 && typeof parts[0] === 'string' && (parts[1] === null || typeof parts[1] === 'string')
      ? { noteId: parts[0], ...(typeof parts[1] === 'string' ? { blockId: parts[1] } : {}) } : null;
  } catch { return null; }
}
function requireKnownResources(ctx: AiToolContext, fields: Record<string, unknown>): void {
  const allowed = knownAssets(ctx);
  const scanAssets = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/data:/i.test(value)) fail('AI 不接受内联附件原件，请使用已有附件引用。');
      for (const match of value.matchAll(/webbench-asset:([a-f0-9]{64})\b/g)) if (!allowed.has(match[1])) fail('只能引用本次授权资料中已有的附件。');
      return;
    }
    if (Array.isArray(value)) { value.forEach(scanAssets); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === 'asset' && (typeof record.assetId !== 'string' || !allowed.has(record.assetId))) fail('只能引用本次授权资料中已有的附件。');
    Object.values(record).forEach(scanAssets);
  };
  scanAssets(fields);
  for (const key of ['basisNoteIds', 'noteIds']) if (Array.isArray(fields[key])) fields[key].forEach(noteId => fullReadRequired(ctx, noteId));
  if (fields.sourceNoteId !== undefined) {
    const note = fullReadRequired(ctx, fields.sourceNoteId);
    if (Array.isArray(fields.blockIds)) fields.blockIds.forEach(blockId => blockReadRequired(ctx, note, blockId));
  }
  for (const key of ['parts', 'outputs']) if (Array.isArray(fields[key])) for (const item of fields[key]) {
    if (item && typeof item === 'object' && typeof item.entryId === 'string') dictionaryReadRequired(ctx, 'symbol', item.entryId);
    if (item?.source) {
      const source = item.source as { noteId?: unknown; formulaId?: unknown };
      blockReadRequired(ctx, fullReadRequired(ctx, source.noteId), source.formulaId);
    }
  }
  for (const key of ['source', 'target']) if (fields[key] && typeof fields[key] === 'object' && 'noteId' in fields[key]) referenceReadRequired(ctx, fields[key]);
  if (Array.isArray(fields.annotations)) for (const item of fields.annotations) referenceReadRequired(ctx, item.ref);
  if (fields.view && typeof fields.view === 'object') {
    const view = fields.view as { expandedNoteIds?: unknown[]; selectedNodeId?: unknown; layout?: { positions?: object } };
    view.expandedNoteIds?.forEach(noteId => fullReadRequired(ctx, noteId));
    const readNode = (key: unknown) => referenceReadRequired(ctx, nodeReference(key) ?? fail('地图节点标识无效。'));
    if (view.selectedNodeId) readNode(view.selectedNodeId);
    if (view.layout?.positions) Object.keys(view.layout.positions).forEach(readNode);
  }
}

const actionKeys: Record<AiNativeAction, string[]> = {
  'note-update': ['noteId', 'fields'], 'note-delete': ['noteId'],
  'block-insert': ['noteId', 'blockType', 'fields', 'container', 'beforeBlockId'],
  'block-update': ['noteId', 'blockId', 'fields'], 'block-delete': ['noteId', 'blockId'],
  'block-move': ['noteId', 'blockId', 'container', 'beforeBlockId'],
  'tab-insert': ['noteId', 'blockId', 'title', 'beforeTabId'], 'tab-update': ['noteId', 'blockId', 'tabId', 'title'],
  'tab-delete': ['noteId', 'blockId', 'tabId'], 'tab-move': ['noteId', 'blockId', 'tabId', 'beforeTabId'],
  'symbol-save': ['entryId', 'fields'], 'symbol-delete': ['entryId'], 'term-save': ['entryId', 'fields'], 'term-delete': ['entryId'],
  'map-create': ['fields'], 'map-update': ['mapId', 'fields'], 'map-delete': ['mapId'],
  'relation-save': ['noteId', 'mapId', 'relationId', 'fields'], 'relation-delete': ['noteId', 'mapId', 'relationId'],
};
function nativeEditContract(action: AiNativeAction, blockType?: unknown) {
  let fields: Record<string, unknown> = {};
  if (action === 'block-insert' || action === 'block-update') {
    if (typeof blockType !== 'string' || !Object.hasOwn(aiBlockFields, blockType)) fail('读取内容块字段契约时必须指定有效的 blockType 内容类型。');
    fields = aiBlockFields[blockType as keyof typeof aiBlockFields];
  } else if (action === 'note-update') fields = aiNoteFields;
  else if (action === 'symbol-save') fields = aiSymbolFields;
  else if (action === 'term-save') fields = aiTermFields;
  else if (action === 'map-create' || action === 'map-update') fields = aiMapFields;
  else if (action === 'relation-save') fields = aiRelationFields;
  const fieldRequired = action === 'map-create' ? ['noteIds'] : action === 'relation-save' ? ['source', 'target', 'kind', 'description'] : [];
  const fieldSchema = aiObject(fields, fieldRequired);
  const base = aiNativeEditSchema.properties as Record<string, unknown>;
  const properties = { action: { const: action }, ...Object.fromEntries(actionKeys[action].map(key => [key, key === 'fields' ? fieldSchema : base[key]])) };
  const required = ['action'];
  if (action.startsWith('note-') || action.startsWith('block-') || action.startsWith('tab-')) required.push('noteId');
  if ((action.startsWith('block-') && action !== 'block-insert') || action.startsWith('tab-')) required.push('blockId');
  if (action === 'block-insert') required.push('blockType');
  if (action.startsWith('tab-') && action !== 'tab-insert') required.push('tabId');
  if (action === 'symbol-delete' || action === 'term-delete') required.push('entryId');
  if (action === 'map-update' || action === 'map-delete') required.push('mapId');
  if (action === 'relation-delete') required.push('relationId');
  if (fieldRequired.length) required.push('fields');
  return { parameters: aiObject(properties, required), fields: fieldSchema };
}
function mapNoteIds(ctx: AiToolContext, doc: TheoryMapDocument): Set<string> {
  const ids = new Set(doc.kind === 'global' ? ctx.state.notes.filter(note => !isMeWikiManualNote(note)).map(note => note.id) : doc.noteIds);
  for (const item of doc.annotations) ids.add(item.ref.noteId);
  for (const item of doc.relations) { ids.add(item.source.noteId); ids.add(item.target.noteId); }
  doc.view.expandedNoteIds.forEach(noteId => ids.add(noteId));
  const selected = nodeReference(doc.view.selectedNodeId); if (selected) ids.add(selected.noteId);
  for (const key of Object.keys(doc.view.layout.positions)) { const ref = nodeReference(key); if (ref) ids.add(ref.noteId); }
  return ids;
}

/** Shared by completed tool calls and streaming previews; authorization never grants reads or writes. */
export function assertNativeEditAccess(ctx: AiToolContext, args: Record<string, unknown>): void {
  validateAiFields(args, aiNativeEditSchema.properties, ['action']);
  const action = args.action as AiNativeAction;
  const note = action.startsWith('note-') || action.startsWith('block-') || action.startsWith('tab-') || args.noteId !== undefined ? nativeReadNote(ctx, args.noteId) : undefined;
  if (note && isMeWikiManualNote(note)) fail('应用手册为只读内容，请复制为个人笔记后编辑。');
  const current = action === 'block-update' && note ? findResearchBlock(note.blocks, id(args.blockId))?.block : undefined;
  const contract = nativeEditContract(action, args.blockType ?? current?.type);
  validateAiFields(args, contract.parameters.properties, contract.parameters.required);
  const fields = (args.fields ?? {}) as Record<string, unknown>;
  if (action.startsWith('note-')) fullReadRequired(ctx, note!.id);
  if (action.startsWith('block-') || action.startsWith('tab-')) {
    const block = action === 'block-insert' ? undefined : blockReadRequired(ctx, note!, args.blockId);
    if (action === 'block-insert' && ['external', 'evidence'].includes(args.blockType as string)) fail('外部来源内容由用户通过对应插件插入。');
    if (action === 'block-insert' || action === 'block-move') {
      const container = args.container as ResearchExampleContainer | undefined;
      if (container) {
        const owner = blockReadRequired(ctx, note!, container.exampleBlockId);
        if (owner.type !== 'examples' || !owner.tabs.some(tab => tab.id === container.tabId)) fail('目标标签页已不存在。');
      } else fullReadRequired(ctx, note!.id);
      const siblings = getResearchBlockContainer(note!.blocks, container) ?? fail('目标内容容器无效。');
      if (args.beforeBlockId !== undefined && !siblings.some(item => item.id === args.beforeBlockId)) fail('排序目标不在指定标签页或根层中。');
      if (args.beforeBlockId !== undefined) blockReadRequired(ctx, note!, args.beforeBlockId);
    }
    if (action.startsWith('tab-')) {
      if (block?.type !== 'examples') fail('目标内容不是标签页容器。');
      const tab = block.tabs.find(tab => tab.id === args.tabId);
      if (action !== 'tab-insert' && !tab) fail('目标标签页已不存在。');
      if (args.beforeTabId !== undefined && !block.tabs.some(tab => tab.id === args.beforeTabId)) fail('排序目标不在此标签页容器中。');
      if (action === 'tab-delete') for (const child of flattenResearchBlocks(tab!.blocks)) blockReadRequired(ctx, note!, child.id);
    }
    if (action === 'block-delete' && block?.type === 'examples') for (const child of flattenResearchBlocks(block.tabs.flatMap(tab => tab.blocks))) blockReadRequired(ctx, note!, child.id);
    if (current?.type === 'noteEmbed' && fields.blockIds && !fields.sourceNoteId) requireKnownResources(ctx, { sourceNoteId: current.sourceNoteId, blockIds: fields.blockIds });
  }
  if (action.startsWith('symbol-') || action.startsWith('term-')) {
    if (args.entryId !== undefined) dictionaryReadRequired(ctx, action.startsWith('symbol-') ? 'symbol' : 'term', args.entryId);
  }
  if (args.mapId !== undefined) {
    const doc = ensureAiTheoryMaps(ctx.state).theoryMaps!.documents.find(doc => doc.id === args.mapId) ?? fail('目标理论地图已不存在。');
    const members = mapNoteIds(ctx, doc);
    for (const noteId of members) nativeReadNote(ctx, noteId);
    if (!ctx.readMapIds.has(doc.id)) fail('请先完整读取目标理论地图再提出修改。');
    for (const noteId of members) fullReadRequired(ctx, noteId);
  }
  if (action === 'map-create' && !Array.isArray(fields.noteIds)) fail('新建地图必须明确指定 noteIds，且先完整读取这些笔记。');
  if (action.startsWith('relation-') && args.noteId !== undefined) {
    const target = fullReadRequired(ctx, args.noteId);
    const relation = target.theory?.relations.find(relation => relation.id === args.relationId);
    if (relation) { referenceReadRequired(ctx, relation.source); referenceReadRequired(ctx, relation.target); }
  }
  requireKnownResources(ctx, fields);
}
export const nativeAiTools: AiExecutableTool[] = [
  { name: 'get_edit_schema', description: '读取原生操作的精确字段契约。action 指定操作，内容块更新/插入还应传 blockType。fields 只接受返回的属性；省略属性保留原值，数组整体替换，空字符串清除可选文字。', parameters: aiObject({ action: aiNativeEditSchema.properties.action, blockType: aiNativeEditSchema.properties.blockType }, ['action']), execute: (_ctx, args) => {
    const action = id(args.action) as AiNativeAction;
    return { action, ...nativeEditContract(action, args.blockType), notes: '稳定 ID 由读取结果提供。examples 是标签页容器，子块可单独编辑；新增或改名标签用 tab-*，不要替换整个容器。符号槽位使用 x1/x2/x3。新标签页及新词条子项 ID 可省略，由程序生成。' };
  } },
  { name: 'read_block', description: '读取授权笔记中一个内容块的完整可编辑字段、所属标签页路径和操作列表。修改、删除、移动块或标签页前先调用；不读取附件原件和插件私有数据。', parameters: aiObject({ noteId: aiString, blockId: aiString }, ['noteId', 'blockId']), execute: (ctx, args) => {
    const note = nativeReadNote(ctx, args.noteId), block = findResearchBlock(note.blocks, id(args.blockId))?.block ?? fail('目标内容块已不存在。');
    const readable = readableAiNote({ ...note, title: '', blocks: [block] }, ctx.state.notes.filter(item => ctx.noteIds.has(item.id)), ctx.state.symbols).slice(0, 12000);
    const result = budgetAiRead(ctx, { noteId: note.id, ...nativeBlockLocation(note, block), fields: blockFields(block),
      readable, symbolConventions: aiSymbolConventions(readable, ctx.state.symbols) });
    ctx.readBlockIds.add(blockKey(note.id, block.id)); ctx.sourceIds.add(note.id);
    return result;
  } },
  { name: 'read_dictionary_entry', description: '读取完整符号或术语字段及稳定 ID。修改/删除已有词条前必须调用；搜索片段不能代替完整读取。', parameters: aiObject({ kind: { type: 'string', enum: ['symbol', 'term'] }, entryId: aiString }, ['kind', 'entryId']), execute: (ctx, args) => {
    if (args.kind !== 'symbol' && args.kind !== 'term') fail('词条类型无效。');
    const entry = (args.kind === 'symbol' ? ctx.state.symbols : ctx.state.terms)?.find(item => item.id === id(args.entryId)) ?? fail('目标词条已不存在。');
    const result = budgetAiRead(ctx, { kind: args.kind, entry: { id: entry.id, ...projectAiFields(entry, args.kind === 'symbol' ? aiSymbolSnapshotFields : aiTermFields), ...(args.kind === 'symbol' ? { resolved: aiSymbolNotation(entry as ResearchSymbolEntry) } : {}) } }); ctx.readDictionaryIds.add(`${args.kind}:${entry.id}`); return result;
  } },
  { name: 'read_theory_maps', description: '浏览理论地图，或传 mapId 读取一张地图。列表用 offset 分页。仅返回本次授权笔记相关的成员与关系；只有完整范围均获授权并读取原文后才能修改地图，全局地图要求全库范围。', parameters: aiObject({ mapId: aiString, offset: { type: 'integer', minimum: 0 } }), execute: (ctx, args) => {
    const documents = ensureAiTheoryMaps(ctx.state).theoryMaps!.documents;
    const fullScope = ctx.state.notes.every(note => isMeWikiManualNote(note) || ctx.noteIds.has(note.id));
    const readableMap = (doc: TheoryMapDocument) => fullScope || !!ctx.support?.references.some(reference => reference.kind === 'map' && reference.id === doc.id) || [...mapNoteIds(ctx, doc)].some(noteId => ctx.noteIds.has(noteId));
    const scoped = (doc: typeof documents[number]) => {
      const selected = nodeReference(doc.view.selectedNodeId);
      return { id: doc.id, kind: doc.kind, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
        ...projectAiFields(doc, aiMapFields),
        noteIds: (doc.kind === 'global' ? ctx.state.notes.map(note => note.id) : doc.noteIds).filter(noteId => ctx.noteIds.has(noteId)),
        annotations: doc.annotations.filter(item => ctx.noteIds.has(item.ref.noteId)).map(item => projectAiFields(item, (aiMapFields.annotations.items as { properties: Record<string, unknown> }).properties)),
        relations: doc.relations.filter(item => ctx.noteIds.has(item.source.noteId) && ctx.noteIds.has(item.target.noteId)).map(item => ({ id: item.id, ...projectAiFields(item, aiRelationFields) })),
        scopeComplete: [...mapNoteIds(ctx, doc)].every(noteId => ctx.noteIds.has(noteId)),
        view: { expandedNoteIds: doc.view.expandedNoteIds.filter(noteId => ctx.noteIds.has(noteId)), showAllBlocks: doc.view.showAllBlocks,
          ...(selected && ctx.noteIds.has(selected.noteId) ? { selectedNodeId: doc.view.selectedNodeId } : {}),
          layout: { positions: Object.fromEntries(Object.entries(doc.view.layout.positions).filter(([key]) => { const ref = nodeReference(key); return ref && ctx.noteIds.has(ref.noteId); }).map(([key, point]) => [key, { x: point.x, y: point.y }])), ...(doc.view.layout.viewport ? { viewport: { x: doc.view.layout.viewport.x, y: doc.view.layout.viewport.y, zoom: doc.view.layout.viewport.zoom } } : {}) } },
      };
    };
    if (!args.mapId) {
      const offset = typeof args.offset === 'number' ? args.offset : 0;
      const visible = documents.filter(readableMap);
      const maps = visible.slice(offset, offset + 50).map(doc => ({ id: doc.id, title: doc.title, kind: doc.kind, noteCount: scoped(doc).noteIds.length }));
      return budgetAiRead(ctx, { maps, offset, nextOffset: offset + maps.length < visible.length ? offset + maps.length : null, mapCount: visible.length });
    }
    const doc = documents.find(doc => doc.id === args.mapId) ?? fail('目标理论地图已不存在。');
    if (!readableMap(doc)) fail('理论地图不在本次授权笔记的相关范围内。');
    const result = budgetAiRead(ctx, scoped(doc)); if (result.scopeComplete) ctx.readMapIds.add(doc.id); return result;
  } },
  { name: 'propose_edit', description: '提出待用户审阅的原生操作，不保存。支持笔记属性/删除，所有原生块的字段修改/插入/删除/移动，标签页增删改排序，完整符号/术语增删改，理论地图和关系。先 get_edit_schema 了解 fields；已有目标必须先读取。examples 内文字可通过具体子块 ID 编辑。外部来源仅能改备注或移动/删除，不改插件私有数据。', parameters: aiNativeEditSchema, execute: (ctx, args) => {
    if (ctx.proposals.length >= 20) fail('本次建议数量已达到上限。');
    const action = id(args.action);
    assertNativeEditAccess(ctx, args);
    const proposal = createNativeProposal(ctx.state, ctx.libraryId, args);
    assertAiProposalSymbolNotation(ctx.state, proposal);
    ctx.proposals.push(proposal);
    return { proposalId: proposal.id, status: '等待用户审阅', title: proposal.title, action };
  } },
];
export function nativeNoteMetadata(note: ResearchNote): unknown { return cleanAiReadable(getResearchNoteMetadata(note)); }
export function nativeNoteTheory(note: ResearchNote): unknown {
  return cleanAiReadable({
    annotations: (note.theory?.annotations ?? []).map(item => projectAiFields(item, (aiMapFields.annotations.items as { properties: Record<string, unknown> }).properties)),
    relations: (note.theory?.relations ?? []).map(item => ({ id: item.id, ...projectAiFields(item, aiRelationFields) })),
  });
}
export function nativeBlockPage(note: ResearchNote, offset: number) {
  const all = flattenResearchBlocks(note.blocks);
  if (offset > all.length) fail('内容块分页位置无效。');
  const blocks: ReturnType<typeof nativeBlockLocation>[] = [];
  for (const block of all.slice(offset, offset + 100)) {
    const location = nativeBlockLocation(note, block, false);
    if (blocks.length && JSON.stringify([...blocks, location]).length > 12000) break;
    blocks.push(location);
  }
  return { blocks, blockOffset: offset, nextBlockOffset: offset + blocks.length < all.length ? offset + blocks.length : null, blockCount: all.length };
}
