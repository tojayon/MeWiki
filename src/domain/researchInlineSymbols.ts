import { resolveSymbolEntry, type ResearchSymbolEntry } from "./researchDictionary.ts";
import { symbolPositionSuffix } from "./researchSymbolPositions.ts";

export interface InlineResearchSymbol {
  start: number;
  end: number;
  bindings: Record<string, string>;
  bindingsByEntryId?: Record<string, Record<string, string>>;
  candidates: ResearchSymbolEntry[];
}

interface Token { text: string; start: number; end: number }
const tokenize = (tex: string): Token[] => [...tex.matchAll(/\\[a-zA-Z]+|\\[\s\S]|%[^\n]*|\s+|[\s\S]/g)]
  .filter(match => !/^\s|^%/.test(match[0])).map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
const styledAtoms = new Set(["\\boldsymbol", "\\mathbf", "\\mathrm", "\\mathit", "\\mathsf", "\\mathtt", "\\mathcal", "\\mathbb", "\\mathfrak", "\\mathscr", "\\bm", "\\bold", "\\dot", "\\ddot", "\\hat", "\\widehat", "\\tilde", "\\widetilde", "\\vec", "\\bar", "\\overline", "\\underline", "\\breve", "\\check", "\\acute", "\\grave"]);
const literalAtoms = new Set(["\\text", "\\textrm", "\\textsf", "\\texttt", "\\textbf", "\\textit", "\\textup", "\\textmd", "\\textnormal", "\\emph", "\\mbox", "\\operatorname", "\\phantom", "\\hphantom", "\\vphantom"]);
const greek = new Map(Object.entries({
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", varkappa: "ϰ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
}).map(([command, glyph]) => ["\\" + command, glyph]));
const comparableToken = (text: string) => greek.get(text) ?? text;
const comparable = (tex: string) => {
  let value = tex.replace(/\\(?:left|right)\b/g, "").replace(/\s+/g, "");
  for (let previous = ""; previous !== value;) { previous = value; value = value.replace(/\{([^{}])\}/g, "$1"); }
  return value;
};

function groupEnd(tokens: Token[], start: number) {
  let depth = 0;
  for (let at = start; at < tokens.length; at++) {
    if (tokens[at].text === "{") depth++;
    if (tokens[at].text === "}" && --depth === 0) return at + 1;
  }
  return undefined;
}

function atomEnd(tokens: Token[], start: number): number | undefined {
  const token = tokens[start]?.text;
  if (!token || ["^", "_", "}"].includes(token)) return undefined;
  if (token === "{") return groupEnd(tokens, start);
  if (styledAtoms.has(token) || literalAtoms.has(token)) return atomEnd(tokens, start + 1);
  return start + 1;
}

function argumentEnd(tokens: Token[], start: number) {
  const opening = tokens[start]?.text;
  if (opening === "\\left") {
    let depth = 0;
    for (let at = start; at < tokens.length; at++) {
      if (tokens[at].text === "\\left") depth++;
      if (tokens[at].text === "\\right" && --depth === 0) return tokens[at + 1] ? at + 2 : undefined;
    }
  }
  if (opening !== "(" && opening !== "[") return undefined;
  const stack: string[] = [];
  for (let at = start; at < tokens.length; at++) {
    const text = tokens[at].text;
    if (text === "(" || text === "[") stack.push(text === "(" ? ")" : "]");
    if ((text === ")" || text === "]") && stack.pop() !== text) return undefined;
    if (!stack.length) return at + 1;
  }
  return undefined;
}

function lookupTokens(tokens: Token[]) {
  const parts: { text: string; start: number; end: number }[] = [];
  for (let at = 0; at < tokens.length; at++) {
    // Braces around a single ordinary atom do not change its notation.
    if (tokens[at].text === "{" && tokens[at + 2]?.text === "}" && atomEnd(tokens, at + 1) === at + 2) {
      parts.push({ text: comparableToken(tokens[at + 1].text), start: at, end: at + 3 });
      at += 2;
    } else parts.push({ text: comparableToken(tokens[at].text), start: at, end: at + 1 });
  }
  return parts;
}

