import { cannonVisiblePrefix } from './aiTextCannon.ts';

export const cannonAdditions = 'ins.mewiki-ai-inline-change, ins.mewiki-ai-review-rendered-change, [data-ai-change="add"], .mewiki-ai-diff-row[data-kind="add"]:not([data-review-text-row]), .mewiki-ai-review-new-title, .mewiki-ai-review-tab-label ins';
export const cannonRemovals = 'del.mewiki-ai-inline-change, del.mewiki-ai-review-rendered-change, [data-ai-change="remove"], .mewiki-ai-diff-row[data-kind="remove"]:not([data-review-text-row]), .mewiki-ai-review-tab-label del';
export const cannonLeaves = (elements: HTMLElement[]) => {
  const whole = elements.filter(element => element.matches('ins.mewiki-ai-review-rendered-change, del.mewiki-ai-review-rendered-change'));
  return elements.filter(element => !whole.some(parent => parent !== element && parent.contains(element))
    && (whole.includes(element) || !elements.some(other => other !== element && element.contains(other))));
};
export const cannonPair = (element: HTMLElement) => element.closest<HTMLElement>('.mewiki-ai-review-pair');
export const cannonIsRemoval = (element: HTMLElement) => !!element.closest('del, [data-ai-change="remove"], [data-kind="remove"]');
export interface CannonReplayTarget { element: HTMLElement; start: number; clip?: boolean }

/** Select text without replacing React-owned nodes or changing line wrapping. */
export function cannonTextRange(element: HTMLElement, start = 0, end = element.textContent?.length ?? 0) {
  const range = document.createRange(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = 0, first = false;
  while (walker.nextNode()) {
    const node = walker.currentNode, length = node.textContent?.length ?? 0;
    if (!first && start <= offset + length) { range.setStart(node, Math.max(0, start - offset)); first = true; }
    if (first && end <= offset + length) { range.setEnd(node, Math.max(0, end - offset)); return range; }
    offset += length;
  }
  range.selectNodeContents(element);
  return range;
}

/** Capture one replay origin at the current reading position, before staging any text. */
export function cannonReplayTargets(scroll: HTMLElement): CannonReplayTarget[] {
  const additions = [...scroll.querySelectorAll<HTMLElement>(cannonAdditions)];
  const removals = [...scroll.querySelectorAll<HTMLElement>(cannonRemovals)].filter(element => {
    const group = cannonPair(element) ?? element.closest('[data-review-block-id], [data-review-field]') ?? element.parentElement;
    return !group?.querySelector(cannonAdditions);
  });
  const elements = cannonLeaves([...additions, ...removals])
    .filter(element => element.textContent?.trim() && element.checkVisibility({ checkVisibilityCSS: true }))
    .sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const viewport = scroll.getBoundingClientRect(), top = viewport.top + 8, bottom = viewport.bottom - 8;
  const ownRects = elements.map(element => [...cannonTextRange(element).getClientRects()].filter(rect => rect.width && rect.height));
  const rects = elements.map((element, index) => {
    const group = cannonPair(element);
    let old = group ? cannonLeaves([...group.querySelectorAll<HTMLElement>(cannonRemovals)]) : [];
    const added = group ? cannonLeaves([...group.querySelectorAll<HTMLElement>(cannonAdditions)]) : [];
    if (old.length === added.length && added.includes(element)) old = [old[added.indexOf(element)]];
    return [...ownRects[index], ...old.flatMap(part => [...cannonTextRange(part).getClientRects()])];
  });
  let first = rects.findIndex(boxes => boxes.some(rect => rect.bottom > top && rect.top < bottom));
  if (first < 0) first = rects.findIndex(boxes => boxes.some(rect => rect.bottom > top));
  if (first < 0) first = Math.max(0, elements.length - 1);
  return elements.slice(first).map((element, index) => {
    let start = 0;
    // A single changed span can cross several screens. Begin at its first visible line.
    if (index === 0 && ownRects[first]?.[0]?.bottom <= top && ownRects[first].some(rect => rect.bottom > top)) {
      let lo = 0, hi = element.textContent!.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cannonTextRange(element, mid, mid + 1).getBoundingClientRect().bottom <= top) lo = mid + 1;
        else hi = mid;
      }
      start = lo;
    }
    return { element, start, clip: index === 0 && rects[first].some(rect => rect.bottom > top && rect.top < bottom) };
  });
}

