import { describe, expect, it } from "vitest";
import { createSymbolEntry, resolveSymbolEntry, type ResearchSymbolEntry } from "./researchDictionary.ts";
import { findResearchSymbolMention, insertResearchSymbolMention, searchResearchSymbols } from "./researchSymbolMentions.ts";

const entry = createSymbolEntry({ name: "当前采纳样本年龄", notation: "\\Delta^{[x1]}_{[x2]}[x3]", meaning: "月球执行器持有的状态样本年龄", category: "state", tags: ["时序/采纳"], slots: [
  { key: "x1", label: "右上角标", defaultValue: "", domain: "generic", optional: true },
  { key: "x2", label: "右下角标", defaultValue: "", domain: "generic", optional: true },
  { key: "x3", label: "右侧变量", defaultValue: "(t)", domain: "time", optional: true },
] }, "example-function");

describe("正文词典符号输入", () => {
  it("finds a dollar query at a prose caret including the middle of text", () => {
    for (const text of ["$", "年龄$", "年龄 $采纳", "使用 $\\Delta", "已有 $x$，再输入 $年龄"]) expect(findResearchSymbolMention(text, text.length)).toMatchObject({ start: text.lastIndexOf("$"), end: text.length });
    const text = "前文$年龄 后文";
    expect(findResearchSymbolMention(text, 5)).toEqual({ start: 2, end: 5, query: "年龄" });
  });

  it("leaves code, escapes, closing math delimiters and display math alone", () => {
    for (const text of ["\\$", "\\$年龄", "`$年龄", "```tex\n$年龄", "~~~\n$年龄", "$$", "$$x", "$$\nx+$", "$x$", "$x$年龄", "[链接](https://example.com/$年龄", "![图 $年龄](a.png)"]) expect(findResearchSymbolMention(text, text.length)).toBeNull();
    expect(findResearchSymbolMention("代码 `价格 $` 后输入$", "代码 `价格 $` 后输入$".length)).not.toBeNull();
  });

  it("inserts dictionary defaults as one inline formula without losing the suffix", () => {
    const text = "前文$年龄 后文";
    const mention = findResearchSymbolMention(text, 5)!;
    const tex = resolveSymbolEntry(entry, Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
    const result = insertResearchSymbolMention(text, mention, entry);
    expect(result.text).toBe(`前文$${tex}$ 后文`);
    expect(result.text.slice(result.caret)).toBe(" 后文");
    const paired = "前文$年龄$ 后文";
    expect(insertResearchSymbolMention(paired, findResearchSymbolMention(paired, 5)!, entry).text).toBe(result.text);
  });

  it("searches the entire dictionary by name, notation, meaning and tags", () => {
    const symbols = Array.from({ length: 35 }, (_, index): ResearchSymbolEntry => ({ ...entry, id: String(index), name: `其他符号${index}`, notation: "q", meaning: "其他含义", tags: [] })).concat([entry]);
    for (const query of ["采纳", "\\delta", "月球执行器", "时序", "Delta 采纳"]) expect(searchResearchSymbols(symbols, query).map(symbol => symbol.id)).toContain(entry.id);
    expect(searchResearchSymbols(symbols, "不匹配词条")).toEqual([]);
  });
});
