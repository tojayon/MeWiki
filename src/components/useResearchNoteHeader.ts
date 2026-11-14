import { useLayoutEffect, useRef, useState } from "react";

/** Observe the reading pane itself, including space taken by either sidebar. */
export function useNarrowResearchNoteHeader(element: HTMLElement | null) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.borderBoxSize[0]?.inlineSize ?? entries[0]?.contentRect.width ?? 0;
      if (width > 0) setNarrow(width < 640);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return narrow;
}

/** Give the title its measured width before spending space on optional badges. */
export function useResearchNoteTitleLayout(element: HTMLElement | null) {
  const [layout, setLayout] = useState<{ titleWidth: number; leadingWidth: number; hideTags: boolean }>();
  const measure = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    if (!element) return;
    const context = document.createElement("canvas").getContext("2d");
    let frame = 0, disposed = false;
    const update = () => {
      if (disposed) return;
      const title = element.querySelector<HTMLInputElement>(".research-note-title");
      const organization = element.querySelector<HTMLElement>(".research-note-organization");
      const actions = element.querySelector<HTMLElement>(".research-note-header-actions");
      if (!context || !title || !organization || !actions || element.matches(".is-compact, .is-map-view")) {
        setLayout(previous => previous === undefined ? previous : undefined);
        return;
      }
      const headerStyle = getComputedStyle(element), titleStyle = getComputedStyle(title);
      context.font = titleStyle.font;
      context.letterSpacing = titleStyle.letterSpacing;
      const titleWidth = Math.ceil(context.measureText(title.value || title.placeholder).width
        + parseFloat(titleStyle.paddingLeft) + parseFloat(titleStyle.paddingRight) + 2);
      const tags = element.querySelector<HTMLElement>(".research-note-tag-list");
      // Children keep their natural widths while the hidden list takes no space.
      const tagWidths = tags ? [...tags.children].map(tag => tag.getBoundingClientRect().width) : [];
      const tagsWidth = tagWidths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, tagWidths.length - 1) * (tags ? parseFloat(getComputedStyle(tags).columnGap) || 0 : 0);
      const organizationWidth = organization.getBoundingClientRect().width;
      const badgeGap = organization.parentElement ? parseFloat(getComputedStyle(organization.parentElement).columnGap) || 0 : 0;
      const availableWidth = element.clientWidth - parseFloat(headerStyle.paddingLeft) - parseFloat(headerStyle.paddingRight)
        - 2 * (parseFloat(headerStyle.columnGap) || 0) - actions.getBoundingClientRect().width;
      const hideTags = tagsWidth > 0 && organizationWidth + badgeGap + tagsWidth + titleWidth > availableWidth;
      const leadingWidth = Math.ceil(organizationWidth + (tagsWidth > 0 && !hideTags ? badgeGap + tagsWidth : 0));
      setLayout(previous => previous?.titleWidth === titleWidth && previous.leadingWidth === leadingWidth && previous.hideTags === hideTags
        ? previous : { titleWidth, leadingWidth, hideTags });
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    measure.current = update;
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const actions = element.querySelector(".research-note-header-actions");
    if (actions) observer.observe(actions);
    const typography = new MutationObserver(schedule);
    typography.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    document.fonts.addEventListener("loadingdone", schedule);
    void document.fonts.ready.then(schedule);
    return () => {
      disposed = true;
      measure.current = () => {};
      cancelAnimationFrame(frame);
      observer.disconnect();
      typography.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [element]);
  // Includes external renames, IME edits, mode changes and newly assigned tags.
  useLayoutEffect(() => { measure.current(); });
  return layout;
}
