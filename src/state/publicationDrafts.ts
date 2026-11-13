import type { PublicationImageCrop, PublicationOptions } from '../domain/publicationTypes.ts';
import type { CompositionItemEdits } from './compositionEdits.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { flattenResearchBlocks } from '../domain/researchBlockTree.ts';
import { collectPublicationImages } from '../domain/publicationImages.ts';

export interface PublicationDraftScope {
  libraryId: string; pluginId: string; exporterId: string; noteId: string; entry: 'note' | 'images';
}
export interface PublicationDraftSource { id: string; name: string; blob?: Blob; assetId?: string }
export interface PublicationDraftImages {
  includeCandidates: boolean; sources: PublicationDraftSource[]; selectedIds: string[];
  crops: Record<string, PublicationImageCrop>; currentId: string;
  /** Candidate IDs are positional; verify the original asset before reusing a selection. */
  candidates?: Record<string, string>;
}
export interface PublicationDraft {
  /** Order of the snapshot we actually read, never a newly sampled initialization time. */
  inheritedOrder?: number;
  options: PublicationOptions; title: string; templateId: string; profileId: string; profileName: string;
  selected: string[]; breaks: string[]; allTabs: boolean; selectedTabs: Record<string, string>; pdfPages: Record<string, number>;
  view: 'style' | 'content';
  pagedCanvas: Pick<PublicationOptions, 'width' | 'height' | 'fontSize' | 'margin'>;
  modeOptions: { note?: PublicationOptions; images?: PublicationOptions };
  images: PublicationDraftImages;
  editor: { items: CompositionItemEdits; scope: 'all' | 'current'; selectedId: string };
  design: { designId: string; name: string; lastSignature: string; updatedAt: string; autoSavePaused: boolean };
}
interface StoredDraft { key: string; scope: string; version: 1; order: number; value: PublicationDraft }
const unavailable = '导出草稿存储不可用。当前修改尚未保存，请检查浏览器存储权限或空间后重试。';
const invalid = '导出草稿无法读取，请重试。原草稿未被替换。';
const scopeKey = (scope: PublicationDraftScope) => JSON.stringify([scope.libraryId, scope.pluginId, scope.exporterId, scope.noteId, scope.entry]);
const draftKey = (scope: string, tabId: string) => JSON.stringify([scope, tabId]);
const assetKey = (scope: string, id: string) => JSON.stringify([scope, id]);

/** A new snapshot may have deleted blocks, tabs or replaced positional image candidates. */
export function reconcilePublicationDraft(value: PublicationDraft, state: ResearchNotebookState, noteId: string): PublicationDraft {
  const note = state.notes.find(item => item.id === noteId)!;
  const blocks = state.notes.flatMap(item => flattenResearchBlocks(item.blocks));
  const candidates = collectPublicationImages(state, noteId);
  const staleImage = (id: string) => value.images.includeCandidates && !!value.images.candidates?.[id] && !candidates.some(item => item.id === id && item.source.assetId === value.images.candidates![id]);
  const keepImages = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !staleImage(id)));
  return {
    ...value, selected: value.selected.filter(id => note.blocks.some(block => block.id === id)), breaks: value.breaks.filter(id => note.blocks.some(block => block.id === id)),
    selectedTabs: Object.fromEntries(Object.entries(value.selectedTabs).filter(([id, tabId]) => blocks.some(block => block.id === id && block.type === 'examples' && block.tabs.some(tab => tab.id === tabId)))),
    pdfPages: Object.fromEntries(Object.entries(value.pdfPages).filter(([id]) => blocks.some(block => block.id === id && block.type === 'media' && block.kind === 'pdf'))),
    images: { ...value.images, selectedIds: value.images.selectedIds.filter(id => !staleImage(id)), crops: keepImages(value.images.crops) },
    editor: { ...value.editor, items: keepImages(value.editor.items) },
    design: value.design.designId && value.images.selectedIds.some(staleImage) ? { ...value.design, autoSavePaused: true } : value.design,
  };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error(unavailable)); return; }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('mewiki:publication-drafts', 1); }
    catch { reject(new Error(unavailable)); return; }
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts', { keyPath: 'key' }).createIndex('scope', 'scope');
      request.result.createObjectStore('images', { keyPath: 'key' }).createIndex('scope', 'scope');
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = request.onblocked = () => reject(new Error(unavailable));
  });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error(unavailable)); });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(new Error(unavailable)); });
}
/** Structural checks deliberately accept unfinished numeric edits; export still validates strictly. */
function assertDraft(value: PublicationDraft): void {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const strings = (items: unknown) => Array.isArray(items) && items.length <= 10000 && items.every(item => typeof item === 'string');
  if (!record(value) || !record(value.options) || !record(value.modeOptions) || !record(value.pagedCanvas) ||
    value.inheritedOrder !== undefined && (!Number.isSafeInteger(value.inheritedOrder) || value.inheritedOrder < 0) ||
    !['title', 'templateId', 'profileId', 'profileName'].every(key => typeof value[key as keyof PublicationDraft] === 'string') ||
    !strings(value.selected) || !strings(value.breaks) || typeof value.allTabs !== 'boolean' || !['style', 'content'].includes(value.view) ||
    !record(value.selectedTabs) || !Object.values(value.selectedTabs).every(item => typeof item === 'string') ||
    !record(value.pdfPages) || !Object.values(value.pdfPages).every(item => Number.isSafeInteger(item) && Number(item) > 0) ||
    !record(value.editor) || !record(value.editor.items) || !['all', 'current'].includes(value.editor.scope) || typeof value.editor.selectedId !== 'string' ||
    !record(value.design) || !['designId', 'name', 'lastSignature', 'updatedAt'].every(key => typeof value.design[key as keyof PublicationDraft['design']] === 'string') || typeof value.design.autoSavePaused !== 'boolean' ||
    !record(value.images) || typeof value.images.includeCandidates !== 'boolean' || !strings(value.images.selectedIds) || !record(value.images.crops) || typeof value.images.currentId !== 'string' ||
    !Array.isArray(value.images.sources) || value.images.sources.length > 100 || value.images.sources.some(source => !record(source) || typeof source.id !== 'string' || typeof source.name !== 'string' ||
      source.assetId !== undefined && (typeof source.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(source.assetId)) || source.blob !== undefined && (!(source.blob instanceof Blob) || source.blob.size > 8 * 1024 * 1024))) throw new Error(invalid);
  // Reject broken object shapes before they reach the editor, without normalizing incomplete values.
  for (const options of [value.options, value.modeOptions.note, value.modeOptions.images].filter(Boolean)) {
    if (!record(options) || !['width', 'height', 'margin', 'fontSize', 'lineHeight', 'quality'].every(key => typeof options[key] === 'number') ||
      !['author', 'subtitle', 'header', 'footer', 'date', 'background', 'textColor', 'headingColor', 'accentColor', 'logo', 'coverImage'].every(key => typeof options[key] === 'string') ||
      !['png', 'jpeg'].includes(String(options.format)) || !['pages', 'long'].includes(String(options.mode)) || !['sans', 'serif'].includes(String(options.fontFamily)) ||
      typeof options.cover !== 'boolean' || typeof options.showPageNumbers !== 'boolean' ||
      options.imageMode !== undefined && (!record(options.imageMode) || !['contain', 'cover'].includes(String(options.imageMode.fit))) ||
      options.composition !== undefined && (!record(options.composition) || !Array.isArray(options.composition.layers) || options.composition.layers.length > 40 || options.composition.layers.some(layer => !record(layer) || typeof layer.id !== 'string' || !['text', 'sticker', 'image'].includes(String(layer.type))) || !record(options.composition.subject))) throw new Error(invalid);
  }
}

