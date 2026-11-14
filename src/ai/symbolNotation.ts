import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { RootContent } from 'mdast';
import { resolveSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { findInlineResearchSymbols } from '../domain/researchInlineSymbols.ts';
import { dictionaryReferenceBindings, dictionaryReferenceId, dictionaryReferenceKind, dictionaryReferenceMarkdown } from '../domain/researchTerms.ts';
import { flattenResearchBlocks } from '../domain/researchBlockTree.ts';
import { renderedFormulaTex, type ResearchNote, type ResearchNotebookState } from '../domain/researchNotebook.ts';
import { readableAiNote } from './readable.ts';
import { applyAiProposal, type AiProposal } from './proposals.ts';
import { nativeEntity, runNativeEdit } from './nativeEdits.ts';
import type { ResearchTermEntry } from '../domain/researchTerms.ts';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const fonts = new Set(['\\mathrm', '\\mathit', '\\mathbf', '\\boldsymbol', '\\mathsf', '\\mathtt', '\\mathcal', '\\mathbb', '\\mathfrak', '\\mathscr', '\\mathnormal', '\\bm', '\\bold']);
const greekVariables = new Map(Object.entries({ alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', varkappa: 'ϰ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' }).map(([command, glyph]) => [`\\${command}`, glyph]));
const tokens = (tex: string) => [...tex.matchAll(/\\[a-zA-Z]+|\\[\s\S]|%[^\n]*|\s+|[\s\S]/g)].filter(match => !/^\s|^%/.test(match[0])).map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
const withoutFonts = (tex: string) => tex.replace(/\\[a-zA-Z]+/g, command => fonts.has(command) ? ' ' : command);

/** Ignore whitespace and single-atom braces, but preserve multi-atom script groups and all non-font commands. */
function signature(tex: string, ignoreFonts = false, inheritedFont: (offset: number) => string = () => ''): string {
  const parts = tokens(tex); let at = 0;
  const atom = (font = ''): string => {
    const token = parts[at++];
    if (token.text === '{') {
      const body: string[] = [];
      while (at < parts.length && parts[at].text !== '}') body.push(atom(font));
      if (parts[at]?.text !== '}') return `incomplete:${JSON.stringify(body)}`;
      at++;
      return body.length === 1 ? body[0] : `group:${JSON.stringify(body)}`;
    }
    if (fonts.has(token.text) && at < parts.length && parts[at].text !== '}') {
      return atom(token.text);
    }
    const active = ignoreFonts ? '' : font || inheritedFont(token.start), glyph = greekVariables.get(token.text) ?? token.text;
    const greek = /^[\u0370-\u03ff]$/.test(glyph), latin = /^[a-zA-Z]$/.test(glyph);
    // Compare effective alphabet fonts, including inherited scopes. Normal Greek
    // capitals are upright; ordinary Latin and lowercase Greek variables are italic.
    const defaults = greek ? glyph === glyph.toUpperCase() ? ['', '\\mathrm', '\\mathnormal'] : ['', '\\mathrm', '\\mathit', '\\mathnormal'] : ['', '\\mathit', '\\mathnormal'];
    const styled = (latin || greek) && !defaults.includes(active);
    return styled ? `font:${active}:token:${glyph}` : `token:${glyph}`;
  };
  const body: string[] = [];
  while (at < parts.length) body.push(atom());
  return JSON.stringify(body);
}

export function aiSymbolNotation(entry: ResearchSymbolEntry) {
  const bindings = Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]));
  const tex = resolveSymbolEntry(entry, bindings).tex;
  return { tex, bindings, markdown: dictionaryReferenceMarkdown('symbol', entry, `$${tex}$`, bindings) };
}

function mathExpressions(markdown: string, symbols: readonly ResearchSymbolEntry[]): string[] {
  const result: string[] = [];
  const root = parser.parse(markdown);
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: RootContent) => {
    if (node.type === 'definition' && !definitions.has(node.identifier.toUpperCase())) definitions.set(node.identifier.toUpperCase(), node.url);
    if ('children' in node) node.children.forEach(collectDefinitions);
  };
  root.children.forEach(collectDefinitions);
  const visit = (node: RootContent) => {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html') return;
    if (node.type === 'math' || node.type === 'inlineMath') { result.push(node.value); return; }
    const url = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier.toUpperCase()) : undefined;
    if (dictionaryReferenceKind(url) === 'symbol') {
      const entry = symbols.find(symbol => symbol.id === dictionaryReferenceId(url));
      if (entry) result.push(resolveSymbolEntry(entry, { ...aiSymbolNotation(entry).bindings, ...dictionaryReferenceBindings(url) }).tex);
      return;
    }
    if ('children' in node) node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return result;
}

