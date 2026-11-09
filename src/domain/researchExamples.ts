import type { ResearchNotebookBlock } from "./researchNotebook.ts";
import { normalizeReadableResearchMarkdown } from "./researchMarkdown.ts";
import { normalizeCalloutColor } from "./researchCallout.ts";
import { isResearchRichBlock, researchRichText } from "./researchRichContent.ts";

export interface ResearchTabsAppearance {
  borderColor: string;
  backgroundColor: string;
  headerBackground: string;
  labelBackground: string;
  labelColor: string;
  accentColor: string;
}

export const defaultTabsAppearance: Readonly<ResearchTabsAppearance> = {
  borderColor: "#bccde2", backgroundColor: "#ffffff", headerBackground: "#edf3fb",
  labelBackground: "#153b6d", labelColor: "#ffffff", accentColor: "#1547c0",
};

export const researchTabsPresets = [
  { name: "蓝色", appearance: { ...defaultTabsAppearance } },
  { name: "绿色", appearance: { borderColor: "#a8c8b0", backgroundColor: "#f6fbf7", headerBackground: "#e7f3ea", labelBackground: "#245c38", labelColor: "#ffffff", accentColor: "#287547" } },
  { name: "橙色", appearance: { borderColor: "#d9bf99", backgroundColor: "#fffbf4", headerBackground: "#f8eddb", labelBackground: "#794613", labelColor: "#ffffff", accentColor: "#9b5a14" } },
  { name: "紫色", appearance: { borderColor: "#c7b7dc", backgroundColor: "#fcf9ff", headerBackground: "#f0eafa", labelBackground: "#593b7e", labelColor: "#ffffff", accentColor: "#7449a4" } },
] satisfies { name: string; appearance: ResearchTabsAppearance }[];

export function normalizeTabsAppearance(value: unknown): ResearchTabsAppearance {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(defaultTabsAppearance).map(([key, fallback]) => [key, normalizeCalloutColor(data[key], fallback)])) as unknown as ResearchTabsAppearance;
}

export function researchTabsTitle(block: Pick<ResearchExamplesBlock, "title">): string {
  return block.title === undefined ? "举例" : block.title.trim() || "标签页";
}

export interface ResearchExampleTab {
  id: string;
  title: string;
  blocks: ResearchNotebookBlock[];
}

export type ResearchTabsLabelPosition = "left" | "center" | "right";

export interface ResearchExamplesBlock {
  id: string;
  type: "examples";
  title?: string;
  labelPosition?: ResearchTabsLabelPosition;
  appearance?: ResearchTabsAppearance;
  tabs: ResearchExampleTab[];
}

export function createExampleTab(title: string): ResearchExampleTab {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `example-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    blocks: [],
  };
}

export function normalizeExampleTabs(
  value: unknown,
  makeId: () => string,
  normalizeBlock: (value: unknown) => ResearchNotebookBlock | null,
): ResearchExampleTab[] {
  const ids = new Set<string>();
  const tabs: ResearchExampleTab[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (
      !item ||
      typeof item !== "object" ||
      !("blocks" in item || "text" in item)
    )
      continue;
    const tab = item as Record<string, unknown>;
    if (!Array.isArray(tab.blocks) && typeof tab.text !== "string") continue;
    const tabId =
      typeof tab.id === "string" && tab.id && !ids.has(tab.id)
        ? tab.id
        : makeId();
    ids.add(tabId);
    const children = Array.isArray(tab.blocks)
      ? tab.blocks
      : typeof tab.text === "string" && tab.text
        ? [{ id: makeId(), type: "paragraph", text: tab.text }]
        : [];
    tabs.push({
      id: tabId,
      title:
        typeof tab.title === "string" && tab.title.trim()
          ? tab.title
          : `例 ${tabs.length + 1}`,
      blocks: children.flatMap((child) => {
        const normalized = normalizeBlock(child);
        return normalized ? [normalized] : [];
      }),
    });
  }
  return tabs.length ? tabs : [{ id: makeId(), title: "例 1", blocks: [] }];
}

export function examplesText(block: ResearchExamplesBlock): string {
  const text = (child: ResearchNotebookBlock): string => {
    if (isResearchRichBlock(child)) return researchRichText(child);
    if (child.type === "bookmark") return [child.title, child.description, child.siteName, child.url].filter(Boolean).join("\n");
    if (child.type === "media") return [child.alt, child.caption, child.legacySource, child.source?.type === "asset" ? `webbench-asset:${child.source.assetId}` : child.source?.url].filter(Boolean).join("\n");
    if (child.type === "examples") return examplesText(child);
    if (child.type === "list") return child.items.join("\n");
    if (child.type === "formula")
      return [
        child.tex ? `$${child.tex}$` : "",
        child.caption,
        child.conditions,
      ]
        .filter(Boolean)
        .join("\n");
    if (child.type === "evidence")
      return [child.runTitle, child.eventLabel, child.note]
        .filter(Boolean)
        .join("\n");
    if (child.type === 'external') return [child.title, child.summary, child.note].filter(Boolean).join('\n');
    if (child.type === 'noteEmbed') return `引用笔记内容 · ${child.sourceTitle || '来源笔记'}`;
    return child.type === "callout"
      ? [child.title, child.text].filter(Boolean).join("\n")
      : child.text;
  };
  const contents = block.tabs
    .map((tab) =>
      [tab.title, ...tab.blocks.map(text)].filter(Boolean).join("\n"),
    )
    .join("\n\n");
  return block.title ? `${researchTabsTitle(block)}\n${contents}` : contents;
}

/** The quoted fallback remains readable in Markdown viewers without WebBench tabs. */
export function serializeExamplesMarkdown(
  block: ResearchExamplesBlock,
  renderBlocks: (blocks: ResearchNotebookBlock[]) => string,
): string {
  const tabs = block.tabs.map((tab) => {
    const label = tab.title
      .replace(/\r?\n/g, " ")
      .replace(/[\\`*_[\]<>]/g, "\\$&");
    return `### ${label}\n\n${renderBlocks(tab.blocks)}`;
  });
  const title = researchTabsTitle(block).replace(/\r?\n/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
  const quoted = [`**${title}**`, ...tabs]
    .join("\n\n")
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  const metadata = JSON.stringify({
    version: 1,
    block,
    readable: normalizeReadableResearchMarkdown(quoted),
  })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `<!-- webbench-examples: ${metadata} -->\n\n${quoted}\n\n<!-- /webbench-examples -->`;
}
