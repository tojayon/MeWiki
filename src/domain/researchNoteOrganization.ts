import type { ResearchNote, ResearchNotebookState } from "./researchNotebook.ts";
import { isResearchRichBlock, researchRichText } from "./researchRichContent.ts";
import { flattenResearchBlocks } from "./researchBlockTree.ts";
import { buildResearchTagTree, normalizeResearchTags, type ResearchTagBranch } from "./researchTags.ts";
export { getResearchTagTree, normalizeResearchTags } from "./researchTags.ts";

export const noteReviewStates = [
  { value: "pending", label: "待核对" },
  { value: "reviewing", label: "核对中" },
  { value: "reviewed", label: "已核对" },
] as const;
export type NoteReviewStatus = (typeof noteReviewStates)[number]["value"];
export interface ResearchNoteFilters {
  query: string;
  status: NoteReviewStatus | "all";
  tag: string;
}
export const defaultResearchNoteFilters: ResearchNoteFilters = {
  query: "",
  status: "all",
  tag: "",
};

export function getNoteReviewStatus(
  note: Pick<ResearchNote, "reviewStatus">,
): NoteReviewStatus {
  return noteReviewStates.some((status) => status.value === note.reviewStatus)
    ? note.reviewStatus!
    : "pending";
}

export function normalizeNoteOrganization(
  value: Record<string, unknown>,
): Pick<ResearchNote, "tags" | "reviewStatus" | "reviewedAt"> {
  const reviewStatus =
    noteReviewStates.find((status) => status.value === value.reviewStatus)
      ?.value ?? "pending";
  const tags =
    value.tags === undefined
      ? []
      : normalizeResearchTags(value.tags);
  const reviewedAt =
    typeof value.reviewedAt === "string" &&
    Number.isFinite(Date.parse(value.reviewedAt))
      ? value.reviewedAt
      : undefined;
  return { reviewStatus, tags, ...(reviewedAt ? { reviewedAt } : {}) };
}

export function normalizeNoteFilters(value: unknown): ResearchNoteFilters {
  if (!value || typeof value !== "object")
    return { ...defaultResearchNoteFilters };
  const filter = value as Record<string, unknown>;
  return {
    query: typeof filter.query === "string" ? filter.query : "",
    status:
      noteReviewStates.find((status) => status.value === filter.status)
        ?.value ?? "all",
    tag: normalizeResearchTags([filter.tag])[0] ?? "",
  };
}

export function getResearchNoteProgress(notes: ResearchNote[]) {
  const counts = { total: notes.length, pending: 0, reviewing: 0, reviewed: 0 };
  for (const note of notes) counts[getNoteReviewStatus(note)]++;
  return counts;
}

export interface ResearchNoteTagBranch {
  path: string;
  label: string;
  count: number;
  notes: ResearchNote[];
  children: ResearchNoteTagBranch[];
}

export function buildResearchNoteTree(
  notes: ResearchNote[],
  filters: ResearchNoteFilters = defaultResearchNoteFilters,
): ResearchNoteTagBranch[] {
  const withNotes = (branch: ResearchTagBranch<ResearchNote>): ResearchNoteTagBranch => ({
    path: branch.path, label: branch.label, count: branch.count, notes: branch.items, children: branch.children.map(withNotes),
  });
  return buildResearchTagTree(filterResearchNotes(notes, filters), filters.tag).map(withNotes);
}

export function filterResearchNotes(
  notes: ResearchNote[],
  filters: ResearchNoteFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase();
  const tag = filters.tag.toLocaleLowerCase();
  return notes.filter((note) => {
    if (
      filters.status !== "all" &&
      getNoteReviewStatus(note) !== filters.status
    )
      return false;
    if (
      tag &&
      !(note.tags ?? []).some(
        (path) =>
          path.toLocaleLowerCase() === tag ||
          path.toLocaleLowerCase().startsWith(tag + "/"),
      )
    )
      return false;
    if (!query) return true;
    const text = [
      note.title,
      ...(note.tags ?? []),
      note.frontmatter ? JSON.stringify(note.frontmatter) : "",
      ...flattenResearchBlocks(note.blocks).map((block) =>
        block.type === "paragraph" ||
        block.type === "heading" ||
        block.type === "markdown"
          ? block.text
          : block.type === "examples"
            ? [block.title, ...block.tabs.map(tab => tab.title)].join(" ")
          : block.type === "callout"
            ? [block.title, block.text].join(" ")
            : block.type === "list"
              ? block.items.join(" ")
              : block.type === "formula"
                ? [block.caption, block.tex].join(" ")
                : block.type === "media" ? [block.alt, block.caption, block.legacySource, block.source?.type === "url" ? block.source.url : ""].filter(Boolean).join(" ")
                : block.type === "bookmark" ? [block.title, block.description, block.siteName, block.url].filter(Boolean).join(" ")
                : isResearchRichBlock(block) ? researchRichText(block)
                : block.type === 'external' ? [block.title, block.summary, block.note].join(' ')
                : block.type === 'noteEmbed' ? ['引用笔记内容', block.sourceTitle].join(' ')
                : [block.runTitle, block.note].join(" "),
      ),
    ].join(" ");
    return text.toLocaleLowerCase().includes(query);
  });
}

export function setNoteReviewStatus(
  state: ResearchNotebookState,
  noteId: string,
  reviewStatus: NoteReviewStatus,
  now = new Date().toISOString(),
): ResearchNotebookState {
  const note = state.notes.find((value) => value.id === noteId);
  if (!note || getNoteReviewStatus(note) === reviewStatus) return state;
  return {
    ...state,
    notes: state.notes.map((value) =>
      value.id === noteId
        ? {
            ...value,
            reviewStatus,
            ...(reviewStatus === "reviewed" ? { reviewedAt: now } : {}),
          }
        : value,
    ),
  };
}

export function setResearchNoteTags(
  state: ResearchNotebookState,
  noteId: string,
  values: string[],
): ResearchNotebookState {
  const tags = normalizeResearchTags(values);
  const note = state.notes.find((value) => value.id === noteId);
  if (!note || JSON.stringify(note.tags ?? []) === JSON.stringify(tags))
    return state;
  return {
    ...state,
    notes: state.notes.map((value) =>
      value.id === noteId ? { ...value, tags } : value,
    ),
  };
}

/** Changes to a source note also make its reviewed derivations eligible for rechecking. */
export function invalidateResearchReviews(
  notes: ResearchNote[],
  changedNoteIds: Iterable<string>,
): ResearchNote[] {
  const affected = new Set(changedNoteIds);
  let previousSize = -1;
  while (affected.size !== previousSize) {
    previousSize = affected.size;
    for (const note of notes)
      if (
        note.basisNoteIds?.some((id) => affected.has(id)) ||
        flattenResearchBlocks(note.blocks).some(
          (block) =>
            block.type === 'noteEmbed' ? affected.has(block.sourceNoteId) : block.type === "formula" &&
            block.parts?.some(
              (part) =>
                part.type === "symbol" &&
                part.source &&
                affected.has(part.source.noteId),
            ),
        )
      )
        affected.add(note.id);
  }
  return notes.map((note) =>
    affected.has(note.id) && getNoteReviewStatus(note) === "reviewed"
      ? { ...note, reviewStatus: "pending" }
      : note,
  );
}
