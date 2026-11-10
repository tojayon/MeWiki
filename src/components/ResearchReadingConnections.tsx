import { useLocale } from "../i18n/react.ts";
import { useEffect, useState, type RefObject } from "react";
import type { ResearchNote } from "../domain/researchNotebook.ts";
import { researchNoteLinkId } from "../domain/researchNoteLinks.ts";
import type { ResearchReadingPane } from "../state/researchReadingPanes.ts";

interface SourceLine { x: number; y: number; width: number; height: number }
interface Connection { id: string; blockId: string; path: string; line?: SourceLine }
interface Geometry { width: number; height: number; connections: Connection[] }

// Coordinates belong to the scrolling rail, so a horizontal pan carries both
// the source highlight and the destination frame together.
function measureConnections(rail: HTMLElement, panes: ResearchReadingPane[]): Geometry {
  const origin = rail.getBoundingClientRect();
  const elements = new Map([...rail.querySelectorAll<HTMLElement>("[data-reading-pane-id]")].map(element => [element.dataset.readingPaneId, element]));
  const x = (value: number) => Math.round((value - origin.left + rail.scrollLeft) * 10) / 10;
  const y = (value: number) => Math.round((value - origin.top) * 10) / 10;
  const connections: Connection[] = [];
  for (const pane of panes) {
    if (!pane.parentId || !pane.source) continue;
    const target = elements.get(pane.id), source = elements.get(pane.parentId);
    if (!target || !source) continue;
    const bounds = target.getBoundingClientRect(), sourceBounds = source.getBoundingClientRect();
    const left = x(bounds.left) + 1, right = x(bounds.right) - 1, top = y(bounds.top) + 1, bottom = y(bounds.bottom) - 1;
    if (right <= left || bottom <= top) continue;
    const connection: Connection = { id: pane.id, blockId: pane.source.blockId, path: `M ${left} ${top} H ${right} V ${bottom} H ${left} Z` };
    const block = [...source.querySelectorAll<HTMLElement>("[data-block-id]")].find(element => element.dataset.blockId === pane.source!.blockId);
    const link = block && [...block.querySelectorAll<HTMLAnchorElement>("a.research-note-link")].filter(link => link.closest("[data-block-id]") === block)[pane.source.linkIndex];
    if (link && researchNoteLinkId(link.getAttribute("href") ?? undefined) === pane.noteId && link.getClientRects().length) {
      const rect = link.getBoundingClientRect();
      let clipTop = Math.max(origin.top + 1, sourceBounds.top), clipBottom = Math.min(origin.bottom - 1, sourceBounds.bottom);
      let clipLeft = Math.max(sourceBounds.left, origin.left), clipRight = Math.min(sourceBounds.right, origin.right);
      // Include nested scroll areas, such as a table or a foundation drawer.
      for (let ancestor = link.parentElement; ancestor && ancestor !== source; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { clipTop = Math.max(clipTop, bounds.top); clipBottom = Math.min(clipBottom, bounds.bottom); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clipLeft = Math.max(clipLeft, bounds.left); clipRight = Math.min(clipRight, bounds.right); }
      }
      const row = link.closest("p, li, td, th, h1, h2, h3, h4, h5, h6") ?? block!;
      const lineTop = Math.max(top + 4, y(Math.max(rect.top - 4, clipTop)));
      const lineBottom = Math.min(bottom - 4, y(Math.min(rect.bottom + 4, clipBottom)));
      const lineLeft = x(Math.max(sourceBounds.left + 6, clipLeft, row.getBoundingClientRect().left - 6));
      if (rect.bottom > clipTop && rect.top < clipBottom && rect.right > clipLeft && rect.left < clipRight && lineBottom > lineTop && lineLeft < left) {
        connection.line = { x: lineLeft, y: lineTop, width: left - lineLeft, height: lineBottom - lineTop };
        // One outer contour leaves the shared edge open at the reference row.
        connection.path = `M ${lineLeft} ${lineTop} H ${left} V ${top} H ${right} V ${bottom} H ${left} V ${lineBottom} H ${lineLeft} Z`;
      }
    }
    connections.push(connection);
  }
  return { width: Math.max(rail.clientWidth, ...[...elements.values()].map(element => x(element.getBoundingClientRect().right))), height: rail.clientHeight, connections };
}

export default function ResearchReadingConnections({ railRef, panes, notes }: {
  railRef: RefObject<HTMLDivElement | null>; panes: ResearchReadingPane[]; notes: readonly ResearchNote[];
}) {
  useLocale();
  const [geometry, setGeometry] = useState<Geometry>({ width: 0, height: 0, connections: [] });
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measureConnections(rail, panes);
      setGeometry(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    if (!panes.some(pane => pane.parentId && pane.source)) return;
    const resize = new ResizeObserver(schedule);
    resize.observe(rail);
    rail.querySelectorAll("[data-reading-pane-id], .research-note-scroll, [data-block-id]").forEach(element => resize.observe(element));
    const mutations = new MutationObserver(schedule);
    mutations.observe(rail, { childList: true, subtree: true, characterData: true });
    rail.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect(); mutations.disconnect();
      rail.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [railRef, panes, notes]);
  if (!geometry.connections.length) return null;
  return <svg className="research-reading-connections" width={geometry.width} height={geometry.height} aria-hidden="true" focusable="false">
    {geometry.connections.map(connection => <g key={connection.id} data-reading-connection={connection.id} data-source-block-id={connection.blockId}>
      {connection.line && <rect className="research-reading-source-highlight" {...connection.line} />}
      <path d={connection.path} />
    </g>)}
  </svg>;
}
