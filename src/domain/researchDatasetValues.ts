export const DATASET_MAX_FILE_BYTES = 10_000_000;
export const DATASET_MAX_ROWS = 10_000;
export const DATASET_MAX_COLUMNS = 50;
export const DATASET_MAX_CELLS = 200_000;
export const DATASET_MAX_CHARACTERS = 2_000_000;
export const DATASET_MAX_CELL_CHARACTERS = 16_000;
export const DATASET_MAX_SHEETS = 100;
export const DATASET_MAX_EXPANDED_BYTES = 32_000_000;

export interface DatasetValues { columns: string[]; rows: string[][] }
export function checkedString(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || value.length > limit) throw new Error(`${label}无效或超过 ${limit.toLocaleString()} 个字符。`);
  return value;
}
export function checkedValues(columns: unknown, rows: unknown): DatasetValues {
  if (!Array.isArray(columns) || !Array.isArray(rows)) throw new Error("数据需要列名和数据行。");
  if (columns.length > DATASET_MAX_COLUMNS) throw new Error(`数据最多 ${DATASET_MAX_COLUMNS} 列。`);
  if (rows.length > DATASET_MAX_ROWS) throw new Error(`数据最多 ${DATASET_MAX_ROWS.toLocaleString()} 行。`);
  if (rows.length && !columns.length) throw new Error("请先填写数据列名。");
  if (rows.length * columns.length > DATASET_MAX_CELLS) throw new Error(`数据最多 ${DATASET_MAX_CELLS.toLocaleString()} 个单元格。`);
  const names = Array.from(columns, value => checkedString(value, DATASET_MAX_CELL_CHARACTERS, "列名"));
  let characters = names.reduce((sum, name) => sum + name.length, 0);
  const values = Array.from(rows, row => {
    if (!Array.isArray(row) || row.length > names.length) throw new Error("数据行的列数与列名不一致。");
    const result = Array.from({ length: names.length }, (_, index) => index < row.length ? checkedString(row[index], DATASET_MAX_CELL_CHARACTERS, "单元格") : "");
    for (const cell of result) characters += cell.length;
    if (characters > DATASET_MAX_CHARACTERS) throw new Error(`数据文本最多 ${DATASET_MAX_CHARACTERS.toLocaleString()} 个字符；请将大文件作为附件保存。`);
    return result;
  });
  if (characters > DATASET_MAX_CHARACTERS) throw new Error("数据文本过长。");
  return { columns: names, rows: values };
}

function detectDelimiter(text: string): string {
  const counts = new Map([[",", 0], ["\t", 0], [";", 0]]);
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') index++; else quoted = !quoted; }
    else if (!quoted && (character === "\r" || character === "\n")) break;
    else if (!quoted && counts.has(character)) counts.set(character, counts.get(character)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

/** The first record contains column names. Empty cells and missing records are preserved. */
export function parseDatasetText(value: string, delimiter?: string): DatasetValues {
  if (typeof value !== "string") throw new Error("请粘贴 CSV 或制表符分隔的数据。");
  if (value.length > DATASET_MAX_CHARACTERS) throw new Error(`导入文本最多 ${DATASET_MAX_CHARACTERS.toLocaleString()} 个字符。`);
  const text = value.replace(/^\uFEFF/, "");
  if (!text.trim()) return { columns: [], rows: [] };
  const separator = delimiter ?? detectDelimiter(text);
  if (![",", "\t", ";"].includes(separator)) throw new Error("数据分隔符无效。");
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const endCell = () => { row.push(cell); cell = ""; closed = false; if (row.length > DATASET_MAX_COLUMNS) throw new Error(`数据最多 ${DATASET_MAX_COLUMNS} 列。`); };
  const endRow = () => { endCell(); records.push(row); row = []; if (records.length > DATASET_MAX_ROWS + 1) throw new Error(`数据最多 ${DATASET_MAX_ROWS.toLocaleString()} 行。`); };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') { if (text[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closed = true; } }
      else cell += character;
    } else if (character === separator) endCell();
    else if (character === "\r" || character === "\n") { if (character === "\r" && text[index + 1] === "\n") index++; endRow(); }
    else if (closed) { if (character !== " " && character !== "\t") throw new Error(`第 ${records.length + 1} 行的引号后有多余内容。`); }
    else if (character === '"') { if (cell) throw new Error(`第 ${records.length + 1} 行的引号位置无效。`); quoted = true; }
    else cell += character;
    if (cell.length > DATASET_MAX_CELL_CHARACTERS) throw new Error(`单个单元格最多 ${DATASET_MAX_CELL_CHARACTERS.toLocaleString()} 个字符。`);
  }
  if (quoted) throw new Error(`第 ${records.length + 1} 行的引号尚未闭合。`);
  if (row.length || cell || closed || !/[\r\n]$/.test(text)) endRow();
  const columns = (records.shift() ?? []).map((name, index) => name || `列 ${index + 1}`);
  return checkedValues(columns, records);
}

export function spreadsheetToDataset(sheet: unknown[][]): DatasetValues {
  if (!Array.isArray(sheet) || !sheet.length) return { columns: [], rows: [] };
  if (sheet.length > DATASET_MAX_ROWS + 1) throw new Error(`数据最多 ${DATASET_MAX_ROWS.toLocaleString()} 行。`);
  const width = Math.max(...sheet.map(row => Array.isArray(row) ? row.length : 0));
  if (width > DATASET_MAX_COLUMNS) throw new Error(`数据最多 ${DATASET_MAX_COLUMNS} 列。`);
  const converted = sheet.map(row => Array.from({ length: width }, (_, index) => {
    const cell = row[index];
    if (cell === undefined || cell === null) return "";
    if (cell instanceof Date) { if (!Number.isFinite(cell.getTime())) throw new Error("工作表包含无效日期。"); return cell.toISOString().replace(/T00:00:00\.000Z$/, ""); }
    if (typeof cell === "number" && !Number.isFinite(cell)) throw new Error("工作表包含无效数值。");
    if (!["string", "number", "boolean"].includes(typeof cell)) throw new Error("工作表包含无法读取的单元格。");
    return String(cell);
  }));
  return checkedValues(converted[0].map((name, index) => name || `列 ${index + 1}`), converted.slice(1));
}

/** Inspect declared ZIP sizes before an XLSX decoder allocates expanded XML. ZIP64 is unnecessary under these limits. */
export function validateDatasetArchive(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === view.byteLength) { end = offset; break; }
  }
  if (end < 0) throw new Error("Excel 文件不完整，请选择有效的 .xlsx 原件。");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (!count || count > 2048 || start + size > end || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error("Excel 文件过于复杂或格式无效，请缩减工作表后再导入。");
  let offset = start, expanded = 0;
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Excel 文件目录无效。");
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), bytes = view.getUint32(offset + 24, true);
    expanded += bytes;
    if (flags & 1 || ![0, 8].includes(method)) throw new Error("不支持加密或此压缩格式的 Excel 文件。");
    if (bytes > 16_000_000 || expanded > DATASET_MAX_EXPANDED_BYTES) throw new Error("Excel 展开内容超过 32 MB，请拆分工作表，或将原件作为附件保存。");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (offset > start + size) throw new Error("Excel 文件目录不完整。");
  }
  if (offset !== start + size) throw new Error("Excel 文件目录无效。");
}
