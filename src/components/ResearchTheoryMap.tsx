import ExternalContentCard from '../integrations/ExternalContentCard.tsx';
import ResearchSelectionField from './ResearchSelectionField.tsx';
import { researchNoteChoice } from './researchChoices.ts';
import { noteEmbedBlockLabel } from '../domain/researchNoteEmbed.ts';
import ResearchRichBlock from "./ResearchRichBlock.tsx";
import { isResearchRichBlock } from "../domain/researchRichContent.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  FoldVertical,
  GitBranch,
  Save,
  LayoutGrid,
  Link2,
  ListTree,
  Pencil,
  Scan,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Formula } from "./Formula.tsx";
import ResearchMathText from "./ResearchMathText.tsx";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import ResearchExamples from "./ResearchExamples.tsx";
import {
  FormulaReadSurface,
  FormulaSymbolPopover,
} from "./ResearchFormulaRelations.tsx";
import {
  renderedFormulaTex,
  type ResearchNotebookState,
} from "../domain/researchNotebook.ts";
import { getNoteReviewStatus } from "../domain/researchNoteOrganization.ts";
import { flattenResearchBlocks } from "../domain/researchBlockTree.ts";
import {
  buildResearchTheoryGraph,
  getResearchTheoryMap,
  patchTheoryMapView,
  saveNoteViewAsMap,
  removeTheoryRelation,
  researchTheoryCatalogue,
  resolveTheoryReference,
  saveTheoryRelation,
  theoryLayoutKey,
  theoryReferenceKey,
  theoryRelationError,
  theoryRelationKinds,
  theoryRoles,
  type ResearchTheoryMapState,
  type TheoryGraphEdge,
  type TheoryGraphNode,
  type TheoryReference,
  type TheoryRelation,
} from "../domain/researchTheoryMap.ts";
import TheoryMapDialog from "./TheoryMapDialog.tsx";
import "@xyflow/react/dist/style.css";
import "./ResearchTheoryMap.css";

type FlowNode = Node<
  {
    content: TheoryGraphNode;
    tex?: string;
    onSelect: () => void;
    onExpand: () => void;
  },
  "theory"
>;
type FlowEdge = Edge<
  {
    content: TheoryGraphEdge;
    index: number;
    count: number;
    dimmed: boolean;
    onSelect: () => void;
  },
  "theory"
>;
const colors = {
  derivation: "#1d4ed8",
  assumption: "#b9530b",
  adaptation: "#bc2342",
};
const relationLabel = (kind: TheoryRelation["kind"]) =>
  theoryRelationKinds.find((item) => item.value === kind)!.label;

