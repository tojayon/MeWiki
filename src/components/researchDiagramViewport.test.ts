import { describe, expect, it } from 'vitest';
import { fitDiagramViewport, resizeDiagramViewport, zoomDiagramViewport } from './researchDiagramViewport.ts';

describe('diagram viewing viewport', () => {
  it('fits every edge of a large diagram and centers a small diagram at its original scale', () => {
    expect(fitDiagramViewport({ width: 2000, height: 1000 }, { width: 1040, height: 540 })).toEqual({ x: 20, y: 20, zoom: 0.5 });
    expect(fitDiagramViewport({ width: 200, height: 100 }, { width: 1040, height: 540 })).toEqual({ x: 420, y: 220, zoom: 1 });
  });

  it('keeps the same diagram point under the cursor while zooming far beyond the fitted scale', () => {
    const view = { x: -100, y: 40, zoom: 0.5 }, anchor = { x: 250, y: 100 };
    const enlarged = zoomDiagramViewport(view, 16, anchor);
    expect(enlarged.zoom).toBe(16);
    expect((anchor.x - enlarged.x) / enlarged.zoom).toBe((anchor.x - view.x) / view.zoom);
    expect((anchor.y - enlarged.y) / enlarged.zoom).toBe((anchor.y - view.y) / view.zoom);
  });

  it('preserves the viewed center and zoom when the window changes size', () => {
    expect(resizeDiagramViewport({ x: -900, y: -400, zoom: 2 }, { width: 1000, height: 600 }, { width: 400, height: 800 })).toEqual({ x: -1200, y: -300, zoom: 2 });
  });

  it('handles tiny fitted scales and refuses nonfinite zoom requests', () => {
    const fitted = fitDiagramViewport({ width: 100000, height: 1000 }, { width: 360, height: 700 });
    expect(fitted.zoom).toBeCloseTo(0.0032);
    expect(zoomDiagramViewport(fitted, Infinity, { x: 100, y: 100 })).toBe(fitted);
    expect(zoomDiagramViewport(fitted, 1, { x: 180, y: 350 }).zoom).toBe(1);
  });
});
