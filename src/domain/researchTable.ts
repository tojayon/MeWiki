import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root, PhrasingContent, TableCell } from "mdast";

export type TableAlignment = "left" | "center" | "right" | null;
export interface ResearchTable {
  rows: string[][];
  align: TableAlignment[];
  before: string;
  after: string;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const cellBreak = /^<br\s*\/?>$/i;

/** GFM needs escaped pipes, but an array preamble needs the literal separator. */
function decodeTableMath(source: string): string {
  return source.replace(/(\\begin\s*\{d?array\}\s*\{)([^{}]*)(\})/g,
    (_, begin: string, columns: string, end: string) => begin + columns.replace(/\\\|/g, "|") + end);
}

function cellSource(source: string, cell: TableCell): string {
  const start = cell.children[0]?.position?.start.offset;
  const end = cell.children.at(-1)?.position?.end.offset;
  if (start === undefined || end === undefined) return "";
  let text = source.slice(start, end);
  const edits: { start: number; end: number; value: string }[] = [];
  const protectedRanges: { start: number; end: number }[] = [];
  const collect = (children: PhrasingContent[]) => children.forEach(child => {
    const first = child.position?.start.offset, last = child.position?.end.offset;
    if (first !== undefined && last !== undefined && (child.type === "inlineMath" || child.type === "inlineCode")) {
      protectedRanges.push({ start: first - start, end: last - start });
      if (child.type === "inlineMath") edits.push({ start: first - start, end: last - start, value: decodeTableMath(source.slice(first, last)) });
    }
    else if (child.type === "html" && cellBreak.test(child.value) && first !== undefined && last !== undefined) {
      let before = first;
      while (before > start && source[before - 1] === "\\") before--;
      edits.push({ start: before - start, end: last - start, value: "\\".repeat((first - before) / 2) + "\n" });
    }
    else if ("children" in child) collect(child.children as PhrasingContent[]);
  });
  collect(cell.children);
  for (const match of text.matchAll(/\\\|/g)) {
    if (!protectedRanges.some(range => match.index >= range.start && match.index < range.end)) edits.push({ start: match.index, end: match.index + 2, value: "|" });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  return text;
}

/** A literal math pipe must not acquire the different TeX meaning of \| (a norm). */
function safeMathPipes(source: string): string {
  let text = "", pendingText = false;
  const groups: boolean[] = [];
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      const command = /^[A-Za-z]+|[^]/.exec(source.slice(index + 1))?.[0] ?? "";
      index += command.length;
      pendingText = /^(?:text(?:rm|sf|tt|normal|bf|it|up|sl|sc)?|mbox|hbox|operatorname)$/.test(command);
      if (command === "begin") {
        const preamble = /^\s*\{d?array\}\s*\{[^{}]*\}/.exec(source.slice(index + 1))?.[0];
        if (preamble) {
          text += "\\" + command + preamble;
          index += preamble.length;
          continue;
        }
      }
      if (command === "verb") {
        const star = source[index + 1] === "*";
        const delimiterAt = index + (star ? 2 : 1), delimiter = source[delimiterAt];
        const end = delimiter ? source.indexOf(delimiter, delimiterAt + 1) : -1;
        if (end >= 0) {
          const literal = source.slice(delimiterAt + 1, end);
          if (delimiter === "|" || literal.includes("|")) {
            const escaped = literal.replace(/[\\{}%$&#_^~| ]/g, character => ({ "\\": "\\textbackslash{}", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}", "|": "\\textbar{}", " ": star ? "␣" : " " }[character] ?? `\\${character}`));
            text += `\\texttt{${escaped}}`;
            index = end;
            continue;
          }
        }
      }
      text += "\\" + command;
    } else if (char === "{") { groups.push(pendingText || (groups.at(-1) ?? false)); pendingText = false; text += char; }
    else if (char === "}") { groups.pop(); pendingText = false; text += char; }
    else if (char === "|") { text += groups.at(-1) ? "\\textbar{}" : "\\vert{}"; pendingText = false; }
    else { text += char; if (!/\s|\*/.test(char)) pendingText = false; }
  }
  return text;
}

function serializeCell(value: string): string {
  let text = value.replace(/\r\n?/g, "\n");
  if (text.includes("\n") || (text.includes("|") && text.includes("$"))) {
    const edits: { start: number; end: number; value: string }[] = [];
    const protectedRanges: { start: number; end: number }[] = [];
    const visit = (node: { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }) => {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if ((node.type === "inlineMath" || node.type === "inlineCode") && start !== undefined && end !== undefined) {
        protectedRanges.push({ start, end });
        const inline = text.slice(start, end).replace(/\n/g, " ");
        edits.push({ start, end, value: node.type === "inlineMath" ? safeMathPipes(inline) : inline });
      }
      else node.children?.forEach(child => visit(child as Parameters<typeof visit>[0]));
    };
    visit(parser.parse(text));
    for (const match of text.matchAll(/(\\*)\n/g)) {
      if (!protectedRanges.some(range => match.index >= range.start && match.index < range.end))
        edits.push({ start: match.index, end: match.index + match[0].length, value: match[1].repeat(2) + "<br>" });
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  }
  return text.replace(/(\\*)\|/g, (match, slashes: string) => slashes.length % 2 ? match : slashes + "\\|");
}

/** Source offsets preserve escaped delimiters, code and math without splitting on pipes. */
export function parseResearchTable(source: string): ResearchTable | null {
  const tables = parser.parse(source).children.filter(node => node.type === "table");
  if (tables.length !== 1) return null;
  const table = tables[0];
  const count = table.children[0]?.children.length ?? 0;
  if (!count || table.position?.start.offset === undefined || table.position.end.offset === undefined) return null;
  return {
    rows: table.children.map(row => Array.from({ length: Math.max(count, row.children.length) }, (_, index) => row.children[index] ? cellSource(source, row.children[index]) : "")),
    align: Array.from({ length: count }, (_, index) => table.align?.[index] ?? null),
    before: source.slice(0, table.position.start.offset),
    after: source.slice(table.position.end.offset),
  };
}

export function serializeResearchTable(table: ResearchTable): string {
  const row = (cells: string[]) => `| ${cells.map(serializeCell).join(" | ")} |`;
  const separator = table.align.map(alignment => alignment === "left" ? ":---" : alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---");
  return table.before + [row(table.rows[0]), row(separator), ...table.rows.slice(1).map(row)].join("\n") + table.after;
}

export function setTableCell(table: ResearchTable, row: number, column: number, value: string): ResearchTable {
  if (!table.rows[row] || column < 0 || column >= table.align.length || table.rows[row][column] === value) return table;
  return { ...table, rows: table.rows.map((cells, index) => index === row ? cells.map((cell, col) => col === column ? value : cell) : cells) };
}

export function insertTableRow(table: ResearchTable, index: number): ResearchTable {
  const rows = [...table.rows];
  rows.splice(Math.max(1, Math.min(index, rows.length)), 0, table.align.map(() => ""));
  return { ...table, rows };
}

export function deleteTableRow(table: ResearchTable, index: number): ResearchTable {
  return index < 1 || index >= table.rows.length ? table : { ...table, rows: table.rows.filter((_, row) => row !== index) };
}

export function insertTableColumn(table: ResearchTable, index: number): ResearchTable {
  const column = Math.max(0, Math.min(index, table.align.length));
  const align = [...table.align];
  align.splice(column, 0, null);
  return { ...table, align, rows: table.rows.map(row => { const cells = [...row]; cells.splice(column, 0, ""); return cells; }) };
}

export function deleteTableColumn(table: ResearchTable, index: number): ResearchTable {
  return table.align.length < 2 || index < 0 || index >= table.align.length ? table : {
    ...table, align: table.align.filter((_, column) => column !== index), rows: table.rows.map(row => row.filter((_, column) => column !== index)),
  };
}

export function setTableAlignment(table: ResearchTable, column: number, alignment: TableAlignment): ResearchTable {
  return column < 0 || column >= table.align.length || table.align[column] === alignment ? table : { ...table, align: table.align.map((current, index) => index === column ? alignment : current) };
}

/** Excel/TSV quoting permits tabs and newlines inside a single copied cell. */
export function parseTableClipboard(source: string): string[][] {
  const text = source.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let cells: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === "\t") { cells.push(cell); cell = ""; }
    else if (char === "\n") { cells.push(cell); rows.push(cells); cells = []; cell = ""; }
    else cell += char;
  }
  if (cell || cells.length || !rows.length || !text.endsWith("\n")) { cells.push(cell); rows.push(cells); }
  return rows;
}

export function pasteTableCells(table: ResearchTable, row: number, column: number, values: string[][]): ResearchTable {
  if (row < 0 || column < 0 || !values.length) return table;
  const count = Math.max(table.align.length, column + Math.max(...values.map(cells => cells.length)));
  const align = Array.from({ length: count }, (_, index) => table.align[index] ?? null);
  const rows = Array.from({ length: Math.max(table.rows.length, row + values.length) }, (_, index) =>
    Array.from({ length: Math.max(count, table.rows[index]?.length ?? 0) }, (_, col) => table.rows[index]?.[col] ?? ""));
  values.forEach((cells, index) => cells.forEach((value, col) => { rows[row + index][column + col] = value; }));
  return { ...table, align, rows };
}

/** Safe cell breaks and array preambles; other HTML stays disabled. */
export function remarkTableCellBreaks() {
  return (tree: Root) => {
    const inline = (children: PhrasingContent[]) => children.forEach((child, index) => {
      if (child.type === "html" && cellBreak.test(child.value)) children[index] = { type: "break" };
      else if (child.type === "inlineMath") {
        child.value = decodeTableMath(child.value);
        child.data = { ...child.data, hChildren: [{ type: "text", value: child.value }] };
      }
      else if ("children" in child) inline(child.children as PhrasingContent[]);
    });
    const visit = (node: { type: string; children?: unknown[] }) => {
      if (node.type === "tableCell") inline(node.children as PhrasingContent[]);
      else node.children?.forEach(child => visit(child as Parameters<typeof visit>[0]));
    };
    visit(tree);
  };
}
