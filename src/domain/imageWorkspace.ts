import { parsePublicationOptions, type PublicationImageCrop, type PublicationOptions } from './publicationTypes.ts';
import { parseCompositionImageData, type PublicationImageData } from './publicationComposition.ts';
import { publicationObject, publicationText, publicationNumber, failPublication } from './publicationValidation.ts';
export interface ImageDesignItem { id: string; name: string; assetId: string; crop?: PublicationImageCrop; imageData?: PublicationImageData }
export interface ImageDesign { id: string; name: string; updatedAt: string; options: PublicationOptions; items: ImageDesignItem[] }
export interface PersonalSticker { id: string; name: string; assetId: string }
export interface ImageWorkspaceCollection { revision: string; designs: ImageDesign[]; stickers: PersonalSticker[] }
const context = '图片创作 → 保存设计';
const identity = (value: unknown) => { const id = publicationText(value, 128, context); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) return failPublication(context, '设计或素材标识无效。'); return id; };
const asset = (value: unknown) => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return failPublication(context, '素材标识无效。'); return value; };
function unique<T extends { id: string }>(items: T[]): T[] { if (new Set(items.map(item => item.id)).size !== items.length) return failPublication(context, '设计或素材标识重复。'); return items; }
export function parseImageDesigns(value: unknown): ImageDesign[] {
  if (!Array.isArray(value) || value.length > 32) return failPublication(context, '每个资料库最多保存 32 份图片设计。');
  return unique(value.map(value => {
    const raw = publicationObject(value, ['id', 'name', 'updatedAt', 'options', 'items'], context);
    const options = parsePublicationOptions(raw.options);
    if (!options.imageMode || !options.composition) return failPublication(context, '保存的设计需要图片创作画布。');
    if (!Array.isArray(raw.items) || raw.items.length > 50) return failPublication(context, '每份设计最多保存 50 张主图。');
    const items = unique(raw.items.map(value => {
      const item = publicationObject(value, ['id', 'name', 'assetId', 'crop', 'imageData'], context);
      const result: ImageDesignItem = { id: identity(item.id), name: publicationText(item.name, 500, context), assetId: asset(item.assetId) };
      if (item.crop !== undefined) { const crop = publicationObject(item.crop, ['x', 'y', 'zoom'], context); result.crop = { x: publicationNumber(crop.x, 0, 100, context), y: publicationNumber(crop.y, 0, 100, context), zoom: publicationNumber(crop.zoom, 100, 300, context) }; }
      if (item.imageData !== undefined) result.imageData = parseCompositionImageData(item.imageData, options.composition);
      return result;
    }));
    const name = publicationText(raw.name, 100, context).trim(), updatedAt = publicationText(raw.updatedAt, 40, context);
    if (!name || !Number.isFinite(Date.parse(updatedAt))) return failPublication(context, '请填写设计名称。');
    return { id: identity(raw.id), name, updatedAt, options, items };
  }));
}
export function parsePersonalStickers(value: unknown): PersonalSticker[] {
  if (!Array.isArray(value) || value.length > 200) return failPublication(context, '每个资料库最多保存 200 张个人贴纸。');
  return unique(value.map(value => { const raw = publicationObject(value, ['id', 'name', 'assetId'], context); return { id: identity(raw.id), name: publicationText(raw.name, 100, context), assetId: asset(raw.assetId) }; }));
}
