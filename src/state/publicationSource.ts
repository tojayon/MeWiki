import fontCss from '@fontsource-variable/noto-sans-sc/index.css?inline';
import { drawingSvg, mermaidSourceError, normalizeDiagramBlock, type ResearchDiagramBlock } from '../domain/researchDiagram.ts';
import { publicationChartSvg } from '../domain/publicationVisual.ts';
import type { ResearchDatasetBlock } from '../domain/researchDataset.ts';
import { mediaAssetIdPattern, type ResearchMediaSource } from '../domain/researchMedia.ts';
import { imageHeaderInfo } from '../domain/researchMediaFormats.ts';
import { sanitizeDiagramSvg } from '../components/researchDiagramSvg.ts';
import { browserMediaStore } from './researchMediaStorage.ts';
import { researchMediaClient } from './researchMediaClient.ts';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const abortError = () => new DOMException('导出已取消。', 'AbortError');
function checkImageSize(width: number | undefined, height: number | undefined) {
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('图片尺寸超过导出上限，请使用不超过 1600 万像素的本地图片。');
}
async function readBounded(response: Response, signal: AbortSignal): Promise<Blob> {
  if (!response.ok || !response.body) throw new Error('本地图片原件未找到，请恢复附件后重试。');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error('导出图片原件不能超过 8 MiB，请先缩小图片。'); }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error('导出图片原件不能超过 8 MiB，请先缩小图片。');
      chunks.push(new Uint8Array(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
function dataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal.removeEventListener('abort', cancel);
    const cancel = () => { reader.abort(); cleanup(); reject(abortError()); };
    signal.addEventListener('abort', cancel, { once: true });
    reader.onload = () => { cleanup(); if (signal.aborted) reject(abortError()); else resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(new Error('图片读取失败，请重新选择本地图片。')); };
    reader.readAsDataURL(blob);
  });
}
function imageFromUrl(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); image.onload = null; image.onerror = null; };
    const cancel = () => { image.src = ''; cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { image.src = ''; cleanup(); reject(new Error('图片解码超时，请缩小图片或重新选择文件。')); }, 20000);
    image.onload = () => { cleanup(); if (signal.aborted) reject(abortError()); else resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('图片无法解码，请重新保存为 PNG 或 JPEG。')); };
    signal.addEventListener('abort', cancel, { once: true }); image.src = url;
  });
}
function canvasPng(image: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法生成图片，请使用受支持的 Edge。');
  context.drawImage(image, 0, 0, width, height);
  const result = canvas.toDataURL('image/png'); canvas.width = 0; canvas.height = 0;
  if (result.length > MAX_IMAGE_BYTES * 4 / 3) throw new Error('生成图片超过 8 MiB，请缩小内容或原图。');
  return result;
}

