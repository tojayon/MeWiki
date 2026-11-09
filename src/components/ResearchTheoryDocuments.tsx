import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ResearchClassifiedList from './ResearchClassifiedList.tsx';
import { filterResearchChoices, researchNoteChoice } from './researchChoices.ts';
import {
  Check,
  Copy,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  Globe2,
  Network,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import {
  activeTheoryMapDocument,
  addTheoryMapDocument,
  copyTheoryMapDocument,
  deleteTheoryMapDocument,
  ensureTheoryMaps,
  updateTheoryMapDocument,
  type TheoryMapDocument,
  type TheoryReference,
} from "../domain/researchTheoryMap.ts";
import { importTheoryMapFile } from "../state/theoryMapFiles.ts";
import ResearchTheoryMap from "./ResearchTheoryMap.tsx";
import TheoryMapDialog from "./TheoryMapDialog.tsx";
import useTheoryMapFiles from "./useTheoryMapFiles.ts";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";

function DocumentEditor({
  state,
  draft,
  onSave,
  onClose,
}: {
  state: ResearchNotebookState;
  draft: TheoryMapDocument | null;
  onSave: (title: string, ids: string[]) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(draft?.title ?? "");
  const confirmDelete = useDeleteConfirmation();
  const removeMember = (id: string, name: string) => confirmDelete({ title: "移除地图笔记", description: `确定从此地图移除“${name}”吗？原笔记及其正文会保留。` }, () => setMembers(current => current.filter(value => value !== id)));
  const [members, setMembers] = useState(draft?.noteIds ?? []);
  const [query, setQuery] = useState("");
  return (
    <TheoryMapDialog title={draft ? "地图设置" : "新建地图"} onClose={onClose}>
      <form
        className="theory-document-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onSave(title.trim(), members);
        }}
      >
        <label>
          地图名称
          <input
            required
            aria-label="地图名称"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：项目知识结构"
          />
        </label>
        {draft?.kind === "global" ? (
          <p>
            系统地图自动包含全部笔记和正文推导关系，无需维护成员。节点布局与本图说明单独保存。
          </p>
        ) : (
          <>
            <label>
              引用笔记
              <input
                aria-label="筛选地图笔记"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索笔记"
              />
            </label>
            <div className="theory-document-members">
              <ResearchClassifiedList choices={filterResearchChoices(state.notes.map(note => researchNoteChoice(note)), query)} selectedIds={members} activeTags={state.notes.filter(note => members.includes(note.id)).flatMap(note => note.tags ?? [])} query={query}
                label="引用地图笔记" storageKey="mewiki:map-member-folds" onSelect={choice => members.includes(choice.id) ? removeMember(choice.id, choice.label) : setMembers([...members, choice.id])} />
              {members
                .filter((id) => !state.notes.some((note) => note.id === id))
                .map((id) => (
                  <label className="theory-error" key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => removeMember(id, id)}
                    />
                    <span>来源笔记已移除 · {id}</span>
                  </label>
                ))}
            </div>
            <p>
              地图引用原笔记与公式，正文修改会同步显示。讲解连线和节点角色仅属于当前地图。
            </p>
          </>
        )}
        <div className="theory-document-form-actions">
          <button
            type="submit"
            data-ui="icon-action"
            disabled={!title.trim()}
            aria-label="保存地图文档"
            title="保存地图"
          >
            <Check size={18} />
          </button>
        </div>
      </form>
    </TheoryMapDialog>
  );
}

