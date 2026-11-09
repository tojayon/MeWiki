import ResearchRichBlock from "./ResearchRichBlock.tsx";
import ResearchNoteEmbed from './ResearchNoteEmbed.tsx';
import ResearchNoteEmbedPicker from './ResearchNoteEmbedPicker.tsx';
import { noteEmbedSelectionError, type ResearchNoteEmbedBlock } from '../domain/researchNoteEmbed.ts';
import ExternalContentCard from "../integrations/ExternalContentCard.tsx";
import IntegrationNotice from "../integrations/IntegrationNotice.tsx";
import { useIntegration } from "../integrations/IntegrationContext.ts";
import { useLibraryWorkspace } from "../state/LibraryWorkspaceContext.ts";
import { isResearchRichBlock } from "../domain/researchRichContent.ts";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  BookOpen,
  ExternalLink,
  Eye,
  Info,
  ListChecks,
  Settings2,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plug,
  Rows2,
  Rows3,
  Trash2,
  Tags,
  UnfoldVertical,
  X,
} from "lucide-react";
import {
  createResearchNote,
  createResearchContentBlock,
  commitResearchTextBlock,
  convertResearchBlockType,
  deleteResearchNote,
  insertResearchBlock,
  parseResearchMarkdown,
  removeResearchBlock,
  researchContentType,
  serializeResearchMarkdown,
  updateResearchNote,
  type ResearchNotebookBlock,
  type ResearchContentType,
  type ResearchNotebookState,
} from "../domain/researchNotebook.ts";
import DeviceInspectorModal from "./DeviceInspectorModal.tsx";
import ResearchFormulaComposer from "./ResearchFormulaComposer.tsx";
import ResearchDictionary from "./ResearchDictionary.tsx";
import ResearchSymbolBacklinks from "./ResearchSymbolBacklinks.tsx";
import { VariableRecipePanel } from "./ResearchVariableRecipe.tsx";
import {
  ResearchVariableRecipeContext,
  type VariableRecipeRequest,
} from "./ResearchVariableRecipeContext.ts";
import ResearchMathText from "./ResearchMathText.tsx";
import ResearchTextBlock from "./ResearchTextBlock.tsx";
import { researchTitleInputValue } from "../domain/researchTextPlaceholders.ts";
import ResearchCallout from "./ResearchCallout.tsx";
import ResearchExamples from "./ResearchExamples.tsx";
import ResearchMediaBlock from "./ResearchMediaBlock.tsx";
import ResearchBookmarkBlock from "./ResearchBookmarkBlock.tsx";
import { browserMediaStore } from "../state/researchMediaStorage.ts";
import { researchMediaClient } from "../state/researchMediaClient.ts";
import {
  createBrowserMediaArchive,
  releaseBrowserMediaArchive,
} from "../state/researchMediaArchive.ts";
import {
  mediaFileKind,
  mediaKindFromMime,
  type ResearchMediaBlock as MediaBlock,
} from "../domain/researchMedia.ts";
import {
  findResearchFormula,
  listFormulaConsumers,
  type FormulaAddress,
} from "../domain/researchFormulaLinks.ts";
import {
  ResearchNoteListTools,
  ResearchNoteOrganizationBar,
  ResearchNoteOrganizationPanel,
  ResearchNoteTags,
  ResearchNoteReviewStatus,
} from "./ResearchNoteManagement.tsx";
import ResearchBlockInsert, {
  type BlockInsertPosition,
  type ResearchBlockInsertHandle,
} from "./ResearchBlockInsert.tsx";
import ResearchSidebarResize from "./ResearchSidebarResize.tsx";
import ResearchNoteTree from "./ResearchNoteTree.tsx";
import ResearchNoteMoreMenu, {
  type ResearchNoteMenuAction,
} from "./ResearchNoteMoreMenu.tsx";
import ResearchTheoryMap from "./ResearchTheoryMap.tsx";
import ResearchTheoryDocuments from "./ResearchTheoryDocuments.tsx";
import {
  ensureTheoryMaps,
  getResearchTheoryMap,
  patchTheoryMapView,
  type TheoryReference,
} from "../domain/researchTheoryMap.ts";
import "./ResearchNotebook.css";
import {
  currentNoteLibrary,
  getNoteLibrary,
  libraryNotes,
  noteBasisIds,
  openLibraryNote,
  prepareLibraryNote,
  selectNoteLibrary,
  setLibraryFilters,
} from "../domain/researchNoteLibraries.ts";
import { useResearchLibrary } from "../state/useResearchNotebook.ts";
import ResearchLibraryStorage from "./ResearchLibraryStorage.tsx";
import ResearchTheoryDrawer from "./ResearchTheoryDrawer.tsx";
import {
  partitionTheoryBlocks,
  sectionInsertionBefore,
  setTheoryBlockSection,
  theoryAreaLabels,
  theoryReadingFlow,
  type TheoryContentArea,
} from "../domain/researchTheorySections.ts";
import { moveResearchBlocks } from "../domain/researchBlockMovement.ts";
import {
  findResearchBlock,
  flattenResearchBlocks,
  updateResearchBlockTree,
  type ResearchExampleContainer,
} from "../domain/researchBlockTree.ts";
import { useResearchBlockDrag } from "./useResearchBlockDrag.ts";
import { useResearchTheoryDrawerLayout } from "./useResearchTheoryDrawerLayout.ts";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import ResearchOutline from "./ResearchOutline.tsx";
import {
  buildResearchOutline,
  type ResearchOutlineHeading,
} from "../domain/researchOutline.ts";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import ResearchReadingPane, {
  type ReadingContentTarget,
} from "./ResearchReadingPane.tsx";
import ResearchReadingConnections from "./ResearchReadingConnections.tsx";
import { useNarrowResearchNoteHeader } from "./useResearchNoteHeader.ts";
import {
  closeReadingPane,
  createReadingPanes,
  detachReadingPane,
  openReadingPane,
  selectReadingPrimary,
} from "../state/researchReadingPanes.ts";
import { useResearchReadingPanes } from "../state/useResearchReadingPanes.ts";
import "./ResearchNoteLinks.css";

export interface ResearchEvidenceContext {
  runId: string;
  runTitle: string;
  time: number;
  loopId?: string;
  packetId?: string;
  eventLabel?: string;
}

const modeStorageKey = "mewiki:research-notebook-mode";
const sidebarStorageKey = "mewiki:research-notebook-sidebar-collapsed";
const outlineStorageKey = "mewiki:research-notebook-outline-collapsed";
type ContentTarget = FormulaAddress & { headingId?: string };

function loadReadOnlyMode() {
  try {
    return localStorage.getItem(modeStorageKey) !== "edit";
  } catch {
    return true;
  }
}

function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(sidebarStorageKey) === "true";
  } catch {
    return false;
  }
}

function loadOutlineCollapsed() {
  try {
    const saved = localStorage.getItem(outlineStorageKey);
    if (saved !== null) return saved === "true";
  } catch {
    /* The outline remains usable without persistent browser storage. */
  }
  return window.matchMedia("(max-width: 999px)").matches;
}