/** Keep offsets while exposing font-wrapped bases to the existing domain matcher. */
function notationInstances(tex: string, patterns: ResearchSymbolEntry[]) {
  const original = findInlineResearchSymbols(tex, patterns);
  const stripped = tex.replace(/\\[a-zA-Z]+/g, command => fonts.has(command) ? ' '.repeat(command.length) : command);
  const candidates = [...original, ...findInlineResearchSymbols(stripped, patterns).filter(match => !original.some(item => item.start <= match.start && item.end >= match.end))];
  const parts = tokens(tex);
  const atomEnd = (start: number): number => {
    if (parts[start]?.text === '{') {
      let depth = 1, at = start + 1;
      while (at < parts.length && depth) { if (parts[at].text === '{') depth++; if (parts[at].text === '}') depth--; at++; }
      return at;
    }
    return fonts.has(parts[start]?.text) ? atomEnd(start + 1) : Math.min(start + 1, parts.length);
  };
  const scopes = parts.flatMap((part, index) => {
    if (!fonts.has(part.text) || !parts[index + 1]) return [];
    const end = atomEnd(index + 1);
    return [{ start: parts[index + 1].start, end: parts[end - 1].end, font: part.text }];
  });
  return candidates.map(match => ({ ...match,
    strict: signature(tex.slice(match.start, match.end), false, offset => scopes.findLast(scope => scope.start <= offset + match.start && scope.end > offset + match.start)?.font ?? ''),
    loose: signature(tex.slice(match.start, match.end), true),
  }));
}

function notationIndex(symbols: readonly ResearchSymbolEntry[]) {
  const patterns = [...symbols, ...symbols.map(entry => ({ ...entry, notation: withoutFonts(entry.notation), slots: entry.slots.map(slot => ({ ...slot, defaultValue: withoutFonts(slot.defaultValue) })) }))];
  const canonical = new Map<string, { entry: ResearchSymbolEntry; tex: string; strict: string }[]>();
  for (const entry of symbols) {
    const { tex } = aiSymbolNotation(entry), key = signature(tex, true);
    const values = canonical.get(key) ?? [];
    values.push({ entry, tex, strict: signature(tex) }); canonical.set(key, values);
  }
  return { patterns, canonical };
}

/** Relevant conventions are a bounded projection, never an implicit dictionary-edit grant. */
export function aiSymbolConventions(markdown: string, symbols: readonly ResearchSymbolEntry[]) {
  const used = new Set<string>(), index = notationIndex(symbols);
  for (const tex of mathExpressions(markdown, symbols)) {
    for (const match of findInlineResearchSymbols(tex, index.patterns)) match.candidates.forEach(entry => used.add(entry.id));
  }
  const relevant = symbols.filter(entry => used.has(entry.id) || [entry.name, ...(entry.aliases ?? [])].some(name => name && markdown.includes(name)));
  const projected: { id: string; name: string; resolved: ReturnType<typeof aiSymbolNotation> }[] = [];
  let characters = 40;
  for (const entry of relevant) {
    const value = { id: entry.id, name: entry.name, resolved: aiSymbolNotation(entry) }, length = JSON.stringify(value).length + 1;
    if (projected.length === 12 || characters + length > 8000) continue;
    projected.push(value); characters += length;
  }
  return { symbols: projected, hasMore: relevant.length > projected.length };
}

