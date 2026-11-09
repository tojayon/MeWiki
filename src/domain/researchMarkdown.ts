import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ResearchNotebookBlock } from "./researchNotebook.ts";
import { readCalloutMarker } from "./researchCallout.ts";
import type { ResearchExampleTab } from "./researchExamples.ts";

export const researchMarkdownKinds = [
  "quote",
  "code",
  "orderedList",
  "taskList",
  "table",
  "image",
  "divider",
  "markdown",
] as const;
export type ResearchMarkdownKind = (typeof researchMarkdownKinds)[number];

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

interface OutlineTextNode {
  type: string;
  value?: string;
  alt?: string | null;
  children?: OutlineTextNode[];
}

/** Use Markdown's actual code boundaries, including indented and nested fenced blocks. */
export function isResearchMarkdownCodeAt(source: string, offset: number): boolean {
  type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] };
  const containsCode = (node: Node): boolean => node.type === "code"
    ? offset >= (node.position?.start.offset ?? 0) && offset <= (node.position?.end.offset ?? source.length)
    : node.children?.some(containsCode) ?? false;
  return containsCode(parser.parse(source));
}

function outlineText(node: OutlineTextNode): string {
  if (node.type === "html") return "";
  return node.value ?? node.alt ?? node.children?.map(outlineText).join("") ?? "";
}

/** Document headings only: quoted examples, code and generated footnote labels are excluded. */
export function researchMarkdownHeadings(source: string) {
  return parser.parse(source).children.flatMap(node => node.type === "heading" ? [{
    level: node.depth,
    text: node.children.map(outlineText).join("").replace(/\s+/g, " ").trim(),
    offset: node.position?.start.offset ?? 0,
  }] : []);
}

/** Platform line endings and the export's outer blank lines do not change content. */
export function normalizeReadableResearchMarkdown(source: string): string {
  return source.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
}

/** Literal prose can share the editor's whitespace without losing Markdown formatting or decoding. */
export function isPlainResearchText(source: string): boolean {
  const text = source.replace(/\r\n?/g, "\n");
  return parser
    .parse(text)
    .children.every(
      (node) =>
        node.type === "paragraph" &&
        node.children.every(
          (child) =>
            child.type === "text" &&
            text.slice(
              child.position?.start.offset,
              child.position?.end.offset,
            ) === child.value,
        ),
    );
}

/** Keep the source so nested structures, fences, numbering and alignment survive export. */
export function parseMarkdownBlocks(
  source: string,
  title: string,
  makeId: () => string,
  normalizeBlock?: (value: unknown) => ResearchNotebookBlock | null,
  restoreExampleSnapshots = true,
): ResearchNotebookBlock[] {
  const nodes = parser.parse(source).children;
  const blocks: ResearchNotebookBlock[] = [];
  let start = 0;
  let section: "given" | "conclusion" | undefined;
  const append = (end: number) => {
    const parsed = parseMarkdownWithCallouts(
      source.slice(start, end),
      start === 0 ? title : "",
      makeId,
      normalizeBlock,
      restoreExampleSnapshots,
    );
    blocks.push(
      ...parsed.map((block) => (section ? { ...block, section } : block)),
    );
  };
  for (const node of nodes) {
    if (node.type !== "html") continue;
    const marker =
      /^<!-- webbench-section: (given|conclusion|derivation) -->$/.exec(
        node.value.trim(),
      );
    if (!marker) continue;
    append(node.position!.start.offset!);
    section =
      marker[1] === "derivation"
        ? undefined
        : (marker[1] as "given" | "conclusion");
    start = node.position!.end.offset!;
  }
  append(source.length);
  return blocks;
}

