import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';

/** A transient warning overlays its own chat panel without taking input focus. */
export default function AiMaterialNotice({ messages, triggerRef, onClose }: {
  messages: string[]; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const close = useCallback((restoreFocus = false) => {
    onClose();
    if (restoreFocus && !triggerRef.current?.disabled) triggerRef.current?.focus({ preventScroll: true });
  }, [onClose, triggerRef]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const checkVisibility = () => {
      const trigger = triggerRef.current;
      if (!trigger?.isConnected || !trigger.getClientRects().length || trigger.closest('[hidden], [inert], [aria-hidden="true"]')) close();
    };
    const observer = new MutationObserver(checkVisibility);
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden'] });
    checkVisibility();
    return () => observer.disconnect();
  }, [close, triggerRef]);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(() => close(), 8000);
    return () => window.clearTimeout(timer);
  }, [messages, hovered, focused, close]);
  return <div ref={ref} className="mewiki-ai-material-notice"
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}>
    <TriangleAlert size={22} aria-hidden="true" />
    <div className="mewiki-ai-material-notice-content" role="alert" aria-atomic="true">{messages.map((message, index) => <p key={index}>{message}</p>)}</div>
    <button type="button" data-ui="icon-action" aria-label={t('关闭提示')} title={t('关闭提示')} onClick={() => close(true)}><X size={16} /></button>
  </div>;
}
