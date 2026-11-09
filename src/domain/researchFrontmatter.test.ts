import { createNotebookFixture as createResearchNotebook } from "./testUtils/notebook.ts";
import { describe, expect, it } from "vitest";
import { createResearchNote, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown } from "./researchNotebook.ts";
import { applyResearchNoteMetadata, getResearchNoteMetadata, parseMetadataYaml } from "./researchFrontmatter.ts";
import { defaultResearchNoteFilters, filterResearchNotes } from "./researchNoteOrganization.ts";

const source = [
  "---", 'title: "LQR 控制器"', "createdAt: 2026-11-01T10:00:00+08:00", "updatedAt: 2026-11-05T12:00:00+08:00",
  "tags:", "  - 模型/控制/LQR", "reviewStatus: reviewed", "reviewedAt: 2026-11-05T02:00:00Z", 'author: "研究者"',
  "aliases: [最优调节器, 状态反馈]", "parameters:", "  horizon: 15", "  enabled: true", "  reference: null", "description: |", "  第一行说明。", "  第二行说明。", "---", "",
  "# LQR 控制器", "", "正文 $J$。",
].join("\n");

describe("research note Frontmatter", () => {
  it("imports YAML metadata and keeps it out of the rendered note body", () => {
    const note = parseResearchMarkdown(source, "文件名称");
    expect(note).toMatchObject({ title: "LQR 控制器", createdAt: "2026-11-01T10:00:00+08:00", updatedAt: "2026-11-05T12:00:00+08:00", tags: ["模型/控制/LQR"], reviewStatus: "reviewed", frontmatter: { author: "研究者", aliases: ["最优调节器", "状态反馈"], parameters: { horizon: 15, enabled: true, reference: null }, description: "第一行说明。\n第二行说明。\n" } });
    expect(note.blocks).toEqual([{ id: expect.any(String), type: "paragraph", text: "正文 $J$。" }]);
    const imported = parseResearchMarkdown("\uFEFF" + source.replaceAll("\n", "\r\n"));
    expect(getResearchNoteMetadata(imported)).toEqual(getResearchNoteMetadata(note));
  });

  it("exports standard YAML and restores metadata, dates, custom structures and content", () => {
    const note = parseResearchMarkdown(source);
    const markdown = serializeResearchMarkdown(note);
    expect(markdown).toMatch(/^---\n/);
    expect(markdown).not.toContain("<!-- webbench-note:");
    const imported = parseResearchMarkdown(markdown, "不同文件名");
    expect(getResearchNoteMetadata(imported)).toEqual(getResearchNoteMetadata(note));
    expect(imported.id).not.toBe(note.id);
    expect(imported.blocks).toEqual(note.blocks.map((block) => ({ ...block, id: expect.any(String) })));
    const state = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
    expect(normalizeResearchNotebook(JSON.parse(JSON.stringify(state))).notes[0].frontmatter).toEqual(note.frontmatter);
    expect(filterResearchNotes([note], { ...defaultResearchNoteFilters, query: "最优调节器" })).toEqual([note]);
  });

  it("synchronizes title, tags and review fields while preserving block and note identity", () => {
    const note = parseResearchMarkdown(source);
    const initial = { ...createResearchNotebook(), notes: [note], activeNoteId: note.id };
    const metadata = getResearchNoteMetadata(note);
    const now = "2026-11-05T06:00:00.000Z";
    expect(applyResearchNoteMetadata(initial, note.id, metadata, now)).toBe(initial);
    const changed = applyResearchNoteMetadata(initial, note.id, { ...metadata, title: "有限时域 LQR", tags: [" 模型 / 控制 / LQR ", "论文/第三章"], author: "甲" }, now);
    expect(changed.notes[0]).toMatchObject({ id: note.id, title: "有限时域 LQR", tags: ["模型/控制/LQR", "论文/第三章"], reviewStatus: "pending", updatedAt: now, frontmatter: { author: "甲" } });
    expect(changed.notes[0].blocks).toBe(note.blocks);
    expect(changed.notes[0].createdAt).toBe(note.createdAt);
    expect(changed.notes[0].reviewedAt).toBe(note.reviewedAt);
    const customOnly = applyResearchNoteMetadata(initial, note.id, { ...metadata, author: "乙" }, now);
    expect(customOnly.notes[0]).toMatchObject({ reviewStatus: "reviewed", updatedAt: now });
    expect(applyResearchNoteMetadata(initial, "missing", metadata)).toBe(initial);
  });

  it("supports removing custom properties and marking review completion through metadata", () => {
    const note = { ...createResearchNote("笔记"), id: "metadata-note", frontmatter: { author: "研究者", weight: 1 } };
    const initial = { ...createResearchNotebook(), notes: [note] };
    const metadata = getResearchNoteMetadata(note);
    delete metadata.weight;
    const now = "2026-11-05T07:30:00.000Z";
    const changed = applyResearchNoteMetadata(initial, note.id, { ...metadata, reviewStatus: "reviewed" }, now);
    expect(changed.notes[0]).toMatchObject({ frontmatter: { author: "研究者" }, reviewStatus: "reviewed", reviewedAt: now });
    expect(changed.notes[0].frontmatter).not.toHaveProperty("weight");
  });

  it("rejects invalid YAML and metadata before replacing existing content", () => {
    for (const yaml of ["title: [", "author: one\nauthor: two", "- not-a-mapping", "x: &x [*x]", "__proto__: { polluted: true }"]) expect(() => parseMetadataYaml(yaml)).toThrow();
    for (const yaml of ["tags: { nested: no }", "reviewStatus: approved", "createdAt: invalid-date", "blocks: []", "id: spoofed", "title: 12"]) expect(() => parseResearchMarkdown("---\n" + yaml + "\n---\n\n正文")).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps ordinary Markdown dividers, fences and non-frontmatter prose intact", () => {
    const markdown = "正文\n\n---\n\n```yaml\n---\ntitle: 代码\n---\n```";
    const note = parseResearchMarkdown(markdown, "普通笔记");
    expect(note.title).toBe("普通笔记");
    expect(note.blocks.map((block) => block.type)).toEqual(["paragraph", "markdown", "markdown"]);
    expect(note.frontmatter ?? {}).toEqual({});
    const imported = parseResearchMarkdown("---\n{}\n...\n\n正文");
    expect(imported.blocks).toHaveLength(1);
    for (const source of ["---\n---\n\n正文", "---\n...\n\n正文"]) {
      expect(parseResearchMarkdown(source).blocks).toEqual([{ id: expect.any(String), type: "paragraph", text: "正文" }]);
    }
  });
});
