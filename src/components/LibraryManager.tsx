import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useState } from "react";
import { Check, FolderOpen, Plus } from "lucide-react";
import DeviceInspectorModal from "./DeviceInspectorModal.tsx";
import { useLibraryWorkspace } from "../state/LibraryWorkspaceContext.ts";
import { ResearchLibraryClient } from "../state/researchLibraryClient.ts";
import { createMeWikiNotebook } from "../domain/meWikiWorkspace.ts";
import { WEBBENCH_WORKSPACE } from "../state/researchLibraryCatalog.ts";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";

const client = new ResearchLibraryClient();
export default function LibraryManager({ onClose }: { onClose: () => void }) {
  useLocale();
  const workspace = useLibraryWorkspace();
  const confirm = useDeleteConfirmation();
  const [adding, setAdding] = useState<"create" | "open" | null>(null);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = working || workspace.switching;
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
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
  return (
    <DeviceInspectorModal
      open
      title={t("切换资料库")}
      testId="mewiki-library-manager"
      className="mewiki-library-manager"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {t("每个资料库独立保存笔记、符号、附件和历史版本。切换前自动保存当前修改。")}</p>
      {!workspace.catalog.libraries.some(
        (item) => item.id === workspace.profile.id,
      ) && (
        <div>
          <p role="alert">
            {t("当前资料库已在其他窗口从列表移除。请先导出当前修改，再选择其他资料库。原目录及附件仍保留。")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await workspace.exportRemovedNotebook();
                setNotice(
                  "已开始下载当前修改的备份，请确认下载完成后切换资料库。附件保留在原目录。",
                );
              })
            }
          >
            {t("导出当前修改")}</button>
        </div>
      )}
      <div className="mewiki-library-list" role="list" aria-label={t("资料库列表")}>
        {workspace.catalog.libraries.map((profile) => (
          <section
            key={profile.id}
            role="listitem"
            data-library-id={profile.id}
            className="mewiki-library-row"
          >
            <FolderOpen size={20} />
            <div className="mewiki-library-description">
              {renaming === profile.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await client.updateLibrary(profile.id, { name: rename });
                      await workspace.refreshCatalog();
                      setRenaming(null);
                    });
                  }}
                >
                  <label>
                    {t("资料库新名称")}<input
                      autoFocus
                      value={rename}
                      onChange={(event) => setRename(event.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <div className="mewiki-library-actions">
                    <button disabled={busy || !rename.trim()}>{t("保存名称")}</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRenaming(null)}
                    >
                      {t("取消改名")}</button>
                  </div>
                </form>
              ) : (
                <strong>{profile.name}</strong>
              )}
              <small>
                {profile.directory ??
                  t("仅保存在此浏览器，可在设置中迁移到本地目录")}
              </small>
              <span className="mewiki-library-badges">
                {workspace.profile.id === profile.id && <span>{t("当前资料库")}</span>}
                {workspace.catalog.contextDefaults[WEBBENCH_WORKSPACE] ===
                  profile.id && <span>{t("WebBench 默认")}</span>}
              </span>
              <div className="mewiki-library-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(profile.id);
                    setRename(profile.name);
                  }}
                >
                  {t("改名")}</button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    workspace.catalog.contextDefaults[WEBBENCH_WORKSPACE] ===
                      profile.id
                  }
                  onClick={() =>
                    void run(async () => {
                      await client.updateLibrary(profile.id, {
                        context: WEBBENCH_WORKSPACE,
                        useAsDefault: true,
                      });
                      await workspace.refreshCatalog();
                      try {
                        localStorage.setItem(
                          `mewiki:workspace:${WEBBENCH_WORKSPACE}:library`,
                          profile.id,
                        );
                      } catch {
                        /* The service still remembers the entry default. */
                      }
                      setNotice(
                        "WebBench 的默认资料库已更新。已打开的窗口保持当前资料库。",
                      );
                    })
                  }
                >
                  {t("设为 WebBench 默认")}</button>
                {profile.id !== "default" &&
                  profile.id !== workspace.profile.id && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          {
                            title: t("从列表移除资料库"),
                            description: t`从列表移除“${profile.name}”？目录中的笔记和附件会保留，以后可以重新添加。`,
                          },
                          () =>
                            void run(async () => {
                              await client.removeLibrary(profile.id);
                              await workspace.refreshCatalog();
                              setNotice("已从列表移除，原文件和附件已保留。");
                            }),
                        )
                      }
                    >
                      {t("从列表移除")}</button>
                  )}
              </div>
            </div>
            <button
              type="button"
              className="mewiki-library-open"
              disabled={busy || workspace.profile.id === profile.id}
              aria-label={t`切换到${profile.name}`}
              onClick={() =>
                void run(async () => {
                  await workspace.switchLibrary(profile.id);
                  onClose();
                })
              }
            >
              {workspace.profile.id === profile.id ? (
                <Check size={16} />
              ) : (
                t("打开")
              )}
            </button>
          </section>
        ))}
      </div>
      {!adding ? (
        <div className="mewiki-library-actions mewiki-library-add">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAdding("create");
              setName("");
              setDirectory("");
            }}
          >
            <Plus size={15} />
            {t("新建资料库")}</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAdding("open");
              setName("");
              setDirectory("");
            }}
          >
            <FolderOpen size={15} />
            {t("添加已有资料库")}</button>
        </div>
      ) : (
        <form
          className="mewiki-library-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const profile = await client.registerLibrary({
                name,
                directory,
                mode: adding,
                notebook: createMeWikiNotebook(),
              });
              if (
                workspace.context === WEBBENCH_WORKSPACE &&
                !workspace.catalog.contextDefaults[WEBBENCH_WORKSPACE]
              )
                await client.updateLibrary(profile.id, {
                  context: WEBBENCH_WORKSPACE,
                  useAsDefault: true,
                });
              await workspace.refreshCatalog();
              setAdding(null);
              await workspace.switchLibrary(profile.id);
              onClose();
            });
          }}
        >
          <h3>{adding === "create" ? t("新建独立资料库") : t("添加已有资料库")}</h3>
          <label>
            {t("资料库名称")}<input
              required
              maxLength={100}
              value={name}
              placeholder={t("例如 Cislunar 或个人 Wiki")}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            {t("资料库文件夹")}<input
              required
              value={directory}
              placeholder={t("例如 D:\\WikiLibraries\\Personal")}
              onChange={(event) => setDirectory(event.target.value)}
              disabled={busy}
            />
          </label>
          <p>
            {adding === "create"
              ? t("新库包含使用手册和通用示例。当前资料库的研究内容不会复制到新库。")
              : t("读取目录中已有的资料库，保留原有笔记、附件和历史。")}
          </p>
          <div className="mewiki-library-actions">
            <button
              type="submit"
              disabled={busy || !name.trim() || !directory.trim()}
            >
              {adding === "create" ? t("创建并打开") : t("添加并打开")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAdding(null)}
            >
              {t("取消")}</button>
          </div>
        </form>
      )}
      {busy && <p role="status">{t("正在保存并打开资料库…")}</p>}
      {error && <p role="alert">{localizeError(error)}</p>}
      {notice && <p role="status">{localizeError(notice)}</p>}
    </DeviceInspectorModal>
  );
}