type Documents = Map<string, { text: string; math?: boolean }>;
function noteDocuments(note: ResearchNote | null, symbols: ResearchSymbolEntry[]): Documents {
  const result: Documents = new Map();
  if (!note) return result;
  result.set('title', { text: note.title });
  for (const block of flattenResearchBlocks(note.blocks)) {
    if (block.type === 'noteEmbed') continue;
    if (block.type === 'formula') {
      result.set(block.id, { text: renderedFormulaTex(block, symbols).tex, math: true });
      result.set(`${block.id}:caption`, { text: [block.caption, block.conditions].filter(Boolean).join('\n\n') });
    } else if (block.type === 'examples') {
      result.set(block.id, { text: [block.title, ...block.tabs.map(tab => tab.title)].filter(Boolean).join('\n\n') });
    } else if (block.type === 'diagram') {
      // Mermaid source is code, while drawing labels are prose.
      result.set(block.id, { text: [block.title, ...(block.strokes ?? []).map(stroke => stroke.text)].filter(Boolean).join('\n\n') });
    } else if (block.type === 'external' || block.type === 'evidence') {
      result.set(block.id, { text: block.note ?? '' });
    } else {
      result.set(block.id, { text: readableAiNote({ ...note, title: '', blocks: [block] }, [], symbols) });
    }
  }
  return result;
}

/** Only new, uniquely identifiable default-instance font loss is rejected. Custom bindings and ambiguous identities stay editable. */
export function assertAiProposalSymbolNotation(state: ResearchNotebookState, proposal: AiProposal): void {
  if (!state.symbols.length) return;
  let before: Documents, after: Documents;
  if (proposal.kind === 'native') {
    if (proposal.target !== 'note' && proposal.target !== 'term') return;
    const next = nativeEntity(runNativeEdit(state, proposal.edit), proposal.target, proposal.targetId);
    if (proposal.target === 'note') {
      before = noteDocuments(proposal.before as ResearchNote | null, state.symbols); after = noteDocuments(next as ResearchNote | null, state.symbols);
    } else {
      before = new Map([['meaning', { text: (proposal.before as ResearchTermEntry | null)?.meaning ?? '' }]]);
      after = new Map([['meaning', { text: (next as ResearchTermEntry | null)?.meaning ?? '' }]]);
    }
  } else if (proposal.kind === 'term') {
    before = new Map([['meaning', { text: proposal.before?.meaning ?? '' }]]); after = new Map([['meaning', { text: proposal.term.meaning }]]);
  } else {
    const next = applyAiProposal(state, proposal, proposal.libraryId).state.notes.find(note => note.id === proposal.targetId) ?? null;
    before = noteDocuments(proposal.before, state.symbols); after = noteDocuments(next, state.symbols);
  }
  const index = notationIndex(state.symbols);
  const violations = (doc: { text: string; math?: boolean }) => {
    const found = new Map<string, { count: number; entry: ResearchSymbolEntry; tex: string }>();
    for (const tex of doc.math ? [doc.text] : mathExpressions(doc.text, state.symbols)) {
      for (const match of notationInstances(tex, index.patterns)) {
        const { strict } = match;
        const candidates = index.canonical.get(match.loose);
        if (!candidates || candidates.some(candidate => candidate.strict === strict) || new Set(candidates.map(candidate => candidate.strict)).size !== 1) continue;
        const canonical = candidates[0];
        // Do not turn a general mathematical equivalence into a typography rule.
        if (signature(canonical.tex) === signature(canonical.tex, true)) continue;
        const key = JSON.stringify([canonical.entry.id, strict]);
        found.set(key, { entry: canonical.entry, tex: canonical.tex, count: (found.get(key)?.count ?? 0) + 1 });
      }
    }
    return found;
  };
  for (const [key, doc] of after) {
    const previous = before.get(key);
    if (previous?.text === doc.text && previous.math === doc.math) continue;
    const existing = previous ? violations(previous) : new Map();
    for (const [key, violation] of violations(doc)) {
      if (violation.count <= (existing.get(key)?.count ?? 0)) continue;
      throw new Error(`符号书写与词典不一致：${violation.entry.name.slice(0, 120)}（${violation.entry.id.slice(0, 120)}）应使用 ${violation.tex.slice(0, 1000)}。保留词典的数学字体和角标，不得简写；请 search_dictionary／read_dictionary_entry 核对 resolved.tex 或 resolved.markdown 后重新提出建议。`);
    }
  }
}
