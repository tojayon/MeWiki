import { t } from "../i18n/locale.ts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import type { ResearchTheorySection } from "../domain/researchNotebook.ts";
import {
  loadTheoryDrawerLayout,
  resolveTheoryDrawerHeights,
  saveTheoryDrawerLayout,
  THEORY_DRAWER_BADGE_HEIGHT,
  THEORY_DRAWER_BADGE_INSET,
  THEORY_DRAWER_MIN_HEIGHT,
  type TheoryDrawerHeights,
} from "../state/researchTheoryDrawerLayout.ts";

interface ResizeGesture {
  section: ResearchTheorySection;
  pointerId: number;
  target: HTMLDivElement;
  y: number;
  height: number;
  frameHeight: number;
  minimum: number;
  maximum: number;
  joined: boolean;
  heights: TheoryDrawerHeights;
  previous: TheoryDrawerHeights;
}

export function useResearchTheoryDrawerLayout(visible: boolean) {
  const [drawers, setDrawers] = useState(loadTheoryDrawerLayout);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(0);
  const [resizing, setResizing] = useState<ResearchTheorySection | null>(null);
  const gesture = useRef<ResizeGesture | null>(null);
  const sizes = resolveTheoryDrawerHeights(drawers.heights, frameHeight);
  const middleCollapsed = drawers.enabled && drawers.given && drawers.conclusion && frameHeight > 0
    && frameHeight - sizes.given - sizes.conclusion < 0.5;
  const resizeVisible = visible && drawers.enabled && resizing !== null && drawers[resizing];

  useLayoutEffect(() => {
    if (!frame) return;
    const measure = () => {
      const height = frame.getBoundingClientRect().height;
      if (height > 0) setFrameHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  useEffect(() => {
    if (!resizing) saveTheoryDrawerLayout(drawers);
  }, [drawers, resizing]);

  const releaseGesture = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    setResizing(null);
    if (current?.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
  }, []);

  const cancelGesture = useCallback(() => {
    if (!gesture.current) return;
    const previous = gesture.current.previous;
    setDrawers(current => ({ ...current, heights: previous }));
    releaseGesture();
  }, [releaseGesture]);

  useEffect(() => {
    if (!resizing) return;
    if (!resizeVisible || !frame || (gesture.current?.joined && (!drawers.given || !drawers.conclusion))) {
      cancelGesture();
      return;
    }
    const cancelPointer = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) cancelGesture();
    };
    const visibilityChanged = () => { if (document.hidden) cancelGesture(); };
    // A removed capture target does not always dispatch through React again.
    window.addEventListener("pointerup", cancelPointer);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("blur", cancelGesture);
    window.addEventListener("pagehide", cancelGesture);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.removeEventListener("pointerup", cancelPointer);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("blur", cancelGesture);
      window.removeEventListener("pagehide", cancelGesture);
      document.removeEventListener("visibilitychange", visibilityChanged);
      cancelGesture();
    };
  }, [resizing, resizeVisible, frame, frameHeight, drawers.given, drawers.conclusion, cancelGesture]);

  const updateGesture = (clientY: number) => {
    const current = gesture.current;
    if (!current) return;
    const direction = current.section === "given" ? 1 : -1;
    const height = Math.max(current.minimum, Math.min(current.maximum, current.height + direction * (clientY - current.y)));
    // Pressing the edge, or returning to the start, must preserve the preference
    // rather than save a temporary fit for a smaller viewport.
    const other = current.section === "given" ? "conclusion" : "given";
    const ratio = height / current.frameHeight;
    const heights = Math.abs(height - current.height) < 0.01 ? current.previous : {
      ...current.heights, [current.section]: ratio, ...(current.joined ? { [other]: 1 - ratio } : {}),
    };
    setDrawers(layout => ({ ...layout, heights }));
  };

  const resizeHandle = (section: ResearchTheorySection): HTMLAttributes<HTMLDivElement> => {
    const other = section === "given" ? "conclusion" : "given";
    const maximum = sizes.available - (middleCollapsed ? sizes.minimum : sizes[other]);
    return {
      "aria-valuemin": Math.round(sizes.minimum),
      "aria-valuemax": Math.round(maximum),
      "aria-valuenow": Math.round(sizes[section]),
      "aria-valuetext": t`${Math.round(sizes[section])} 像素`,
      onPointerDown: event => {
        if (event.button !== 0 || frameHeight <= 0 || gesture.current) return;
        // Let the short open/close animation finish before capturing its edge.
        if (frame?.getAnimations().some(animation => animation instanceof CSSTransition && animation.transitionProperty === "grid-template-rows" && animation.playState !== "finished")) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = {
          section, pointerId: event.pointerId, target: event.currentTarget, y: event.clientY,
          height: sizes[section], frameHeight, minimum: sizes.minimum, maximum,
          joined: middleCollapsed,
          heights: { given: sizes.given / frameHeight, conclusion: sizes.conclusion / frameHeight },
          previous: drawers.heights,
        };
        setResizing(section);
      },
      onPointerMove: event => {
        if (gesture.current?.pointerId === event.pointerId) updateGesture(event.clientY);
      },
      onPointerUp: event => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        updateGesture(event.clientY);
        releaseGesture();
      },
      onPointerCancel: event => {
        if (gesture.current?.pointerId === event.pointerId) cancelGesture();
      },
      onLostPointerCapture: event => {
        if (gesture.current?.pointerId === event.pointerId) cancelGesture();
      },
      onKeyDown: event => {
        if (event.key === "Escape" && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          cancelGesture();
          return;
        }
        if (frameHeight <= 0 || gesture.current) return;
        const step = (event.shiftKey ? 40 : 10) * (section === "given" ? 1 : -1);
        const next = event.key === "ArrowDown" ? sizes[section] + step
          : event.key === "ArrowUp" ? sizes[section] - step
            : event.key === "Home" ? sizes.minimum
              : event.key === "End" ? maximum : undefined;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        const height = Math.max(sizes.minimum, Math.min(maximum, next));
        if (Math.abs(height - sizes[section]) < 0.01) return;
        const ratio = height / frameHeight;
        setDrawers(current => ({ ...current, heights: {
          given: sizes.given / frameHeight, conclusion: sizes.conclusion / frameHeight, [section]: height / frameHeight,
          ...(middleCollapsed ? { [other]: 1 - ratio } : {}),
        } }));
      },
    };
  };

  const fillEqually = () => {
    cancelGesture();
    setDrawers(current => ({ ...current, enabled: true, given: true, conclusion: true, heights: { given: 0.5, conclusion: 0.5 } }));
  };

  const revealDerivation = () => {
    if (!middleCollapsed) return;
    setDrawers(current => {
      // In a very short window, the two badge minimums occupy the whole frame.
      // Fold the upper drawer to make an explicit derivation jump reachable.
      if (frameHeight <= 2 * THEORY_DRAWER_MIN_HEIGHT + 1) return { ...current, given: false };
      // An explicit content jump opens enough room to read its destination.
      const fitted = resolveTheoryDrawerHeights(current.heights, frameHeight * 0.6);
      return { ...current, heights: { given: fitted.given / frameHeight, conclusion: fitted.conclusion / frameHeight } };
    });
  };

  const frameStyle = {
    "--theory-badge-height": `${THEORY_DRAWER_BADGE_HEIGHT}px`,
    "--theory-badge-inset": `${THEORY_DRAWER_BADGE_INSET}px`,
    "--theory-drawer-min-height": `${THEORY_DRAWER_MIN_HEIGHT}px`,
    "--given-open-size": frameHeight > 0 ? `${sizes.given}px` : `${drawers.heights.given * 100}%`,
    "--conclusion-open-size": frameHeight > 0 ? `${sizes.conclusion}px` : `${drawers.heights.conclusion * 100}%`,
  } as CSSProperties;

  return { drawers, setDrawers, setFrame, frameStyle, resizing, resizeHandle, middleCollapsed, revealDerivation, fillEqually };
}
