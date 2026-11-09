import { isResearchRichBlock, researchRichText } from "./researchRichContent.ts";
import type {
  ResearchNote,
  ResearchNotebookBlock,
  ResearchNotebookState,
} from "./researchNotebook.ts";
import {
  resolveFormulaSource,
  researchFormulaTitle,
} from "./researchFormulaLinks.ts";
import { findResearchBlock, flattenResearchBlocks } from "./researchBlockTree.ts";
import { researchTabsTitle } from "./researchExamples.ts";
import { noteEmbedBlockLabel } from './researchNoteEmbed.ts';

export interface TheoryReference {
  noteId: string;
  blockId?: string;
}
export type TheoryRole = "foundation" | "assumption" | "model" | "unclassified";
export type TheoryRelationKind = "derivation" | "assumption" | "adaptation";
export interface TheoryRelation {
  id: string;
  source: TheoryReference;
  target: TheoryReference;
  kind: TheoryRelationKind;
  description: string;
}
export interface TheoryTopic {
  id: string;
  title: string;
  noteIds: string[];
}
export interface TheoryLayout {
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
}
export interface TheoryKnowledge {
  annotations: { ref: TheoryReference; role: TheoryRole }[];
  relations: TheoryRelation[];
}
export interface TheoryDocumentView {
  expandedNoteIds: string[];
  showAllBlocks: boolean;
  selectedNodeId?: string;
  layout: TheoryLayout;
}
export interface TheoryMapDocument extends TheoryKnowledge {
  id: string;
  title: string;
  kind: "topic" | "global";
  createdAt: string;
  updatedAt: string;
  noteIds: string[];
  view: TheoryDocumentView;
}
export interface TheoryMapWorkspace {
  version: 1;
  activeMapId: string;
  documents: TheoryMapDocument[];
  deletedMapIds: string[];
  unresolvedKnowledge?: TheoryKnowledge;
  noteViewOpen: boolean;
  noteViews: Record<string, TheoryDocumentView & { depth: number }>;
}
// v1 is accepted only for a one-time migration, and is also the internal graph projection.
export interface ResearchTheoryMapState {
  version: 1;
  open: boolean;
  scope: "local" | "topic" | "global";
  topicId: string;
  depth: number;
  expandedNoteIds: string[];
  showAllBlocks: boolean;
  selectedNodeId?: string;
  annotations: { ref: TheoryReference; role: TheoryRole }[];
  relations: TheoryRelation[];
  topics: TheoryTopic[];
  layouts: Record<string, TheoryLayout>;
}
export interface TheoryGraphNode {
  id: string;
  ref: TheoryReference;
  title: string;
  noteTitle: string;
  role: TheoryRole;
  note?: ResearchNote;
  block?: ResearchNotebookBlock;
  missing?: boolean;
}
export interface TheoryGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: TheoryRelationKind;
  origin: "formula" | "note" | "manual";
  description: string;
  relations: TheoryRelation[];
  error?: string;
}
export const theoryRoles: { value: TheoryRole; label: string }[] = [
  { value: "foundation", label: "基础理论" },
  { value: "assumption", label: "场景假设" },
  { value: "model", label: "场景模型" },
  { value: "unclassified", label: "未分类" },
];
export const theoryRelationKinds: {
  value: TheoryRelationKind;
  label: string;
}[] = [
  { value: "derivation", label: "推导／结果引用" },
  { value: "assumption", label: "适用条件" },
  { value: "adaptation", label: "场景适配" },
];
export const theoryReferenceKey = (ref: TheoryReference) =>
  JSON.stringify([ref.noteId, ref.blockId ?? null]);

export function resolveTheoryReference(
  state: Pick<ResearchNotebookState, "notes">,
  ref: TheoryReference,
  annotations: ResearchTheoryMapState["annotations"] = [],
): TheoryGraphNode {
  const note = state.notes.find((item) => item.id === ref.noteId);
  const block = ref.blockId
    ? findResearchBlock(note?.blocks ?? [], ref.blockId)?.block
    : undefined;
  const missing = !note || (!!ref.blockId && !block);
  const title = missing
    ? "来源内容已移除"
    : !block
      ? note!.title
      : block.type === "formula"
        ? researchFormulaTitle(block, note!)
        : block.type === "examples"
          ? `${researchTabsTitle(block)} · ${block.tabs.map(tab => tab.title).join("、")}`
        : block.type === "callout"
          ? block.title
          : block.type === "list"
            ? block.items.join("；").slice(0, 70)
            : block.type === "evidence"
              ? block.runTitle
              : block.type === "media" ? block.caption || block.alt || "图片"
              : block.type === "bookmark" ? block.title || block.url || "网页链接"
              : isResearchRichBlock(block) ? block.title || researchRichText(block).split("\n")[0].slice(0, 70) || "研究内容"
              : block.type === 'external' ? block.title
              : block.type === 'noteEmbed' ? noteEmbedBlockLabel(block)
              : block.text.split("\n")[0].slice(0, 70) || "未命名内容";
  return {
    id: theoryReferenceKey(ref),
    ref,
    title,
    noteTitle: note?.title ?? "笔记已移除",
    note,
    block,
    missing,
    role:
      annotations.find(
        (item) => theoryReferenceKey(item.ref) === theoryReferenceKey(ref),
      )?.role ??
      (block?.type === "callout"
        ? "assumption"
        : (annotations.find(
            (item) => item.ref.noteId === ref.noteId && !item.ref.blockId,
          )?.role ?? "unclassified")),
  };
}

