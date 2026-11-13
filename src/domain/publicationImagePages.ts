import { defaultPublicationImageCrop, type PublicationDocument, type PublicationOptions } from './publicationTypes.ts';
import { publicationFrameCss, publicationFrameMarkup } from './publicationFrames.ts';
import { publicationTextureCss, publicationTextureLayers, publicationTextureMarkup } from './publicationTextures.ts';
import { publicationContext, publicationFields } from './publicationValidation.ts';
import { compositionCss, compositionLayerMarkup, resolveComposition } from './publicationComposition.ts';
import { publicationFrameLayout } from './publicationFrames.ts';

/** Static and script-free. Preview and final export use the same device and image geometry. */
export function publicationImagePages(document: PublicationDocument, options: PublicationOptions, fontCss = '') {
  const layers = publicationTextureLayers(options);
  const fit = options.imageMode!.fit;
  const pages = document.blocks.map((block, index) => {
    const crop = fit === 'cover' ? block.crop ?? defaultPublicationImageCrop() : defaultPublicationImageCrop();
    const image = `<div class="publication-image-body"><img alt="" draggable="false" src="${block.content}" style="object-fit:${fit};object-position:${crop.x}% ${crop.y}%;transform:scale(${crop.zoom / 100});transform-origin:${crop.x}% ${crop.y}%"></div>`;
    const scene = options.composition ? resolveComposition(options.composition, block.imageData?.overrides) : undefined;
    const data = block.imageData ?? { title: '', subtitle: '', name: '', index: index + 1, total: document.blocks.length };
    const screen = publicationFrameLayout(options);
    const screenMarkup = scene?.layers.filter(layer => layer.space === 'screen').map(layer => compositionLayerMarkup(layer, screen?.width ?? options.width, screen?.height ?? options.height, data, scene.layers.indexOf(layer))).join('') ?? '';
    const content = publicationTextureMarkup(layers, true) + image + `<div class="composition-layers">${screenMarkup}</div>`;
    const subject = publicationFrameMarkup(options, content) || content;
    if (!scene) return `<article class="publication-page" data-image-index="${index}">${subject}</article>`;
    const s = scene.subject;
    const foreground = scene.layers.filter(layer => layer.space === 'canvas').map(layer => compositionLayerMarkup(layer, options.width, options.height, data, scene.layers.indexOf(layer))).join('');
    return `<article class="publication-page" data-image-index="${data.index - 1}"><div class="composition-subject" style="transform:translate(${(s.x - 50) * options.width / 100}px,${(s.y - 50) * options.height / 100}px) rotate(${s.rotation}deg) scale(${s.scale / 100});${s.hidden ? 'visibility:hidden' : ''}">${subject}</div><div class="composition-layers">${foreground}</div></article>`;
  }).join('');
  const images = new Set(document.blocks.map(block => block.content));
  const imageContexts = new Map<string, string>();
  document.blocks.forEach((block, index) => { if (!imageContexts.has(block.content)) imageContexts.set(block.content, publicationContext(publicationFields.document, `第 ${index + 1} 项`, publicationFields.image)); });
  layers.forEach((layer, index) => {
    if (!layer.image) return;
    images.add(layer.image);
    if (!imageContexts.has(layer.image)) imageContexts.set(layer.image, publicationContext(publicationFields.texture, `第 ${index + 1} 层`, publicationFields.textureImage));
  });
  if (options.composition) document.blocks.forEach((block, index) => resolveComposition(options.composition!, block.imageData?.overrides).layers.forEach((layer, layerIndex) => {
    if (layer.type !== 'image' || layer.hidden) return;
    images.add(layer.image);
    if (!imageContexts.has(layer.image)) imageContexts.set(layer.image, `图片创作 → 第 ${block.imageData?.index ?? index + 1} 张 → 第 ${layerIndex + 1} 个图层`);
  }));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src https://mewiki-publication.invalid data:; img-src data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>
${fontCss}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:transparent}.publication-page{position:relative;width:${options.width}px;height:${options.height}px;overflow:hidden;background:${options.background}}
.publication-image-body{position:absolute;inset:0;overflow:hidden;z-index:1}.publication-image-body img{display:block;width:100%;height:100%;max-width:none;max-height:none}
${publicationTextureCss(layers, 0)}
${publicationFrameCss(options)}
${compositionCss}
</style></head><body data-publication-images><div id="pages">${pages}</div></body></html>`;
  return { html, images: [...images], imageContexts };
}
