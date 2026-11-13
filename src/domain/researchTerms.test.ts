import { describe, expect, it } from "vitest";
import { createSymbolEntry } from "./researchDictionary.ts";
import {
  createTermEntry,
  dictionaryReferenceId,
  dictionaryReferenceKind,
  dictionaryReferenceMarkdown,
  dictionaryReferenceBindings,
  normalizeTermEntries,
  scanResearchDictionaryText,
  replaceResearchDictionaryText,
  termEntryError,
  type ResearchTermEntry,
  insertResearchTermMention,
  findResearchTermMention,
  searchResearchTerms,
  resolveDictionaryReference,
  addTermEntry,
  deleteTermEntry,
  listTermUses,
  updateTermEntry,
  researchTermAtoms,
  researchTermAliases,
  formatTermReference,
  termReferenceSelection,
  termReferenceMarkdown,
  termReferenceFormats,
} from "./researchTerms.ts";

const term = createTermEntry({
  name: "轨道面",
  aliases: ["轨道平面"],
  meaning: "描述轨道方向的几何平面。",
  tags: ["几何"],
}, "term-orbit-plane");

describe("符号与术语词典", () => {
  it("normalizes terms while preserving stable IDs and filtering duplicate records", () => {
    const values = normalizeTermEntries([
      { ...term, aliases: ["轨道平面", "轨道平面", ""] },
      { ...term, name: "重复版本" },
      { id: "invalid", name: "缺少含义", aliases: [], meaning: 1 },
    ]);
    expect(values).toEqual([expect.objectContaining({
      id: "term-orbit-plane",
      name: "轨道面",
      aliases: ["轨道平面"],
      status: "active",
    })]);
  });

  it("rejects duplicate names and aliases within a term dictionary", () => {
    const duplicate: ResearchTermEntry = { ...term, id: "term-other", name: "另一术语", aliases: ["轨道面"], meaning: "另一个含义" };
    expect(termEntryError(duplicate, [term])).toBe("术语名称或别名已存在");
    expect(termEntryError({ ...term, id: "term-other", name: "  ", meaning: "" }, [term])).toBe("术语名称和含义不能为空");
  });

  it("round-trips stable term and symbol links with readable labels", () => {
    const symbol = createSymbolEntry({ name: "采纳状态", notation: "\\Delta", meaning: "状态变化", category: "state", slots: [] }, "symbol-adoption");
    const termLink = dictionaryReferenceMarkdown("term", term, term.name);
    const symbolLink = dictionaryReferenceMarkdown("symbol", symbol, "$\\Delta$");
    expect(dictionaryReferenceKind(termLink.match(/\(([^)]+)\)/)?.[1])).toBe("term");
    expect(dictionaryReferenceId(termLink.match(/\(([^)]+)\)/)?.[1])).toBe(term.id);
    expect(dictionaryReferenceId(symbolLink.match(/\(([^)]+)\)/)?.[1])).toBe(symbol.id);
    expect(dictionaryReferenceBindings(symbolLink.match(/\(([^)]+)\)/)?.[1])).toEqual({});
  });

  it("finds legacy names in prose but skips code, links, math and URLs", () => {
    const symbol = createSymbolEntry({ name: "采纳状态", notation: "\\Delta", meaning: "状态变化", category: "state", slots: [] }, "symbol-adoption");
    const text = "正文中的轨道平面和采纳状态。`轨道平面` [轨道平面](https://example.com/轨道平面) $轨道平面$ https://example.com/轨道平面";
    const hits = scanResearchDictionaryText(text, [symbol], [term]);
    expect(hits.map(hit => [hit.kind, hit.matchedText])).toEqual([
      ["term", "轨道平面"],
      ["symbol", "采纳状态"],
    ]);
    expect(scanResearchDictionaryText("正文中的轨道面。", [], [term]).map(hit => hit.matchedText)).toEqual(["轨道面"]);
    expect(hits[0]).toMatchObject({ entryId: term.id, context: expect.stringContaining("正文中的") });
    expect(scanResearchDictionaryText("正文中的规范名称轨道面和旧称轨道平面。", [], [term]).map(hit => hit.matchedText)).toEqual(["轨道面", "轨道平面"]);
  });

  it("replaces one scanned legacy hit without changing the surrounding text", () => {
    const hit = scanResearchDictionaryText("前文轨道平面，后文。", [], [term])[0];
    expect(replaceResearchDictionaryText("前文轨道平面，后文。", hit, "[轨道面](mewiki-term:term-orbit-plane)")).toBe("前文[轨道面](mewiki-term:term-orbit-plane)，后文。");
  });

  it("inserts a stable term link and searches names, aliases, meaning and tags", () => {
    const mention = { start: 3, end: 6, query: "轨道" };
    expect(insertResearchTermMention("前文 #轨道 后文", mention, term).text).toBe("前文 [轨道面](mewiki-term:term-orbit-plane) 后文");
    expect(searchResearchTerms([term], "平面 几何")).toEqual([term]);
  });

  it("resolves current dictionary entries from stable links and reports missing entries", () => {
    const symbol = createSymbolEntry({ name: "采纳状态", notation: "\\Delta", meaning: "状态变化", category: "state", slots: [] }, "symbol-adoption");
    expect(resolveDictionaryReference("mewiki-term:term-orbit-plane", [symbol], [term])).toMatchObject({ kind: "term", entry: term });
    expect(resolveDictionaryReference("mewiki-term:removed", [symbol], [term])).toMatchObject({ kind: "term", id: "removed", entry: undefined });
  });

  it("tracks stable term references and keeps them displayable after a rename", () => {
    const state = {
      ...({ version: 8, open: true, view: "notes", activeNoteId: "n", activeSymbolId: "", symbols: [], notes: [] } as const),
      terms: [term],
      notes: [{ id: "n", title: "正文", createdAt: "now", updatedAt: "now", blocks: [{ id: "p", type: "paragraph" as const, text: "参见 [轨道面](mewiki-term:term-orbit-plane)。" }] }],
    } as unknown as import("./researchNotebook.ts").ResearchNotebookState;
    expect(listTermUses(state.notes, term.id)).toEqual([{ noteId: "n", noteTitle: "正文", blockId: "p" }]);
    const renamed = { ...term, name: "轨道几何面" };
    const updated = updateTermEntry(state, renamed);
    expect(updated.terms?.[0].name).toBe("轨道几何面");
    expect(updated.notes[0].blocks[0]).toMatchObject({ text: "参见 [轨道面](mewiki-term:term-orbit-plane)。" });
    expect(deleteTermEntry(updated, term.id)).toBe(updated);
    expect(deleteTermEntry({ ...updated, notes: [] }, term.id).terms).toEqual([]);
    expect(addTermEntry({ ...state, terms: [] }, term)).toMatchObject({ terms: [term] });
  });

  it("normalizes ordered non-overlapping atom definitions and preserves a legacy fallback", () => {
    const composed = createTermEntry({
      name: "ABCDEF",
      aliases: [],
      meaning: "整体含义",
      atoms: [
        { id: "atom-ab", text: "AB", meaning: "第一个原子词汇" },
        { id: "atom-c", text: "C", meaning: "第二个原子词汇" },
        { id: "atom-def", text: "DEF", meaning: "第三个原子词汇" },
      ],
    }, "term-composed");
    expect(composed.atoms).toEqual([
      { id: "atom-ab", text: "AB", meaning: "第一个原子词汇" },
      { id: "atom-c", text: "C", meaning: "第二个原子词汇" },
      { id: "atom-def", text: "DEF", meaning: "第三个原子词汇" },
    ]);
    expect(researchTermAtoms(composed)).toEqual(composed.atoms);
    expect(researchTermAtoms({ ...term, atoms: undefined })).toEqual([
      { id: "term-orbit-plane:atom:0", text: term.name, meaning: term.meaning },
    ]);
  });

  it("rejects atom definitions that do not cover the term name or lack explanations", () => {
    const composed: ResearchTermEntry = {
      id: "term-composed",
      name: "ABCDEF",
      aliases: [],
      meaning: "整体含义",
      atoms: [
        { id: "atom-ab", text: "AB", meaning: "第一个原子词汇" },
        { id: "atom-c", text: "C", meaning: "第二个原子词汇" },
        { id: "atom-ef", text: "EF", meaning: "第三个原子词汇" },
      ],
    };
    expect(termEntryError(composed, [])).toBe("原子词汇必须按术语名称顺序完整覆盖");
    expect(termEntryError({ ...composed, atoms: [{ id: "atom-ab", text: "AB", meaning: "" }, { id: "atom-cdef", text: "CDEF", meaning: "解释" }] }, [])).toBe("原子词汇名称和解释不能为空");
  });
});

