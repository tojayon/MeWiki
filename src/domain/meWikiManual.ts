import type { ResearchNote } from "./researchNotebook.ts";

export const MEWIKI_MANUAL_ID = "mewiki-manual-index";

/** Sidebar subjects use stable chapter IDs, never editable titles or saved tags. */
export const MEWIKI_MANUAL_CATEGORIES = [
  { label: "入门与界面", chapters: ["index", "01-getting-started", "02-workspace", "17-shortcuts"] },
  { label: "编辑与组织", chapters: ["03-pages-and-tags", "04-content-blocks", "06-formulas", "21-content-showcase"] },
  { label: "词典与知识", chapters: ["05-symbol-dictionary", "07-links-and-references", "08-theory-maps", "09-variable-recipes"] },
  { label: "媒体与数据", chapters: ["10-media", "11-documents-and-attachments", "12-citations", "13-datasets", "14-diagrams"] },
  { label: "保存与维护", chapters: ["15-storage-and-backup", "16-migration", "18-troubleshooting", "22-ai-workspace"] },
  { label: "插件与导出", chapters: ["19-plugins-and-integrations", "20-social-export"] },
] as const;

export function getMeWikiManualCategory(note: Pick<ResearchNote, "id">): string {
  return MEWIKI_MANUAL_CATEGORIES.find(category => category.chapters.some(chapter => note.id === `mewiki-manual-${chapter}`))?.label ?? "其他手册";
}

/** Manual identity survives user edits to titles, tags and library metadata. */
export function isMeWikiManualNote(note: Pick<ResearchNote, "id">): boolean {
  return note.id.startsWith("mewiki-manual-");
}
