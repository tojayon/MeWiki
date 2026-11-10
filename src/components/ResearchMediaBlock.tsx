import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { localizeMediaError } from "../i18n/mediaError.ts";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, AudioLines, Download, File, FileText, Film, ImagePlus, Link, Maximize2, RefreshCw, Settings2, Upload, X } from "lucide-react";
import { mediaFileAccept, mediaFileKind, mediaKindFromMime, mediaKindLabels, normalizeMediaUrl, validateMediaFile, type ResearchMediaBlock as MediaBlock } from "../domain/researchMedia.ts";
import { researchMediaClient, type MediaProgress, type RemoteMediaJob } from "../state/researchMediaClient.ts";
import { browserMediaStore } from "../state/researchMediaStorage.ts";
import DeviceInspectorModal from "./DeviceInspectorModal.tsx";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import ResearchMediaPlayer from "./ResearchMediaPlayer.tsx";
import { refreshResearchMediaAsset, useResearchMediaSource } from "./useResearchMediaSource.ts";
import "./ResearchMediaBlock.css";

const imageFileAccept = mediaFileAccept("image");
const ResearchPdfReader = lazy(() => import("./ResearchPdfReader.tsx"));
const sizeLabel = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
const message = (cause: unknown) => cause instanceof Error ? cause.message : "媒体导入失败，请重试。";
export default function ResearchMediaBlock({ block, readOnly = false, onPatch, onInsertAfter, onCancelEmpty, onOpenStorage }: {
  block: MediaBlock; readOnly?: boolean; onPatch: (patch: Partial<MediaBlock>) => void;
  onInsertAfter?: (blocks: MediaBlock[]) => void; onCancelEmpty?: () => void; onOpenStorage?: () => void;
}) {
  useLocale();
  const view = useResearchMediaSource(block.source);
  const posterView = useResearchMediaSource(block.kind === "video" ? block.poster : undefined);
  const sourceLabel = mediaKindLabels[block.kind];
  const label = t(sourceLabel);
  const isImage = block.kind === "image";
  const FileIcon = isImage ? ImagePlus : block.kind === "audio" ? AudioLines : block.kind === "video" ? Film : block.kind === "pdf" ? FileText : File;
  const [settings, setSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState(block.source?.type === "url" ? block.source.url : "");
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState<string>();
  const [progress, setProgress] = useState<MediaProgress>();
  const [expanded, setExpanded] = useState(false);
  const [remote, setRemote] = useState<RemoteMediaJob>();
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const posterFileRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const latestContext = useRef({ block, directory: view.directory, readOnly });
  const hasSource = Boolean(block.source || block.legacySource);
  useLayoutEffect(() => { latestContext.current = { block, directory: view.directory, readOnly }; }, [block, view.directory, readOnly]);
  useEffect(() => {
    operation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [block.id, block.kind, view.directory, readOnly]);
  useEffect(() => {
    const input = fileRef.current;
    if (!input) return;
    const handleCancel = () => { if (!hasSource) onCancelEmpty?.(); else setImporting(false); };
    input.addEventListener("cancel", handleCancel);
    return () => input.removeEventListener("cancel", handleCancel);
  }, [hasSource, onCancelEmpty]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; abortRef.current?.abort(); }; }, []);
  const canEdit = !readOnly && !view.busy && view.status !== "loading";
  const showImporter = canEdit && (!hasSource || importing);
  const previewUrl = view.previewUrl;
  const failed = Boolean(previewUrl && imageError === previewUrl);
  const acceptFiles = async (files: File[]) => {
    if (!canEdit || abortRef.current || !files.length) return;
    const abort = new AbortController(); abortRef.current = abort;
    const token = ++operation.current;
    let expectedSource = JSON.stringify(block.source ?? null);
    const sameContext = () => mounted.current && token === operation.current && !latestContext.current.readOnly && latestContext.current.block.id === block.id && latestContext.current.block.kind === block.kind && latestContext.current.directory === view.directory && JSON.stringify(latestContext.current.block.source ?? null) === expectedSource;
    const current = () => !abort.signal.aborted && sameContext();
    setError("");
    const extras: MediaBlock[] = [];
    try {
      for (const [index, file] of files.entries()) {
        validateMediaFile(file, block.kind);
        const onProgress = (value: MediaProgress) => { if (current()) setProgress(value); };
        const asset = view.directory ? await researchMediaClient.upload(view.directory, file, onProgress, abort.signal) : await browserMediaStore.put(file, onProgress, abort.signal);
        if (!current()) return;
        setImageError(undefined);
        refreshResearchMediaAsset(view.directory, asset.id);
        const source = { type: "asset" as const, assetId: asset.id };
        if (index === 0) {
          expectedSource = JSON.stringify(source);
          latestContext.current = { ...latestContext.current, block: { ...latestContext.current.block, source } };
          const latestAlt = latestContext.current.block.alt;
          onPatch({ source, legacySource: undefined, ...(block.kind === "pdf" ? { document: { page: 1 } } : {}), ...(latestAlt === block.alt ? { alt: latestAlt || file.name } : {}) }); setImporting(false);
        }
        else extras.push({ id: crypto.randomUUID(), type: "media", kind: block.kind, source, alt: file.name });
      }
    } catch (cause) { if (sameContext()) setError(abort.signal.aborted ? "导入已暂停。重新选择同一文件可继续已完成的分片。" : message(cause)); }
    finally {
      if (sameContext() && extras.length) onInsertAfter?.(extras);
      if (abortRef.current === abort) { abortRef.current = null; if (mounted.current) setProgress(undefined); }
    }
  };
  const applyLink = () => {
    if (!canEdit || abortRef.current) return;
    operation.current++;
    try { const valid = normalizeMediaUrl(url); onPatch({ source: { type: "url", url: valid }, legacySource: undefined, ...(block.kind === "pdf" ? { document: { page: 1 } } : {}) }); setImageError(undefined); setImporting(false); setError(""); }
    catch { setError(`请输入 HTTP 或 HTTPS ${sourceLabel}直链。`); }
  };
  const downloadRemote = async () => {
    if (!canEdit || abortRef.current) return;
    const token = ++operation.current;
    if (!view.directory) { setError(`下载保存网络${sourceLabel}需要先设置本地资料库。`); onOpenStorage?.(); return; }
    const directory = view.directory;
    const abort = new AbortController(); abortRef.current = abort;
    const expectedSource = JSON.stringify(block.source ?? null);
    const sameContext = () => mounted.current && token === operation.current && !latestContext.current.readOnly && latestContext.current.block.id === block.id && latestContext.current.block.kind === block.kind && latestContext.current.directory === directory && JSON.stringify(latestContext.current.block.source ?? null) === expectedSource;
    const current = () => !abort.signal.aborted && sameContext();
    let job: RemoteMediaJob | undefined;
    let pause: (() => void) | undefined;
    setError(""); setProgress({ phase: "downloading", loaded: 0, total: 0 });
    try {
      job = await researchMediaClient.startRemote(directory, !importing && block.source?.type === "url" ? block.source.url : url);
      pause = () => { if (job?.status === "downloading") void researchMediaClient.pauseRemote(directory, job.id).catch(() => {}); };
      abort.signal.addEventListener("abort", pause, { once: true });
      if (!current()) { pause(); return; }
      while (current()) {
        setRemote(job); setProgress({ phase: "downloading", loaded: job.bytes, total: job.total ?? 0 });
        if (job.status === "complete" && job.asset) { if (block.kind !== "file" && mediaKindFromMime(job.asset.mimeType) !== block.kind) throw new Error(`该地址返回的文件不是${sourceLabel}，原内容已保留。`); setImageError(undefined); refreshResearchMediaAsset(directory, job.asset.id); const latestAlt = latestContext.current.block.alt; onPatch({ source: { type: "asset", assetId: job.asset.id }, legacySource: undefined, ...(block.kind === "pdf" ? { document: { page: 1 } } : {}), ...(latestAlt === block.alt ? { alt: latestAlt || job.asset.name } : {}) }); setImporting(false); return; }
        if (job.status === "error" || job.status === "paused") throw new Error(job.error || "下载已暂停，再次点击可继续。");
        await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); }; const timer = setTimeout(done, 700); abort.signal.addEventListener("abort", done, { once: true }); });
        if (current()) job = await researchMediaClient.remote(directory, job.id);
      }
      pause();
      if (sameContext()) setError("下载已暂停，再次点击下载保存可继续。");
    } catch (cause) { if (sameContext()) setError(message(cause)); }
    finally {
      if (pause) abort.signal.removeEventListener("abort", pause);
      if (abortRef.current === abort) { abortRef.current = null; if (mounted.current) setProgress(undefined); }
    }
  };
  const acceptPoster = async (file: File) => {
    if (!canEdit || abortRef.current || block.kind !== "video") return;
    const abort = new AbortController(); abortRef.current = abort;
    const token = ++operation.current;
    const expectedPoster = JSON.stringify(block.poster ?? null);
    const current = () => mounted.current && !abort.signal.aborted && token === operation.current && !latestContext.current.readOnly && latestContext.current.block.id === block.id && latestContext.current.block.kind === "video" && latestContext.current.directory === view.directory && JSON.stringify(latestContext.current.block.poster ?? null) === expectedPoster;
    setError("");
    try {
      validateMediaFile(file, "image");
      const onProgress = (value: MediaProgress) => { if (current()) setProgress(value); };
      const asset = view.directory ? await researchMediaClient.upload(view.directory, file, onProgress, abort.signal) : await browserMediaStore.put(file, onProgress, abort.signal);
      if (!current()) return;
      refreshResearchMediaAsset(view.directory, asset.id);
      onPatch({ poster: { type: "asset", assetId: asset.id } });
    } catch (cause) { if (current()) setError(message(cause)); }
    finally { if (abortRef.current === abort) { abortRef.current = null; if (mounted.current) setProgress(undefined); } }
  };
  const posterUrl = posterView.previewUrl;
  const playable = (block.kind === "audio" || block.kind === "video") && view.playbackUrl && (!view.asset || mediaKindFromMime(view.asset.mimeType) === block.kind);
  const pdfSource = block.kind === "pdf" && view.playbackUrl && (!view.asset || view.asset.mimeType === "application/pdf");
  const name = block.alt || view.asset?.name || label;
  return <figure className="research-media-block" data-media-kind={block.kind} data-media-source={block.source?.type} aria-busy={Boolean(progress)}
    onPasteCapture={event => { const target = event.target instanceof HTMLElement ? event.target : null; if (!canEdit || target?.closest("input, textarea")) return; const files = [...event.clipboardData.files].filter(file => block.kind === "file" || mediaFileKind(file) === block.kind); if (files.length) { event.preventDefault(); event.stopPropagation(); void acceptFiles(files); } }}
    onDragOver={event => { if (canEdit && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }}
    onDrop={event => { if (canEdit && event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void acceptFiles([...event.dataTransfer.files]); } }}>
    <input ref={fileRef} type="file" hidden multiple={Boolean(onInsertAfter)} accept={mediaFileAccept(block.kind)} aria-label={t`选择${label}文件`} disabled={!canEdit || Boolean(progress)} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void acceptFiles(files); }} />
    {hasSource && <>
      <div className="research-media-toolbar">
        {isImage && <button type="button" data-ui="icon-action" aria-label={t("放大图片")} title={t("放大预览")} disabled={!previewUrl || failed} onClick={() => setExpanded(true)}><Maximize2 size={15} /></button>}
        {view.originalUrl && <a className="research-media-download" href={view.originalUrl} download={block.source?.type === "asset" ? view.asset?.name || block.kind : undefined} target={block.source?.type === "url" ? "_blank" : undefined} rel="noopener noreferrer" title={block.source?.type === "url" ? t`打开来源${label}` : t("下载原件")} aria-label={block.source?.type === "url" ? t`打开来源${label}` : t`下载${label}原件`}><Download size={15} /></a>}
        {canEdit && <>
          <span className="research-media-toolbar-divider" />
          {(["left", "center", "right"] as const).map((align, index) => { const Icon = [AlignLeft, AlignCenter, AlignRight][index]; const alignLabel = [t`${label}左对齐`, t`${label}居中`, t`${label}右对齐`][index]; return <button type="button" key={align} data-ui="icon-action" aria-label={alignLabel} title={alignLabel} aria-pressed={(block.display?.align ?? "left") === align} onClick={() => onPatch({ display: { ...block.display, align } })}><Icon size={15} /></button>; })}
          <button type="button" data-ui="icon-action" aria-label={t`替换${label}`} title={t`替换${label}，原件保留用于历史恢复`} disabled={Boolean(progress)} onClick={() => { setUrl(block.source?.type === "url" ? block.source.url : ""); setImporting(value => !value); }}><RefreshCw size={15} /></button>
          {block.source?.type === "url" && <button type="button" data-ui="icon-action" aria-label={t`下载并保存${label}`} title={t("下载到本地资料库，之后可离线使用")} disabled={Boolean(progress)} onClick={() => void downloadRemote()}><Upload size={15} /></button>}
          <button type="button" data-ui="icon-action" aria-label={t`${label}设置`} title={isImage ? t("替代说明、尺寸与文件信息") : t("名称、显示宽度与文件信息")} aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={15} /></button>
        </>}
      </div>
      <div className="research-media-visual" data-align={block.display?.align ?? "left"}>
        <div className="research-media-picture" style={{ width: `${block.display?.widthPercent ?? 100}%` }}>
          {pdfSource ? <><div className="research-media-document-title"><FileText size={16} /><strong>{name}</strong></div><Suspense fallback={<p className="research-media-unavailable">{t("正在打开 PDF…")}</p>}><ResearchPdfReader key={view.playbackUrl} src={view.playbackUrl!} name={name} size={view.asset?.size} referenceUrl={block.source?.type === "asset" ? `webbench-asset:${block.source.assetId}` : block.source?.url ?? ""} page={block.document?.page} onPageChange={canEdit ? page => onPatch({ document: { ...block.document, page } }) : undefined} /></Suspense></>
            : block.kind === "file" && view.originalUrl ? <a className="research-attachment-card" href={view.originalUrl} download={block.source?.type === "asset" ? view.asset?.name || name : undefined} target={block.source?.type === "url" ? "_blank" : undefined} rel="noopener noreferrer" aria-label={block.source?.type === "url" ? t("打开来源附件") : t("下载附件原件")}><File size={28} aria-hidden="true" /><span><strong>{name}</strong><small>{view.asset ? `${view.asset.name.split(".").at(-1)?.toUpperCase() || "FILE"} · ${sizeLabel(view.asset.size)}` : t("网络附件")}</small></span><Download size={17} aria-hidden="true" /></a>
            : playable ? <ResearchMediaPlayer key={view.playbackUrl} kind={block.kind as "audio" | "video"} src={view.playbackUrl!} name={name} poster={posterUrl} playback={block.playback} onPlaybackChange={canEdit ? playback => onPatch({ playback }) : undefined} />
            : isImage && previewUrl && !failed ? <button type="button" className="research-media-open" aria-label={t("查看图片预览")} onClick={() => setExpanded(true)}><img src={previewUrl} alt={block.alt || t("图片")} loading="lazy" decoding="async" onError={() => setImageError(previewUrl)} /></button>
            : block.legacySource ? <div className="research-media-legacy"><ResearchMarkdown text={block.legacySource} /><small>{t("保留的旧媒体引用，可重新选择文件保存原件。")}</small></div>
            : <div className="research-media-unavailable">{view.loading ? t`正在读取${label}…` : localizeError(view.error) || (isImage ? failed ? t("图片未能显示，请重试、更换链接或重新关联文件。") : t("原件已保存，未能生成受限预览；可下载原件查看。") : t`未能读取${label}，可重新关联原文件。`)}{canEdit && <button type="button" onClick={() => setImporting(true)}>{t("重新关联")}</button>}</div>}
        </div>
      </div>
    </>}
    {showImporter && <div className="research-media-importer">
      <button type="button" className="research-media-file" disabled={Boolean(progress)} onClick={() => fileRef.current?.click()}><FileIcon size={24} /><span>{t("选择")}{label}</span><small>{t("或拖入、粘贴")}{label}</small></button>
      <div className="research-media-url"><label><Link size={15} /><input aria-label={t`${label}网址`} type="url" placeholder={t`粘贴${label}直链…`} value={url} disabled={Boolean(progress)} onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } }} /></label>
        <div><button type="button" disabled={!url.trim() || Boolean(progress)} onClick={applyLink}>{t("使用链接")}</button><button type="button" disabled={!url.trim() || Boolean(progress)} title={t("下载到本地资料库，可离线使用")} onClick={() => void downloadRemote()}>{t("下载并保存")}</button>
        {hasSource ? <button type="button" data-ui="icon-action" aria-label={t`取消替换${label}`} title={t("取消替换")} onClick={() => setImporting(false)}><X size={14} /></button> : onCancelEmpty && <button type="button" data-ui="icon-action" aria-label={t`取消插入${label}`} title={t("取消插入")} onClick={onCancelEmpty}><X size={14} /></button>}</div>
      </div>
    </div>}
    {progress && <div className="research-media-progress" role="status"><progress max={progress.total || undefined} value={progress.total ? progress.loaded : undefined} /><span>{({ hashing: t("正在校验"), uploading: t("正在保存"), saving: t("正在验证原件"), downloading: t("正在下载") })[progress.phase]}{progress.total ? ` ${Math.round(progress.loaded / progress.total * 100)}%` : ` ${sizeLabel(progress.loaded)}`}</span><button type="button" data-ui="icon-action" aria-label={t`暂停${label}导入`} title={t("暂停；重新选择相同文件可续传")} onClick={() => abortRef.current?.abort()}><X size={14} /></button></div>}
    {remote?.message && progress && <small>{remote.message}</small>}
    {(hasSource || block.caption) && <figcaption>{canEdit ? <textarea rows={1} aria-label={isImage ? t("图片图注") : t`${label}说明`} placeholder={isImage ? t("添加图注…") : t("添加说明…")} value={block.caption ?? ""} onChange={event => onPatch({ caption: event.target.value })} /> : block.caption}</figcaption>}
    {settings && canEdit && <div className="research-media-settings">
      <label>{isImage ? t("替代说明") : t("名称")}<input aria-label={isImage ? t("图片替代说明") : t`${label}名称`} value={block.alt ?? ""} onChange={event => onPatch({ alt: event.target.value })} /></label>
      <label>{t("显示宽度")}<select aria-label={t`${label}显示宽度`} value={block.display?.widthPercent ?? 100} onChange={event => onPatch({ display: { ...block.display, widthPercent: Number(event.target.value) } })}>{[25, 50, 75, 100].map(width => <option key={width} value={width}>{width}%</option>)}</select></label>
      {block.kind === "video" && <div className="research-media-poster">
        <input ref={posterFileRef} type="file" hidden accept={imageFileAccept} aria-label={t("选择视频封面文件")} disabled={Boolean(progress)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void acceptPoster(file); }} />
        {posterUrl && <img src={posterUrl} alt={t("视频封面")} />}
        <button type="button" disabled={Boolean(progress)} onClick={() => posterFileRef.current?.click()}>{block.poster ? t("替换封面") : t("选择封面")}</button>
        {block.poster && <button type="button" disabled={Boolean(progress)} onClick={() => onPatch({ poster: undefined })}>{t("移除封面")}</button>}
        {block.poster && !posterView.loading && !posterUrl && <span className="research-media-poster-status">{t("封面预览不可用，可重新选择图片。")}</span>}
      </div>}
      {view.asset && <small title={view.asset.sourceUrl}>{view.asset.name} · {sizeLabel(view.asset.size)}{view.asset.width && view.asset.height ? ` · ${view.asset.width} × ${view.asset.height}` : ""}{view.asset.mimeType === "image/gif" ? t(" · GIF 预览显示首帧") : ""}</small>}
      {block.source?.type === "url" && <small className="research-media-source-url" title={block.source.url}>{block.source.url}</small>}
    </div>}
    {error && <div className="research-media-error" role="alert">{localizeMediaError(error)}{!view.directory && onOpenStorage && <button type="button" onClick={onOpenStorage}>{t("设置本地资料库")}</button>}</div>}
    {expanded && isImage && previewUrl && <DeviceInspectorModal open title={t("图片预览")} className="research-media-preview-dialog" onClose={() => setExpanded(false)}><img src={previewUrl} alt={block.alt || t("图片")} /><p>{block.caption}</p>{view.originalUrl && <a href={view.originalUrl} download={view.asset?.name} target={block.source?.type === "url" ? "_blank" : undefined} rel="noopener noreferrer">{block.source?.type === "url" ? t("打开来源图片") : t("下载原件")}</a>}</DeviceInspectorModal>}
  </figure>;
}
