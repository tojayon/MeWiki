export interface CannonPoint { x: number; y: number }

/** All positions use the same viewport coordinates, independent of document scroll. */
export function cannonShot(pivot: CannonPoint, target: CannonPoint, muzzleDistance: number) {
  const dx = target.x - pivot.x, dy = target.y - pivot.y, distance = Math.hypot(dx, dy);
  if (![pivot.x, pivot.y, target.x, target.y, muzzleDistance].every(Number.isFinite)
    || muzzleDistance <= 0 || dy >= -8 || distance <= muzzleDistance + 8) return null;
  return { angle: Math.atan2(dx, -dy) * 180 / Math.PI,
    origin: { x: pivot.x + dx / distance * muzzleDistance, y: pivot.y + dy / distance * muzzleDistance } };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const letters = (value: string) => [...graphemes.segment(value)].map(part => part.segment);

/** A laser removes complete original graphemes, including whitespace and long remainders. */
export function cannonEraseSteps(value: string) {
  return [...graphemes.segment(value)].map(({ segment, index }) => ({ start: index, end: index + segment.length }));
}

/** A bounded visual replay of the finished diff, independent of the model stream. */
export function cannonReplayFragments(value: string): string[] {
  return cannonReplaySteps(value).map(step => step.text);
}

/** Offsets refer to the original text, even when the projectile label folds whitespace. */
export function cannonReplaySteps(value: string, from = 0) {
  const parts: { text: string; end: number }[] = [];
  let start = Math.max(0, Math.min(value.length, from)), started = false;
  for (const { segment, index } of graphemes.segment(value)) {
    const end = index + segment.length;
    if (end <= start) continue;
    if (!started) { start = index; started = true; }
    if (/^\s+$/u.test(segment)) {
      if (parts.at(-1)?.text === ' ') parts.at(-1)!.end = end;
      else if (parts.length) parts.push({ text: ' ', end });
    } else parts.push({ text: segment, end });
  }
  if (parts.at(-1)?.text === ' ') parts.pop();
  const count = Math.min(parts.length, 32), size = Math.max(1, Math.ceil(count / 4));
  return Array.from({ length: Math.ceil(count / size) }, (_, i) => {
    const end = Math.min(count, (i + 1) * size), last = end === count;
    return { text: parts.slice(i * size, end).map(part => part.text).join('') + (last && parts.length > count ? '…' : ''),
      start: i ? parts[i * size - 1].end : start, end: last ? value.length : parts[end - 1].end };
  });
}

/** Keep only the already landed prefix shared by the newest streaming revision. */
export function cannonVisiblePrefix(previous: string, current: string) {
  const a = letters(previous), b = letters(current);
  let end = 0;
  while (end < a.length && end < b.length && a[end] === b[end]) end++;
  return b.slice(0, end).join('');
}

/** Read only the changing phrase; the full suggestion continues through the normal review. */
export function cannonFragment(before: string, after: string): string | null {
  if (before === after) return null;
  const a = letters(before), b = letters(after);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const fragment = (b.slice(start, endB).join('') || a.slice(start, endA).join('')).replace(/\s+/g, ' ').trim();
  if (!fragment) return null;
  const parts = letters(fragment);
  return parts.slice(0, 10).join('') + (parts.length > 10 ? '…' : '');
}
