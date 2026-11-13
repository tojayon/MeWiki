import { parsePublicationDom } from './publicationDom.ts';
import type { PublicationContentDiagnostic } from './publicationDiagnostics.ts';
import { parsePublicationFont, type PublicationFont } from './researchFonts.ts';
import { parseComposition, parseCompositionImageData, compositionFontIds, resolveComposition, type PublicationComposition, type PublicationImageData } from './publicationComposition.ts';
import { defaultPublicationTexture, publicationTexturePresets, PUBLICATION_MAX_TEXTURE_LAYERS, type PublicationTexture } from './publicationTextures.ts';
import { parsePublicationFrame, publicationContentSize, publicationPageInsets, type PublicationFrame } from './publicationFrames.ts';
import { publicationFields as fields, publicationContext as at, failPublication as fail, publicationObject as object, publicationText as text, publicationNumber as number, publicationChoice as choice, publicationColor as color, withPublicationContext } from './publicationValidation.ts';
/** Static publication data. No library paths, application state or executable markup. */
export interface PublicationImageCrop { x: number; y: number; zoom: number }
export const defaultPublicationImageCrop = (): PublicationImageCrop => ({ x: 50, y: 50, zoom: 100 });
export interface PublicationBlock {
  id: string;
  sourceId?: string;
  kind: 'markdown' | 'formula' | 'image' | 'native';
  content: string;
  caption?: string;
  breakBefore?: boolean;
  crop?: PublicationImageCrop;
  imageData?: PublicationImageData;
}
export interface PublicationDocument { title: string; text: string; blocks: PublicationBlock[] }
export interface PublicationOptions {
  width: number; height: number; margin: number;
  fontSize: number; lineHeight: number; fontFamily: 'sans' | 'serif';
  background: string; textColor: string; headingColor: string; accentColor: string;
  subtitle: string; author: string; header: string; footer: string; date: string;
  showPageNumbers: boolean; cover: boolean;
  logo: string; coverImage: string;
  mode: 'pages' | 'long'; format: 'png' | 'jpeg'; quality: number;
  style?: 'document';
  texture?: PublicationTexture;
  textureLayers?: PublicationTexture[];
  fontAssetId?: string;
  frame?: PublicationFrame;
  imageMode?: { fit: 'contain' | 'cover' };
  composition?: PublicationComposition;
}
export interface PublicationRequest { document: PublicationDocument; options: PublicationOptions; font?: PublicationFont; fonts?: PublicationFont[] }
export interface PublicationPage { dataUrl: string; width: number; height: number }
export interface PublicationResult { pages: PublicationPage[]; format: 'png' | 'jpeg' }
export interface PublicationJob { id: string; status: 'running' | 'complete' | 'error'; completed: number; total: number; error?: string; diagnostics?: PublicationContentDiagnostic[]; result?: PublicationResult }
export const PUBLICATION_MAX_PIXELS = 16_000_000;
export const PUBLICATION_MAX_IMAGE_COUNT = 50;
export const PUBLICATION_MAX_BATCH_PIXELS = 80_000_000;
export const PUBLICATION_MAX_RESULT_BYTES = 32 * 1024 * 1024;
export const PUBLICATION_MAX_BODY = 32 * 1024 * 1024;
// The document body remains capped at PUBLICATION_MAX_BODY; this request budget
// also accounts for a 100 MiB font encoded as Base64 plus JSON overhead.
export const PUBLICATION_MAX_REQUEST_BYTES = 160 * 1024 * 1024;
export function defaultPublicationOptions(): PublicationOptions {
  return { width: 1080, height: 1440, margin: 72, fontSize: 32, lineHeight: 1.7, fontFamily: 'sans', background: '#ffffff', textColor: '#20252b', headingColor: '#162d50', accentColor: '#245fa5', subtitle: '', author: '', header: '', footer: '', date: '', showPageNumbers: true, cover: false, logo: '', coverImage: '', mode: 'pages', format: 'png', quality: 90 };
}
export function publicationImage(value: unknown, allowEmpty = true, context: string = fields.image): string {
  const image = text(value, 12 * 1024 * 1024, context);
  if (allowEmpty && image === '') return image;
  if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return fail(context, '需要已载入的 PNG 或 JPEG 图片，请重新导入图片；笔记中的网络图片请先保存为本地附件。');
  return image;
}
export function parsePublicationOptions(value: unknown): PublicationOptions {
  const raw = object(value, [...Object.keys(defaultPublicationOptions()), 'style', 'texture', 'textureLayers', 'fontAssetId', 'frame', 'imageMode', 'composition'], fields.options);
  const imageMode = Object.hasOwn(raw, 'imageMode') ? { fit: choice(object(raw.imageMode, ['fit'], fields.imageMode).fit, ['contain', 'cover'] as const, fields.imageFit) } : undefined;
  // Pictures have no notebook typography, headers or author assets. Normalize
  // hidden settings without changing the caller's notebook configuration.
  const options: Record<string, unknown> = imageMode ? { ...defaultPublicationOptions(), width: raw.width, height: raw.height, quality: raw.quality, format: raw.format, background: raw.background, ...Object.fromEntries(['style', 'frame', 'texture', 'textureLayers'].filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]])) } : raw;
  const result = {} as PublicationOptions;
  if (imageMode) result.imageMode = imageMode;
  if (Object.hasOwn(raw, 'composition')) {
    if (!imageMode) return fail('图片创作 → 画布', '画布图层仅适用于图片创作模式。');
    result.composition = parseComposition(raw.composition);
  }
  result.width = number(options.width, 480, 2160, fields.width); result.height = number(options.height, 480, 12000, options.mode === 'long' ? fields.longHeight : fields.height);
  result.margin = number(options.margin, 16, 200, fields.margin); result.fontSize = number(options.fontSize, 16, 80, fields.fontSize);
  result.lineHeight = number(options.lineHeight, 1.2, 2.4, fields.lineHeight, false);
  result.quality = number(options.quality, 40, 100, fields.quality);
  if (result.width * result.height > PUBLICATION_MAX_PIXELS) return fail(fields.pixels, `当前尺寸为 ${result.width} × ${result.height}，超过单张 1600 万像素上限。请降低清晰度或减小尺寸。`);
  if (!imageMode && result.width - result.margin * 2 < result.fontSize * 5) return fail(fields.bodyWidth, `当前宽度 ${result.width}、页面留白 ${result.margin}、字号 ${result.fontSize}，留给正文的宽度不足。请减小页面留白或字号，或增大输出宽度。`);
  if (!imageMode && result.height - result.margin * 2 < result.fontSize * result.lineHeight * 4) return fail(fields.bodyHeight, `当前高度 ${result.height}、页面留白 ${result.margin}、字号 ${result.fontSize}、行距 ${result.lineHeight}，留给正文的高度不足。请减小页面留白、字号或行距，或增大输出高度。`);
  for (const key of ['background', 'textColor', 'headingColor', 'accentColor'] as const) result[key] = color(options[key], fields[key]);
  for (const key of ['subtitle', 'author', 'header', 'footer', 'date'] as const) result[key] = text(options[key], key === 'subtitle' ? 1000 : 200, fields[key]);
  for (const key of ['cover', 'showPageNumbers'] as const) { if (typeof options[key] !== 'boolean') return fail(fields[key], '开关值无效，请重新选择或恢复模板样式。'); result[key] = options[key]; }
  result.fontFamily = choice(options.fontFamily, ['sans', 'serif'], fields.fontFamily);
  result.mode = choice(options.mode, ['pages', 'long'], fields.mode); result.format = choice(options.format, ['png', 'jpeg'], fields.format);
  result.logo = publicationImage(options.logo, true, fields.logo); result.coverImage = publicationImage(options.coverImage, true, fields.coverImage);
  if (Object.hasOwn(options, 'frame')) {
    result.frame = parsePublicationFrame(options.frame);
    const screen = publicationContentSize(result);
    if (!imageMode && (screen.width - 2 * result.margin < result.fontSize * 5 || screen.height - 2 * publicationPageInsets(result).body < result.fontSize * result.lineHeight * 2)) return fail(fields.frame, '设备屏幕的正文空间不足，请缩小字号、页面留白或内容缩放。');
  }
  if (Object.hasOwn(options, 'style')) { result.style = choice(options.style, ['document'] as const, fields.style); }
  if (Object.hasOwn(options, 'fontAssetId')) {
    if (typeof options.fontAssetId !== 'string' || !/^[a-f0-9]{64}$/.test(options.fontAssetId)) return fail(fields.fontFamily, '所选字体标识无效，请重新选择字体。');
    result.fontAssetId = options.fontAssetId;
  }
  const parseTexture = (value: unknown, index: number): PublicationTexture => {
    const context = at(fields.texture, `第 ${index + 1} 层`);
    const texture = object(value, Object.keys(defaultPublicationTexture()), context);
    const kind = choice(texture.kind, ['none', 'custom', ...publicationTexturePresets.map(item => item.id)] as const, at(context, fields.textureKind));
    const textureColor = color(texture.color, at(context, fields.textureColor));
    const imageContext = at(context, fields.textureImage), image = publicationImage(texture.image, true, imageContext);
    if (image.length > 2 * 1024 * 1024) return fail(imageContext, '纹理图片数据超过 2 MiB，请缩小图片后重新制作纹理。');
    if (kind === 'custom' && !image) return fail(imageContext, '自定义纹理缺少图片，请重新制作并应用纹理候选。');
    if (kind !== 'custom' && image) return fail(imageContext, '系统纹理不能附带自定义图片，请重新选择纹理预设。');
    const scope = choice(texture.scope, ['all', 'body', 'cover', 'margins'], at(context, fields.scope));
    return { kind, color: textureColor, image, opacity: number(texture.opacity, 0, 50, at(context, fields.opacity)), scale: number(texture.scale, 50, 200, at(context, fields.textureScale)), seed: number(texture.seed, 0, 4294967295, at(context, fields.seed)), character: choice(texture.character, ['fine', 'natural', 'rough'], at(context, fields.character)), rotation: number(texture.rotation, 0, 180, at(context, fields.rotation)), scope: imageMode ? 'all' : scope, fit: choice(texture.fit, ['tile', 'cover'], at(context, fields.fit)) };
  };
  if (Object.hasOwn(options, 'texture')) {
    if (Object.hasOwn(options, 'textureLayers')) return fail(fields.texture, '模板同时包含两种纹理配置，请恢复模板样式或重新保存模板。');
    result.texture = parseTexture(options.texture, 0);
  }
  if (Object.hasOwn(options, 'textureLayers')) {
    if (!Array.isArray(options.textureLayers)) return fail(fields.texture, '纹理图层列表无效，请恢复模板样式。');
    if (options.textureLayers.length > PUBLICATION_MAX_TEXTURE_LAYERS) return fail(fields.texture, `当前有 ${options.textureLayers.length} 层，最多允许 ${PUBLICATION_MAX_TEXTURE_LAYERS} 层。请移除部分纹理图层。`);
    result.textureLayers = options.textureLayers.map(parseTexture);
    if (result.textureLayers.reduce((sum, layer) => sum + layer.image.length, 0) > 8 * 1024 * 1024) return fail(fields.texture, '纹理图片数据合计超过 8 MiB，请减少图层或缩小纹理图片。');
  }
  return result;
}
export function parsePublicationRequest(value: unknown): PublicationRequest {
  const request = object(value, ['document', 'options', 'font', 'fonts'], fields.request);
  const options = parsePublicationOptions(request.options);
  const font = Object.hasOwn(request, 'font') ? withPublicationContext(fields.fontFamily, () => parsePublicationFont(request.font)) : undefined;
  if (options.fontAssetId !== font?.id) return fail(fields.fontFamily, '所选字体缺失或不匹配，请在当前资料库中重新导入字体。');
  let fonts: PublicationFont[] | undefined;
  if (Object.hasOwn(request, 'fonts')) {
    if (!options.composition || !Array.isArray(request.fonts) || request.fonts.length > 8) return fail('图片创作 → 字体', '画布字体资源无效。');
    fonts = request.fonts.map(value => parsePublicationFont(value));
    if (new Set(fonts.map(value => value.id)).size !== fonts.length) return fail('图片创作 → 字体', '画布字体资源重复。');
  }
  const document = object(request.document, ['title', 'text', 'blocks'], fields.document);
  const title = text(document.title, 1000, fields.title); const plain = text(document.text, 200000, fields.plain);
  if (!Array.isArray(document.blocks)) return fail(fields.document, '内容列表无效，请重新打开导出页面。');
  if (!document.blocks.length) return fail(fields.document, '请在“选择内容”中至少勾选一项内容。');
  if (document.blocks.length > 1000) return fail(fields.document, `当前有 ${document.blocks.length} 项导出内容，最多允许 1000 项。请减少选择或分次导出。`);
  if (options.imageMode) {
    if (document.blocks.length > PUBLICATION_MAX_IMAGE_COUNT) return fail(fields.imageMode, '每批最多选择 50 张图片，请减少选择或分次导出。');
    if (options.width * options.height * document.blocks.length > PUBLICATION_MAX_BATCH_PIXELS) return fail(fields.imageMode, '本批图片合计超过 8000 万像素，请降低清晰度或减少图片张数。');
  }
  const ids = new Set<string>(); let length = 0; let textLength = 0;
  const blocks = document.blocks.map((value, index) => {
    const context = at(fields.document, `第 ${index + 1} 项`);
    const block = object(value, ['id', 'sourceId', 'kind', 'content', 'caption', 'breakBefore', 'crop', 'imageData'], context);
    const id = text(block.id, 1000, at(context, fields.id));
    if (!id || ids.has(id)) return fail(at(context, fields.id), '内容标识缺失或重复，请重新打开导出页面后再选择内容。'); ids.add(id);
    const sourceId = block.sourceId === undefined ? undefined : text(block.sourceId, 1000, at(context, fields.id));
    if (sourceId === '') return fail(at(context, fields.id), '内容来源标识无效，请重新打开导出页面。');
    const kind = choice(block.kind, ['markdown', 'formula', 'image', 'native'], at(context, fields.kind));
    if (options.imageMode && kind !== 'image') return fail(context, '图片导出只能包含图片，请重新选择图片。');
    let crop: PublicationImageCrop | undefined;
    if (Object.hasOwn(block, 'crop')) {
      const cropContext = at(context, fields.crop);
      if (!options.imageMode || kind !== 'image') return fail(cropContext, '图片取景仅适用于图片导出。');
      const raw = object(block.crop, ['x', 'y', 'zoom'], cropContext);
      crop = { x: number(raw.x, 0, 100, at(cropContext, fields.cropX)), y: number(raw.y, 0, 100, at(cropContext, fields.cropY)), zoom: number(raw.zoom, 100, 300, at(cropContext, fields.cropZoom)) };
    }
    const contentContext = at(context, fields[kind]);
    const content = kind === 'image' ? publicationImage(block.content, false, contentContext) : text(block.content, kind === 'native' ? Math.floor(PUBLICATION_MAX_BODY * .9) : 200000, contentContext);
    length += content.length; if (length > PUBLICATION_MAX_BODY * 0.9) return fail(context, '选中内容的图片和排版数据合计过大，请减少图片或分次导出。');
    if (kind === 'native') { if (options.style !== 'document') return fail(contentContext, '当前模板不支持原生内容，请重新选择模板并生成预览。'); textLength += withPublicationContext(contentContext, () => parsePublicationDom(content)).textLength; }
    else if (block.kind !== 'image') textLength += content.length;
    if (textLength > 200000) return fail(context, `选中正文累计 ${textLength} 个字符，超过 200000 字符上限。请减少选择或分次导出。`);
    if (block.breakBefore !== undefined && typeof block.breakBefore !== 'boolean') return fail(at(context, fields.breakBefore), '分页标记无效，请重新勾选此前分页。');
    let imageData: PublicationImageData | undefined;
    if (Object.hasOwn(block, 'imageData')) {
      if (!options.imageMode || kind !== 'image') return fail(context, '图片信息仅适用于图片创作。');
      imageData = withPublicationContext(context, () => parseCompositionImageData(block.imageData, options.composition));
    }
    return { id, kind, content, ...(imageData ? { imageData } : {}), ...(sourceId !== undefined ? { sourceId } : {}), ...(crop ? { crop } : {}), ...(block.caption !== undefined ? { caption: text(block.caption, 4000, at(context, fields.caption)) } : {}), ...(block.breakBefore !== undefined ? { breakBefore: block.breakBefore as boolean } : {}) };
  });
  if (options.composition) {
    const required = new Set(blocks.flatMap(block => compositionFontIds(resolveComposition(options.composition!, block.imageData?.overrides))));
    if (required.size > 8 || required.size !== (fonts?.length ?? 0) || (fonts ?? []).some(font => !required.has(font.id))) return fail('图片创作 → 字体', '所选字体缺失或不匹配，请在当前资料库中重新导入字体。');
  }
  return { document: { title, text: plain, blocks }, options, ...(font ? { font } : {}), ...(fonts ? { fonts } : {}) };
}
