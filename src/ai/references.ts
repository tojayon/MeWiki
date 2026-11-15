import type { ResearchNote, ResearchNotebookState } from '../domain/researchNotebook.ts';
import { getNoteLibrary } from '../domain/researchNoteLibraries.ts';
import { isMeWikiManualNote } from '../domain/meWikiManual.ts';
import { resolveSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { researchTermAliases, type ResearchTermEntry } from '../domain/researchTerms.ts';
import type { TheoryMapDocument } from '../domain/researchTheoryMap.ts';
import { t } from '../i18n/locale.ts';
import { aiProductModules, type AiProductModule } from './productCatalog.ts';

export interface AiObjectReference {
  kind: 'module' | 'note' | 'symbol' | 'term' | 'map';
  id: string;
}

export interface AiReferenceItem extends AiObjectReference {
  label: string;
  detail?: string;
}

export const AI_MAX_REFERENCES = 12;
const kinds = new Set<AiObjectReference['kind']>(['module', 'note', 'symbol', 'term', 'map']);
const clip = (value: string, maximum: number) => value.length > maximum ? value.slice(0, maximum - 1) + '…' : value;
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
const key = (reference: AiObjectReference) => JSON.stringify([reference.kind, reference.id]);

/** Restore only identities; damaged metadata must not silently remove a task boundary. */
export function restoreAiReferences(value: unknown): AiObjectReference[] | undefined {
  if (!Array.isArray(value) || value.length > AI_MAX_REFERENCES) return undefined;
  const result = new Map<string, AiObjectReference>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const candidate = item as Record<string, unknown>;
    if (!kinds.has(candidate.kind as AiObjectReference['kind']) || typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 1000) return undefined;
    const reference = { kind: candidate.kind as AiObjectReference['kind'], id: candidate.id };
    result.set(key(reference), reference);
  }
  return [...result.values()];
}
export function combineAiReferences(...groups: readonly AiObjectReference[][]): AiObjectReference[] {
  const unique = new Map(groups.flat().map(reference => [key(reference), reference]));
  const result = restoreAiReferences([...unique.values()]);
  if (!result) throw new Error('一次最多引用 12 个对象。');
  return result;
}

/** A stale note selection never becomes an implicit target on another page. */
export function aiCurrentReference(state: ResearchNotebookState): AiObjectReference | undefined {
  if (state.view === 'dictionary') {
    const reference: AiObjectReference = state.activeTermId ? { kind: 'term', id: state.activeTermId } : { kind: 'symbol', id: state.activeSymbolId };
    return resolveAiReference(state, reference) ? reference : undefined;
  }
  if (state.view === 'maps') {
    const reference: AiObjectReference = { kind: 'map', id: state.theoryMaps?.activeMapId ?? '' };
    return resolveAiReference(state, reference) ? reference : undefined;
  }
  const note = state.notes.find(item => item.id === state.activeNoteId);
  if (!note || (!isMeWikiManualNote(note) && getNoteLibrary(note) !== (state.view === 'foundations' ? 'foundation' : 'research'))) return undefined;
  return { kind: 'note', id: note.id };
}

