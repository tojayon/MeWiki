export type CalloutBorderStyle = "solid" | "dashed" | "dashdot";

export interface CalloutAppearance {
  labelBackground: string;
  labelColor: string;
  borderColor: string;
  borderStyle: CalloutBorderStyle;
  borderWidth: number;
}

export interface ResearchCalloutBlock {
  id: string;
  type: "callout";
  title: string;
  text: string;
  appearance: CalloutAppearance;
}

export const defaultCalloutAppearance: Readonly<CalloutAppearance> = {
  labelBackground: "#153b6d",
  labelColor: "#ffffff",
  borderColor: "#224f82",
  borderStyle: "solid",
  borderWidth: 1,
};

export function normalizeCalloutColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const color = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) return color;
  if (/^#[\da-f]{3}$/.test(color)) return "#" + [...color.slice(1)].map((part) => part.repeat(2)).join("");
  return fallback;
}

export function normalizeCalloutAppearance(value: unknown): CalloutAppearance {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    labelBackground: normalizeCalloutColor(data.labelBackground, defaultCalloutAppearance.labelBackground),
    labelColor: normalizeCalloutColor(data.labelColor, defaultCalloutAppearance.labelColor),
    borderColor: normalizeCalloutColor(data.borderColor, defaultCalloutAppearance.borderColor),
    borderStyle: data.borderStyle === "dashed" || data.borderStyle === "dashdot" ? data.borderStyle : "solid",
    borderWidth: typeof data.borderWidth === "number" && Number.isFinite(data.borderWidth)
      ? Math.min(6, Math.max(0.5, data.borderWidth)) : defaultCalloutAppearance.borderWidth,
  };
}

export function readCalloutMarker(source: string): Pick<ResearchCalloutBlock, "title" | "appearance"> | null {
  const marker = /^<!-- webbench-callout: (.+) -->$/.exec(source.trim());
  if (!marker) return null;
  try {
    const data: unknown = JSON.parse(marker[1]);
    if (!data || typeof data !== "object" || !("title" in data) || typeof data.title !== "string") return null;
    return { title: data.title, appearance: normalizeCalloutAppearance("appearance" in data ? data.appearance : undefined) };
  } catch { return null; }
}

export function serializeCalloutMarkdown(block: ResearchCalloutBlock): string {
  const metadata = JSON.stringify({ title: block.title, appearance: block.appearance }).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  const label = block.title.replace(/\r?\n/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
  const body = block.text.split("\n").map((line) => `> ${line}`).join("\n");
  return `<!-- webbench-callout: ${metadata} -->\n\n> **${label}**\n>\n${body}`;
}
