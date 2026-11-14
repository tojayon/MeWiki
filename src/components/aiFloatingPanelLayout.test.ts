import { describe, expect, it } from 'vitest';
import { clampAiPanelFrame, placeAiPanelFrame, restoreAiPanelFrame, placeAiLauncher, snapAiLauncher, readAiLauncherPosition, resizeAiPanelFrame, type AiPanelBounds } from './aiFloatingPanelLayout.ts';

const bounds: AiPanelBounds = { left: 0, top: 0, width: 1440, height: 960 };
const overlap = (frame: { x: number; y: number; width: number; height: number }, anchor: AiPanelBounds) =>
  Math.max(0, Math.min(frame.x + frame.width, anchor.left + anchor.width) - Math.max(frame.x, anchor.left)) *
  Math.max(0, Math.min(frame.y + frame.height, anchor.top + anchor.height) - Math.max(frame.y, anchor.top));

describe('AI floating panel layout', () => {
  it('resizes all four edges and corners while anchoring the opposite sides', () => {
    const frame = { x: 400, y: 200, width: 500, height: 500 };
    expect(resizeAiPanelFrame(frame, 'w', -100, 90, bounds)).toEqual({ x: 300, y: 200, width: 600, height: 500 });
    expect(resizeAiPanelFrame(frame, 'n', 60, -80, bounds)).toEqual({ x: 400, y: 120, width: 500, height: 580 });
    expect(resizeAiPanelFrame(frame, 'e', 70, -100, bounds)).toEqual({ x: 400, y: 200, width: 570, height: 500 });
    expect(resizeAiPanelFrame(frame, 's', -100, 60, bounds)).toEqual({ x: 400, y: 200, width: 500, height: 560 });
    for (const edge of ['nw', 'ne', 'sw', 'se'] as const) {
      const next = resizeAiPanelFrame(frame, edge, -40, -30, bounds);
      expect(next.width).toBe(edge.includes('w') ? 540 : 460);
      expect(next.height).toBe(edge.includes('n') ? 530 : 470);
      expect(next.x).toBe(edge.includes('w') ? 360 : 400);
      expect(next.y).toBe(edge.includes('n') ? 170 : 200);
    }
  });
  it('bounds edge resizing without moving the opposite edge at the minimum size', () => {
    const frame = { x: 400, y: 200, width: 500, height: 500 };
    expect(resizeAiPanelFrame(frame, 'nw', 1000, 1000, bounds)).toEqual({ x: 580, y: 380, width: 320, height: 320 });
    expect(resizeAiPanelFrame(frame, 'se', 2000, 2000, bounds)).toEqual({ x: 400, y: 200, width: 1040, height: 760 });
    const small = { left: 20, top: 120, width: 290, height: 210 };
    expect(resizeAiPanelFrame({ x: 28, y: 128, width: 274, height: 194 }, 'nw', -500, -500, small)).toEqual({ x: 20, y: 120, width: 290, height: 210 });
  });
  it('places next to the selection without covering the original text when there is room', () => {
    for (const anchor of [{ left: 350, top: 250, width: 400, height: 40 }, { left: 1000, top: 780, width: 300, height: 45 }]) {
      const frame = placeAiPanelFrame(bounds, { width: 400, height: 560 }, anchor);
      expect(overlap(frame, anchor)).toBe(0);
      expect(Math.min(Math.abs(frame.x - anchor.left - anchor.width), Math.abs(frame.x + frame.width - anchor.left))).toBeLessThanOrEqual(12);
      expect(frame.y).toBeGreaterThanOrEqual(0); expect(frame.y + frame.height).toBeLessThanOrEqual(960);
    }
  });

  it('uses space below or above a wide selection before overlapping it', () => {
    const anchor = { left: 100, top: 200, width: 1100, height: 80 };
    const frame = placeAiPanelFrame(bounds, { width: 400, height: 560 }, anchor);
    expect(overlap(frame, anchor)).toBe(0);
    expect(frame.y).toBe(292);
  });

  it('keeps the entire panel reachable inside a small offset visual viewport', () => {
    const viewport = { left: 15, top: 260, width: 390, height: 230 };
    const frame = clampAiPanelFrame({ x: -300, y: 950, width: 700, height: 800 }, viewport);
    expect(frame).toEqual({ x: 15, y: 260, width: 390, height: 230 });
  });

  it('keeps the full window in view when its desired position reaches the bottom edge', () => {
    const preferred = { x: 500, y: 920, width: 400, height: 560 };
    expect(clampAiPanelFrame(preferred, bounds)).toEqual({ x: 500, y: 400, width: 400, height: 560 });
  });

  it('moves flush to every viewport edge and expands to the exact available area', () => {
    const frame = { x: 400, y: 200, width: 500, height: 500 };
    expect(clampAiPanelFrame({ ...frame, x: -1000, y: -1000 }, bounds)).toEqual({ ...frame, x: 0, y: 0 });
    expect(clampAiPanelFrame({ ...frame, x: 3000, y: 3000 }, bounds)).toEqual({ ...frame, x: 940, y: 460 });
    const topLeft = resizeAiPanelFrame(frame, 'nw', -2000, -2000, bounds);
    expect(topLeft).toEqual({ x: 0, y: 0, width: 900, height: 700 });
    expect(resizeAiPanelFrame(topLeft, 'se', 3000, 3000, bounds)).toEqual({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    expect(restoreAiPanelFrame({ version: 1, x: 0, y: 0, width: bounds.width, height: bounds.height }, bounds)).toEqual({ x: 0, y: 0, width: bounds.width, height: bounds.height });
  });

  it('restores valid per-library preferences and falls back for corrupt or nonfinite data', () => {
    const saved = { version: 1, x: 80, y: 90, width: 460, height: 610 };
    expect(restoreAiPanelFrame(saved, bounds)).toEqual({ x: 80, y: 90, width: 460, height: 610 });
    for (const broken of [null, {}, { ...saved, version: 2 }, { ...saved, x: Infinity }, { ...saved, height: -10 }]) {
      expect(restoreAiPanelFrame(broken, bounds)).toEqual(placeAiPanelFrame(bounds));
    }
  });
});

describe('AI floating launcher layout', () => {
  it('keeps the capsule visible half flush to either edge and restores its vertical position', () => {
    expect(placeAiLauncher({ edge: 'right', ratio: .5 }, bounds)).toEqual({ x: 1378, y: 452, width: 62, height: 56 });
    expect(placeAiLauncher({ edge: 'left', ratio: .5 }, { left: 15, top: 260, width: 390, height: 230 })).toEqual({ x: 15, y: 347, width: 62, height: 56 });
  });

  it('snaps to the nearest horizontal edge without losing a bounded vertical position', () => {
    expect(snapAiLauncher({ x: 180, y: 452 }, bounds)).toEqual({ edge: 'left', ratio: .5 });
    expect(snapAiLauncher({ x: 1000, y: 452 }, bounds)).toEqual({ edge: 'right', ratio: .5 });
    expect(snapAiLauncher({ x: -80, y: 2000 }, bounds)).toEqual({ edge: 'left', ratio: 1 });
  });

  it('rejects corrupt preferences while preserving valid edge identities across viewports', () => {
    expect(readAiLauncherPosition({ version: 1, edge: 'left', ratio: .3 })).toEqual({ edge: 'left', ratio: .3 });
    for (const value of [null, {}, { version: 2, edge: 'left', ratio: .3 }, { version: 1, edge: 'top', ratio: .3 }, { version: 1, edge: 'right', ratio: NaN }, { version: 1, edge: 'left', ratio: 2 }]) {
      expect(readAiLauncherPosition(value)).toBeNull();
    }
  });
});
