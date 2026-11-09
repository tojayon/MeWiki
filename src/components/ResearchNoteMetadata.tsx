import { useEffect, useRef, useState } from "react";
import ResearchSelectionField from './ResearchSelectionField.tsx';
import { researchNoteChoice } from './researchChoices.ts';
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import type {
  ResearchNote,
  ResearchNotebookState,
} from "../domain/researchNotebook.ts";
import {
  applyResearchNoteMetadata,
  getResearchNoteMetadata,
  noteFieldsFromMetadata,
  noteMetadataKeys,
  parseMetadataYaml,
  serializeMetadataYaml,
  type MetadataValue,
  type ResearchFrontmatter,
} from "../domain/researchFrontmatter.ts";
import {
  getNoteReviewStatus,
  noteReviewStates,
  type NoteReviewStatus,
} from "../domain/researchNoteOrganization.ts";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import {
  getNoteLibrary,
  noteBasisIds,
  noteLibraries,
  researchNoteTypes,
  type ResearchNoteLibrary,
  type ResearchNoteType,
} from "../domain/researchNoteLibraries.ts";
import ResearchNoteReferences from "./ResearchNoteReferences.tsx";
import "./ResearchNoteMetadata.css";
import { researchTitleInputValue } from "../domain/researchTextPlaceholders.ts";

type PropertyKind = "text" | "number" | "boolean" | "yaml";
interface CustomProperty {
  id: string;
  key: string;
  kind: PropertyKind;
  source: string;
}
interface MetadataDraft {
  library: ResearchNoteLibrary;
  researchType: ResearchNoteType | "";
  basisNoteIds: string[];
  title: string;
  tags: string;
  createdAt: string;
  reviewedAt: string;
  reviewStatus: NoteReviewStatus;
  custom: CustomProperty[];
}

const labels: Record<string, string> = {
  title: "标题",
  tags: "标签",
  createdAt: "创建时间",
  updatedAt: "最近编辑",
  reviewStatus: "核对状态",
  reviewedAt: "核对时间",
  library: "笔记库",
  researchType: "研究内容类型",
  basisNoteIds: "理论依据",
};

function draftFromNote(note: ResearchNote): MetadataDraft {
  return {
    library: getNoteLibrary(note),
    researchType: note.researchType ?? "",
    basisNoteIds: [...(note.basisNoteIds ?? [])],
    title: researchTitleInputValue(note.title),
    tags: (note.tags ?? []).join("\n"),
    createdAt: note.createdAt,
    reviewedAt: note.reviewedAt ?? "",
    reviewStatus: getNoteReviewStatus(note),
    custom: Object.entries(note.frontmatter ?? {}).map(
      ([key, value], index) => ({
        id: `saved-${index}`,
        key,
        kind:
          typeof value === "string"
            ? "text"
            : typeof value === "number"
              ? "number"
              : typeof value === "boolean"
                ? "boolean"
                : "yaml",
        source:
          typeof value === "string"
            ? value
            : value === null || typeof value === "object"
              ? serializeMetadataYaml({ value })
                  .replace(/^value:[ \t]*\n?/, "")
                  .replace(/^ {2}/gm, "")
                  .trimEnd()
              : String(value),
      }),
    ),
  };
}

function metadataFromDraft(
  draft: MetadataDraft,
  note: ResearchNote,
): ResearchFrontmatter {
  const properties: ResearchFrontmatter = {
    title: draft.title,
    tags: draft.tags.split("\n").filter((tag) => tag.trim()),
    createdAt: draft.createdAt,
    updatedAt: note.updatedAt,
    reviewStatus: draft.reviewStatus,
    library: draft.library,
    researchType: draft.researchType,
    basisNoteIds: [...draft.basisNoteIds],
    ...(draft.reviewedAt ? { reviewedAt: draft.reviewedAt } : {}),
  };
  const names = new Set<string>(noteMetadataKeys);
  for (const property of draft.custom) {
    const name = property.key.trim();
    if (!name) throw new Error("请填写自定义属性名称，或移除空属性。");
    if (names.has(name))
      throw new Error(`属性“${name}”已存在，请使用其他名称。`);
    if (
      [
        "id",
        "blocks",
        "frontmatter",
        "__proto__",
        "prototype",
        "constructor",
      ].includes(name)
    )
      throw new Error(`“${name}”是笔记内部字段，请使用其他属性名。`);
    names.add(name);
    if (property.kind === "text") properties[name] = property.source;
    else if (property.kind === "boolean")
      properties[name] = property.source === "true";
    else if (property.kind === "number") {
      const number = Number(property.source);
      if (!property.source.trim() || !Number.isFinite(number))
        throw new Error(`属性“${name}”需要填写有效数值。`);
      properties[name] = number;
    } else
      properties[name] = parseMetadataYaml(
        "value:\n" +
          property.source
            .split("\n")
            .map((line) => "  " + line)
            .join("\n"),
      ).value;
  }
  noteFieldsFromMetadata(properties, note);
  return properties;
}

