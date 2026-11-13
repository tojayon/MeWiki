import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { publicationImage, type PublicationRequest } from '../src/domain/publicationTypes.ts';
import { publicationMarkup, publicationFontOrigin } from '../src/domain/publicationMarkup.ts';
import { failPublication, publicationFields } from '../src/domain/publicationValidation.ts';
export { publicationFontOrigin, escapePublicationText } from '../src/domain/publicationMarkup.ts';

export async function validatePublicationImage(image: string): Promise<void> {
  publicationImage(image, false);
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  if (bytes.length > 9 * 1024 * 1024) throw new Error('导出图片最大 9 MiB，请先缩小图片。');
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
    if (!['png', 'jpeg'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || metadata.width * metadata.height > 24_000_000) throw new Error();
  } catch { throw new Error('导出图片必须是有效的静态 PNG 或 JPEG，最多 2400 万像素。'); }
}

export async function publicationFonts(root = process.cwd()) {
  const assets = new Map<string, string>();
  const css = await Promise.all([
    ['sans', '@fontsource-variable/noto-sans-sc/index.css'],
    ['serif', '@fontsource-variable/noto-serif-sc/index.css'],
    ['math', 'katex/dist/katex.min.css'],
    ['syntax', 'highlight.js/styles/github-dark.css'],
  ].map(async ([namespace, relative]) => {
    const filename = path.join(root, 'node_modules', relative);
    return (await readFile(filename, 'utf8')).replace(/url\(([^)]+)\)/g, (_, raw: string) => {
      const relative = raw.replace(/^['"]|['"]$/g, '');
      const absolute = path.resolve(path.dirname(filename), relative);
      const url = `${publicationFontOrigin}/${namespace}/${path.basename(absolute)}`;
      assets.set(url, absolute);
      return `url("${url}")`;
    });
  }));
  return { css: css.join('\n'), assets };
}


export async function publicationHtml(input: PublicationRequest, fontCss = '', pageCss = ''): Promise<string> {
  const { html, images, imageContexts } = await publicationMarkup(input, fontCss, pageCss);
  await Promise.all(images.map(async image => {
    try { await validatePublicationImage(image); }
    catch (cause) { failPublication(imageContexts.get(image) ?? publicationFields.image, cause instanceof Error ? cause.message : '内容无法读取，请重新生成预览。'); }
  }));
  return html;
}
