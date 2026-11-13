import type { PluginExporter, PluginManifest } from '../plugins/sdk/types.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { mapResearchBlocks } from '../domain/researchBlockTree.ts';
import { assertResearchLibraryNotebook } from './researchLibraryFile.ts';

export interface PublicationSession {
  initialMode?: 'images';
  plugin: PluginManifest;
  exporter: PluginExporter;
  snapshot: ResearchNotebookState;
  noteId: string;
  selectedTabs: Record<string, string>;
}
export interface PublicationTabSnapshot {
  initialMode?: 'images';
  version: 1;
  libraryId: string;
  directory: string | null;
  pluginId: string;
  pluginVersion: string;
  exporterId: string;
  snapshot: ResearchNotebookState;
  noteId: string;
  selectedTabs: Record<string, string>;
}
const sessionKey = (id: string) => `mewiki:publication:${id}`;
export function openImageCreation(plugin: PluginManifest, exporter: PluginExporter, libraryId: string, directory: string | null, onError: (message: string) => void, title: string) {
  const noteId = 'image-creation';
  const snapshot: ResearchNotebookState = { version: 8, open: true, view: 'notes', activeSymbolId: '', symbols: [], terms: [], activeNoteId: noteId, notes: [{ id: noteId, title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), blocks: [] }] };
  openPublicationTab(() => ({ plugin, exporter, snapshot, noteId, selectedTabs: {}, initialMode: 'images' }), libraryId, directory, onError);
}

/** Copy temporary PDF reading pages into the export snapshot, never the saved note. */
export function withPublicationPdfPages(state: ResearchNotebookState, noteId: string, pages: Record<string, number>): ResearchNotebookState {
  return { ...state, notes: state.notes.map(note => note.id !== noteId ? note : { ...note, blocks: mapResearchBlocks(note.blocks, block => {
    const page = pages[block.id];
    return block.type === 'media' && block.kind === 'pdf' && Number.isSafeInteger(page) && page > 0
      ? { ...block, document: { ...block.document, page } } : block;
  }) }) };
}

/** Open synchronously during the click; wait for editor blur before taking the snapshot. */
export function openPublicationTab(getSnapshot: () => PublicationSession, libraryId: string, directory: string | null, onError: (message: string) => void) {
  const opened = window.open('about:blank', '_blank');
  if (!opened) {
    onError('请允许浏览器打开新标签页，然后重试图文导出。');
    return;
  }
  opened.opener = null;
  window.requestAnimationFrame(() => {
    try {
      if (opened.closed) return;
      const session = getSnapshot();
      const id = crypto.randomUUID();
      const value: PublicationTabSnapshot = {
        version: 1, libraryId, directory,
        pluginId: session.plugin.id, pluginVersion: session.plugin.version, exporterId: session.exporter.id,
        snapshot: session.snapshot, noteId: session.noteId, selectedTabs: session.selectedTabs,
        ...(session.initialMode ? { initialMode: session.initialMode } : {}),
      };
      // This tab's temporary storage keeps a refresh independent of the original notebook.
      opened.sessionStorage.setItem(sessionKey(id), JSON.stringify(value));
      const url = new URL(window.location.href);
      url.search = ''; url.hash = '';
      url.searchParams.set('library', libraryId);
      url.searchParams.set('publication', id);
      opened.location.replace(url.href);
    } catch {
      opened.close();
      onError('无法打开导出页面，请检查浏览器可用存储空间后重试。');
    }
  });
}

export function readPublicationTab(url: URL, storage: Pick<Storage, 'getItem'>): PublicationTabSnapshot {
  try {
    const id = url.searchParams.get('publication');
    if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error();
    const value = JSON.parse(storage.getItem(sessionKey(id)) ?? 'null') as PublicationTabSnapshot | null;
    if (!value || value.version !== 1 || value.initialMode !== undefined && value.initialMode !== 'images' || value.libraryId !== url.searchParams.get('library') ||
      !value.libraryId || typeof value.pluginId !== 'string' || typeof value.pluginVersion !== 'string' ||
      typeof value.exporterId !== 'string' || !(value.directory === null || typeof value.directory === 'string') ||
      !value.selectedTabs || typeof value.selectedTabs !== 'object' || Array.isArray(value.selectedTabs) ||
      Object.values(value.selectedTabs).some(tab => typeof tab !== 'string')) throw new Error();
    assertResearchLibraryNotebook(value.snapshot);
    if (!value.snapshot.notes.some(note => note.id === value.noteId)) throw new Error();
    return value;
  } catch {
    throw new Error('导出内容已失效，请回到笔记重新打开图文导出。');
  }
}
