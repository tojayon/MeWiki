import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type PopoverPosition = { left: number; top: number };
type PopoverDrag = PopoverPosition & {
  pointerId: number;
  startX: number;
  startY: number;
  previous: PopoverPosition | null;
  moved: boolean;
};

export function useFormulaPopover({ ref, getAnchor, onCancel, triggerRef, side = "bottom", draggable = false }: {
  ref: RefObject<HTMLDivElement | null>;
  getAnchor: () => { left: number; top: number; bottom: number; right?: number };
  onCancel: (restoreFocus?: boolean, nextTarget?: EventTarget | null) => void;
  triggerRef?: RefObject<HTMLElement | null>;
  side?: "bottom" | "right" | "top";
  draggable?: boolean;
}) {
  const manualPosition = useRef<PopoverPosition | null>(null);
  const drag = useRef<PopoverDrag | null>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    if (!element.matches(":popover-open")) element.showPopover();
    const place = () => {
      const rect = element.getBoundingClientRect();
      const anchor = getAnchor();
      const preferredLeft = side === "right" ? (anchor.right ?? anchor.left) + 6 : anchor.left - 16;
      const left = Math.max(12, Math.min(Math.max(12, window.innerWidth - rect.width - 12), manualPosition.current?.left ?? preferredLeft));
      const below = anchor.bottom + 8;
      const preferredTop = side === "right"
        ? Math.max(12, Math.min(window.innerHeight - rect.height - 12, anchor.top))
        : side === "top" ? anchor.top - rect.height - 8
          : below + rect.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - rect.height - 8);
      const top = Math.max(12, Math.min(Math.max(12, window.innerHeight - rect.height - 12), manualPosition.current?.top ?? preferredTop));
      if (manualPosition.current) manualPosition.current = { left, top };
      element.style.left = left + "px";
      element.style.top = top + "px";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [getAnchor, ref, side]);
  useEffect(() => {
    if (!draggable) return;
    const element = ref.current;
    if (!element) return;
    const finish = (cancelled: boolean) => {
      const state = drag.current;
      if (!state) return;
      // Clear first: releasing capture can dispatch lostpointercapture.
      drag.current = null;
      if (cancelled && state.moved) {
        manualPosition.current = state.previous;
        element.style.left = `${state.left}px`;
        element.style.top = `${state.top}px`;
      }
      element.removeAttribute("data-dragging");
      if (element.hasPointerCapture(state.pointerId)) element.releasePointerCapture(state.pointerId);
    };
    const begin = (event: PointerEvent) => {
      if (drag.current || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
      const target = event.target;
      if (target.closest("input, textarea, select, button, a, label, summary, [role='button'], [contenteditable]:not([contenteditable='false']), .formula, [data-popover-no-drag]")) return;
      if ([...target.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) return;
      // Touch gestures elsewhere remain available for scrolling the palette.
      if (event.pointerType !== "mouse" && !target.closest("[data-popover-drag-handle]")) return;
      const rect = element.getBoundingClientRect();
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, previous: manualPosition.current, moved: false };
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
      if (!state.moved && Math.hypot(dx, dy) < 3) return;
      state.moved = true;
      element.setAttribute("data-dragging", "");
      const rect = element.getBoundingClientRect();
      const left = Math.max(12, Math.min(Math.max(12, window.innerWidth - rect.width - 12), state.left + dx));
      const top = Math.max(12, Math.min(Math.max(12, window.innerHeight - rect.height - 12), state.top + dy));
      manualPosition.current = { left, top };
      element.style.left = `${left}px`; element.style.top = `${top}px`;
      event.preventDefault();
    };
    const end = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      finish(false);
    };
    const cancel = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) finish(true); };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault(); event.stopImmediatePropagation(); finish(true);
    };
    const onBlur = () => finish(true);
    element.addEventListener("pointerdown", begin);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("lostpointercapture", cancel);
    window.addEventListener("keydown", onEscape, true); window.addEventListener("blur", onBlur);
    return () => {
      finish(true);
      element.removeEventListener("pointerdown", begin);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [draggable, ref]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
  }, [ref]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !triggerRef?.current?.contains(event.target)) onCancel(false, event.target);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The innermost picker owns Escape; keep its surrounding formula editor open.
      if (event.target instanceof Element && event.target.closest('[popover]:popover-open') !== ref.current) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel(true);
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", dismiss, true); document.removeEventListener("keydown", escape, true); };
  }, [onCancel, ref, triggerRef]);
}
