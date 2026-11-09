export type PdfTextItem = { str: string; hasEOL?: boolean } | { type: string };
export interface PdfTextIndex { text: string; spans: { start: number; end: number }[] }
export function indexPdfText(items: readonly PdfTextItem[]): PdfTextIndex {
  const parts: string[] = [], spans: PdfTextIndex["spans"] = [];
  let length = 0, space = true;
  for (const item of items) {
    if (!("str" in item)) continue;
    let value = item.str.toLocaleLowerCase().replace(/\s+/gu, " ");
    if (space && value.startsWith(" ")) value = value.slice(1);
    const start = length;
    parts.push(value); length += value.length;
    spans.push({ start, end: length });
    if (value) space = value.endsWith(" ");
    if (item.hasEOL && !space) { parts.push(" "); length++; space = true; }
  }
  return { text: parts.join("").trimEnd(), spans };
}
export function findPdfText(index: PdfTextIndex, query: string, maximum = 500): { start: number; end: number }[] {
  const needle = query.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
  if (!needle || maximum < 1) return [];
  const matches: { start: number; end: number }[] = [];
  for (let start = index.text.indexOf(needle); start >= 0 && matches.length < maximum; start = index.text.indexOf(needle, start + needle.length)) matches.push({ start, end: start + needle.length });
  return matches;
}
