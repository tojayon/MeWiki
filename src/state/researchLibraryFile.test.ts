import { createNotebookFixture as createResearchNotebook } from "../domain/testUtils/notebook.ts";
import { describe, expect, it } from "vitest";

import { ensureTheoryMaps } from "../domain/researchTheoryMap.ts";
import {
  createResearchLibraryFile,
  parseResearchLibraryFile,
  researchLibrarySummary,
} from "./researchLibraryFile.ts";

describe("complete research library files", () => {
  it("round trips expanded operators and custom LaTeX atoms without dropping their contents", async () => {
    const notebook = createResearchNotebook();
    const parts = [{ type: "operator", operator: "squareRoot" }, { type: "operator", operator: "nine" }, { type: "operator", operator: "groupClose" }, { type: "latex", tex: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}" }] as const;
    notebook.notes[0].blocks.push({ id: "latex-file-round-trip", type: "formula", tex: "", parts: structuredClone([...parts]) });
    const file = await createResearchLibraryFile(notebook);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook).toEqual(notebook);
    const broken = structuredClone(notebook);
    broken.notes[0].blocks.push({ id: "invalid-latex", type: "formula", tex: "", parts: [{ type: "latex", tex: "\\sqrt{" }] });
    await expect(createResearchLibraryFile(broken)).rejects.toThrow("LaTeX");
  });

  it("round trips both libraries, symbols, custom metadata, formula sources and map views without changing identifiers", async () => {
    const notebook = ensureTheoryMaps(createResearchNotebook());
    notebook.notes[0].frontmatter = { custom: { nested: ["保留", 7] } };
    notebook.theoryMaps!.documents[0].view.layout.viewport = {
      x: 70,
      y: -50,
      zoom: 0.6,
    };
    const file = await createResearchLibraryFile(notebook);
    const parsed = await parseResearchLibraryFile(JSON.stringify(file));
    expect(parsed.notebook).toEqual(notebook);
    expect(parsed.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(researchLibrarySummary(parsed)).toMatchObject({
      foundations: 1,
      notes: notebook.notes.length - 1,
      symbols: notebook.symbols.length,
      maps: notebook.theoryMaps!.documents.length,
    });
  });

  it("rejects changed content, truncated JSON and unsupported file versions", async () => {
    const file = await createResearchLibraryFile(createResearchNotebook());
    file.notebook.notes[0].title = "损坏的数据";
    await expect(
      parseResearchLibraryFile(JSON.stringify(file)),
    ).rejects.toThrow("校验");
    await expect(parseResearchLibraryFile("{")).rejects.toThrow("JSON");
    await expect(
      parseResearchLibraryFile(JSON.stringify({ ...file, version: 9 })),
    ).rejects.toThrow("版本");
  });

  it("preserves symbol tags and dictionary filters in complete library files", async () => {
    const notebook = createResearchNotebook();
    notebook.symbols[0].tags = ["模型/索引", "自用/常查"];
    notebook.symbols[1].tags = [];
    notebook.symbolFilters = { query: "常查", tag: "自用" };
    const file = await createResearchLibraryFile(notebook);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook).toEqual(notebook);
  });

  it("round trips optional term entries and keeps their stable IDs", async () => {
    const notebook = createResearchNotebook();
    notebook.terms = [{ id: "term-orbit", name: "轨道面", aliases: ["轨道平面"], meaning: "几何定义", atoms: [{ id: "atom-orbit", text: "轨道", meaning: "路径" }, { id: "atom-plane", text: "面", meaning: "几何对象" }], status: "active" }];
    const file = await createResearchLibraryFile(notebook);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook.terms).toEqual(notebook.terms);
    expect(researchLibrarySummary(restored)).toMatchObject({ terms: 1 });
    const malformed = structuredClone(notebook);
    (malformed.terms![0].atoms![0] as unknown as { meaning: number }).meaning = 7;
    await expect(createResearchLibraryFile(malformed)).rejects.toThrow("格式");
  });

  it("round trips bilingual term names, alias identities and reference display choices", async () => {
    const notebook = createResearchNotebook();
    notebook.terms = [{ id: "term-bilingual", name: "均方误差", englishName: "Mean squared error", englishAbbreviation: "MSE", chineseAbbreviation: "均误",
      aliases: ["平方误差均值"], aliasEntries: [{ id: "alias-mse", name: "平方误差均值" }], meaning: "误差平方的均值。", status: "active" }];
    notebook.notes[0].blocks.push({ id: "bilingual-link", type: "paragraph", text: "[均方误差](mewiki-term:term-bilingual?display=full) 和 [MSE](mewiki-term:term-bilingual?display=english-abbreviation)" });
    const file = await createResearchLibraryFile(notebook);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook.terms).toEqual(notebook.terms);
    expect(restored.notebook.notes[0].blocks.at(-1)).toEqual(notebook.notes[0].blocks.at(-1));
    const malformed = structuredClone(notebook);
    (malformed.terms![0] as unknown as { englishAbbreviation: number }).englishAbbreviation = 1;
    await expect(createResearchLibraryFile(malformed)).rejects.toThrow("格式");
  });

  it("rejects inconsistent or repeated alias identities instead of dropping aliases on import", async () => {
    const notebook = createResearchNotebook();
    notebook.terms = [{ id: "term-aliases", name: "术语", aliases: ["别名一", "别名二"], aliasEntries: [
      { id: "alias-1", name: "别名一" }, { id: "alias-2", name: "别名二" },
    ], meaning: "定义" }];
    for (const records of [[], [{ id: "alias-1", name: "别名一" }, { id: "alias-1", name: "别名二" }],
      [{ id: "alias-1", name: "错位别名" }, { id: "alias-2", name: "别名二" }]]) {
      const invalid = structuredClone(notebook);
      invalid.terms![0].aliasEntries = records;
      await expect(createResearchLibraryFile(invalid)).rejects.toThrow(/重复标识|格式/);
    }
    delete notebook.terms[0].aliasEntries;
    await expect(createResearchLibraryFile(notebook)).resolves.toBeDefined();
  });

  it("round trips all position descriptions and drops retired filters from older library files", async () => {
    const notebook = createResearchNotebook();
    notebook.symbols[0].meaning = "本体说明 $h$。";
    notebook.symbols[0].slots = notebook.symbols[0].slots.map((slot, index) => ({ ...slot, description: `位置 ${index + 1} 的说明。\n可留空值。`, defaultValue: "" }));
    notebook.symbolFilters = { query: "常查", tag: "模型" };
    const legacy = { ...notebook, symbolFilters: { ...notebook.symbolFilters, category: "index" } };
    const file = await createResearchLibraryFile(legacy);
    const restored = await parseResearchLibraryFile(JSON.stringify(file));
    expect(restored.notebook.symbolFilters).toEqual(notebook.symbolFilters);
    expect(restored.notebook.symbols).toEqual(notebook.symbols);
    expect(await parseResearchLibraryFile(JSON.stringify(restored))).toEqual(restored);
    const malformed = structuredClone(notebook);
    (malformed.symbols[0].slots[0] as unknown as { description: number }).description = 7;
    await expect(createResearchLibraryFile(malformed)).rejects.toThrow("格式");
  });

  it("adds initial tags to older local files without restoring cleared tags, symbols or other deleted content", async () => {
    const notebook = createResearchNotebook();
    notebook.symbols = notebook.symbols.slice(0, 3).map(({ tags: _tags, ...entry }) => entry);
    notebook.symbols[1].tags = [];
    notebook.notes = [];
    const original = await createResearchLibraryFile(notebook);
    const restored = await parseResearchLibraryFile(JSON.stringify(original));
    expect(restored.notebook.symbols[0].tags).toEqual([]);
    expect(restored.notebook.symbols[1].tags).toEqual([]);
    expect(restored.notebook.symbols).toHaveLength(3);
    expect(restored.notebook.notes).toEqual([]);
    expect(restored.revision).toBe(original.revision);
    expect(restored.savedAt).toBe(original.savedAt);
    expect(restored.notebook.symbols[0]).toEqual({ ...notebook.symbols[0], tags: [] });
    expect(await parseResearchLibraryFile(JSON.stringify(restored))).toEqual(restored);
  });

  it("rejects incomplete or duplicate data before writing a recoverable-looking backup", async () => {
    const original = createResearchNotebook();
    const broken = { ...original, symbols: null };
    await expect(createResearchLibraryFile(broken as never)).rejects.toThrow(
      "格式",
    );
    await expect(
      createResearchLibraryFile({
        ...original,
        notes: [...original.notes, original.notes[0]],
      }),
    ).rejects.toThrow("重复");
    const missing = structuredClone(original);
    missing.notes[0].blocks = [{ id: "x", type: "formula" } as never];
    await expect(createResearchLibraryFile(missing)).rejects.toThrow("格式");
  });

  it("accepts a deliberately emptied library without restoring deleted notes", async () => {
    const notebook = {
      ...createResearchNotebook(),
      notes: [],
      symbols: [],
      activeNoteId: "",
      activeSymbolId: "",
    };
    const file = await createResearchLibraryFile(notebook);
    expect(
      (await parseResearchLibraryFile(JSON.stringify(file))).notebook.notes,
    ).toEqual([]);
  });
  it("opens the independently preserved browser migration snapshot through the same restore entry", async () => {
    const snapshot = await createResearchLibraryFile(createResearchNotebook());
    const content = JSON.stringify({
      format: "webbench-browser-migration",
      version: 1,
      browser: { current: "原始内容" },
      snapshot,
    });
    expect((await parseResearchLibraryFile(content)).notebook).toEqual(
      snapshot.notebook,
    );
  });
});