describe("术语双语名称与引用形式", () => {
  const bilingual: ResearchTermEntry = { ...term, englishName: "Orbital plane", englishAbbreviation: "OP", chineseAbbreviation: "轨面",
    aliasEntries: [{ id: "alias-plane", name: "轨道平面" }] };

  it("preserves optional bilingual fields and stable alias records while trimming whitespace", () => {
    const entry = createTermEntry({ ...bilingual, englishName: " Orbital plane ", englishAbbreviation: " OP ", chineseAbbreviation: " 轨面 ", aliasEntries: [{ id: "alias-plane", name: " 轨道平面 " }] }, term.id);
    expect(entry).toMatchObject(bilingual);
    expect(normalizeTermEntries([entry])).toEqual([entry]);
    expect(researchTermAliases(term)).toEqual([{ id: `legacy:${encodeURIComponent("轨道平面")}`, name: "轨道平面" }]);
    expect(normalizeTermEntries([term])[0]).not.toHaveProperty("aliasEntries");
  });

  it("formats full references and standalone names, abbreviations and aliases", () => {
    expect(formatTermReference(bilingual)).toBe("轨道面");
    expect(formatTermReference(bilingual, { form: "full" })).toBe("轨道面（Orbital plane, OP）");
    expect(formatTermReference(bilingual, { form: "english" })).toBe("Orbital plane");
    expect(formatTermReference(bilingual, { form: "english-abbreviation" })).toBe("OP");
    expect(formatTermReference(bilingual, { form: "chinese-abbreviation" })).toBe("轨面");
    expect(formatTermReference(bilingual, { form: "alias", aliasId: "alias-plane" })).toBe("轨道平面");
    expect(formatTermReference({ ...bilingual, englishName: undefined }, { form: "full" })).toBe("轨道面（OP）");
    expect(formatTermReference({ ...bilingual, englishAbbreviation: undefined }, { form: "full" })).toBe("轨道面（Orbital plane）");
    for (const form of ["full", "english", "english-abbreviation", "chinese-abbreviation", "alias"] as const)
      expect(formatTermReference(term, { form, aliasId: "removed" })).toBe(term.name);
  });

  it("round trips per-reference choices without changing old term and symbol URLs", () => {
    const text = termReferenceMarkdown(bilingual, { form: "full" });
    expect(text).toBe("[轨道面（Orbital plane, OP）](mewiki-term:term-orbit-plane?display=full)");
    const alias = termReferenceMarkdown(bilingual, { form: "alias", aliasId: "alias-plane" });
    expect(termReferenceSelection(alias.match(/\((mewiki-term:[^)]+)\)/)?.[1])).toEqual({ form: "alias", aliasId: "alias-plane" });
    expect(termReferenceSelection("mewiki-term:term-orbit-plane?display=unexpected&alias=ignored")).toEqual({ form: "name" });
    expect(termReferenceSelection("mewiki-term:term-orbit-plane?display=alias&alias=%00bad")).toEqual({ form: "name" });
    expect(termReferenceSelection("mewiki-term:term-orbit-plane")).toEqual({ form: "name" });
    expect(termReferenceMarkdown(term)).toBe(dictionaryReferenceMarkdown("term", term, term.name));
    expect(insertResearchTermMention("#OP", { start: 0, end: 3, query: "OP" }, bilingual, { form: "english-abbreviation" }).text)
      .toBe("[OP](mewiki-term:term-orbit-plane?display=english-abbreviation)");
  });

  it("selects English aliases individually and follows the same stable alias after a rename", () => {
    const englishAlias = { ...bilingual, aliases: ["Orbit plane"], aliasEntries: [{ id: "alias-english", name: "Orbit plane" }] };
    const selection = { form: "alias" as const, aliasId: "alias-english" };
    expect(termReferenceFormats(englishAlias)).toContainEqual(selection);
    expect(termReferenceMarkdown(englishAlias, selection)).toBe("[Orbit plane](mewiki-term:term-orbit-plane?display=alias&alias=alias-english)");
    expect(formatTermReference({ ...englishAlias, aliases: ["Plane of orbit"], aliasEntries: [{ id: "alias-english", name: "Plane of orbit" }] }, selection)).toBe("Plane of orbit");
  });

  it("keeps alias identity through renaming and reordering and falls back after removal", () => {
    const selection = { form: "alias" as const, aliasId: "alias-plane" };
    const edited = { ...bilingual, aliases: ["轨面旧称", "轨道几何平面"], aliasEntries: [
      { id: "alias-other", name: "轨面旧称" }, { id: "alias-plane", name: "轨道几何平面" },
    ] };
    expect(formatTermReference(edited, selection)).toBe("轨道几何平面");
    expect(formatTermReference({ ...edited, aliases: ["轨面旧称"], aliasEntries: [edited.aliasEntries[0]] }, selection)).toBe(term.name);
    const escaped = termReferenceMarkdown({ ...edited, aliasEntries: [{ id: "alias&(1)/[]", name: "带[括号]的别名" }], aliases: ["带[括号]的别名"] }, { form: "alias", aliasId: "alias&(1)/[]" });
    expect(termReferenceSelection(escaped.match(/\((mewiki-term:[^)]+)\)/)?.[1])).toEqual({ form: "alias", aliasId: "alias&(1)/[]" });
  });

  it("searches bilingual names and abbreviations and scans only whole English labels", () => {
    for (const query of ["orbital", "op", "轨面", "轨道平面"]) expect(searchResearchTerms([bilingual], query)).toEqual([bilingual]);
    const hits = scanResearchDictionaryText("Orbital plane 使用 OP 和轨面，STOP 不应命中。`OP` [OP](https://example.com) $OP$", [], [bilingual]);
    expect(hits.map(hit => hit.matchedText)).toEqual(["Orbital plane", "OP", "轨面"]);
  });
});

