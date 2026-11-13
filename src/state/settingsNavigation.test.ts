import { describe, expect, it } from "vitest";
import { buildSettingsUrl, buildNotebookUrl, readSettingsSection, searchSettings } from "./settingsNavigation.ts";

describe("settings navigation", () => {
  it("keeps the selected library, host identity and content anchor when entering settings", () => {
    const url = new URL(buildSettingsUrl(new URL("http://localhost/?library=personal&workspace=org.mewiki.webbench&embed=1#research-note/demo"), "backup"));
    expect(url.searchParams.get("page")).toBe("settings");
    expect(url.searchParams.get("section")).toBe("backup");
    expect(url.searchParams.get("library")).toBe("personal");
    expect(url.searchParams.get("workspace")).toBe("org.mewiki.webbench");
    expect(url.searchParams.get("embed")).toBe("1");
    expect(url.hash).toBe("#research-note/demo");
  });

  it("returns direct settings links to the same library without leaking settings parameters", () => {
    const url = new URL(buildNotebookUrl(new URL("http://localhost/?page=settings&section=plugins&library=personal&workspace=org.mewiki.webbench")));
    expect(url.searchParams.get("page")).toBe("research-notebook");
    expect(url.searchParams.has("section")).toBe(false);
    expect(url.searchParams.get("library")).toBe("personal");
    expect(url.searchParams.get("workspace")).toBe("org.mewiki.webbench");
  });

  it("handles unknown sections and distinguishes normal notebook routes", () => {
    expect(readSettingsSection(new URL("http://localhost/?page=settings&section=unknown"))).toBe("general");
    expect(readSettingsSection(new URL("http://localhost/?page=settings"))).toBe("general");
    expect(readSettingsSection(new URL("http://localhost/?page=research-notebook"))).toBeNull();
  });
});

describe("settings search", () => {
  const items = [
    { id: "language", section: "general", title: "界面语言", description: "简体中文 English", keywords: "language locale" },
    { id: "export", section: "backup", title: "导出含附件备份", description: "ZIP 备份与恢复", keywords: "export backup" },
  ] as const;

  it("matches Chinese labels, English keywords and multiple search terms", () => {
    expect(searchSettings(items, "附件").map(item => item.id)).toEqual(["export"]);
    expect(searchSettings(items, "  LANGUAGE  English ").map(item => item.id)).toEqual(["language"]);
    expect(searchSettings(items, "zip 附件").map(item => item.id)).toEqual(["export"]);
    expect(searchSettings(items, "missing")).toEqual([]);
    expect(searchSettings(items, " ")).toEqual(items);
  });
});
