import { publicationImageFromBlob } from './publicationSource.ts';
import { imageHeaderInfo } from '../domain/researchMediaFormats.ts';
import { mirrorTexturePixels, processTexturePixels, textureCrop, type TextureImageMode } from '../domain/publicationTexturePixels.ts';

export interface TextureSource { image: HTMLImageElement; dataUrl: string }
export async function readTextureSource(file: Blob, signal: AbortSignal): Promise<TextureSource> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('纹理图片只支持 PNG 或 JPEG。');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('导出图片原件不能超过 8 MiB，请先缩小图片。');
  signal.throwIfAborted();
  const header = imageHeaderInfo(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
  if (!['image/png', 'image/jpeg'].includes(header.mimeType)) throw new Error('纹理图片只支持 PNG 或 JPEG。');
  const dataUrl = await publicationImageFromBlob(file, signal);
  signal.throwIfAborted();
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; if (error) { image.src = ''; reject(error); } else resolve(); };
    const abort = () => done(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => done(new Error('纹理图片读取超时，请缩小后重试。')), 15000);
    signal.addEventListener('abort', abort, { once: true }); image.onload = () => done(); image.onerror = () => done(new Error('无法读取纹理图片。')); image.src = dataUrl;
  });
  signal.throwIfAborted();
  return { image, dataUrl };
}
export interface TextureCropSettings { size: number; x: number; y: number; flatten: boolean; seamless: boolean }
/** Creates three small candidates, never uploads the source or persists a file path. */
export async function createTextureCandidates(source: TextureSource, crop: TextureCropSettings, background: string, signal: AbortSignal): Promise<{ mode: TextureImageMode; image: string }[]> {
  const area = textureCrop(source.image.naturalWidth, source.image.naturalHeight, crop.size, crop.x, crop.y);
  const edge = Math.min(256, area.size), canvas = document.createElement('canvas'); canvas.width = canvas.height = edge;
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('无法处理纹理图片。');
  context.drawImage(source.image, area.x, area.y, area.size, area.size, 0, 0, edge, edge);
  const pixels = context.getImageData(0, 0, edge, edge).data;
  const candidates = [];
  for (const mode of ['original', 'gray', 'tint'] as const) {
    await new Promise(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
    const processed = processTexturePixels(pixels, edge, edge, mode, background, crop.flatten);
    const output = crop.seamless ? mirrorTexturePixels(processed, edge, edge) : processed;
    const size = crop.seamless ? edge * 2 : edge; canvas.width = canvas.height = size;
    context.putImageData(new ImageData(output, size, size), 0, 0);
    const image = canvas.toDataURL('image/png');
    if (image.length > 2 * 1024 * 1024) throw new Error('处理后的纹理过大，请选择更小的裁切区域。');
    candidates.push({ mode, image });
  }
  signal.throwIfAborted();
  return candidates;
}