function ResearchNoteTitle({
  title,
  placeholder,
  readOnly,
  onChange,
}: {
  title: string;
  placeholder: string;
  readOnly: boolean;
  onChange: (title: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const previousReadOnly = useRef(readOnly);
  const source = readOnly ? title : researchTitleInputValue(title);
  useLayoutEffect(() => {
    // Sync external changes without treating text being typed as a legacy hint.
    if (
      ref.current &&
      (ref.current.value !== title || previousReadOnly.current !== readOnly)
    )
      ref.current.value = source;
    previousReadOnly.current = readOnly;
  }, [title, source, readOnly]);
  return (
    <input
      ref={ref}
      className="research-note-title"
      aria-label="笔记标题"
      title={title || placeholder}
      placeholder={placeholder}
      defaultValue={source}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function EvidenceBlock({
  block,
  readOnly,
  onNote,
  onRemove,
  onComplete,
}: {
  block: Extract<ResearchNotebookBlock, { type: "evidence" }>;
  readOnly: boolean;
  onNote: (value: string) => void;
  onRemove: () => void;
  onComplete: () => void;
}) {
  return (
    <article className="research-evidence-block">
      <div className="research-evidence-heading">
        <span>
          <BookmarkPlus size={14} /> 回放证据
        </span>
        {!readOnly && (
          <button
            data-tone="danger"
            data-ui="icon-action"
            className="research-remove-block"
            aria-label="移除回放证据"
            onClick={onRemove}
            title="移除回放证据"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <strong>{block.runTitle}</strong>
      <span className="research-evidence-context">
        t = {block.time.toFixed(6)} s{block.loopId && ` · ${block.loopId}`}
        {block.packetId && ` · ${block.packetId}`}
        {block.eventLabel && ` · ${block.eventLabel}`}
      </span>
      <code>{block.runId}</code>
      {readOnly ? (
        block.note && (
          <p className="research-evidence-note research-read-text">
            <ResearchMathText text={block.note} />
          </p>
        )
      ) : (
        <input
          aria-label="回放观察备注"
          placeholder="补充这条证据对应的观察…"
          value={block.note ?? ""}
          onChange={(event) => onNote(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              !(event.ctrlKey || event.metaKey) ||
              event.shiftKey ||
              event.altKey ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
            onComplete();
          }}
        />
      )}
    </article>
  );
}

export default function ResearchNotebook({
  state: inputState,
  onChange,
  citation,
  standalonePage = false,
  onOpenHelp,
}: {
  state: ResearchNotebookState;
  onChange: (next: ResearchNotebookState) => void;
  citation?: ResearchEvidenceContext;
  standalonePage?: boolean;
  onOpenHelp?: () => void;
}) {
  const state = useMemo(() => ensureTheoryMaps(inputState), [inputState]);
  const integration = useIntegration();
  const workspace = useLibraryWorkspace();
  const confirmDelete = useDeleteConfirmation();
  const latestState = useRef(state);
  useLayoutEffect(() => {
    latestState.current = state;
  }, [state]);
  const importRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const insertedBlockRef = useRef<string | null>(null);
  const externalInsertion = useRef<AbortController | null>(null);
  const [noteEmbedInsertion, setNoteEmbedInsertion] = useState<{
    noteId: string; blockId: string; adjacentBlockId?: string; position: BlockInsertPosition;
    area?: TheoryContentArea; container?: ResearchExampleContainer;
  } | null>(null);
  const blockInsertionMenus = useRef(
    new Map<string, ResearchBlockInsertHandle>(),
  );
  const locatedContentRef = useRef<ContentTarget | null>(null);
  const [contentTarget, setContentTarget] = useState<ContentTarget | null>(
    null,
  );
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(
    null,
  );
  const [importError, setImportError] = useState("");
  const [blockConversionError, setBlockConversionError] = useState<{
    noteId: string;
    text: string;
  } | null>(null);
  const [mediaImportStatus, setMediaImportStatus] = useState<{
    noteId: string;
    directory: string | null;
    text: string;
  } | null>(null);
  const mediaImportOperation = useRef<AbortController | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [noteMapTools, setNoteMapTools] = useState<HTMLDivElement | null>(null);
  const [drawersExiting, setDrawersExiting] = useState(false);
  const [exampleTabs, setExampleTabs] = useState<Record<string, string>>({});
  const library = useResearchLibrary();
  const [fullPage, setFullPage] = useState(false);
  const [readOnly, setReadOnly] = useState(loadReadOnlyMode);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(loadSidebarCollapsed);
  const [outlineCollapsed, setOutlineCollapsed] =
    useState(loadOutlineCollapsed);
  const [recipeActive, setRecipeActive] = useState(false);
  const [recipeInspection, setRecipeInspection] = useState<
    (VariableRecipeRequest & { key: number; paneId?: string }) | null
  >(null);
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  const readingRail = useRef<HTMLDivElement>(null);
  const revealReadingPane = useRef<string | null>(null);
  const loadedReadingScope = useRef<string | null>(null);
  const readingContents = useRef(new Map<string, HTMLDivElement>());
  const secondaryContentRef = useRef<HTMLDivElement | null>(null);
  const [readingTarget, setReadingTarget] = useState<{
    paneId: string;
    target: ReadingContentTarget;
  } | null>(null);
  const [menuPanel, setMenuPanel] = useState<{
    noteId: string;
    panel: "tags" | "metadata";
    trigger: HTMLButtonElement;
  } | null>(null);
  const [noteHeader, setNoteHeader] = useState<HTMLDivElement | null>(null);
  const narrowHeader = useNarrowResearchNoteHeader(noteHeader);
  const isFullPage = standalonePage || fullPage;
  const notesInLibrary = libraryNotes(state);
  const note = notesInLibrary.find((item) => item.id === state.activeNoteId) ??
    notesInLibrary[0] ??
    state.notes[0] ?? {
      id: "",
      title: "",
      createdAt: "",
      updatedAt: "",
      blocks: [],
    };
  useLayoutEffect(
    () => () => {
      externalInsertion.current?.abort();
      externalInsertion.current = null;
      setNoteEmbedInsertion(null);
    },
    [note.id, library.directory, readOnly, state.view, state.open, exampleTabs],
  );
  useEffect(() => {
    return () => {
      mediaImportOperation.current?.abort();
      mediaImportOperation.current = null;
      setMediaImportStatus(null);
    };
  }, [note.id, library.directory, readOnly]);
  const readingScope =
    library.status === "loading" ? null : (library.directory ?? "browser");
  const [synchronizedReading, setReading] = useResearchReadingPanes(
    note.id,
    new Set(state.notes.map((note) => note.id)),
    readingScope,
  );
  const primaryPane = synchronizedReading.panes.find(
    (pane) => pane.id === "primary",
  );
  const extraPanes = synchronizedReading.panes.filter(
    (pane) => pane.id !== "primary",
  );
  const activeReadingPane =
    synchronizedReading.panes.find(
      (pane) => pane.id === synchronizedReading.activeId,
    ) ?? primaryPane;
  const outlinedNote =
    state.notes.find((note) => note.id === activeReadingPane?.noteId) ?? note;
  const showingNotes = state.view === "notes" || state.view === "foundations";
  const compactHeader =
    showingNotes &&
    !!primaryPane &&
    notesInLibrary.length > 0 &&
    (extraPanes.length > 0 || narrowHeader) &&
    !state.theoryMaps?.noteViewOpen;
  const isFoundation = getNoteLibrary(note) === "foundation";
  const {
    drawers,
    setDrawers,
    setFrame,
    frameStyle,
    resizing,
    resizeHandle,
    middleCollapsed,
    revealDerivation,
    fillEqually,
  } = useResearchTheoryDrawerLayout(
    state.open &&
      showingNotes &&
      isFoundation &&
      !state.theoryMaps?.noteViewOpen,
  );
  const drawersActive = isFoundation && drawers.enabled;
  const derivationHidden = drawersActive && middleCollapsed;
  const separateTheoryContent =
    isFoundation && (drawers.enabled || drawersExiting);
  const areas = partitionTheoryBlocks(note.blocks);
  const emptyLibrary = notesInLibrary.length === 0;
  const selectedSymbol =
    state.symbols.find((entry) => entry.id === state.activeSymbolId) ??
    state.symbols[0];
  const symbolBacklinksAvailable =
    state.view === "dictionary" && !!selectedSymbol;
  const outlineAvailable =
    symbolBacklinksAvailable ||
    (showingNotes &&
      !emptyLibrary &&
      !!primaryPane &&
      !state.theoryMaps?.noteViewOpen);
  const outlineVisible = outlineAvailable && !outlineCollapsed;
  const rightPanelLabel = recipeActive
    ? "变量配方"
    : symbolBacklinksAvailable
      ? "反向链接"
      : "文章大纲";
  const outline = useMemo(
    () => buildResearchOutline(note.blocks),
    [note.blocks],
  );
  const displayedOutline = useMemo(
    () => buildResearchOutline(outlinedNote.blocks),
    [outlinedNote.blocks],
  );
  const headingsByBlock = useMemo(() => {
    const result = new Map<string, ResearchOutlineHeading[]>();
    for (const heading of outline) {
      const entries = result.get(heading.blockId) ?? [];
      entries.push(heading);
      result.set(heading.blockId, entries);
    }
    return result;
  }, [outline]);
  const pendingDeleteNote = state.notes.find(
    (item) => item.id === pendingDeleteNoteId,
  );
  const activateReadingPane = (id: string) =>
    setReading((current) =>
      current.activeId === id ? current : { ...current, activeId: id },
    );
  const openLinkedNote = (
    sourceId: string,
    targetId: string,
    blockId?: string,
    sourceElement?: HTMLElement,
  ) => {
    if (!latestState.current.notes.some((note) => note.id === targetId)) return;
    const sourceBlock = sourceElement?.closest<HTMLElement>("[data-block-id]");
    const linkIndex =
      sourceBlock && sourceElement
        ? [...sourceBlock.querySelectorAll("a.research-note-link")]
            .filter((link) => link.closest("[data-block-id]") === sourceBlock)
            .indexOf(sourceElement)
        : -1;
    const reference =
      sourceBlock?.dataset.blockId && linkIndex >= 0
        ? { blockId: sourceBlock.dataset.blockId, linkIndex }
        : undefined;
    const next = openReadingPane(
      synchronizedReading,
      sourceId,
      targetId,
      crypto.randomUUID(),
      blockId,
      reference,
    );
    revealReadingPane.current = next.activeId;
    setReading(next);
    if (blockId && next.activeId) {
      if (next.activeId === "primary")
        openContent({ noteId: targetId, blockId });
      else setReadingTarget({ paneId: next.activeId, target: { blockId } });
    }
  };
  const closeReading = (id: string) => {
    const next = closeReadingPane(synchronizedReading, id);
    revealReadingPane.current = next.activeId;
    setReading(next);
    if (next.panes.length && next.primaryNoteId !== note.id)
      onChange(openLibraryNote(latestState.current, next.primaryNoteId));
  };
  const applyNavigationChange = (next: ResearchNotebookState) => {
    if (
      next.activeNoteId !== state.activeNoteId ||
      !synchronizedReading.panes.length
    )
      setReading(selectReadingPrimary(synchronizedReading, next.activeNoteId));
    onChange(next);
  };
  useLayoutEffect(() => {
    secondaryContentRef.current =
      readingContents.current.get(activeReadingPane?.id ?? "") ?? null;
  });
  useLayoutEffect(() => {
    if (readingScope !== loadedReadingScope.current) {
      loadedReadingScope.current = readingScope;
      if (readingScope !== null)
        revealReadingPane.current = synchronizedReading.activeId;
    }
    const target = revealReadingPane.current;
    if (!target) return;
    revealReadingPane.current = null;
    const element = [
      ...(readingRail.current?.querySelectorAll<HTMLElement>(
        "[data-reading-pane-id]",
      ) ?? []),
    ].find((element) => element.dataset.readingPaneId === target);
    if (!element || !readingRail.current) return;
    const rail = readingRail.current,
      bounds = rail.getBoundingClientRect(),
      rect = element.getBoundingClientRect();
    if (rect.left < bounds.left) rail.scrollLeft += rect.left - bounds.left;
    else if (rect.right > bounds.right)
      rail.scrollLeft += rect.right - bounds.right;
  }, [
    synchronizedReading.activeId,
    synchronizedReading.panes.length,
    readingScope,
  ]);

  useEffect(() => {
    if (!drawersExiting) return;
    // Also finish if a hidden page or reduced-motion setting cancels transitionend.
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 300;
    const timer = window.setTimeout(() => setDrawersExiting(false), delay);
    return () => window.clearTimeout(timer);
  }, [drawersExiting]);

  const toggleDrawers = () => {
    setDrawersExiting(drawers.enabled);
    setDrawers((current) => ({ ...current, enabled: !current.enabled }));
  };

  useEffect(() => {
    try {
      localStorage.setItem(modeStorageKey, readOnly ? "read" : "edit");
    } catch {
      // The mode remains usable when browser storage is unavailable.
    }
  }, [readOnly]);

  useEffect(() => {
    try {
      localStorage.setItem(sidebarStorageKey, String(sidebarCollapsed));
    } catch {
      // Collapsing remains available when browser storage is unavailable.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(outlineStorageKey, String(outlineCollapsed));
    } catch {
      /* The in-memory toggle remains available. */
    }
  }, [outlineCollapsed]);

  useEffect(() => {
    const openDictionaryEntry = (event: Event) => {
      const entryId = (event as CustomEvent<string>).detail;
      if (!entryId) return;
      onChange({ ...state, view: "dictionary", activeSymbolId: entryId });
    };
    window.addEventListener("research-dictionary-open", openDictionaryEntry);
    return () =>
      window.removeEventListener(
        "research-dictionary-open",
        openDictionaryEntry,
      );
  }, [onChange, state]);
  useEffect(() => {
    if (
      !contentTarget ||
      locatedContentRef.current === contentTarget ||
      (state.view !== "notes" && state.view !== "foundations") ||
      state.activeNoteId !== contentTarget.noteId ||
      !state.open
    )
      return;
    const blockElement = [
      ...(pageRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ??
        []),
    ].find((item) => item.dataset.blockId === contentTarget.formulaId);
    const element = contentTarget.headingId
      ? [
          ...(blockElement?.querySelectorAll<HTMLElement>(
            "[data-outline-id]",
          ) ?? []),
        ].find((item) => item.dataset.outlineId === contentTarget.headingId)
      : blockElement;
    if (
      !element ||
      !element.getClientRects().length ||
      element.closest("[inert]")
    )
      return;
    let cancelled = false;
    const locate = () => {
      if (cancelled || !element.isConnected) return;
      locatedContentRef.current = contentTarget;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "center", inline: "nearest" });
      if (contentTarget.headingId) {
        for (const animation of pageRef.current?.getAnimations({
          subtree: true,
        }) ?? [])
          if (animation.id === "research-heading-location") animation.cancel();
        const highlight = element.animate(
          [
            { backgroundColor: "#dce9ff", offset: 0 },
            { backgroundColor: "#dce9ff", offset: 0.8 },
            { backgroundColor: "transparent", offset: 1 },
          ],
          { duration: 1500, easing: "ease" },
        );
        highlight.id = "research-heading-location";
      }
    };
    const animations =
      pageRef.current
        ?.querySelector(".research-note-content-frame")
        ?.getAnimations() ?? [];
    if (animations.length)
      void Promise.allSettled(
        animations.map((animation) => animation.finished),
      ).then(locate);
    else locate();
    return () => {
      cancelled = true;
    };
  }, [
    contentTarget,
    state.view,
    state.activeNoteId,
    state.open,
    state.theoryMaps?.noteViewOpen,
    drawers.given,
    drawers.conclusion,
    drawersActive,
    separateTheoryContent,
    derivationHidden,
    exampleTabs,
    note.blocks,
  ]);
  useEffect(() => {
    if (!pendingDeleteNote || !state.open) return;
    const frame = window.requestAnimationFrame(() =>
      cancelDeleteRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [pendingDeleteNote, state.open]);
  useLayoutEffect(() => {
    if (!insertedBlockRef.current) return;
    const element = [
      ...(pageRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ??
        []),
    ].find((block) => block.dataset.blockId === insertedBlockRef.current);
    if (!element) return;
    insertedBlockRef.current = null;
    element.scrollIntoView({ block: "nearest" });
    element
      .querySelector<HTMLElement>(
        ".research-editable-text, textarea, .research-formula-edit-button, input, .research-example-start",
      )
      ?.focus({ preventScroll: true });
  }, [note?.blocks, drawers.given, drawers.conclusion]);

  const openContent = (ref: TheoryReference, headingId?: string) => {
    const targetNote = state.notes.find((note) => note.id === ref.noteId);
    const location =
      targetNote && ref.blockId
        ? findResearchBlock(targetNote.blocks, ref.blockId)
        : undefined;
    if (!targetNote || (ref.blockId && !location)) return;
    setContentTarget(
      ref.blockId
        ? {
            noteId: ref.noteId,
            formulaId: ref.blockId,
            ...(headingId ? { headingId } : {}),
          }
        : null,
    );
    if (location?.path.length)
      setExampleTabs((current) => ({
        ...current,
        ...Object.fromEntries(
          location.path.map((owner) => [owner.exampleBlockId, owner.tabId]),
        ),
      }));
    const section = location?.path.length
      ? targetNote.blocks.find(
          (block) => block.id === location.path[0].exampleBlockId,
        )?.section
      : location?.block.section;
    if (section) setDrawers((current) => ({ ...current, [section]: true }));
    else if (ref.blockId) revealDerivation();
    onChange(
      patchTheoryMapView(openLibraryNote(state, ref.noteId), { open: false }),
    );
  };
  const closeOutline = () => {
    setOutlineCollapsed(true);
    const target =
      recipeActive && recipeInspection?.target.isConnected
        ? recipeInspection.target
        : outlineToggleRef.current;
    target?.focus({ preventScroll: true });
  };
  const navigateOutline = (heading: ResearchOutlineHeading) => {
    if (
      (pageRef.current
        ?.closest(".research-notebook-layout")
        ?.getBoundingClientRect().width ?? window.innerWidth) < 1000
    )
      setOutlineCollapsed(true);
    if (activeReadingPane && activeReadingPane.id !== "primary")
      setReadingTarget({
        paneId: activeReadingPane.id,
        target: { blockId: heading.blockId, headingId: heading.id },
      });
    else openContent({ noteId: note.id, blockId: heading.blockId }, heading.id);
  };
  const openFormula = (address: FormulaAddress) => {
    if (findResearchFormula(state, address))
      openContent({ noteId: address.noteId, blockId: address.formulaId });
  };
  const openRightPanelFormula = (address: FormulaAddress) => {
    if (
      (outlineToggleRef.current
        ?.closest(".research-notebook-layout")
        ?.getBoundingClientRect().width ?? window.innerWidth) < 1000
    )
      setOutlineCollapsed(true);
    openFormula(address);
  };
  const openRecipeFormula = (address: FormulaAddress) => {
    const paneId = recipeInspection?.paneId;
    if (
      showingNotes &&
      paneId &&
      paneId !== "primary" &&
      synchronizedReading.panes.some((pane) => pane.id === paneId)
    ) {
      if (
        (outlineToggleRef.current
          ?.closest(".research-notebook-layout")
          ?.getBoundingClientRect().width ?? window.innerWidth) < 1000
      )
        setOutlineCollapsed(true);
      openLinkedNote(paneId, address.noteId, address.formulaId);
    } else openRightPanelFormula(address);
  };
  const recipePanel = recipeInspection ? (
    <VariableRecipePanel
      key={recipeInspection.key}
      state={state}
      owner={recipeInspection.owner}
      part={recipeInspection.part}
      onOpenFormula={openRecipeFormula}
    />
  ) : (
    <p className="research-outline-empty">
      尚未选择变量。
      <span>
        点击公式中的变量，再选择“逐层查看变量配方”，即可从这里查看输入与来源。
      </span>
    </p>
  );
  const noteReferenced = state.notes.some(
    (other) => other.id !== note.id && noteBasisIds(other).includes(note.id),
  );

  const setNote = (patch: Partial<Pick<typeof note, "title" | "blocks">>) =>
    onChange(updateResearchNote(latestState.current, note.id, patch));

  const addBlock = async (
    type: ResearchContentType,
    adjacentBlockId?: string,
    position: BlockInsertPosition = "above",
    targetArea?: TheoryContentArea,
    targetContainer?: ResearchExampleContainer,
    provider?: string,
    noteEmbed?: ResearchNoteEmbedBlock,
  ) => {
    if (type === "evidence" && !citation) return;
    if (type === 'noteEmbed' && !noteEmbed) {
      setNoteEmbedInsertion({ noteId: note.id, blockId: crypto.randomUUID(), adjacentBlockId, position, area: targetArea, container: targetContainer });
      return;
    }
    let external = null;
    if (type === "external") {
      if (!provider) return;
      externalInsertion.current?.abort();
      const controller = new AbortController();
      externalInsertion.current = controller;
      external = await integration.chooseContent(provider, controller.signal);
      if (externalInsertion.current === controller)
        externalInsertion.current = null;
      if (!external || controller.signal.aborted) return;
    }
    const current = latestState.current;
    const currentNote = current.notes.find((item) => item.id === note.id);
    if (
      !currentNote ||
      current.activeNoteId !== state.activeNoteId ||
      current.view !== state.view
    )
      return;
    let beforeBlockId = adjacentBlockId;
    let container = targetContainer;
    const adjacent = adjacentBlockId
      ? findResearchBlock(currentNote.blocks, adjacentBlockId)
      : undefined;
    if (adjacentBlockId) {
      if (!adjacent) return;
      container = adjacent.container;
      if (position === "below")
        beforeBlockId = adjacent.siblings[adjacent.index + 1]?.id;
    }
    if (!adjacentBlockId && targetArea && !container)
      beforeBlockId = sectionInsertionBefore(currentNote.blocks, targetArea);
    const block: ResearchNotebookBlock | null = noteEmbed ?? (
      type === "external" && external
        ? { id: crypto.randomUUID(), type: "external" as const, ...external }
        : createResearchContentBlock(type, citation));
    if (!block) return;
    const section = container
      ? undefined
      : (targetArea ?? adjacent?.block.section);
    if (section && section !== "derivation") block.section = section;
    const next = insertResearchBlock(
      current,
      note.id,
      block,
      beforeBlockId,
      container,
    );
    if (next === current) return;
    if (noteEmbed) {
      const error = noteEmbedSelectionError(next.notes, { noteId: note.id, blockId: noteEmbed.id }, noteEmbed);
      if (error) { setBlockConversionError({ noteId: note.id, text: error }); return; }
    }
    insertedBlockRef.current = block.id;
    onChange(next);
  };

  const containsReferencedFormula = (blocks: ResearchNotebookBlock[]) => {
    const removed = flattenResearchBlocks(blocks);
    const ids = new Set(removed.map((block) => block.id));
    return removed.some(
      (block) =>
        block.type === "formula" &&
        listFormulaConsumers(state, {
          noteId: note.id,
          formulaId: block.id,
        }).some(
          (consumer) =>
            consumer.noteId !== note.id || !ids.has(consumer.formulaId),
        ),
    );
  };
  const canConvertBlock = (block: ResearchNotebookBlock) =>
    !flattenResearchBlocks([block]).some(
      (child) =>
        child.type === 'noteEmbed' || child.type === "formula" &&
        (listFormulaConsumers(state, { noteId: note.id, formulaId: child.id })
          .length > 0 ||
          child.parts?.some((part) => part.type === "symbol" && part.source)),
    );

  const changeBlockType = (blockId: string, type: ResearchContentType) => {
    const current = findResearchBlock(note.blocks, blockId)?.block;
    if (!current || researchContentType(current) === type) return;
    if (!canConvertBlock(current)) return;
    const evidence = citation && {
      runId: citation.runId,
      runTitle: citation.runTitle,
      time: citation.time,
      loopId: citation.loopId,
      packetId: citation.packetId,
      eventLabel: citation.eventLabel,
    };
    let replacement: ResearchNotebookBlock | null;
    try {
      replacement = convertResearchBlockType(current, type, evidence);
    } catch (cause) {
      setBlockConversionError({
        noteId: note.id,
        text:
          cause instanceof Error
            ? cause.message
            : "内容转换失败，原内容已保留。",
      });
      return;
    }
    if (!replacement || replacement === current) return;
    setBlockConversionError(null);
    insertedBlockRef.current = blockId;
    setNote({
      blocks: updateResearchBlockTree(note.blocks, blockId, () => replacement),
    });
  };

  const patchBlock = (blockId: string, patch: Record<string, unknown>) => {
    const current = latestState.current;
    const currentNote = current.notes.find((item) => item.id === note.id);
    if (!currentNote) return;
    onChange(
      updateResearchNote(current, note.id, {
        blocks: updateResearchBlockTree(
          currentNote.blocks,
          blockId,
          (block) => ({ ...block, ...patch }) as ResearchNotebookBlock,
        ),
      }),
    );
  };
  const insertMediaAfter = (
    ownerNoteId: string,
    blockId: string | undefined,
    blocks: MediaBlock[],
    container?: ResearchExampleContainer,
  ) => {
    let current = latestState.current;
    const owner = current.notes.find((item) => item.id === ownerNoteId);
    if (!owner) return;
    const location = blockId
      ? findResearchBlock(owner.blocks, blockId)
      : undefined;
    if (blockId && !location) return;
    if (container) {
      const parent = findResearchBlock(
        owner.blocks,
        container.exampleBlockId,
      )?.block;
      if (
        parent?.type !== "examples" ||
        !parent.tabs.some((tab) => tab.id === container.tabId)
      )
        return;
    }
    const beforeId = location?.siblings[location.index + 1]?.id;
    for (const block of blocks)
      current = insertResearchBlock(
        current,
        ownerNoteId,
        location?.block.section
          ? { ...block, section: location.block.section }
          : block,
        beforeId,
        location?.container ?? container,
      );
    onChange(current);
  };
  const acceptNoteMedia = async (files: File[], target: HTMLElement | null) => {
    if (
      readOnly ||
      library.busy ||
      library.status === "loading" ||
      mediaImportOperation.current ||
      !files.length
    )
      return;
    const abort = new AbortController();
    mediaImportOperation.current = abort;
    const noteId = note.id;
    const tab = target?.closest<HTMLElement>(
      '[data-research-drop-area="example"]',
    );
    const container =
      tab?.dataset.researchExampleBlockId && tab.dataset.researchExampleTabId
        ? {
            exampleBlockId: tab.dataset.researchExampleBlockId,
            tabId: tab.dataset.researchExampleTabId,
          }
        : undefined;
    const nearestBlockId =
      target?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
    const blockId =
      nearestBlockId === container?.exampleBlockId ? undefined : nearestBlockId;
    const directory = library.directory;
    const imported: MediaBlock[] = [];
    setImportError("");
    try {
      for (const [index, file] of files.entries()) {
        setMediaImportStatus({
          noteId,
          directory,
          text: `正在保存媒体 ${index + 1}/${files.length}…`,
        });
        const asset = directory
          ? await researchMediaClient.upload(
              directory,
              file,
              undefined,
              abort.signal,
            )
          : await browserMediaStore.put(file, undefined, abort.signal);
        abort.signal.throwIfAborted();
        if (library.controller.getSnapshot().directory !== directory)
          throw new Error("资料库目录已更改，请在新目录中重新插入媒体。");
        imported.push({
          id: crypto.randomUUID(),
          type: "media",
          kind: mediaKindFromMime(asset.mimeType)!,
          source: { type: "asset", assetId: asset.id },
          alt: file.name,
        });
      }
    } catch (cause) {
      if (!abort.signal.aborted)
        setImportError(
          cause instanceof Error ? cause.message : "媒体保存失败。",
        );
    } finally {
      if (
        !abort.signal.aborted &&
        library.controller.getSnapshot().directory === directory &&
        imported.length
      )
        insertMediaAfter(noteId, blockId, imported, container);
      if (mediaImportOperation.current === abort) {
        setMediaImportStatus(null);
        mediaImportOperation.current = null;
      }
    }
  };

  const deleteBlock = (
    block: ResearchNotebookBlock,
    focusOnCancel?: HTMLElement,
  ) => {
    if (containsReferencedFormula([block])) return;
    const summary =
      block.type === "examples"
        ? `标签页组及其中的 ${block.tabs.length} 个标签和全部内容`
        : block.type === "evidence"
          ? `回放证据“${block.runTitle}”`
          : block.type === "list"
            ? `列表“${block.items.join("、").slice(0, 80) || "空白内容"}”`
            : "text" in block
              ? `内容块“${block.text.trim().slice(0, 80) || "空白内容"}”`
              : "此公式或内容块";
    confirmDelete(
      {
        title: "删除内容块",
        description: `确定删除${summary}吗？`,
        focusOnCancel,
      },
      () =>
        onChange(removeResearchBlock(latestState.current, note.id, block.id)),
    );
  };
  const commitText = (
    blockId: string,
    text: string,
    focusOnCancel?: HTMLElement,
  ) => {
    const current = latestState.current;
    const currentNote = current.notes.find((item) => item.id === note.id);
    const block =
      currentNote && findResearchBlock(currentNote.blocks, blockId)?.block;
    const next = commitResearchTextBlock(current, note.id, blockId, text);
    const nextNote = next.notes.find((item) => item.id === note.id);
    if (block && nextNote && !findResearchBlock(nextNote.blocks, blockId)) {
      deleteBlock(block, focusOnCancel);
      return false;
    }
    onChange(next);
    return true;
  };

  const setContentArea = (blockId: string, area: TheoryContentArea) => {
    if (area !== "derivation")
      setDrawers((current) => ({ ...current, [area]: true }));
    else revealDerivation();
    onChange(setTheoryBlockSection(state, note.id, blockId, area));
  };

  const blockDrag = useResearchBlockDrag({
    pageRef,
    enabled:
      state.open &&
      showingNotes &&
      !emptyLibrary &&
      !readOnly &&
      !state.theoryMaps?.noteViewOpen,
    noteId: note.id,
    blocks: note.blocks,
    onMove: (blockIds, target) => {
      if (target.area === "derivation") revealDerivation();
      onChange(moveResearchBlocks(state, note.id, blockIds, target));
    },
    onRevealArea: (area) =>
      setDrawers((current) =>
        current[area] ? current : { ...current, [area]: true },
      ),
    onRevealExample: ({ exampleBlockId, tabId }) =>
      setExampleTabs((current) =>
        current[exampleBlockId] === tabId
          ? current
          : { ...current, [exampleBlockId]: tabId },
      ),
  });

  const createNote = () => {
    const next = prepareLibraryNote(
      createResearchNote(""),
      currentNoteLibrary(state),
    );
    setReadOnly(false);
    onChange(
      setLibraryFilters({
        ...state,
        activeNoteId: next.id,
        notes: [...state.notes, next],
      }),
    );
  };

  const deleteNote = () => {
    if (state.notes.length <= 1 || noteReferenced) return;
    setPendingDeleteNoteId(note.id);
  };

  const exportNote = () => {
    const url = URL.createObjectURL(
      new Blob([serializeResearchMarkdown(note, state.symbols, state.notes)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${note.title.replace(/[\\/:*?"<>|]/g, "-") || "research-note"}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportNoteWithMedia = async () => {
    try {
      const current = library.controller.getSnapshot();
      const snapshot = latestState.current;
      let archive: Blob | undefined;
      const url = current.directory
        ? await researchMediaClient.export(
            current.directory,
            snapshot,
            "markdown",
            note.id,
          )
        : ((archive = await createBrowserMediaArchive(
            snapshot,
            "markdown",
            note.id,
          )),
          URL.createObjectURL(archive));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${note.title.replace(/[\\/:*?"<>|]/g, "-") || "research-note"}.zip`;
      anchor.click();
      if (archive)
        setTimeout(() => {
          URL.revokeObjectURL(url);
          void releaseBrowserMediaArchive(archive!).catch(() => {});
        }, 60000);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "附件导出失败。");
    }
  };

  const openInNewPage = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", "research-notebook");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  const importNote = async (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const title = file.name.replace(/\.md$/i, "") || "导入研究笔记";
    try {
      const source = await file.text();
      const parsed = parseResearchMarkdown(source, title);
      const imported = {
        ...parsed,
        library: parsed.library ?? currentNoteLibrary(state),
      };
      setImportError("");
      setReadOnly(false);
      onChange(
        openLibraryNote(
          { ...state, notes: [...state.notes, imported] },
          imported.id,
        ),
      );
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "无法导入笔记，请检查文件内容。",
      );
    } finally {
      input.value = "";
    }
  };

  const renderBlock = (
    block: ResearchNotebookBlock,
    container?: ResearchExampleContainer,
  ): ReactNode => (
    <section
      className={
        `research-note-block is-${block.type}` +
        (contentTarget?.noteId === note.id &&
        contentTarget.formulaId === block.id &&
        !contentTarget.headingId
          ? " is-formula-target"
          : "") +
        (blockDrag.activeIds.includes(block.id) ? " is-block-dragging" : "") +
        (blockDrag.selectedIds.includes(block.id) ? " is-block-selected" : "")
      }
      key={block.id}
      data-block-id={block.id}
      data-block-selected={
        blockDrag.selectedIds.includes(block.id) || undefined
      }
      data-formula-id={block.type === "formula" ? block.id : undefined}
      tabIndex={-1}
    >
      {!readOnly && (
        <ResearchBlockInsert
          ref={(handle) => {
            if (handle) blockInsertionMenus.current.set(block.id, handle);
            else blockInsertionMenus.current.delete(block.id);
          }}
          currentType={researchContentType(block)}
          dragHandle={blockDrag.getHandle(block.id)}
          contentArea={block.section ?? "derivation"}
          onAreaChange={
            isFoundation && !container
              ? (area) => setContentArea(block.id, area)
              : undefined
          }
          canInsertEvidence={!!citation}
          canChangeType={canConvertBlock(block)}
          onInsert={(type, position, provider) =>
            addBlock(type, block.id, position, undefined, undefined, provider)
          }
          onChangeType={(type) => changeBlockType(block.id, type)}
        />
      )}
      {block.type === "heading" && (
        <ResearchTextBlock
          label="笔记层级标题"
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          kind="heading"
          headings={headingsByBlock.get(block.id)}
          value={`${"#".repeat(block.level)} ${block.text}`}
          readOnly={readOnly}
          onChange={(text, focusOnCancel) =>
            commitText(block.id, text, focusOnCancel)
          }
        />
      )}
      {block.type === "paragraph" && (
        <ResearchTextBlock
          value={block.text}
          label="笔记段落"
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          headings={headingsByBlock.get(block.id)}
          readOnly={readOnly}
          onChange={(text, focusOnCancel) =>
            commitText(block.id, text, focusOnCancel)
          }
        />
      )}
      {block.type === "callout" && (
        <ResearchCallout
          block={block}
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          readOnly={readOnly}
          onPatch={(patch) => patchBlock(block.id, patch)}
        />
      )}
      {block.type === "media" && (
        <ResearchMediaBlock
          key={`${note.id}:${block.id}:${library.directory ?? "browser"}`}
          block={block}
          readOnly={readOnly}
          onPatch={(patch) => patchBlock(block.id, patch)}
          onInsertAfter={(blocks) =>
            insertMediaAfter(note.id, block.id, blocks)
          }
          onCancelEmpty={() =>
            onChange(
              removeResearchBlock(latestState.current, note.id, block.id),
            )
          }
          onOpenStorage={() => setStorageOpen(true)}
        />
      )}
      {block.type === "bookmark" && (
        <ResearchBookmarkBlock
          key={`${note.id}:${block.id}`}
          block={block}
          readOnly={readOnly}
          onPatch={(patch) => patchBlock(block.id, patch)}
        />
      )}
      {isResearchRichBlock(block) && (
        <ResearchRichBlock
          key={`${note.id}:${block.id}:${library.directory ?? "browser"}`}
          block={block}
          readOnly={readOnly}
          onPatch={(patch) => patchBlock(block.id, patch)}
        />
      )}
      {block.type === "examples" && (
        <ResearchExamples
          block={block}
          readOnly={readOnly}
          onPatch={(patch) => patchBlock(block.id, patch)}
          selectedTabId={exampleTabs[block.id]}
          onSelect={(tabId) =>
            setExampleTabs((current) => ({ ...current, [block.id]: tabId }))
          }
          dropTabId={
            blockDrag.indicator?.target.container?.exampleBlockId === block.id
              ? blockDrag.indicator.target.container.tabId
              : undefined
          }
          canRemoveTab={(tab) => !containsReferencedFormula(tab.blocks)}
          renderBlocks={(blocks, owner) => (
            <div
              className="research-note-blocks"
              key={`${block.id}:${owner.tabId}`}
            >
              {blocks.map((child) => renderBlock(child, owner))}
              {!readOnly && (
                <div className="research-note-insert-tail">
                  <ResearchBlockInsert
                    atEnd
                    canInsertEvidence={!!citation}
                    insertionLabel="在标签页中插入"
                    onInsert={(type, _position, provider) =>
                      addBlock(
                        type,
                        undefined,
                        "above",
                        undefined,
                        owner,
                        provider,
                      )
                    }
                  />
                  {!blocks.length && (
                    <button
                      type="button"
                      className="research-example-start"
                      onClick={() =>
                        addBlock(
                          "paragraph",
                          undefined,
                          "above",
                          undefined,
                          owner,
                        )
                      }
                    >
                      点击编写此标签，或将内容块拖到这里…
                    </button>
                  )}
                </div>
              )}
              {readOnly && !blocks.length && (
                <p className="research-example-empty">此标签尚未填写。</p>
              )}
            </div>
          )}
        />
      )}
      {block.type === "markdown" && (
        <ResearchTextBlock
          value={block.text}
          readOnly={readOnly}
          kind={block.kind}
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          headings={headingsByBlock.get(block.id)}
          label={`笔记${{ quote: "引用", code: "代码块", orderedList: "有序列表", taskList: "待办列表", table: "表格", image: "图片", divider: "分隔线", markdown: "Markdown 内容" }[block.kind]}`}
          onChange={(text, focusOnCancel) =>
            commitText(block.id, text, focusOnCancel)
          }
        />
      )}
      {block.type === "list" && (
        <ResearchTextBlock
          value={block.items.join("\n")}
          label="笔记列表"
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          kind="list"
          readOnly={readOnly}
          onChange={(text, focusOnCancel) =>
            commitText(block.id, text, focusOnCancel)
          }
        />
      )}
      {block.type === "formula" && (
        <ResearchFormulaComposer
          block={block}
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          state={state}
          owner={{
            noteId: note.id,
            formulaId: block.id,
          }}
          readOnly={readOnly}
          onOpenFormula={openFormula}
          onPatch={(patch) =>
            patchBlock(block.id, patch as Record<string, unknown>)
          }
        />
      )}
      {block.type === "evidence" && (
        <EvidenceBlock
          block={block}
          onComplete={() =>
            blockInsertionMenus.current.get(block.id)?.insertBelow()
          }
          readOnly={readOnly}
          onNote={(noteText) => patchBlock(block.id, { note: noteText })}
          onRemove={() => deleteBlock(block)}
        />
      )}
      {block.type === "external" && (
        <ExternalContentCard
          block={block}
          readOnly={readOnly}
          onNote={(noteText) => patchBlock(block.id, { note: noteText })}
        />
      )}
      {block.type === 'noteEmbed' && <ResearchNoteEmbed block={block} ownerNoteId={note.id} state={state} readOnly={readOnly} onPatch={patch => patchBlock(block.id, patch)} />}
      {!readOnly && block.type !== "evidence" && (
        <button
          data-tone="danger"
          data-ui="icon-action"
          className="research-remove-block"
          aria-label="删除笔记内容块"
          disabled={containsReferencedFormula([block])}
          title={
            containsReferencedFormula([block])
              ? "内容中有公式结果仍被引用，请先解除来源关联"
              : "删除此内容块"
          }
          onClick={() => deleteBlock(block)}
        >
          <Trash2 size={13} />
        </button>
      )}
    </section>
  );

  const renderDrawerContent = (area: "given" | "conclusion") => (
    <div
      className="research-note-blocks"
      key={`${note.id}:${readOnly ? "read" : "edit"}:${area}`}
    >
      {areas[area].map((block) => renderBlock(block))}
      {(!readOnly || !areas[area].length) && (
        <div
          className={`research-note-insert-tail${!areas[area].length ? " research-theory-placeholder" : ""}`}
        >
          {!readOnly && (
            <ResearchBlockInsert
              atEnd
              canInsertEvidence={!!citation}
              insertionLabel={`在${theoryAreaLabels[area]}中插入`}
              onInsert={(type, _position, provider) =>
                addBlock(type, undefined, "above", area, undefined, provider)
              }
            />
          )}
          {!areas[area].length && (
            <span className="research-theory-empty">
              尚未设置{theoryAreaLabels[area]}
              。编辑时可通过正文的内容块菜单指定，或在此添加内容。
            </span>
          )}
        </div>
      )}
    </div>
  );

  const toggleReadOnly = () => {
    setPendingDeleteNoteId(null);
    setReadOnly((current) => !current);
  };
  const noteActions = (
    <div className="research-page-tools" role="toolbar" aria-label="笔记功能">
      <div className="research-page-tool-actions research-note-toolbar">
        {!emptyLibrary && (
          <>
            {isFoundation && !state.theoryMaps?.noteViewOpen && (
              <>
                <button
                  type="button"
                  data-ui="icon-action"
                  aria-label="平分并铺满条件与结论"
                  title="平分并铺满条件与结论"
                  onClick={() => {
                    setDrawersExiting(false);
                    fillEqually();
                  }}
                >
                  <Rows2 size={15} />
                </button>
                {middleCollapsed && (
                  <button
                    type="button"
                    data-ui="icon-action"
                    aria-label="显示推导过程"
                    title="显示推导过程"
                    onClick={revealDerivation}
                  >
                    <UnfoldVertical size={15} />
                  </button>
                )}
                <button
                  type="button"
                  data-ui="icon-action"
                  className="research-notebook-sections-toggle"
                  aria-label={drawersActive ? "返回完整正文" : "展开条件与结论"}
                  title={drawersActive ? "返回完整正文" : "展开条件与结论抽屉"}
                  aria-pressed={drawersActive}
                  onClick={toggleDrawers}
                >
                  {drawersActive ? <BookOpen size={15} /> : <Rows3 size={15} />}
                </button>
              </>
            )}
            <button
              type="button"
              data-ui="icon-action"
              className="research-notebook-mode-toggle"
              aria-label={readOnly ? "切换为编辑模式" : "切换为只读模式"}
              title={readOnly ? "切换为编辑模式" : "切换为只读模式"}
              onClick={toggleReadOnly}
            >
              {readOnly ? <Pencil size={15} /> : <Eye size={15} />}
            </button>
            {!readOnly && !state.theoryMaps?.noteViewOpen && (
              <>
                <button
                  type="button"
                  data-ui="icon-action"
                  aria-label="批量选择内容块"
                  title="批量选择内容块；也可 Shift 连选、Ctrl/Cmd 多选"
                  aria-pressed={blockDrag.selecting}
                  onClick={blockDrag.toggleSelection}
                >
                  <ListChecks size={15} />
                </button>
                {(blockDrag.selecting || blockDrag.selectedIds.length > 0) && (
                  <span className="research-block-selection-tools">
                    <span role="status">
                      已选 {blockDrag.selectedIds.length} 项
                    </span>
                    <button
                      type="button"
                      aria-label="取消内容块选择"
                      onClick={blockDrag.clearSelection}
                    >
                      取消
                    </button>
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="research-page-map-tools" ref={setNoteMapTools} />
    </div>
  );

  const pageControls = (
    <div className="research-page-leading-actions">
      <button
        type="button"
        data-ui="icon-action"
        className="research-notebook-sidebar-toggle"
        aria-label={sidebarCollapsed ? "展开笔记左侧面板" : "收起笔记左侧面板"}
        title={sidebarCollapsed ? "展开左侧面板" : "收起左侧面板"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="research-notebook-sidebar research-dictionary-sidebar research-theory-sidebar"
        onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen size={15} />
        ) : (
          <PanelLeftClose size={15} />
        )}
      </button>
    </div>
  );

  const compactActions: ResearchNoteMenuAction[] = compactHeader
    ? [
        {
          label: "切换资料库",
          icon: <BookOpen size={15} />,
          onSelect: workspace.showManager,
        },
        {
          label: "插件管理",
          icon: <Plug size={15} />,
          onSelect: integration.showManager,
        },
        {
          label: "管理笔记标签",
          icon: <Tags size={15} />,
          onSelect: (trigger) =>
            setMenuPanel({ noteId: note.id, panel: "tags", trigger }),
        },
        {
          label: "笔记元数据",
          icon: <Info size={15} />,
          onSelect: (trigger) =>
            setMenuPanel({ noteId: note.id, panel: "metadata", trigger }),
        },
        {
          label: readOnly ? "切换为编辑模式" : "切换为只读模式",
          icon: readOnly ? <Pencil size={15} /> : <Eye size={15} />,
          onSelect: toggleReadOnly,
        },
        ...(!readOnly
          ? [
              {
                label: "批量选择内容块",
                icon: <ListChecks size={15} />,
                onSelect: blockDrag.toggleSelection,
              },
              ...(blockDrag.selecting || blockDrag.selectedIds.length
                ? [
                    {
                      label: "取消内容块选择",
                      icon: <X size={15} />,
                      onSelect: blockDrag.clearSelection,
                    },
                  ]
                : []),
            ]
          : []),
        ...(isFoundation
          ? [
              {
                label: "平分并铺满条件与结论",
                icon: <Rows2 size={15} />,
                onSelect: () => {
                  setDrawersExiting(false);
                  fillEqually();
                },
              },
              ...(middleCollapsed
                ? [
                    {
                      label: "显示推导过程",
                      icon: <UnfoldVertical size={15} />,
                      onSelect: revealDerivation,
                    },
                  ]
                : []),
              {
                label: drawersActive ? "返回完整正文" : "展开条件与结论",
                icon: <Rows3 size={15} />,
                onSelect: toggleDrawers,
              },
            ]
          : []),
        ...(!standalonePage
          ? [
              {
                label: fullPage ? "退出全页面显示" : "全页面显示科研笔记",
                icon: <Maximize2 size={15} />,
                onSelect: () => setFullPage((current) => !current),
              },
              {
                label: "在新页面打开科研笔记",
                icon: <ExternalLink size={15} />,
                onSelect: openInNewPage,
              },
            ]
          : []),
        {
          label: standalonePage ? "使用手册" : "关闭笔记",
          icon: standalonePage ? <BookOpen size={15} /> : <X size={15} />,
          onSelect: () =>
            standalonePage
              ? onOpenHelp?.()
              : onChange({ ...state, open: false }),
        },
      ]
    : [];
  const organizationTrigger = () =>
    noteHeader?.querySelector<HTMLButtonElement>(
      compactHeader
        ? ".research-note-more-toggle"
        : menuPanel?.panel === "tags"
          ? ".research-note-manage-tags"
          : ".research-note-info",
    ) ?? menuPanel!.trigger;
  const windowActions = (
    <div className="research-notebook-actions">
      {!compactHeader && (
        <button
          type="button"
          data-ui="icon-action"
          aria-label="切换资料库"
          title={`切换资料库 · ${workspace.profile.name}`}
          onClick={workspace.showManager}
        >
          <BookOpen size={15} />
        </button>
      )}
      {!compactHeader && (
        <button
          type="button"
          data-ui="icon-action"
          aria-label="插件管理"
          title="插件管理"
          onClick={integration.showManager}
        >
          <Plug size={15} />
        </button>
      )}
      {showingNotes && (
        <ResearchNoteMoreMenu
          key={note.id}
          empty={emptyLibrary}
          readOnly={readOnly}
          mapOpen={state.theoryMaps?.noteViewOpen === true}
          deleteDisabled={state.notes.length <= 1 || noteReferenced}
          deleteTitle={
            noteReferenced
              ? "其他笔记仍引用这里的理论或公式，请先解除来源关联"
              : "删除笔记"
          }
          onToggleMap={() => {
            const map = getResearchTheoryMap(state);
            onChange(patchTheoryMapView(state, { open: !map.open }));
          }}
          onImport={() => importRef.current?.click()}
          onExport={exportNote}
          onExportMedia={() => void exportNoteWithMedia()}
          onDelete={deleteNote}
          extraActions={compactActions}
          onCloseReading={
            primaryPane && !state.theoryMaps?.noteViewOpen && !emptyLibrary
              ? () => closeReading("primary")
              : undefined
          }
        />
      )}
      {!compactHeader && (
        <div className="research-notebook-window-controls">
          {!standalonePage && (
            <>
              <button
                data-ui="icon-action"
                className="research-notebook-action"
                aria-label={fullPage ? "退出全页面显示" : "全页面显示科研笔记"}
                title={fullPage ? "退出全页面显示" : "全页面显示"}
                aria-pressed={fullPage}
                onClick={() => setFullPage((current) => !current)}
              >
                {fullPage ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button
                data-ui="icon-action"
                className="research-notebook-action"
                aria-label="在新页面打开科研笔记"
                title="在新页面打开"
                onClick={openInNewPage}
              >
                <ExternalLink size={15} />
              </button>
            </>
          )}
          <button
            data-ui="icon-action"
            className="research-notebook-close"
            aria-label={standalonePage ? "使用手册" : "关闭笔记"}
            title={standalonePage ? "使用手册" : "关闭"}
            onClick={() =>
              standalonePage
                ? onOpenHelp?.()
                : onChange({ ...state, open: false })
            }
          >
            {standalonePage ? <BookOpen size={15} /> : <X size={15} />}
          </button>
        </div>
      )}
      {outlineAvailable && (
        <div className="research-page-trailing-actions">
          <button
            ref={(element) => {
              // Several views keep their toolbar mounted. Only the current
              // view's toggle should receive focus when the right panel closes.
              if (element && !element.closest('[aria-hidden="true"]'))
                outlineToggleRef.current = element;
            }}
            type="button"
            data-ui="icon-action"
            className="research-outline-toggle"
            aria-label={`${outlineCollapsed ? "展开" : "收起"}${rightPanelLabel}`}
            title={`${outlineCollapsed ? "展开" : "收起"}${rightPanelLabel}`}
            aria-expanded={!outlineCollapsed}
            aria-controls="research-note-outline"
            onClick={() => setOutlineCollapsed((current) => !current)}
          >
            {outlineCollapsed ? (
              <PanelRightOpen size={15} />
            ) : (
              <PanelRightClose size={15} />
            )}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <DeviceInspectorModal
      open={state.open}
      title="MeWiki"
      hideHeader
      className={isFullPage ? "research-notebook-fullpage" : ""}
      onClose={() =>
        standalonePage ? undefined : onChange({ ...state, open: false })
      }
      testId="research-notebook"
    >
      <ResearchVariableRecipeContext.Provider
        value={(request) => {
          const paneId = request.target.closest<HTMLElement>(
            "[data-reading-pane-id]",
          )?.dataset.readingPaneId;
          setRecipeInspection((previous) => ({
            ...request,
            paneId,
            key: (previous?.key ?? 0) + 1,
          }));
          setRecipeActive(true);
          setOutlineCollapsed(false);
        }}
      >
        <div className="research-notebook-shell">
          <IntegrationNotice />
          <input
            ref={importRef}
            hidden
            type="file"
            accept=".md,text/markdown,text/plain"
            aria-label="导入 Markdown 文件"
            onChange={(event) => void importNote(event)}
          />
          {menuPanel?.noteId === note.id && (
            <ResearchNoteOrganizationPanel
              state={state}
              note={note}
              readOnly={readOnly}
              onChange={onChange}
              panel={menuPanel.panel}
              trigger={menuPanel.trigger}
              getTrigger={organizationTrigger}
              onOpenNote={(id) => openContent({ noteId: id })}
              onClose={(restoreFocus) => {
                if (restoreFocus)
                  organizationTrigger().focus({ preventScroll: true });
                setMenuPanel(null);
              }}
            />
          )}
          {library.status === "loading" ? (
            <div className="research-library-loading" role="status">
              正在读取本地资料库…
            </div>
          ) : (
            <>
              <div
                className={`research-notebook-layout${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${outlineVisible ? " has-outline" : ""}`}
              >
                <nav
                  className="research-notebook-mode-tabs"
                  role="tablist"
                  aria-label="科研笔记视图"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={state.view === "dictionary"}
                    onClick={() => onChange({ ...state, view: "dictionary" })}
                  >
                    <span>符号词典</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={state.view === "foundations"}
                    onClick={() =>
                      onChange(selectNoteLibrary(state, "foundation"))
                    }
                  >
                    <span>基础理论</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={state.view === "notes"}
                    onClick={() =>
                      onChange(selectNoteLibrary(state, "research"))
                    }
                  >
                    <span>研究记录</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={state.view === "maps"}
                    onClick={() => onChange({ ...state, view: "maps" })}
                  >
                    <span>理论地图</span>
                  </button>
                </nav>
                <ResearchSidebarResize />
                <ResearchDictionary
                  active={state.view === "dictionary"}
                  state={state}
                  onChange={onChange}
                  windowActions={windowActions}
                  pageControls={pageControls}
                />
                <ResearchTheoryDocuments
                  active={state.view === "maps"}
                  state={state}
                  onChange={onChange}
                  readOnly={readOnly}
                  onToggleReadOnly={() => setReadOnly((value) => !value)}
                  onOpenContent={openContent}
                  windowActions={windowActions}
                  pageControls={pageControls}
                />
                <div
                  className={`research-notebook-view${showingNotes ? " is-active" : ""}`}
                  aria-hidden={!showingNotes}
                >
                  <aside
                    id="research-notebook-sidebar"
                    className="research-notebook-sidebar"
                    aria-label="研究笔记列表"
                  >
                    <ResearchNoteListTools
                      key={`tools:${currentNoteLibrary(state)}`}
                      state={state}
                      onChange={onChange}
                      onCreateNote={createNote}
                    />
                    <ResearchNoteTree
                      key={`tree:${currentNoteLibrary(state)}`}
                      state={state}
                      onChange={applyNavigationChange}
                    />
                    {importError && (
                      <p
                        className="research-notebook-import-error"
                        role="alert"
                      >
                        {importError}
                      </p>
                    )}
                  </aside>

                  {emptyLibrary ? (
                    <section
                      className="research-notebook-editor"
                      aria-label="研究笔记编辑器"
                    >
                      <div className="research-notebook-toolbar">
                        {pageControls}
                        <div className="research-page-tags" />
                        {noteActions}
                        {windowActions}
                      </div>
                      <div className="research-library-empty-page">
                        <BookOpen size={24} />
                        <h2>
                          {currentNoteLibrary(state) === "foundation"
                            ? "基础理论库暂无笔记"
                            : "研究记录库暂无笔记"}
                        </h2>
                        <p>
                          {currentNoteLibrary(state) === "foundation"
                            ? "收录公共理论的标准结论、成立条件和文献出处。"
                            : "记录场景应用、公式推导与实验观察。"}
                        </p>
                        <button type="button" onClick={createNote}>
                          新建笔记
                        </button>
                      </div>
                    </section>
                  ) : (
                    <div
                      ref={readingRail}
                      className={`research-reading-rail${extraPanes.length ? " has-splits" : ""}`}
                      aria-label="笔记分屏阅读"
                    >
                      {primaryPane ? (
                        <ResearchNoteLinkContext.Provider
                          value={{
                            notes: state.notes,
                            symbols: state.symbols,
                            state,
                            sourceNoteId: note.id,
                            openNote: (id, blockId, source) =>
                              openLinkedNote("primary", id, blockId, source),
                          }}
                        >
                          <section
                            className={`research-notebook-editor${readOnly ? " is-readonly" : ""}`}
                            aria-label="研究笔记编辑器"
                            data-reading-pane-id="primary"
                            data-reading-note-id={note.id}
                            data-reading-active={
                              activeReadingPane?.id === "primary"
                            }
                            onPointerDownCapture={() =>
                              activateReadingPane("primary")
                            }
                            onFocusCapture={() =>
                              activateReadingPane("primary")
                            }
                          >
                            <div
                              ref={setNoteHeader}
                              className={`research-notebook-toolbar research-note-header${compactHeader ? " is-compact" : ""}${state.theoryMaps?.noteViewOpen ? " is-map-view" : ""}`}
                              role="toolbar"
                              aria-label="笔记管理"
                            >
                              <div className="research-note-header-leading">
                                {pageControls}
                                {!compactHeader && (
                                  <div className="research-page-tags">
                                    <ResearchNoteOrganizationBar
                                      key={`${note.id}:${readOnly ? "read" : "edit"}`}
                                      note={note}
                                      activePanel={
                                        menuPanel?.noteId === note.id
                                          ? menuPanel.panel
                                          : undefined
                                      }
                                      onOpenPanel={(panel, trigger) =>
                                        setMenuPanel((previous) =>
                                          previous?.noteId === note.id &&
                                          previous.panel === panel
                                            ? null
                                            : {
                                                noteId: note.id,
                                                panel,
                                                trigger,
                                              },
                                        )
                                      }
                                    />
                                    <ResearchNoteTags
                                      state={state}
                                      note={note}
                                      onChange={onChange}
                                    />
                                  </div>
                                )}
                              </div>
                              <ResearchNoteTitle
                                key={note.id}
                                title={note.title}
                                placeholder={
                                  currentNoteLibrary(state) === "foundation"
                                    ? "未命名基础理论"
                                    : "未命名笔记"
                                }
                                readOnly={readOnly}
                                onChange={(title) => setNote({ title })}
                              />
                              <div className="research-note-header-actions">
                                {!compactHeader && noteActions}
                                {windowActions}
                              </div>
                            </div>

                            {state.theoryMaps?.noteViewOpen && showingNotes ? (
                              <ResearchTheoryMap
                                state={state}
                                onChange={onChange}
                                readOnly={readOnly}
                                onOpenContent={openContent}
                                toolbarContainer={noteMapTools}
                              />
                            ) : (
                              <div
                                className="research-note-page"
                                ref={pageRef}
                                data-research-dragging={
                                  blockDrag.activeIds.length > 0
                                }
                                data-research-selecting={blockDrag.selecting}
                                onPasteCapture={(event) => {
                                  const target =
                                    event.target instanceof HTMLElement
                                      ? event.target
                                      : null;
                                  if (
                                    readOnly ||
                                    target?.closest(
                                      ".research-formula-editor, .research-formula-composer, .research-media-block, input, textarea:not(.research-text-source)",
                                    )
                                  )
                                    return;
                                  const files = [
                                    ...event.clipboardData.files,
                                  ].filter((file) => mediaFileKind(file));
                                  if (files.length) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void acceptNoteMedia(files, target);
                                  }
                                }}
                                onDragOver={(event) => {
                                  if (
                                    !readOnly &&
                                    event.dataTransfer.types.includes("Files")
                                  )
                                    event.preventDefault();
                                }}
                                onDrop={(event) => {
                                  if (
                                    !readOnly &&
                                    event.dataTransfer.files.length
                                  ) {
                                    event.preventDefault();
                                    void acceptNoteMedia(
                                      [...event.dataTransfer.files],
                                      event.target instanceof HTMLElement
                                        ? event.target
                                        : null,
                                    );
                                  }
                                }}
                              >
                                {blockDrag.indicator && (
                                  <div
                                    className="research-block-drop-indicator"
                                    aria-hidden="true"
                                    style={{
                                      left: blockDrag.indicator.left,
                                      top: blockDrag.indicator.top,
                                      width: blockDrag.indicator.width,
                                    }}
                                  />
                                )}
                                <span
                                  className="research-block-drag-status"
                                  role="status"
                                  aria-live="polite"
                                >
                                  {blockDrag.announcement}
                                </span>
                                {!readOnly &&
                                  mediaImportStatus?.noteId === note.id &&
                                  mediaImportStatus.directory ===
                                    library.directory && (
                                    <p
                                      role="status"
                                      className="research-media-progress"
                                    >
                                      {mediaImportStatus.text}
                                    </p>
                                  )}
                                {!readOnly &&
                                  blockConversionError?.noteId === note.id && (
                                    <p
                                      role="alert"
                                      className="research-media-error"
                                    >
                                      {blockConversionError.text}
                                    </p>
                                  )}
                                <div
                                  ref={setFrame}
                                  className={`research-note-content-frame${isFoundation ? " has-theory-drawers" : ""}`}
                                  style={frameStyle}
                                  data-drawers-resizing={resizing !== null}
                                  data-drawers-enabled={drawersActive}
                                  data-given-open={
                                    drawersActive && drawers.given
                                  }
                                  data-conclusion-open={
                                    drawersActive && drawers.conclusion
                                  }
                                  data-derivation-hidden={derivationHidden}
                                  onTransitionEnd={(event) => {
                                    if (
                                      event.target === event.currentTarget &&
                                      event.propertyName ===
                                        "grid-template-rows" &&
                                      !drawers.enabled
                                    )
                                      setDrawersExiting(false);
                                  }}
                                >
                                  {isFoundation && (
                                    <ResearchTheoryDrawer
                                      section="given"
                                      active={drawersActive}
                                      open={drawersActive && drawers.given}
                                      resizeHandle={resizeHandle("given")}
                                      dragOver={
                                        blockDrag.indicator?.zone === "given"
                                      }
                                      onToggle={() =>
                                        setDrawers((current) => ({
                                          ...current,
                                          given: !current.given,
                                        }))
                                      }
                                    >
                                      {separateTheoryContent &&
                                        renderDrawerContent("given")}
                                    </ResearchTheoryDrawer>
                                  )}
                                  <div
                                    className="research-note-main"
                                    inert={derivationHidden}
                                    aria-hidden={derivationHidden}
                                  >
                                    <div
                                      className="research-note-scroll"
                                      ref={scrollRef}
                                      data-research-drop-area={
                                        separateTheoryContent
                                          ? "derivation"
                                          : "full"
                                      }
                                      data-research-drop-active={
                                        blockDrag.indicator?.zone ===
                                        (separateTheoryContent
                                          ? "derivation"
                                          : "full")
                                      }
                                    >
                                      <div
                                        className="research-note-blocks"
                                        key={`${note.id}:${readOnly ? "read" : "edit"}`}
                                      >
                                        {separateTheoryContent
                                          ? theoryReadingFlow(note.blocks).map(
                                              (item) => {
                                                if (item.kind === "content")
                                                  return renderBlock(
                                                    item.block,
                                                  );
                                                const first = item.blocks[0];
                                                const label =
                                                  item.section === "given"
                                                    ? "条件"
                                                    : "结论";
                                                const location =
                                                  item.section === "given"
                                                    ? "上方"
                                                    : "下方";
                                                const Direction =
                                                  item.section === "given"
                                                    ? ArrowUp
                                                    : ArrowDown;
                                                return (
                                                  <div
                                                    className="research-theory-source-marker"
                                                    data-theory-source-id={
                                                      first.id
                                                    }
                                                    key={`source:${first.id}`}
                                                  >
                                                    <button
                                                      type="button"
                                                      aria-label={`查看${location}“${label}”面板中的${item.blocks.length}项内容`}
                                                      onClick={() =>
                                                        openContent({
                                                          noteId: note.id,
                                                          blockId: first.id,
                                                        })
                                                      }
                                                    >
                                                      <Direction
                                                        size={14}
                                                        aria-hidden="true"
                                                      />
                                                      <span>
                                                        {first.type ===
                                                          "heading" && (
                                                          <strong>
                                                            {first.text}
                                                          </strong>
                                                        )}
                                                        {item.blocks.length}{" "}
                                                        项内容已在{location}“
                                                        {label}”面板显示
                                                      </span>
                                                    </button>
                                                  </div>
                                                );
                                              },
                                            )
                                          : note.blocks.map((block) =>
                                              renderBlock(block),
                                            )}
                                        {!readOnly && (
                                          <div
                                            key={note.id}
                                            className="research-note-insert-tail"
                                          >
                                            <ResearchBlockInsert
                                              atEnd
                                              canInsertEvidence={!!citation}
                                              onInsert={(
                                                type,
                                                _position,
                                                provider,
                                              ) =>
                                                addBlock(
                                                  type,
                                                  undefined,
                                                  "above",
                                                  separateTheoryContent
                                                    ? "derivation"
                                                    : undefined,
                                                  undefined,
                                                  provider,
                                                )
                                              }
                                            />
                                            {note.blocks.length === 0 && (
                                              <p>
                                                点击左侧 ＋，开始添加研究内容。
                                              </p>
                                            )}
                                          </div>
                                        )}
                                        {readOnly &&
                                          note.blocks.length === 0 && (
                                            <p className="research-empty-note">
                                              这篇笔记暂无内容。
                                            </p>
                                          )}
                                      </div>
                                    </div>
                                  </div>
                                  {isFoundation && (
                                    <ResearchTheoryDrawer
                                      section="conclusion"
                                      active={drawersActive}
                                      open={drawersActive && drawers.conclusion}
                                      resizeHandle={resizeHandle("conclusion")}
                                      dragOver={
                                        blockDrag.indicator?.zone ===
                                        "conclusion"
                                      }
                                      onToggle={() =>
                                        setDrawers((current) => ({
                                          ...current,
                                          conclusion: !current.conclusion,
                                        }))
                                      }
                                    >
                                      {separateTheoryContent &&
                                        renderDrawerContent("conclusion")}
                                    </ResearchTheoryDrawer>
                                  )}
                                </div>
                              </div>
                            )}
                            <footer
                              className="research-note-footer"
                              role="contentinfo"
                              aria-label="笔记信息"
                            >
                              <ResearchNoteReviewStatus
                                state={state}
                                note={note}
                                onChange={onChange}
                              />
                              <span className="research-note-updated">
                                最近编辑：
                                <time dateTime={note.updatedAt}>
                                  {new Date(note.updatedAt).toLocaleString(
                                    "zh-CN",
                                    {
                                      hour12: false,
                                    },
                                  )}
                                </time>
                              </span>
                              <span className="research-note-mode-status">
                                {readOnly ? "只读查看" : "编辑模式"}
                              </span>
                            </footer>
                          </section>
                        </ResearchNoteLinkContext.Provider>
                      ) : (
                        <div className="research-reading-empty">
                          <BookOpen size={26} />
                          <p>当前阅读笔记已关闭。</p>
                          <button
                            type="button"
                            onClick={() =>
                              setReading(createReadingPanes(note.id))
                            }
                          >
                            重新打开当前笔记
                          </button>
                          {pageControls}
                          {windowActions}
                        </div>
                      )}
                      {extraPanes.map((pane) => {
                        const targetNote = state.notes.find(
                          (note) => note.id === pane.noteId,
                        );
                        return (
                          targetNote && (
                            <ResearchReadingPane
                              key={pane.id}
                              pane={pane}
                              note={targetNote}
                              state={state}
                              active={activeReadingPane?.id === pane.id}
                              target={
                                readingTarget?.paneId === pane.id
                                  ? readingTarget.target
                                  : undefined
                              }
                              onActivate={() => activateReadingPane(pane.id)}
                              onClose={() => closeReading(pane.id)}
                              onDetach={() =>
                                setReading((current) =>
                                  detachReadingPane(current, pane.id),
                                )
                              }
                              onOpenNote={(id, blockId, source) =>
                                openLinkedNote(pane.id, id, blockId, source)
                              }
                              onContentRef={(element) => {
                                if (element)
                                  readingContents.current.set(pane.id, element);
                                else readingContents.current.delete(pane.id);
                              }}
                            />
                          )
                        );
                      })}
                      <ResearchReadingConnections
                        railRef={readingRail}
                        panes={synchronizedReading.panes}
                        notes={state.notes}
                      />
                    </div>
                  )}
                </div>
                {outlineVisible && (
                  <>
                    <ResearchSidebarResize side="right" />
                    {symbolBacklinksAvailable && selectedSymbol ? (
                      <ResearchSymbolBacklinks
                        state={state}
                        entry={selectedSymbol}
                        onClose={closeOutline}
                        onOpenFormula={openRightPanelFormula}
                        recipe={recipePanel}
                        recipeActive={recipeActive}
                        onRecipeActiveChange={setRecipeActive}
                      />
                    ) : (
                      <ResearchOutline
                        headings={displayedOutline}
                        contentRef={
                          activeReadingPane?.id === "primary"
                            ? pageRef
                            : secondaryContentRef
                        }
                        onNavigate={navigateOutline}
                        onClose={closeOutline}
                        notes={state.notes}
                        noteId={outlinedNote.id}
                        contentId={activeReadingPane?.id}
                        onOpenNote={(id, blockId) =>
                          openLinkedNote(
                            activeReadingPane?.id ?? "primary",
                            id,
                            blockId,
                          )
                        }
                        recipe={recipePanel}
                        recipeActive={recipeActive}
                        onRecipeActiveChange={setRecipeActive}
                      />
                    )}
                  </>
                )}
                <div
                  className="research-sidebar-footer"
                  role="toolbar"
                  aria-label="页面设置"
                >
                  <button
                    type="button"
                    className="mewiki-library-switcher"
                    aria-label={`当前资料库：${workspace.profile.name}，切换资料库`}
                    title={`当前资料库：${workspace.profile.name}`}
                    onClick={workspace.showManager}
                  >
                    <BookOpen size={15} />
                    <span>{workspace.profile.name}</span>
                  </button>
                  <button
                    type="button"
                    className="research-notebook-settings"
                    aria-label="研究笔记设置"
                    title={
                      library.error || library.cacheError || "研究笔记设置"
                    }
                    data-testid="research-library-save-status"
                    data-save-status={library.status}
                    onClick={() => setStorageOpen(true)}
                  >
                    <Settings2 size={16} />
                    <span>设置</span>
                    {(library.status === "error" ||
                      library.status === "conflict" ||
                      library.cacheError) && (
                      <span className="research-settings-warning" role="status">
                        保存异常
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        {storageOpen && (
          <ResearchLibraryStorage
            library={library}
            onClose={() => setStorageOpen(false)}
          />
        )}
        {noteEmbedInsertion && noteEmbedInsertion.noteId === note.id && !readOnly && <ResearchNoteEmbedPicker state={state} ownerNoteId={note.id} blockId={noteEmbedInsertion.blockId} targetContainer={noteEmbedInsertion.container ?? (noteEmbedInsertion.adjacentBlockId ? findResearchBlock(note.blocks, noteEmbedInsertion.adjacentBlockId)?.container : undefined)} onClose={() => setNoteEmbedInsertion(null)} onSelect={selection => {
          const pending = noteEmbedInsertion;
          setNoteEmbedInsertion(null);
          void addBlock('noteEmbed', pending.adjacentBlockId, pending.position, pending.area, pending.container, undefined, selection);
        }} />}
        {pendingDeleteNote && (
          <div
            className="research-delete-confirm-overlay"
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                setPendingDeleteNoteId(null);
              }
            }}
          >
            <section
              ref={deleteDialogRef}
              className="research-delete-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="research-delete-confirm-title"
              data-testid="research-note-delete-confirmation"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setPendingDeleteNoteId(null);
                } else if (event.key === "Tab") {
                  const buttons =
                    deleteDialogRef.current?.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    );
                  if (!buttons?.length) return;
                  const first = buttons[0];
                  const last = buttons[buttons.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
            >
              <h2 id="research-delete-confirm-title">删除笔记</h2>
              <p className="research-delete-confirm-copy">
                确定删除笔记{" "}
                <strong>《{pendingDeleteNote.title || "未命名笔记"}》</strong>{" "}
                及其中的全部内容吗？
              </p>
              <p className="research-delete-confirm-hint">此操作无法撤销。</p>
              <div className="research-delete-confirm-actions">
                <button
                  ref={cancelDeleteRef}
                  className="research-small-button"
                  autoFocus
                  onClick={() => setPendingDeleteNoteId(null)}
                >
                  取消
                </button>
                <button
                  className="research-small-button research-confirm-delete"
                  onClick={() => {
                    onChange(deleteResearchNote(state, pendingDeleteNote.id));
                    setPendingDeleteNoteId(null);
                  }}
                >
                  确认删除
                </button>
              </div>
            </section>
          </div>
        )}
      </ResearchVariableRecipeContext.Provider>
    </DeviceInspectorModal>
  );
}
