import type { ResearchSymbolEntry, SymbolCategory } from "./researchDictionary.ts";
import type { ResearchNotebookState } from "./researchNotebook.ts";
import { buildResearchTagTree, matchesResearchTag, normalizeResearchTags } from "./researchTags.ts";

// Retained only for migrating existing definitions to the tag system.
const legacyCategoryLabels: Partial<Record<SymbolCategory, string>> = {
  time: "时间", index: "索引", state: "状态", control: "控制",
  communication: "通信", scheduler: "调度", evaluation: "评价",
};

export interface ResearchSymbolFilters {
  query: string;
  tag: string;
}
export const defaultResearchSymbolFilters: ResearchSymbolFilters = { query: "", tag: "" };

export function initialSymbolTags(category: SymbolCategory): string[] {
  if (category === "custom") return [];
  if (category === "evaluation") return ["评价"];
  const label = legacyCategoryLabels[category];
  return label ? [`模型/${label}`] : [];
}

/** Upgrade tag metadata and retire old category filters without changing symbol definitions. */
export function normalizeResearchSymbolOrganization(state: ResearchNotebookState): ResearchNotebookState {
  let changed = false;
  const symbols = state.symbols.map(entry => {
    const tags = entry.tags === undefined ? initialSymbolTags(entry.category) : normalizeResearchTags(entry.tags);
    if (JSON.stringify(tags) === JSON.stringify(entry.tags)) return entry;
    changed = true;
    return { ...entry, tags };
  });
  const symbolFilters = state.symbolFilters ? normalizeSymbolFilters(state.symbolFilters) : undefined;
  if (JSON.stringify(symbolFilters) !== JSON.stringify(state.symbolFilters)) changed = true;
  return changed ? { ...state, symbols, ...(symbolFilters ? { symbolFilters } : {}) } : state;
}

export function normalizeSymbolFilters(value: unknown): ResearchSymbolFilters {
  if (!value || typeof value !== "object") return { ...defaultResearchSymbolFilters };
  const filters = value as Record<string, unknown>;
  return {
    query: typeof filters.query === "string" ? filters.query : "",
    tag: normalizeResearchTags([filters.tag])[0] ?? "",
  };
}

export function filterResearchSymbols(entries: ResearchSymbolEntry[], filters: ResearchSymbolFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return entries.filter(entry => {
    if (filters.tag && !(entry.tags ?? []).some(tag => matchesResearchTag(tag, filters.tag))) return false;
    const text = [entry.name, entry.notation, entry.meaning, entry.scope, entry.unit,
      ...entry.slots.flatMap(slot => [slot.defaultValue, slot.description]), ...(entry.tags ?? [])].join(" ");
    return !query || text.toLocaleLowerCase().includes(query);
  });
}

export function buildResearchSymbolTree(entries: ResearchSymbolEntry[], filters = defaultResearchSymbolFilters) {
  return buildResearchTagTree(filterResearchSymbols(entries, filters), filters.tag);
}

export function setResearchSymbolTags(state: ResearchNotebookState, entryId: string, values: string[]): ResearchNotebookState {
  const tags = normalizeResearchTags(values);
  const entry = state.symbols.find(item => item.id === entryId);
  if (!entry || JSON.stringify(entry.tags ?? []) === JSON.stringify(tags)) return state;
  return { ...state, symbols: state.symbols.map(item => item.id === entryId ? { ...item, tags } : item) };
}

/** Replay local membership changes on the latest set instead of replacing another window's edits. */
export function mergeResearchSymbolTags(current: string[], original: string[], draft: string[]) {
  const before = new Set(normalizeResearchTags(original).map(tag => tag.toLocaleLowerCase()));
  const edited = normalizeResearchTags(draft);
  const after = new Set(edited.map(tag => tag.toLocaleLowerCase()));
  const removed = new Set([...before].filter(tag => !after.has(tag)));
  const added = edited.filter(tag => !before.has(tag.toLocaleLowerCase()));
  return normalizeResearchTags([...current.filter(tag => !removed.has(tag.toLocaleLowerCase())), ...added]);
}
