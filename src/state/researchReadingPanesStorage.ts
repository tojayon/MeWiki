import { createReadingPanes, type ResearchReadingPane, type ResearchReadingPanes } from "./researchReadingPanes.ts";

export const READING_PANES_STORAGE_KEY = "mewiki:research-reading-panes";

export function loadReadingPanes(noteId: string, scope: string, storage?: Pick<Storage, "getItem">): ResearchReadingPanes {
  const fallback = () => createReadingPanes(noteId);
  try {
    const saved = JSON.parse((storage ?? sessionStorage).getItem(READING_PANES_STORAGE_KEY + ":" + scope) ?? "null");
    const reading = saved?.reading;
    if (saved?.version !== 1 || !reading || typeof reading.primaryNoteId !== "string" || !Array.isArray(reading.panes)) return fallback();
    const panes: ResearchReadingPane[] = [];
    const ids = new Set<string>();
    for (const pane of reading.panes) {
      if (!pane || typeof pane.id !== "string" || !pane.id || ids.has(pane.id)
        || typeof pane.noteId !== "string" || !pane.noteId
        || (pane.parentId !== null && (typeof pane.parentId !== "string" || !ids.has(pane.parentId)))
        || (!panes.length && (pane.id !== "primary" || pane.parentId !== null || pane.noteId !== reading.primaryNoteId))) return fallback();
      const source = pane.source;
      panes.push({
        id: pane.id, noteId: pane.noteId, parentId: pane.parentId,
        ...(typeof pane.blockId === "string" && pane.blockId ? { blockId: pane.blockId } : {}),
        ...(source && typeof source.blockId === "string" && source.blockId && Number.isSafeInteger(source.linkIndex) && source.linkIndex >= 0
          ? { source: { blockId: source.blockId, linkIndex: source.linkIndex } } : {}),
      });
      ids.add(pane.id);
    }
    return { primaryNoteId: reading.primaryNoteId, panes, activeId: ids.has(reading.activeId) ? reading.activeId : panes[0]?.id ?? null };
  } catch {
    return fallback();
  }
}

export function saveReadingPanes(reading: ResearchReadingPanes, scope: string, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? sessionStorage).setItem(READING_PANES_STORAGE_KEY + ":" + scope, JSON.stringify({ version: 1, reading }));
  } catch {
    // Reading remains usable when the browser cannot retain a session.
  }
}
