import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mediaAssetIdPattern } from "../domain/researchMedia.ts";
import { useResearchMediaSource } from "./useResearchMediaSource.ts";
import DeviceInspectorModal from "./DeviceInspectorModal.tsx";
const ResearchPdfReader = lazy(() => import("./ResearchPdfReader.tsx"));
export function ResearchMediaInlineImage({ src, alt, title }: { src: string; alt?: string; title?: string }) {
  useLocale();
  const id = src.slice(15);
  const view = useResearchMediaSource(mediaAssetIdPattern.test(id) ? { type: "asset", assetId: id } : undefined);
  return view.previewUrl ? <img src={view.previewUrl} alt={alt || t("图片")} title={title} loading="lazy" decoding="async" /> : <span className="research-media-inline-placeholder" title={localizeError(view.error)}>{alt || t("图片")} · {view.loading ? t("正在读取") : t("请重新关联原件")}</span>;
}
export function ResearchMediaInlineLink({ href, children }: { href: string; children: ReactNode }) {
  useLocale();
  const reference = /^webbench-asset:([a-f0-9]{64})(?:#page=([1-9]\d*))?$/.exec(href);
  const id = reference?.[1] ?? "";
  const page = reference?.[2] ? Number(reference[2]) : undefined;
  const [expanded, setExpanded] = useState(false);
  const view = useResearchMediaSource(mediaAssetIdPattern.test(id) ? { type: "asset", assetId: id } : undefined);
  if (page && view.asset?.mimeType === "application/pdf" && view.playbackUrl) return <><a href={`${view.playbackUrl}#page=${page}`} target="_blank" rel="noopener noreferrer" title={t`阅读 PDF 第 ${page} 页`} onClick={event => { event.preventDefault(); setExpanded(true); }}>{children}</a>{expanded && createPortal(<div onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><DeviceInspectorModal open title={view.asset.name} className="research-media-preview-dialog" onClose={() => setExpanded(false)}><Suspense fallback={<p>{t("正在打开 PDF…")}</p>}><ResearchPdfReader key={view.playbackUrl} src={view.playbackUrl} name={view.asset.name} referenceUrl={`webbench-asset:${id}`} size={view.asset.size} page={page} /></Suspense></DeviceInspectorModal></div>, document.body)}</>;
  return view.originalUrl ? <a href={view.originalUrl} download={view.asset?.name} title={t("下载附件原件")}>{children}</a> : <span aria-busy={view.loading || undefined} className="research-media-inline-placeholder" title={localizeError(view.error)}>{children}{t("（附件未找到）")}</span>;
}
