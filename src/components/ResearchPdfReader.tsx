import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { findPdfText, indexPdfText } from "../domain/researchPdfText.ts";
import "./ResearchPdfReader.css";

GlobalWorkerOptions.workerSrc = workerUrl;
const PREVIEW_BYTES = 100_000_000;
const MAX_MATCHES = 500;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "文档无法读取";
interface SearchHit { page: number; count: number }

export default function ResearchPdfReader({ src, name, referenceUrl, size, page: savedPage = 1, onPageChange }: {
  src: string; name: string; referenceUrl: string; size?: number; page?: number; onPageChange?: (page: number) => void;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(savedPage);
  const [pageInput, setPageInput] = useState(String(savedPage));
  const [observedPage, setObservedPage] = useState(savedPage);
  if (observedPage !== savedPage) { setObservedPage(savedPage); setPage(savedPage); setPageInput(String(savedPage)); }
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const [large, setLarge] = useState(size !== undefined && size > PREVIEW_BYTES);
  const [passwordRequest, setPasswordRequest] = useState<{ update: (password: string) => void; incorrect: boolean }>();
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searchStatus, setSearchStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchOperation = useRef(0);
  const currentPage = useRef(page);
  currentPage.current = page;
  const pageChange = useRef(onPageChange);
  pageChange.current = onPageChange;
  const savedPageRef = useRef(savedPage);
  savedPageRef.current = savedPage;
  const lifetime = useRef<AbortSignal | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const resize = new ResizeObserver(entries => setWidth(Math.max(120, entries[0].contentRect.width - 20)));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    let task: ReturnType<typeof getDocument> | undefined;
    lifetime.current = abort.signal;
    void (async () => {
      if (large) return;
      // Avoid allocating a huge PDF preview; the original remains independently downloadable.
      if (size === undefined && !src.startsWith("blob:")) {
        try {
          const head = await fetch(src, { method: "HEAD", credentials: "omit", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]) });
          if (Number(head.headers.get("content-length")) > PREVIEW_BYTES) { if (!cancelled) setLarge(true); return; }
        } catch { if (cancelled) return; }
      }
      if (cancelled) return;
      const resources = new URL(import.meta.env.BASE_URL + "pdfjs/", window.location.origin).href;
      task = getDocument({ url: src, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536, enableXfa: false, cMapUrl: resources + "cmaps/", cMapPacked: true, standardFontDataUrl: resources + "standard_fonts/", wasmUrl: resources + "wasm/", iccUrl: resources + "iccs/", maxImageSize: 40_000_000, canvasMaxAreaInBytes: 64 * 1024 * 1024 });
      task.onPassword = (update: (password: string) => void, reason: number) => { if (!cancelled) setPasswordRequest({ update, incorrect: reason === 2 }); };
      task.onProgress = (progress: { total: number; loaded: number }) => {
        if (!cancelled && (progress.total > PREVIEW_BYTES || progress.loaded > PREVIEW_BYTES)) { setLarge(true); void task?.destroy().catch(() => {}); }
      };
      try {
        const pdf = await task.promise;
        if (cancelled) return;
        setDocument(pdf); setPasswordRequest(undefined);
        const validPage = Math.min(Math.max(1, savedPageRef.current), pdf.numPages);
        setPage(validPage); setPageInput(String(validPage));
      } catch (cause) { if (!cancelled) setError(`PDF 未能显示：${errorMessage(cause)}。可打开来源或下载原件。`); }
    })();
    return () => { cancelled = true; abort.abort(); clearTimeout(copyTimer.current); void task?.destroy().catch(() => {}); };
    // The parent keys this reader by source; changing pages must not reload the PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    if (!document || !stageRef.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    let text: TextLayer | undefined;
    let releasePage: (() => void) | undefined;
    setRendering(true); setError("");
    void (async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled) { pdfPage.cleanup(); return; }
        releasePage = () => { void (render?.promise ?? Promise.resolve()).catch(() => {}).then(() => pdfPage.cleanup()); };
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(3, width / base.width) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        // Bound canvas memory independently of zoom or malicious page dimensions.
        const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
        const sheet = window.document.createElement("div"); sheet.className = "research-pdf-sheet";
        sheet.style.width = `${viewport.width}px`; sheet.style.height = `${viewport.height}px`;
        sheet.style.setProperty("--total-scale-factor", String(scale));
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * density); canvas.height = Math.ceil(viewport.height * density);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("aria-label", `${name} · 第 ${page} 页`);
        const layer = window.document.createElement("div"); layer.className = "research-pdf-text";
        sheet.append(canvas, layer); stageRef.current?.replaceChildren(sheet);
        render = pdfPage.render({ canvas, viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] });
        const content = await pdfPage.getTextContent();
        if (cancelled) return;
        text = new TextLayer({ textContentSource: content, container: layer, viewport });
        await Promise.all([render.promise, text.render()]);
        if (cancelled) return;
        if (searched) {
          const index = indexPdfText(content.items);
          const ranges = findPdfText(index, searched, MAX_MATCHES);
          text.textDivs.forEach((div, number) => { const span = index.spans[number]; if (span && ranges.some(match => match.start < span.end && match.end > span.start)) div.dataset.pdfMatch = "true"; });
        }
        setRendering(false);
      } catch (cause) { if (!cancelled) { setError(`此页未能显示：${errorMessage(cause)}`); setRendering(false); } }
    })();
    return () => { cancelled = true; render?.cancel(); text?.cancel(); releasePage?.(); };
  }, [document, page, width, zoom, name, searched]);

  const go = (value: number) => {
    if (!document) return;
    const valid = Math.min(document.numPages, Math.max(1, Math.round(value) || 1));
    setPage(valid); setPageInput(String(valid)); pageChange.current?.(valid);
  };
  const search = async () => {
    if (!document || !query.trim()) return;
    const operation = ++searchOperation.current;
    const signal = lifetime.current;
    const current = () => operation === searchOperation.current && !signal?.aborted;
    const needle = query.trim();
    setSearching(true); setHits([]); setSearched(needle); setSearchStatus("");
    let count = 0;
    const results: SearchHit[] = [];
    try {
      for (let number = 1; number <= document.numPages; number++) {
        if (!current()) return;
        setSearchStatus(`正在搜索 ${number}/${document.numPages} 页…`);
        const pdfPage = await document.getPage(number);
        const content = await pdfPage.getTextContent();
        if (!current()) return;
        const pageHits = findPdfText(indexPdfText(content.items), needle, MAX_MATCHES - count).length;
        if (pageHits) { results.push({ page: number, count: pageHits }); count += pageHits; }
        if (number !== currentPage.current) pdfPage.cleanup();
        if (count >= MAX_MATCHES) break;
      }
      if (!current()) return;
      setHits(results); setHitIndex(0); if (results.length) go(results[0].page);
      setSearchStatus(count ? `${count >= MAX_MATCHES ? "至少 " : ""}${count} 处 · ${results.length} 页` : "未找到；扫描版 PDF 需要先识别文字");
    } catch { if (current()) setSearchStatus("搜索中断，请重试或下载原件查看。"); }
    finally { if (current()) setSearching(false); }
  };
  const copy = async () => {
    const token = lifetime.current;
    if (!token || token.aborted) return;
    const url = referenceUrl.split("#")[0] + `#page=${page}`;
    const title = name.replace(/[\\[\]]/g, "\\$&").replace(/\r?\n/g, " ");
    try { await navigator.clipboard.writeText(`[${title} · 第 ${page} 页](${url.replaceAll("(", "%28").replaceAll(")", "%29")})`); if (!token.aborted) setCopyStatus("已复制当前页引用"); }
    catch { if (!token.aborted) setCopyStatus("复制失败，请允许剪贴板访问后重试。"); }
    if (token.aborted) return;
    clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopyStatus(""), 2500);
  };
  const moveHit = (direction: number) => { const next = (hitIndex + direction + hits.length) % hits.length; setHitIndex(next); go(hits[next].page); };
  return <div className="research-pdf-reader">
    <div className="research-pdf-controls" role="toolbar" aria-label="PDF 阅读工具">
      <button type="button" data-ui="icon-action" aria-label="PDF 上一页" title="上一页" disabled={!document || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={16} /></button>
      <input type="number" aria-label="PDF 页码" min={1} max={document?.numPages} value={pageInput} disabled={!document} onChange={event => setPageInput(event.target.value)} onBlur={() => go(Number(pageInput))} onKeyDown={event => { if (event.key === "Enter") go(Number(pageInput)); }} />
      <span>/ {document?.numPages ?? "—"}</span>
      <button type="button" data-ui="icon-action" aria-label="PDF 下一页" title="下一页" disabled={!document || page >= document.numPages} onClick={() => go(page + 1)}><ChevronRight size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label="缩小 PDF" title="缩小" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}><ZoomOut size={15} /></button>
      <button type="button" data-ui="icon-action" aria-label="放大 PDF" title="放大" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><ZoomIn size={15} /></button>
      <button type="button" data-ui="icon-action" aria-label="复制当前页引用" title="复制带页码的 Markdown 引用" disabled={!document} onClick={() => void copy()}>{copyStatus.startsWith("已") ? <Check size={15} /> : <Copy size={15} />}</button>
      <a href={src.split("#")[0] + `#page=${page}`} target="_blank" rel="noopener noreferrer" title="在新窗口打开 PDF" aria-label="在新窗口打开 PDF"><ExternalLink size={15} /></a>
      <label className="research-pdf-search"><input type="search" aria-label="搜索 PDF" placeholder="搜索文档…" value={query} disabled={!document} onChange={event => { searchOperation.current++; setSearching(false); setQuery(event.target.value); setHits([]); setSearchStatus(""); setSearched(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }} /><button type="button" data-ui="icon-action" aria-label="开始搜索 PDF" title="搜索全文" disabled={!document || !query.trim() || searching} onClick={() => void search()}><Search size={14} /></button></label>
    </div>
    {passwordRequest && <form className="research-pdf-password" onSubmit={event => { event.preventDefault(); passwordRequest.update(password); setPassword(""); setPasswordRequest(undefined); }}><label>{passwordRequest.incorrect ? "密码不正确，请重试" : "此 PDF 已加密"}<input type="password" aria-label="PDF 密码" value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" /></label><button type="submit">解锁</button></form>}
    <div ref={viewportRef} className="research-pdf-viewport" aria-busy={!large && !error && rendering}>
      {large ? <div className="research-pdf-message">此文档较大，已保留完整原件。<a href={src} target="_blank" rel="noopener noreferrer">在独立窗口阅读</a></div>
        : <><div ref={stageRef} className="research-pdf-stage" />{!document && !error && !passwordRequest && <p className="research-pdf-message">正在打开 PDF…</p>}{error && <p className="research-pdf-message" role="alert">{error}</p>}</>}
    </div>
    {(searchStatus || copyStatus) && <div className="research-pdf-search-results"><span role="status">{copyStatus || searchStatus}</span>{hits.length > 1 && <><button type="button" data-ui="icon-action" aria-label="上一个匹配页" title="上一个匹配页" onClick={() => moveHit(-1)}><ArrowUp size={14} /></button><button type="button" data-ui="icon-action" aria-label="下一个匹配页" title="下一个匹配页" onClick={() => moveHit(1)}><ArrowDown size={14} /></button></>}{searching && <button type="button" data-ui="icon-action" aria-label="取消 PDF 搜索" title="取消搜索" onClick={() => { searchOperation.current++; setSearching(false); setSearchStatus("搜索已取消"); }}><X size={14} /></button>}</div>}
  </div>;
}