describe("井号术语输入", () => {
  it("opens for a single hash and finds the active query at a prose caret", () => {
    for (const text of ["#", "#轨道", "前文#", "前文 #OP", "（#Orbital plane", "标题\n#", "## 标题\n正文#轨道", "已有 $x$ 再输入#轨道", "代码 `#old` 后输入#轨道"]) {
      const start = text.lastIndexOf("#");
      expect(findResearchTermMention(text, text.length)).toEqual({ start, end: text.length, query: text.slice(start + 1) });
    }
    const source = "前文#轨道 后文";
    const mention = findResearchTermMention(source, 5)!;
    expect(mention).toEqual({ start: 2, end: 5, query: "轨道" });
    const result = insertResearchTermMention(source, mention, term);
    expect(result.text).toBe("前文[轨道面](mewiki-term:term-orbit-plane) 后文");
    expect(result.text.slice(result.caret)).toBe(" 后文");
  });

  it("keeps heading markers, escapes, URLs and other trigger queries literal", () => {
    for (const text of ["# ", "# 标题", "##", "##标题", "### 标题", "正文 ##", "\\#轨道", "C#", "ref#OP", "https://example.com/#轨道", "https://example.com/path#OP", "#轨道@笔记", "#轨道$符号", "#轨道￥符号", "@轨道"]) {
      expect(findResearchTermMention(text, text.length), text).toBeNull();
    }
    const heading = "# 标题";
    expect(findResearchTermMention(heading, 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(findResearchTermMention("## 标题", 1)).toBeNull();
  });

  it("ignores completed and unfinished code, math, links and HTML", () => {
    for (const text of ["`#轨道", "`#轨道`", "```text\n#轨道", "~~~\n#轨道", "    #轨道", "$#轨道", "$x + #轨道$", "$$\nx + #轨道", "[说明](#轨道", "[说明 #轨道](target)", "![#轨道](image.png)", "[ref]: #轨道", "<span title=\"#轨道\">", "<span title=\"#轨道"]) {
      const caret = text.includes("#轨道") ? text.indexOf("#轨道") + 3 : text.length;
      expect(findResearchTermMention(text, caret), text).toBeNull();
    }
    const source = "`$literal` 后输入#轨道";
    expect(findResearchTermMention(source, source.length)?.query).toBe("轨道");
  });
});
