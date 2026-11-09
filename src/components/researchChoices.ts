import type { ResearchNote } from '../domain/researchNotebook.ts';
import { resolveSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { getNoteLibrary } from '../domain/researchNoteLibraries.ts';

export interface ResearchChoice {
  id: string;
  label: string;
  tags?: string[];
  detail?: string;
  searchText: string;
  note?: ResearchNote;
  symbol?: ResearchSymbolEntry;
}
export function researchNoteChoice(note: ResearchNote, extra: Partial<Pick<ResearchChoice, 'id' | 'label' | 'detail'>> = {}): ResearchChoice {
  return { id: note.id, label: note.title || '未命名笔记', tags: note.tags, note,
    searchText: [note.title, ...(note.tags ?? []), getNoteLibrary(note) === 'foundation' ? '基础理论' : '研究记录', extra.detail, extra.label].join(' '), ...extra };
}
export function researchSymbolChoice(symbol: ResearchSymbolEntry): ResearchChoice {
  const tex = resolveSymbolEntry(symbol, Object.fromEntries(symbol.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
  return { id: symbol.id, label: symbol.name, tags: symbol.tags, symbol,
    searchText: [symbol.name, symbol.notation, tex, symbol.meaning, symbol.unit, symbol.scope, ...symbol.slots.map(slot => slot.description), ...(symbol.tags ?? [])].join(' ') };
}
export function filterResearchChoices(choices: ResearchChoice[], query: string) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return choices.filter(choice => tokens.every(token => choice.searchText.toLocaleLowerCase().includes(token)));
}
