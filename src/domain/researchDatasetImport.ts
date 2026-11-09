import { DATASET_MAX_CELLS, DATASET_MAX_CHARACTERS, DATASET_MAX_COLUMNS, DATASET_MAX_EXPANDED_BYTES, DATASET_MAX_FILE_BYTES, DATASET_MAX_ROWS, DATASET_MAX_SHEETS, parseDatasetText, spreadsheetToDataset, validateDatasetArchive, type DatasetValues } from "./researchDatasetValues.ts";

export interface DatasetSheet extends DatasetValues { name: string }
export interface DatasetImportResult { sheets: DatasetSheet[] }
export interface DatasetWorkerInput { buffer: ArrayBuffer; name: string }
export type DatasetWorkerResult = { result: DatasetImportResult } | { error: string };

/** Check actual decoded sizes as well as declarations; malformed ZIP sizes must not bypass the preview cap. */
export async function validateDatasetArchiveContents(buffer: ArrayBuffer): Promise<void> {
  validateDatasetArchive(buffer);
  const { Unzip, UnzipInflate } = await import("fflate");
  let total = 0, count = 0;
  let failure: Error | undefined;
  const names = new Set<string>();
  const unzip = new Unzip(file => {
    if (failure) return;
    if (++count > 2048 || names.has(file.name) || file.name.split("/").some(part => part === ".." || part === "__proto__") || /^(?:\/|[a-z]:)/i.test(file.name)) { failure = new Error("Excel 文件目录无效。"); return; }
    names.add(file.name);
    let size = 0, xml = "";
    const xmlFile = /\.xml$/i.test(file.name);
    const decoder = xmlFile ? new TextDecoder("utf-8", { fatal: true }) : undefined;
    file.ondata = (error, bytes, final) => {
      if (failure) return;
      if (error) { failure = new Error("Excel 压缩内容损坏。"); return; }
      size += bytes.length; total += bytes.length;
      if (size > 16_000_000 || total > DATASET_MAX_EXPANDED_BYTES) { failure = new Error("Excel 展开内容超过 32 MB，请拆分工作表，或将原件作为附件保存。"); return; }
      if (decoder) {
        try { xml += decoder.decode(bytes, { stream: !final }); }
        catch { failure = new Error("Excel 工作表编码无效。"); return; }
      }
      if (final && xmlFile) {
        const tags = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
        let rowCount = 0, cellCount = 0;
        for (const match of tags.matchAll(/<(?:[A-Za-z_][\w.-]*:)?(row|c)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/g)) {
          if (match[1] === "row") rowCount++; else cellCount++;
          if (rowCount > DATASET_MAX_ROWS + 1 || cellCount > DATASET_MAX_CELLS + DATASET_MAX_COLUMNS) { failure = new Error("Excel 数据区域超过预览限制，请先缩减工作表。"); return; }
          const coordinate = /(?:^|\s)r\s*=\s*(["'])(.*?)\1/.exec(match[2]);
          if (!coordinate) continue;
          const reference = coordinate[2].replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
            const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
            return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "?";
          });
          const cell = /^([a-z]+)([1-9]\d*)$/i.exec(reference);
          let column = 0;
          if (cell) for (const character of cell[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
          const invalid = match[1] === "row" ? !/^[1-9]\d*$/.test(reference) || Number(reference) > DATASET_MAX_ROWS + 1 : !cell || column > DATASET_MAX_COLUMNS || Number(cell[2]) > DATASET_MAX_ROWS + 1;
          if (invalid) { failure = new Error("Excel 单元格范围超过 10,000 行、50 列或 200,000 个单元格，请先缩减数据区域。"); return; }
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    if (failure) throw failure;
  }
}

export async function parseDatasetFile(buffer: ArrayBuffer, name: string): Promise<DatasetImportResult> {
  if (!buffer.byteLength || buffer.byteLength > DATASET_MAX_FILE_BYTES) throw new Error("数据预览支持不超过 10 MB 的文件；更大的原件请使用附件内容块。");
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "xls") throw new Error("请将旧版 .xls 另存为 .xlsx 或 UTF-8 CSV 后导入。");
  if (extension !== "xlsx") {
    if (!["csv", "tsv", "txt"].includes(extension ?? "")) throw new Error("请选择 CSV、TSV 或 Excel .xlsx 文件。");
    const bytes = new Uint8Array(buffer);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    let text: string;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); }
    catch { throw new Error("文件文字编码无法读取，请另存为 UTF-8 CSV 后重试。"); }
    return { sheets: [{ name: "", ...parseDatasetText(text, extension === "tsv" ? "\t" : undefined) }] };
  }
  await validateDatasetArchiveContents(buffer);
  const { default: readExcelFile } = await import("read-excel-file/browser");
  const workbook = await readExcelFile(buffer, { trim: false, parseNumber: value => value });
  if (!workbook.length || workbook.length > DATASET_MAX_SHEETS) throw new Error("Excel 最多支持 100 个工作表，请拆分后导入。");
  let cells = 0, characters = 0;
  const sheets = workbook.map(sheet => {
    const data = spreadsheetToDataset(sheet.data);
    cells += data.columns.length * data.rows.length;
    for (const row of [data.columns, ...data.rows]) for (const cell of row) characters += cell.length;
    if (cells > DATASET_MAX_CELLS || characters > DATASET_MAX_CHARACTERS) throw new Error("Excel 总数据量超过 200,000 个单元格或 2,000,000 个字符，请拆分工作簿。");
    return { name: sheet.sheet, ...data };
  });
  return { sheets };
}
