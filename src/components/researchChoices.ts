import { translate, getLocale, type Locale } from "../i18n/locale.ts";
import type { ResearchNote } from '../domain/researchNotebook.ts';
import { resolveSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import type { ResearchTermEntry } from '../domain/researchTerms.ts';
import { getNoteLibrary } from '../domain/researchNoteLibraries.ts';

export interface ResearchChoice {
  id: string;
  label: string;
  tags?: string[];
  detail?: string;
  searchText: string;
  note?: ResearchNote;
  symbol?: ResearchSymbolEntry;
  term?: ResearchTermEntry;
}
export function researchNoteChoice(note: ResearchNote, extra: Partial<Pick<ResearchChoice, 'id' | 'label' | 'detail'>> = {}, language: Locale = getLocale()): ResearchChoice {
  return { id: note.id, label: note.title || translate('未命名笔记', [], language), tags: note.tags, note,
    searchText: [note.title, ...(note.tags ?? []), getNoteLibrary(note) === 'foundation' ? '基础理论 Foundations' : '研究记录 Research notes', extra.detail, extra.label].join(' '), ...extra };
}
export function researchSymbolChoice(symbol: ResearchSymbolEntry): ResearchChoice {
  const tex = resolveSymbolEntry(symbol, Object.fromEntries(symbol.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
  return { id: symbol.id, label: symbol.name, tags: symbol.tags, symbol,
    detail: symbol.aliases?.length ? `旧称：${symbol.aliases.join("、")}` : symbol.meaning,
    searchText: [symbol.name, ...(symbol.aliases ?? []), symbol.notation, tex, symbol.meaning, symbol.unit, symbol.scope, ...symbol.slots.map(slot => slot.description), ...(symbol.tags ?? [])].join(' ') };
}
export function researchTermChoice(term: ResearchTermEntry): ResearchChoice {
  return { id: term.id, label: term.name, tags: term.tags, term,
    detail: [term.englishName, term.englishAbbreviation, term.chineseAbbreviation, ...(term.aliases.length ? term.aliases : [term.meaning])].filter(Boolean).join(" · "),
    searchText: [term.name, term.englishName, term.englishAbbreviation, term.chineseAbbreviation, ...term.aliases, term.meaning, term.scope, ...(term.tags ?? [])].join(' ') };
}
export function filterResearchChoices(choices: ResearchChoice[], query: string) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return choices.filter(choice => tokens.every(token => choice.searchText.toLocaleLowerCase().includes(token)));
}
