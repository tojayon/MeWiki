import { useEffect, useId, useRef, useState } from "react";
import { t } from "../i18n/locale.ts";
import { useLocale } from "../i18n/react.ts";
import type { ResearchTermAtom, ResearchTermEntry } from "../domain/researchTerms.ts";
import ResearchMathText from "./ResearchMathText.tsx";
import "./ResearchTermDiagram.css";

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Connection { atomId: string; path: string; x: number; y: number }
interface Geometry { width: number; height: number; atomWidths: Record<string, number>; connections: Connection[] }

const round = (value: number) => Math.round(value * 10) / 10;

function measureDiagram(canvas: HTMLElement, atoms: readonly ResearchTermAtom[]): Geometry {
  const origin = canvas.getBoundingClientRect();
  const bounds = (element: Element): Box => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left - origin.left,
      right: box.right - origin.left,
      top: box.top - origin.top,
      bottom: box.bottom - origin.top,
      width: box.width,
      height: box.height,
    };
  };
  const heroElement = canvas.querySelector<HTMLElement>(".term-diagram-hero");
  if (!heroElement) return { width: round(origin.width), height: round(origin.height), atomWidths: {}, connections: [] };
  const hero = bounds(heroElement);
  const viewportElement = canvas.querySelector<HTMLElement>(".term-diagram-term-scroll");
  const viewport = viewportElement ? bounds(viewportElement) : hero;
  const cardsElement = canvas.querySelector<HTMLElement>(".term-diagram-callouts");
  const cardsViewport = cardsElement ? bounds(cardsElement) : bounds(canvas);
  const atomWidths = Object.fromEntries(atoms.flatMap(atom => {
    const element = canvas.querySelector<HTMLElement>(`[data-term-atom-piece="${CSS.escape(atom.id)}"]`);
    return element ? [[atom.id, round(bounds(element).width)] as const] : [];
  }));
  const connections = atoms.flatMap(atom => {
    const targetElement = canvas.querySelector<HTMLElement>(`[data-term-atom-link="${CSS.escape(atom.id)}"]`);
    const callout = canvas.querySelector<HTMLElement>(`[data-term-callout="${CSS.escape(atom.id)}"]`);
    if (!targetElement || !callout) return [];
    const target = bounds(targetElement);
    const card = bounds(callout);
    if (!target.width || !card.width) return [];
    const visibleLeft = Math.max(target.left, viewport.left);
    const visibleRight = Math.min(target.right, viewport.right);
    const cardLeft = Math.max(card.left, cardsViewport.left);
    const cardRight = Math.min(card.right, cardsViewport.right);
    if (visibleRight <= visibleLeft || cardRight <= cardLeft) return [];
    const end = { x: round((visibleLeft + visibleRight) / 2), y: round(target.bottom - 2) };
    const start = { x: round((cardLeft + cardRight) / 2), y: round(card.top) };
    const lane = round((end.y + start.y) / 2);
    const path = `M ${end.x} ${end.y} C ${end.x} ${lane}, ${start.x} ${lane}, ${start.x} ${start.y}`;
    return [{ atomId: atom.id, path, x: end.x, y: end.y }];
  });
  return { width: round(origin.width), height: round(origin.height), atomWidths, connections };
}

export default function ResearchTermDiagram({ active, entry, atoms }: {
  active: boolean;
  entry: ResearchTermEntry;
  atoms: readonly ResearchTermAtom[];
}) {
  useLocale();
  const canvasRef = useRef<HTMLDivElement>(null);
  const diagramId = useId();
  const [geometry, setGeometry] = useState<Geometry>({ width: 0, height: 0, atomWidths: {}, connections: [] });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    let frame = 0;
    let disposed = false;
    const update = () => {
      frame = 0;
      if (disposed || !canvas.clientWidth) return;
      const next = measureDiagram(canvas, atoms);
      setGeometry(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    canvas.querySelectorAll<HTMLElement>("[data-term-atom-piece], [data-term-atom-link], [data-term-callout], .term-diagram-hero, .term-diagram-callouts").forEach(element => observer.observe(element));
    const scrollAreas = canvas.querySelectorAll<HTMLElement>(".term-diagram-term-scroll, .term-diagram-callouts");
    scrollAreas.forEach(area => area.addEventListener("scroll", schedule, { passive: true }));
    window.addEventListener("resize", schedule);
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollAreas.forEach(area => area.removeEventListener("scroll", schedule));
      window.removeEventListener("resize", schedule);
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [active, atoms]);

  const focusAtom = (index: number) => {
    const card = document.getElementById(`${diagramId}-atom-${index}`);
    const row = card?.parentElement;
    if (!card || !row) return;
    const cardBox = card.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (cardBox.left < rowBox.left) row.scrollLeft += cardBox.left - rowBox.left - 3;
    else if (cardBox.right > rowBox.right) row.scrollLeft += cardBox.right - rowBox.right + 3;
    card.focus({ preventScroll: true });
  };

  return <section className="research-term-diagram" aria-label={t("术语结构解释图")}>
    <div className="term-diagram-canvas" ref={canvasRef}>
      <div className="term-diagram-hero">
        <div className="term-diagram-term-scroll">
          <div className="term-diagram-term-stack">
            <h3 className="term-diagram-title" aria-label={entry.name}>
              {atoms.map((atom, index) => <button type="button" className="term-diagram-term-piece" data-term-atom-piece={atom.id} key={atom.id}
                onClick={() => focusAtom(index)}
                aria-label={t`原子词汇：${atom.text}`} aria-describedby={`${diagramId}-atom-${index}`} title={t`查看${atom.text}的解释`}>{atom.text}</button>)}
            </h3>
            <div className="term-diagram-atom-links" role="group" aria-label={t("原子词汇解释入口")}>
              {atoms.map((atom, index) => <button type="button" className="term-diagram-atom-link" data-term-atom-link={atom.id} key={atom.id}
                onClick={() => focusAtom(index)} aria-label={t`查看${atom.text}的解释`} aria-describedby={`${diagramId}-atom-${index}`} title={t`查看${atom.text}的解释`}
                style={{ width: geometry.atomWidths[atom.id] ? `${geometry.atomWidths[atom.id]}px` : `${Math.max(1.6, [...atom.text].length * 0.78)}em` }} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="term-diagram-callouts">
        {atoms.map((atom, index) => <article id={`${diagramId}-atom-${index}`} tabIndex={-1} className="term-diagram-callout" data-term-callout={atom.id} key={atom.id}>
          <h4 className="term-diagram-sr-only">{atom.text}</h4>
          <p><ResearchMathText text={atom.meaning} /></p>
        </article>)}
      </div>
      {geometry.width > 0 && <svg className="term-diagram-connections" width={geometry.width} height={geometry.height} aria-hidden="true" focusable="false">
        {geometry.connections.map(connection => <g key={connection.atomId} data-term-connection={connection.atomId}>
          <path d={connection.path} />
          <circle cx={connection.x} cy={connection.y} r={3} />
        </g>)}
      </svg>}
    </div>
  </section>;
}
