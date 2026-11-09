import { describe, expect, it } from "vitest";
import {
  libraryCacheKey,
  selectLibrary,
  type LibraryCatalog,
} from "./researchLibraryCatalog.ts";
const catalog: LibraryCatalog = {
  libraries: [
    { id: "default", name: "原资料库", directory: null },
    { id: "cislunar", name: "Cislunar", directory: "D:/Cislunar" },
    { id: "personal", name: "个人 Wiki", directory: "D:/Personal" },
  ],
  contextDefaults: { "org.mewiki.webbench": "cislunar" },
};
describe("per-window library selection", () => {
  it("separates the host entry from the independent entry and respects explicit choices", () => {
    expect(selectLibrary(catalog, { context: "org.mewiki.webbench" })).toBe(
      "cislunar",
    );
    expect(
      selectLibrary(catalog, { context: "standalone", remembered: "personal" }),
    ).toBe("personal");
    expect(
      selectLibrary(catalog, {
        context: "org.mewiki.webbench",
        explicit: "personal",
      }),
    ).toBe("personal");
    expect(() =>
      selectLibrary(catalog, { context: "standalone", explicit: "missing" }),
    ).toThrow(/不存在/);
    expect(
      selectLibrary(catalog, { context: "standalone", remembered: "removed" }),
    ).toBe("default");
  });
  it("preserves the old browser key only for the original library", () => {
    expect(libraryCacheKey("default")).toBe("mewiki:research-notebook");
    expect(libraryCacheKey("cislunar")).not.toBe(libraryCacheKey("personal"));
    expect(libraryCacheKey("personal")).not.toBe(libraryCacheKey("default"));
  });
});
