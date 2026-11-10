import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import { Formula } from "./Formula.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import { annotateSymbolDiagram, findSymbolPositionReference, markSymbolDiagram, type SymbolDiagramPart, type SymbolDiagramTargets } from "./researchSymbolDiagramModel.ts";
import "./ResearchSymbolDiagram.css";

interface Point { x: number; y: number }
interface Connection extends Point { part: SymbolDiagramPart; empty: boolean; path: string }
interface Geometry { width: number; height: number; connections: Connection[] }
const parts: SymbolDiagramPart[] = ["body", "x1", "x2", "x3"];
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function measureDiagram(canvas: HTMLElement, targets: SymbolDiagramTargets): Geometry {
  const origin = canvas.getBoundingClientRect();
  const formula = canvas.querySelector<HTMLElement>(".symbol-diagram-formula")!;
  const hero = canvas.querySelector<HTMLElement>(".research-symbol-hero")!;
  const bounds = (element: Element | Range) => {
    const box = element.getBoundingClientRect();
    return { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top, width: box.width, height: box.height };
  };
  const actual = (part: SymbolDiagramPart) => {
    const boxes = targets[part].map(bounds).filter(box => box.width > 0 && box.height > 0);
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map(box => box.left)), right = Math.max(...boxes.map(box => box.right));
    const top = Math.min(...boxes.map(box => box.top)), bottom = Math.max(...boxes.map(box => box.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };
  const base = actual("body") ?? bounds(formula);
  const full = bounds(formula);
  const stage = bounds(hero);
  const subscript = actual("x2");
  const scriptX = subscript ? subscript.left + subscript.width / 2 : base.right + 14;
  const connections = parts.flatMap(part => {
    const callout = canvas.querySelector<HTMLElement>(`[data-symbol-callout="${part}"]`);
    if (!callout) return [];
    const box = bounds(callout);
    const element = actual(part);
    const empty = part !== "body" && !element;
    const actualTarget = element ?? (part === "body" ? base : null);
    // An overflowing formula can be scrolled without changing its size. Only
    // connect to the visible part of a glyph, never to a position offscreen.
    const left = actualTarget ? Math.max(stage.left, actualTarget.left) : 0;
    const right = actualTarget ? Math.min(stage.right, actualTarget.right) : 0;
    if (actualTarget && right <= left) return [];
    const target = actualTarget ? { ...actualTarget, left, right, width: right - left } : null;
    let end: Point;
    if (target) end = {
      x: part === "body" ? target.left - 6 : part === "x3" ? target.right + 6 : target.left + target.width / 2,
      y: part === "x1" ? target.top - 6 : part === "x2" ? target.bottom + 6 : target.top + target.height / 2,
    };
    else end = {
      x: part === "x3" ? full.right + 18 : scriptX,
      y: part === "x1" ? base.top - 16 : part === "x2" ? base.bottom + 16 : base.top + base.height / 2,
    };
    end = { x: round(clamp(end.x, stage.left + 6, stage.right - (empty ? 32 : 6))), y: round(clamp(end.y, stage.top + 12, stage.bottom - 12)) };
    let path: string;
    if (part === "body" || part === "x3") {
      const leftSide = part === "body";
      const beside = leftSide ? box.right <= stage.left + 1 : box.left >= stage.right - 1;
      const start = {
        x: round(beside ? leftSide ? box.right : box.left : leftSide ? box.left : box.right),
        y: round(clamp(end.y, box.top + 16, box.bottom - 16)),
      };
      // Stacked explanations use the outside gutters so their lines never
      // pass through the upper and lower cards. Side cards connect directly.
      const lane = round(beside ? (start.x + end.x) / 2 : leftSide ? Math.min(box.left, stage.left) / 2 : (Math.max(box.right, stage.right) + origin.width) / 2);
      path = beside && start.y === end.y
        ? `M ${start.x} ${start.y} H ${end.x}`
        : `M ${start.x} ${start.y} H ${lane} V ${end.y} H ${end.x}`;
    } else {
      const start = { x: round(clamp(end.x, box.left + 16, box.right - 16)), y: round(part === "x1" ? box.bottom : box.top) };
      const lane = round((start.y + end.y) / 2);
      path = start.x === end.x
        ? `M ${start.x} ${start.y} V ${end.y}`
        : `M ${start.x} ${start.y} V ${lane} H ${end.x} V ${end.y}`;
    }
    return [{ part, empty, path, ...end }];
  });
  return { width: round(origin.width), height: round(origin.height), connections };
}

export default function ResearchSymbolDiagram({ active, entry, entries, bindings, onBindingChange }: {
  active: boolean;
  entry: ResearchSymbolEntry;
  entries: readonly ResearchSymbolEntry[];
  bindings: Record<string, string>;
  onBindingChange: (key: string, value: string) => void;
}) {
  useLocale();
  const canvasRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef<SymbolDiagramTargets>({ body: [], x1: [], x2: [], x3: [] });
  const { tex, markedTex } = markSymbolDiagram(entry, bindings);
  const references = useMemo(() => Object.fromEntries(entry.slots.map(slot => [slot.key, findSymbolPositionReference(bindings[slot.key] ?? "", entries, entry.id)])), [entry, bindings, entries]);
  const [geometry, setGeometry] = useState<Geometry>({ width: 0, height: 0, connections: [] });
  const [hovered, setHovered] = useState<SymbolDiagramPart | null>(null);
  const [focused, setFocused] = useState<SymbolDiagramPart | null>(null);
  const highlighted = focused ?? hovered;

  useLayoutEffect(() => {
    const formula = canvasRef.current?.querySelector<HTMLElement>(".symbol-diagram-formula");
    if (formula) targetsRef.current = annotateSymbolDiagram(formula, markedTex);
  }, [tex, markedTex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    const hero = canvas.querySelector<HTMLElement>(".research-symbol-hero")!;
    let frame = 0, disposed = false;
    let referenceWidth = 0;
    const referenceFont = 160;
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update); };
    const update = () => {
      frame = 0;
      if (!canvas.clientWidth) return;
      const formula = canvas.querySelector<HTMLElement>(".symbol-diagram-formula")!;
      const heroStyle = getComputedStyle(hero);
      const available = Math.max(1, hero.clientWidth - parseFloat(heroStyle.paddingLeft) - parseFloat(heroStyle.paddingRight));
      const preferred = Math.min(160, Math.max(76, canvas.clientWidth * .18));
      if (!referenceWidth) {
        // Measure once at a fixed size, then apply the result before paint.
        // Never feed the already-fitted formula back into its own sizing.
        formula.style.fontSize = `${referenceFont}px`;
        referenceWidth = parseFloat(getComputedStyle(formula).width);
      }
      // A font-size epsilon can hide several pixels of overflow on long math.
      // Reserve one CSS pixel and round down to stay clear of the scrollbar edge.
      const fittingFont = referenceWidth ? referenceFont * Math.max(0, available - 1) / referenceWidth : preferred;
      const fitted = Math.max(76, Math.floor(Math.min(preferred, fittingFont) * 100) / 100);
      const fontSize = `${fitted}px`;
      if (formula.style.fontSize !== fontSize) formula.style.fontSize = fontSize;
      const next = measureDiagram(canvas, targetsRef.current);
      setGeometry(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    observer.observe(hero);
    canvas.querySelectorAll("[data-symbol-callout], .symbol-diagram-formula").forEach(element => observer.observe(element));
    hero.addEventListener("scroll", schedule, { passive: true });
    schedule();
    const fontsChanged = () => { referenceWidth = 0; schedule(); };
    document.fonts.ready.then(fontsChanged);
    document.fonts.addEventListener("loadingdone", fontsChanged);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      hero.removeEventListener("scroll", schedule);
      document.fonts.removeEventListener("loadingdone", fontsChanged);
    };
  }, [active, markedTex, entry, entries]);

  const highlightFormulaPart = (event: PointerEvent<HTMLDivElement>) => {
    setHovered(parts.find(part => targetsRef.current[part].some(target => {
      const box = target.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    })) ?? null);
  };

  return <section className="research-symbol-diagram" aria-label={t("符号结构解释图")} data-active-part={highlighted ?? undefined}>
    <div className="symbol-diagram-canvas" ref={canvasRef}>
      <article className="symbol-diagram-callout symbol-diagram-body" data-symbol-callout="body" data-active={highlighted === "body"}
        onPointerEnter={() => setHovered("body")} onPointerLeave={() => setHovered(null)}>
        <h3>{t("主体含义")}</h3>
        <p className="research-symbol-meaning"><ResearchMathText text={entry.meaning} /></p>
        {entry.unit && <p className="research-symbol-meta"><strong>{t("单位")}</strong><span>{entry.unit}</span></p>}
      </article>
      <div className="research-symbol-hero" onPointerMove={highlightFormulaPart} onPointerLeave={() => setHovered(null)}>
        <Formula className="symbol-diagram-formula" tex={tex} block />
      </div>
      {entry.slots.map(slot => {
        const part = slot.key as SymbolDiagramPart;
        const value = bindings[slot.key] ?? "";
        const reference = references[slot.key];
        return <article key={slot.key} className={`symbol-diagram-callout symbol-diagram-${slot.key}`} data-symbol-callout={slot.key} data-active={highlighted === part}
          onPointerEnter={() => setHovered(part)} onPointerLeave={() => setHovered(null)}
          onFocusCapture={() => setFocused(part)} onBlurCapture={() => setFocused(null)}>
          <h3>{t(slot.label)}</h3>
          <div className="symbol-diagram-description" aria-label={t`${t(slot.label)}说明`}>
            {slot.description?.trim() ? <ResearchMathText text={slot.description} /> : <span className="symbol-diagram-missing-description">{t("尚未填写说明")}</span>}
          </div>
          <input aria-label={t`${t(slot.label)}示例值`} value={value} placeholder={t("留空")} autoComplete="off" spellCheck={false} onChange={event => onBindingChange(slot.key, event.target.value)} />
          {!value && <p className="symbol-diagram-empty">{t("当前留空")}</p>}
          {reference && <div className="symbol-diagram-reference"><strong>{reference.name}</strong><p><ResearchMathText text={reference.meaning} /></p></div>}
        </article>;
      })}
      {geometry.width > 0 && <svg className="symbol-diagram-connections" width={geometry.width} height={geometry.height} aria-hidden="true" focusable="false">
        {geometry.connections.map(connection => <g key={connection.part} data-symbol-connection={connection.part} data-empty={connection.empty} data-active={highlighted === connection.part}>
          <path d={connection.path} />
          <circle data-symbol-anchor={connection.part} cx={connection.x} cy={connection.y} r={connection.empty ? 5 : 3} />
        </g>)}
      </svg>}
    </div>
    <p className="symbol-diagram-hint">{t("修改周围的示例值，实时查看符号写法。")}</p>
  </section>;
}
