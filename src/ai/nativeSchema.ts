import Ajv from 'ajv';
import type { ResearchNotebookBlock } from '../domain/researchNotebook.ts';
import { formulaOperators } from '../domain/researchDictionary.ts';
import { researchMarkdownKinds } from '../domain/researchMarkdown.ts';

export const aiString = { type: 'string', maxLength: 40000 };
const short = { type: 'string', maxLength: 1000 };
const strings = { type: 'array', items: short, maxItems: 250 };
const number = { type: 'number' };
const boolean = { type: 'boolean' };
export const aiObject = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items: unknown, maxItems = 250) => ({ type: 'array', items, maxItems });
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values });
const bindings = { type: 'object', additionalProperties: short, maxProperties: 100 };
const source = { anyOf: [aiObject({ type: { const: 'asset' }, assetId: short }, ['type', 'assetId']), aiObject({ type: { const: 'url' }, url: short }, ['type', 'url'])] };
const reference = aiObject({ noteId: short, blockId: short }, ['noteId']);
const position = aiObject({ x: number, y: number }, ['x', 'y']);
const layout = aiObject({ positions: { type: 'object', additionalProperties: position }, viewport: aiObject({ x: number, y: number, zoom: number }, ['x', 'y', 'zoom']) }, ['positions']);
const annotation = aiObject({ ref: reference, role: enumeration(['foundation', 'assumption', 'model', 'unclassified']) }, ['ref', 'role']);
const formulaSource = aiObject({ noteId: short, formulaId: short, outputId: short }, ['noteId', 'formulaId', 'outputId']);
const formulaPart = { anyOf: [
  aiObject({ type: { const: 'symbol' }, entryId: short, bindings, source: formulaSource }, ['type', 'entryId', 'bindings']),
  aiObject({ type: { const: 'operator' }, operator: enumeration(formulaOperators.map(item => item.id)) }, ['type', 'operator']),
  aiObject({ type: { const: 'latex' }, tex: aiString }, ['type', 'tex']),
  aiObject({ type: enumeration(['lineBreak', 'alignmentPoint']) }, ['type']),
] };
const colors = (keys: string[]) => Object.fromEntries(keys.map(key => [key, { type: 'string', pattern: '^#[a-fA-F0-9]{3}([a-fA-F0-9]{3})?$' }]));
const section = enumeration(['given', 'conclusion']);

