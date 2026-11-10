import { useLocale } from "../i18n/react.ts";
import {t, localizeError, getLocale as interfaceLocale } from "../i18n/locale.ts";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FolderOpen,
  History,
  RefreshCw,
  Upload,
} from "lucide-react";
import DeviceInspectorModal from "./DeviceInspectorModal.tsx";
import {
  parseResearchLibraryFile,
  RESEARCH_LIBRARY_FILENAME,
  researchLibrarySummary,
  type ResearchLibrarySummary,
} from "../state/researchLibraryFile.ts";
import type {
  LibraryHistoryEntry,
  LibraryInspection,
} from "../state/researchLibraryClient.ts";
import type { useResearchLibrary } from "../state/useResearchNotebook.ts";
import { librarySaveLabel } from "./researchLibraryStatus.ts";
import "./ResearchLibraryStorage.css";
import { researchMediaClient } from "../state/researchMediaClient.ts";
import {
  createBrowserMediaArchive,
  releaseBrowserMediaArchive,
} from "../state/researchMediaArchive.ts";
import { useLibraryWorkspace } from "../state/LibraryWorkspaceContext.ts";

type Library = ReturnType<typeof useResearchLibrary>;
const date = (value: string) =>
  new Date(value).toLocaleString(interfaceLocale(), { hour12: false });
function Counts({ value }: { value: ResearchLibrarySummary }) {
  useLocale();
  return (
    <span className="research-storage-counts">
      {value.foundations}  {t("篇基础理论 ·")} {value.notes}  {t("篇研究记录 ·")}{" "}
      {value.symbols}  {t("个符号 ·")} {value.maps}  {t("张地图")}</span>
  );
}
type Preview =
  | { kind: "history"; entry: LibraryHistoryEntry }
  | {
      kind: "import";
      content: string;
      summary: ResearchLibrarySummary;
      filename: string;
    };

