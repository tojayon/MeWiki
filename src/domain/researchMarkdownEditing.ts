import { isResearchMarkdownCodeAt } from "./researchMarkdown.ts";

export function researchListEditorSource(value: string): string {
  return value ? value.split("\n").map(item => `- ${item}`).join("\n") : "";
}

export function continueResearchMarkdownLine(
  source: string,
  start: number,
  end = start,
  kind = "paragraph",
): { text: string; caret: number } | null {
  if (kind === "code" || isResearchMarkdownCodeAt(source, start)) return null;
  const lineStart = source.slice(0, start).lastIndexOf("\n") + 1;
  const line = source.slice(lineStart, start);
  const quote = /^[ \t]*(?:>[ \t]*)*/.exec(line)![0];
  const item = /^([-+*]|(\d{1,9})([.)]))([ \t]+)(?:\[[ xX]\]([ \t]+))?/.exec(line.slice(quote.length));
  let prefix = quote;
  let before = source.slice(0, start);
  if (item) {
    const marker = item[2] ? String(Number(item[2]) + 1).padStart(item[2].length, "0") + item[3] : item[1];
    prefix += marker + item[4] + (item[5] ? "[ ]" + item[5] : "");
  } else if (kind === "list") {
    prefix += "- ";
    before = source.slice(0, lineStart + quote.length) + "- " + source.slice(lineStart + quote.length, start);
  } else if (!quote.includes(">")) return null;
  const inserted = before + "\n" + prefix;
  return { text: inserted + source.slice(end), caret: inserted.length };
}