/** Exhaustive against the native union: new content types must choose an AI contract. */
export const aiBlockFields = {
  paragraph: { text: aiString, section },
  heading: { text: aiString, level: { type: 'integer', minimum: 1, maximum: 6 }, section },
  markdown: { text: aiString, kind: enumeration(researchMarkdownKinds), section },
  list: { items: array(aiString), section },
  formula: { tex: aiString, caption: aiString, conditions: aiString, parts: array(formulaPart), outputs: array(aiObject({ id: short, entryId: short, bindings }, ['entryId', 'bindings'])), layout: enumeration(['centered', 'aligned']), section },
  callout: { title: short, text: aiString, appearance: aiObject({ ...colors(['labelBackground', 'labelColor', 'borderColor']), borderStyle: enumeration(['solid', 'dashed', 'dashdot']), borderWidth: { type: 'number', minimum: 0.5, maximum: 6 } }), section },
  examples: { title: short, labelPosition: enumeration(['left', 'center', 'right']), appearance: aiObject(colors(['borderColor', 'backgroundColor', 'headerBackground', 'labelBackground', 'labelColor', 'accentColor'])), section },
  media: { kind: enumeration(['image', 'audio', 'video', 'pdf', 'file']), source, caption: aiString, alt: short, display: aiObject({ align: enumeration(['left', 'center', 'right']), widthPercent: { type: 'number', minimum: 25, maximum: 100 } }), poster: source, playback: aiObject({ rate: { type: 'number', minimum: 0.25, maximum: 4 }, loop: boolean }), document: aiObject({ page: { type: 'integer', minimum: 1 } }), section },
  bookmark: { title: short, description: aiString, siteName: short, url: short, section },
  citation: { title: short, authors: short, year: short, venue: short, doi: short, url: short, notes: aiString, pdf: source, pdfName: short, pdfPage: { type: 'integer', minimum: 1 }, section },
  dataset: { title: short, columns: strings, rows: array(array(aiString), 2000), source, sourceName: short, sheetName: short, chart: aiObject({ kind: enumeration(['line', 'scatter', 'bar']), x: { type: 'integer', minimum: 0 }, ys: array({ type: 'integer', minimum: 0 }, 10) }, ['kind', 'x', 'ys']), section },
  diagram: { title: short, mode: enumeration(['mermaid', 'drawing']), code: aiString, strokes: array(aiObject({ id: short, kind: enumeration(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text']), points: array(position, 4000), color: short, width: number, text: short }, ['id', 'kind', 'points', 'color', 'width']), 500), section },
  noteEmbed: { sourceNoteId: short, blockIds: strings, sourceTitle: short, section },
  external: { note: aiString },
  evidence: { note: aiString },
} satisfies Record<ResearchNotebookBlock['type'], Record<string, unknown>>;
export const aiNoteFields = {
  title: short, tags: strings, library: enumeration(['foundation', 'research']), researchType: enumeration(['application', 'derivation']),
  basisNoteIds: strings, reviewStatus: enumeration(['pending', 'reviewing', 'reviewed']), createdAt: short, reviewedAt: short,
  frontmatter: { type: 'object', maxProperties: 100 },
};
export const aiNoteSnapshotFields = { ...aiNoteFields, updatedAt: short };
export const aiSymbolFields = {
  name: short, aliases: strings, notation: aiString, meaning: aiString, category: enumeration(['time', 'index', 'state', 'control', 'communication', 'scheduler', 'evaluation', 'custom']), tags: strings, unit: short, scope: aiString,
  slots: { ...array(aiObject({ key: enumeration(['x1', 'x2', 'x3']), defaultValue: short, description: aiString }, ['key', 'defaultValue']), 3), minItems: 3 },
};
/** Stored entries retain the native editor's fixed labels and legacy positional metadata. */
export const aiSymbolSnapshotFields = { ...aiSymbolFields, slots: array(aiObject({ key: enumeration(['x1', 'x2', 'x3']), label: short, domain: enumeration(['packet', 'adoption', 'scheduler-event', 'loop', 'time', 'generic']), defaultValue: short, description: aiString, examples: strings, optional: boolean, placement: enumeration(['inline', 'parentheses', 'suffix-subscript']) }, ['key', 'label', 'domain', 'defaultValue']), 3) };
export const aiTermFields = {
  name: short, meaning: aiString, englishName: short, englishAbbreviation: short, chineseAbbreviation: short, aliases: strings,
  aliasEntries: array(aiObject({ id: short, name: short }, ['name'])), atoms: array(aiObject({ id: short, text: short, meaning: aiString }, ['text', 'meaning'])),
  tags: strings, scope: aiString, status: enumeration(['active', 'deprecated']),
};
export const aiMapFields = { title: short, noteIds: strings, annotations: array(annotation), view: aiObject({ expandedNoteIds: strings, showAllBlocks: boolean, selectedNodeId: short, layout }) };
export const aiRelationFields = { source: reference, target: reference, kind: enumeration(['derivation', 'assumption', 'adaptation']), description: aiString };
export const aiNativeActions = ['note-update', 'note-delete', 'block-insert', 'block-update', 'block-delete', 'block-move', 'tab-insert', 'tab-update', 'tab-delete', 'tab-move', 'symbol-save', 'symbol-delete', 'term-save', 'term-delete', 'map-create', 'map-update', 'map-delete', 'relation-save', 'relation-delete'] as const;
export type AiNativeAction = typeof aiNativeActions[number];
export const aiNativeEditSchema = aiObject({
  action: enumeration(aiNativeActions), noteId: short, blockId: short, blockType: enumeration(Object.keys(aiBlockFields)), tabId: short,
  entryId: short, mapId: short, relationId: short, title: short, beforeBlockId: short, beforeTabId: short,
  container: aiObject({ exampleBlockId: short, tabId: short }, ['exampleBlockId', 'tabId']),
  fields: { type: 'object', maxProperties: 30 },
}, ['action']);
const ajv = new Ajv({ allErrors: false, strict: false });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function validateAiFields(value: unknown, properties: Record<string, unknown>, required: string[] = []): asserts value is Record<string, unknown> {
  const schema = aiObject(properties, required), key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) { validate = ajv.compile(schema); validators.set(key, validate); }
  if (!validate(value)) throw new Error(`AI 操作字段无效：${validate.errors?.[0]?.instancePath || validate.errors?.[0]?.params?.additionalProperty || '参数'}。`);
}

/** Reuse the action boundary when preparing proposals and recovering saved sessions. */
export function validateAiNativeInput(value: unknown): asserts value is Record<string, unknown> {
  validateAiFields(value, aiNativeEditSchema.properties, ['action']);
  const action = value.action as AiNativeAction;
  const allowed = action === 'block-insert' ? ['noteId', 'blockType', 'container', 'beforeBlockId']
    : action === 'block-move' ? ['noteId', 'blockId', 'container', 'beforeBlockId']
    : action.startsWith('block-') ? ['noteId', 'blockId']
    : action === 'tab-insert' ? ['noteId', 'blockId', 'title', 'beforeTabId']
    : action === 'tab-update' ? ['noteId', 'blockId', 'tabId', 'title']
    : action === 'tab-move' ? ['noteId', 'blockId', 'tabId', 'beforeTabId']
    : action === 'tab-delete' ? ['noteId', 'blockId', 'tabId']
    : action.startsWith('symbol-') || action.startsWith('term-') ? ['entryId']
    : action === 'map-create' ? [] : action.startsWith('map-') ? ['mapId']
    : action.startsWith('relation-') ? ['mapId', 'noteId', 'relationId'] : ['noteId'];
  if (Object.keys(value).some(key => !['action', 'fields', ...allowed].includes(key))) throw new Error('AI 操作包含无关字段。');
  const required = action.startsWith('note-') ? ['noteId']
    : action === 'block-insert' ? ['noteId', 'blockType']
    : action.startsWith('block-') ? ['noteId', 'blockId']
    : action.startsWith('tab-') ? ['noteId', 'blockId', ...(action === 'tab-insert' ? [] : ['tabId']), ...(action === 'tab-update' ? ['title'] : [])]
    : action === 'symbol-delete' || action === 'term-delete' ? ['entryId']
    : action === 'map-update' || action === 'map-delete' ? ['mapId']
    : action === 'relation-delete' ? ['relationId'] : [];
  if (required.some(key => typeof value[key] !== 'string' || !(value[key] as string).trim())) throw new Error('AI 操作缺少目标或必填字段。');
  if (action.startsWith('relation-') && !!value.noteId === !!value.mapId) throw new Error('请选择一个笔记或理论地图保存关系。');
  if ((!action.endsWith('-save') && !['note-update', 'block-insert', 'block-update', 'map-create', 'map-update'].includes(action)) && Object.keys(value.fields ?? {}).length) throw new Error('此操作不接受内容字段。');
}