export async function readPublicationDraft(scope: PublicationDraftScope, tabId: string): Promise<PublicationDraft | undefined> {
  const db = await database();
  try {
    const key = scopeKey(scope), tx = db.transaction(['drafts', 'images'], 'readonly'), done = completed(tx);
    void done.catch(() => {});
    const rows = await requestValue<StoredDraft[]>(tx.objectStore('drafts').index('scope').getAll(key));
    const row = rows.find(item => item.key === draftKey(key, tabId)) ?? rows.sort((a, b) => b.order - a.order)[0];
    if (!row) { await done; return; }
    if (row.version !== 1) throw new Error(invalid);
    assertDraft(row.value);
    const sources = await Promise.all(row.value.images.sources.map(async source => {
      if (source.assetId) return source;
      const stored = await requestValue<{ blob: Blob } | undefined>(tx.objectStore('images').get(assetKey(key, source.id)));
      if (!stored?.blob) throw new Error(invalid);
      return { ...source, blob: stored.blob };
    }));
    await done;
    const value = { ...row.value, inheritedOrder: row.order, images: { ...row.value.images, sources } }; assertDraft(value); return value;
  } finally { db.close(); }
}

export async function savePublicationDraft(scope: PublicationDraftScope, tabId: string, value: PublicationDraft, initial = false): Promise<void> {
  assertDraft(value);
  const db = await database();
  try {
    const key = scopeKey(scope), tx = db.transaction(['drafts', 'images'], 'readwrite'), done = completed(tx);
    // Observe transaction errors immediately, even when a preceding request rejects.
    void done.catch(() => {});
    const drafts = tx.objectStore('drafts'), images = tx.objectStore('images');
    const [rows, existing] = await Promise.all([
      requestValue<StoredDraft[]>(drafts.index('scope').getAll(key)),
      requestValue(images.index('scope').getAllKeys(key)),
    ]);
    const known = new Set(existing);
    for (const source of value.images.sources) {
      const imageKey = assetKey(key, source.id);
      if (source.blob && !known.has(imageKey)) images.put({ key: imageKey, scope: key, blob: source.blob });
      else if (!source.assetId && !known.has(imageKey)) { tx.abort(); throw new Error(invalid); }
    }
    const ownKey = draftKey(key, tabId);
    const order = initial ? rows.find(item => item.key === ownKey)?.order ?? value.inheritedOrder ?? 0 : Math.max(Date.now(), ...rows.map(item => item.order + 1));
    const row: StoredDraft = { key: ownKey, scope: key, version: 1, order, value: { ...value, images: { ...value.images, sources: value.images.sources.map(source => ({ id: source.id, name: source.name, ...(source.assetId ? { assetId: source.assetId } : {}) })) } } };
    drafts.put(row);
    const retained = [row, ...rows.filter(item => item.key !== row.key).sort((a, b) => b.order - a.order).slice(0, 7)];
    const keys = new Set(retained.map(item => item.key));
    for (const old of rows) if (!keys.has(old.key)) drafts.delete(old.key);
    const referenced = new Set(retained.flatMap(item => item.value.images.sources.map(source => assetKey(key, source.id))));
    for (const image of existing) if (!referenced.has(String(image))) images.delete(image);
    await done;
  } finally { db.close(); }
}