function PropertyValue({
  name,
  value,
}: {
  name: string;
  value: MetadataValue;
}) {
  if (name === "library")
    return <span>{value === "foundation" ? "基础理论" : "研究记录"}</span>;
  if (name === "researchType")
    return (
      <span>
        {value === "derivation"
          ? "本文推导"
          : value === "application"
            ? "场景应用"
            : "一般记录"}
      </span>
    );
  if (name === "reviewStatus")
    return (
      <span>
        {noteReviewStates.find((status) => status.value === value)?.label ??
          String(value)}
      </span>
    );
  if (name === "tags" && Array.isArray(value))
    return (
      <div className="research-metadata-tag-values">
        {value.length
          ? value.map((tag, index) => <span key={index}>{String(tag)}</span>)
          : "—"}
      </div>
    );
  if (typeof value === "object" && value !== null)
    return (
      <pre>
        {serializeMetadataYaml({ value })
          .replace(/^value:[ \t]*\n?/, "")
          .replace(/^ {2}/gm, "")
          .trimEnd()}
      </pre>
    );
  return <span>{value === null || value === "" ? "—" : String(value)}</span>;
}

export default function ResearchNoteMetadata({
  state,
  note,
  readOnly,
  onChange,
  trigger,
  getTrigger,
  onClose,
  onOpenNote,
}: {
  state: ResearchNotebookState;
  note: ResearchNote;
  readOnly: boolean;
  onChange: (state: ResearchNotebookState) => void;
  trigger: HTMLButtonElement;
  getTrigger?: () => HTMLButtonElement;
  onClose: (restoreFocus?: boolean) => void;
  onOpenNote: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  const serial = useRef(0);
  const confirmDelete = useDeleteConfirmation();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"properties" | "yaml">("properties");
  const [draft, setDraft] = useState(() => draftFromNote(note));
  const [yaml, setYaml] = useState("");
  const [error, setError] = useState("");
  useFormulaPopover({
    ref,
    triggerRef,
    getAnchor: () => {
      triggerRef.current = getTrigger?.() ?? trigger;
      return triggerRef.current.getBoundingClientRect();
    },
    onCancel: onClose,
  });
  useEffect(() => {
    if (editing)
      ref.current
        ?.querySelector<HTMLElement>("input, textarea")
        ?.focus({ preventScroll: true });
    else
      ref.current
        ?.querySelector<HTMLElement>("header button")
        ?.focus({ preventScroll: true });
  }, [editing, mode]);
  const patchDraft = (patch: Partial<MetadataDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError("");
  };
  const patchProperty = (id: string, patch: Partial<CustomProperty>) =>
    patchDraft({
      custom: draft.custom.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    });
  const report = (error: unknown) =>
    setError(
      error instanceof Error
        ? error.message
        : "无法保存元数据，请检查填写内容。",
    );
  const switchMode = (next: typeof mode) => {
    if (next === mode) return;
    try {
      if (next === "yaml")
        setYaml(serializeMetadataYaml(metadataFromDraft(draft, note)));
      else {
        const fields = noteFieldsFromMetadata(parseMetadataYaml(yaml), note);
        setDraft(draftFromNote({ ...note, ...fields }));
      }
      setError("");
      setMode(next);
    } catch (error) {
      report(error);
    }
  };
  const save = () => {
    try {
      const properties =
        mode === "yaml"
          ? parseMetadataYaml(yaml)
          : metadataFromDraft(draft, note);
      onChange(applyResearchNoteMetadata(state, note.id, properties));
      setEditing(false);
      setError("");
    } catch (error) {
      report(error);
    }
  };
  const startEditing = () => {
    setDraft(draftFromNote(note));
    setMode("properties");
    setError("");
    setEditing(true);
  };

  return (
    <div
      ref={ref}
      popover="manual"
      className={`research-metadata-popover${editing ? " is-editing" : ""}`}
      role="dialog"
      aria-label="笔记元数据"
    >
      <header>
        <div>
          <strong>笔记元数据</strong>
          <small>Frontmatter</small>
        </div>
        <div>
          {!readOnly && !editing && (
            <button
              type="button"
              data-ui="icon-action"
              aria-label="编辑元数据"
              title="编辑元数据"
              onClick={startEditing}
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            type="button"
            data-ui="icon-action"
            aria-label="关闭笔记元数据"
            title="关闭"
            onClick={() => onClose(true)}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {!editing ? (
        <>
          <div className="research-metadata-properties">
            <table aria-label="笔记属性">
              <tbody>
                {Object.entries(getResearchNoteMetadata(note)).filter(([key]) => key !== "basisNoteIds").map(
                  ([key, value]) => (
                    <tr key={key}>
                      <th scope="row">
                        {labels[key] ? (
                          <>
                            <span>{labels[key]}</span>
                            <small>{key}</small>
                          </>
                        ) : (
                          <span>{key}</span>
                        )}
                      </th>
                      <td>
                        <PropertyValue name={key} value={value} />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <ResearchNoteReferences state={state} note={note} onOpenNote={onOpenNote} />
          </div>
          <footer className="research-metadata-identity">
            <span>笔记标识</span>
            <code>{note.id}</code>
          </footer>
        </>
      ) : (
        <>
          <nav
            className="research-metadata-mode"
            role="tablist"
            aria-label="元数据编辑方式"
          >
            <button
              role="tab"
              aria-selected={mode === "properties"}
              onClick={() => switchMode("properties")}
            >
              属性
            </button>
            <button
              role="tab"
              aria-selected={mode === "yaml"}
              onClick={() => switchMode("yaml")}
            >
              YAML
            </button>
          </nav>
          <div className="research-metadata-edit-body">
            {mode === "yaml" ? (
              <label className="research-metadata-yaml-label">
                <span className="research-metadata-hint">
                  编辑 YAML 属性；保存时同步标题、标签与核对状态。
                </span>
                <textarea
                  aria-label="Frontmatter YAML"
                  className="research-metadata-yaml"
                  value={yaml}
                  spellCheck={false}
                  onChange={(event) => {
                    setYaml(event.target.value);
                    setError("");
                  }}
                />
              </label>
            ) : (
              <>
                <label className="research-metadata-field">
                  <span>
                    标题<small>title</small>
                  </span>
                  <input
                    aria-label="元数据标题"
                    placeholder="未命名笔记"
                    value={draft.title}
                    onChange={(event) =>
                      patchDraft({ title: event.target.value })
                    }
                  />
                </label>
                <div className="research-metadata-standard-grid">
                  <label className="research-metadata-field">
                    <span>
                      笔记库<small>library</small>
                    </span>
                    <select
                      aria-label="元数据笔记库"
                      value={draft.library}
                      onChange={(event) =>
                        patchDraft({
                          library: event.target.value as ResearchNoteLibrary,
                        })
                      }
                    >
                      {noteLibraries.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="research-metadata-field">
                    <span>
                      研究内容类型<small>researchType</small>
                    </span>
                    <select
                      aria-label="元数据研究内容类型"
                      value={draft.researchType}
                      onChange={(event) =>
                        patchDraft({
                          researchType: event.target.value as
                            ResearchNoteType | "",
                        })
                      }
                    >
                      {researchNoteTypes.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="research-metadata-field">
                  <span>理论依据<small>basisNoteIds</small></span>
                  <div className="research-metadata-basis-list">
                    {draft.basisNoteIds.map(id => {
                      const source = state.notes.find(item => item.id === id);
                      return <span className="research-metadata-basis-item" key={id}>
                        <span>{source?.title || "来源笔记已移除"}</span>
                        <button type="button" data-ui="icon-action" aria-label={`移除理论依据 ${source?.title || id}`}
                          title="移除理论依据" onClick={() => confirmDelete({ title: "移除理论依据", description: `确定移除与“${source?.title || id}”的手动关联吗？依据笔记的原文会保留。` }, () => setDraft(current => ({ ...current, basisNoteIds: current.basisNoteIds.filter(value => value !== id) })))}>
                          <X size={12} />
                        </button>
                      </span>;
                    })}
                    {!draft.basisNoteIds.length && <span className="research-metadata-hint">尚未手动关联理论依据。</span>}
                  </div>
                  <ResearchSelectionField label="添加理论依据" value="" emptyLabel="＋ 添加基础理论"
                    choices={state.notes.filter(item => getNoteLibrary(item) === 'foundation' && item.id !== note.id && !draft.basisNoteIds.includes(item.id)).map(item => researchNoteChoice(item))}
                    onChange={id => patchDraft({ basisNoteIds: [...draft.basisNoteIds, id] })} />
                  {noteBasisIds({ ...note, basisNoteIds: [] }).length > 0 && <p className="research-metadata-hint">
                    公式来源自动关联：{noteBasisIds({ ...note, basisNoteIds: [] }).map(id => state.notes.find(item => item.id === id)?.title || "来源笔记已移除").join("、")}。修改公式引用后同步更新。
                  </p>}
                </div>
                <div className="research-metadata-standard-grid">
                  <label className="research-metadata-field">
                    <span>
                      标签<small>tags · 每行一个</small>
                    </span>
                    <textarea
                      aria-label="元数据标签"
                      rows={3}
                      value={draft.tags}
                      onChange={(event) =>
                        patchDraft({ tags: event.target.value })
                      }
                    />
                  </label>
                  <label className="research-metadata-field">
                    <span>
                      核对状态<small>reviewStatus</small>
                    </span>
                    <select
                      aria-label="元数据核对状态"
                      value={draft.reviewStatus}
                      onChange={(event) =>
                        patchDraft({
                          reviewStatus: event.target.value as NoteReviewStatus,
                        })
                      }
                    >
                      {noteReviewStates.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="research-metadata-standard-grid">
                  <label className="research-metadata-field">
                    <span>
                      创建时间<small>createdAt</small>
                    </span>
                    <input
                      aria-label="元数据创建时间"
                      value={draft.createdAt}
                      onChange={(event) =>
                        patchDraft({ createdAt: event.target.value })
                      }
                    />
                  </label>
                  <label className="research-metadata-field">
                    <span>
                      核对时间<small>reviewedAt · 可留空</small>
                    </span>
                    <input
                      aria-label="元数据核对时间"
                      placeholder="标记已核对时自动记录"
                      value={draft.reviewedAt}
                      onChange={(event) =>
                        patchDraft({ reviewedAt: event.target.value })
                      }
                    />
                  </label>
                </div>
                <section className="research-metadata-custom">
                  <header>
                    <strong>自定义属性</strong>
                    <button
                      type="button"
                      data-ui="icon-action"
                      aria-label="添加元数据属性"
                      title="添加属性"
                      onClick={() =>
                        patchDraft({
                          custom: [
                            ...draft.custom,
                            {
                              id: `new-${serial.current++}`,
                              key: "",
                              kind: "text",
                              source: "",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </header>
                  {draft.custom.map((property) => (
                    <div
                      key={property.id}
                      className="research-metadata-custom-row"
                    >
                      <div className="research-metadata-property-tools">
                        <input
                          aria-label="属性名称"
                          placeholder="属性名称"
                          value={property.key}
                          onChange={(event) =>
                            patchProperty(property.id, {
                              key: event.target.value,
                            })
                          }
                        />
                        <select
                          aria-label="属性类型"
                          value={property.kind}
                          onChange={(event) => {
                            const kind = event.target.value as PropertyKind;
                            patchProperty(property.id, {
                              kind,
                              source:
                                kind === "number"
                                  ? "0"
                                  : kind === "boolean"
                                    ? "false"
                                    : kind === "yaml"
                                      ? "[]"
                                      : property.source,
                            });
                          }}
                        >
                          <option value="text">文本</option>
                          <option value="number">数值</option>
                          <option value="boolean">布尔</option>
                          <option value="yaml">结构 · YAML</option>
                        </select>
                        <button
                          type="button"
                          data-ui="icon-action"
                          data-tone="danger"
                          aria-label={`移除属性 ${property.key || "未命名"}`}
                          title="移除属性"
                          onClick={() =>
                            confirmDelete({ title: "移除笔记属性", description: `确定移除属性“${property.key || "未命名"}”及其值吗？` }, () => setDraft(current => ({ ...current,
                              custom: current.custom.filter(
                                (row) => row.id !== property.id,
                              ),
                            })))
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {property.kind === "boolean" ? (
                        <select
                          aria-label={`属性 ${property.key} 的值`}
                          value={property.source}
                          onChange={(event) =>
                            patchProperty(property.id, {
                              source: event.target.value,
                            })
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : property.kind === "number" ? (
                        <input
                          aria-label={`属性 ${property.key} 的值`}
                          inputMode="decimal"
                          value={property.source}
                          onChange={(event) =>
                            patchProperty(property.id, {
                              source: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <textarea
                          className={property.kind === "yaml" ? "is-yaml" : ""}
                          aria-label={`属性 ${property.key} 的值`}
                          rows={property.kind === "yaml" ? 3 : 2}
                          spellCheck={property.kind !== "yaml"}
                          value={property.source}
                          onChange={(event) =>
                            patchProperty(property.id, {
                              source: event.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                  {!draft.custom.length && (
                    <p className="research-metadata-hint">
                      可添加作者、摘要、别名或研究参数等属性。
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
          {error && (
            <p className="research-metadata-error" role="alert">
              {error}
            </p>
          )}
          <footer className="research-metadata-edit-footer">
            <small>最近编辑时间在保存后自动更新。</small>
            <div>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
              >
                取消
              </button>
              <button type="button" aria-label="保存元数据" onClick={save}>
                <Check size={14} />
                保存
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