function parseMarkdownWithCallouts(
  source: string,
  title: string,
  makeId: () => string,
  normalizeBlock?: (value: unknown) => ResearchNotebookBlock | null,
  restoreExampleSnapshots = true,
): ResearchNotebookBlock[] {
  const nodes = parser.parse(source).children;
  const blocks: ResearchNotebookBlock[] = [];
  let start = 0;
  for (let index = 0; index < nodes.length - 1; index++) {
    const node = nodes[index];
    const next = nodes[index + 1];
    if (node.type !== "html" || next.type !== "blockquote") continue;
    const structured = /^<!-- webbench-examples: (.+) -->$/.exec(
      node.value.trim(),
    );
    const quoted = source.slice(
      next.position!.start.offset!,
      next.position!.end.offset!,
    );
    const closing = nodes[index + 2];
    if (
      structured &&
      closing?.type === "html" &&
      closing.value.trim() === "<!-- /webbench-examples -->"
    ) {
      let block: ResearchNotebookBlock | null = null;
      try {
        const data: unknown = JSON.parse(structured[1]);
        if (
          restoreExampleSnapshots &&
          normalizeBlock &&
          data &&
          typeof data === "object" &&
          "version" in data &&
          data.version === 1 &&
          "block" in data &&
          "readable" in data &&
          typeof data.readable === "string" &&
          normalizeReadableResearchMarkdown(data.readable) ===
            normalizeReadableResearchMarkdown(quoted)
        )
          block = normalizeBlock(data.block);
      } catch {
        /* The visible quote is authoritative when the saved structure cannot be verified. */
      }
      blocks.push(
        ...parseStandardMarkdownBlocks(
          source.slice(start, node.position!.start.offset!),
          start === 0 ? title : "",
          makeId,
        ),
        block?.type === "examples"
          ? block
          : { id: makeId(), type: "markdown", kind: "quote", text: quoted },
      );
      start = closing.position!.end.offset!;
      index += 2;
      continue;
    }
    const examples =
      restoreExampleSnapshots &&
      node.value.trim() === "<!-- webbench-examples -->"
        ? parseQuotedExamples(quoted, makeId, normalizeBlock)
        : null;
    const metadata = examples ? null : readCalloutMarker(node.value);
    if (!examples && !metadata) continue;
    const markerStart = node.position!.start.offset!;
    blocks.push(
      ...parseStandardMarkdownBlocks(
        source.slice(start, markerStart),
        start === 0 ? title : "",
        makeId,
      ),
    );
    if (examples)
      blocks.push({ id: makeId(), type: "examples", tabs: examples });
    else if (metadata) {
      const text = quoted
        .split("\n")
        .map((line) => line.replace(/^> ?/, ""))
        .slice(2)
        .join("\n");
      blocks.push({ id: makeId(), type: "callout", ...metadata, text });
    }
    start = next.position!.end.offset!;
    index++;
  }
  blocks.push(
    ...parseStandardMarkdownBlocks(
      source.slice(start),
      start === 0 ? title : "",
      makeId,
    ),
  );
  return blocks;
}

function parseQuotedExamples(
  quoted: string,
  makeId: () => string,
  normalizeBlock?: (value: unknown) => ResearchNotebookBlock | null,
): ResearchExampleTab[] | null {
  const source = quoted
    .split("\n")
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n");
  const nodes = parser.parse(source).children;
  const markers: { id: string; title: string; start: number; body: number }[] =
    [];
  for (const [index, node] of nodes.entries()) {
    if (
      node.type !== "html" ||
      !node.value.trim().startsWith("<!-- webbench-example:")
    )
      continue;
    const match = /^<!-- webbench-example: (.+) -->$/.exec(node.value.trim());
    const heading = nodes[index + 1];
    if (!match || heading?.type !== "heading" || heading.depth !== 3)
      return null;
    try {
      const data: unknown = JSON.parse(match[1]);
      if (
        !data ||
        typeof data !== "object" ||
        !("id" in data) ||
        typeof data.id !== "string" ||
        !("title" in data) ||
        typeof data.title !== "string"
      )
        return null;
      markers.push({
        id: data.id,
        title: data.title,
        start: node.position!.start.offset!,
        body: heading.position!.end.offset!,
      });
    } catch {
      return null;
    }
  }
  if (!markers.length) return null;
  const ids = new Set<string>();
  return markers.map((marker, index) => {
    let text = source
      .slice(marker.body, markers[index + 1]?.start ?? source.length)
      .replace(/^\n\n/, "");
    if (index + 1 < markers.length) text = text.replace(/\n\n$/, "");
    const id = marker.id && !ids.has(marker.id) ? marker.id : makeId();
    ids.add(id);
    return {
      id,
      title: marker.title,
      blocks: parseMarkdownBlocks(text, "", makeId, normalizeBlock),
    };
  });
}