function TheoryNode({ data, selected }: NodeProps<FlowNode>) {
  const { content: node } = data;
  const formulaRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState({ width: 284, truncated: false });
  useLayoutEffect(() => {
    const formula = formulaRef.current?.querySelector<HTMLElement>(".formula");
    if (!formula) return;
    const measure = () => {
      const width =
        [284, 352, 420, 640].find(
          (width) => formula.offsetWidth + 28 <= width,
        ) ?? 640;
      const truncated =
        formula.offsetWidth > width - 26 || formula.offsetHeight > 82;
      setPreview((previous) =>
        previous.width === width && previous.truncated === truncated
          ? previous
          : { width, truncated },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(formula);
    return () => observer.disconnect();
  }, [data.tex]);
  const noteNode = !node.ref.blockId;
  const count =
    flattenResearchBlocks(node.note?.blocks ?? []).filter((block) => block.type === "formula").length;
  return (
    <div
      className={`theory-node role-${node.role}${selected ? " is-selected" : ""}${node.missing ? " is-missing" : ""}`}
      style={{ width: data.tex ? preview.width : 284 }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div
        role="button"
        tabIndex={0}
        className="theory-node-main"
        aria-label={"查看节点 " + node.title}
        onClick={data.onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            data.onSelect();
          }
        }}
      >
        <div className="theory-node-kicker">
          <span>
            {theoryRoles.find((role) => role.value === node.role)!.label}
          </span>
          <span
            className="research-note-status-dot"
            data-status={node.note && getNoteReviewStatus(node.note)}
            title="笔记核对状态"
          />
        </div>
        <strong>{node.title}</strong>
        {data.tex ? (
          <>
            <div
              className={`theory-node-formula${preview.truncated ? " is-truncated" : ""}`}
              ref={formulaRef}
            >
              <Formula tex={data.tex} block />
            </div>
            {preview.truncated && (
              <span className="theory-node-formula-hint">
                点击查看完整公式 <ArrowUpRight size={11} aria-hidden="true" />
              </span>
            )}
          </>
        ) : node.block?.type === "callout" ? (
          <p>{node.block.text.replace(/^[-*]\s*/gm, "").slice(0, 105)}</p>
        ) : noteNode ? (
          <p>
            {count} 个公式 ·{" "}
            {flattenResearchBlocks(node.note?.blocks ?? []).filter((block) => block.type === "callout")
              .length}{" "}
            处条件
          </p>
        ) : (
          <p>点击查看内容与关联</p>
        )}
        <small>{node.ref.blockId ? node.noteTitle : "笔记"}</small>
      </div>
      {noteNode && !node.missing && (
        <button
          type="button"
          data-ui="icon-action"
          className="theory-expand-note nodrag"
          aria-label={"展开笔记 " + node.title}
          title="展开关键公式与条件"
          onClick={data.onExpand}
        >
          <ChevronRight size={15} />
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function TheoryEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  style,
}: EdgeProps<FlowEdge>) {
  if (!data) return null;
  const bend = (data.index - (data.count - 1) / 2) * 44;
  const span = Math.max(75, Math.abs(targetX - sourceX) * 0.42);
  const path = `M ${sourceX},${sourceY} C ${sourceX + span},${sourceY + bend} ${targetX - span},${targetY + bend} ${targetX},${targetY}`;
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2 + bend * 0.75;
  const opacity = data.dimmed ? 0.2 : 1;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, opacity }}
        interactionWidth={22}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`theory-edge-label nodrag nopan${data.content.error ? " is-error" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            color: colors[data.content.kind],
            opacity,
          }}
          aria-label={"查看关系 " + relationLabel(data.content.kind)}
          title={data.content.description || relationLabel(data.content.kind)}
          onClick={data.onSelect}
        >
          {relationLabel(data.content.kind)}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const nodeTypes = { theory: TheoryNode };
const edgeTypes = { theory: TheoryEdge };

type TheoryNodeSize = { width: number; height: number };
function arrange(
  graph: ReturnType<typeof buildResearchTheoryGraph>,
  sizes: Record<string, TheoryNodeSize>,
) {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({
    rankdir: "LR",
    nodesep: 38,
    ranksep: 95,
    marginx: 45,
    marginy: 40,
  });
  for (const node of graph.nodes)
    layout.setNode(
      node.id,
      sizes[node.id] ?? {
        width: 284,
        height: node.block?.type === "formula" ? 162 : 142,
      },
    );
  for (const edge of graph.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);
  return Object.fromEntries(
    graph.nodes.map((node) => {
      const point = layout.node(node.id);
      return [
        node.id,
        {
          x: point.x - point.width / 2,
          y: point.y - point.height / 2,
        },
      ];
    }),
  );
}

function TheoryRelationEditor({
  state,
  draft,
  onSave,
  onClose,
}: {
  state: ResearchNotebookState;
  draft: TheoryRelation;
  onSave: (relation: TheoryRelation) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(draft);
  const [error, setError] = useState("");
  const fullCatalogue = researchTheoryCatalogue(state);
  const members = getResearchTheoryMap(state).topics.find(
    (topic) => topic.id === getResearchTheoryMap(state).topicId,
  )?.noteIds;
  const catalogue =
    state.view === "maps" && getResearchTheoryMap(state).scope === "topic"
      ? fullCatalogue.filter((node) => members?.includes(node.ref.noteId))
      : fullCatalogue;
  const select = (key: "source" | "target", label: string) => (
    <label>
      {label}
      <ResearchSelectionField
        label={label} value={theoryReferenceKey(value[key])} emptyLabel="来源内容已移除，请重新选择"
        choices={catalogue.flatMap(node => {
          const note = state.notes.find(note => note.id === node.ref.noteId);
          return note ? [researchNoteChoice(note, { id: node.id, label: `${note.title} · ${node.ref.blockId ? node.title : '整篇笔记'}` })] : [];
        })}
        onChange={(id) => {
          const ref = catalogue.find(
            (node) => node.id === id,
          )?.ref;
          if (ref) {
            setValue({ ...value, [key]: ref });
            setError("");
          }
        }}
      />
    </label>
  );
  return (
    <form
      className="theory-editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        const error = theoryRelationError(state, value);
        setError(error ?? "");
        if (!error) onSave(value);
      }}
    >
      <header>
        <strong>
          {getResearchTheoryMap(state).relations.some(
            (relation) => relation.id === draft.id,
          )
            ? "编辑理论关系"
            : "新增理论关系"}
        </strong>
        <button
          type="button"
          data-ui="icon-action"
          aria-label="取消关系编辑"
          title="取消"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      {select("source", "关系起点")}
      {select("target", "关系终点")}
      <label>
        关系类型
        <select
          aria-label="关系类型"
          value={value.kind}
          onChange={(event) =>
            setValue({
              ...value,
              kind: event.target.value as TheoryRelation["kind"],
            })
          }
        >
          {theoryRelationKinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        关系说明
        <textarea
          aria-label="关系说明"
          value={value.description}
          rows={5}
          placeholder="说明引用了什么结果、引入了哪些条件或改变了什么实现方式。"
          onChange={(event) =>
            setValue({ ...value, description: event.target.value })
          }
        />
      </label>
      <p>起点提供理论或条件，终点是使用它的模型。关系不会自动改写公式。</p>
      {error && (
        <p className="theory-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-ui="icon-action"
        aria-label="保存理论关系"
        title="保存理论关系"
      >
        <Check size={17} />
      </button>
    </form>
  );
}

function TheoryNodeDetail({
  node,
  state,
  readOnly,
  onRole,
  onOpenContent,
  onToggleNote,
  onSelectNode,
  onClose,
}: {
  node: TheoryGraphNode;
  state: ResearchNotebookState;
  readOnly: boolean;
  onRole: (role: TheoryGraphNode["role"]) => void;
  onOpenContent: (ref: TheoryReference) => void;
  onToggleNote: (id: string) => void;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}) {
  const [inspect, setInspect] = useState<{
    index: number;
    target: HTMLElement;
  } | null>(null);
  const block = node.block;
  const inspectedPart =
    inspect && block?.type === "formula"
      ? block.parts?.[inspect.index]
      : undefined;
  const map = getResearchTheoryMap(state);
  // Use fully expanded scope so detail includes the exact endpoints even when neighboring notes are collapsed.
  const expanded = buildResearchTheoryGraph(state, {
    scope: "global",
    expandedNoteIds: state.notes.map((note) => note.id),
    showAllBlocks: true,
  });
  const relations = expanded.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  return (
    <>
      <header className="theory-detail-header">
        <strong>{node.title}</strong>
        <button
          data-ui="icon-action"
          aria-label="关闭地图详情"
          title="关闭详情"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <div className="theory-detail-body">
        <div className="theory-detail-origin">
          <span>{node.noteTitle}</span>
          <button
            data-ui="icon-action"
            disabled={node.missing}
            aria-label="定位到笔记正文"
            title="定位到笔记正文"
            onClick={() => onOpenContent(node.ref)}
          >
            <ArrowUpRight size={16} />
          </button>
        </div>
        {node.missing ? (
          <p className="theory-error">
            来源内容已移除。关系仍然保留，可在关系详情中重新选择起点或终点。
          </p>
        ) : block?.type === "formula" ? (
          <div className="theory-detail-formula">
            {block.parts ? (
              <FormulaReadSurface
                parts={block.parts}
                symbols={state.symbols}
                layout={block.layout}
                onInspect={(index, target) => setInspect({ index, target })}
              />
            ) : (
              <Formula tex={block.tex} block />
            )}
            {block.conditions && (
              <div className="theory-detail-conditions">
                <strong>公式适用条件</strong>
                <ResearchMathText text={block.conditions} />
              </div>
            )}
          </div>
        ) : block?.type === "examples" ? (
          <ResearchExamples block={block} readOnly symbols={state.symbols} />
        ) : block?.type === "callout" || block?.type === "markdown" ? (
          <ResearchMarkdown text={block.text} />
        ) : block?.type === "list" ? (
          <ul>
            {block.items.map((item, index) => (
              <li key={index}>
                <ResearchMathText text={item} />
              </li>
            ))}
          </ul>
        ) : block?.type === "evidence" ? (
          <p>
            {block.runTitle} · t = {block.time} s
          </p>
        ) : block?.type === "media" ? (
          <ResearchMathText text={[block.caption, block.alt, block.source?.type === "url" ? block.source.url : ""].filter(Boolean).join(" ") || "图片"} />
        ) : block?.type === "bookmark" ? (
          <ResearchMarkdown text={[block.title, block.description, block.url].filter(Boolean).join("\n\n")} />
        ) : block && isResearchRichBlock(block) ? (
          <ResearchRichBlock block={block} readOnly onPatch={() => {}} />
        ) : block?.type === 'noteEmbed' ? <ResearchMathText text={noteEmbedBlockLabel(block)} /> : block?.type === 'external' ? <ExternalContentCard block={block} /> : block ? (
          <ResearchMathText text={block.text} />
        ) : (
          <>
            <ResearchMathText
              text={
                flattenResearchBlocks(node.note?.blocks ?? []).find((block) => block.type === "paragraph")
                  ?.text ?? "展开这篇笔记，查看其中的公式与条件。"
              }
            />
            <button
              type="button"
              className="theory-text-action"
              onClick={() => onToggleNote(node.ref.noteId)}
            >
              <ChevronDown size={14} />
              {map.expandedNoteIds.includes(node.ref.noteId)
                ? "收起笔记内容"
                : "展开公式与条件"}
            </button>
          </>
        )}
        {!readOnly && !node.missing && (
          <label className="theory-role-select">
            节点角色
            <select
              aria-label="节点角色"
              value={node.role}
              onChange={(event) =>
                onRole(event.target.value as TheoryGraphNode["role"])
              }
            >
              {theoryRoles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {node.note && node.ref.blockId && (
          <button
            type="button"
            className="theory-text-action"
            onClick={() => onToggleNote(node.ref.noteId)}
          >
            <ListTree size={14} />
            {map.expandedNoteIds.includes(node.ref.noteId)
              ? "收起所属笔记"
              : "展开所属笔记"}
          </button>
        )}
        <h3>关联路径</h3>
        {relations.length === 0 && (
          <p className="theory-hint">
            尚未关联其他内容。编辑模式下可新增理论关系。
          </p>
        )}
        {relations.map((edge) => {
          const upstream = edge.target === node.id;
          const other = expanded.nodes.find(
            (value) => value.id === (upstream ? edge.source : edge.target),
          );
          return (
            <div className="theory-relation-summary" key={edge.id}>
              <span
                className="theory-relation-kind"
                style={{ color: colors[edge.kind] }}
              >
                {upstream ? "依据" : "用于"} · {relationLabel(edge.kind)}
                {edge.origin === "formula" ? " · 公式引用" : ""}
              </span>
              {other && (
                <button
                  className="theory-text-action"
                  onClick={() => onSelectNode(other.id)}
                >
                  {other.title}
                  <ArrowUpRight size={12} />
                </button>
              )}
              {edge.description && (
                <p>
                  <ResearchMathText text={edge.description} />
                </p>
              )}
              {edge.error && <p className="theory-error">{edge.error}</p>}
            </div>
          );
        })}
      </div>
      {inspect &&
        block?.type === "formula" &&
        inspectedPart?.type === "symbol" && (
          <FormulaSymbolPopover
            key={`${node.id}:${inspect.index}`}
            state={state}
            owner={{ noteId: node.ref.noteId, formulaId: block.id }}
            part={inspectedPart}
            target={inspect.target}
            onCancel={() => setInspect(null)}
            onOpenFormula={(address) =>
              onOpenContent({
                noteId: address.noteId,
                blockId: address.formulaId,
              })
            }
          />
        )}
    </>
  );
}

function TheoryMapCanvas({
  state,
  onChange,
  readOnly,
  onOpenContent,
  toolbarContainer,
}: {
  state: ResearchNotebookState;
  onChange: (state: ResearchNotebookState) => void;
  readOnly: boolean;
  onOpenContent: (ref: TheoryReference) => void;
  toolbarContainer?: HTMLElement | null;
}) {
  const stateRef = useRef(state);
  const confirmDelete = useDeleteConfirmation();
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const publish = useCallback(
    (next: ResearchNotebookState) => {
      stateRef.current = next;
      onChange(next);
    },
    [onChange],
  );
  const patch = useCallback(
    (value: Partial<ResearchTheoryMapState>) => {
      const latest = stateRef.current;
      publish(patchTheoryMapView(latest, value));
    },
    [publish],
  );
  const map = useMemo(() => getResearchTheoryMap(state), [state]);
  const graph = useMemo(() => buildResearchTheoryGraph(state), [state]);
  const key = theoryLayoutKey(map, state.activeNoteId);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<string | null>(null);
  const [nodes, setNodes, applyNodesChange] = useNodesState<FlowNode>([]);
  const [nodeSizes, setNodeSizes] = useState<Record<string, TheoryNodeSize>>(
    {},
  );
  const nodesInitialized = useNodesInitialized();
  const positions = useMemo(
    () => arrange(graph, nodeSizes),
    [graph, nodeSizes],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      applyNodesChange(changes);
      if (!changes.some((change) => change.type === "dimensions")) return;
      setNodeSizes((previous) => {
        let next = previous;
        for (const change of changes) {
          if (change.type !== "dimensions" || !change.dimensions) continue;
          const { width, height } = change.dimensions;
          if (
            previous[change.id]?.width === width &&
            previous[change.id]?.height === height
          )
            continue;
          if (next === previous) next = { ...previous };
          next[change.id] = { width, height };
        }
        return next;
      });
    },
    [applyNodesChange],
  );
  const [editor, setEditor] = useState<TheoryRelation | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showLegend, setShowLegend] = useState(false);
  const [saveAsTitle, setSaveAsTitle] = useState<string | null>(null);
  const selectNode = useCallback(
    (id: string) => {
      focusTarget.current = null;
      setEditor(null);
      setEdgeId(null);
      patch({ selectedNodeId: id });
    },
    [patch],
  );
  const toggleNote = useCallback(
    (id: string) => {
      const latest = getResearchTheoryMap(stateRef.current);
      patch({
        expandedNoteIds: latest.expandedNoteIds.includes(id)
          ? latest.expandedNoteIds.filter((value) => value !== id)
          : [...latest.expandedNoteIds, id],
      });
    },
    [patch],
  );
  const selectExactNode = (id: string) => {
    const [noteId] = JSON.parse(id) as [string];
    const nextMap = {
      expandedNoteIds: [...new Set([...map.expandedNoteIds, noteId])],
      selectedNodeId: id,
    };
    if (!graph.nodes.some((node) => node.ref.noteId === noteId)) {
      onOpenContent({ noteId });
      return;
    }
    focusTarget.current = id;
    patch(nextMap);
    setEdgeId(null);
    setEditor(null);
  };
  useEffect(() => {
    setNodes((previous) => {
      const measured = new Map(previous.map((node) => [node.id, node]));
      return graph.nodes.map((content) => ({
        ...measured.get(content.id),
        id: content.id,
        type: "theory",
        position:
          map.layouts[key]?.positions[content.id] ?? positions[content.id],
        selected: map.selectedNodeId === content.id,
        data: {
          content,
          tex:
            content.block?.type === "formula"
              ? renderedFormulaTex(content.block, state.symbols).tex
              : undefined,
          onSelect: () => selectNode(content.id),
          onExpand: () => toggleNote(content.ref.noteId),
        },
        ariaLabel: content.title,
      }));
    });
  }, [
    graph,
    positions,
    map.layouts,
    key,
    map.selectedNodeId,
    state.symbols,
    selectNode,
    toggleNote,
    setNodes,
  ]);
  const selected = graph.nodes.find((node) => node.id === map.selectedNodeId);
  const edges: FlowEdge[] = graph.edges.map((content) => {
    const parallel = graph.edges.filter(
      (edge) =>
        edge.source === content.source && edge.target === content.target,
    );
    return {
      id: content.id,
      source: content.source,
      target: content.target,
      type: "theory",
      data: {
        content,
        index: parallel.findIndex((edge) => edge.id === content.id),
        count: parallel.length,
        dimmed:
          !selected ||
          (content.source !== selected.id && content.target !== selected.id),
        onSelect: () => {
          setEdgeId(content.id);
          setEditor(null);
          patch({ selectedNodeId: undefined });
        },
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: content.error ? "#b91c1c" : colors[content.kind],
        width: 16,
        height: 16,
      },
      style: {
        stroke: content.error ? "#b91c1c" : colors[content.kind],
        strokeWidth: 1.8,
        ...(content.kind === "assumption" ? { strokeDasharray: "6 4" } : {}),
      },
    };
  });
  const selectedEdge = graph.edges.find((edge) => edge.id === edgeId);
  const detailsOpen = !!editor || !!selected || !!selectedEdge;
  const saveLayout = (
    change: Partial<NonNullable<ResearchTheoryMapState["layouts"][string]>>,
  ) => {
    const latest = getResearchTheoryMap(stateRef.current);
    patch({
      layouts: {
        ...latest.layouts,
        [key]: {
          ...latest.layouts[key],
          positions: latest.layouts[key]?.positions ?? {},
          ...change,
        },
      },
    });
  };
  const previousGraph = useRef("");
  useEffect(() => {
    // Detail panels resize the canvas, but must not reset the reader's view.
    const workspace = workspaceRef.current;
    if (!workspace) return;
    let width = workspace.clientWidth;
    let height = workspace.clientHeight;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const nextWidth = workspace.clientWidth;
      const nextHeight = workspace.clientHeight;
      if (
        width > 0 &&
        height > 0 &&
        (Math.abs(nextWidth - width) > 4 || Math.abs(nextHeight - height) > 4)
      ) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          void flow.fitView({ padding: 0.16, minZoom: 0.1, maxZoom: 1 });
        });
      }
      width = nextWidth;
      height = nextHeight;
    });
    observer.observe(workspace);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [flow]);
  const graphSignature = JSON.stringify([
    key,
    graph.nodes.map((node) => node.id),
  ]);
  useEffect(() => {
    if (graph.nodes.length > 0 && !nodesInitialized) return;
    if (previousGraph.current === graphSignature) return;
    const initial = previousGraph.current === "";
    const frame = requestAnimationFrame(() => {
      previousGraph.current = graphSignature;
      const saved = map.layouts[key]?.viewport;
      if (initial && saved) void flow.setViewport(saved);
      else void flow.fitView({ padding: 0.16, minZoom: 0.15, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    graphSignature,
    graph.nodes.length,
    flow,
    key,
    map.layouts,
    nodesInitialized,
    positions,
  ]);
  useEffect(() => {
    // Recenter only for an explicit jump through a relationship endpoint.
    if (!selected || focusTarget.current !== selected.id) return;
    const point =
      map.layouts[key]?.positions[selected.id] ?? positions[selected.id];
    const size = nodeSizes[selected.id] ?? { width: 284, height: 162 };
    const frame = requestAnimationFrame(() => {
      focusTarget.current = null;
      if (window.matchMedia("(max-width: 600px)").matches) return;
      const canvas = canvasRef.current?.getBoundingClientRect();
      const zoom = Math.max(0.8, Math.min(1.4, flow.getZoom()));
      if (canvas)
        void flow.setViewport({
          x: canvas.width / 2 - (point.x + size.width / 2) * zoom,
          y: canvas.height / 2 - (point.y + size.height / 2) * zoom,
          zoom,
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, map.layouts, key, positions, nodeSizes, flow]);
  const addRelation = () => {
    const source = selected?.ref ?? { noteId: state.activeNoteId };
    const target =
      researchTheoryCatalogue(state).find(
        (node) => node.id !== theoryReferenceKey(source),
      )?.ref ?? source;
    setEdgeId(null);
    setEditor({
      id: crypto.randomUUID(),
      source,
      target,
      kind: selected?.role === "assumption" ? "assumption" : "derivation",
      description: "",
    });
    setMessage("");
  };
  const toolbar = (
      <div
        className="theory-map-toolbar"
        role="toolbar"
        aria-label="理论地图工具"
      >
        {state.view !== "maps" && (
          <>
            <span className="theory-local-title">
              <GitBranch size={15} />
              本篇推导图
            </span>
            <select
              aria-label="局部关系层数"
              value={map.depth}
              onChange={(event) => patch({ depth: Number(event.target.value) })}
            >
              <option value="1">仅本篇及引用来源</option>
              <option value="2">展开下游 · 2 层</option>
              <option value="3">展开下游 · 3 层</option>
            </select>
          </>
        )}
        <label className="theory-all-blocks">
          <input
            type="checkbox"
            aria-label="展示全部公式与条件"
            checked={map.showAllBlocks}
            onChange={(event) => patch({ showAllBlocks: event.target.checked })}
          />
          全部公式
        </label>
        <div className="theory-map-actions">
          <button
            type="button"
            data-ui="icon-action"
            aria-label="收起所有笔记"
            title="收起所有笔记"
            onClick={() =>
              patch({ expandedNoteIds: [], selectedNodeId: undefined })
            }
          >
            <FoldVertical size={15} />
          </button>
          <button
            type="button"
            data-ui="icon-action"
            aria-label="自动整理理论地图"
            title="自动整理布局"
            onClick={() => {
              saveLayout({ positions: {} });
              requestAnimationFrame(() => {
                void flow.fitView({ padding: 0.16, minZoom: 0.15, maxZoom: 1 });
              });
            }}
          >
            <LayoutGrid size={15} />
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                data-ui="icon-action"
                aria-label="新增理论关系"
                title="新增理论关系"
                onClick={addRelation}
              >
                <Link2 size={15} />
              </button>
            </>
          )}
          {state.view !== "maps" && (
            <button
              type="button"
              data-ui="icon-action"
              aria-label="另存为地图"
              title="另存为独立地图文档"
              onClick={() =>
                setSaveAsTitle(
                  (state.notes.find((note) => note.id === state.activeNoteId)
                    ?.title ?? "本篇") + "推导图",
                )
              }
            >
              <Save size={15} />
            </button>
          )}
          <button
            type="button"
            data-ui="icon-action"
            aria-label="理论地图图例"
            title="角色与关系图例"
            aria-expanded={showLegend}
            onClick={() => setShowLegend(!showLegend)}
          >
            <ListTree size={15} />
          </button>
        </div>
      </div>
  );
  return (
    <div
      className={`research-theory-map${detailsOpen ? " has-detail" : ""}`}
      data-testid="research-theory-map"
    >
      {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
      <div className="theory-map-workspace" ref={workspaceRef}>
        <div className="theory-map-canvas" ref={canvasRef}>
          <ReactFlow<FlowNode, FlowEdge>
            key={key}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgeClick={(_event, edge) => {
              setEdgeId(edge.id);
              setEditor(null);
              patch({ selectedNodeId: undefined });
            }}
            onNodeDragStop={(_event, node) =>
              saveLayout({
                positions: {
                  ...getResearchTheoryMap(stateRef.current).layouts[key]
                    ?.positions,
                  [node.id]: node.position,
                },
              })
            }
            onMoveEnd={(_event, viewport) => saveLayout({ viewport })}
            defaultViewport={map.layouts[key]?.viewport}
            minZoom={0.1}
            maxZoom={3}
            nodesConnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            onPaneClick={() => {
              if (!editor) {
                setEdgeId(null);
                patch({ selectedNodeId: undefined });
              }
            }}
            proOptions={{ hideAttribution: true }}
            aria-label="理论关系画布"
          />
          {graph.nodes.length === 0 && (
            <p className="theory-map-empty">
              {map.scope === "topic"
                ? "此主题暂无笔记，可在编辑模式下添加成员。"
                : "暂无可显示的模型。"}
            </p>
          )}
          <div className="theory-map-zoom" role="group" aria-label="地图缩放">
            <button
              data-ui="icon-action"
              aria-label="缩小理论地图"
              title="缩小"
              onClick={() => void flow.zoomOut()}
            >
              <ZoomOut size={16} />
            </button>
            <button
              data-ui="icon-action"
              aria-label="适应理论地图画布"
              title="适应画布"
              onClick={() =>
                void flow.fitView({ padding: 0.16, minZoom: 0.1, maxZoom: 1 })
              }
            >
              <Scan size={16} />
            </button>
            <button
              data-ui="icon-action"
              aria-label="放大理论地图"
              title="放大"
              onClick={() => void flow.zoomIn()}
            >
              <ZoomIn size={16} />
            </button>
          </div>
          {showLegend && (
            <div className="theory-map-legend">
              <strong>内容角色</strong>
              <div>
                {theoryRoles.map((role) => (
                  <span key={role.value} className={`role-${role.value}`}>
                    {role.label}
                  </span>
                ))}
              </div>
              <strong>关联含义</strong>
              {theoryRelationKinds.map((kind) => (
                <p key={kind.value}>
                  <i
                    style={{
                      borderColor: colors[kind.value],
                      borderStyle:
                        kind.value === "assumption" ? "dashed" : "solid",
                    }}
                  />
                  {kind.label}
                </p>
              ))}
              <small>公式引用自动生成；条件与适配由用户关联。</small>
            </div>
          )}
        </div>
        {detailsOpen && (
          <aside className="theory-map-detail" aria-label="理论地图详情">
            {editor ? (
              <TheoryRelationEditor
                key={editor.id}
                state={state}
                draft={editor}
                onClose={() => setEditor(null)}
                onSave={(relation) => {
                  publish(saveTheoryRelation(stateRef.current, relation));
                  setEditor(null);
                  setMessage("关系已保存");
                }}
              />
            ) : selectedEdge ? (
              <>
                <header className="theory-detail-header">
                  <strong>{relationLabel(selectedEdge.kind)}</strong>
                  <button
                    data-ui="icon-action"
                    aria-label="关闭地图详情"
                    title="关闭"
                    onClick={() => setEdgeId(null)}
                  >
                    <X size={15} />
                  </button>
                </header>
                <div className="theory-detail-body">
                  <p className="theory-hint">
                    {selectedEdge.origin === "formula"
                      ? "从正文公式的推导来源自动生成；请在原公式中修改引用。"
                      : selectedEdge.origin === "note"
                        ? "来自笔记的模型依据；请在本篇推导图中修改。"
                        : "仅属于当前地图的讲解连线"}
                  </p>
                  {selectedEdge.origin === "formula" && (
                    <>
                      <ResearchMathText text={selectedEdge.description} />
                      <button
                        className="theory-text-action"
                        onClick={() =>
                          onOpenContent(
                            graph.nodes.find(
                              (node) => node.id === selectedEdge.target,
                            )!.ref,
                          )
                        }
                      >
                        打开引用方笔记
                        <ArrowUpRight size={13} />
                      </button>
                    </>
                  )}
                  {selectedEdge.relations.map((relation) => (
                    <div className="theory-relation-summary" key={relation.id}>
                      <button
                        className="theory-text-action"
                        onClick={() =>
                          selectExactNode(theoryReferenceKey(relation.source))
                        }
                      >
                        {resolveTheoryReference(state, relation.source).title}
                        <ArrowUpRight size={12} />
                      </button>
                      <span className="theory-hint">
                        ↓ {relationLabel(relation.kind)}
                      </span>
                      <button
                        className="theory-text-action"
                        onClick={() =>
                          selectExactNode(theoryReferenceKey(relation.target))
                        }
                      >
                        {resolveTheoryReference(state, relation.target).title}
                        <ArrowUpRight size={12} />
                      </button>
                      <p>
                        <ResearchMathText
                          text={relation.description || "尚未填写关系说明。"}
                        />
                      </p>
                      {!readOnly &&
                        (state.view !== "maps" ||
                          selectedEdge.origin === "manual") && (
                          <div className="theory-form-actions">
                            <button
                              data-ui="icon-action"
                              aria-label="编辑理论关系"
                              title="编辑关系"
                              onClick={() => setEditor(relation)}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              data-ui="icon-action"
                              data-tone="danger"
                              aria-label="删除理论关系"
                              title="移除关系，保留正文"
                              onClick={() => confirmDelete({ title: "删除理论关系", description: `确定删除“${resolveTheoryReference(state, relation.source).title}”与“${resolveTheoryReference(state, relation.target).title}”之间的理论关系吗？正文会保留。` }, () => {
                                publish(
                                  removeTheoryRelation(
                                    stateRef.current,
                                    relation.id,
                                  ),
                                );
                                setEdgeId(null);
                                setMessage("关系已移除，正文已保留");
                              })}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                    </div>
                  ))}
                  {selectedEdge.error && (
                    <p className="theory-error">{selectedEdge.error}</p>
                  )}
                </div>
              </>
            ) : (
              selected && (
                <TheoryNodeDetail
                  key={selected.id}
                  node={selected}
                  state={state}
                  readOnly={readOnly}
                  onClose={() => patch({ selectedNodeId: undefined })}
                  onToggleNote={toggleNote}
                  onSelectNode={selectExactNode}
                  onOpenContent={onOpenContent}
                  onRole={(role) =>
                    patch({
                      annotations: [
                        ...map.annotations.filter(
                          (item) =>
                            theoryReferenceKey(item.ref) !== selected.id,
                        ),
                        { ref: selected.ref, role },
                      ],
                    })
                  }
                />
              )
            )}
          </aside>
        )}
      </div>
      {saveAsTitle !== null && (
        <TheoryMapDialog
          title="另存为地图"
          onClose={() => setSaveAsTitle(null)}
        >
          <form
            className="theory-document-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (saveAsTitle.trim())
                publish(saveNoteViewAsMap(stateRef.current, saveAsTitle));
            }}
          >
            <label>
              新地图名称
              <input
                aria-label="新地图名称"
                required
                value={saveAsTitle}
                onChange={(event) => setSaveAsTitle(event.target.value)}
              />
            </label>
            <p>保留引用与当前布局，创建独立的地图文档。</p>
            <div className="theory-document-form-actions">
              <button
                type="submit"
                data-ui="icon-action"
                aria-label="创建地图文档"
                title="创建地图文档"
              >
                <Check size={18} />
              </button>
            </div>
          </form>
        </TheoryMapDialog>
      )}
      <div className="theory-map-status">
        <span>
          {graph.nodes.length} 个节点 · {graph.edges.length} 条关联
        </span>
        <span role="status">{message}</span>
      </div>
    </div>
  );
}

export default function ResearchTheoryMap(
  props: Parameters<typeof TheoryMapCanvas>[0],
) {
  const key = theoryLayoutKey(
    getResearchTheoryMap(props.state),
    props.state.activeNoteId,
  );
  return (
    <ReactFlowProvider key={`${key}:${props.readOnly}`}>
      <TheoryMapCanvas {...props} />
    </ReactFlowProvider>
  );
}
