import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LibraryWorkspaceContext } from "../state/LibraryWorkspaceContext.ts";
import { ResearchLibraryClient } from "../state/researchLibraryClient.ts";
import {
  createLibrarySession,
  type LibrarySession,
} from "../state/researchLibrarySession.ts";
import {
  selectLibrary,
  type LibraryCatalog,
  type LibraryProfile,
} from "../state/researchLibraryCatalog.ts";
import LibraryManager from "./LibraryManager.tsx";
import "./LibraryManager.css";

const catalogClient = new ResearchLibraryClient();
export default function LibraryWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  useLocale();
  const [context] = useState(
    () => new URLSearchParams(location.search).get("workspace") || "standalone",
  );
  const rememberKey = `mewiki:workspace:${context}:library`;
  const sessions = useRef(new Map<string, LibrarySession>());
  const [current, setCurrent] = useState<{
    id: string;
    profile: LibraryProfile;
    catalog: LibraryCatalog;
    session: LibrarySession;
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [manager, setManager] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const recoveryExport = useRef<{ id: string; notebook: string } | null>(null);
  useEffect(() => {
    const pool = sessions.current;
    return () => {
      for (const session of pool.values()) session.stop();
    };
  }, []);
  const getSession = useCallback((id: string) => {
    let session = sessions.current.get(id);
    if (!session) {
      session = createLibrarySession(id);
      sessions.current.set(id, session);
    }
    return session;
  }, []);
  const remember = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(rememberKey, id);
      } catch {
        /* Files remain durable without an entry preference. */
      }
      const url = new URL(location.href);
      if (id === "default") url.searchParams.delete("library");
      else url.searchParams.set("library", id);
      history.replaceState(null, "", url);
    },
    [rememberKey],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const catalog = await catalogClient.catalog();
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(rememberKey);
      } catch {
        /* Use the registered entry default. */
      }
      const id = selectLibrary(catalog, {
        context,
        explicit: new URLSearchParams(location.search).get("library"),
        remembered,
      });
      const session = getSession(id);
      session.watchBrowser();
      await session.controller.initialize();
      if (!cancelled) {
        setCurrent({
          id,
          profile: catalog.libraries.find((item) => item.id === id)!,
          catalog,
          session,
        });
        setError("");
        remember(id);
      }
    })().catch((cause) => {
      if (!cancelled)
        setError(cause instanceof Error ? cause.message : "无法打开资料库。");
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, context, rememberKey, getSession, remember]);
  useEffect(() => {
    current?.session.start();
    return () => current?.session.stop();
  }, [current?.session]);
  const refreshCatalog = useCallback(async () => {
    const catalog = await catalogClient.catalog();
    setCurrent((previous) => (previous ? { ...previous, catalog } : null));
    if (current && !catalog.libraries.some((item) => item.id === current.id))
      await current.session.controller.synchronize();
  }, [current]);
  const exportRemovedNotebook = useCallback(async () => {
    if (
      !current ||
      current.catalog.libraries.some((item) => item.id === current.id)
    )
      return;
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    const notebook = JSON.stringify(
      current.session.controller.getSnapshot().notebook,
    );
    const content = await current.session.controller.exportBackup();
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mewiki-recovery-${new Date().toISOString().replaceAll(":", "-")}.webbench.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    recoveryExport.current = { id: current.id, notebook };
  }, [current]);
  const switchLibrary = useCallback(
    async (id: string) => {
      if (!current || id === current.id) return;
      if (switchingRef.current) throw new Error("资料库正在切换，请稍后重试。");
      switchingRef.current = true;
      setSwitching(true);
      let target: LibrarySession | undefined;
      let opened = false;
      try {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        const catalog = await catalogClient.catalog();
        const removed = !catalog.libraries.some(
          (item) => item.id === current.id,
        );
        const exported = () =>
          recoveryExport.current?.id === current.id &&
          recoveryExport.current.notebook ===
            JSON.stringify(current.session.controller.getSnapshot().notebook);
        if (removed) {
          setCurrent((previous) =>
            previous ? { ...previous, catalog } : null,
          );
          if (current.session.controller.hasUnsavedChanges() && !exported())
            throw new Error(
              "当前资料库已从列表移除，请先导出当前修改，再切换资料库。",
            );
        } else {
          await current.session.controller.flush();
          if (current.session.controller.hasUnsavedChanges())
            throw new Error(
              "当前修改尚未保存，请先处理保存提示，再切换资料库。",
            );
        }
        selectLibrary(catalog, { context, explicit: id });
        const session = getSession(id);
        target = session;
        session.watchBrowser();
        await session.controller.initialize();
        if (session.controller.getSnapshot().status === "conflict")
          throw new Error(session.controller.getSnapshot().error);
        await session.controller.retry();
        session.refreshBrowser();
        const snapshot = session.controller.getSnapshot();
        if (snapshot.status === "error" || snapshot.status === "conflict")
          throw new Error(
            snapshot.error || "目标资料库未能读取，已保留当前资料库。",
          );
        if (
          removed &&
          current.session.controller.hasUnsavedChanges() &&
          !exported()
        )
          throw new Error("导出后内容已发生变化，请重新导出当前修改。");
        current.session.stop();
        setCurrent({
          id,
          profile: catalog.libraries.find((item) => item.id === id)!,
          catalog,
          session,
        });
        remember(id);
        opened = true;
      } finally {
        if (!opened) target?.stop();
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [current, context, getSession, remember],
  );
  if (!current)
    return (
      <main className="mewiki-workspace-loading">
        {error ? (
          <>
            <p role="alert">{localizeError(error)}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              {t("重试")}</button>
            <button
              type="button"
              onClick={() => {
                const url = new URL(location.href);
                url.searchParams.delete("library");
                history.replaceState(null, "", url);
                setAttempt((value) => value + 1);
              }}
            >
              {t("返回入口资料库")}</button>
          </>
        ) : (
          <p role="status">{t("正在打开资料库…")}</p>
        )}
      </main>
    );
  const profile =
    current.catalog.libraries.find((item) => item.id === current.id) ??
    current.profile;
  return (
    <LibraryWorkspaceContext.Provider
      value={{
        catalog: current.catalog,
        profile,
        context,
        session: current.session,
        switching,
        showManager: () => setManager(true),
        switchLibrary,
        refreshCatalog,
        exportRemovedNotebook,
      }}
    >
      {children}
      {manager && (
        <LibraryManager
          onClose={() => {
            if (!switchingRef.current) setManager(false);
          }}
        />
      )}
    </LibraryWorkspaceContext.Provider>
  );
}