const symbolTex = (symbol: ResearchSymbolEntry) => resolveSymbolEntry(symbol, Object.fromEntries(symbol.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
function moduleItem(module: AiProductModule): AiReferenceItem {
  return { kind: 'module', id: module.id, label: clip(t(module.name), 180), detail: clip(t(module.description), 320) };
}
function noteItem(note: ResearchNote): AiReferenceItem {
  const type = isMeWikiManualNote(note) ? t('使用手册') : getNoteLibrary(note) === 'foundation' ? t('基础理论') : t('研究记录');
  return { kind: 'note', id: note.id, label: clip(note.title || t('未命名笔记'), 180), detail: clip([type, note.tags?.[0] || t('未分类')].join(' / '), 320) };
}
function symbolItem(symbol: ResearchSymbolEntry, tex = symbolTex(symbol)): AiReferenceItem {
  return { kind: 'symbol', id: symbol.id, label: clip(symbol.name, 180), detail: clip([t('符号词典'), symbol.tags?.[0], tex].filter(Boolean).join(' / '), 320) };
}
function termItem(term: ResearchTermEntry): AiReferenceItem {
  return { kind: 'term', id: term.id, label: clip(term.name, 180), detail: clip([t('术语词典'), term.tags?.[0], term.englishName || term.englishAbbreviation].filter(Boolean).join(' / '), 320) };
}
function mapItem(map: TheoryMapDocument): AiReferenceItem {
  return { kind: 'map', id: map.id, label: clip(map.title, 180), detail: t('理论地图') };
}

export function resolveAiReference(state: ResearchNotebookState, reference: AiObjectReference): AiReferenceItem | undefined {
  if (reference.kind === 'module') {
    const module = aiProductModules.find(item => item.id === reference.id);
    return module ? moduleItem(module) : undefined;
  }
  if (reference.kind === 'note') {
    const note = state.notes.find(item => item.id === reference.id);
    return note ? noteItem(note) : undefined;
  }
  if (reference.kind === 'symbol') {
    const symbol = state.symbols.find(item => item.id === reference.id);
    return symbol ? symbolItem(symbol) : undefined;
  }
  if (reference.kind === 'term') {
    const term = state.terms?.find(item => item.id === reference.id);
    return term ? termItem(term) : undefined;
  }
  if (reference.kind === 'map') {
    const map = state.theoryMaps?.documents.find(item => item.id === reference.id);
    return map ? mapItem(map) : undefined;
  }
  return undefined;
}

function matchScore(query: string, fields: readonly string[]) {
  if (!query) return 1;
  const values = fields.map(normalize).filter(Boolean);
  if (values.some(value => value === query)) return 100;
  if (values.some(value => value.startsWith(query))) return 80;
  if (values.some(value => value.includes(query))) return 60;
  const words = query.split(/\s+/);
  return words.length > 1 && words.every(word => values.some(value => value.includes(word))) ? 40 : 0;
}

/** Name search reads public metadata only, never note bodies, attachments or plugin data. */
export function searchAiReferences(state: ResearchNotebookState, query: string): AiReferenceItem[] {
  const needle = normalize(query.slice(0, 1000)), matches: { item: AiReferenceItem; score: number; order: number }[] = [];
  let order = 0;
  const add = (fields: string[], item: () => AiReferenceItem) => {
    const score = matchScore(needle, fields), at = order++;
    if (!score) return;
    matches.push({ item: item(), score, order: at });
  };
  for (const module of aiProductModules) add([module.name, t(module.name), module.englishName, ...module.aliases, module.id], () => moduleItem(module));
  for (const note of state.notes) add([note.title, ...(note.tags ?? []), note.id], () => noteItem(note));
  for (const symbol of state.symbols) {
    const tex = symbolTex(symbol);
    add([symbol.name, ...(symbol.aliases ?? []), symbol.notation, tex, ...(symbol.tags ?? []), symbol.id], () => symbolItem(symbol, tex));
  }
  for (const term of state.terms ?? []) add([term.name, ...researchTermAliases(term).map(alias => alias.name), term.englishName ?? '', term.englishAbbreviation ?? '', term.chineseAbbreviation ?? '', ...(term.tags ?? []), term.id], () => termItem(term));
  for (const map of state.theoryMaps?.documents ?? []) add([map.title, map.id], () => mapItem(map));
  matches.sort((left, right) => right.score - left.score || left.order - right.order);
  const duplicates = new Map<string, number>();
  for (const { item } of matches) {
    const identity = JSON.stringify([item.label, item.detail]);
    duplicates.set(identity, (duplicates.get(identity) ?? 0) + 1);
  }
  return matches.slice(0, 24).map(({ item }) => (duplicates.get(JSON.stringify([item.label, item.detail])) ?? 0) > 1
    ? { ...item, detail: `${clip(item.detail ?? '', 200)} · ${clip(item.id, 110)}` }
    : item);
}

export function aiReferenceError(state: ResearchNotebookState, references: readonly AiObjectReference[]): string {
  if (!restoreAiReferences(references)) return t('引用对象无效，请重新选择。');
  const missing = references.find(reference => !resolveAiReference(state, reference));
  return missing ? t`引用对象已移除或不可用：${clip(missing.id, 180)}。` : '';
}

export function aiReferenceContext(state: ResearchNotebookState, references: readonly AiObjectReference[]): AiReferenceItem[] {
  const error = aiReferenceError(state, references);
  if (error) throw new Error(error);
  return restoreAiReferences(references)!.map(reference => resolveAiReference(state, reference)!);
}

export function quickAiPrompts(state: ResearchNotebookState, current = aiCurrentReference(state)): { label: string; task: string }[] {
  if (!current || !resolveAiReference(state, current)) return [];
  if (current.kind === 'symbol') return [
    { label: t('解释角标'), task: t('请解释当前符号的书写、默认角标和适用含义，先读取该符号，不修改资料。') },
    { label: t('查找引用'), task: t('请查找已授权范围内当前符号的引用，说明实际用法；需要扩大读取范围时先说明。') },
    { label: t('检查书写'), task: t('请根据符号词典核对已授权内容中当前符号的书写，保持字体和角标规范，只对需要调整之处提出建议。') },
  ];
  if (current.kind === 'term') return [
    { label: t('完善定义'), task: t('请先读取当前术语，检查定义的准确性、边界与一致性，提出定义完善建议。') },
    { label: t('核对别名'), task: t('请先读取当前术语，核对中英文名称、缩写与别名的一致性，仅提出必要的修改建议。') },
  ];
  if (current.kind === 'map') return [
    { label: t('解释关系'), task: t('请先读取当前理论地图，解释节点之间已有关系的含义和依据，不修改资料。') },
    { label: t('检查关联'), task: t('请检查当前理论地图中已有关系的方向、重复与缺失依据，提出需要用户确认的建议。') },
  ];
  return [];
}
