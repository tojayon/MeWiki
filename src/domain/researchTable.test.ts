import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { renderToString } from "katex";
import type { Root } from "mdast";
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, parseResearchTable, parseTableClipboard, pasteTableCells, remarkTableCellBreaks, serializeResearchTable, setTableAlignment, setTableCell } from "./researchTable.ts";

const source = "| **项目** | 值 |\n| :--- | ---: |\n| x \\| y | $x_1$ |\n| `a\\|b` | 2 |";
const table = () => parseResearchTable(source)!;

describe("Markdown table cell editing", () => {
  it("uses parsed cell boundaries to preserve formatting, escaped pipes, inline code and math", () => {
    expect(table().rows).toEqual([["**项目**", "值"], ["x | y", "$x_1$"], ["`a\\|b`", "2"]]);
    expect(table().align).toEqual(["left", "right"]);
    expect(parseResearchTable(serializeResearchTable(table()))!.rows).toEqual(table().rows);
  });

  it("keeps surrounding Markdown and reference definitions when one cell changes", () => {
    const text = "前文。\n\n| 文献 | 内容 |\n| --- | --- |\n| [论文][p] | **原文** |\n\n[p]: https://example.com/paper\n\n后文。";
    const changed = serializeResearchTable(setTableCell(parseResearchTable(text)!, 1, 1, "新内容"));
    expect(changed).toContain("前文。\n\n| 文献");
    expect(changed).toContain("[论文][p]");
    expect(changed).toContain("\n\n[p]: https://example.com/paper\n\n后文。");
    expect(parseResearchTable(changed)!.rows[1]).toEqual(["[论文][p]", "新内容"]);
  });

  it("does not mistake code, plain text or ambiguous multiple tables for one editable table", () => {
    expect(parseResearchTable("`a|b`\n\n普通文字")).toBeNull();
    expect(parseResearchTable("```md\n" + source + "\n```")).toBeNull();
    expect(parseResearchTable(source + "\n\n正文\n\n" + source)).toBeNull();
  });

  it("leaves unchanged cells alone and escapes new literal pipes without doubling existing backslashes", () => {
    const initial = table();
    expect(setTableCell(initial, 1, 0, "x | y")).toBe(initial);
    const changed = serializeResearchTable(setTableCell(initial, 1, 0, "a | b \\alpha"));
    expect(changed).toContain("a \\| b \\alpha");
    expect(parseResearchTable(changed)!.rows[1][0]).toBe("a | b \\alpha");
  });

  it("represents cell line breaks without splitting Markdown rows or changing inline code", () => {
    const initial = parseResearchTable("| 项目 |\n| --- |\n| 第一行<br>第二行 `a<br>b` |")!;
    expect(initial.rows[1][0]).toBe("第一行\n第二行 `a<br>b`");
    const text = serializeResearchTable(setTableCell(initial, 1, 0, "一\n二"));
    expect(text).toContain("| 一<br>二 |");
    expect(parseResearchTable(text)!.rows[1][0]).toBe("一\n二");
  });

  it("inserts and deletes body rows while protecting the header", () => {
    const added = insertTableRow(table(), 1);
    expect(added.rows[1]).toEqual(["", ""]);
    expect(deleteTableRow(added, 1).rows).toEqual(table().rows);
    expect(deleteTableRow(added, 0)).toBe(added);
    const headerOnly = deleteTableRow(deleteTableRow(table(), 2), 1);
    expect(parseResearchTable(serializeResearchTable(headerOnly))!.rows).toEqual([["**项目**", "值"]]);
  });

  it("keeps column alignment and all rows together, and retains at least one column", () => {
    const added = insertTableColumn(table(), 1);
    expect(added.rows[0]).toEqual(["**项目**", "", "值"]);
    expect(added.align).toEqual(["left", null, "right"]);
    expect(deleteTableColumn(added, 1).rows).toEqual(table().rows);
    const one = deleteTableColumn(table(), 1);
    expect(deleteTableColumn(one, 0)).toBe(one);
    expect(parseResearchTable(serializeResearchTable(setTableAlignment(one, 0, "center")))!.align).toEqual(["center"]);
  });

  it("reads tabular clipboard text including CRLF, quoted newlines, embedded tabs and escaped quotes", () => {
    expect(parseTableClipboard('名称\t数值\r\n"两\n行"\t"a\tb"\r\n"引号""值"\t3\r\n'))
      .toEqual([["名称", "数值"], ["两\n行", "a\tb"], ['引号"值', "3"]]);
    expect(parseTableClipboard("一\n二\n")).toEqual([["一"], ["二"]]);
    expect(parseTableClipboard("a\t\n\t")).toEqual([["a", ""], ["", ""]]);
  });

  it("expands pasted rows and columns without overwriting unrelated cells or alignment", () => {
    const pasted = pasteTableCells(table(), 2, 1, [["3", "4"], ["5", "6"]]);
    expect(pasted.rows).toEqual([["**项目**", "值", ""], ["x | y", "$x_1$", ""], ["`a\\|b`", "3", "4"], ["", "5", "6"]]);
    expect(pasted.align).toEqual(["left", "right", null]);
    expect(parseResearchTable(serializeResearchTable(pasted))!.rows).toEqual(pasted.rows);
  });

  it("preserves extra source cells that a standard Markdown viewer does not display", () => {
    const initial = parseResearchTable("| 名称 |\n| --- |\n| A | 隐藏值 |")!;
    expect(serializeResearchTable(setTableCell(initial, 1, 0, "B"))).toContain("| B | 隐藏值 |");
  });

  it("preserves mathematical norm delimiters and odd backslash escapes without splitting columns", () => {
    const norm = String.raw`$\|x\|$`;
    const updated = serializeResearchTable(setTableCell(table(), 1, 0, norm));
    const restored = parseResearchTable(updated)!;
    expect(restored.rows[1]).toEqual([norm, "$x_1$"]);
    expect(restored.align).toHaveLength(2);
    const escaped = String.raw`a \\| b`;
    const result = parseResearchTable(serializeResearchTable(setTableCell(table(), 1, 0, escaped)))!;
    expect(result.rows[1][0]).toBe(escaped);
    expect(result.rows[1]).toHaveLength(2);
  });

  it("writes new absolute-value pipes as explicit TeX delimiters instead of changing them to norms", () => {
    const updated = serializeResearchTable(setTableCell(table(), 1, 0, "$|x|$"));
    expect(parseResearchTable(updated)!.rows[1][0]).toBe(String.raw`$\vert{}x\vert{}$`);
    expect(parseResearchTable(updated)!.rows[1]).toHaveLength(2);
  });

  it("keeps pipes inside TeX text groups as text and retains a backslash immediately before a cell break", () => {
    const updated = serializeResearchTable(setTableCell(table(), 1, 0, String.raw`$\text{A|B}+|x|$`));
    expect(parseResearchTable(updated)!.rows[1][0]).toBe(String.raw`$\text{A\textbar{}B}+\vert{}x\vert{}$`);
    for (const count of [1, 2, 3]) {
      const value = "path" + "\\".repeat(count) + "\nnext";
      expect(parseResearchTable(serializeResearchTable(setTableCell(table(), 1, 0, value)))!.rows[1][0]).toBe(value);
    }
  });

  it("preserves array column separators without turning them into math delimiters or splitting table columns", () => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkTableCellBreaks);
    for (const environment of ["array", "darray"]) {
      const tex = String.raw`\begin{${environment}}{|c||c|}\|a\| & b \\ c & d\end{${environment}}`;
      const updated = serializeResearchTable(setTableCell(table(), 1, 0, `$${tex}$`));
      const restored = parseResearchTable(updated)!;
      expect(restored.rows[1]).toEqual([`$${tex}$`, "$x_1$"]);
      const tree = processor.runSync(processor.parse(updated)) as Root;
      const node = tree.children[0];
      if (node.type !== "table") throw new Error("Expected a table");
      const math = node.children[1].children[0].children[0];
      if (math.type !== "inlineMath") throw new Error("Expected inline math");
      expect(math.value).toBe(tex);
      expect(math.data?.hChildren?.[0]).toMatchObject({ type: "text", value: tex });
      expect(renderToString(math.value, { throwOnError: true, output: "html" })).toBe(renderToString(tex, { throwOnError: true, output: "html" }));
      expect(parseResearchTable(serializeResearchTable(restored))!.rows).toEqual(restored.rows);
    }
  });

  it("normalizes multiline inline math and code as whitespace while keeping ordinary cell line breaks", () => {
    const aligned = "$\\begin{aligned}a&=b\\\\\nc&=d\\end{aligned}$";
    for (const input of ["$x+\ny$", aligned, "`a\nb`", "`a\\\nb`"]) {
      const updated = serializeResearchTable(setTableCell(table(), 1, 0, input + "\n第二行"));
      expect(updated).not.toContain("<br>y$");
      expect(parseResearchTable(updated)!.rows[1][0]).toBe(input.replace(/\n/g, " ") + "\n第二行");
    }
  });
});
