import {
  formulaPartsToTex,
  resolveSymbolEntry,
  isFormulaOperator,
  normalizeSymbolEntries,
  type FormulaLayout,
  type FormulaPart,
  type FormulaOutput,
  type ResearchSymbolEntry,
} from "./researchDictionary.ts";
import { listFormulaConsumers } from "./researchFormulaLinks.ts";
import { isResearchRichBlock, normalizeResearchRichBlock, serializeResearchRichMarkdown, type ResearchRichContentBlock } from "./researchRichContent.ts";
import { formulaLatexError } from "./formulaLatex.ts";
import { normalizeFormulaRecipe } from "./researchRecipeMetadata.ts";
import { normalizeSymbolFilters, type ResearchSymbolFilters } from "./researchSymbolOrganization.ts";
import { createMeWikiExampleNotebook } from "./meWikiExamples.ts";
import {
  isPositionalSymbol,
  legacyBindingsToPositions,
} from "./researchSymbolPositions.ts";
import { legacySymbolLayouts } from "./researchLegacySymbols.ts";
import {
  invalidateResearchReviews,
  normalizeNoteFilters,
  normalizeNoteOrganization,
  type NoteReviewStatus,
  type ResearchNoteFilters,
} from "./researchNoteOrganization.ts";
import {
  createMarkdownSource,
  normalizeReadableResearchMarkdown,
  parseMarkdownBlocks,
  researchMarkdownKinds,
  type ResearchMarkdownKind,
} from "./researchMarkdown.ts";
import {
  defaultCalloutAppearance,
  normalizeCalloutAppearance,
  serializeCalloutMarkdown,
  type ResearchCalloutBlock,
} from "./researchCallout.ts";
import {
  getResearchNoteMetadata,
  normalizeStoredFrontmatter,
  noteFieldsFromMetadata,
  readResearchFrontmatter,
  serializeMetadataYaml,
  type ResearchFrontmatter,
} from "./researchFrontmatter.ts";
import {
  ensureTheoryMaps,
  invalidateTheoryReviews,
  normalizeResearchTheoryMap,
  normalizeTheoryKnowledge,
  normalizeTheoryMapWorkspace,
  retainRemovedTheoryNote,
  type ResearchTheoryMapState,
  type TheoryKnowledge,
  type TheoryMapWorkspace,
} from "./researchTheoryMap.ts";
import {
  getNoteLibrary,
  organizeResearchNoteLibraries,
  type ResearchNoteLibrary,
  type ResearchNoteType,
} from "./researchNoteLibraries.ts";
import {
  defaultTabsAppearance,
  examplesText,
  normalizeExampleTabs,
  normalizeTabsAppearance,
  serializeExamplesMarkdown,
  type ResearchExamplesBlock,
} from "./researchExamples.ts";
import {
  findResearchBlock,
  flattenResearchBlocks,
  getResearchBlockContainer,
  mapResearchBlocks,
  replaceResearchBlockContainer,
  updateResearchBlockTree,
  type ResearchExampleContainer,
} from "./researchBlockTree.ts";
import { legacyResearchImage, migrateResearchMediaNotebook, normalizeMediaBlock, serializeResearchMediaMarkdown, type ResearchMediaBlock } from "./researchMedia.ts";
import { normalizeBookmarkBlock, serializeBookmarkMarkdown, type ResearchBookmarkBlock } from "./researchBookmark.ts";
import { normalizeExternalBlock, externalContentText, type ExternalContentBlock } from '../integrations/externalContent.ts';
import { normalizeNoteEmbed, resolveNoteEmbed, noteEmbedSelectionError, noteEmbedBlockLabel, type ResearchNoteEmbedBlock } from './researchNoteEmbed.ts';

export interface ResearchFormulaBlock {
  id: string;
  type: "formula";
  tex: string;
  caption?: string;
  conditions?: string;
  outputs?: FormulaOutput[];
  parts?: FormulaPart[];
  layout?: FormulaLayout;
}

export type ResearchTheorySection = "given" | "conclusion";

export type ResearchNotebookBlock = (
  | { id: string; type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "markdown"; kind: ResearchMarkdownKind; text: string }
  | ResearchCalloutBlock
  | ResearchExamplesBlock
  | ResearchFormulaBlock
  | ResearchMediaBlock
  | ResearchBookmarkBlock
  | ResearchRichContentBlock
  | ExternalContentBlock
  | ResearchNoteEmbedBlock
  | {
      id: string;
      type: "evidence";
      runId: string;
      runTitle: string;
      time: number;
      loopId?: string;
      packetId?: string;
      eventLabel?: string;
      note?: string;
    }
) & { section?: ResearchTheorySection };

export type ResearchContentType =
  Exclude<ResearchNotebookBlock["type"], "markdown" | "media"> | ResearchMarkdownKind | ResearchMediaBlock["kind"];

export function researchContentType(
  block: ResearchNotebookBlock,
): ResearchContentType {
  return block.type === "markdown" || block.type === "media" ? block.kind : block.type;
}

export interface ResearchNote {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  blocks: ResearchNotebookBlock[];
  reviewStatus?: NoteReviewStatus;
  reviewedAt?: string;
  tags?: string[];
  frontmatter?: ResearchFrontmatter;
  theory?: TheoryKnowledge;
  library?: ResearchNoteLibrary;
  researchType?: ResearchNoteType;
  basisNoteIds?: string[];
}