function initialTheoryMap(_notes: ResearchNote[], activeNoteId: string): ResearchTheoryMapState {
  return { version: 1, open: false, scope: "local", topicId: "", depth: 1,
    expandedNoteIds: activeNoteId ? [activeNoteId] : [], showAllBlocks: false,
    annotations: [], relations: [], topics: [], layouts: {} };
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
function reference(value: unknown): TheoryReference | undefined {
  const ref = object(value);
  return ref && typeof ref.noteId === "string" && ref.noteId
    ? {
        noteId: ref.noteId,
        ...(typeof ref.blockId === "string" && ref.blockId
          ? { blockId: ref.blockId }
          : {}),
      }
    : undefined;
}
const uniqueStrings = (value: unknown) => [
  ...new Set(
    Array.isArray(value)
      ? value.filter(
          (item): item is string => typeof item === "string" && !!item,
        )
      : [],
  ),
];
const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function normalizeResearchTheoryMap(
  value: unknown,
  notes: ResearchNote[],
  activeNoteId = notes[0]?.id ?? "",
): ResearchTheoryMapState {
  const saved = object(value);
  if (!saved || saved.version !== 1)
    return initialTheoryMap(notes, activeNoteId);
  const annotations: ResearchTheoryMapState["annotations"] = [];
  for (const value of Array.isArray(saved.annotations)
    ? saved.annotations
    : []) {
    const item = object(value);
    const ref = reference(item?.ref);
    if (
      item &&
      ref &&
      theoryRoles.some((role) => role.value === item.role) &&
      !annotations.some(
        (value) => theoryReferenceKey(value.ref) === theoryReferenceKey(ref),
      )
    )
      annotations.push({ ref, role: item.role as TheoryRole });
  }
  const relations: TheoryRelation[] = [];
  for (const value of Array.isArray(saved.relations) ? saved.relations : []) {
    const item = object(value);
    const source = reference(item?.source);
    const target = reference(item?.target);
    if (
      item &&
      source &&
      target &&
      typeof item.id === "string" &&
      item.id &&
      theoryRelationKinds.some((kind) => kind.value === item.kind) &&
      !relations.some((value) => value.id === item.id)
    )
      relations.push({
        id: item.id,
        source,
        target,
        kind: item.kind as TheoryRelationKind,
        description:
          typeof item.description === "string" ? item.description : "",
      });
  }
  const topics: TheoryTopic[] = [];
  for (const value of Array.isArray(saved.topics) ? saved.topics : []) {
    const item = object(value);
    if (
      item &&
      typeof item.id === "string" &&
      item.id &&
      typeof item.title === "string" &&
      item.title.trim() &&
      !topics.some((topic) => topic.id === item.id)
    )
      topics.push({
        id: item.id,
        title: item.title,
        noteIds: uniqueStrings(item.noteIds),
      });
  }
  const layouts: ResearchTheoryMapState["layouts"] = {};
  for (const [key, value] of Object.entries(object(saved.layouts) ?? {})) {
    const item = object(value);
    if (!item) continue;
    const positions: TheoryLayout["positions"] = {};
    for (const [id, value] of Object.entries(object(item.positions) ?? {})) {
      const point = object(value);
      if (point && finiteNumber(point.x) && finiteNumber(point.y))
        positions[id] = { x: point.x, y: point.y };
    }
    const view = object(item.viewport);
    const viewport =
      view &&
      finiteNumber(view.x) &&
      finiteNumber(view.y) &&
      finiteNumber(view.zoom) &&
      view.zoom >= 0.1 &&
      view.zoom <= 3
        ? { x: view.x, y: view.y, zoom: view.zoom }
        : undefined;
    layouts[key] = { positions, ...(viewport ? { viewport } : {}) };
  }
  return {
    version: 1,
    open: saved.open === true,
    scope:
      saved.scope === "global" || saved.scope === "topic"
        ? saved.scope
        : "local",
    topicId:
      typeof saved.topicId === "string" ? saved.topicId : (topics[0]?.id ?? ""),
    depth: finiteNumber(saved.depth)
      ? Math.min(3, Math.max(1, Math.floor(saved.depth)))
      : 1,
    expandedNoteIds: uniqueStrings(saved.expandedNoteIds),
    showAllBlocks: saved.showAllBlocks === true,
    ...(typeof saved.selectedNodeId === "string"
      ? { selectedNodeId: saved.selectedNodeId }
      : {}),
    annotations,
    relations,
    topics,
    layouts,
  };
}

const newMapId = () => globalThis.crypto.randomUUID();
const blankView = (): TheoryDocumentView => ({
  expandedNoteIds: [],
  showAllBlocks: false,
  layout: { positions: {} },
});

export function normalizeTheoryKnowledge(value: unknown): TheoryKnowledge {
  const normalized = normalizeResearchTheoryMap(
    { ...object(value), version: 1 },
    [],
  );
  return {
    annotations: normalized.annotations,
    relations: normalized.relations,
  };
}

export function normalizeTheoryMapDocument(
  value: unknown,
): TheoryMapDocument | undefined {
  const item = object(value);
  if (
    !item ||
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    (item.kind !== "global" && item.kind !== "topic") ||
    !Array.isArray(item.noteIds)
  )
    return;
  const view = object(item.view);
  const normalized = normalizeResearchTheoryMap(
    { ...view, version: 1, layouts: { view: view?.layout } },
    [],
  );
  return {
    id: item.id,
    title: item.title.trim(),
    kind: item.kind,
    createdAt:
      typeof item.createdAt === "string"
        ? item.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof item.updatedAt === "string"
        ? item.updatedAt
        : new Date().toISOString(),
    noteIds: uniqueStrings(item.noteIds),
    ...normalizeTheoryKnowledge(item),
    view: {
      expandedNoteIds: normalized.expandedNoteIds,
      showAllBlocks: normalized.showAllBlocks,
      ...(normalized.selectedNodeId
        ? { selectedNodeId: normalized.selectedNodeId }
        : {}),
      layout: normalized.layouts.view ?? { positions: {} },
    },
  };
}

export function ensureTheoryMaps(
  state: ResearchNotebookState,
): ResearchNotebookState {
  if (state.theoryMaps) return state;
  const legacy =
    state.theoryMap ?? initialTheoryMap(state.notes, state.activeNoteId);
  const now = new Date().toISOString();
  const make = (
    id: string,
    title: string,
    kind: TheoryMapDocument["kind"],
    noteIds: string[],
    key: string,
  ): TheoryMapDocument => ({
    id,
    title,
    kind,
    noteIds,
    createdAt: now,
    updatedAt: now,
    annotations: legacy.annotations.filter(
      (item) => kind === "global" || noteIds.includes(item.ref.noteId),
    ),
    relations: [],
    view: {
      expandedNoteIds: [...legacy.expandedNoteIds],
      showAllBlocks: legacy.showAllBlocks,
      ...(legacy.selectedNodeId
        ? { selectedNodeId: legacy.selectedNodeId }
        : {}),
      layout: structuredClone(legacy.layouts[key] ?? { positions: {} }),
    },
  });
  const documents = [
    make("global", "全局地图", "global", [], "global"),
    ...legacy.topics
      .filter((topic) => topic.id !== "global")
      .map((topic) =>
        make(
          topic.id,
          topic.title,
          "topic",
          topic.noteIds,
          "topic:" + topic.id,
        ),
      ),
  ];
  const noteViews: TheoryMapWorkspace["noteViews"] = {};
  for (const [key, layout] of Object.entries(legacy.layouts))
    if (key.startsWith("local:"))
      noteViews[key.slice(6)] = {
        ...blankView(),
        expandedNoteIds: [...legacy.expandedNoteIds],
        showAllBlocks: legacy.showAllBlocks,
        depth: legacy.depth,
        layout: structuredClone(layout),
      };
  noteViews[state.activeNoteId] ??= {
    ...blankView(),
    expandedNoteIds: [...legacy.expandedNoteIds],
    showAllBlocks: legacy.showAllBlocks,
    depth: legacy.depth,
  };
  const { theoryMap: _legacy, ...rest } = state;
  return {
    ...rest,
    view: legacy.open && legacy.scope !== "local" ? "maps" : state.view,
    notes: state.notes.map((note) =>
      note.theory
        ? note
        : {
            ...note,
            theory: {
              annotations: legacy.annotations.filter(
                (item) => item.ref.noteId === note.id,
              ),
              relations: legacy.relations.filter(
                (item) => item.target.noteId === note.id,
              ),
            },
          },
    ),
    theoryMaps: {
      version: 1,
      activeMapId:
        legacy.scope === "topic" &&
        documents.some((doc) => doc.id === legacy.topicId)
          ? legacy.topicId
          : "global",
      documents,
      deletedMapIds: [],
      unresolvedKnowledge: {
        annotations: legacy.annotations.filter(
          (item) => !state.notes.some((note) => note.id === item.ref.noteId),
        ),
        relations: legacy.relations.filter(
          (item) => !state.notes.some((note) => note.id === item.target.noteId),
        ),
      },
      noteViews,
      noteViewOpen: legacy.open && legacy.scope === "local",
    },
  };
}

export function normalizeTheoryMapWorkspace(
  value: unknown,
): TheoryMapWorkspace | undefined {
  const saved = object(value);
  if (!saved || saved.version !== 1 || !Array.isArray(saved.documents)) return;
  const documents: TheoryMapDocument[] = [];
  for (const raw of saved.documents) {
    const doc = normalizeTheoryMapDocument(raw);
    if (
      doc &&
      !documents.some((item) => item.id === doc.id) &&
      (doc.kind !== "global" || doc.id === "global")
    )
      documents.push(
        doc.id === "global" ? { ...doc, kind: "global", noteIds: [] } : doc,
      );
  }
  if (!documents.some((doc) => doc.id === "global"))
    documents.unshift({
      id: "global",
      title: "全局地图",
      kind: "global",
      noteIds: [],
      annotations: [],
      relations: [],
      view: blankView(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  documents.sort(
    (a, b) => Number(b.kind === "global") - Number(a.kind === "global"),
  );
  const noteViews: TheoryMapWorkspace["noteViews"] = {};
  for (const [id, raw] of Object.entries(object(saved.noteViews) ?? {})) {
    const item = object(raw);
    if (!item) continue;
    const doc = normalizeTheoryMapDocument({
      id,
      title: id,
      kind: "topic",
      noteIds: [],
      view: item,
    });
    if (doc)
      noteViews[id] = {
        ...doc.view,
        depth: finiteNumber(item.depth)
          ? Math.min(3, Math.max(1, Math.floor(item.depth)))
          : 1,
      };
  }
  return {
    version: 1,
    documents,
    unresolvedKnowledge: normalizeTheoryKnowledge(saved.unresolvedKnowledge),
    deletedMapIds: uniqueStrings(saved.deletedMapIds).filter(
      (id) => id !== "global" && !documents.some((doc) => doc.id === id),
    ),
    activeMapId: documents.some((doc) => doc.id === saved.activeMapId)
      ? String(saved.activeMapId)
      : "global",
    noteViewOpen: saved.noteViewOpen === true,
    noteViews,
  };
}

export function activeTheoryMapDocument(
  state: ResearchNotebookState,
): TheoryMapDocument {
  const workspace = ensureTheoryMaps(state).theoryMaps!;
  return (
    workspace.documents.find((doc) => doc.id === workspace.activeMapId) ??
    workspace.documents[0]
  );
}

function canonicalTheoryKnowledge(
  state: ResearchNotebookState,
): TheoryKnowledge {
  const next = ensureTheoryMaps(state);
  return {
    annotations: [
      ...(next.theoryMaps?.unresolvedKnowledge?.annotations ?? []),
      ...next.notes.flatMap((note) => note.theory?.annotations ?? []),
    ],
    relations: [
      ...(next.theoryMaps?.unresolvedKnowledge?.relations ?? []),
      ...next.notes.flatMap((note) => note.theory?.relations ?? []),
    ],
  };
}

export function retainRemovedTheoryNote(
  state: ResearchNotebookState,
  noteId: string,
): ResearchNotebookState {
  if (!state.theoryMaps && !state.theoryMap) return state;
  const next = ensureTheoryMaps(state);
  const note = next.notes.find((note) => note.id === noteId);
  const previous = next.theoryMaps!.unresolvedKnowledge;
  return {
    ...next,
    theoryMaps: {
      ...next.theoryMaps!,
      unresolvedKnowledge: {
        annotations: [
          ...(previous?.annotations ?? []),
          ...(note?.theory?.annotations ?? []),
        ],
        relations: [
          ...(previous?.relations ?? []),
          ...(note?.theory?.relations ?? []),
        ],
      },
    },
  };
}

export function getResearchTheoryMap(
  state: ResearchNotebookState,
): ResearchTheoryMapState {
  // Legacy projections are read only while migrating old snapshots.
  if (!state.theoryMaps && state.theoryMap) return state.theoryMap;
  const next = ensureTheoryMaps(state);
  const workspace = next.theoryMaps!;
  const doc = activeTheoryMapDocument(next);
  const local = state.view !== "maps";
  const view = local
    ? (workspace.noteViews[state.activeNoteId] ?? {
        ...blankView(),
        expandedNoteIds: [state.activeNoteId],
        depth: 1,
      })
    : doc.view;
  const knowledge = canonicalTheoryKnowledge(next);
  const canonical = knowledge.annotations;
  return {
    version: 1,
    open: workspace.noteViewOpen,
    scope: local ? "local" : doc.kind === "global" ? "global" : "topic",
    topicId: doc.id,
    depth: "depth" in view ? Number(view.depth) : 1,
    expandedNoteIds: view.expandedNoteIds,
    showAllBlocks: view.showAllBlocks,
    selectedNodeId: view.selectedNodeId,
    annotations: local
      ? canonical
      : [
          ...doc.annotations,
          ...canonical.filter(
            (item) =>
              !doc.annotations.some(
                (override) =>
                  theoryReferenceKey(override.ref) ===
                  theoryReferenceKey(item.ref),
              ),
          ),
        ],
    relations: [...knowledge.relations, ...(!local ? doc.relations : [])],
    topics: workspace.documents
      .filter((doc) => doc.kind === "topic")
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        noteIds: [
          ...doc.noteIds,
          ...doc.relations.flatMap((rel) => [
            rel.source.noteId,
            rel.target.noteId,
          ]),
        ],
      })),
    layouts: {
      [local
        ? "local:" + state.activeNoteId
        : doc.kind === "global"
          ? "global"
          : "topic:" + doc.id]: view.layout,
    },
  };
}

export function updateTheoryMapDocument(
  state: ResearchNotebookState,
  document: TheoryMapDocument,
): ResearchNotebookState {
  const next = ensureTheoryMaps(state);
  const workspace = next.theoryMaps!;
  const existing = workspace.documents.find((item) => item.id === document.id);
  const comparable = (doc: TheoryMapDocument) =>
    JSON.stringify({ ...normalizeTheoryMapDocument(doc), updatedAt: "" });
  if (existing && comparable(existing) === comparable(document)) return next;
  return {
    ...next,
    theoryMaps: {
      ...workspace,
      documents: workspace.documents.map((item) =>
        item.id === document.id
          ? { ...document, updatedAt: new Date().toISOString() }
          : item,
      ),
    },
  };
}

export function patchTheoryMapView(
  state: ResearchNotebookState,
  patch: Partial<ResearchTheoryMapState>,
): ResearchNotebookState {
  let next = ensureTheoryMaps(state);
  const workspace = next.theoryMaps!;
  const projected = getResearchTheoryMap(next);
  const key = theoryLayoutKey(projected, next.activeNoteId);
  const viewPatch = {
    ...(patch.expandedNoteIds
      ? { expandedNoteIds: patch.expandedNoteIds }
      : {}),
    ...(patch.showAllBlocks !== undefined
      ? { showAllBlocks: patch.showAllBlocks }
      : {}),
    ...("selectedNodeId" in patch
      ? { selectedNodeId: patch.selectedNodeId }
      : {}),
    ...(patch.layouts?.[key] ? { layout: patch.layouts[key] } : {}),
  };
  if (next.view === "maps") {
    const doc = activeTheoryMapDocument(next);
    const canonical = canonicalTheoryKnowledge(next).annotations;
    const annotations = patch.annotations?.filter(
      (item) =>
        doc.annotations.some(
          (saved) =>
            theoryReferenceKey(saved.ref) === theoryReferenceKey(item.ref),
        ) ||
        resolveTheoryReference(next, item.ref, canonical).role !== item.role,
    );
    next = updateTheoryMapDocument(next, {
      ...doc,
      view: { ...doc.view, ...viewPatch },
      ...(annotations ? { annotations } : {}),
      ...(patch.relations ? { relations: patch.relations } : {}),
    });
  } else {
    const previous = workspace.noteViews[next.activeNoteId] ?? {
      ...blankView(),
      expandedNoteIds: [next.activeNoteId],
      depth: 1,
    };
    next = {
      ...next,
      theoryMaps: {
        ...workspace,
        noteViewOpen: patch.open ?? workspace.noteViewOpen,
        noteViews: {
          ...workspace.noteViews,
          [next.activeNoteId]: {
            ...previous,
            ...viewPatch,
            ...(patch.depth ? { depth: patch.depth } : {}),
          },
        },
      },
    };
    if (patch.annotations) {
      next = {
        ...next,
        theoryMaps: {
          ...next.theoryMaps!,
          unresolvedKnowledge: {
            relations: next.theoryMaps?.unresolvedKnowledge?.relations ?? [],
            annotations: patch.annotations.filter(
              (item) => !next.notes.some((note) => note.id === item.ref.noteId),
            ),
          },
        },
        notes: next.notes.map((note) => ({
          ...note,
          theory: {
            relations: note.theory?.relations ?? [],
            annotations: patch.annotations!.filter(
              (item) => item.ref.noteId === note.id,
            ),
          },
        })),
      };
    }
  }
  return next;
}

export function addTheoryMapDocument(
  state: ResearchNotebookState,
  title: string,
  noteIds: string[] = [],
): ResearchNotebookState {
  const next = ensureTheoryMaps(state);
  const workspace = next.theoryMaps!;
  const now = new Date().toISOString();
  const doc: TheoryMapDocument = {
    id: newMapId(),
    title: title.trim() || "未命名地图",
    kind: "topic",
    noteIds: [...new Set(noteIds)],
    annotations: [],
    relations: [],
    view: blankView(),
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...next,
    view: "maps",
    theoryMaps: {
      ...workspace,
      activeMapId: doc.id,
      documents: [...workspace.documents, doc],
    },
  };
}
export function copyTheoryMapDocument(
  state: ResearchNotebookState,
  id: string,
): ResearchNotebookState {
  const next = ensureTheoryMaps(state);
  const source = next.theoryMaps!.documents.find((doc) => doc.id === id);
  if (!source) return next;
  const added = addTheoryMapDocument(
    next,
    source.title + " 副本",
    source.kind === "global"
      ? next.notes.map((note) => note.id)
      : source.noteIds,
  );
  return updateTheoryMapDocument(added, {
    ...structuredClone(source),
    id: added.theoryMaps!.activeMapId,
    kind: "topic",
    title: source.title + " 副本",
    noteIds:
      source.kind === "global"
        ? next.notes.map((note) => note.id)
        : [...source.noteIds],
    createdAt: new Date().toISOString(),
  });
}
export function deleteTheoryMapDocument(
  state: ResearchNotebookState,
  id: string,
): ResearchNotebookState {
  if (id === "global") return state;
  const next = ensureTheoryMaps(state);
  const workspace = next.theoryMaps!;
  return {
    ...next,
    theoryMaps: {
      ...workspace,
      deletedMapIds: [...new Set([...workspace.deletedMapIds, id])],
      documents: workspace.documents.filter((doc) => doc.id !== id),
      activeMapId:
        workspace.activeMapId === id ? "global" : workspace.activeMapId,
    },
  };
}
export function saveNoteViewAsMap(
  state: ResearchNotebookState,
  title: string,
): ResearchNotebookState {
  const next = ensureTheoryMaps(state);
  const graph = buildResearchTheoryGraph({ ...next, view: "notes" });
  const map = getResearchTheoryMap({ ...next, view: "notes" });
  const added = addTheoryMapDocument(
    next,
    title,
    graph.nodes.map((node) => node.ref.noteId),
  );
  return updateTheoryMapDocument(added, {
    ...activeTheoryMapDocument(added),
    view: {
      expandedNoteIds: [...map.expandedNoteIds],
      showAllBlocks: map.showAllBlocks,
      layout: structuredClone(
        map.layouts["local:" + next.activeNoteId] ?? { positions: {} },
      ),
    },
  });
}

export function researchTheoryCatalogue(
  state: ResearchNotebookState,
): TheoryGraphNode[] {
  const map = getResearchTheoryMap(state);
  return state.notes.flatMap((note) =>
    [
      { noteId: note.id },
      ...flattenResearchBlocks(note.blocks).map((block) => ({ noteId: note.id, blockId: block.id })),
    ].map((ref) => resolveTheoryReference(state, ref, map.annotations)),
  );
}

function allRelations(state: ResearchNotebookState): TheoryGraphEdge[] {
  const next = ensureTheoryMaps(state);
  const from = (
    relation: TheoryRelation,
    origin: TheoryGraphEdge["origin"],
  ): TheoryGraphEdge => ({
    id: origin + ":" + relation.id,
    source: theoryReferenceKey(relation.source),
    target: theoryReferenceKey(relation.target),
    kind: relation.kind,
    origin,
    description: relation.description,
    relations: [relation],
  });
  const edges = state.theoryMaps
    ? [
        ...canonicalTheoryKnowledge(next).relations.map((relation) =>
          from(relation, "note"),
        ),
        ...(state.view === "maps"
          ? activeTheoryMapDocument(next).relations.map((relation) =>
              from(relation, "manual"),
            )
          : []),
      ]
    : getResearchTheoryMap(state).relations.map((relation) =>
        from(relation, "note"),
      );
  for (const note of state.notes)
    for (const source of note.basisNoteIds ?? [])
      if (source !== note.id)
        edges.push({
          id: "basis:" + JSON.stringify([source, note.id]),
          source: theoryReferenceKey({ noteId: source }),
          target: theoryReferenceKey({ noteId: note.id }),
          kind: "adaptation",
          origin: "note",
          description: "笔记引用的理论依据",
          relations: [],
        });
  for (const note of state.notes)
    for (const block of flattenResearchBlocks(note.blocks)) {
      if (block.type !== "formula") continue;
      for (const [index, part] of (block.parts ?? []).entries())
        if (part.type === "symbol" && part.source) {
          const found = resolveFormulaSource(state, part.source);
          const valid = found && found.output.entryId === part.entryId;
          edges.push({
            id: "formula:" + JSON.stringify([note.id, block.id, index]),
            source: theoryReferenceKey({
              noteId: part.source.noteId,
              blockId: part.source.formulaId,
            }),
            target: theoryReferenceKey({ noteId: note.id, blockId: block.id }),
            kind: "derivation",
            origin: "formula",
            description:
              "引用公式结果：" +
              (state.symbols.find((symbol) => symbol.id === part.entryId)
                ?.name ?? "未知符号"),
            relations: [],
            ...(!valid
              ? { error: "公式来源结果失效，请到正文修复引用。" }
              : {}),
          });
        }
    }
  return edges;
}

export function buildResearchTheoryGraph(
  state: ResearchNotebookState,
  override: Partial<ResearchTheoryMapState> = {},
): { nodes: TheoryGraphNode[]; edges: TheoryGraphEdge[] } {
  const map = { ...getResearchTheoryMap(state), ...override };
  const catalogue = new Map(
    researchTheoryCatalogue(state).map((node) => [node.id, node]),
  );
  const edges = allRelations(state);
  const refFromKey = (key: string): TheoryReference => {
    const [noteId, blockId] = JSON.parse(key) as [string, string | null];
    return { noteId, ...(blockId ? { blockId } : {}) };
  };
  for (const edge of edges)
    for (const id of [edge.source, edge.target])
      if (!catalogue.has(id))
        catalogue.set(
          id,
          resolveTheoryReference(state, refFromKey(id), map.annotations),
        );
  let noteIds: Set<string>;
  if (map.scope === "global")
    noteIds = new Set([...catalogue.values()].map((node) => node.ref.noteId));
  else if (map.scope === "topic")
    noteIds = new Set(
      map.topics.find((topic) => topic.id === map.topicId)?.noteIds ?? [],
    );
  else {
    noteIds = new Set([state.activeNoteId]);
    for (let layer = 0; layer < map.depth; layer++) {
      const adjacent = new Set(noteIds);
      for (const edge of edges) {
        const source = catalogue.get(edge.source)!.ref.noteId;
        const target = catalogue.get(edge.target)!.ref.noteId;
        if (layer > 0 && noteIds.has(source)) adjacent.add(target);
        if (noteIds.has(target)) adjacent.add(source);
      }
      noteIds = adjacent;
    }
  }
  const linked = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes: TheoryGraphNode[] = [];
  const projection = new Map<string, string>();
  for (const noteId of noteIds) {
    const candidates = [...catalogue.values()].filter(
      (node) =>
        node.ref.noteId === noteId &&
        node.ref.blockId &&
        ((map.showAllBlocks &&
          (node.block?.type === "formula" || node.block?.type === "callout")) ||
          linked.has(node.id) ||
          map.annotations.some(
            (item) => theoryReferenceKey(item.ref) === node.id,
          )),
    );
    const expanded =
      map.expandedNoteIds.includes(noteId) && candidates.length > 0;
    const noteRef = { noteId };
    const noteKey = theoryReferenceKey(noteRef);
    if (expanded) nodes.push(...candidates);
    else
      nodes.push(
        catalogue.get(noteKey) ??
          resolveTheoryReference(state, noteRef, map.annotations),
      );
    // Note-level relations keep an explicit overview node even while its blocks are expanded.
    if (expanded && linked.has(noteKey))
      nodes.push(
        catalogue.get(noteKey) ??
          resolveTheoryReference(state, noteRef, map.annotations),
      );
    for (const node of catalogue.values())
      if (node.ref.noteId === noteId)
        projection.set(node.id, expanded ? node.id : noteKey);
  }
  const visibleIds = new Set(nodes.map((node) => node.id));
  const projected = new Map<string, TheoryGraphEdge>();
  for (const edge of edges) {
    const source = projection.get(edge.source);
    const target = projection.get(edge.target);
    if (
      !source ||
      !target ||
      source === target ||
      !visibleIds.has(source) ||
      !visibleIds.has(target)
    )
      continue;
    const key = JSON.stringify([source, target, edge.kind, edge.origin]);
    const existing = projected.get(key);
    if (existing) {
      existing.relations.push(...edge.relations);
      if (!existing.description.includes(edge.description))
        existing.description += "\n" + edge.description;
      if (edge.error) existing.error = edge.error;
    } else
      projected.set(key, {
        ...edge,
        id: key,
        source,
        target,
        relations: [...edge.relations],
      });
  }
  return { nodes, edges: [...projected.values()] };
}

export function theoryRelationError(
  state: ResearchNotebookState,
  relation: TheoryRelation,
): string | null {
  const source = theoryReferenceKey(relation.source);
  const target = theoryReferenceKey(relation.target);
  if (source === target) return "不能关联自身。";
  if (
    resolveTheoryReference(state, relation.source).missing ||
    resolveTheoryReference(state, relation.target).missing
  )
    return "请选择仍然存在的笔记或内容。";
  const relations = getResearchTheoryMap(state).relations;
  if (
    relations.some(
      (item) =>
        item.id !== relation.id &&
        item.kind === relation.kind &&
        theoryReferenceKey(item.source) === source &&
        theoryReferenceKey(item.target) === target,
    )
  )
    return "已有相同方向与类型的关系，请编辑原有关系。";
  const editableOrigin = state.view === "maps" ? "manual" : "note";
  const edges = allRelations(state).filter(
    (edge) =>
      edge.origin !== editableOrigin || edge.relations[0]?.id !== relation.id,
  );
  const seen = new Set<string>();
  const pending = [target];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === source)
      return "该关系会形成循环依赖，请检查方向或关联内容。";
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(
      ...edges
        .filter((edge) => edge.source === current && !edge.error)
        .map((edge) => edge.target),
    );
  }
  return null;
}

