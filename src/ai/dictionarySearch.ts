import type { AiToolContext } from './tools.ts';
import { budgetAiRead } from './nativeTools.ts';
import { aiSymbolNotation } from './symbolNotation.ts';
import { researchTermAliases } from '../domain/researchTerms.ts';

const comparable = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function relevance(query: string, words: string[], names: string[], aliases: string[], notation: string[], meaning: string): number {
  const primary = names.map(comparable), secondary = [...aliases, ...notation].map(comparable);
  const labels = [...primary, ...secondary].join(' '), text = `${labels} ${comparable(meaning)}`;
  if (!words.every(word => text.includes(word))) return -1;
  if (!query) return 0;
  if (primary.includes(query)) return 120;
  if (secondary.includes(query)) return 110;
  if (words.every(word => primary.some(name => name.includes(word)))) return 80;
  if (words.every(word => labels.includes(word))) return 60;
  return 20;
}

/** Search excerpts do not replace a complete read or grant permission to edit a dictionary entry. */
export function searchAiDictionary(ctx: AiToolContext, args: Record<string, unknown>) {
  const kind = args.kind === undefined ? 'all' : args.kind;
  const query = args.query === undefined ? '' : args.query;
  const offset = args.offset === undefined ? 0 : args.offset;
  const limit = args.limit === undefined ? 20 : args.limit;
  if (!['all', 'symbol', 'term'].includes(kind as string) || typeof query !== 'string'
    || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000
    || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('词典检索参数无效，请检查类型和分页范围。');
  const normalized = comparable(query), words = normalized.split(' ').filter(Boolean);
  const terms = kind === 'symbol' ? [] : (ctx.state.terms ?? []).map(entry => {
    const aliases = researchTermAliases(entry).map(alias => alias.name);
    return { entry, aliases, score: relevance(normalized, words, [entry.name, entry.englishName ?? '', entry.englishAbbreviation ?? '', entry.chineseAbbreviation ?? ''], aliases, [], entry.meaning) };
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || byId(a.entry.id, b.entry.id));
  const symbols = kind === 'term' ? [] : ctx.state.symbols.map(entry => {
    const resolved = aiSymbolNotation(entry);
    return { entry, resolved, score: relevance(normalized, words, [entry.name], entry.aliases ?? [], [entry.notation, resolved.tex], entry.meaning) };
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score || byId(a.entry.id, b.entry.id));
  const nextOffset = (total: number) => offset + limit < total ? offset + limit : null;
  return budgetAiRead(ctx, {
    terms: terms.slice(offset, offset + limit).map(({ entry, aliases }) => ({ id: entry.id, name: entry.name,
      englishName: entry.englishName, englishAbbreviation: entry.englishAbbreviation, chineseAbbreviation: entry.chineseAbbreviation,
      aliases: aliases.slice(0, 50), meaning: entry.meaning.slice(0, 3000), url: `mewiki-term:${encodeURIComponent(entry.id)}` })),
    symbols: symbols.slice(offset, offset + limit).map(({ entry, resolved }) => ({ id: entry.id, name: entry.name, notation: entry.notation,
      meaning: entry.meaning.slice(0, 3000), url: `mewiki-symbol:${encodeURIComponent(entry.id)}`, resolved })),
    termsTotal: terms.length, symbolsTotal: symbols.length,
    termsNextOffset: nextOffset(terms.length), symbolsNextOffset: nextOffset(symbols.length), offset, limit,
  });
}
