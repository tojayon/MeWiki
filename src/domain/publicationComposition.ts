import { publicationObject, publicationNumber, publicationChoice, publicationColor, publicationText, failPublication } from './publicationValidation.ts';
import { publicationFontFamily } from './researchFonts.ts';

export const COMPOSITION_MAX_LAYERS = 40;
export const compositionStickers = ['arrow', 'circle', 'badge', 'bubble', 'star', 'number'] as const;
export type CompositionSticker = typeof compositionStickers[number];
export interface CompositionLayer {
  id: string; name: string; type: 'text' | 'sticker' | 'image'; space: 'canvas' | 'screen';
  x: number; y: number; width: number; height: number; rotation: number; opacity: number; hidden: boolean; locked: boolean;
  text: string; fontFamily: 'sans' | 'serif'; fontAssetId?: string; fontSize: number; fontWeight: 400 | 700;
  color: string; background: string; align: 'left' | 'center' | 'right'; lineHeight: number; letterSpacing: number; padding: number; radius: number;
  sticker: CompositionSticker; image: string; fit: 'contain' | 'cover'; autoShrink: boolean;
  localOnly?: boolean;
}
export interface CompositionSubject { x: number; y: number; scale: number; rotation: number; hidden: boolean; locked: boolean }
export interface PublicationComposition { version: 1; subject: CompositionSubject; layers: CompositionLayer[] }
export interface CompositionOverrides { layers?: Record<string, Partial<Omit<CompositionLayer, 'id' | 'type' | 'localOnly'>>>; subject?: Partial<CompositionSubject> }
export interface PublicationImageData { title: string; subtitle: string; name: string; index: number; total: number; overrides?: CompositionOverrides }
export const defaultComposition = (): PublicationComposition => ({ version: 1, subject: { x: 50, y: 50, scale: 100, rotation: 0, hidden: false, locked: false }, layers: [] });
export function newCompositionLayer(type: CompositionLayer['type'], id: string): CompositionLayer {
  return { id, type, name: type === 'text' ? '文字' : type === 'sticker' ? '贴纸' : '装饰图片', space: 'canvas', x: 10, y: 8, width: type === 'text' ? 80 : 20, height: type === 'text' ? 15 : 15,
    rotation: 0, opacity: 100, hidden: false, locked: false, text: type === 'text' ? '在这里输入文字' : '', fontFamily: 'sans', fontSize: 5, fontWeight: 700,
    color: '#162d50', background: 'transparent', align: 'center', lineHeight: 1.4, letterSpacing: 0, padding: 1, radius: 1, sticker: 'arrow', image: '', fit: 'contain', autoShrink: true };
}
const context = '图片创作 → 画布';
const bool = (value: unknown, path: string) => { if (typeof value !== 'boolean') return failPublication(path, '开关值无效。'); return value; };
function subject(value: unknown): CompositionSubject {
  const s = publicationObject(value, ['x', 'y', 'scale', 'rotation', 'hidden', 'locked'], context + ' → 主体');
  return { x: publicationNumber(s.x, 0, 100, context + ' → 主体位置', false), y: publicationNumber(s.y, 0, 100, context + ' → 主体位置', false), scale: publicationNumber(s.scale, 20, 150, context + ' → 主体大小', false), rotation: publicationNumber(s.rotation, -180, 180, context + ' → 主体旋转', false), hidden: bool(s.hidden, context), locked: bool(s.locked, context) };
}
function parseLayer(value: unknown, index: number): CompositionLayer {
  const path = `${context} → 第 ${index + 1} 个图层`;
  const raw = publicationObject(value, [...Object.keys(newCompositionLayer('text', '')), 'fontAssetId', 'localOnly'], path);
  const id = publicationText(raw.id, 80, path + ' → 标识');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) return failPublication(path, '图层标识无效。');
  const type = publicationChoice(raw.type, ['text', 'sticker', 'image'] as const, path);
  const image = publicationText(raw.image, 3 * 1024 * 1024, path + ' → 装饰图片');
  if (image && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return failPublication(path, '装饰图片需要已载入的 PNG 或 JPEG。');
  if (type === 'image' && !image) return failPublication(path, '装饰图片缺失，请重新添加。');
  const result: CompositionLayer = {
    id, type, name: publicationText(raw.name, 80, path), space: publicationChoice(raw.space, ['canvas', 'screen'] as const, path),
    x: publicationNumber(raw.x, -100, 200, path + ' → 水平位置', false), y: publicationNumber(raw.y, -100, 200, path + ' → 垂直位置', false),
    width: publicationNumber(raw.width, 1, 200, path + ' → 宽度', false), height: publicationNumber(raw.height, 1, 200, path + ' → 高度', false),
    rotation: publicationNumber(raw.rotation, -180, 180, path + ' → 旋转', false), opacity: publicationNumber(raw.opacity, 0, 100, path + ' → 透明度', false),
    hidden: bool(raw.hidden, path), locked: bool(raw.locked, path), text: publicationText(raw.text, 4000, path + ' → 文字'),
    fontFamily: publicationChoice(raw.fontFamily, ['sans', 'serif'] as const, path), fontSize: publicationNumber(raw.fontSize, .5, 30, path + ' → 文字大小', false),
    fontWeight: publicationNumber(raw.fontWeight, 400, 700, path) as 400 | 700, color: publicationColor(raw.color, path + ' → 颜色'),
    background: raw.background === 'transparent' ? 'transparent' : publicationColor(raw.background, path + ' → 底色'),
    align: publicationChoice(raw.align, ['left', 'center', 'right'] as const, path), lineHeight: publicationNumber(raw.lineHeight, 1, 3, path + ' → 行距', false),
    letterSpacing: publicationNumber(raw.letterSpacing, -1, 3, path + ' → 字间距', false), padding: publicationNumber(raw.padding, 0, 10, path + ' → 内边距', false), radius: publicationNumber(raw.radius, 0, 30, path + ' → 圆角', false),
    sticker: publicationChoice(raw.sticker, compositionStickers, path), image, fit: publicationChoice(raw.fit, ['contain', 'cover'] as const, path), autoShrink: bool(raw.autoShrink, path),
  };
  if (![400, 700].includes(result.fontWeight)) return failPublication(path, '字重只能选择常规或加粗。');
  if (raw.localOnly !== undefined) result.localOnly = bool(raw.localOnly, path);
  if (Object.hasOwn(raw, 'fontAssetId')) {
    if (typeof raw.fontAssetId !== 'string' || raw.fontAssetId !== '' && !/^[a-f0-9]{64}$/.test(raw.fontAssetId)) return failPublication(path, '所选字体标识无效。');
    result.fontAssetId = raw.fontAssetId;
  }
  return result;
}
export function parseComposition(value: unknown): PublicationComposition {
  const raw = publicationObject(value, ['version', 'subject', 'layers'], context);
  if (raw.version !== 1) return failPublication(context, '画布版本不支持，请更新 MeWiki。');
  if (!Array.isArray(raw.layers) || raw.layers.length > COMPOSITION_MAX_LAYERS) return failPublication(context, '每个画布最多 40 个图层。');
  const ids = new Set<string>();
  const layers = raw.layers.map((value, index) => { const layer = parseLayer(value, index); if (ids.has(layer.id)) return failPublication(context, '图层标识重复。'); ids.add(layer.id); return layer; });
  if (layers.reduce((n, layer) => n + layer.image.length, 0) > 8 * 1024 * 1024) return failPublication(context, '装饰图片合计超过 8 MiB，请减少或缩小图片。');
  const result: PublicationComposition = { version: 1, subject: subject(raw.subject), layers };
  if (compositionFontIds(result).length > 8) return failPublication(context, '每个画布最多使用 8 种资料库字体。');
  return result;
}
export function parseCompositionOverrides(scene: PublicationComposition, value: unknown): CompositionOverrides {
  const raw = publicationObject(value, ['layers', 'subject'], context + ' → 单图调整');
  const result: CompositionOverrides = {};
  if (raw.subject !== undefined) { const patch = publicationObject(raw.subject, Object.keys(scene.subject), context); const merged = subject({ ...scene.subject, ...patch }); result.subject = Object.fromEntries(Object.keys(patch).map(key => [key, merged[key as keyof CompositionSubject]])); }
  if (raw.layers !== undefined) {
    const patches = publicationObject(raw.layers, scene.layers.map(layer => layer.id), context + ' → 图层');
    result.layers = {};
    for (const [id, value] of Object.entries(patches)) {
      const layer = scene.layers.find(layer => layer.id === id)!;
      const patch = publicationObject(value, Object.keys(layer).filter(key => !['id', 'type', 'localOnly'].includes(key)).concat('fontAssetId'), context + ' → 图层');
      const checked = parseLayer({ ...layer, ...patch }, scene.layers.indexOf(layer));
      result.layers[id] = Object.fromEntries(Object.keys(patch).map(key => [key, checked[key as keyof CompositionLayer]]));
    }
  }
  return result;
}
export function resolveComposition(scene: PublicationComposition, value?: unknown): PublicationComposition {
  if (!value) return scene;
  const patch = parseCompositionOverrides(scene, value);
  return parseComposition({ ...scene, subject: { ...scene.subject, ...patch.subject }, layers: scene.layers.map(layer => ({ ...layer, ...patch.layers?.[layer.id] })) });
}
export function parseCompositionImageData(value: unknown, scene?: PublicationComposition): PublicationImageData {
  const raw = publicationObject(value, ['title', 'subtitle', 'name', 'index', 'total', 'overrides'], context + ' → 图片信息');
  const result: PublicationImageData = { title: publicationText(raw.title, 1000, context), subtitle: publicationText(raw.subtitle, 1000, context), name: publicationText(raw.name, 500, context), index: publicationNumber(raw.index, 1, 50, context), total: publicationNumber(raw.total, 1, 50, context) };
  if (result.index > result.total) return failPublication(context, '图片序号不能大于总张数。');
  if (raw.overrides !== undefined) { if (!scene) return failPublication(context, '单图调整缺少共用画布。'); result.overrides = parseCompositionOverrides(scene, raw.overrides); }
  return result;
}
export const compositionFontIds = (scene?: PublicationComposition) => [...new Set(scene?.layers.filter(layer => layer.type === 'text' && layer.fontAssetId).map(layer => layer.fontAssetId!) ?? [])];
export const sharedComposition = (scene: PublicationComposition): PublicationComposition => ({ ...scene, layers: scene.layers.filter(layer => !layer.localOnly) });
export const compositionLayerRect = (layer: Pick<CompositionLayer, 'x' | 'y' | 'width' | 'height'>, width: number, height: number) => ({ left: layer.x * width / 100, top: layer.y * height / 100, width: layer.width * width / 100, height: layer.height * height / 100 });
export const escapeComposition = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function compositionText(text: string, data: PublicationImageData) {
  return text.replace(/\{\{(title|subtitle|name|index|total)\}\}/g, (_, key: keyof PublicationImageData) => String(data[key] ?? ''));
}
export function compositionStickerMarkup(kind: CompositionSticker, color: string): string {
  const shapes: Record<CompositionSticker, string> = {
    arrow: '<path d="M8 55H66V33L94 64 66 94V73H8Z"/>', circle: '<circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="6"/>',
    badge: '<rect x="3" y="20" width="94" height="60" rx="8"/>', bubble: '<path d="M8 10H92V72H40L17 94V72H8Z"/>',
    star: '<path d="m50 4 14 28 31 5-22 22 5 32-28-15-28 15 5-32L5 37l31-5Z"/>', number: '<circle cx="50" cy="50" r="46"/>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" style="color:${color};fill:currentColor" aria-hidden="true">${shapes[kind]}</svg>`;
}
export function compositionLayerMarkup(layer: CompositionLayer, width: number, height: number, data: PublicationImageData, index?: number): string {
  if (layer.hidden) return '';
  const r = compositionLayerRect(layer, width, height), unit = Math.min(width, height) / 100;
  const family = layer.fontAssetId ? `'${publicationFontFamily(layer.fontAssetId)}'` : layer.fontFamily === 'serif' ? "'MeWiki Serif','Noto Serif SC Variable',serif" : "'MeWiki Sans','Noto Sans SC Variable',sans-serif";
  const style = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;transform:rotate(${layer.rotation}deg);opacity:${layer.opacity / 100};color:${layer.color};background:${layer.background};padding:${layer.padding * unit}px;border-radius:${layer.radius * unit}px;font-family:${family};font-size:${layer.fontSize * unit}px;font-weight:${layer.fontWeight};line-height:${layer.lineHeight};letter-spacing:${layer.letterSpacing * unit}px;text-align:${layer.align}`;
  const text = escapeComposition(compositionText(layer.text, data));
  const content = layer.type === 'text' ? `<div class="composition-text" data-auto-shrink="${layer.autoShrink}" data-min-font="${layer.fontSize * unit * .5}">${text}</div>` : layer.type === 'image' ? `<img alt="" src="${layer.image}" style="object-fit:${layer.fit}">` : `${compositionStickerMarkup(layer.sticker, layer.color)}${text ? `<span class="composition-sticker-label">${text}</span>` : ''}`;
  return `<div class="composition-layer" data-composition-layer="${layer.id}"${index === undefined ? '' : ` data-composition-index="${index}"`} data-layer-type="${layer.type}" style="${style}">${content}</div>`;
}
export const compositionCss = `.composition-layer{position:absolute;box-sizing:border-box;transform-origin:center;overflow:visible;font-synthesis:weight}.composition-text{width:100%;height:100%;white-space:pre-wrap;overflow-wrap:anywhere}.composition-layer>img{display:block;width:100%;height:100%}.composition-layer>svg{display:block}.composition-sticker-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;color:#fff;overflow-wrap:anywhere}.composition-layers{position:absolute;inset:0;pointer-events:none;z-index:2}.composition-subject{position:absolute;inset:0;transform-origin:center}`;
