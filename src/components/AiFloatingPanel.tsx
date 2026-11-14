import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { aiFloatingBounds, clampAiPanelFrame, placeAiPanelFrame, readAiPanelFrame, resizeAiPanelFrame, type AiPanelBounds, type AiPanelFrame, type AiResizeEdge } from './aiFloatingPanelLayout.ts';
import './AiFloatingPanel.css';
import AiMascot from './AiMascot.tsx';
import { PanelRightDashed, PanelsTopLeft } from 'lucide-react';

export interface AiPanelActivation { id: string; anchor?: AiPanelBounds }
type Gesture = { id: number; kind: 'move' | AiResizeEdge; x: number; y: number; frame: AiPanelFrame };
const edges: AiResizeEdge[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

export default function AiFloatingPanel({ libraryId, activation, suspended, docked = false, tabs, panelControls, onDockToggle, onEscape, children }: {
  libraryId: string; activation?: AiPanelActivation; suspended?: boolean; docked?: boolean; tabs?: ReactNode; panelControls?: ReactNode; onDockToggle?: () => void; onEscape?: () => void; children: ReactNode;
}) {
  const locale = useLocale();
  const edgeLabels = { n: t('调整AI 面板上边缘'), e: t('调整AI 面板右边缘'), s: t('调整AI 面板下边缘'), w: t('调整AI 面板左边缘'),
    ne: t('调整AI 面板右上角'), nw: t('调整AI 面板左上角'), se: t('调整AI 面板大小'), sw: t('调整AI 面板左下角') };
  const root = useRef<HTMLElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const drawing = useRef(0);
  const panelBounds = aiFloatingBounds;
  const preferenceKey = `mewiki:library:${encodeURIComponent(libraryId)}:ai-floating-panel:v1`;
  const [preferred, setPreferred] = useState(() => {
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null'); } catch { /* Use a reachable default. */ }
    return readAiPanelFrame(saved) ?? placeAiPanelFrame(panelBounds(null));
  });
  const [frame, setFrame] = useState(() => clampAiPanelFrame(preferred, panelBounds(null)));
  const preferredRef = useRef(preferred);
  const frameRef = useRef(frame);
  const lastBounds = useRef(panelBounds(null));
  useLayoutEffect(() => { frameRef.current = frame; }, [frame]);
  const lastActivation = useRef<string | undefined>(undefined);
  const [interacting, setInteracting] = useState(false);
  const [dockHeight, setDockHeight] = useState(560);

  const paintFrame = useCallback((next: AiPanelFrame) => {
    const element = root.current;
    if (!element || docked) return;
    element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    element.style.width = `${next.width}px`; element.style.height = `${next.height}px`;
    element.style.setProperty('--ai-floating-width', `${next.width}px`); element.style.setProperty('--ai-floating-height', `${next.height}px`);
    element.dataset.compact = String(next.height < 390);
  }, [docked]);

  const projectFrame = useCallback((next: AiPanelFrame) => {
    const bounded = clampAiPanelFrame(next, panelBounds(root.current));
    frameRef.current = bounded;
    paintFrame(bounded);
    setFrame(current => current.x === bounded.x && current.y === bounded.y && current.width === bounded.width && current.height === bounded.height ? current : bounded);
  }, [paintFrame, panelBounds]);
  const changeFrame = useCallback((next: AiPanelFrame) => {
    const bounded = clampAiPanelFrame(next, panelBounds(root.current));
    preferredRef.current = bounded;
    setPreferred(bounded);
    projectFrame(bounded);
  }, [projectFrame, panelBounds]);
  useLayoutEffect(() => {
    if (!suspended && activation && lastActivation.current !== activation.id) {
      lastActivation.current = activation.id;
      if (docked) return;
      if (activation.anchor) changeFrame(placeAiPanelFrame(panelBounds(root.current), preferredRef.current, activation.anchor));
      else projectFrame(preferredRef.current);
    }
  }, [activation, suspended, docked, changeFrame, projectFrame, panelBounds]);
  useLayoutEffect(() => {
    if (!activation || suspended) return;
    // Settings restores its previous focus on the next frame; the AI activation takes focus after it.
    const pending = requestAnimationFrame(() => {
      if (document.activeElement?.closest('[data-sidebar-focus-group="right"]')) return;
      root.current?.querySelector<HTMLTextAreaElement>('#mewiki-ai-message-edit, #mewiki-ai-task-prompt')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(pending);
  }, [activation, suspended, docked]);
  useLayoutEffect(() => {
    if (docked) return;
    const update = () => {
      const bounds = panelBounds(root.current), previous = lastBounds.current;
      const changed = bounds.left !== previous.left || bounds.top !== previous.top || bounds.width !== previous.width || bounds.height !== previous.height;
      lastBounds.current = bounds;
      if (gesture.current && !changed) return;
      const current = gesture.current;
      gesture.current = null;
      cancelAnimationFrame(drawing.current); drawing.current = 0;
      if (current) {
        setInteracting(false);
        const handle = root.current?.querySelector<HTMLButtonElement>(current.kind === 'move' ? '.mewiki-ai-floating-move' : `[data-ai-resize-edge="${current.kind}"]`);
        if (handle?.hasPointerCapture(current.id)) handle.releasePointerCapture(current.id);
      }
      projectFrame(preferredRef.current);
    };
    update();
    const observer = new ResizeObserver(update);
    const dialog = root.current?.closest('dialog');
    if (dialog) observer.observe(dialog);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => { observer.disconnect(); cancelAnimationFrame(drawing.current); window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); };
  }, [projectFrame, panelBounds, docked]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!docked || !element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      element.style.setProperty('--ai-floating-width', `${bounds.width}px`);
      element.style.setProperty('--ai-floating-height', `${bounds.height}px`);
      const selected = element.querySelector<HTMLElement>('.research-outline-tabs [aria-selected="true"]'), tabs = selected?.parentElement;
      if (selected && tabs) {
        const tab = selected.getBoundingClientRect(), list = tabs.getBoundingClientRect();
        if (tab.right > list.right) tabs.scrollLeft += tab.right - list.right;
        else if (tab.left < list.left) tabs.scrollLeft -= list.left - tab.left;
      }
      setDockHeight(bounds.height);
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [docked, locale]);
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify({ version: 1, ...preferred })); } catch { /* Keep the window usable without persistent preferences. */ }
  }, [preferred, preferenceKey]);

  const begin = (event: PointerEvent<HTMLButtonElement>, kind: Gesture['kind']) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, frame: frameRef.current };
    setInteracting(true);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    frameRef.current = current.kind === 'move' ? clampAiPanelFrame({ ...current.frame, x: current.frame.x + dx, y: current.frame.y + dy }, panelBounds(root.current))
      : resizeAiPanelFrame(current.frame, current.kind, dx, dy, panelBounds(root.current));
    if (!drawing.current) drawing.current = requestAnimationFrame(() => { drawing.current = 0; paintFrame(frameRef.current); });
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.id !== event.pointerId) return;
    cancelAnimationFrame(drawing.current); drawing.current = 0;
    changeFrame(frameRef.current);
    gesture.current = null; setInteracting(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, kind: Gesture['kind']) => {
    if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 40 : 10;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const current = frameRef.current;
    changeFrame(kind === 'move' ? { ...current, x: current.x + dx, y: current.y + dy } : resizeAiPanelFrame(current, kind, dx, dy, panelBounds(root.current)));
  };
  const pointerHandlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };

  return <section ref={root} id="mewiki-ai-floating-panel" data-testid="mewiki-ai-workspace" className="mewiki-ai-floating-panel" role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : false} aria-label={t('AI 工作区')} hidden={suspended}
    data-placement={docked ? 'right' : 'floating'} data-interacting={interacting} data-compact={(docked ? dockHeight : frame.height) < 390} style={docked ? undefined : { transform: `translate3d(${frame.x}px, ${frame.y}px, 0)`, width: frame.width, height: frame.height,
      '--ai-floating-width': `${frame.width}px`, '--ai-floating-height': `${frame.height}px` } as CSSProperties}
    onKeyDown={event => {
      // Nested menus handle Escape first; a temporary sidebar may then dismiss itself.
      if (event.key === 'Escape') { if (!event.defaultPrevented) onEscape?.(); event.preventDefault(); event.stopPropagation(); }
    }}>
    <header className="mewiki-ai-floating-toolbar">
      {docked ? tabs : <button type="button" className="mewiki-ai-floating-move" aria-label={t('移动AI 面板')} title={t('拖动或使用方向键移动AI 面板')} {...pointerHandlers}
        onPointerDown={event => begin(event, 'move')} onKeyDown={event => keyboard(event, 'move')}><AiMascot size={22} /><span>{t('觅维 智能助理')}</span></button>
      }
      {onDockToggle && <button type="button" data-ui="icon-action" className="mewiki-ai-dock-toggle" aria-label={docked ? t('切换为浮窗') : t('嵌入右侧栏')} title={docked ? t('切换为浮窗') : t('嵌入右侧栏')} onClick={onDockToggle}>
        {docked ? <PanelsTopLeft size={15} /> : <PanelRightDashed size={15} />}
      </button>}
      {docked && panelControls}
    </header>
    <div id="mewiki-ai-floating-content" className="mewiki-ai-floating-content" role={docked ? 'tabpanel' : undefined} aria-labelledby={docked ? 'mewiki-ai-sidebar-tab' : undefined}>{children}</div>
    {!docked && edges.map(edge => <button key={edge} type="button" className="mewiki-ai-floating-resize" data-ai-resize-edge={edge}
      aria-label={edgeLabels[edge]} title={t('拖动或使用方向键调整AI 面板大小')} {...pointerHandlers}
      onPointerDown={event => begin(event, edge)} onKeyDown={event => keyboard(event, edge)} />)}
  </section>;
}
