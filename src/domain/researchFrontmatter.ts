import { parseDocument, stringify } from "yaml";
import type { ResearchNote, ResearchNotebookState } from "./researchNotebook.ts";
import {
  getNoteReviewStatus,
  invalidateResearchReviews,
  normalizeResearchTags,
  noteReviewStates,
} from "./researchNoteOrganization.ts";
import {
  getNoteLibrary,
  openLibraryNote,
  type ResearchNoteLibrary,
  type ResearchNoteType,
} from "./researchNoteLibraries.ts";

export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | MetadataValue[]
  | { [key: string]: MetadataValue };
export type ResearchFrontmatter = { [key: string]: MetadataValue };

export const noteMetadataKeys = [
  "title",
  "createdAt",
  "updatedAt",
  "tags",
  "reviewStatus",
  "reviewedAt",
  "library",
  "researchType",
  "basisNoteIds",
] as const;
const internalKeys = new Set([
  "id",
  "blocks",
  "frontmatter",
  "__proto__",
  "prototype",
  "constructor",
]);
const reservedKeys = new Set<string>([...noteMetadataKeys, ...internalKeys]);

function metadataObject(value: unknown): ResearchFrontmatter {
  let count = 0;
  const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): MetadataValue => {
    if (++count > 10000 || depth > 20)
      throw new Error("元数据结构过于复杂，请简化层级。");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object")
      throw new Error("元数据仅支持文本、有限数值、布尔值、空值、列表和对象。");
    if (ancestors.has(value)) throw new Error("元数据不能包含循环引用。");
    ancestors.add(value);
    const result: MetadataValue = Array.isArray(value)
      ? value.map((item) => copy(item, depth + 1))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => {
            if (["__proto__", "prototype", "constructor"].includes(key))
              throw new Error(`不支持的属性名：${key}`);
            return [key, copy(item, depth + 1)];
          }),
        );
    ancestors.delete(value);
    return result;
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Frontmatter 顶层需要使用“属性名: 值”的形式。");
  return copy(value, 0) as ResearchFrontmatter;
}

export function parseMetadataYaml(source: string): ResearchFrontmatter {
  if (!source.trim()) return {};
  const document = parseDocument(source, { schema: "core", uniqueKeys: true });
  if (document.errors.length)
    throw new Error(`YAML 格式错误：${document.errors[0].message}`);
  return metadataObject(document.toJS({ maxAliasCount: 50 }));
}

export function serializeMetadataYaml(value: ResearchFrontmatter): string {
  return stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });
}

export function normalizeStoredFrontmatter(
  value: unknown,
): ResearchFrontmatter {
  try {
    return Object.fromEntries(
      Object.entries(metadataObject(value)).filter(
        ([key]) => !reservedKeys.has(key),
      ),
    );
  } catch {
    return {};
  }
}

export function getResearchNoteMetadata(
  note: ResearchNote,
): ResearchFrontmatter {
  return {
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tags: [...(note.tags ?? [])],
    reviewStatus: getNoteReviewStatus(note),
    library: getNoteLibrary(note),
    ...(note.researchType ? { researchType: note.researchType } : {}),
    ...(note.basisNoteIds?.length
      ? { basisNoteIds: [...note.basisNoteIds] }
      : {}),
    ...(note.reviewedAt ? { reviewedAt: note.reviewedAt } : {}),
    ...normalizeStoredFrontmatter(note.frontmatter),
  };
}