export default function ResearchTheoryDocuments({
  active,
  state,
  onChange,
  readOnly,
  onToggleReadOnly,
  onOpenContent,
  windowActions,
  pageControls,
}: {
  active: boolean;
  state: ResearchNotebookState;
  onChange: (state: ResearchNotebookState) => void;
  readOnly: boolean;
  onToggleReadOnly: () => void;
  onOpenContent: (ref: TheoryReference) => void;
  windowActions: ReactNode;
  pageControls: ReactNode;
}) {
  const files = useTheoryMapFiles(state, onChange);
  const [mapTools, setMapTools] = useState<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<TheoryMapDocument | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TheoryMapDocument | null>(
    null,
  );
  const importRef = useRef<HTMLInputElement>(null);
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);
  if (!active) return null;
  const workspace = ensureTheoryMaps(state).theoryMaps!;
  const doc = activeTheoryMapDocument(state);
  return (
    <div className="research-theory-documents research-notebook-view is-active">
      <aside
        id="research-theory-sidebar"
        className="research-notebook-sidebar theory-document-sidebar"
        aria-label="理论地图文档列表"
      >
        <div className="theory-document-files">
          <input
            ref={importRef}
            type="file"
            hidden
            accept=".theorymap.json,.json,application/json"
            aria-label="导入地图文件"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                const content = await file.text();
                onChange(importTheoryMapFile(latest.current, content));
                files.setError("");
              } catch (reason) {
                files.setError(
                  reason instanceof Error ? reason.message : "导入失败。",
                );
              }
            }}
          />
          <span className="theory-file-status">{files.status}</span>
          {files.directoryName && (
            <small title={files.directoryName}>{files.directoryName}</small>
          )}
          {!files.available && (
            <small>目录保存需使用 Edge / Chrome；可直接导入、导出。</small>
          )}
          {files.error && (
            <p className="theory-error" role="alert">
              {files.error}
              <button
                type="button"
                className="theory-text-action"
                onClick={files.retry}
              >
                重试写入
              </button>
            </p>
          )}
        </div>
        <div className="theory-document-list-tools">
          <label className="research-dictionary-search">
            <Search size={14} />
            <input
              aria-label="搜索地图"
              placeholder="搜索地图"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <nav aria-label="地图文件">
          {workspace.documents
            .filter(
              (item) => item.kind === "global" || item.title.includes(query),
            )
            .map((item) => (
              <button
                type="button"
                key={item.id}
                className="theory-document-list-item"
                aria-label={"打开地图 " + item.title}
                aria-current={item.id === doc.id ? "page" : undefined}
                onClick={() => {
                  setEditor(null);
                  onChange({
                    ...state,
                    theoryMaps: { ...workspace, activeMapId: item.id },
                  });
                }}
              >
                {item.kind === "global" ? (
                  <Globe2 size={16} />
                ) : (
                  <Network size={16} />
                )}
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind === "global"
                      ? "系统地图 · 自动汇总"
                      : `${item.noteIds.length} 篇笔记 · .theorymap.json`}
                  </small>
                </span>
              </button>
            ))}
        </nav>
      </aside>
      <section className="research-notebook-editor" aria-label="理论地图文档">
        <div
          className="research-notebook-toolbar theory-document-toolbar"
          role="toolbar"
          aria-label="地图文档管理"
        >
          {pageControls}
          <div className="research-page-tags" />
          <div className="research-page-tools" role="toolbar" aria-label="理论地图功能">
            <div className="research-page-tool-actions">
              {!readOnly && (
                <button
                  type="button"
                  data-ui="icon-action"
                  aria-label="新建地图"
                  title="新建地图"
                  onClick={() => setEditor("new")}
                >
                  <FilePlus2 size={16} />
                </button>
              )}
              {!readOnly && (
                <>
                  <button
                    type="button"
                    data-ui="icon-action"
                    aria-label="配置当前地图"
                    title="名称与引用笔记"
                    onClick={() => setEditor(doc)}
                  >
                    <Settings2 size={15} />
                  </button>
                  <button
                    type="button"
                    data-ui="icon-action"
                    aria-label="复制当前地图"
                    title="复制地图"
                    onClick={() => onChange(copyTheoryMapDocument(state, doc.id))}
                  >
                    <Copy size={15} />
                  </button>
                  {doc.kind !== "global" && (
                    <button
                      type="button"
                      data-ui="icon-action"
                      data-tone="danger"
                      aria-label="删除当前地图"
                      title="删除地图"
                      onClick={() => setPendingDelete(doc)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                data-ui="icon-action"
                aria-label="导出地图文件"
                title="导出 .theorymap.json"
                onClick={() => files.exportDocument(doc)}
              >
                <Download size={15} />
              </button>
              <button
                type="button"
                data-ui="icon-action"
                aria-label={readOnly ? "切换为编辑模式" : "切换为只读模式"}
                title={readOnly ? "切换为编辑模式" : "切换为只读模式"}
                onClick={() => {
                  setEditor(null);
                  setPendingDelete(null);
                  onToggleReadOnly();
                }}
              >
                {readOnly ? <Pencil size={15} /> : <Eye size={15} />}
              </button>
              <div className="theory-document-file-tools">
                <button
                  type="button"
                  data-ui="icon-action"
                  aria-label="导入地图"
                  title="导入 .theorymap.json"
                  onClick={() => importRef.current?.click()}
                >
                  <Upload size={16} />
                </button>
                <button
                  type="button"
                  data-ui="icon-action"
                  aria-label="选择地图保存目录"
                  title={
                    files.directoryName
                      ? "重新授权或连接保存目录"
                      : "选择本地保存目录"
                  }
                  onClick={() => void files.connect()}
                >
                  <FolderOpen size={16} />
                </button>
                {files.directoryName && (
                  <>
                    <button
                      type="button"
                      data-ui="icon-action"
                      aria-label="更换地图保存目录"
                      title="更换保存目录"
                      onClick={() => void files.connect(true)}
                    >
                      <Settings2 size={15} />
                    </button>
                    <button
                      type="button"
                      data-ui="icon-action"
                      aria-label="读取目录中的地图"
                      title="读取目录中新增或更改的地图"
                      onClick={() => void files.importDirectory()}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="research-page-map-tools" ref={setMapTools} />
          </div>
          {windowActions}
        </div>
        <ResearchTheoryMap
          state={state}
          onChange={onChange}
          readOnly={readOnly}
          onOpenContent={onOpenContent}
          toolbarContainer={mapTools}
        />
      </section>
      {editor && !readOnly && (
        <DocumentEditor
          key={editor === "new" ? "new" : editor.id}
          state={state}
          draft={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSave={(title, ids) => {
            onChange(
              editor === "new"
                ? addTheoryMapDocument(state, title, ids)
                : updateTheoryMapDocument(state, {
                    ...editor,
                    title,
                    noteIds: editor.kind === "global" ? [] : ids,
                  }),
            );
            setEditor(null);
          }}
        />
      )}
      {pendingDelete && !readOnly && (
        <TheoryMapDialog
          title="删除地图"
          alert
          onClose={() => setPendingDelete(null)}
        >
          <p className="theory-document-delete-copy">
            确定删除《{pendingDelete.title}
            》？笔记正文及其他地图会保留。已连接的保存目录会同步移除该文件，另行导出的副本保留。
          </p>
          <div className="theory-document-confirm-actions">
            <button type="button" onClick={() => setPendingDelete(null)}>
              取消
            </button>
            <button
              type="button"
              data-tone="danger"
              onClick={() => {
                onChange(deleteTheoryMapDocument(state, pendingDelete.id));
                setPendingDelete(null);
              }}
            >
              确认删除
            </button>
          </div>
        </TheoryMapDialog>
      )}
    </div>
  );
}
