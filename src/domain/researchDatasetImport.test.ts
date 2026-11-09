import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseDatasetFile, validateDatasetArchiveContents } from "./researchDatasetImport.ts";

function workbookBuffer(): ArrayBuffer {
  const xml = (value: string) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${value}`);
  const zip = zipSync({
    "[Content_Types].xml": xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'),
    "_rels/.rels": xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="观测" sheetId="1" r:id="r1"/><sheet name="校验" sheetId="2" r:id="r2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>t</t></is></c><c r="B1" t="inlineStr"><is><t>y</t></is></c></row><row r="2"><c r="A2"><v>0</v></c><c r="B2"><v>2.5</v></c></row></sheetData></worksheet>'),
    "xl/worksheets/sheet2.xml": xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1" t="inlineStr"><is><t>y</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>8</v></c></row></sheetData></worksheet>'),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

describe("dataset local file parser", () => {
  it("parses real multi-sheet XLSX with exact numeric strings", async () => {
    const result = await parseDatasetFile(workbookBuffer(), "观测.xlsx");
    expect(result.sheets).toEqual([{ name: "观测", columns: ["t", "y"], rows: [["0", "2.5"]] }, { name: "校验", columns: ["x", "y"], rows: [["1", "8"]] }]);
  });
  it("reads UTF-8 and BOM-marked UTF-16 text and rejects unsupported files", async () => {
    const encoder = new TextEncoder();
    expect((await parseDatasetFile(encoder.encode("t,y\n0,2").buffer, "x.csv")).sheets[0].rows).toEqual([["0", "2"]]);
    const text = "\uFEFFt\ty\r\n0\t3";
    const utf16 = new Uint8Array(text.length * 2), view = new DataView(utf16.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
    expect((await parseDatasetFile(utf16.buffer, "x.tsv")).sheets[0].rows).toEqual([["0", "3"]]);
    await expect(parseDatasetFile(encoder.encode("data").buffer, "x.xls")).rejects.toThrow(/xlsx/);
    await expect(parseDatasetFile(new ArrayBuffer(10_000_001), "x.xlsx")).rejects.toThrow(/10 MB/);
  });
  it("rejects out-of-range Excel coordinates before the sheet parser allocates rows", async () => {
    for (const xml of ['<worksheet><row r="999999"><c r="A999999"><v>1</v></c></row></worksheet>', '<worksheet><row r="999999"/></worksheet>', '<worksheet><row r="Infinity"/></worksheet>', '<worksheet><row r="1"><c r="A&#x39;999999"><v>1</v></c></row></worksheet>']) {
      const zip = zipSync({ "xl/worksheets/sheet1.xml": strToU8(xml) });
      await expect(validateDatasetArchiveContents(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer)).rejects.toThrow(/范围/);
    }
  });
  it("rejects falsely declared expanded sizes while streaming actual ZIP data", async () => {
    const zip = zipSync({ "oversized.xml": new Uint8Array(16_000_001) });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let offset = 0; offset < zip.length - 28; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, 1, true);
      if (view.getUint32(offset, true) === 0x04034b50) view.setUint32(offset + 22, 1, true);
    }
    await expect(validateDatasetArchiveContents(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer)).rejects.toThrow(/展开/);
  });
});