export function noteFieldsFromMetadata(
  value: ResearchFrontmatter,
  fallback: ResearchNote,
) {
  const metadata = metadataObject(value);
  for (const key of Object.keys(metadata))
    if (internalKeys.has(key))
      throw new Error(`“${key}”是笔记内部字段，请使用其他属性名。`);
  if (metadata.title !== undefined && typeof metadata.title !== "string")
    throw new Error("title（标题）必须是文本。");
  const title =
    typeof metadata.title === "string" ? metadata.title : fallback.title;
  const dateField = (key: "createdAt" | "updatedAt" | "reviewedAt") => {
    const value = metadata[key];
    if (value === undefined || value === null || value === "")
      return key === "reviewedAt" ? undefined : fallback[key];
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      throw new Error(`${key} 必须是有效的日期时间。`);
    return value;
  };
  const rawTags = metadata.tags ?? [];
  if (
    typeof rawTags !== "string" &&
    (!Array.isArray(rawTags) || rawTags.some((tag) => typeof tag !== "string"))
  )
    throw new Error("tags（标签）必须是文本或文本列表。");
  const tags = normalizeResearchTags(
    typeof rawTags === "string" ? [rawTags] : rawTags,
  );
  const reviewStatus =
    metadata.reviewStatus === undefined
      ? getNoteReviewStatus(fallback)
      : noteReviewStates.find(
          (status) => status.value === metadata.reviewStatus,
        )?.value;
  if (!reviewStatus)
    throw new Error(
      "reviewStatus 请选择 pending（待核对）、reviewing（核对中）或 reviewed（已核对）。",
    );
  const frontmatter = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !reservedKeys.has(key)),
  );
  if (
    metadata.library !== undefined &&
    metadata.library !== "foundation" &&
    metadata.library !== "research"
  )
    throw new Error(
      "library（笔记库）请选择 foundation（基础理论）或 research（研究记录）。",
    );
  if (
    metadata.researchType !== undefined &&
    metadata.researchType !== "" &&
    metadata.researchType !== "application" &&
    metadata.researchType !== "derivation"
  )
    throw new Error(
      "researchType 请选择 application（场景应用）或 derivation（本文推导）。",
    );
  if (
    metadata.basisNoteIds !== undefined &&
    (!Array.isArray(metadata.basisNoteIds) ||
      metadata.basisNoteIds.some((id) => typeof id !== "string"))
  )
    throw new Error("basisNoteIds（理论依据）必须是笔记标识列表。");
  return {
    title,
    createdAt: dateField("createdAt")!,
    updatedAt: dateField("updatedAt")!,
    reviewedAt: dateField("reviewedAt"),
    tags,
    reviewStatus,
    frontmatter,
    ...(metadata.library !== undefined
      ? { library: metadata.library as ResearchNoteLibrary }
      : {}),
    ...(metadata.researchType !== undefined
      ? {
          researchType: (metadata.researchType || undefined) as
            ResearchNoteType | undefined,
        }
      : {}),
    ...(metadata.basisNoteIds !== undefined
      ? {
          basisNoteIds: [...new Set(metadata.basisNoteIds as string[])].filter(
            (id) => id !== fallback.id,
          ),
        }
      : {}),
  };
}

export function readResearchFrontmatter(source: string): {
  body: string;
  metadata?: ResearchFrontmatter;
} {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const header =
    /^---[ \t]*\n((?:[^\n]*\n)*?)(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  if (!header) return { body: text };
  return {
    body: text.slice(header[0].length),
    metadata: parseMetadataYaml(header[1]),
  };
}

function fingerprint(value: MetadataValue): string {
  if (Array.isArray(value)) return "[" + value.map(fingerprint).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + fingerprint(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export function applyResearchNoteMetadata(
  state: ResearchNotebookState,
  noteId: string,
  metadata: ResearchFrontmatter,
  now = new Date().toISOString(),
): ResearchNotebookState {
  const existing = state.notes.find((note) => note.id === noteId);
  if (!existing) return state;
  const fields = noteFieldsFromMetadata(metadata, existing);
  const before = getResearchNoteMetadata(existing);
  const after = getResearchNoteMetadata({ ...existing, ...fields });
  delete before.updatedAt;
  delete after.updatedAt;
  if (fingerprint(before) === fingerprint(after)) return state;
  const titleChanged =
    fields.title !== existing.title ||
    (fields.basisNoteIds !== undefined &&
      JSON.stringify(fields.basisNoteIds) !==
        JSON.stringify(existing.basisNoteIds ?? []));
  const notes = titleChanged
    ? invalidateResearchReviews(state.notes, [noteId])
    : state.notes;
  const current = notes.find((note) => note.id === noteId)!;
  const reviewChanged = fields.reviewStatus !== getNoteReviewStatus(existing);
  const reviewStatus = reviewChanged
    ? fields.reviewStatus
    : getNoteReviewStatus(current);
  const reviewedAt =
    reviewChanged &&
    reviewStatus === "reviewed" &&
    fields.reviewedAt === existing.reviewedAt
      ? now
      : fields.reviewedAt;
  const next = {
    ...state,
    notes: notes.map((note) =>
      note.id === noteId
        ? { ...note, ...fields, reviewStatus, reviewedAt, updatedAt: now }
        : note,
    ),
  };
  return fields.library &&
    fields.library !== getNoteLibrary(existing) &&
    state.activeNoteId === noteId
    ? openLibraryNote(next, noteId)
    : next;
}