export function invalidateTheoryReviews(
  state: ResearchNotebookState,
  changedNoteIds: Iterable<string>,
): ResearchNote[] {
  const affected = new Set(changedNoteIds);
  const relations = allRelations(state).filter(
    (edge) => edge.origin !== "manual",
  );
  const refNote = (key: string) =>
    (JSON.parse(key) as [string, string | null])[0];
  let count = -1;
  while (count !== affected.size) {
    count = affected.size;
    for (const edge of relations)
      if (affected.has(refNote(edge.source)))
        affected.add(refNote(edge.target));
  }
  return state.notes.map((note) =>
    affected.has(note.id) && note.reviewStatus === "reviewed"
      ? { ...note, reviewStatus: "pending" }
      : note,
  );
}

export function saveTheoryRelation(
  state: ResearchNotebookState,
  relation: TheoryRelation,
): ResearchNotebookState {
  if (theoryRelationError(state, relation)) return state;
  let next = ensureTheoryMaps(state);
  if (next.view === "maps") {
    const doc = activeTheoryMapDocument(next);
    return updateTheoryMapDocument(next, {
      ...doc,
      relations: [
        ...doc.relations.filter((item) => item.id !== relation.id),
        relation,
      ],
    });
  }
  next = {
    ...next,
    theoryMaps: {
      ...next.theoryMaps!,
      unresolvedKnowledge: {
        annotations: next.theoryMaps?.unresolvedKnowledge?.annotations ?? [],
        relations:
          next.theoryMaps?.unresolvedKnowledge?.relations.filter(
            (item) => item.id !== relation.id,
          ) ?? [],
      },
    },
  };
  next = {
    ...next,
    notes: next.notes.map((note) => ({
      ...note,
      theory: {
        annotations: note.theory?.annotations ?? [],
        relations: [
          ...(note.theory?.relations ?? []).filter(
            (item) => item.id !== relation.id,
          ),
          ...(note.id === relation.target.noteId ? [relation] : []),
        ],
      },
    })),
  };
  return {
    ...next,
    notes: invalidateTheoryReviews(next, [relation.target.noteId]),
  };
}

