import { parsePublicationDom, publicationDomAttributes, publicationDomStyle, publicationDomTags, type PublicationDomNode } from '../domain/publicationDom.ts';
import type { PublicationBlock } from '../domain/publicationTypes.ts';
import { sanitizeDiagramSvg } from '../components/researchDiagramSvg.ts';

const frame = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const cancel = () => { cancelAnimationFrame(id); reject(signal.reason); };
  const id = requestAnimationFrame(() => { signal.removeEventListener('abort', cancel); if (signal.aborted) reject(signal.reason); else resolve(); });
  signal.addEventListener('abort', cancel, { once: true });
});
export async function waitForPublicationSurface(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + 30000;
  let stable = 0, fingerprint = '';
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    for (const image of root.querySelectorAll('img')) {
      if (!image.src.startsWith('blob:') && !image.src.startsWith('data:') && new URL(image.currentSrc || image.src, location.href).origin !== location.origin) throw new Error('网络图片需先保存到本地资料库，再导出社交图文。');
      image.loading = 'eager';
    }
    const loading = root.querySelector('[aria-busy="true"]') || [...root.querySelectorAll('[role="status"],.research-media-unavailable,.research-media-inline-placeholder')].some(element => /正在|loading|opening|generating|reading/i.test(element.textContent ?? ''));
    const mediaLoading = [...root.querySelectorAll('audio,video')].some(element => (element as HTMLMediaElement).readyState === 0 && !(element as HTMLMediaElement).error);
    const imagesLoading = [...root.querySelectorAll('img')].some(image => !image.complete);
    const next = `${root.innerHTML.length}:${root.scrollHeight}:${root.querySelectorAll('canvas').length}`;
    stable = !loading && !mediaLoading && !imagesLoading && next === fingerprint ? stable + 1 : 0;
    fingerprint = next;
    if (stable >= 3) {
      await document.fonts.ready;
      await Promise.all([...root.querySelectorAll('img')].map(image => image.decode()));
      const problem = root.querySelector('.research-note-embed-error,.research-diagram-error,.research-diagram-placeholder,.katex-error,.research-media-unavailable,.research-media-inline-placeholder,[role="alert"]');
      if (problem) throw new Error(problem.textContent?.trim() || '笔记部分内容未能显示，请修复后重新导出。');
      return;
    }
    await frame(signal);
  }
  throw new Error('笔记内容尚未完成显示，请等待媒体或图表加载后重新生成。');
}
function raster(element: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): string {
  const width = element instanceof HTMLCanvasElement ? element.width : element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
  const height = element instanceof HTMLCanvasElement ? element.height : element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
  if (!width || !height || width * height > 16_000_000) throw new Error('图片或预览尺寸超过导出上限，请缩小后重试。');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法生成图片，请使用受支持的 Edge。');
  context.drawImage(element, 0, 0);
  let content: string;
  try { content = canvas.toDataURL('image/png'); } catch { throw new Error('媒体预览无法读取，请保存到本地资料库后重新生成。'); }
  canvas.width = 0; canvas.height = 0;
  if (content.length > 12 * 1024 * 1024) throw new Error('媒体预览超过图片导出上限，请缩小后重试。');
  return content;
}
async function imageSnapshot(url: string, signal: AbortSignal): Promise<string> {
  if (!url.startsWith('blob:') && !url.startsWith('data:') && new URL(url, location.href).origin !== location.origin) throw new Error('网络图片需先保存到本地资料库，再导出社交图文。');
  const image = new Image();
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); image.onload = null; image.onerror = null; };
      const cancel = () => { cleanup(); image.src = ''; reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('媒体预览无法读取，请保存到本地资料库后重新生成。')); }, 20000);
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('媒体预览无法读取，请保存到本地资料库后重新生成。')); };
      signal.addEventListener('abort', cancel, { once: true }); image.src = url;
    });
    signal.throwIfAborted(); return raster(image);
  } finally { image.src = ''; }
}
const svgPaint = 'color fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset font-family font-size font-weight font-style letter-spacing text-anchor dominant-baseline opacity visibility'.split(' ');
async function graphicSnapshot(svg: SVGSVGElement, signal: AbortSignal, pixelRatio: number): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll<SVGElement>('*')];
  const copies = [copy, ...copy.querySelectorAll<SVGElement>('*')];
  originals.forEach((element, index) => {
    const computed = getComputedStyle(element);
    for (const name of svgPaint) copies[index].style.setProperty(name, computed.getPropertyValue(name));
  });
  const { width, height } = svg.getBoundingClientRect();
  if (!width || !height || width * height * pixelRatio ** 2 > 16_000_000) throw new Error('图片或预览尺寸超过导出上限，请缩小后重试。');
  copy.setAttribute('width', String(Math.ceil(width * pixelRatio))); copy.setAttribute('height', String(Math.ceil(height * pixelRatio)));
  copy.style.width = `${Math.ceil(width * pixelRatio)}px`; copy.style.height = `${Math.ceil(height * pixelRatio)}px`; copy.style.maxWidth = 'none'; copy.style.maxHeight = 'none'; copy.style.border = 'none';
  const url = URL.createObjectURL(new Blob([sanitizeDiagramSvg(new XMLSerializer().serializeToString(copy))], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); image.onload = null; image.onerror = null; };
      const cancel = () => { cleanup(); image.src = ''; reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('图形生成失败，请检查源码后重试。')); }, 20000);
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('图形生成失败，请检查源码后重试。')); };
      signal.addEventListener('abort', cancel, { once: true }); image.src = url;
    });
    signal.throwIfAborted(); return raster(image);
  } finally { image.src = ''; URL.revokeObjectURL(url); }
}
/** Freeze DOM structure and authored appearance, never event handlers, URLs or the live editor. */
export async function capturePublicationSurface(root: HTMLElement, signal: AbortSignal, pixelRatio = 2): Promise<{ blocks: PublicationBlock[]; text: string }> {
  await waitForPublicationSurface(root, signal);
  const graphics = new Map<Element, string>();
  for (const svg of root.querySelectorAll<SVGSVGElement>('.research-diagram-preview svg,svg.research-drawing-surface,svg.research-dataset-chart')) graphics.set(svg, await graphicSnapshot(svg, signal, Math.max(2, pixelRatio)));
  const posters = new Map<HTMLVideoElement, string>();
  for (const video of root.querySelectorAll('video')) if (video.poster) posters.set(video, await imageSnapshot(video.poster, signal));
  const visit = (source: Node): PublicationDomNode[] => {
    signal.throwIfAborted();
    if (source.nodeType === Node.TEXT_NODE) return [source.textContent ?? ''];
    if (!(source instanceof Element)) return [];
    if (source.matches('script,style,link,iframe,object,embed,math,.katex-mathml,.research-pdf-text,.mewiki-external-card > details,[hidden],input[type="file"]')) return [];
    const computed = getComputedStyle(source);
    if (computed.display === 'none' || computed.visibility === 'hidden' || computed.display !== 'contents' && !source.getClientRects().length) return [];
    let tag = source.tagName.toLowerCase();
    if (!publicationDomTags.has(tag) && tag !== 'canvas') return [...source.childNodes].flatMap(visit);
    const attrs: Record<string, string> = {}, style: Record<string, string> = {};
    for (const attribute of source.attributes) {
      const name = attribute.name === 'viewbox' ? 'viewBox' : attribute.name;
      if (!publicationDomAttributes.has(name) || ['src', 'poster', 'type', 'value', 'checked'].includes(name)) continue;
      if (['fill', 'stroke'].includes(name) && !/^(?:none|currentColor|transparent|#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(attribute.value)) continue;
      attrs[name] = attribute.value;
    }
    if (source instanceof HTMLElement || source instanceof SVGElement) for (const name of source.style) {
      const value = source.style.getPropertyValue(name);
      if (publicationDomStyle(name, value)) style[name] = value;
    }
    let children: PublicationDomNode[];
    if (graphics.has(source)) {
      tag = 'img'; attrs.src = graphics.get(source)!; attrs.alt = source.getAttribute('aria-label') ?? '';
      const bounds = source.getBoundingClientRect();
      style.width = `${bounds.width}px`; style.height = `${bounds.height}px`; children = [];
    } else if (source instanceof HTMLImageElement) {
      if (!source.src.startsWith('blob:') && new URL(source.currentSrc || source.src, location.href).origin !== location.origin && !source.src.startsWith('data:')) throw new Error('网络图片需先保存到本地资料库，再导出社交图文。');
      attrs.src = raster(source); children = [];
    } else if (source instanceof HTMLCanvasElement) {
      tag = 'img'; attrs.src = raster(source); attrs.alt = source.getAttribute('aria-label') ?? '';
      style.width = source.style.width || `${source.clientWidth}px`; style.height = source.style.height || `${source.clientHeight}px`; children = [];
    } else if (source instanceof HTMLVideoElement) {
      attrs.controls = ''; attrs.preload = 'none';
      if (posters.has(source)) attrs.poster = posters.get(source)!;
      else if (source.readyState >= 2 && source.videoWidth) attrs.poster = raster(source);
      children = [];
    } else if (source instanceof HTMLAudioElement) {
      attrs.controls = ''; attrs.preload = 'none'; children = [];
    } else if (source instanceof HTMLSelectElement) {
      children = [{ tag: 'option', children: [source.selectedOptions[0]?.textContent ?? source.value] }];
    } else if (source instanceof HTMLInputElement) {
      attrs.type = source.type; attrs.value = source.value;
      if (source.checked) attrs.checked = '';
      if (source.disabled) attrs.disabled = '';
      children = [];
    } else children = [...source.childNodes].flatMap(visit);
    return [{ tag, ...(Object.keys(attrs).length ? { attrs } : {}), ...(Object.keys(style).length ? { style } : {}), children }];
  };
  const blocks: PublicationBlock[] = [];
  const text: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(':scope > .research-note-blocks > [data-block-id]')) {
    const tree = visit(element)[0]; if (!tree) continue;
    const content = JSON.stringify(tree); parsePublicationDom(content);
    blocks.push({ id: `${element.dataset.blockId}:native`, sourceId: element.dataset.blockId, kind: 'native', content });
    text.push(element.innerText);
  }
  if (!blocks.length) throw new Error('请至少选择一个内容块。');
  return { blocks, text: text.join('\n\n') };
}
