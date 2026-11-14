import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Scan, X, ZoomIn, ZoomOut } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import DeviceInspectorModal from './DeviceInspectorModal.tsx';
import { fitDiagramViewport, MAX_DIAGRAM_ZOOM, MIN_DIAGRAM_ZOOM, resizeDiagramViewport, zoomDiagramViewport, type DiagramPoint, type DiagramSize, type DiagramViewport } from './researchDiagramViewport.ts';
import './ResearchDiagramViewer.css';

function DiagramCanvas({ source, title, imageLabel, onClose }: { source: string; title: string; imageLabel: string; onClose: () => void }) {
  const locale = useLocale();
  const scaleId = useId();
  const canvas = useRef<HTMLDivElement>(null);
  const imageSize = useRef<DiagramSize>({ width: 0, height: 0 });
  const canvasSize = useRef<DiagramSize>({ width: 0, height: 0 });
  const fitted = useRef(true);
  const pointers = useRef(new Map<number, DiagramPoint>());
  const current = useRef<DiagramViewport>({ x: 0, y: 0, zoom: 1 });
  const [view, setView] = useState<DiagramViewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState<DiagramSize>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const update = (next: DiagramViewport) => { current.current = next; setView(next); };
  const center = () => ({ x: canvasSize.current.width / 2, y: canvasSize.current.height / 2 });
  const fit = () => { fitted.current = true; update(fitDiagramViewport(imageSize.current, canvasSize.current)); };
  const zoom = (target: number, anchor = center()) => { fitted.current = false; update(zoomDiagramViewport(current.current, target, anchor)); };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const resize = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      if (!next.width || !next.height) return;
      const previous = canvasSize.current;
      canvasSize.current = next;
      if (!imageSize.current.width) return;
      update(fitted.current || !previous.width ? fitDiagramViewport(imageSize.current, next) : resizeDiagramViewport(current.current, previous, next));
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const factor = Math.exp(-Math.max(-1200, Math.min(1200, delta)) * 0.002);
      fitted.current = false;
      update(zoomDiagramViewport(current.current, current.current.zoom * factor, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element); resize();
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    pointers.current.set(event.pointerId, point(event));
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    event.preventDefault();
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point(event));
    const after = [...pointers.current.values()];
    fitted.current = false;
    if (after.length === 1) update({ ...current.current, x: current.current.x + after[0].x - before[0].x, y: current.current.y + after[0].y - before[0].y });
    else {
      const midpoint = (a: DiagramPoint, b: DiagramPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const oldCenter = midpoint(before[0], before[1]), nextCenter = midpoint(after[0], after[1]);
      const oldDistance = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
      const distance = Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y);
      const next = oldDistance > 1 ? zoomDiagramViewport(current.current, current.current.zoom * distance / oldDistance, oldCenter) : current.current;
      update({ ...next, x: next.x + nextCenter.x - oldCenter.x, y: next.y + nextCenter.y - oldCenter.y });
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(pointers.current.size > 0);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 120 : 40;
    if (event.key === '+' || event.key === '=') zoom(current.current.zoom * 1.25);
    else if (event.key === '-' || event.key === '_') zoom(current.current.zoom / 1.25);
    else if (event.key === '0') zoom(1);
    else if (event.key === 'Home') fit();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      fitted.current = false;
      update({ ...current.current, x: current.current.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), y: current.current.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) });
    } else return;
    event.preventDefault(); event.stopPropagation();
  };
  const percentage = new Intl.NumberFormat(locale, { maximumFractionDigits: view.zoom < 0.01 ? 4 : view.zoom < 0.1 ? 2 : 0 }).format(view.zoom * 100);

  return <div className="research-diagram-viewer">
    <div className="research-diagram-viewer-toolbar" role="toolbar" aria-label={t('绘图缩放')}>
      <strong>{title}</strong>
      <button type="button" data-ui="icon-action" aria-label={t('缩小绘图')} title={t('缩小')} disabled={view.zoom <= MIN_DIAGRAM_ZOOM} onClick={() => zoom(current.current.zoom / 1.25)}><ZoomOut size={16} /></button>
      <button type="button" data-ui="diagram-scale" aria-label={t('原始大小')} aria-describedby={scaleId} title={t('原始大小')} onClick={() => zoom(1)}><span id={scaleId}>{percentage}%</span></button>
      <button type="button" data-ui="icon-action" aria-label={t('放大绘图')} title={t('放大')} disabled={view.zoom >= MAX_DIAGRAM_ZOOM} onClick={() => zoom(current.current.zoom * 1.25)}><ZoomIn size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('适应画布')} title={t('适应画布')} onClick={fit}><Scan size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t`关闭${title}`} title={t`关闭${title}`} onClick={onClose}><X size={16} /></button>
    </div>
    <div ref={canvas} className="research-diagram-viewer-canvas" role="region" aria-label={t('绘图画布')} tabIndex={0} data-dragging={dragging} onKeyDown={keyboard}
      onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <img src={source} alt={imageLabel} draggable={false} style={{ width: size.width * view.zoom, height: size.height * view.zoom, transform: `translate(${view.x}px, ${view.y}px)` }} onLoad={event => {
        const image = event.currentTarget;
        imageSize.current = { width: image.naturalWidth, height: image.naturalHeight };
        setSize(imageSize.current); fit();
      }} />
    </div>
  </div>;
}

export default function ResearchDiagramViewer({ source, title, imageLabel, testId, onClose }: { source?: string; title: string; imageLabel: string; testId: string; onClose: () => void }) {
  return <DeviceInspectorModal open={Boolean(source)} title={title} hideHeader testId={testId} className="research-diagram-preview-dialog" onClose={onClose}>
    {source && <DiagramCanvas key={source} source={source} title={title} imageLabel={imageLabel} onClose={onClose} />}
  </DeviceInspectorModal>;
}
