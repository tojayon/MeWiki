import { describe, expect, it } from "vitest";
import { researchSidebarWidths } from "./researchSidebarLayout.ts";

describe("article sidebar width allocation", () => {
  it("distributes two wide preferences in one calculation and reserves article space", () => {
    expect(researchSidebarWidths(1000, 520, 520, true, true)).toEqual({ left: 320, right: 320 });
    expect(researchSidebarWidths(1100, 520, 300, true, true)).toEqual({ left: 451, right: 289 });
  });
  it("restores preferred widths when space is available or a panel closes", () => {
    expect(researchSidebarWidths(1800, 520, 520, true, true)).toEqual({ left: 520, right: 520 });
    expect(researchSidebarWidths(1000, 520, 520, true, false).left).toBe(520);
    expect(researchSidebarWidths(1000, 520, 520, false, true).right).toBe(520);
  });
  it("keeps the right overlay out of the narrow article width budget", () => {
    expect(researchSidebarWidths(972, 520, 300, true, true)).toEqual({ left: 520, right: 300 });
    expect(researchSidebarWidths(390, 520, 300, true, true)).toEqual({ left: 195, right: 300 });
  });
});
