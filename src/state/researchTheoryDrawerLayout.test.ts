import { describe, expect, it } from "vitest";
import {
  loadTheoryDrawerLayout,
  resolveTheoryDrawerHeights,
  saveTheoryDrawerLayout,
  THEORY_DRAWERS_STORAGE_KEY,
} from "./researchTheoryDrawerLayout.ts";

describe("theory drawer layout preferences", () => {
  it("restores independent visibility and height preferences", () => {
    let saved = "";
    const storage = {
      getItem: (key: string) => key === THEORY_DRAWERS_STORAGE_KEY ? saved : null,
      setItem: (_key: string, value: string) => { saved = value; },
    };
    const preferences = { enabled: true, given: false, conclusion: true, heights: { given: 0.2, conclusion: 0.35 } };
    saveTheoryDrawerLayout(preferences, storage);
    expect(loadTheoryDrawerLayout(storage)).toEqual(preferences);
  });

  it("keeps valid settings while rejecting malformed heights and visibility", () => {
    const storage = { getItem: () => JSON.stringify({ enabled: true, given: "false", conclusion: false, heights: { given: -1, conclusion: 0.3 } }) };
    expect(loadTheoryDrawerLayout(storage)).toEqual({ enabled: true, given: true, conclusion: false, heights: { given: 3 / 11, conclusion: 0.3 } });
    expect(loadTheoryDrawerLayout({ getItem: () => "{broken" }).enabled).toBe(false);
    expect(loadTheoryDrawerLayout({ getItem: () => "null" }).heights).toEqual({ given: 3 / 11, conclusion: 3 / 11 });
    const unavailable = {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
    };
    const fallback = loadTheoryDrawerLayout(unavailable);
    expect(() => saveTheoryDrawerLayout(fallback, unavailable)).not.toThrow();
  });

  it("preserves requested heights when they leave room for the derivation", () => {
    const sizes = resolveTheoryDrawerHeights({ given: 0.2, conclusion: 0.3 }, 720);
    expect(sizes.given).toBe(144);
    expect(sizes.conclusion).toBe(216);
    expect(sizes.minimum).toBe(92);
    expect(sizes.available).toBe(720);
    const previouslySmall = resolveTheoryDrawerHeights({ given: 0.01, conclusion: 0.02 }, 720);
    expect(previouslySmall.given).toBe(92);
    expect(previouslySmall.conclusion).toBe(92);
  });

  it("fits a shorter viewport without overwriting the saved preferences", () => {
    const preferred = { given: 0.5, conclusion: 0.3 };
    for (const height of [800, 400, 240]) {
      const sizes = resolveTheoryDrawerHeights(preferred, height);
      expect(sizes.given).toBeGreaterThanOrEqual(sizes.minimum);
      expect(sizes.conclusion).toBeGreaterThanOrEqual(sizes.minimum);
      expect(sizes.given + sizes.conclusion).toBeLessThanOrEqual(sizes.available + 0.001);
      expect(sizes.minimum).toBe(92);
      expect(height - sizes.given - sizes.conclusion).toBeGreaterThanOrEqual(-0.001);
    }
    expect(preferred).toEqual({ given: 0.5, conclusion: 0.3 });
    expect(resolveTheoryDrawerHeights(preferred, 1000).given).toBe(500);
  });

  it("lets both drawers fill the frame and keeps their saved proportions", () => {
    const sizes = resolveTheoryDrawerHeights({ given: 0.7, conclusion: 0.3 }, 800);
    expect(sizes.given).toBeCloseTo(560);
    expect(sizes.conclusion).toBeCloseTo(240);
    expect(sizes.given + sizes.conclusion).toBeCloseTo(800);
    const smaller = resolveTheoryDrawerHeights({ given: 0.7, conclusion: 0.3 }, 240);
    expect(smaller.conclusion).toBe(92);
    expect(smaller.given + smaller.conclusion).toBeCloseTo(240);
  });
});
