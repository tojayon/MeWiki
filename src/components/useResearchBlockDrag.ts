import { t } from "../i18n/locale.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import type { ResearchNotebookBlock } from "../domain/researchNotebook.ts";
import { findResearchBlock, type ResearchExampleContainer } from "../domain/researchBlockTree.ts";
import type { ResearchBlockDropTarget } from "../domain/researchBlockMovement.ts";
import { theoryAreaLabels, type TheoryContentArea } from "../domain/researchTheorySections.ts";
import "./ResearchBlockDrag.css";

export interface ResearchBlockDragHandle {
  selected: boolean;
  selecting: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, onStart: () => void) => void;
  onClickCapture: (event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

interface DropIndicator {
  left: number;
  top: number;
  width: number;
  zone: string;
  target: ResearchBlockDropTarget;
}

interface DragSession {
  pointerId: number;
  blockIds: string[];
  noteId: string;
  x: number;
  y: number;
  started: boolean;
  target: ResearchBlockDropTarget | null;
  cleanup: (commit: boolean) => void;
}

function selectedRoots(blocks: ResearchNotebookBlock[], ids: readonly string[]) {
  const selected = new Set(ids);
  const roots: string[] = [];
  const visit = (siblings: ResearchNotebookBlock[]) => {
    for (const block of siblings) {
      if (selected.has(block.id)) roots.push(block.id);
      else if (block.type === "examples") block.tabs.forEach(tab => visit(tab.blocks));
    }
  };
  visit(blocks);
  return roots;
}

function exampleContainer(element: HTMLElement): ResearchExampleContainer | undefined {
  const exampleBlockId = element.dataset.researchExampleBlockId, tabId = element.dataset.researchExampleTabId;
  return exampleBlockId && tabId ? { exampleBlockId, tabId } : undefined;
}

/** Selection lives on the handles so ordinary prose retains native text selection. */
export function useResearchBlockDrag(options: {
  pageRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  noteId: string;
  blocks: ResearchNotebookBlock[];
  onMove: (blockIds: string[], target: ResearchBlockDropTarget) => void;
  onRevealArea: (area: "given" | "conclusion") => void;
  onRevealExample: (container: ResearchExampleContainer) => void;
}) {
  const latest = useRef(options);
  const session = useRef<DragSession | null>(null);
  const suppressClick = useRef<string | null>(null);
  const anchor = useRef<string | null>(null);
  const [selection, setSelection] = useState<{ noteId: string; ids: string[]; mode: boolean }>({ noteId: options.noteId, ids: [], mode: false });
  const selectedIds = useMemo(() => options.enabled && selection.noteId === options.noteId ? selectedRoots(options.blocks, selection.ids) : [], [options.enabled, options.noteId, options.blocks, selection]);
  const selecting = options.enabled && selection.noteId === options.noteId && selection.mode;
  const selectionRef = useRef({ ids: selectedIds, mode: selecting });
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useLayoutEffect(() => { latest.current = options; selectionRef.current = { ids: selectedIds, mode: selecting }; });
  useEffect(() => () => session.current?.cleanup(false), [options.enabled, options.noteId]);

  const clearSelection = () => {
    anchor.current = null;
    setSelection({ noteId: latest.current.noteId, ids: [], mode: false });
  };
  useEffect(() => {
    if (!selecting && !selectedIds.length) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || session.current) return;
      clearSelection();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selecting, selectedIds.length]);

  const visibleIds = () => [...(latest.current.pageRef.current?.querySelectorAll<HTMLElement>(".research-note-block") ?? [])]
    .filter(element => element.getClientRects().length && !element.closest("[inert]"))
    .map(element => element.dataset.blockId!);

  const select = (blockId: string, range: boolean, additive: boolean) => {
    const current = selectionRef.current.ids;
    let ids: string[];
    const visible = visibleIds();
    const from = anchor.current ? visible.indexOf(anchor.current) : -1, to = visible.indexOf(blockId);
    if (range && from >= 0 && to >= 0) {
      const span = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      ids = additive ? [...current, ...span] : span;
    } else {
      ids = current.includes(blockId) ? current.filter(id => id !== blockId) : [...current, blockId];
      anchor.current = blockId;
    }
    ids = selectedRoots(latest.current.blocks, ids);
    setSelection({ noteId: latest.current.noteId, ids, mode: selectionRef.current.mode });
    setAnnouncement(t`已选 ${ids.length} 项内容，按住任一选中把手拖动`);
  };

  const focusHandle = (blockId: string) => {
    requestAnimationFrame(() => {
      const row = [...(latest.current.pageRef.current?.querySelectorAll<HTMLElement>(".research-note-block") ?? [])].find(element => element.dataset.blockId === blockId);
      row?.querySelector<HTMLButtonElement>(":scope > .research-block-insert > [data-research-drag-handle]")?.focus({ preventScroll: true });
    });
  };

  const getHandle = (blockId: string): ResearchBlockDragHandle => ({
    selected: selectedIds.includes(blockId),
    selecting,
    onClickCapture(event) {
      if (suppressClick.current === blockId) {
        suppressClick.current = null;
        if (event.detail !== 0) { event.preventDefault(); event.stopPropagation(); return; }
      }
      if (!latest.current.enabled || !(selectionRef.current.mode || event.shiftKey || event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      select(blockId, event.shiftKey, event.ctrlKey || event.metaKey);
    },
    onKeyDown(event) {
      if (!latest.current.enabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection({ noteId: latest.current.noteId, ids: selectedRoots(latest.current.blocks, visibleIds()), mode: true });
        return;
      }
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const location = findResearchBlock(latest.current.blocks, blockId);
      const zone = event.currentTarget.closest<HTMLElement>("[data-research-drop-area]");
      if (!location || !zone) return;
      const area = zone.dataset.researchDropArea === "full" || location.container ? undefined : zone.dataset.researchDropArea as TheoryContentArea;
      const siblings = location.siblings.filter(block => area === undefined || (block.section ?? "derivation") === area);
      const ids = selectionRef.current.ids.includes(blockId) ? selectionRef.current.ids : [blockId];
      if (ids.some(id => !siblings.some(block => block.id === id))) {
        setAnnouncement(t("跨层级选择请拖动到目标位置"));
        return;
      }
      const selected = new Set(ids);
      const indexes = siblings.flatMap((block, index) => selected.has(block.id) ? [index] : []);
      const down = event.key === "ArrowDown";
      const boundary = down ? indexes.at(-1)! : indexes[0];
      if (down ? boundary === siblings.length - 1 : boundary === 0) return;
      latest.current.onMove(ids, { container: location.container, area, beforeBlockId: siblings[boundary + (down ? 2 : -1)]?.id });
      setAnnouncement(t`已将 ${ids.length} 项内容${down ? t("下移") : t("上移")}`);
      focusHandle(blockId);
    },
    onPointerDown(event, onStart) {
      if (!latest.current.enabled || event.button !== 0 || !event.isPrimary || session.current) return;
      const page = latest.current.pageRef.current;
      if (!page) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.focus({ preventScroll: true });
      suppressClick.current = null;
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
      handle.setPointerCapture(event.pointerId);
      const ids = selectionRef.current.ids.includes(blockId) ? [...selectionRef.current.ids] : [blockId];
      const movingIds = new Set(ids);
      const excludedIds = new Set<string>();
      const markMoving = (siblings: ResearchNotebookBlock[], owned = false) => {
        for (const block of siblings) {
          const moving = owned || movingIds.has(block.id);
          if (moving) excludedIds.add(block.id);
          if (block.type === "examples") block.tabs.forEach(tab => markMoving(tab.blocks, moving));
        }
      };
      markMoving(latest.current.blocks);
      const startX = event.clientX, startY = event.clientY;
      let frame = 0, lastFrame = 0, releasedCapture = false;
      let hoveredTab = "", hoveredAt = 0;
      const drag: DragSession = {
        pointerId: event.pointerId, blockIds: ids, noteId: latest.current.noteId,
        x: startX, y: startY, started: false, target: null, cleanup: commit => finish(commit),
      };
      session.current = drag;

      function reject() {
        drag.target = null;
        setIndicator(previous => previous === null ? previous : null);
      }
      function canEnter(container: ResearchExampleContainer) {
        return !excludedIds.has(container.exampleBlockId);
      }
      function locate(scrollFactor = 0) {
        const root = latest.current.pageRef.current;
        if (!root || !drag.started) return;
        const hit = document.elementFromPoint(drag.x, drag.y);
        const drawerTab = hit?.closest<HTMLElement>("[data-research-drawer-tab]");
        const exampleTab = hit?.closest<HTMLElement>("[data-research-example-tab]");
        if (!exampleTab) hoveredTab = "";
        let zone: HTMLElement | null;
        if (exampleTab && root.contains(exampleTab)) {
          const container = exampleContainer(exampleTab);
          if (!container || !canEnter(container)) { reject(); return; }
          const key = `${container.exampleBlockId}:${container.tabId}`;
          if (hoveredTab !== key) { hoveredTab = key; hoveredAt = performance.now(); }
          if (exampleTab.getAttribute("aria-selected") !== "true" && performance.now() - hoveredAt >= 280) latest.current.onRevealExample(container);
          zone = exampleTab.closest(".research-examples")?.querySelector<HTMLElement>(":scope > .research-example-body") ?? null;
        } else if (drawerTab && root.contains(drawerTab)) {
          const area = drawerTab.dataset.researchDrawerTab as "given" | "conclusion";
          if (drawerTab.getAttribute("aria-expanded") === "false") latest.current.onRevealArea(area);
          zone = root.querySelector(`[data-research-drop-area="${area}"]`);
        } else zone = hit?.closest<HTMLElement>("[data-research-drop-area]") ?? null;
        if (!zone || !root.contains(zone)) { reject(); return; }
        const container = exampleTab ? exampleContainer(exampleTab) : exampleContainer(zone);
        if (container && !canEnter(container)) { reject(); return; }
        const bounds = zone.getBoundingClientRect();
        if (scrollFactor && !drawerTab && !exampleTab) {
          let scrollable: HTMLElement | null = zone;
          while (scrollable && root.contains(scrollable)) {
            const scrollBounds = scrollable.getBoundingClientRect();
            if (scrollable.scrollHeight > scrollable.clientHeight && /auto|scroll/.test(getComputedStyle(scrollable).overflowY)) {
              const edge = Math.min(36, scrollBounds.height / 4);
              const distance = drag.y < scrollBounds.top + edge ? drag.y - scrollBounds.top - edge
                : drag.y > scrollBounds.bottom - edge ? drag.y - scrollBounds.bottom + edge : 0;
              const before = scrollable.scrollTop;
              if (distance && edge > 0) scrollable.scrollTop += Math.max(-14, Math.min(14, distance / edge * 14)) * scrollFactor;
              if (scrollable.scrollTop !== before) break;
            }
            scrollable = scrollable.parentElement;
          }
        }
        const rows = [...zone.querySelectorAll<HTMLElement>(".research-note-block")].filter(row =>
          row.closest("[data-research-drop-area]") === zone && !excludedIds.has(row.dataset.blockId!));
        const before = drawerTab || exampleTab ? undefined : rows.find(row => {
          const rect = row.getBoundingClientRect();
          return drag.y < rect.top + rect.height / 2;
        });
        const zoneName = container ? `example:${container.exampleBlockId}:${container.tabId}` : zone.dataset.researchDropArea!;
        const area = container || zoneName === "full" ? undefined : zoneName as TheoryContentArea;
        drag.target = { area, container, beforeBlockId: before?.dataset.blockId };
        const content = zone.querySelector<HTMLElement>(":scope > .research-note-blocks");
        const contentBounds = content?.getBoundingClientRect() ?? bounds;
        const rootBounds = root.getBoundingClientRect();
        const lineY = before?.getBoundingClientRect().top ?? rows.at(-1)?.getBoundingClientRect().bottom ?? contentBounds.top + 8;
        const clip = zone.closest<HTMLElement>(".research-note-scroll, .research-theory-drawer-content")?.getBoundingClientRect() ?? bounds;
        const left = Math.max(bounds.left + 4, contentBounds.left - 22);
        const next: DropIndicator = {
          left: left - rootBounds.left,
          top: Math.max(clip.top + 3, Math.min(clip.bottom - 3, lineY)) - rootBounds.top,
          width: Math.max(0, Math.min(bounds.right - 8, contentBounds.right) - left),
          zone: zoneName, target: drag.target,
        };
        setIndicator(previous => previous && previous.zone === next.zone && previous.target.beforeBlockId === next.target.beforeBlockId &&
          Math.abs(previous.top - next.top) < .5 && Math.abs(previous.left - next.left) < .5 && Math.abs(previous.width - next.width) < .5 ? previous : next);
      }
      function tick(time: number) {
        if (session.current !== drag || !drag.started) return;
        locate(lastFrame ? Math.min(2, (time - lastFrame) / 16.67) : 1);
        lastFrame = time;
        frame = requestAnimationFrame(tick);
      }
      function move(pointer: globalThis.PointerEvent) {
        if (pointer.pointerId !== drag.pointerId) return;
        drag.x = pointer.clientX;
        drag.y = pointer.clientY;
        if (!drag.started && Math.hypot(drag.x - startX, drag.y - startY) >= 7) {
          drag.started = true;
          // Tab changes may unmount this handle; document listeners keep that drag alive.
          releasedCapture = true;
          if (handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
          onStart();
          if (!selectionRef.current.ids.includes(blockId)) setSelection({ noteId: latest.current.noteId, ids: selecting ? [blockId] : [], mode: selecting });
          setActiveIds(ids);
          setAnnouncement(t`已抓取 ${ids.length} 项内容，松开放置，Escape 取消`);
          frame = requestAnimationFrame(tick);
        }
        if (drag.started) { pointer.preventDefault(); locate(); }
      }
      function finish(commit: boolean) {
        if (session.current !== drag) return;
        if (drag.started && commit) locate();
        session.current = null;
        cancelAnimationFrame(frame);
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
        document.removeEventListener("lostpointercapture", lostCapture);
        document.removeEventListener("keydown", escape, true);
        window.removeEventListener("blur", cancelWindow);
        if (handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
        if (!drag.started) return;
        suppressClick.current = blockId;
        setActiveIds([]);
        setIndicator(null);
        const valid = commit && drag.target && latest.current.enabled && latest.current.noteId === drag.noteId;
        if (valid) {
          latest.current.onMove(ids, drag.target!);
          if (drag.target!.container) latest.current.onRevealExample(drag.target!.container!);
          const area = drag.target!.area;
          setAnnouncement(drag.target!.container ? t`已将 ${ids.length} 项内容放入标签页` : area ? t`已将 ${ids.length} 项内容放入${theoryAreaLabels[area]}` : t`已调整 ${ids.length} 项内容的顺序`);
        } else {
          const origin = findResearchBlock(latest.current.blocks, blockId);
          origin?.path.forEach(owner => latest.current.onRevealExample(owner));
          const rootBlock = origin?.path.length ? latest.current.blocks.find(block => block.id === origin.path[0].exampleBlockId) : origin?.block;
          if (rootBlock?.section) latest.current.onRevealArea(rootBlock.section);
          setAnnouncement(t("已取消移动"));
        }
        focusHandle(blockId);
      }
      function up(pointer: globalThis.PointerEvent) {
        if (pointer.pointerId !== drag.pointerId) return;
        drag.x = pointer.clientX;
        drag.y = pointer.clientY;
        if (drag.started) pointer.preventDefault();
        finish(true);
      }
      function cancel(pointer: globalThis.PointerEvent) { if (pointer.pointerId === drag.pointerId) finish(false); }
      function lostCapture(pointer: globalThis.PointerEvent) { if (!releasedCapture && pointer.pointerId === drag.pointerId) finish(false); }
      function cancelWindow() { finish(false); }
      function escape(key: globalThis.KeyboardEvent) {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopImmediatePropagation();
        finish(false);
      }
      document.addEventListener("pointermove", move, { passive: false });
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      document.addEventListener("lostpointercapture", lostCapture);
      document.addEventListener("keydown", escape, true);
      window.addEventListener("blur", cancelWindow);
    },
  });

  return { activeIds, indicator, announcement, getHandle, selectedIds, selecting, clearSelection,
    toggleSelection: () => {
      if (selecting) clearSelection();
      else setSelection({ noteId: latest.current.noteId, ids: selectedIds, mode: true });
    },
  };
}
