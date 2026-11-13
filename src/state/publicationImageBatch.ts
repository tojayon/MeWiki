import { parsePublicationOptions, publicationImage, PUBLICATION_MAX_BODY, PUBLICATION_MAX_REQUEST_BYTES, PUBLICATION_MAX_IMAGE_COUNT, PUBLICATION_MAX_BATCH_PIXELS, PUBLICATION_MAX_RESULT_BYTES, type PublicationBlock, type PublicationImageCrop, type PublicationOptions, type PublicationResult } from '../domain/publicationTypes.ts';
import { compositionFontIds, resolveComposition, type PublicationImageData } from '../domain/publicationComposition.ts';
import type { PublicationFont } from '../domain/researchFonts.ts';
import { failPublication, publicationContext, publicationFields } from '../domain/publicationValidation.ts';
import { generatePublication } from './publicationClient.ts';

export interface PublicationImageInput { id: string; name: string; crop?: PublicationImageCrop; imageData?: PublicationImageData; load: (signal: AbortSignal) => Promise<string> }
interface BatchDependencies { generate?: typeof generatePublication; imageBudget?: number; resultBudget?: number; fonts?: PublicationFont[] }

/** Freeze the batch and read only one request group at a time. Never run Edge jobs concurrently. */
export async function generatePublicationImages(inputs: readonly PublicationImageInput[], value: PublicationOptions, signal: AbortSignal, progress: (completed: number, total: number) => void, dependencies: BatchDependencies = {}): Promise<PublicationResult> {
  signal.throwIfAborted();
  const options = parsePublicationOptions(structuredClone(value));
  if (!options.imageMode) return failPublication(publicationFields.imageMode, '请先选择图片导出。');
  if (!inputs.length) return failPublication(publicationFields.imageMode, '请至少选择一张图片。');
  if (inputs.length > PUBLICATION_MAX_IMAGE_COUNT) return failPublication(publicationFields.imageMode, '每批最多选择 50 张图片，请减少选择或分次导出。');
  if (options.width * options.height * inputs.length > PUBLICATION_MAX_BATCH_PIXELS) return failPublication(publicationFields.imageMode, '本批图片合计超过 8000 万像素，请降低清晰度或减少图片张数。');
  const items = inputs.map(item => ({ ...item, crop: item.crop ? { ...item.crop } : undefined, ...(item.imageData ? { imageData: structuredClone(item.imageData) } : {}) }));
  const fonts = dependencies.fonts?.map(font => ({ ...font }));
  const generate = dependencies.generate ?? generatePublication;
  const commonBytes = new TextEncoder().encode(JSON.stringify({ options, fonts })).length;
  const budget = dependencies.imageBudget ?? Math.min(Math.floor(PUBLICATION_MAX_BODY * .75), PUBLICATION_MAX_REQUEST_BYTES - commonBytes - 1024);
  const result: PublicationResult = { pages: [], format: options.format };
  let group: PublicationBlock[] = [], length = 0, outputBytes = 0;
  progress(0, items.length);
  const flush = async () => {
    if (!group.length) return;
    signal.throwIfAborted();
    const offset = result.pages.length;
    let rendered: PublicationResult;
    try {
      const required = options.composition ? new Set(group.flatMap(block => compositionFontIds(resolveComposition(options.composition!, block.imageData?.overrides)))) : new Set<string>();
      const groupFonts = (fonts ?? []).filter(font => required.has(font.id));
      if (required.size !== groupFonts.length) return failPublication('图片创作 → 字体', '所选字体尚未加载，请稍后重试或重新导入字体。');
      rendered = await generate({ document: { title: '', text: '', blocks: group }, options, ...(groupFonts.length ? { fonts: groupFonts } : {}) }, signal, completed => progress(offset + Math.min(group.length, completed), items.length));
    } catch (cause) {
      signal.throwIfAborted();
      const message = cause instanceof Error ? cause.message : '图文导出失败，请重试。';
      throw new Error(message.replace(/导出内容 → 第 (\d+) 项/, (_, number: string) => `导出内容 → 第 ${offset + Number(number)} 项`));
    }
    signal.throwIfAborted();
    if (rendered.pages.length !== group.length || rendered.format !== options.format || rendered.pages.some(page => page.width !== options.width || page.height !== options.height)) return failPublication(publicationFields.imageMode, '批量导出结果不完整，请重新生成。');
    for (const page of rendered.pages) outputBytes += Math.floor((page.dataUrl.length - page.dataUrl.indexOf(',') - 1) * .75);
    if (outputBytes > (dependencies.resultBudget ?? PUBLICATION_MAX_RESULT_BYTES)) return failPublication(publicationFields.imageMode, '导出图片总量超过 32 MiB，请降低清晰度、减少图片或使用 JPEG。');
    result.pages.push(...rendered.pages);
    progress(result.pages.length, items.length);
    group = []; length = 0;
  };
  for (const [index, item] of items.entries()) {
    signal.throwIfAborted();
    const context = publicationContext(publicationFields.imageMode, `第 ${index + 1} 项`);
    let content: string;
    try { content = publicationImage(await item.load(signal), false, context); }
    catch (cause) {
      signal.throwIfAborted();
      const message = cause instanceof Error ? cause.message : '图片读取失败，请重新选择本地图片。';
      return failPublication(context, message.startsWith(context + '：') ? message.slice(context.length + 1) : message);
    }
    signal.throwIfAborted();
    const itemLength = content.length + (item.imageData ? new TextEncoder().encode(JSON.stringify(item.imageData)).length + 100 : 0);
    if (itemLength > budget) return failPublication(context, '单张图片数据超过本组预算，请缩小原图。');
    if (group.length && length + itemLength > budget) await flush();
    signal.throwIfAborted();
    group.push({ id: item.id, kind: 'image', content, ...(item.crop ? { crop: item.crop } : {}), ...(item.imageData ? { imageData: item.imageData } : {}) }); length += itemLength;
  }
  await flush(); signal.throwIfAborted();
  return result;
}