export function removeTheoryRelation(
  state: ResearchNotebookState,
  id: string,
): ResearchNotebookState {
  const map = getResearchTheoryMap(state);
  const relation = map.relations.find((item) => item.id === id);
  if (!relation) return state;
  let next = ensureTheoryMaps(state);
  if (next.view === "maps") {
    const doc = activeTheoryMapDocument(next);
    return updateTheoryMapDocument(next, {
      ...doc,
      relations: doc.relations.filter((item) => item.id !== id),
    });
  }
  next = {
    ...next,
    theoryMaps: {
      ...next.theoryMaps!,
      unresolvedKnowledge: {
        annotations: next.theoryMaps?.unresolvedKnowledge?.annotations ?? [],
        relations:
          next.theoryMaps?.unresolvedKnowledge?.relations.filter(
            (item) => item.id !== id,
          ) ?? [],
      },
    },
  };
  next = {
    ...next,
    notes: next.notes.map((note) => ({
      ...note,
      theory: {
        annotations: note.theory?.annotations ?? [],
        relations:
          note.theory?.relations.filter((item) => item.id !== id) ?? [],
      },
    })),
  };
  return {
    ...next,
    notes: invalidateTheoryReviews(next, [relation.target.noteId]),
  };
}

export function theoryLayoutKey(
  map: ResearchTheoryMapState,
  activeNoteId: string,
): string {
  return map.scope === "local"
    ? "local:" + activeNoteId
    : map.scope === "topic"
      ? "topic:" + map.topicId
      : "global";
}
