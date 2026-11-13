import { describe, expect, it } from "vitest";
import {
  libraryCacheKey,
  libraryEntryChoices,
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
  it("uses explicit defaults for any host without guessing a library from its name", () => {
    const unconfigured = { ...catalog, contextDefaults: {} };
    expect(selectLibrary(unconfigured, { context: "org.mewiki.webbench" })).toBe("default");
    expect(selectLibrary(unconfigured, { context: "org.example.instrument" })).toBe("default");
    expect(selectLibrary({ ...catalog, contextDefaults: { "org.example.instrument": "personal" } }, {
      context: "org.example.instrument",
    })).toBe("personal");
  });
  it("keeps explicit, remembered and configured choices in order for multiple entries", () => {
    const multiple = { ...catalog, contextDefaults: {
      "org.mewiki.webbench": "cislunar", "org.example.instrument": "personal",
    } };
    expect(selectLibrary(multiple, { context: "org.example.instrument", explicit: "cislunar", remembered: "personal" })).toBe("cislunar");
    expect(selectLibrary(multiple, { context: "org.example.instrument", remembered: "default" })).toBe("default");
    expect(selectLibrary(multiple, { context: "org.example.instrument", remembered: "removed" })).toBe("personal");
    expect(selectLibrary(multiple, { context: "org.example.unconfigured" })).toBe("default");
  });
});

describe("library entry choices", () => {
  it("collects declared, connected and saved entries without enabling plugins", () => {
    expect(typeof libraryEntryChoices).toBe("function");
    expect(libraryEntryChoices({
      plugins: [
        { id: "org.example.instrument", workspace: { name: "测量工具" } },
        { id: "org.example.exporter" },
      ],
      connection: { id: "org.example.viewer", name: "资料查看器" },
      contextDefaults: { "org.example.archived": "personal", "standalone": "default" },
      context: "org.example.current",
    })).toEqual([
      { id: "org.example.instrument", name: "测量工具" },
      { id: "org.example.viewer", name: "资料查看器" },
      { id: "org.example.archived", name: "org.example.archived" },
      { id: "org.example.current", name: "org.example.current" },
    ]);
  });
  it("deduplicates identities and prefers the plugin workspace name", () => {
    expect(typeof libraryEntryChoices).toBe("function");
    expect(libraryEntryChoices({
      plugins: [{ id: "org.example.instrument", workspace: { name: "测量工具" } }],
      connection: { id: "org.example.instrument", name: "当前程序" },
      contextDefaults: { "org.example.instrument": "personal" },
      context: "org.example.instrument",
    })).toEqual([{ id: "org.example.instrument", name: "测量工具" }]);
  });
  it("has no invented entry when the independent app has no integration", () => {
    expect(typeof libraryEntryChoices).toBe("function");
    expect(libraryEntryChoices({ plugins: [], connection: null, contextDefaults: {}, context: "standalone" })).toEqual([]);
  });
});
