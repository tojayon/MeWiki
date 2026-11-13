import Ajv from "ajv";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import { flattenResearchBlocks } from "../domain/researchBlockTree.ts";
import { normalizeResearchSymbolOrganization } from "../domain/researchSymbolOrganization.ts";
import { formulaLatexError } from "../domain/formulaLatex.ts";
import { migrateResearchMediaNotebook, normalizeMediaBlock } from "../domain/researchMedia.ts";
import { normalizeBookmarkBlock } from "../domain/researchBookmark.ts";
import { isResearchRichBlock, normalizeResearchRichBlock } from "../domain/researchRichContent.ts";
import { normalizeNoteEmbed } from '../domain/researchNoteEmbed.ts';

export const RESEARCH_LIBRARY_FILENAME = "research-library.webbench.json";
export interface ResearchLibraryFile {
  format: "webbench-research-library";
  version: 1;
  revision: string;
  savedAt: string;
  notebook: ResearchNotebookState;
  checksum: string;
}
export interface ResearchLibrarySummary {
  foundations: number;
  notes: number;
  symbols: number;
  terms: number;
  maps: number;
  savedAt: string;
}

const string = { type: "string" };
const identifier = { type: "string", minLength: 1 };
const strings = { type: "array", items: string };
const bindings = { type: "object", additionalProperties: string };
const ref = {
  type: "object",
  required: ["noteId", "formulaId", "outputId"],
  properties: {
    noteId: identifier,
    formulaId: identifier,
    outputId: identifier,
  },
};
const requireFor = (type: string, required: string[]) => ({
  if: { properties: { type: { const: type } }, required: ["type"] },
  then: { required },
});
const schema = {
  type: "object",
  required: [
    "version",
    "open",
    "view",
    "activeNoteId",
    "activeSymbolId",
    "notes",
    "symbols",
  ],
  properties: {
    version: { const: 8 },
    open: { type: "boolean" },
    view: { enum: ["dictionary", "foundations", "notes", "maps"] },
    activeNoteId: string,
    activeSymbolId: string,
    activeTermId: string,
    notes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "createdAt", "updatedAt", "blocks"],
        properties: {
          id: identifier,
          title: string,
          createdAt: string,
          updatedAt: string,
          tags: strings,
          basisNoteIds: strings,
          library: { enum: ["foundation", "research"] },
          researchType: { enum: ["application", "derivation"] },
          blocks: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "type"],
              properties: {
                id: identifier,
                section: { enum: ["given", "conclusion"] },
                type: {
                  enum: [
                    "heading",
                    "paragraph",
                    "list",
                    "markdown",
                    "callout",
                    "examples",
                    "formula",
                    "media",
                    "bookmark",
                    "citation",
                    "dataset",
                    "diagram",
                    "evidence",
                    "external",
                    "noteEmbed",
                  ],
                },
                text: string,
                title: string,
                tex: string,
                caption: string,
                conditions: string,
                level: { type: "integer", minimum: 1, maximum: 6 },
                items: strings,
                tabs: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    required: ["id", "title", "blocks"],
                    properties: {
                      id: identifier,
                      title: string,
                      blocks: {
                        type: "array",
                        items: { $ref: "#/$defs/block" },
                      },
                    },
                  },
                },
                kind: string,
                body: string,
                label: string,
                runId: string,
                runTitle: string,
                time: { type: "number" },
                parts: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["type"],
                    properties: {
                      type: {
                        enum: [
                          "symbol",
                          "operator",
                          "latex",
                          "lineBreak",
                          "alignmentPoint",
                        ],
                      },
                      entryId: identifier,
                      operator: identifier,
                      tex: { type: "string", minLength: 1, maxLength: 16000 },
                      bindings,
                      source: ref,
                    },
                    allOf: [
                      requireFor("symbol", ["entryId", "bindings"]),
                      requireFor("operator", ["operator"]),
                      requireFor("latex", ["tex"]),
                    ],
                  },
                },
                outputs: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "entryId", "bindings"],
                    properties: {
                      id: identifier,
                      entryId: identifier,
                      bindings,
                      recipe: {
                        type: "object",
                        required: ["inputs", "signature"],
                        properties: {
                          kind: { enum: ["explicit", "implicit", "joint", "related"] },
                          signature: string,
                          inputs: { type: "array", items: {
                            type: "object", required: ["entryId", "bindings", "role"],
                            properties: { entryId: identifier, bindings, source: ref,
                              role: { enum: ["derived", "parameter", "initial", "observation", "external", "index", "excluded"] } },
                          } },
                        },
                      },
                    },
                  },
                },
              },
              allOf: [
                requireFor("heading", ["text", "level"]),
                requireFor("paragraph", ["text"]),
                requireFor("markdown", ["text", "kind"]),
                requireFor("list", ["items"]),
                requireFor("formula", ["tex"]),
                requireFor("callout", ["title", "text", "appearance"]),
                requireFor("examples", ["tabs"]),
                {
                  if: { properties: { type: { const: 'noteEmbed' } }, required: ['type'] },
                  then: { required: ['sourceNoteId', 'blockIds'], properties: {
                    sourceNoteId: identifier,
                    blockIds: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: identifier },
                    sourceTitle: { type: 'string', maxLength: 1000 },
                  } },
                },
                {
                  if: { properties: { type: { const: "media" } }, required: ["type"] },
                  then: { required: ["kind"], properties: {
                    kind: { enum: ["image", "audio", "video", "pdf", "file"] },
                    alt: string, legacySource: string,
                    document: { type: "object", properties: { page: { type: "integer", minimum: 1 } } },
                    source: { oneOf: [
                      { type: "object", required: ["type", "assetId"], additionalProperties: false, properties: { type: { const: "asset" }, assetId: { type: "string", pattern: "^[a-f0-9]{64}$" } } },
                      { type: "object", required: ["type", "url"], additionalProperties: false, properties: { type: { const: "url" }, url: { type: "string", minLength: 1 } } },
                    ] },
                    display: { type: "object", properties: { align: { enum: ["left", "center", "right"] }, widthPercent: { type: "number", minimum: 25, maximum: 100 } } },
                  } },
                },
                {
                  if: { properties: { type: { const: "bookmark" } }, required: ["type"] },
                  then: { properties: { url: string, description: string, siteName: string } },
                },
                {
                  if: { properties: { type: { const: "citation" } }, required: ["type"] },
                  then: { properties: { authors: string, year: string, venue: string, doi: string, url: string, notes: string, pdfName: string, pdfPage: { type: "integer", minimum: 1 } } },
                },
                {
                  if: { properties: { type: { const: "dataset" } }, required: ["type"] },
                  then: { required: ["columns", "rows"], properties: {
                    columns: { type: "array", maxItems: 50, items: string },
                    rows: { type: "array", maxItems: 10000, items: { type: "array", maxItems: 50, items: string } },
                    sourceName: string, sheetName: string,
                    chart: { type: "object", required: ["kind", "x", "ys"], properties: { kind: { enum: ["line", "scatter", "bar"] }, x: { type: "integer", minimum: 0 }, ys: { type: "array", items: { type: "integer", minimum: 0 } } } },
                  } },
                },
                {
                  if: { properties: { type: { const: "diagram" } }, required: ["type"] },
                  then: { required: ["mode", "code", "strokes"], properties: { mode: { enum: ["mermaid", "drawing"] }, code: { type: "string", maxLength: 20000 }, strokes: { type: "array", maxItems: 500, items: { type: "object" } } } },
                },
                {
                  if: { properties: { type: { const: "examples" } }, required: ["type"] },
                  then: { properties: { labelPosition: { enum: ["left", "center", "right"] }, appearance: {
                    type: "object",
                    properties: Object.fromEntries(["borderColor", "backgroundColor", "headerBackground", "labelBackground", "labelColor", "accentColor"].map(key => [key, { type: "string", pattern: "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" }])),
                  } } },
                },
                requireFor("evidence", ["runId", "runTitle", "time"]),
                {
                  if: { properties: { type: { const: 'external' } }, required: ['type'] },
                  then: { required: ['provider', 'contentType', 'schemaVersion', 'title', 'data'], properties: {
                    provider: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$' },
                    contentType: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$' },
                    schemaVersion: { type: 'integer', minimum: 1 }, title: { type: 'string', minLength: 1, maxLength: 1000 },
                    summary: { type: 'string', maxLength: 8000 }, data: { type: 'object' }, note: { type: 'string' },
                  } },
                },
              ],
            },
          },
        },
      },
    },
    symbols: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "notation", "meaning", "category", "slots"],
        properties: {
          id: identifier,
          name: string,
          aliases: strings,
          notation: string,
          meaning: string,
          category: string,
          tags: strings,
          slots: {
            type: "array",
            items: {
              type: "object",
              required: ["key", "label", "domain", "defaultValue"],
              properties: {
                key: identifier,
                label: string,
                domain: string,
                defaultValue: string,
                description: string,
              },
            },
          },
        },
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "aliases", "meaning"],
        properties: {
          id: identifier,
          name: string,
          englishName: string,
          englishAbbreviation: string,
          chineseAbbreviation: string,
          aliases: strings,
          aliasEntries: {
            type: "array",
            items: { type: "object", required: ["id", "name"], properties: { id: identifier, name: string } },
          },
          meaning: string,
          atoms: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "text", "meaning"],
              properties: { id: identifier, text: string, meaning: string },
            },
          },
          tags: strings,
          scope: string,
          status: { enum: ["active", "deprecated"] },
        },
      },
    },
    symbolFilters: {
      type: "object",
      required: ["query", "tag"],
      properties: {
        query: string,
        category: { enum: ["all", "time", "index", "state", "control", "communication", "scheduler", "evaluation", "custom"] },
        tag: string,
      },
    },
    theoryMaps: {
      type: "object",
      required: ["documents", "activeMapId", "deletedMapIds"],
      properties: {
        activeMapId: string,
        deletedMapIds: strings,
        documents: {
          type: "array",
          items: {
            type: "object",
            required: [
              "id",
              "title",
              "kind",
              "createdAt",
              "updatedAt",
              "noteIds",
              "annotations",
              "relations",
              "view",
            ],
            properties: {
              id: identifier,
              title: string,
              kind: { enum: ["global", "topic"] },
              createdAt: string,
              updatedAt: string,
              noteIds: strings,
              annotations: { type: "array", items: { type: "object" } },
              relations: { type: "array", items: { type: "object" } },
              view: {
                type: "object",
                required: ["expandedNoteIds", "showAllBlocks", "layout"],
                properties: {
                  expandedNoteIds: strings,
                  showAllBlocks: { type: "boolean" },
                  layout: {
                    type: "object",
                    required: ["positions"],
                    properties: { positions: { type: "object" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
const validate = new Ajv({ allErrors: true, strictRequired: false }).compile({
  ...schema,
  $defs: { block: schema.properties.notes.items.properties.blocks.items },
});

export function assertResearchLibraryNotebook(
  value: unknown,
): asserts value is ResearchNotebookState {
  if (!validate(value))
    throw new Error(
      `资料库内容格式错误：${validate.errors?.[0]?.instancePath || "笔记库"} ${validate.errors?.[0]?.message ?? ""}`,
    );
  const state = value as unknown as ResearchNotebookState;
  const uniqueIds = (items: { id: string }[]) => {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error("资料库包含重复标识，已停止保存。");
  };
  uniqueIds(state.notes);
  uniqueIds(state.symbols);
  if (state.terms) uniqueIds(state.terms);
  state.terms?.forEach(term => {
    if (!term.aliasEntries) return;
    uniqueIds(term.aliasEntries);
    const names = term.aliasEntries.map(alias => alias.name.trim());
    if (names.some(name => !name) || new Set(names).size !== names.length || names.length !== term.aliases.length ||
      names.some((name, index) => name !== term.aliases[index].trim()))
      throw new Error("资料库内容格式错误：术语别名记录与别名数组不一致。");
  });
  state.notes.forEach((note) => {
    const blocks = flattenResearchBlocks(note.blocks);
    uniqueIds(blocks);
    blocks.forEach((block) => {
      if (block.type === "media") normalizeMediaBlock(block);
      if (block.type === "bookmark") normalizeBookmarkBlock(block);
      if (block.type === 'noteEmbed') normalizeNoteEmbed(block);
      if (isResearchRichBlock(block)) normalizeResearchRichBlock(block);
      if (block.type === "formula") for (const part of block.parts ?? []) {
        if (part.type === "latex") {
          const error = formulaLatexError(part.tex);
          if (error) throw new Error(`资料库 LaTeX 内容无效：${error}`);
        }
      }
      if (block.type === "formula" && block.outputs) uniqueIds(block.outputs);
      if (block.type === "examples") uniqueIds(block.tabs);
    });
  });
  if (state.theoryMaps) uniqueIds(state.theoryMaps.documents);
}

async function checksum(
  file: Omit<ResearchLibraryFile, "checksum">,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      format: file.format,
      version: file.version,
      revision: file.revision,
      savedAt: file.savedAt,
      notebook: file.notebook,
    }),
  );
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Upgrade the first text-only tab format without changing unrelated note data. */
function migrateLegacyExampleTabs(value: unknown): unknown {
  const record = (item: unknown): Record<string, unknown> | undefined =>
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : undefined;
  const notebook = record(value);
  if (!notebook || !Array.isArray(notebook.notes)) return value;
  let changed = false;
  const notes = notebook.notes.map((item) => {
    const note = record(item);
    if (!note || !Array.isArray(note.blocks)) return item;
    const ids = new Set<string>();
    const collect = (blocks: unknown[]) =>
      blocks.forEach((item) => {
        const block = record(item);
        if (typeof block?.id === "string") ids.add(block.id);
        if (block?.type === "examples" && Array.isArray(block.tabs))
          block.tabs.forEach((item) => {
            const tab = record(item);
            if (Array.isArray(tab?.blocks)) collect(tab.blocks);
          });
      });
    collect(note.blocks);
    const migrate = (blocks: unknown[]): unknown[] => {
      let nestedChanged = false;
      const result = blocks.map((item) => {
        const block = record(item);
        if (block?.type !== "examples" || !Array.isArray(block.tabs))
          return item;
        const originalTabs = block.tabs;
        const tabs = originalTabs.map((item, index) => {
          const tab = record(item);
          if (!tab) return item;
          if (Array.isArray(tab.blocks)) {
            const children = migrate(tab.blocks);
            return children === tab.blocks
              ? item
              : { ...tab, blocks: children };
          }
          if ("blocks" in tab || typeof tab.text !== "string") return item;
          const base = `${block.id}:${tab.id ?? index}:content`;
          let id = base;
          for (let suffix = 2; ids.has(id); suffix++) id = `${base}:${suffix}`;
          ids.add(id);
          const { text, ...metadata } = tab;
          return {
            ...metadata,
            blocks: text ? [{ id, type: "paragraph", text }] : [],
          };
        });
        if (tabs.every((tab, index) => tab === originalTabs[index]))
          return item;
        nestedChanged = true;
        return { ...block, tabs };
      });
      return nestedChanged ? result : blocks;
    };
    const blocks = migrate(note.blocks);
    if (blocks === note.blocks) return item;
    changed = true;
    return { ...note, blocks };
  });
  return changed ? { ...notebook, notes } : value;
}

export async function createResearchLibraryFile(
  notebook: ResearchNotebookState,
): Promise<ResearchLibraryFile> {
  assertResearchLibraryNotebook(notebook);
  const file = {
    format: "webbench-research-library" as const,
    version: 1 as const,
    revision: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    notebook: structuredClone(notebook),
  };
  return { ...file, checksum: await checksum(file) };
}

export async function parseResearchLibraryFile(
  content: string,
): Promise<ResearchLibraryFile> {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("资料库文件不是完整有效的 JSON。");
  }
  if (
    value &&
    typeof value === "object" &&
    "format" in value &&
    value.format === "webbench-browser-migration"
  ) {
    if (!("version" in value) || value.version !== 1)
      throw new Error("不支持此迁移备份版本。");
    value = "snapshot" in value ? value.snapshot : null;
  }
  if (
    !value ||
    typeof value !== "object" ||
    (value as ResearchLibraryFile).format !== "webbench-research-library"
  )
    throw new Error("请选择完整的 MeWiki 资料库备份文件。");
  const file = value as ResearchLibraryFile;
  if (file.version !== 1 || ![4, 5, 6, 7, 8].includes(file.notebook?.version))
    throw new Error("不支持此资料库版本，请使用对应版本的工作台打开。");
  if (
    typeof file.revision !== "string" ||
    !file.revision ||
    typeof file.savedAt !== "string" ||
    !Number.isFinite(Date.parse(file.savedAt))
  )
    throw new Error("资料库文件格式错误：缺少修订号或保存时间。");
  if (
    typeof file.checksum !== "string" ||
    file.checksum !== (await checksum(file))
  )
    throw new Error("资料库完整性校验失败，文件可能已被修改或损坏。");
  const notebook = migrateResearchMediaNotebook(migrateLegacyExampleTabs(file.notebook));
  assertResearchLibraryNotebook(notebook);
  const organized = normalizeResearchSymbolOrganization(notebook);
  if (organized === file.notebook) return file;
  const migrated = { ...file, notebook: organized };
  return { ...migrated, checksum: await checksum(migrated) };
}

export function researchLibrarySummary(
  file: ResearchLibraryFile,
): ResearchLibrarySummary {
  return {
    foundations: file.notebook.notes.filter(
      (note) => note.library === "foundation",
    ).length,
    notes: file.notebook.notes.filter((note) => note.library !== "foundation")
      .length,
    symbols: file.notebook.symbols.length,
    terms: file.notebook.terms?.length ?? 0,
    maps: file.notebook.theoryMaps?.documents.length ?? 0,
    savedAt: file.savedAt,
  };
}
