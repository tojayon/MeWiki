export interface AiPanelBounds { left: number; top: number; width: number; height: number }
export interface AiPanelFrame { x: number; y: number; width: number; height: number }
export interface AiLauncherPosition { edge: 'left' | 'right'; ratio: number }
export type AiResizeEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const launcherMargin = 8;
const gap = 12;
const defaultSize = { width: 400, height: 560 };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

export function aiFloatingBounds(element: HTMLElement | null): AiPanelBounds {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  const right = left + (viewport?.width ?? window.innerWidth), bottom = top + (viewport?.height ?? window.innerHeight);
  const dialog = element?.closest('dialog')?.getBoundingClientRect();
  const x = Math.max(left, dialog?.width ? dialog.left : left), y = Math.max(top, dialog?.height ? dialog.top : top);
  return { left: x, top: y, width: Math.max(1, Math.min(right, dialog?.width ? dialog.right : right) - x), height: Math.max(1, Math.min(bottom, dialog?.height ? dialog.bottom : bottom) - y) };
}

export function placeAiLauncher(position: AiLauncherPosition, bounds: AiPanelBounds): AiPanelFrame {
  const width = Math.min(62, Math.max(1, bounds.width));
  const height = Math.min(56, Math.max(1, bounds.height - launcherMargin * 2));
  return { x: position.edge === 'left' ? bounds.left : bounds.left + bounds.width - width,
    y: bounds.top + launcherMargin + Math.max(0, bounds.height - launcherMargin * 2 - height) * position.ratio, width, height };
}

export function snapAiLauncher(point: { x: number; y: number }, bounds: AiPanelBounds): AiLauncherPosition {
  const frame = placeAiLauncher({ edge: 'right', ratio: 0 }, bounds);
  const distance = Math.max(0, bounds.height - launcherMargin * 2 - frame.height);
  return { edge: point.x + frame.width / 2 < bounds.left + bounds.width / 2 ? 'left' : 'right',
    ratio: distance ? clamp((point.y - bounds.top - launcherMargin) / distance, 0, 1) : .5 };
}

export function readAiLauncherPosition(value: unknown): AiLauncherPosition | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  return saved.version === 1 && (saved.edge === 'left' || saved.edge === 'right') && typeof saved.ratio === 'number' && Number.isFinite(saved.ratio) && saved.ratio >= 0 && saved.ratio <= 1
    ? { edge: saved.edge, ratio: saved.ratio } : null;
}

export function clampAiPanelFrame(frame: AiPanelFrame, bounds: AiPanelBounds): AiPanelFrame {
  const availableWidth = Math.max(1, bounds.width), availableHeight = Math.max(1, bounds.height);
  const width = clamp(frame.width, Math.min(320, availableWidth), availableWidth);
  const height = clamp(frame.height, Math.min(320, availableHeight), availableHeight);
  return { x: clamp(frame.x, bounds.left, bounds.left + availableWidth - width),
    y: clamp(frame.y, bounds.top, bounds.top + availableHeight - height), width, height };
}

export function resizeAiPanelFrame(frame: AiPanelFrame, edge: AiResizeEdge, dx: number, dy: number, bounds: AiPanelBounds): AiPanelFrame {
  const base = clampAiPanelFrame(frame, bounds), minWidth = Math.min(320, Math.max(1, bounds.width)), minHeight = Math.min(320, Math.max(1, bounds.height));
  let left = base.x, top = base.y, right = base.x + base.width, bottom = base.y + base.height;
  if (edge.includes('w')) left = clamp(left + dx, bounds.left, right - minWidth);
  if (edge.includes('e')) right = clamp(right + dx, left + minWidth, bounds.left + Math.max(1, bounds.width));
  if (edge.includes('n')) top = clamp(top + dy, bounds.top, bottom - minHeight);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, bounds.top + Math.max(1, bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function placeAiPanelFrame(bounds: AiPanelBounds, size = defaultSize, anchor?: AiPanelBounds): AiPanelFrame {
  const base = clampAiPanelFrame({ x: bounds.left + bounds.width - size.width - 24, y: bounds.top + 64, width: size.width, height: size.height }, bounds);
  if (!anchor) return base;
  const positions = [
    { x: anchor.left + anchor.width + gap, y: anchor.top },
    { x: anchor.left - base.width - gap, y: anchor.top },
    { x: anchor.left, y: anchor.top + anchor.height + gap },
    { x: anchor.left, y: anchor.top - base.height - gap },
  ].map(position => clampAiPanelFrame({ ...base, ...position }, bounds));
  const overlap = (frame: AiPanelFrame) => Math.max(0, Math.min(frame.x + frame.width, anchor.left + anchor.width) - Math.max(frame.x, anchor.left)) *
    Math.max(0, Math.min(frame.y + frame.height, anchor.top + anchor.height) - Math.max(frame.y, anchor.top));
  return positions.reduce((best, frame) => overlap(frame) < overlap(best) ? frame : best);
}

export function readAiPanelFrame(value: unknown): AiPanelFrame | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  if (saved.version !== 1 || !['x', 'y', 'width', 'height'].every(key => typeof saved[key] === 'number' && Number.isFinite(saved[key])) ||
    (saved.width as number) <= 0 || (saved.height as number) <= 0) return null;
  return { x: saved.x as number, y: saved.y as number, width: saved.width as number, height: saved.height as number };
}

export function restoreAiPanelFrame(value: unknown, bounds: AiPanelBounds): AiPanelFrame {
  const frame = readAiPanelFrame(value);
  return frame ? clampAiPanelFrame(frame, bounds) : placeAiPanelFrame(bounds);
}
