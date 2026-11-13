import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Copy, ExternalLink, FileText, Pencil, Plus, RefreshCw, Settings2 } from "lucide-react";
import { citationDoiUrl, formatCitation, type ResearchCitationBlock as CitationBlock } from "../domain/researchCitation.ts";
import { normalizeMediaUrl, type ResearchMediaBlock as MediaBlock } from "../domain/researchMedia.ts";
import { flattenResearchBlocks } from "../domain/researchBlockTree.ts";
import { useResearchContentLibrary } from "../state/ResearchContentLibraryContext.ts";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import ResearchMediaBlock from "./ResearchMediaBlock.tsx";
import { useCitationDoiMetadata } from "./useCitationDoiMetadata.ts";
import "./ResearchCitationBlock.css";

export default function ResearchCitationBlock({ block, readOnly = false, onPatch }: {
  block: CitationBlock; readOnly?: boolean; onPatch: (patch: Partial<CitationBlock>) => void;
}) {
  useLocale();
  const library = useResearchContentLibrary();
  const [editing, setEditing] = useState(() => !(block.title || block.authors || block.venue || block.year || block.doi || block.url || block.notes));
  const [advanced, setAdvanced] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState({ original: block.url, value: block.url ?? "" });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const copyOperation = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canEdit = !readOnly && !library.busy && library.status !== "loading";
  const metadata = useCitationDoiMetadata({ block, canEdit, directory: library.directory, onPatch });
  const hasDetails = Boolean(block.title || block.authors || block.venue || block.year || block.doi || block.url || block.notes);
  const showEditor = canEdit && (editing || !hasDetails);
  const url = urlDraft.original === block.url ? urlDraft.value : block.url ?? "";
  useEffect(() => () => { copyOperation.current++; clearTimeout(copyTimer.current); }, [block.id]);
  const patch = metadata.patch;
  const saveLink = (value: string) => {
    if (!canEdit) return;
    try {
      const normalized = value.trim() ? normalizeMediaUrl(value) : undefined;
      patch({ url: normalized });
      setUrlDraft({ original: normalized, value: normalized ?? "" });
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "文献链接无效。"); }
  };
  const copy = async () => {
    const token = ++copyOperation.current;
    try { await navigator.clipboard.writeText(formatCitation(block)); if (copyOperation.current === token) setStatus("已复制引用"); }
    catch { if (copyOperation.current === token) setStatus("复制失败，请允许剪贴板访问后重试。"); }
    if (copyOperation.current !== token) return;
    clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setStatus(""), 2500);
  };
  const pdfOptions = canEdit && pdfOpen && !block.pdf ? library.notebook.notes.flatMap(note => flattenResearchBlocks(note.blocks).flatMap(item => item.type === "media" && item.kind === "pdf" && item.source ? [{ key: `${note.id}:${item.id}`, name: `${note.title || t("未命名笔记")} · ${item.alt || t("PDF 文档")}`, block: item }] : [])) : [];
  const pdfPatch = (value: Partial<MediaBlock>) => {
    if (!canEdit) return;
    const result: Partial<CitationBlock> = {};
    if ("source" in value) result.pdf = value.source;
    if ("alt" in value) result.pdfName = value.alt;
    if ("document" in value) result.pdfPage = value.document?.page;
    patch(result);
  };
  return <section className="research-citation-block" aria-label={t("文献引用卡片")} aria-busy={metadata.loading}>
    <div className="research-citation-heading">
      <BookOpen size={22} aria-hidden="true" />
      <div className="research-citation-summary"><strong>{block.title || t("文献待填写")}</strong>{(block.authors || block.year || block.venue) && <p>{[block.authors, block.year, block.venue].filter(Boolean).join(" · ")}</p>}</div>
      <div className="research-citation-tools">
        <button type="button" data-ui="icon-action" aria-label={t("复制文献引用")} title={t("复制作者、年份、标题与来源")} disabled={!hasDetails} onClick={() => void copy()}>{status === "已复制引用" ? <Check size={15} /> : <Copy size={15} />}</button>
        {canEdit && <button type="button" data-ui="icon-action" aria-label={t("编辑文献资料")} title={t("编辑文献资料")} aria-expanded={showEditor} onClick={() => setEditing(value => !value)}><Pencil size={15} /></button>}
      </div>
    </div>
    {(block.doi || block.url) && <div className="research-citation-links">
      {block.doi && <a href={citationDoiUrl(block.doi)} target="_blank" rel="noopener noreferrer" title={t("打开 DOI 来源")}>DOI: {block.doi}<ExternalLink size={12} /></a>}
      {block.url && <a href={block.url} target="_blank" rel="noopener noreferrer">{t("来源网页")}<ExternalLink size={12} /></a>}
    </div>}
    {showEditor && <div className="research-citation-editor">
      <label className="research-citation-title-field">DOI<div className="research-citation-doi-input"><input aria-label={t("文献 DOI")} placeholder={t("粘贴 DOI，自动获取文献信息…")} maxLength={8192} value={metadata.doi} onChange={event => metadata.changeDoi(event.target.value)} onBlur={metadata.saveDoi} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); metadata.saveDoi(); } }} /><button type="button" data-ui="icon-action" aria-label={t("获取 DOI 元信息")} title={t("获取标题、作者、年份与期刊；保留已有内容和查询期间的手动修改")} disabled={metadata.loading || !metadata.doi.trim()} onClick={metadata.fetchMetadata}><RefreshCw size={15} /></button></div></label>
      <label className="research-citation-title-field">{t("标题")}<input aria-label={t("文献标题")} maxLength={16000} value={block.title ?? ""} onChange={event => patch({ title: event.target.value })} /></label>
      <label>{t("作者")}<input aria-label={t("文献作者")} placeholder={t("多位作者用分号分隔")} maxLength={16000} value={block.authors ?? ""} onChange={event => patch({ authors: event.target.value })} /></label>
      <label>{t("年份")}<input aria-label={t("文献年份")} placeholder={t("例如 2026")} maxLength={16000} value={block.year ?? ""} onChange={event => patch({ year: event.target.value })} /></label>
      <label className="research-citation-title-field">{t("期刊 / 来源")}<input aria-label={t("文献期刊或来源")} maxLength={16000} value={block.venue ?? ""} onChange={event => patch({ venue: event.target.value })} /></label>
      <label className="research-citation-title-field">{t("阅读笔记")}<textarea aria-label={t("文献阅读笔记")} rows={3} maxLength={160000} value={block.notes ?? ""} onChange={event => patch({ notes: event.target.value })} /></label>
      <div className="research-citation-advanced-toggle"><button type="button" data-ui="icon-action" aria-label={t("文献链接设置")} title={t("填写来源网址")} aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><Settings2 size={15} /></button>{advanced && <span>{t("来源链接")}</span>}</div>
      {advanced && <>
        <label className="research-citation-title-field">{t("网址")}<input aria-label={t("文献来源网址")} type="url" placeholder="https://…" value={url} onChange={event => { metadata.editUrlDraft(); setUrlDraft({ original: block.url, value: event.target.value }); }} onBlur={() => saveLink(url)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); saveLink(url); } }} /></label>
      </>}
    </div>}
    {!showEditor && block.notes && <div className="research-citation-notes"><ResearchMarkdown text={block.notes} /></div>}
    {(canEdit || block.pdf) && <div className="research-citation-pdf-toggle"><button type="button" aria-label={block.pdf ? t("阅读关联 PDF") : t("关联文献 PDF")} aria-expanded={pdfOpen} title={block.pdf ? t("展开或收起原文，阅读页码随文献保存") : t("选择文件、关联已有 PDF 或使用网络直链")} onClick={() => setPdfOpen(value => !value)}>{block.pdf ? <FileText size={15} /> : <Plus size={15} />}<span>{block.pdf ? block.pdfName || t("PDF 原文") : t("关联 PDF")}</span></button>{block.pdf && <small>{block.pdfPage ? t`第 ${block.pdfPage} 页` : ""}</small>}</div>}
    {pdfOpen && (canEdit || block.pdf) && <div className="research-citation-pdf">
      {pdfOptions.length > 0 && <label className="research-citation-existing-pdf">{t("已有 PDF")}<select aria-label={t("关联已有 PDF")} value="" onChange={event => { const selected = pdfOptions.find(option => option.key === event.target.value); if (selected) patch({ pdf: selected.block.source, pdfName: selected.block.alt, pdfPage: selected.block.document?.page ?? 1 }); }}><option value="">{t("选择笔记中的 PDF…")}</option>{pdfOptions.map(option => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>}
      <ResearchMediaBlock key={`${block.id}:${library.directory ?? "browser"}`} block={{ id: `${block.id}-pdf`, type: "media", kind: "pdf", source: block.pdf, alt: block.pdfName, ...(block.pdfPage === undefined ? {} : { document: { page: block.pdfPage } }) }} readOnly={!canEdit} onPatch={pdfPatch} onCancelEmpty={() => setPdfOpen(false)} />
    </div>}
    {status && <p className="research-citation-status" role="status">{localizeError(status)}</p>}
    {metadata.loading && <p className="research-citation-status" role="status">{t("正在获取文献元信息…")}</p>}
    {metadata.status && <p className="research-citation-status" role="status">{localizeError(metadata.status)}</p>}
    {metadata.error && <p className="research-citation-error" role="alert">{metadata.error}</p>}
    {error && <p className="research-citation-error" role="alert">{localizeError(error)}</p>}
  </section>;
}
