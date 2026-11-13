export const fontSizeLimits = {
  interface: { default: 14, min: 12, max: 20 },
  document: { default: 15, min: 12, max: 32 },
} as const;
export type FontSizeTarget = keyof typeof fontSizeLimits;
export type FontSizes = Record<FontSizeTarget, number>;
export const FONT_SIZES_CHANGED_EVENT = 'mewiki:font-sizes-changed';
export const fontSizesKey = (libraryId: string) => `mewiki:library:${encodeURIComponent(libraryId)}:font-sizes`;
const defaults = (): FontSizes => ({ interface: fontSizeLimits.interface.default, document: fontSizeLimits.document.default });
const memory = new Map<string, FontSizes>();
const unsaved = new Set<string>();
function valid(target: FontSizeTarget, value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= fontSizeLimits[target].min && value <= fontSizeLimits[target].max;
}

export function readFontSizes(libraryId: string, storage?: Pick<Storage, 'getItem'>): FontSizes {
  if (!unsaved.has(libraryId) && storage) {
    try {
      const result = defaults();
      const serialized = storage.getItem(fontSizesKey(libraryId));
      let data: unknown;
      try { data = JSON.parse(serialized ?? 'null'); } catch { /* Invalid JSON uses defaults. */ }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const target of ['interface', 'document'] as const) {
          const value = (data as Record<string, unknown>)[target];
          if (valid(target, value)) result[target] = value;
        }
      }
      memory.set(libraryId, result);
    } catch { /* Keep the current window's preference when browser storage is blocked. */ }
  }
  return { ...(memory.get(libraryId) ?? defaults()) };
}

export function saveFontSize(libraryId: string, target: FontSizeTarget, size: number, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  if (!valid(target, size)) throw new Error('字号无效，请选择允许范围内的整数。');
  const sizes = { ...readFontSizes(libraryId, storage), [target]: size };
  memory.set(libraryId, sizes);
  try {
    if (!storage) throw new Error('storage unavailable');
    storage.setItem(fontSizesKey(libraryId), JSON.stringify(sizes));
    unsaved.delete(libraryId);
  } catch { unsaved.add(libraryId); }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FONT_SIZES_CHANGED_EVENT, { detail: { libraryId } }));
}
