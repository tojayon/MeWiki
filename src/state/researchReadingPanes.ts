export interface ResearchReadingSource { blockId: string; linkIndex: number }
export interface ResearchReadingPane { id: string; noteId: string; parentId: string | null; blockId?: string; source?: ResearchReadingSource }
export interface ResearchReadingPanes { primaryNoteId: string; panes: ResearchReadingPane[]; activeId: string | null }

export function createReadingPanes(noteId: string): ResearchReadingPanes {
  return { primaryNoteId: noteId, panes: noteId ? [{ id: "primary", noteId, parentId: null }] : [], activeId: noteId ? "primary" : null };
}
function descendants(panes: ResearchReadingPane[], sourceId: string): Set<string> {
  const result = new Set([sourceId]);
  for (const pane of panes) if (pane.parentId && result.has(pane.parentId)) result.add(pane.id);
  return result;
}
function promote(state: ResearchReadingPanes, panes: ResearchReadingPane[], activeId: string | null): ResearchReadingPanes {
  const first = panes[0];
  if (first && first.id !== "primary") {
    const id = first.id;
    panes = panes.map(pane => ({ ...pane, id: pane.id === id ? "primary" : pane.id, parentId: pane.parentId === id ? "primary" : pane.parentId }));
    if (activeId === id) activeId = "primary";
  }
  return { primaryNoteId: first?.noteId ?? state.primaryNoteId, panes, activeId: panes.some(pane => pane.id === activeId) ? activeId : panes[0]?.id ?? null };
}
export function closeReadingPane(state: ResearchReadingPanes, id: string): ResearchReadingPanes {
  const removed = descendants(state.panes, id);
  const source = state.panes.find(pane => pane.id === id);
  const activeId = removed.has(state.activeId ?? "") ? source?.parentId ?? null : state.activeId;
  return promote(state, state.panes.filter(pane => !removed.has(pane.id)), activeId);
}
export function detachReadingPane(state: ResearchReadingPanes, id: string): ResearchReadingPanes {
  return { ...state, panes: state.panes.map(pane => pane.id === id ? { ...pane, parentId: null, source: undefined } : pane) };
}
export function openReadingPane(state: ResearchReadingPanes, sourceId: string, noteId: string, id: string, blockId?: string, reference?: ResearchReadingSource): ResearchReadingPanes {
  const source = state.panes.find(pane => pane.id === sourceId);
  if (!source) return state;
  // References always open to this pane's right, including notes already in
  // its ancestry. Unique pane IDs keep the layout acyclic when notes repeat.
  const child = state.panes.find(pane => pane.parentId === sourceId);
  if (child?.noteId === noteId) return { ...state, activeId: child.id, panes: blockId || reference ? state.panes.map(pane => pane.id === child.id ? { ...pane, ...(blockId ? { blockId } : {}), ...(reference ? { source: reference } : {}) } : pane) : state.panes };
  const removed = child ? descendants(state.panes, child.id) : new Set<string>();
  const panes = state.panes.filter(pane => !removed.has(pane.id));
  panes.splice(panes.findIndex(pane => pane.id === sourceId) + 1, 0, { id, noteId, parentId: sourceId, ...(blockId ? { blockId } : {}), ...(reference ? { source: reference } : {}) });
  return { ...state, panes, activeId: id };
}
export function selectReadingPrimary(state: ResearchReadingPanes, noteId: string): ResearchReadingPanes {
  if (state.primaryNoteId === noteId && state.panes[0]?.id === "primary") return { ...state, activeId: "primary" };
  const removed = descendants(state.panes, "primary");
  return { primaryNoteId: noteId, panes: [{ id: "primary", noteId, parentId: null }, ...state.panes.filter(pane => !removed.has(pane.id))], activeId: "primary" };
}
export function synchronizeReadingPanes(state: ResearchReadingPanes, noteId: string, validIds: ReadonlySet<string>): ResearchReadingPanes {
  let next = state.primaryNoteId !== noteId ? selectReadingPrimary(state, noteId) : state;
  const removed = new Set<string>();
  for (const pane of next.panes) if (!validIds.has(pane.noteId) || (pane.parentId && removed.has(pane.parentId))) removed.add(pane.id);
  if (removed.size) next = promote(next, next.panes.filter(pane => !removed.has(pane.id)), next.activeId);
  return next;
}
