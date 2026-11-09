import type { ResearchSymbolEntry, SymbolIndexSlot } from "./researchDictionary.ts";

export const symbolPositions = [
  { key: "x1", label: "右上角标 x1" },
  { key: "x2", label: "右下角标 x2" },
  { key: "x3", label: "右侧变量 x3" },
] as const;
export const symbolPositionSuffix = "^{[x1]}_{[x2]}[x3]";

export function positionSlots(values: Record<string, string> = {}, descriptions: Record<string, string> = {}): SymbolIndexSlot[] {
  return symbolPositions.map(({ key, label }) => ({ key, label, domain: "generic", optional: true, defaultValue: values[key] ?? "",
    ...(typeof descriptions[key] === "string" ? { description: descriptions[key] } : {}),
  }));
}

export function isPositionalSymbol(entry: ResearchSymbolEntry) {
  return entry.notation.endsWith(symbolPositionSuffix);
}

function texAtomEnd(tex: string, start: number): number {
  if (tex[start] === "{") {
    let depth = 1;
    for (let at = start + 1; at < tex.length; at++) {
      if (tex[at] === "\\") { at++; continue; }
      if (tex[at] === "{") depth++;
      if (tex[at] === "}" && --depth === 0) return at + 1;
    }
    return tex.length;
  }
  if (tex[start] === "\\") return start + (tex.slice(start).match(/^\\[a-zA-Z]+|^\\./)?.[0].length ?? 1);
  return start + 1;
}

/** Read top-level adornments only; commands such as dot/boldsymbol retain their nested groups. */
function splitLegacyTex(tex: string, argumentOnly = false) {
  let base = "", x1 = "", x2 = "", x3 = "";
  for (let at = 0; at < tex.length;) {
    const char = tex[at];
    if (char === "^" || char === "_") {
      const end = texAtomEnd(tex, at + 1);
      const atom = tex.slice(at + 1, end);
      const value = atom.startsWith("{") ? atom.slice(1, -1) : atom;
      if (char === "^") x1 += value; else x2 += value;
      at = end;
      continue;
    }
    if (argumentOnly || char === "(" || char === "[" || x3) { x3 += tex.slice(at); break; }
    if (char === "\\") {
      const end = texAtomEnd(tex, at);
      base += tex.slice(at, end);
      at = end;
    } else if (char === "{") {
      const end = texAtomEnd(tex, at);
      base += tex.slice(at, end);
      at = end;
    } else { base += char; at++; }
  }
  return { base, x1, x2, x3 };
}

/** One-time saved-data migration. New formula editing never calls this renderer. */
function renderLegacySymbol(entry: ResearchSymbolEntry, bindings: Record<string, string>) {
  let notation = entry.notation;
  for (const slot of entry.slots) {
    if (slot.domain === "loop" || slot.placement === "parentheses") notation = notation.replaceAll(`([${slot.key}])`, `[${slot.key}]`);
  }
  const render = (key: string) => {
    const slot = entry.slots.find((item) => item.key === key);
    const value = bindings[key] ?? "";
    if (!value) return "";
    if (slot?.domain === "loop") return value.startsWith("(") && value.endsWith(")") ? value : `(${value})`;
    return slot?.placement === "parentheses" ? `(${value})` : value;
  };
  const tex = notation.replace(/\[([a-zA-Z0-9_-]+)\]/g, (_match, key: string) => render(key));
  return { tex, argumentOnly: /^\[[a-zA-Z0-9_-]+\]$/.test(notation) };
}

export function legacyBindingsToPositions(entry: ResearchSymbolEntry, bindings: Record<string, string>) {
  const { tex, argumentOnly } = renderLegacySymbol(entry, bindings);
  const parsed = splitLegacyTex(tex, argumentOnly);
  const suffixes = entry.slots.filter((slot) => slot.placement === "suffix-subscript").map((slot) => bindings[slot.key]).filter(Boolean);
  if (suffixes.length) parsed.x2 = [parsed.x2, ...suffixes].filter(Boolean).join(",");
  return { x1: parsed.x1, x2: parsed.x2, x3: parsed.x3 };
}

export function toPositionalSymbol(entry: ResearchSymbolEntry): ResearchSymbolEntry {
  const defaults = Object.fromEntries(entry.slots.map((slot) => [slot.key, slot.defaultValue]));
  if (isPositionalSymbol(entry)) {
    const descriptions = Object.fromEntries(entry.slots.filter(slot => typeof slot.description === "string").map(slot => [slot.key, slot.description!]));
    return { ...entry, slots: positionSlots(defaults, descriptions) };
  }
  const values = legacyBindingsToPositions(entry, defaults);
  const { tex, argumentOnly } = renderLegacySymbol(entry, defaults);
  const { base } = splitLegacyTex(tex, argumentOnly);
  return { ...entry, notation: base + symbolPositionSuffix, slots: positionSlots(values) };
}
