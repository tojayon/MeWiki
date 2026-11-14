import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { aiFloatingBounds, placeAiLauncher, readAiLauncherPosition, snapAiLauncher, type AiPanelFrame } from './aiFloatingPanelLayout.ts';
import './AiFloatingLauncher.css';
import AiMascot from './AiMascot.tsx';

export default function AiFloatingLauncher({ libraryId, expanded, disabled, hidden, buttonRef, onToggle }: {
  libraryId: string; expanded: boolean; disabled?: boolean; hidden?: boolean; buttonRef: RefObject<HTMLButtonElement | null>; onToggle: () => void;
}) {
  useLocale();
  const key = `mewiki:library:${encodeURIComponent(libraryId)}:ai-launcher:v1`;
  const [position, setPosition] = useState(() => {
    try { return readAiLauncherPosition(JSON.parse(localStorage.getItem(key) ?? 'null')) ?? { edge: 'right' as const, ratio: .72 }; }
    catch { return { edge: 'right' as const, ratio: .72 }; }
  });
  const preferred = useRef(position);
  const gesture = useRef<{ id: number; x: number; y: number; frame: AiPanelFrame; moved: boolean } | null>(null);
  const drawing = useRef(0);
  const frame = useRef(placeAiLauncher(position, aiFloatingBounds(null)));
  const lastBounds = useRef(aiFloatingBounds(null));
  const suppressClick = useRef(false);
  const paint = useCallback((next: AiPanelFrame) => {
    frame.current = next;
    const element = buttonRef.current;
    if (element) { element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`; element.style.width = `${next.width}px`; element.style.height = `${next.height}px`; }
  }, [buttonRef]);
  useLayoutEffect(() => {
    preferred.current = position;
    paint(placeAiLauncher(position, aiFloatingBounds(buttonRef.current)));
  }, [position, paint, buttonRef]);
  useLayoutEffect(() => {
    const update = () => {
      const bounds = aiFloatingBounds(buttonRef.current), previous = lastBounds.current;
      const changed = bounds.left !== previous.left || bounds.top !== previous.top || bounds.width !== previous.width || bounds.height !== previous.height;
      lastBounds.current = bounds;
      if (gesture.current && !changed) return;
      const current = gesture.current;
      cancelAnimationFrame(drawing.current); drawing.current = 0; gesture.current = null;
      if (current) {
        suppressClick.current = true;
        if (buttonRef.current?.hasPointerCapture(current.id)) buttonRef.current.releasePointerCapture(current.id);
      }
      buttonRef.current?.removeAttribute('data-dragging');
      paint(placeAiLauncher(preferred.current, bounds));
    };
    const observer = new ResizeObserver(update), dialog = buttonRef.current?.closest('dialog');
    if (dialog) observer.observe(dialog);
    window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
    return () => { observer.disconnect(); cancelAnimationFrame(drawing.current); window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); };
  }, [buttonRef, paint]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ version: 1, ...position })); } catch { /* Keep the entry usable without storage. */ } }, [key, position]);

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return;
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, frame: frame.current, moved: false };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) < 5 && !current.moved) return;
    current.moved = true; suppressClick.current = true; event.currentTarget.dataset.dragging = 'true';
    const bounds = aiFloatingBounds(event.currentTarget);
    frame.current = { ...current.frame, x: Math.max(bounds.left, Math.min(current.frame.x + dx, bounds.left + bounds.width - current.frame.width)),
      y: Math.max(bounds.top + 8, Math.min(current.frame.y + dy, bounds.top + bounds.height - current.frame.height - 8)) };
    if (!drawing.current) drawing.current = requestAnimationFrame(() => { drawing.current = 0; paint(frame.current); });
  };
  const end = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null; cancelAnimationFrame(drawing.current); drawing.current = 0; event.currentTarget.removeAttribute('data-dragging');
    if (current.moved && !cancelled) setPosition(snapAiLauncher(frame.current, aiFloatingBounds(event.currentTarget)));
    else paint(placeAiLauncher(preferred.current, aiFloatingBounds(event.currentTarget)));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? { ...preferred.current, edge: event.key === 'ArrowLeft' ? 'left' as const : 'right' as const }
      : snapAiLauncher({ ...frame.current, y: frame.current.y + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 40 : 10) }, aiFloatingBounds(event.currentTarget));
    setPosition(next);
  };
  return <button ref={buttonRef} type="button" className="mewiki-ai-launcher" data-testid="mewiki-ai-launcher" data-edge={position.edge} aria-label={t('AI 工作区')} hidden={hidden}
    title={t('打开或关闭 AI；拖动或使用方向键移动入口')} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? 'mewiki-ai-floating-panel' : undefined} disabled={disabled}
    onPointerDown={start} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}
    onKeyDown={keyboard} onClick={event => { if (event.detail && suppressClick.current) { suppressClick.current = false; return; } onToggle(); }}><AiMascot size={40} /></button>;
}
