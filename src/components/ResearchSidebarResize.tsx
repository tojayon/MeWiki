import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { researchSidebarWidths } from "./researchSidebarLayout.ts";

const defaultWidth = 300;

function loadWidth(storageKey: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  } catch {
    // Use the default width when browser storage is unavailable.
  }
  return defaultWidth;
}

export default function ResearchSidebarResize({ side = "left" }: { side?: "left" | "right" }) {
  const storageKey = side === "left" ? "mewiki:research-notebook-sidebar-width" : "mewiki:research-notebook-outline-width";
  const separatorRef = useRef<HTMLDivElement>(null);
  const [preferredWidth, setPreferredWidth] = useState(() => loadWidth(storageKey));
  const [{ layoutWidth, otherPreference, leftVisible, rightVisible }, setSize] = useState({ layoutWidth: 0, otherPreference: defaultWidth, leftVisible: true, rightVisible: false });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; width: number; leftPreference: number; rightPreference: number } | null>(null);
  const narrow = layoutWidth > 0 && layoutWidth < (side === "right" ? 1000 : 720);
  const minimum = narrow ? Math.min(180, Math.floor(layoutWidth * 0.45)) : 260;
  const otherMinimum = layoutWidth >= 1000 && (side === "left" ? rightVisible : leftVisible) ? 260 : 0;
  const maximum = narrow ? Math.min(320, Math.floor(layoutWidth * (side === "right" ? 0.85 : 0.5))) : Math.min(520, Math.max(260, layoutWidth - otherMinimum - 360));
  const clamp = (value: number) => Math.round(Math.min(maximum, Math.max(minimum, value)));
  const leftPreference = side === "left" ? preferredWidth : otherPreference;
  const rightPreference = side === "right" ? preferredWidth : otherPreference;
  const widths = researchSidebarWidths(layoutWidth, leftPreference, rightPreference, leftVisible, rightVisible);
  const width = side === "left" ? widths.left : widths.right;
  const setPreferences = (left: number, right: number) => separatorRef.current?.parentElement?.dispatchEvent(
    new CustomEvent("research-sidebar-preferences", { detail: { left, right } }),
  );
  const setActiveWidth = (requested: number) => {
    const target = clamp(requested);
    const other = side === "left" ? widths.right : widths.left;
    const remaining = layoutWidth >= 1000 && leftVisible && rightVisible
      ? Math.min(other, layoutWidth - 360 - target) : other;
    setPreferences(side === "left" ? target : remaining, side === "right" ? target : remaining);
  };

  useLayoutEffect(() => {
    const element = separatorRef.current?.parentElement;
    if (!element) return;
    const measure = () => {
      const measuredWidth = element.getBoundingClientRect().width;
      if (measuredWidth <= 0) return;
      const leftVisible = !element.classList.contains("is-sidebar-collapsed");
      const rightVisible = element.classList.contains("has-outline");
      const property = side === "left" ? "--research-outline-preferred-width" : "--research-sidebar-preferred-width";
      const otherPreference = parseFloat(getComputedStyle(element).getPropertyValue(property)) || defaultWidth;
      setSize(previous => previous.layoutWidth === measuredWidth && previous.otherPreference === otherPreference && previous.leftVisible === leftVisible && previous.rightVisible === rightVisible
        ? previous : { layoutWidth: measuredWidth, otherPreference, leftVisible, rightVisible });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const changes = new MutationObserver(measure);
    changes.observe(element, { attributes: true, attributeFilter: ["class", "style"] });
    return () => { observer.disconnect(); changes.disconnect(); };
  }, [side]);

  useEffect(() => {
    const element = separatorRef.current?.parentElement;
    if (!element) return;
    const change = (event: Event) => setPreferredWidth((event as CustomEvent<{ left: number; right: number }>).detail[side]);
    element.addEventListener("research-sidebar-preferences", change);
    return () => element.removeEventListener("research-sidebar-preferences", change);
  }, [side]);

  useLayoutEffect(() => {
    separatorRef.current?.parentElement?.style.setProperty(side === "left" ? "--research-sidebar-width" : "--research-outline-width", `${width}px`);
    separatorRef.current?.parentElement?.style.setProperty(side === "left" ? "--research-sidebar-preferred-width" : "--research-outline-preferred-width", `${preferredWidth}px`);
  }, [width, preferredWidth, side]);

  useEffect(() => {
    if (dragging) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferredWidth));
    } catch {
      // Resizing remains available without persistent browser storage.
    }
  }, [preferredWidth, dragging, storageKey]);

  return <div
    ref={separatorRef}
    className={`research-notebook-divider${side === "right" ? " is-right" : ""}${dragging ? " is-resizing" : ""}`}
    role="separator"
    tabIndex={0}
    aria-label={`调整${side === "left" ? "左" : "右"}侧栏宽度`}
    aria-orientation="vertical"
    aria-valuemin={minimum}
    aria-valuemax={maximum}
    aria-valuenow={width}
    aria-valuetext={`${width} 像素`}
    title={`拖动调整${side === "left" ? "左" : "右"}栏宽度，也可使用左右方向键`}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, width, leftPreference, rightPreference };
      setPreferences(widths.left, widths.right);
      setDragging(true);
    }}
    onPointerMove={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      setActiveWidth(drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1));
    }}
    onPointerUp={(event) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      setActiveWidth(drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1));
      drag.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => {
      if (drag.current) setPreferences(drag.current.leftPreference, drag.current.rightPreference);
      drag.current = null;
      setDragging(false);
    }}
    onLostPointerCapture={() => {
      drag.current = null;
      setDragging(false);
    }}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 40 : 10;
      const direction = side === "left" ? 1 : -1;
      const next = event.key === "ArrowLeft" ? width - step * direction
        : event.key === "ArrowRight" ? width + step * direction
          : event.key === "Home" ? minimum
            : event.key === "End" ? maximum : undefined;
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveWidth(next);
    }}
  />;
}