export default function ResearchLibraryStorage({
  library,
  onClose,
}: {
  library: Library;
  onClose: () => void;
}) {
  useLocale();
  const { controller } = library;
  const workspace = useLibraryWorkspace();
  const [directory, setDirectory] = useState(library.directory ?? "");
  const [inspection, setInspection] = useState<LibraryInspection | null>(null);
  const [history, setHistory] = useState<LibraryHistoryEntry[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const busy = working || library.busy;
  const loadHistory = async () => setHistory(await controller.client.history());
  useEffect(() => {
    let current = true;
    if (library.directory)
      void controller.client
        .history()
        .then((items) => {
          if (current) setHistory(items);
        })
        .catch((cause) => {
          if (current)
            setError(
              cause instanceof Error ? cause.message : "无法读取历史版本。",
            );
        });
    return () => {
      current = false;
    };
  }, [controller, library.directory]);
  const run = async (operation: () => Promise<void>) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料库操作失败。");
    } finally {
      setWorking(false);
    }
  };
  const download = async () => {
    const content = await controller.exportBackup();
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `research-library-${new Date().toISOString().replaceAll(":", "-")}.webbench.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("完整备份已导出，包含当前页面的全部修改。");
  };
  const downloadWithMedia = async () => {
    const current = controller.getSnapshot();
    let archive: Blob | undefined;
    const url = current.directory
      ? await researchMediaClient.export(
          current.directory,
          current.notebook,
          "library",
        )
      : ((archive = await createBrowserMediaArchive(
          current.notebook,
          "library",
        )),
        URL.createObjectURL(archive));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `research-library-${new Date().toISOString().replaceAll(":", "-")}.zip`;
    anchor.click();
    if (archive)
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        void releaseBrowserMediaArchive(archive!).catch(() => {});
      }, 60000);
    setNotice("已开始导出含附件备份，请等待下载完成。");
  };
  return (
    <DeviceInspectorModal
      open
      title={t("研究笔记设置")}
      className="research-library-dialog"
      testId="research-library-storage"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <section className="research-storage-section">
        <div className="research-storage-heading">
          <FolderOpen size={17} />
          <h3>{t("本地资料库 ·")} {workspace.profile.name}</h3>
        </div>
        <p>
          {t("基础理论、研究记录、符号词典、标签、公式关联与理论地图统一保存。编辑后自动写入本地文件。")}</p>
        <small>
          {library.directory
            ? t("图片原件保存在此资料库的 assets 文件夹中，单文件不超过 1 GB。")
            : t("当前图片保存在浏览器中，单文件不超过 100 MB；更大附件请设置本地资料库。")}
        </small>
        {library.directory && (
          <div className="research-storage-location">
            <strong>{t("当前保存目录")}</strong>
            <code>{library.directory}</code>
            <small>{RESEARCH_LIBRARY_FILENAME}</small>
          </div>
        )}
        <p className={`research-storage-current-status is-${library.status}`}>
          {librarySaveLabel(library)}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setInspection(await controller.client.inspect(directory));
            });
          }}
        >
          <label htmlFor="research-storage-directory">{t("本地保存路径")}</label>
          <div className="research-storage-path-row">
            <input
              id="research-storage-directory"
              value={directory}
              disabled={busy}
              placeholder={t("例如 D:\\Research\\Notebook")}
              onChange={(event) => {
                setDirectory(event.target.value);
                setInspection(null);
              }}
            />
            <button type="submit" disabled={busy || !directory.trim()}>
              {t("检查路径")}</button>
          </div>
        </form>
        {inspection && (
          <div className="research-storage-path-preview">
            <strong>
              {inspection.exists ? t("此目录已有资料库") : t("此目录将创建新资料库")}
            </strong>
            <code>{inspection.directory}</code>
            {inspection.summary && (
              <>
                <Counts value={inspection.summary} />
                <small>{t("上次保存：")}{date(inspection.summary.savedAt)}</small>
              </>
            )}
            <p>
              {inspection.exists
                ? t("打开后读取此目录内容，当前页面内容会先保存为独立备份。")
                : t("先备份浏览器原始数据，再写入完整资料库；回读校验成功后启用自动保存。")}
            </p>
            <button
              type="button"
              className="research-storage-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await controller.connect(
                    inspection.directory,
                    inspection.exists ? "open" : "create",
                  );
                  setInspection(null);
                  setDirectory(controller.getSnapshot().directory ?? "");
                  await loadHistory();
                  setNotice("本地自动保存已启用");
                })
              }
            >
              <Check size={15} />
              {inspection.exists ? t("打开此目录资料库") : t("迁移到此目录")}
            </button>
          </div>
        )}
        {(library.status === "error" || library.status === "conflict") && (
          <div className="research-storage-action-row">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await controller.retry();
                  await loadHistory();
                })
              }
            >
              <RefreshCw size={15} />
              {t("重试本地保存")}</button>
            {library.directory && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await controller.reloadLocal();
                    setPreview(null);
                    await loadHistory();
                    setNotice("已读取本地版本，原页面内容已保留为独立备份。");
                  })
                }
              >
                {t("保留副本并读取本地版本")}</button>
            )}
          </div>
        )}
      </section>
      <section className="research-storage-section">
        <div className="research-storage-heading">
          <Download size={17} />
          <h3>{t("完整备份与恢复")}</h3>
        </div>
        <p>
          {t("迁移电脑请使用含附件备份，或复制整个资料库文件夹。原有 JSON 备份保存笔记与附件引用。")}</p>
        <div className="research-storage-action-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(downloadWithMedia)}
          >
            <Download size={15} />
            {t("导出含附件备份")}</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(download)}
          >
            <Download size={15} />
            {t("导出完整备份")}</button>
          <button
            type="button"
            disabled={busy || !library.directory}
            onClick={() => importRef.current?.click()}
          >
            <Upload size={15} />
            {t("恢复完整备份")}</button>
        </div>
        {!library.directory && (
          <small>{t("先设置本地保存路径，即可将完整备份恢复到该目录。")}</small>
        )}
        <input
          ref={importRef}
          type="file"
          hidden
          accept=".webbench.json,.json,.zip,application/json,application/zip"
          aria-label={t("选择完整资料库备份")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void run(async () => {
                let content: string;
                const signature = new Uint8Array(
                  await file.slice(0, 4).arrayBuffer(),
                );
                const isZip =
                  file.name.toLowerCase().endsWith(".zip") ||
                  file.type === "application/zip" ||
                  (signature[0] === 0x50 && signature[1] === 0x4b);
                if (isZip) {
                  if (!library.directory)
                    throw new Error("请先设置本地资料库，再恢复含附件备份。");
                  content = (
                    await researchMediaClient.importArchive(
                      library.directory,
                      file,
                    )
                  ).content;
                } else {
                  if (file.size > 64 * 1024 * 1024)
                    throw new Error(
                      "JSON 备份超过 64 MiB，请使用含附件 ZIP 备份。",
                    );
                  content = await file.text();
                }
                const parsed = await parseResearchLibraryFile(content);
                setPreview({
                  kind: "import",
                  content,
                  filename: file.name,
                  summary: researchLibrarySummary(parsed),
                });
              });
          }}
        />
      </section>
      <section className="research-storage-section">
        <div className="research-storage-heading">
          <History size={17} />
          <h3>{t("历史版本")}</h3>
          <button
            type="button"
            data-ui="icon-action"
            aria-label={t("刷新历史版本")}
            title={t("刷新历史版本")}
            disabled={busy || !library.directory}
            onClick={() => void run(loadHistory)}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <p>
          {t("保留最近 30 个已通过校验的历史版本。首次迁移与恢复前的独立备份位于 migration-backups，可通过“恢复完整备份”打开。")}</p>
        {history.length ? (
          <ol className="research-storage-history">
            {history.map((entry) => (
              <li key={entry.filename}>
                <div>
                  <strong>{date(entry.savedAt)}</strong>
                  <Counts value={entry} />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t`预览历史版本 ${entry.savedAt}`}
                  onClick={() => {
                    setPreview({ kind: "history", entry });
                    setError("");
                    setNotice("");
                  }}
                >
                  {t("预览恢复")}</button>
              </li>
            ))}
          </ol>
        ) : (
          <small>
            {library.directory
              ? t("暂无历史版本，后续保存会自动保留旧版本。")
              : t("设置保存路径后启用历史备份。")}
          </small>
        )}
      </section>
      {preview && (
        <section
          className="research-storage-restore-preview"
          aria-label={t("恢复预览")}
        >
          <h3>{t("恢复预览")}</h3>
          <strong>
            {preview.kind === "import"
              ? preview.filename
              : date(preview.entry.savedAt)}
          </strong>
          <Counts
            value={preview.kind === "import" ? preview.summary : preview.entry}
          />
          <p>
            {t("将恢复整个资料库。当前文件保留为历史版本，当前页面内容另存为恢复前备份。")}</p>
          <div className="research-storage-action-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              {t("取消恢复")}</button>
            <button
              type="button"
              className="research-storage-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (preview.kind === "import")
                    await controller.importBackup(preview.content);
                  else await controller.restore(preview.entry.filename);
                  setPreview(null);
                  await loadHistory();
                  setNotice("已恢复资料库，原版本已保留。");
                })
              }
            >
              {t("确认恢复此版本")}</button>
          </div>
        </section>
      )}
      {busy && <p role="status">{t("正在校验并保存资料库，请稍候…")}</p>}
      {(error || library.error || library.cacheError) && (
        <p className="research-storage-error" role="alert">
          {localizeError(error || library.error || library.cacheError)}
        </p>
      )}
      {notice && (
        <p className="research-storage-notice" role="status">
          {localizeError(notice)}
        </p>
      )}
    </DeviceInspectorModal>
  );
}
