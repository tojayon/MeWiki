import { normalizeResearchNotebook, type ResearchNotebookState } from '../domain/researchNotebook.ts';
import { BrowserMediaStore } from '../state/researchMediaStorage.ts';
import { createBrowserMediaArchive, releaseBrowserMediaArchive } from '../state/researchMediaArchive.ts';
import { assertResearchLibraryNotebook } from '../state/researchLibraryFile.ts';

export function readLegacyNotebook(storage: Pick<Storage, 'getItem'>): ResearchNotebookState {
  const raw = storage.getItem('cislunar:research-notebook') ?? storage.getItem('cislunar:research-notebook:v1');
  if (!raw) throw new Error('此 WebBench 地址下没有旧浏览器笔记。如已设置本地资料库，请直接在 MeWiki 中连接原目录。');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('version' in value) || ![1, 2, 3, 4, 5, 6, 7, 8].includes(Number(value.version)) || !('notes' in value) || !Array.isArray(value.notes) || !value.notes.length) throw new Error('旧浏览器笔记格式无效，原资料保持不变。');
  const notebook = normalizeResearchNotebook(value);
  assertResearchLibraryNotebook(notebook);
  return notebook;
}
/** Runs only after the user clicks export, in the legacy host's own origin. */
export async function exportLegacyBrowserNotebook(): Promise<void> {
  const notebook = readLegacyNotebook(window.localStorage);
  const store = new BrowserMediaStore('webbench-research-media');
  const archive = await createBrowserMediaArchive(notebook, 'library', undefined, store);
  const url = URL.createObjectURL(archive); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'webbench-notes-with-media.zip'; anchor.click();
  window.setTimeout(() => { URL.revokeObjectURL(url); void releaseBrowserMediaArchive(archive).catch(() => {}); }, 60000);
}
