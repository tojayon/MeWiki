import { useLayoutEffect, useState } from "react";

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