/** Read TeX tokens, never letters inside a command or text-mode argument. */
export function findInlineResearchSymbols(tex: string, symbols: readonly ResearchSymbolEntry[]): InlineResearchSymbol[] {
  if (!symbols.length) return [];
  const tokens = tokenize(tex);
  const lookup = lookupTokens(tokens);
  const lookupAt = new Map(lookup.map((token, index) => [token.start, index]));
  const patterns = new Map<string, { tokens: ReturnType<typeof lookupTokens>; entries: ResearchSymbolEntry[] }[]>();
  for (const entry of symbols) {
    const body = entry.notation.endsWith(symbolPositionSuffix) ? entry.notation.slice(0, -symbolPositionSuffix.length) : entry.notation;
    const fallback = resolveSymbolEntry(entry, Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
    const parts = lookupTokens(tokenize(body || fallback));
    if (!parts.length) continue;
    const existing = patterns.get(parts[0].text) ?? [];
    const shared = existing.find(pattern => pattern.tokens.map(token => token.text).join("\0") === parts.map(token => token.text).join("\0"));
    if (shared) shared.entries.push(entry);
    else existing.push({ tokens: parts, entries: [entry] });
    patterns.set(parts[0].text, existing);
  }
  for (const values of patterns.values()) values.sort((a, b) => b.tokens.length - a.tokens.length);
  const matches: InlineResearchSymbol[] = [];
  for (let at = 0; at < tokens.length;) {
    const start = lookupAt.get(at);
    const pattern = start === undefined ? undefined : patterns.get(lookup[start].text)?.find(pattern => pattern.tokens.every((token, index) => lookup[start + index]?.text === token.text));
    if (pattern) {
      let end = lookup[start! + pattern.tokens.length - 1].end;
      const bindings: Record<string, string> = { x1: "", x2: "", x3: "" };
      let complete = true;
      while (["^", "_", "\\limits", "\\nolimits", "\\displaylimits"].includes(tokens[end]?.text)) {
        if (tokens[end].text.startsWith("\\")) { end++; continue; }
        const key = tokens[end].text === "^" ? "x1" : "x2";
        const valueStart = end + 1;
        const valueEnd = atomEnd(tokens, valueStart);
        if (valueEnd === undefined) { complete = false; break; }
        bindings[key] = tokens[valueStart].text === "{"
          ? tex.slice(tokens[valueStart].end, tokens[valueEnd - 1].start)
          : tex.slice(tokens[valueStart].start, tokens[valueEnd - 1].end);
        end = valueEnd;
      }
      if (!complete) { at = tokens.length; continue; }
      const rightEnd = argumentEnd(tokens, end);
      if (rightEnd !== undefined) { bindings.x3 = tex.slice(tokens[end].start, tokens[rightEnd - 1].end); end = rightEnd; }
      // An explicitly saved suffix can also be unbracketed, e.g. a right-side t.
      if (!bindings.x3) {
        const suffix = pattern.entries.map(entry => entry.slots.find(slot => slot.key === "x3")?.defaultValue ?? "")
          .filter(Boolean).map(value => ({ value, tokens: tokenize(value) }))
          .sort((a, b) => b.tokens.length - a.tokens.length)
          .find(suffix => suffix.tokens.length && suffix.tokens.every((token, index) => tokens[end + index]?.text === token.text));
        if (suffix) { bindings.x3 = tex.slice(tokens[end].start, tokens[end + suffix.tokens.length - 1].end); end += suffix.tokens.length; }
      }
      const instance = tex.slice(tokens[at].start, tokens[end - 1].end);
      const exact = pattern.entries.filter(entry => {
        const defaults = Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]));
        return comparable(resolveSymbolEntry(entry, defaults).tex) === comparable(instance);
      });
      const candidates = exact.length ? exact : pattern.entries;
      const literalBindings = Object.fromEntries(candidates.filter(entry => entry.notation === symbolPositionSuffix)
        .map(entry => [entry.id, { x1: "", x2: "", x3: instance }]));
      matches.push({ start: tokens[at].start, end: tokens[end - 1].end, bindings, candidates,
        ...(Object.keys(literalBindings).length ? { bindingsByEntryId: literalBindings } : {}),
      });
      at = end;
      continue;
    }
    const command = tokens[at].text;
    if (styledAtoms.has(command) || literalAtoms.has(command)) {
      const argument = command === "\\operatorname" && tokens[at + 1]?.text === "*" ? at + 2 : at + 1;
      at = atomEnd(tokens, argument) ?? tokens.length;
    } else if (command === "\\begin") {
      const environmentEnd = atomEnd(tokens, at + 1);
      if (environmentEnd === undefined) { at = tokens.length; continue; }
      const environment = tokens.slice(at + 2, environmentEnd - 1).map(token => token.text).join("");
      at = environmentEnd;
      // Alignment letters describe columns; only the cells contain math.
      if (["array", "darray", "subarray"].includes(environment)) at = atomEnd(tokens, at) ?? tokens.length;
      else if (/^[pbBvV]?matrix\*$/.test(environment) && tokens[at]?.text === "[") at = argumentEnd(tokens, at) ?? tokens.length;
    } else if (["\\textcolor", "\\color", "\\end"].includes(command)) at = atomEnd(tokens, at + 1) ?? tokens.length;
    else if (["\\left", "\\right"].includes(command)) at += 2;
    else at++;
  }
  return matches;
}