export interface ResearchNotebookState {
  version: 8;
  open: boolean;
  view: "dictionary" | "foundations" | "notes" | "maps";
  activeNoteId: string;
  activeSymbolId: string;
  symbols: ResearchSymbolEntry[];
  notes: ResearchNote[];
  modelLibraryVersion?: number;
  noteFilters?: ResearchNoteFilters;
  symbolFilters?: ResearchSymbolFilters;
  theoryMap?: ResearchTheoryMapState;
  theoryMaps?: TheoryMapWorkspace;
  noteLibraryVersion?: number;
  foundationFilters?: ResearchNoteFilters;
  librarySelections?: Partial<Record<ResearchNoteLibrary, string>>;
}

const id = () =>
  globalThis.crypto?.randomUUID?.() ??
  `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function createResearchNote(
  title = "未命名笔记",
  now = new Date().toISOString(),
): ResearchNote {
  return {
    id: id(),
    title,
    createdAt: now,
    updatedAt: now,
    blocks: [],
    reviewStatus: "pending",
    tags: [],
  };
}

/** Minimal portable examples; the application adds the manual separately. */
export function createResearchNotebook(): ResearchNotebookState {
  return createMeWikiExampleNotebook();
}

export function deleteResearchNote(
  state: ResearchNotebookState,
  noteId: string,
): ResearchNotebookState {
  if (
    state.notes.length <= 1 ||
    !state.notes.some((note) => note.id === noteId)
  )
    return state;
  if (
    state.notes.some(
      (note) =>
        note.id !== noteId &&
        (note.basisNoteIds?.includes(noteId) ||
          flattenResearchBlocks(note.blocks).some(
            (block) =>
              block.type === "formula" &&
              block.parts?.some(
                (part) =>
                  part.type === "symbol" && part.source?.noteId === noteId,
              ),
          )),
    )
  )
    return state;
  state = retainRemovedTheoryNote(state, noteId);
  const notes = state.notes.filter((note) => note.id !== noteId);
  const library = getNoteLibrary(
    state.notes.find((note) => note.id === noteId)!,
  );
  return {
    ...state,
    notes,
    activeNoteId:
      state.activeNoteId === noteId
        ? (notes.find((note) => getNoteLibrary(note) === library) ?? notes[0])
            .id
        : state.activeNoteId,
  };
}

type NewBlock = ResearchNotebookBlock;

export function appendResearchBlock(
  state: ResearchNotebookState,
  noteId: string,
  block: NewBlock,
): ResearchNotebookState {
  return insertResearchBlock(state, noteId, block);
}

export function insertResearchBlock(
  state: ResearchNotebookState,
  noteId: string,
  block: ResearchNotebookBlock,
  beforeBlockId?: string,
  container?: ResearchExampleContainer,
): ResearchNotebookState {
  const note = state.notes.find((note) => note.id === noteId);
  if (!note) return state;
  const existingIds = new Set(
    flattenResearchBlocks(note.blocks).map((item) => item.id),
  );
  const insertedIds = flattenResearchBlocks([block]).map((item) => item.id);
  if (
    new Set(insertedIds).size !== insertedIds.length ||
    insertedIds.some((id) => existingIds.has(id))
  )
    return state;
  const siblings = getResearchBlockContainer(note.blocks, container);
  if (!siblings) return state;
  const position =
    beforeBlockId === undefined
      ? siblings.length
      : siblings.findIndex((existing) => existing.id === beforeBlockId);
  if (position < 0) return state;
  return updateResearchNote(state, noteId, {
    blocks: replaceResearchBlockContainer(note.blocks, container, [
      ...siblings.slice(0, position),
      block,
      ...siblings.slice(position),
    ]),
  });
}

type ResearchEvidenceContext = Omit<
  Extract<ResearchNotebookBlock, { type: "evidence" }>,
  "id" | "type" | "note"
>;

function researchBlockText(block: ResearchNotebookBlock) {
  if (block.type === 'noteEmbed') return noteEmbedBlockLabel(block);
  if (block.type === 'external') return externalContentText(block);
  if (block.type === "diagram" && block.code.trim() && block.strokes.length) return [serializeResearchRichMarkdown({ ...block, mode: "mermaid" }), serializeResearchRichMarkdown({ ...block, mode: "drawing" })].join("\n\n");
  if (isResearchRichBlock(block)) return serializeResearchRichMarkdown(block);
  if (block.type === "media") return serializeResearchMediaMarkdown(block);
  if (block.type === "bookmark") return serializeBookmarkMarkdown(block);
  if (
    block.type === "heading" ||
    block.type === "paragraph" ||
    block.type === "markdown"
  )
    return block.text;
  if (block.type === "callout")
    return [block.title, block.text].filter(Boolean).join("\n");
  if (block.type === "examples") return examplesText(block);
  if (block.type === "list") return block.items.join("\n");
  if (block.type === "formula") {
    return [
      block.tex ? `$${block.tex}$` : "",
      block.caption?.trim(),
      block.conditions?.trim() ? `条件：${block.conditions.trim()}` : "",
      ...(block.outputs ?? []).map((output) => {
        const bindings = Object.entries(output.bindings)
          .map(([key, value]) => `${key}=${value}`)
          .join(",");
        return `结果 ${output.id}：${output.entryId}${bindings ? `，${bindings}` : ""}`;
      }),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `回放：${block.runTitle}`,
    `运行：${block.runId}`,
    `t = ${block.time} s`,
    block.loopId ? `环路：${block.loopId}` : "",
    block.packetId ? `数据包：${block.packetId}` : "",
    block.eventLabel ? `事件：${block.eventLabel}` : "",
    block.note?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function convertResearchBlockType(
  block: ResearchNotebookBlock,
  type: ResearchContentType,
  evidence?: ResearchEvidenceContext,
): ResearchNotebookBlock | null {
  let converted = convertResearchBlockContent(block, type, evidence);
  if (converted && isResearchRichBlock(converted)) {
    try { converted = normalizeResearchRichBlock(converted); }
    catch (cause) { throw new Error(`${cause instanceof Error ? cause.message : "当前内容不能转换为此类型。"} 原内容已保留。`); }
  }
  return converted && block.section
    ? { ...converted, section: block.section }
    : converted;
}

function convertResearchBlockContent(
  block: ResearchNotebookBlock,
  type: ResearchContentType,
  evidence?: ResearchEvidenceContext,
): ResearchNotebookBlock | null {
  if (researchContentType(block) === type) return block;
  const text = researchBlockText(block);
  if (type === "image" || type === "audio" || type === "video" || type === "pdf" || type === "file") {
    if (block.type === "citation" && block.pdf && (type === "pdf" || type === "file")) return { id: block.id, type: "media", kind: type, source: block.pdf, alt: block.pdfName || block.title, caption: serializeResearchRichMarkdown(block), ...(type === "pdf" ? { document: { page: block.pdfPage ?? 1 } } : {}) };
    if (block.type === "dataset" && block.source && type === "file") return { id: block.id, type: "media", kind: "file", source: block.source, alt: block.sourceName || block.title, caption: serializeResearchRichMarkdown(block) };
    const existing = block.type === "media" ? block : block.type === "markdown" && block.kind === "image" ? legacyResearchImage(block) : null;
    return { id: block.id, type: "media", kind: type,
      ...(existing && (existing.kind === type || type === "file") ? { source: existing.source, alt: existing.alt, display: existing.display, legacySource: existing.legacySource, caption: existing.caption } : { caption: text }) };
  }
  if (type === "bookmark") {
    try { return normalizeBookmarkBlock({ id: block.id, type, url: text.trim() }); }
    catch { return { id: block.id, type, description: text }; }
  }
  if (type === "citation") return { id: block.id, type, ...(block.type === "media" && block.kind === "pdf" ? { pdf: block.source, pdfName: block.alt, pdfPage: block.document?.page, notes: block.caption } : { notes: text }) };
  if (type === "dataset") return { id: block.id, type, columns: [], rows: [], ...(block.type === "media" && block.kind === "file" ? { source: block.source, sourceName: block.alt, title: block.caption } : { title: text }) };
  if (type === "diagram") return { id: block.id, type, mode: "mermaid", code: block.type === "markdown" && block.kind === "code" ? text.replace(/^```(?:mermaid)?[^\n]*\n/, "").replace(/\n```\s*$/, "") : text, strokes: [] };
  if (type === "evidence")
    return evidence ? { id: block.id, type, ...evidence, note: text } : null;
  if (type === 'external' || type === 'noteEmbed') return null;
  if (type === "formula")
    return { id: block.id, type, tex: text, caption: "由原内容转换" };
  if (type === "heading")
    return {
      id: block.id,
      type,
      level: block.type === "heading" ? block.level : 2,
      text,
    };
  if (type === "paragraph") return { id: block.id, type, text };
  if (type === "examples")
    return {
      id: block.id,
      type,
      title: "标签页",
      appearance: { ...defaultTabsAppearance },
      tabs: [
        {
          id: id(),
          title: "标签 1",
          blocks: [{ ...block, id: id(), section: undefined }],
        },
        { id: id(), title: "标签 2", blocks: [] },
      ],
    };
  if (type === "callout")
    return {
      id: block.id,
      type,
      title: "提示",
      text,
      appearance: { ...defaultCalloutAppearance },
    };
  if (type === "list")
    return {
      id: block.id,
      type,
      items: block.type === "list" ? [...block.items] : text.split("\n"),
    };
  return {
    id: block.id,
    type: "markdown",
    kind: type,
    text: createMarkdownSource(type, text),
  };
}

export function createResearchContentBlock(
  type: ResearchContentType,
  evidence?: ResearchEvidenceContext,
): ResearchNotebookBlock | null {
  const blockId = id();
  if (type === 'external' || type === 'noteEmbed') return null;
  if (type === "image" || type === "audio" || type === "video" || type === "pdf" || type === "file") return { id: blockId, type: "media", kind: type };
  if (type === "bookmark") return { id: blockId, type };
  if (type === "citation") return { id: blockId, type };
  if (type === "dataset") return { id: blockId, type, columns: [], rows: [] };
  if (type === "diagram") return { id: blockId, type, mode: "mermaid", code: "flowchart LR\n  A[开始] --> B[完成]", strokes: [] };
  if (type === "examples")
    return {
      id: blockId,
      type,
      title: "标签页",
      appearance: { ...defaultTabsAppearance },
      tabs: [
        { id: id(), title: "标签 1", blocks: [] },
        { id: id(), title: "标签 2", blocks: [] },
      ],
    };
  if (type === "heading")
    return { id: blockId, type, level: 2, text: "" };
  if (type === "paragraph")
    return { id: blockId, type, text: "" };
  if (type === "callout")
    return {
      id: blockId,
      type,
      title: "提示",
      text: "",
      appearance: { ...defaultCalloutAppearance },
    };
  if (type === "list") return { id: blockId, type, items: [""] };
  if (type === "formula")
    return { id: blockId, type, tex: "", parts: [], caption: "" };
  if (type === "evidence")
    return evidence ? { id: blockId, type, ...evidence } : null;
  return {
    id: blockId,
    type: "markdown",
    kind: type,
    text: createMarkdownSource(type),
  };
}

export function updateResearchNote(
  state: ResearchNotebookState,
  noteId: string,
  patch: Partial<Pick<ResearchNote, "title" | "blocks">>,
): ResearchNotebookState {
  const existing = state.notes.find((note) => note.id === noteId);
  if (
    !existing ||
    ((patch.title === undefined || patch.title === existing.title) &&
      (patch.blocks === undefined ||
        JSON.stringify(patch.blocks) === JSON.stringify(existing.blocks)))
  )
    return state;
  return {
    ...state,
    notes: invalidateTheoryReviews(
      {
        ...state,
        notes: invalidateResearchReviews(
          state.notes.map((note) =>
            note.id === noteId
              ? { ...note, ...patch, updatedAt: new Date().toISOString() }
              : note,
          ),
          [noteId],
        ),
      },
      [noteId],
    ),
  };
}

export function removeResearchBlock(
  state: ResearchNotebookState,
  noteId: string,
  blockId: string,
): ResearchNotebookState {
  const note = state.notes.find((item) => item.id === noteId);
  const block = note && findResearchBlock(note.blocks, blockId)?.block;
  if (!note || !block) return state;
  const removedBlocks = flattenResearchBlocks([block]);
  const removedIds = new Set(removedBlocks.map((item) => item.id));
  if (
    removedBlocks.some(
      (item) =>
        item.type === "formula" &&
        listFormulaConsumers(state, { noteId, formulaId: item.id }).some(
          (consumer) =>
            consumer.noteId !== noteId || !removedIds.has(consumer.formulaId),
        ),
    )
  )
    return state;
  return updateResearchNote(state, noteId, {
    blocks: updateResearchBlockTree(note.blocks, blockId, () => null),
  });
}

const isBlankResearchText = (text: string) => /^[\s\u200b]*$/u.test(text);

/** Commit finished edits so selecting and replacing all text never removes the editor mid-input. */
export function commitResearchTextBlock(
  state: ResearchNotebookState,
  noteId: string,
  blockId: string,
  source: string,
): ResearchNotebookState {
  const note = state.notes.find((note) => note.id === noteId);
  const block = note && findResearchBlock(note.blocks, blockId)?.block;
  if (
    !note ||
    !block ||
    !["paragraph", "heading", "markdown", "list"].includes(block.type)
  )
    return state;
  const text = source.replace(/\r\n?/g, "\n");
  if (isBlankResearchText(text))
    return removeResearchBlock(state, noteId, blockId);
  let replacement: ResearchNotebookBlock;
  if (block.type === "list") {
    const parsed = parseMarkdownBlocks(text, "", () => blockId, validBlock);
    const list = parsed.length === 1 && ["list", "markdown"].includes(parsed[0].type) ? parsed[0] : undefined;
    replacement = list?.type === "list" && list.items.some(item => item.includes("\n"))
      ? { id: blockId, type: "markdown", kind: "markdown", text }
      : list ?? { ...block, items: text.split("\n").map(item => item.replace(/^[-+*][ \t]+/, "")) };
  }
  else {
    const parsed = parseMarkdownBlocks(text, "", () => blockId, validBlock);
    const heading =
      parsed.length === 1 && parsed[0].type === "heading"
        ? parsed[0]
        : undefined;
    if (heading && isBlankResearchText(heading.text))
      return removeResearchBlock(state, noteId, blockId);
    replacement =
      heading ??
      (block.type === "heading"
        ? { id: blockId, type: "paragraph", text }
        : ({ ...block, text } as ResearchNotebookBlock));
  }
  return updateResearchNote(state, noteId, {
    blocks: updateResearchBlockTree(note.blocks, blockId, () => ({
      ...replacement,
      ...(block.section ? { section: block.section } : {}),
    })),
  });
}

function validBlock(value: unknown): ResearchNotebookBlock | null {
  const block = validBlockContent(value);
  if (!block) return null;
  const section = (value as Record<string, unknown>).section;
  return section === "given" || section === "conclusion"
    ? { ...block, section }
    : block;
}

function validBlockContent(value: unknown): ResearchNotebookBlock | null {
  if (!value || typeof value !== "object") return null;
  const block = value as Record<string, unknown>;
  if (typeof block.id !== "string" || typeof block.type !== "string")
    return null;
  if (block.type === 'noteEmbed') {
    try { return normalizeNoteEmbed(block); }
    catch { return { id: block.id, type: 'paragraph', text: JSON.stringify(block) }; }
  }
  if (block.type === 'external') {
    try { return normalizeExternalBlock(block); }
    catch { return { id: block.id, type: 'paragraph', text: JSON.stringify(block) }; }
  }
  if (isResearchRichBlock(block as { type: string })) {
    try { return normalizeResearchRichBlock(block); }
    catch { return { id: block.id, type: "paragraph", text: JSON.stringify(block) }; }
  }
  if (block.type === "bookmark") {
    try { return normalizeBookmarkBlock(block); }
    catch { return { id: block.id, type: "paragraph", text: JSON.stringify(block) }; }
  }
  if (block.type === "media") {
    try { return normalizeMediaBlock(block); }
    catch { return { id: block.id, type: "media", kind: ["audio", "video", "pdf", "file"].includes(String(block.kind)) ? block.kind as ResearchMediaBlock["kind"] : "image", legacySource: JSON.stringify(block), ...(typeof block.caption === "string" ? { caption: block.caption } : {}), ...(typeof block.alt === "string" ? { alt: block.alt } : {}) }; }
  }
  if (block.type === "markdown" && block.kind === "image" && typeof block.text === "string") {
    const image = legacyResearchImage({ id: block.id, text: block.text });
    if (image) return image;
  }
  if (block.type === "examples")
    return {
      id: block.id,
      type: "examples",
      ...(typeof block.title === "string" ? { title: block.title.trim() || "标签页" } : {}),
      ...(block.labelPosition === "left" || block.labelPosition === "center" || block.labelPosition === "right" ? { labelPosition: block.labelPosition } : {}),
      ...(block.appearance !== undefined ? { appearance: normalizeTabsAppearance(block.appearance) } : {}),
      tabs: normalizeExampleTabs(block.tabs, id, validBlock),
    };
  if (
    ["heading", "paragraph", "markdown"].includes(block.type) &&
    typeof block.text === "string" &&
    isBlankResearchText(block.text)
  )
    return null;
  if (block.type === "callout" && typeof block.text === "string")
    return {
      id: block.id,
      type: "callout",
      title: typeof block.title === "string" ? block.title : "提示",
      text: block.text,
      appearance: normalizeCalloutAppearance(block.appearance),
    };
  if (
    (block.type === "heading" || block.type === "paragraph") &&
    typeof block.text === "string"
  ) {
    if (block.type === "paragraph")
      return { id: block.id, type: "paragraph", text: block.text };
    return typeof block.level === "number" &&
      [1, 2, 3, 4, 5, 6].includes(block.level)
      ? {
          id: block.id,
          type: "heading",
          level: block.level as 1 | 2 | 3 | 4 | 5 | 6,
          text: block.text,
        }
      : null;
  }
  if (
    block.type === "markdown" &&
    typeof block.text === "string" &&
    researchMarkdownKinds.includes(block.kind as ResearchMarkdownKind)
  )
    return {
      id: block.id,
      type: "markdown",
      kind: block.kind as ResearchMarkdownKind,
      text: block.text,
    };
  if (
    block.type === "list" &&
    Array.isArray(block.items) &&
    block.items.every((item) => typeof item === "string")
  )
    return block.items.every(isBlankResearchText)
      ? null
      : { id: block.id, type: "list", items: block.items };
  if (block.type === "formula" && typeof block.tex === "string") {
    const parts = Array.isArray(block.parts)
      ? block.parts.flatMap((part): FormulaPart[] => {
          if (!part || typeof part !== "object") return [];
          const value = part as Record<string, unknown>;
          if (
            value.type === "symbol" &&
            typeof value.entryId === "string" &&
            value.bindings &&
            typeof value.bindings === "object" &&
            !Array.isArray(value.bindings)
          ) {
            const source = value.source as Record<string, unknown> | undefined;
            const reference =
              source &&
              typeof source.noteId === "string" &&
              typeof source.formulaId === "string" &&
              typeof source.outputId === "string"
                ? {
                    noteId: source.noteId,
                    formulaId: source.formulaId,
                    outputId: source.outputId,
                  }
                : undefined;
            return [
              {
                type: "symbol",
                entryId: value.entryId,
                bindings: Object.fromEntries(
                  Object.entries(value.bindings).filter(
                    (entry): entry is [string, string] =>
                      typeof entry[1] === "string",
                  ),
                ),
                ...(reference ? { source: reference } : {}),
              },
            ];
          }
          if (
            value.type === "operator" &&
            typeof value.operator === "string" &&
            isFormulaOperator(value.operator)
          )
            return [
              {
                type: "operator",
                operator: value.operator as Extract<
                  FormulaPart,
                  { type: "operator" }
                >["operator"],
              },
            ];
          if (value.type === "latex" && typeof value.tex === "string" && !formulaLatexError(value.tex)) return [{ type: "latex", tex: value.tex }];
          if (value.type === "lineBreak") return [{ type: "lineBreak" }];
          if (value.type === "alignmentPoint")
            return [{ type: "alignmentPoint" }];
          return [];
        })
      : undefined;
    const outputs = Array.isArray(block.outputs)
      ? block.outputs.flatMap((item): FormulaOutput[] => {
          if (!item || typeof item !== "object") return [];
          const output = item as Record<string, unknown>;
          if (
            typeof output.id !== "string" ||
            typeof output.entryId !== "string" ||
            !output.bindings ||
            typeof output.bindings !== "object" ||
            Array.isArray(output.bindings)
          )
            return [];
          const recipe = normalizeFormulaRecipe(output.recipe);
          return [
            {
              id: output.id,
              entryId: output.entryId,
              bindings: Object.fromEntries(
                Object.entries(output.bindings).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
                ),
              ),
              ...(recipe ? { recipe } : {}),
            },
          ];
        })
      : undefined;
    return {
      id: block.id,
      type: "formula",
      tex: block.tex,
      ...(typeof block.caption === "string" ? { caption: block.caption } : {}),
      ...(typeof block.conditions === "string"
        ? { conditions: block.conditions }
        : {}),
      ...(block.layout === "centered" || block.layout === "aligned"
        ? { layout: block.layout }
        : {}),
      ...(outputs ? { outputs } : {}),
      ...(parts ? { parts } : {}),
    };
  }
  if (
    block.type === "evidence" &&
    typeof block.runId === "string" &&
    typeof block.runTitle === "string" &&
    typeof block.time === "number" &&
    Number.isFinite(block.time)
  )
    return {
      id: block.id,
      type: "evidence",
      runId: block.runId,
      runTitle: block.runTitle,
      time: block.time,
      ...(typeof block.loopId === "string" ? { loopId: block.loopId } : {}),
      ...(typeof block.packetId === "string"
        ? { packetId: block.packetId }
        : {}),
      ...(typeof block.eventLabel === "string"
        ? { eventLabel: block.eventLabel }
        : {}),
      ...(typeof block.note === "string" ? { note: block.note } : {}),
    };
  return null;
}

export function normalizeResearchNotebook(
  value: unknown,
  fallback: () => ResearchNotebookState = createResearchNotebook,
): ResearchNotebookState {
  if (!value || typeof value !== "object") return fallback();
  const state = value as Record<string, unknown>;
  if (
    (state.version !== 1 &&
      state.version !== 2 &&
      state.version !== 3 &&
      state.version !== 4 &&
      state.version !== 5 &&
      state.version !== 6 &&
      state.version !== 7 &&
      state.version !== 8) ||
    !Array.isArray(state.notes)
  )
    return fallback();
  const notes = state.notes.flatMap((item): ResearchNote[] => {
    if (!item || typeof item !== "object") return [];
    const note = item as Record<string, unknown>;
    if (
      typeof note.id !== "string" ||
      typeof note.title !== "string" ||
      !Array.isArray(note.blocks)
    )
      return [];
    const blocks = note.blocks.flatMap((block) => {
      const valid = validBlock(block);
      return valid ? [valid] : [];
    });
    const now = new Date().toISOString();
    return [
      {
        id: note.id,
        title: note.title,
        createdAt: typeof note.createdAt === "string" ? note.createdAt : now,
        updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : now,
        blocks,
        ...normalizeNoteOrganization(note),
        ...(note.frontmatter
          ? { frontmatter: normalizeStoredFrontmatter(note.frontmatter) }
          : {}),
        ...(note.theory
          ? { theory: normalizeTheoryKnowledge(note.theory) }
          : {}),
        ...(note.library === "foundation" || note.library === "research"
          ? { library: note.library }
          : {}),
        ...(note.researchType === "application" ||
        note.researchType === "derivation"
          ? { researchType: note.researchType }
          : {}),
        ...(Array.isArray(note.basisNoteIds)
          ? {
              basisNoteIds: [
                ...new Set(
                  note.basisNoteIds.filter(
                    (id): id is string =>
                      typeof id === "string" && id !== note.id,
                  ),
                ),
              ],
            }
          : {}),
      },
    ];
  });
  if (state.notes.length && !notes.length) return fallback();
  const savedSymbols = Array.isArray(state.symbols)
    ? (state.symbols as ResearchSymbolEntry[])
    : [];
  const symbols = normalizeSymbolEntries(state.symbols);
  const symbolIds = new Set(symbols.map(entry => entry.id));
  // Only migrate the storage representation of named slots. User prose, raw TeX,
  // symbol definitions and explicitly stored references are never model-upgraded.
  const migratedNotes = notes.map((note) => ({
    ...note,
    blocks: mapResearchBlocks(note.blocks, (block): ResearchNotebookBlock => {
      if (block.type !== "formula") return block;
      let migrated = false;
      const migrateBindings = (value: { entryId: string; bindings: Record<string, string> }) => {
        if (!symbolIds.has(value.entryId)) return value.bindings;
        const keys = Object.keys(value.bindings);
        if (keys.some(key => ["x1", "x2", "x3"].includes(key))) return value.bindings;
        const saved = savedSymbols.find(item => item?.id === value.entryId && typeof item.notation === "string" && Array.isArray(item.slots) && item.slots.every(slot => slot && typeof slot.key === "string" && typeof slot.defaultValue === "string"));
        const legacy = keys.length && Object.hasOwn(legacySymbolLayouts, value.entryId)
          ? legacySymbolLayouts[value.entryId] : undefined;
        const layout = saved && !isPositionalSymbol(saved) ? saved : legacy;
        if (!layout) return value.bindings;
        migrated = true;
        const defaults = Object.fromEntries(layout.slots.map(slot => [slot.key, slot.defaultValue]));
        return legacyBindingsToPositions(layout as ResearchSymbolEntry, { ...defaults, ...value.bindings });
      };
      const parts = block.parts?.map((part): FormulaPart => part.type === "symbol" ? { ...part, bindings: migrateBindings(part) } : part);
      const rendered = migrated && parts ? formulaPartsToTex(parts, symbols, block.layout) : undefined;
      const outputs = block.outputs?.map(output => ({ ...output, bindings: migrateBindings(output) }));
      return { ...block,
        ...(parts ? { parts, ...(rendered && !rendered.errors.length ? { tex: rendered.tex } : {}) } : {}),
        ...(outputs ? { outputs } : {}),
      };
    }),
  }));
  const normalized: ResearchNotebookState = {
    version: 8,
    ...(typeof state.modelLibraryVersion === "number" ? { modelLibraryVersion: state.modelLibraryVersion } : {}),
    open: state.open === true,
    view:
      state.view === "maps"
        ? "maps"
        : state.view === "foundations"
          ? "foundations"
          : state.view === "notes"
            ? "notes"
            : "dictionary",
    activeNoteId: migratedNotes.some((note) => note.id === state.activeNoteId)
      ? String(state.activeNoteId)
      : (migratedNotes[0]?.id ?? ""),
    symbols,
    activeSymbolId:
      typeof state.activeSymbolId === "string" &&
      symbols.some((entry) => entry.id === state.activeSymbolId)
        ? state.activeSymbolId
        : (symbols[0]?.id ?? ""),
    notes: migratedNotes,
    ...(state.noteFilters
      ? { noteFilters: normalizeNoteFilters(state.noteFilters) }
      : {}),
    ...(state.symbolFilters
      ? { symbolFilters: normalizeSymbolFilters(state.symbolFilters) }
      : {}),
    ...(state.foundationFilters
      ? { foundationFilters: normalizeNoteFilters(state.foundationFilters) }
      : {}),
    ...(typeof state.noteLibraryVersion === "number"
      ? { noteLibraryVersion: state.noteLibraryVersion }
      : {}),
    ...(state.librarySelections && typeof state.librarySelections === "object"
      ? {
          librarySelections: Object.fromEntries(
            Object.entries(state.librarySelections).filter(
              ([key, value]) =>
                ["foundation", "research"].includes(key) &&
                typeof value === "string",
            ),
          ),
        }
      : {}),
    ...(normalizeTheoryMapWorkspace(state.theoryMaps)
      ? { theoryMaps: normalizeTheoryMapWorkspace(state.theoryMaps) }
      : state.theoryMap
        ? {
            theoryMap: normalizeResearchTheoryMap(
              state.theoryMap,
              migratedNotes,
              String(state.activeNoteId),
            ),
          }
        : {}),
  };
  return organizeResearchNoteLibraries(normalized.theoryMap ? ensureTheoryMaps(normalized) : normalized);
}

export function renderedFormulaTex(
  block: Extract<ResearchNotebookBlock, { type: "formula" }>,
  symbols: ResearchSymbolEntry[],
) {
  return block.parts
    ? formulaPartsToTex(block.parts, symbols, block.layout)
    : { tex: block.tex, errors: ["此公式尚未关联符号词条"] };
}

export function parseResearchMarkdown(
  markdown: string,
  title = "导入研究笔记",
): ResearchNote {
  const note = createResearchNote(title);
  const frontmatter = readResearchFrontmatter(markdown);
  markdown = frontmatter.body;
  if (frontmatter.metadata)
    Object.assign(note, noteFieldsFromMetadata(frontmatter.metadata, note));
  const metadata = /^<!-- webbench-note: (.+) -->\r?\n?/.exec(markdown);
  if (metadata) {
    try {
      const value: unknown = JSON.parse(metadata[1]);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(
          note,
          normalizeNoteOrganization(value as Record<string, unknown>),
        );
        markdown = markdown.slice(metadata[0].length);
      }
    } catch {
      /* Treat malformed headers as normal Markdown text. */
    }
  }
  const snapshot = /^\s*<!-- webbench-blocks: (.+) -->\r?\n?/.exec(markdown);
  let restoreExampleSnapshots = true;
  if (snapshot) {
    markdown = markdown.slice(snapshot[0].length);
    restoreExampleSnapshots = false;
    try {
      const value: unknown = JSON.parse(snapshot[1]);
      if (
        value &&
        typeof value === "object" &&
        "version" in value &&
        value.version === 1 &&
        "noteId" in value &&
        typeof value.noteId === "string" &&
        "blocks" in value &&
        Array.isArray(value.blocks) &&
        "readable" in value &&
        typeof value.readable === "string" &&
        normalizeReadableResearchMarkdown(value.readable) ===
          normalizeReadableResearchMarkdown(markdown)
      ) {
        const blocks = value.blocks.map(validBlock);
        if (
          blocks.every(
            (block): block is ResearchNotebookBlock => block !== null,
          )
        ) {
          const ids = flattenResearchBlocks(blocks).map((block) => block.id);
          if (new Set(ids).size === ids.length) {
            const originalNoteId = value.noteId;
            note.blocks = mapResearchBlocks(blocks, (block) => {
              if (block.type === 'noteEmbed' && block.sourceNoteId === originalNoteId) return { ...block, sourceNoteId: note.id };
              if (block.type !== "formula" || !block.parts) return block;
              const parts = block.parts.map((part): FormulaPart =>
                part.type === "symbol" && part.source?.noteId === originalNoteId
                  ? { ...part, source: { ...part.source, noteId: note.id } }
                  : part,
              );
              return parts.some((part, index) => part !== block.parts![index])
                ? { ...block, parts }
                : block;
            });
            return note;
          }
        }
      }
    } catch {
      /* Treat a malformed snapshot as ordinary Markdown. */
    }
  }
  note.blocks = parseMarkdownBlocks(
    markdown.replace(/\r\n?/g, "\n"),
    note.title,
    id,
    validBlock,
    restoreExampleSnapshots,
  );
  note.blocks = migrateResearchMediaNotebook({ version: 4, notes: [{ blocks: note.blocks }] }).notes[0].blocks;
  return note;
}

export function serializeResearchMarkdown(
  note: ResearchNote,
  symbols: ResearchSymbolEntry[] = [],
  notes: ResearchNote[] = [],
): string {
  const renderBlocks = (blocks: ResearchNotebookBlock[], ownerNoteId = note.id, path: string[] = []): string =>
    blocks.map(block => renderBlock(block, ownerNoteId, path)).join("\n\n");
  const renderBlock = (block: ResearchNotebookBlock, ownerNoteId = note.id, path: string[] = []): string => {
    if (block.type === 'noteEmbed') {
      const address = JSON.stringify([ownerNoteId, block.id]);
      const error = path.includes(address) ? '循环引用已停止展开。' : noteEmbedSelectionError(notes, { noteId: ownerNoteId, blockId: block.id }, block, false);
      const source = resolveNoteEmbed(notes, block);
      const title = (source.note?.title || block.sourceTitle || '来源笔记').replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&');
      const body = error || (!source.note ? '来源笔记已删除或不在当前资料库中。' : source.items.map(item => item.block ? renderBlock(item.block, source.note!.id, [...path, address]) : '所引用的内容已删除，请重新选择。').join('\n\n'));
      return [`引用笔记内容：[${title}](#research-note/${encodeURIComponent(block.sourceNoteId)})`, body].join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
    }
    if (block.type === 'external') return externalContentText(block).split('\n').map(line => `> ${line}`).join('\n');
    if (isResearchRichBlock(block)) return serializeResearchRichMarkdown(block);
    if (block.type === "media") return serializeResearchMediaMarkdown(block);
    if (block.type === "bookmark") return serializeBookmarkMarkdown(block);
    if (block.type === "heading")
      return `${"#".repeat(block.level)} ${block.text}`;
    if (block.type === "paragraph" || block.type === "markdown")
      return block.text;
    if (block.type === "callout") return serializeCalloutMarkdown(block);
    if (block.type === "examples")
      return serializeExamplesMarkdown(block, children => renderBlocks(children, ownerNoteId, path));
    if (block.type === "list")
      return block.items.map((item) => `- ${item}`).join("\n");
    if (block.type === "formula") {
      const tex = block.parts
        ? formulaPartsToTex(block.parts, symbols, block.layout).tex
        : block.tex;
      const metadata: string[] = [];
      if (block.conditions?.trim())
        metadata.push("适用条件：" + block.conditions);
      if (block.outputs?.length)
        metadata.push(
          "结果符号：" +
            block.outputs
              .map((output) => {
                const entry = symbols.find(
                  (item) => item.id === output.entryId,
                );
                return entry
                  ? "$" + resolveSymbolEntry(entry, output.bindings).tex + "$"
                  : "缺少符号词条";
              })
              .join("、"),
        );
      for (const part of block.parts ?? []) {
        if (part.type !== "symbol" || !part.source) continue;
        const entry = symbols.find((item) => item.id === part.entryId);
        const sourceNote = notes.find(
          (item) => item.id === part.source!.noteId,
        );
        const sourceFormula =
          sourceNote &&
          findResearchBlock(sourceNote.blocks, part.source!.formulaId)?.block;
        const sourceValid =
          sourceFormula?.type === "formula" &&
          sourceFormula.outputs?.some(
            (output) =>
              output.id === part.source!.outputId &&
              output.entryId === part.entryId,
          );
        metadata.push(
          (entry
            ? "$" + resolveSymbolEntry(entry, part.bindings).tex + "$"
            : "符号") +
            " 的推导来源：" +
            (sourceValid
              ? sourceNote!.title +
                " · " +
                (sourceFormula.caption || "来源公式")
              : "来源失效"),
        );
      }
      return (
        `$$\n${tex}\n$$${block.caption ? `\n\n${block.caption}` : ""}` +
        (metadata.length ? "\n\n" + metadata.join("\n\n") : "")
      );
    }
    const context = [block.eventLabel, block.loopId, block.packetId]
      .filter(Boolean)
      .join(" · ");
    return `> 回放证据：${block.runTitle} · t = ${block.time.toFixed(6)} s${context ? ` · ${context}` : ""}${block.note ? `\n> ${block.note}` : ""}`;
  };
  const body = note.blocks.map(block => renderBlock(block));
  let previousSection = "derivation";
  const sectionedBody = body.map((text, index) => {
    const section = note.blocks[index].section ?? "derivation";
    if (section === previousSection) return text;
    previousSection = section;
    return `<!-- webbench-section: ${section} -->\n\n${text}`;
  });
  const metadata = serializeMetadataYaml(getResearchNoteMetadata(note));
  const readable = [`# ${note.title}`, ...sectionedBody].join("\n\n");
  const snapshot = flattenResearchBlocks(note.blocks).some(
    (block) => block.type === "noteEmbed" || block.type === "external" || block.type === "examples" || block.type === "media" || block.type === "bookmark" || isResearchRichBlock(block),
  )
    ? `<!-- webbench-blocks: ${JSON.stringify({
        version: 1,
        noteId: note.id,
        blocks: note.blocks,
        readable: normalizeReadableResearchMarkdown(readable),
      })
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029")} -->`
    : undefined;
  return [
    `---\n${metadata}---`,
    ...(snapshot ? [snapshot] : []),
    readable,
  ].join("\n\n");
}