/** Can also be used for a user-chosen local logo or cover. SVG is never accepted as an input image. */
export async function publicationImageFromBlob(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('导出图片原件不能超过 8 MiB，请先缩小图片。');
  const header = imageHeaderInfo(new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer()));
  checkImageSize(header.width, header.height);
  const url = URL.createObjectURL(blob);
  try {
    const image = await imageFromUrl(url, signal); checkImageSize(image.naturalWidth, image.naturalHeight);
    if (['image/png', 'image/jpeg'].includes(header.mimeType)) return await dataUrl(blob.slice(0, blob.size, header.mimeType), signal);
    return canvasPng(image, image.naturalWidth, image.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}

/** Only resolve the selected local asset through the current library's existing media service. */
export async function resolvePublicationImage(source: ResearchMediaSource, directory: string | null, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (source.type !== 'asset') throw new Error('网络图片需先保存到本地资料库，再导出社交图文。');
  if (!mediaAssetIdPattern.test(source.assetId)) throw new Error('图片来源标识无效，请重新关联本地图片。');
  let blob: Blob;
  if (directory) {
    const response = await fetch(researchMediaClient.contentUrl(directory, source.assetId), { signal, redirect: 'error', cache: 'no-store' });
    blob = await readBounded(response, signal);
  } else {
    const stored = await browserMediaStore.get(source.assetId); signal.throwIfAborted();
    if (!stored) throw new Error('本地图片原件未找到，请恢复附件后重试。');
    blob = stored.blob;
  }
  return publicationImageFromBlob(blob, signal);
}

const cachedFonts = new Map<string, string>();
function neededRange(range: string, points: number[]) {
  return range.split(',').some(item => {
    const match = /^\s*U\+([\da-f]+)(?:-([\da-f]+))?\s*$/i.exec(item);
    if (!match) return false;
    const low = parseInt(match[1], 16), high = parseInt(match[2] ?? match[1], 16);
    return points.some(point => point >= low && point <= high);
  });
}
async function embeddedFontCss(text: string, signal: AbortSignal): Promise<string> {
  const points = [...new Set([...text].map(character => character.codePointAt(0)!))];
  const faces = [...fontCss.matchAll(/@font-face\s*\{[^}]+\}/g)].map(match => match[0]).filter(face => neededRange(/unicode-range\s*:\s*([^;}]*)/i.exec(face)?.[1] ?? '', points));
  const result: string[] = [];
  for (const face of faces) {
    signal.throwIfAborted();
    const raw = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(face)?.[1];
    if (!raw) continue;
    // Vite may inline small, locally bundled font fragments in a production build.
    if (/^data:(?:font\/woff2|application\/(?:font-woff|octet-stream));base64,[A-Za-z0-9+/]+=*$/.test(raw)) {
      if (raw.length > 512 * 1024) throw new Error('本地字体分片超过大小限制。');
      result.push(face); continue;
    }
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith('.woff2')) throw new Error('本地导出字体不可用，请重新构建 MeWiki。');
    let data = cachedFonts.get(url.href);
    if (!data) {
      const response = await fetch(url.href, { signal, redirect: 'error', cache: 'force-cache' });
      if (!response.ok) throw new Error('本地导出字体读取失败，请重新构建 MeWiki。');
      const blob = await response.blob(); if (blob.size > 512 * 1024) throw new Error('本地字体分片超过大小限制。');
      data = await dataUrl(blob.slice(0, blob.size, 'font/woff2'), signal); cachedFonts.set(url.href, data);
    }
    result.push(face.replace(/url\([^)]*\)/, `url("${data}")`));
  }
  return result.join('\n');
}

async function svgPng(source: string, signal: AbortSignal): Promise<string> {
  const svg = new DOMParser().parseFromString(sanitizeDiagramSvg(source), 'image/svg+xml').documentElement;
  const viewBox = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let width = Number(svg.getAttribute('width')), height = Number(svg.getAttribute('height'));
  if (viewBox?.length === 4) { width = viewBox[2]; height = viewBox[3]; }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('图表尺寸无效，请检查图表后重试。');
  const scale = Math.min(2, 2160 / width, 2160 / height);
  width = Math.max(1, Math.ceil(width * scale)); height = Math.max(1, Math.ceil(height * scale));
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.removeAttribute('style');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `${await embeddedFontCss(svg.textContent ?? '', signal)}\ntext,tspan{font-family:'Noto Sans SC Variable',sans-serif!important}`;
  svg.insertBefore(style, svg.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try { const image = await imageFromUrl(url, signal); return canvasPng(image, width, height); }
  finally { URL.revokeObjectURL(url); }
}

/** Produce actual static pixels for charts, drawings and Mermaid, with no external requests. */
export async function renderPublicationVisual(block: ResearchDiagramBlock | ResearchDatasetBlock, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (block.type === 'dataset') return svgPng(publicationChartSvg(block), signal);
  const valid = normalizeDiagramBlock(block);
  if (valid.mode === 'drawing') return svgPng(drawingSvg(valid.strokes, valid.title), signal);
  const sourceError = mermaidSourceError(valid.code); if (sourceError) throw new Error(sourceError);
  if (!valid.code.trim()) throw new Error('流程图尚未填写内容，请检查后再导出。');
  const { default: mermaid } = await import('mermaid'); signal.throwIfAborted();
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false, fontFamily: 'Noto Sans SC Variable, sans-serif', theme: 'base', flowchart: { htmlLabels: false }, sequence: { useMaxWidth: false } });
  const id = `publication-${crypto.randomUUID().replaceAll('-', '')}`;
  const fontStyle = document.createElement('style');
  fontStyle.textContent = await embeddedFontCss(valid.code, signal);
  document.head.appendChild(fontStyle);
  try {
    await document.fonts.load('16px "Noto Sans SC Variable"', valid.code); signal.throwIfAborted();
    const result = await mermaid.render(id, valid.code); signal.throwIfAborted();
    return await svgPng(result.svg, signal);
  } catch (cause) {
    if (signal.aborted) throw abortError();
    if (cause instanceof Error && !cause.message.toLowerCase().includes('parse')) throw cause;
    throw new Error('流程图无法生成图片，请检查语法后重试。');
  } finally { fontStyle.remove(); document.getElementById(`d${id}`)?.remove(); }
}