/** Temporary paint-only staging. The complete review remains available to assistive technology. */
export function createCannonTextReveal(scroll: HTMLElement, name: string) {
  const supported = typeof Highlight !== 'undefined' && !!CSS.highlights;
  const highlight = supported ? new Highlight() : null;
  const removed = supported ? new Highlight() : null, written = supported ? new Highlight() : null;
  const highlights = [[name, highlight], [`${name}-removed`, removed], [`${name}-written`, written]] as const;
  const style = document.createElement('style');
  style.textContent = `::highlight(${name}) { color: transparent; background-color: transparent; text-decoration-color: transparent; text-shadow: none; }
    ::highlight(${name}-removed) { color: #812c36; background-color: #f7cbd0; text-decoration: line-through; text-shadow: none; }
    ::highlight(${name}-written) { color: #225d38; background-color: #bce4c8; text-decoration: none; text-shadow: none; }`;
  if (highlight) {
    document.head.append(style);
    for (const [key, value] of highlights) { value!.priority = 1; CSS.highlights.set(key, value!); }
  }
  const entries = new Map<HTMLElement, { landed: string; removal: boolean }>();
  const staged = new Set<HTMLElement>();
  const paint = () => {
    for (const [, value] of highlights) value?.clear();
    for (const [element, entry] of entries) {
      if (!element.isConnected || !scroll.contains(element)) { entries.delete(element); continue; }
      const text = element.textContent ?? '';
      entry.landed = cannonVisiblePrefix(entry.landed, text);
      if (entry.landed.length) (entry.removal ? removed : written)?.add(cannonTextRange(element, 0, entry.landed.length));
      if (!entry.removal && entry.landed.length < text.length) highlight?.add(cannonTextRange(element, entry.landed.length));
    }
  };
  const parts = (group: HTMLElement, selector: string) => cannonLeaves([...group.querySelectorAll<HTMLElement>(selector)]);
  const stage = (element: HTMLElement) => {
    const group = cannonPair(element);
    if (!group) return;
    const removals = parts(group, cannonRemovals);
    if (!staged.has(group)) {
      staged.add(group); group.dataset.cannonPhase = removals.length ? 'delete' : 'write';
    }
    // Streaming can split an existing diff into new leaves while its laser is running.
    for (const part of parts(group, cannonAdditions)) if (!entries.has(part)) entries.set(part, { landed: '', removal: false });
    for (const part of removals) if (!entries.has(part)) entries.set(part, { landed: group.dataset.cannonPhase === 'write' ? part.textContent ?? '' : '', removal: true });
  };
  const hold = (element: HTMLElement) => {
    if (!highlight) return;
    stage(element);
    if (!entries.has(element)) entries.set(element, { landed: '', removal: cannonIsRemoval(element) });
    paint();
  };
  const holdMany = (targets: CannonReplayTarget[]) => {
    if (!highlight) return;
    // Both review rows keep their original positions; only the painted change ranges reset.
    for (const element of cannonLeaves([...scroll.querySelectorAll<HTMLElement>(`${cannonAdditions}, ${cannonRemovals}`)])) stage(element);
    for (const { element, start } of targets) {
      const removal = cannonIsRemoval(element);
      entries.set(element, { landed: removal ? '' : (element.textContent ?? '').slice(0, start), removal });
    }
    // A replay chosen in the middle of a long change never returns to its off-screen prefix.
    const first = targets[0] && cannonPair(targets[0].element), top = scroll.getBoundingClientRect().top + 8;
    if (first && targets[0].clip) for (const part of parts(first, cannonRemovals)) {
      const rects = [...cannonTextRange(part).getClientRects()];
      let start = 0;
      if (rects.length && rects.every(rect => rect.bottom <= top)) start = part.textContent?.length ?? 0;
      else if (rects[0]?.bottom <= top) {
        let lo = 0, hi = part.textContent?.length ?? 0;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (cannonTextRange(part, mid, mid + 1).getBoundingClientRect().bottom <= top) lo = mid + 1;
          else hi = mid;
        }
        start = lo;
      }
      entries.set(part, { landed: (part.textContent ?? '').slice(0, start), removal: true });
    }
    paint();
  };
  const land = (element: HTMLElement, text: string, end = text.length) => {
    if (!highlight || !element.isConnected) return;
    const entry = entries.get(element);
    if (!entry) return;
    const current = element.textContent ?? '', next = cannonVisiblePrefix(text.slice(0, end), current);
    const previous = cannonVisiblePrefix(entry.landed, current);
    entry.landed = next.length > previous.length ? next : previous;
    paint();
  };
  const deletions = (element: HTMLElement) => {
    if (!highlight) return [];
    const group = cannonPair(element);
    if (group ? !staged.has(group) : !entries.has(element)) return [];
    if (group) stage(element);
    if (group?.dataset.cannonPhase === 'write') return [];
    return (group ? parts(group, cannonRemovals) : cannonIsRemoval(element) ? [element] : [])
      .map(part => ({ element: part, text: part.textContent ?? '', start: entries.get(part)?.landed.length ?? 0 }))
      .filter(part => part.start < part.text.length);
  };
  const writing = (element: HTMLElement) => { const group = cannonPair(element); if (group && staged.has(group)) group.dataset.cannonPhase = 'write'; };
  const clear = () => {
    entries.clear(); for (const [, value] of highlights) value?.clear();
    for (const group of staged) group.removeAttribute('data-cannon-phase');
    staged.clear();
  };
  const release = (element: HTMLElement) => {
    const group = cannonPair(element);
    if (group) {
      group.removeAttribute('data-cannon-phase'); staged.delete(group);
      for (const part of entries.keys()) if (group.contains(part)) entries.delete(part);
    } else entries.delete(element);
    paint();
  };
  const retain = (elements: HTMLElement[]) => {
    const keep = new Set(elements), groups = new Set(elements.map(cannonPair));
    for (const group of staged) if (!groups.has(group)) { group.removeAttribute('data-cannon-phase'); staged.delete(group); }
    for (const element of entries.keys()) if (!keep.has(element) && !groups.has(cannonPair(element))) entries.delete(element);
    paint();
  };
  return { hold, holdMany, land, deletions, writing, clear, release, retain, dispose() { clear(); for (const [key] of highlights) CSS.highlights?.delete(key); style.remove(); } };
}