function parseStandardMarkdownBlocks(
  source: string,
  title: string,
  makeId: () => string,
): ResearchNotebookBlock[] {
  const tree = parser.parse(source);
  const blocks: ResearchNotebookBlock[] = [];
  const slice = (node: {
    position?: { start: { offset?: number }; end: { offset?: number } };
  }) =>
    source.slice(
      node.position?.start.offset ?? 0,
      node.position?.end.offset ?? 0,
    );
  const hasReference = (node: {
    type: string;
    children?: { type: string }[];
  }): boolean =>
    ["linkReference", "imageReference", "footnoteReference"].includes(
      node.type,
    ) ||
    (node.children?.some(hasReference) ?? false);
  const definitionIndices = tree.children.flatMap((node, index) =>
    ["definition", "footnoteDefinition"].includes(node.type) ? [index] : [],
  );
  const referenceIndices = definitionIndices.length
    ? tree.children.flatMap((node, index) =>
        hasReference(node) ? [index] : [],
      )
    : [];
  const sharedStart = definitionIndices.length
    ? Math.min(...definitionIndices, ...referenceIndices)
    : -1;
  const sharedEnd = definitionIndices.length
    ? Math.max(...definitionIndices, ...referenceIndices)
    : -1;
  for (const [index, node] of tree.children.entries()) {
    if (index === sharedStart) {
      blocks.push({
        id: makeId(),
        type: "markdown",
        kind: "markdown",
        text: source.slice(
          node.position?.start.offset ?? 0,
          tree.children[sharedEnd].position?.end.offset ?? source.length,
        ),
      });
      continue;
    }
    if (index > sharedStart && index <= sharedEnd) continue;
    const text = slice(node);
    if (node.type === "heading") {
      const first = node.children[0]?.position?.start.offset;
      const last = node.children.at(-1)?.position?.end.offset;
      const value =
        first !== undefined && last !== undefined
          ? source.slice(first, last)
          : "";
      if (title && node.depth === 1 && blocks.length === 0 && value === title)
        continue;
      blocks.push({
        id: makeId(),
        type: "heading",
        level: node.depth,
        text: value,
      });
      continue;
    }
    if (node.type === "math") {
      blocks.push({ id: makeId(), type: "formula", tex: node.value });
      continue;
    }
    if (node.type === "paragraph") {
      const displayMath = /^\\\[\s*\n([\s\S]*?)\n\\\]$/.exec(text);
      if (displayMath)
        blocks.push({ id: makeId(), type: "formula", tex: displayMath[1] });
      else if (
        node.children.length === 1 &&
        ["image", "imageReference"].includes(node.children[0].type)
      )
        blocks.push({ id: makeId(), type: "markdown", kind: "image", text });
      else blocks.push({ id: makeId(), type: "paragraph", text });
      continue;
    }
    if (
      node.type === "list" &&
      !node.ordered &&
      node.children.every(
        (item) =>
          item.checked == null &&
          item.children.length === 1 &&
          item.children[0].type === "paragraph",
      )
    ) {
      blocks.push({
        id: makeId(),
        type: "list",
        items: node.children.map((item) => slice(item.children[0])),
      });
      continue;
    }
    const kind: ResearchMarkdownKind =
      node.type === "blockquote"
        ? "quote"
        : node.type === "code"
          ? "code"
          : node.type === "table"
            ? "table"
            : node.type === "thematicBreak"
              ? "divider"
              : node.type === "list" &&
                  node.children.some((item) => item.checked != null)
                ? "taskList"
                : node.type === "list" && node.ordered
                  ? "orderedList"
                  : "markdown";
    blocks.push({ id: makeId(), type: "markdown", kind, text });
  }
  return blocks;
}

export function createMarkdownSource(
  kind: ResearchMarkdownKind,
  content?: string,
): string {
  if (kind === "quote")
    return (content ?? "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  if (kind === "code") {
    const text = content ?? "";
    const fence = "`".repeat(
      Math.max(
        3,
        ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1),
      ),
    );
    return `${fence}${content === undefined ? "python" : "text"}\n${text}\n${fence}`;
  }
  if (kind === "orderedList")
    return (content ?? "")
      .split("\n")
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");
  if (kind === "taskList")
    return (content ?? "")
      .split("\n")
      .map((line) => `- [ ] ${line}`)
      .join("\n");
  if (kind === "table")
    return content === undefined
      ? "|  |  |\n| :--- | :--- |\n|  |  |"
      : `| 内容 |\n| --- |\n${content
          .split("\n")
          .map((line) => `| ${line.replaceAll("|", "\\|")} |`)
          .join("\n")}`;
  if (kind === "image")
    return `![]()${content ? `\n\n${content}` : ""}`;
  if (kind === "divider") return `---${content ? `\n\n${content}` : ""}`;
  return content ?? "";
}
