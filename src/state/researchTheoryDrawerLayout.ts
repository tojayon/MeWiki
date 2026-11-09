export const THEORY_DRAWERS_STORAGE_KEY = "mewiki:research-theory-drawers";
export const THEORY_DRAWER_BADGE_HEIGHT = 68;
export const THEORY_DRAWER_BADGE_INSET = 12;
export const THEORY_DRAWER_MIN_HEIGHT = THEORY_DRAWER_BADGE_HEIGHT + 2 * THEORY_DRAWER_BADGE_INSET;

export interface TheoryDrawerHeights {
  given: number;
  conclusion: number;
}

export interface TheoryDrawerLayout {
  enabled: boolean;
  given: boolean;
  conclusion: boolean;
  // Fractions of the full content frame, independent of collapsed rows.
  heights: TheoryDrawerHeights;
}

export function loadTheoryDrawerLayout(storage?: Pick<Storage, "getItem">): TheoryDrawerLayout {
  const fallback = { enabled: false, given: true, conclusion: true, heights: { given: 3 / 11, conclusion: 3 / 11 } };
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(THEORY_DRAWERS_STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return fallback;
    const height = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1 ? value : 3 / 11;
    return {
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : fallback.enabled,
      given: typeof saved.given === "boolean" ? saved.given : fallback.given,
      conclusion: typeof saved.conclusion === "boolean" ? saved.conclusion : fallback.conclusion,
      heights: { given: height(saved.heights?.given), conclusion: height(saved.heights?.conclusion) },
    };
  } catch {
    return fallback;
  }
}

export function saveTheoryDrawerLayout(layout: TheoryDrawerLayout, storage?: Pick<Storage, "setItem">) {
  try {
    (storage ?? localStorage).setItem(THEORY_DRAWERS_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // The drawers remain usable when browser storage is unavailable.
  }
}

export function resolveTheoryDrawerHeights(preferred: TheoryDrawerHeights, frameHeight: number) {
  const height = Number.isFinite(frameHeight) ? Math.max(0, frameHeight) : 0;
  // At the minimum, the edge badge has equal space on either vertical side.
  const minimum = THEORY_DRAWER_MIN_HEIGHT;
  const available = Math.max(2 * minimum, height);
  const givenExtra = Math.max(0, preferred.given * height - minimum);
  const conclusionExtra = Math.max(0, preferred.conclusion * height - minimum);
  const extra = givenExtra + conclusionExtra;
  const scale = extra > 0 ? Math.min(1, (available - 2 * minimum) / extra) : 1;
  return { given: minimum + givenExtra * scale, conclusion: minimum + conclusionExtra * scale, minimum, available };
}
