import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Globe, Link, RefreshCw, Settings2 } from "lucide-react";
import { normalizeMediaUrl } from "../domain/researchMedia.ts";
import type { ResearchBookmarkBlock as BookmarkBlock } from "../domain/researchBookmark.ts";
import { researchMediaClient } from "../state/researchMediaClient.ts";
import { useResearchContentLibrary } from "../state/ResearchContentLibraryContext.ts";
import "./ResearchBookmarkBlock.css";

export default function ResearchBookmarkBlock({ block, readOnly = false, onPatch }: { block: BookmarkBlock; readOnly?: boolean; onPatch: (patch: Partial<BookmarkBlock>) => void }) {
  useLocale();
  const library = useResearchContentLibrary();
  const [draftState, setDraft] = useState({ url: block.url, value: block.url ?? "" });
  const draft = draftState.url === block.url ? draftState.value : block.url ?? "";
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ key: string; token: number }>();
  const blocked = library.busy || library.status === "loading";
  const contextKey = JSON.stringify([block.id, block.url, readOnly, library.directory, blocked]);
  const loading = pending?.key === contextKey;
  const latest = useRef({ block, readOnly, directory: library.directory, busy: library.busy });
  const session = useRef<{ operation: number; abort?: AbortController }>({ operation: 0 });
  useLayoutEffect(() => { latest.current = { block, readOnly, directory: library.directory, busy: library.busy }; }, [block, readOnly, library.directory, library.busy]);
  useEffect(() => { const state = session.current; const invalidate = () => { state.operation++; state.abort?.abort(); }; invalidate(); return invalidate; }, [block.id, block.url, readOnly, library.directory, blocked]);
  const canEdit = !readOnly && !library.busy && library.status !== "loading";
  const save = () => {
    if (!canEdit) return;
    try { const url = normalizeMediaUrl(draft); onPatch({ url }); setError(""); }
    catch { setError("请填写不含登录凭据的 HTTP 或 HTTPS 网页网址。"); }
  };
  const fetchMetadata = async () => {
    if (!canEdit || !block.url) return;
    const state = session.current;
    state.abort?.abort();
    const controller = new AbortController(); state.abort = controller;
    const token = ++state.operation;
    const original = block;
    const directory = library.directory;
    const current = () => !controller.signal.aborted && token === state.operation && !latest.current.readOnly && !latest.current.busy && latest.current.directory === directory && latest.current.block.id === original.id && latest.current.block.url === original.url;
    setPending({ key: contextKey, token }); setError("");
    try {
      const metadata = await researchMediaClient.webMetadata(block.url, controller.signal);
      if (!current()) return;
      const patch: Partial<BookmarkBlock> = {};
      for (const field of ["title", "description", "siteName"] as const) if (latest.current.block[field] === original[field]) patch[field] = metadata[field];
      onPatch(patch);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "暂时无法读取网页，可手动填写标题和摘要。"); }
    finally { if (token === state.operation) setPending(undefined); if (state.abort === controller) state.abort = undefined; }
  };
  let host = t("网页链接");
  try { if (block.url) host = new URL(block.url).hostname; } catch { /* Invalid browser data is repaired by the normalizer. */ }
  return <div className="research-bookmark-block" aria-busy={loading}>
    {block.url && <a className="research-bookmark-link" href={block.url} target="_blank" rel="noopener noreferrer"><Globe className="research-bookmark-icon" size={26} aria-hidden="true" /><span><strong>{block.title || host}</strong>{block.description && <p>{block.description}</p>}<small>{block.siteName || host}<span aria-hidden="true"> · </span>{block.url}</small></span><ExternalLink size={15} aria-hidden="true" /></a>}
    {canEdit && <>
      {!block.url && <div className="research-bookmark-input"><Link size={16} /><input type="url" aria-label={t("网页网址")} placeholder={t("粘贴网页链接…")} value={draft} onChange={event => setDraft({ url: block.url, value: event.target.value })} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } }} /><button type="button" onClick={save} disabled={!draft.trim()}>{t("保存链接")}</button></div>}
      <div className="research-bookmark-tools">
        {block.url && <button type="button" data-ui="icon-action" aria-label={t("获取网页信息")} title={t("读取标题、摘要与来源；获取期间的手动修改会保留")} disabled={loading} onClick={() => void fetchMetadata()}><RefreshCw size={14} /></button>}
        <button type="button" data-ui="icon-action" aria-label={t("网页卡片设置")} title={t("编辑网址、标题、摘要与来源")} aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={14} /></button>
        {loading && <span role="status">{t("正在读取网页信息…")}</span>}
      </div>
      {settings && <div className="research-bookmark-settings">
        {block.url && <label>{t("网址")}<div className="research-bookmark-edit-url"><input type="url" aria-label={t("网页网址")} value={draft} onChange={event => setDraft({ url: block.url, value: event.target.value })} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); save(); } }} /><button type="button" onClick={save}>{t("更新链接")}</button></div></label>}
        <label>{t("标题")}<input aria-label={t("网页标题")} value={block.title ?? ""} onChange={event => onPatch({ title: event.target.value })} /></label>
        <label>{t("摘要")}<textarea aria-label={t("网页摘要")} rows={3} value={block.description ?? ""} onChange={event => onPatch({ description: event.target.value })} /></label>
        <label>{t("来源")}<input aria-label={t("网页来源")} value={block.siteName ?? ""} onChange={event => onPatch({ siteName: event.target.value })} /></label>
      </div>}
      {error && <p role="alert" className="research-bookmark-error">{localizeError(error)}</p>}
    </>}
    {!canEdit && !block.url && <p className="research-bookmark-empty">{block.title || t("网页链接待填写")}{block.description && ` · ${block.description}`}</p>}
  </div>;
}
