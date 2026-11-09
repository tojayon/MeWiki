import { lazy, Suspense, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mediaAssetIdPattern } from "../domain/researchMedia.ts";
import { useResearchMediaSource } from "./useResearchMediaSource.ts";
import DeviceInspectorModal from "./DeviceInspectorModal.tsx";
const ResearchPdfReader = lazy(() => import("./ResearchPdfReader.tsx"));
export function ResearchMediaInlineImage({ src, alt, title }: { src: string; alt?: string; title?: string }) {
  const id = src.slice(15);
  const view = useResearchMediaSource(mediaAssetIdPattern.test(id) ? { type: "asset", assetId: id } : undefined);
  return view.previewUrl ? <img src={view.previewUrl} alt={alt || "图片"} title={title} loading="lazy" decoding="async" /> : <span className="research-media-inline-placeholder" title={view.error}>{alt || "图片"} · {view.loading ? "正在读取" : "请重新关联原件"}</span>;
}
export function ResearchMediaInlineLink({ href, children }: { href: string; children: ReactNode }) {
  const reference = /^webbench-asset:([a-f0-9]{64})(?:#page=([1-9]\d*))?$/.exec(href);
  const id = reference?.[1] ?? "";
  const page = reference?.[2] ? Number(reference[2]) : undefined;
  const [expanded, setExpanded] = useState(false);
  const view = useResearchMediaSource(mediaAssetIdPattern.test(id) ? { type: "asset", assetId: id } : undefined);
  if (page && view.asset?.mimeType === "application/pdf" && view.playbackUrl) return <><a href={`${view.playbackUrl}#page=${page}`} target="_blank" rel="noopener noreferrer" title={`阅读 PDF 第 ${page} 页`} onClick={event => { event.preventDefault(); setExpanded(true); }}>{children}</a>{expanded && createPortal(<div onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><DeviceInspectorModal open title={view.asset.name} className="research-media-preview-dialog" onClose={() => setExpanded(false)}><Suspense fallback={<p>正在打开 PDF…</p>}><ResearchPdfReader key={view.playbackUrl} src={view.playbackUrl} name={view.asset.name} referenceUrl={`webbench-asset:${id}`} size={view.asset.size} page={page} /></Suspense></DeviceInspectorModal></div>, document.body)}</>;
  return view.originalUrl ? <a href={view.originalUrl} download={view.asset?.name} title="下载附件原件">{children}</a> : <span title={view.error}>{children}（附件未找到）</span>;
}
