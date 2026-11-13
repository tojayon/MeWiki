import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, RootContent } from 'mdast';
import katex from 'katex';
import highlight from 'highlight.js/lib/common';
import { parsePublicationRequest, publicationImage, type PublicationRequest } from './publicationTypes.ts';
import { documentCodeCss, documentCodeTheme, documentContentCss, documentTableHeaderCss, documentTableTheme, documentTheme } from '../styles/documentTheme.ts';
import { parsePublicationDom, type PublicationDomNode } from './publicationDom.ts';
import { publicationFontCss, publicationFontFamily } from './researchFonts.ts';
import { publicationTextureCss, publicationTextureLayers, publicationTextureMarkup } from './publicationTextures.ts';
import { publicationContentSize, publicationFrameCss, publicationFrameMarkup } from './publicationFrames.ts';
import { failPublication, publicationContext as at, publicationFields as fields } from './publicationValidation.ts';
import { publicationImagePages } from './publicationImagePages.ts';

export const publicationFontOrigin = 'https://mewiki-publication.invalid';
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
export const escapePublicationText = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
type MarkdownNode = Root | RootContent | { type: string; value?: string; children?: MarkdownNode[]; url?: string; alt?: string; depth?: number; ordered?: boolean; start?: number; checked?: boolean | null };

function math(value: string, displayMode = false): string {
  try { return katex.renderToString(value, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'html' }); }
  catch { throw new Error('部分公式无法排版，请检查公式后重新导出。'); }
}
async function renderNode(node: MarkdownNode, images: Set<string>, headerCell = false): Promise<string> {
  const value = node as { type: string; value?: string; children?: MarkdownNode[]; url?: string; alt?: string; depth?: number; ordered?: boolean; start?: number; checked?: boolean | null };
  const children = async () => (await Promise.all((value.children ?? []).map(child => renderNode(child, images, headerCell)))).join('');
  const escaped = () => escapePublicationText(value.value ?? '');
  switch (value.type) {
    case 'root': return children();
    case 'text': return escaped();
    case 'html': case 'definition': return '';
    case 'footnoteDefinition': return `<blockquote><strong>[${escapePublicationText(String((node as { identifier?: string }).identifier ?? ''))}]</strong>${await children()}</blockquote>`;
    case 'paragraph': return `<p>${await children()}</p>`;
    case 'heading': return `<h${value.depth}>${await children()}</h${value.depth}>`;
    case 'strong': return `<strong>${await children()}</strong>`;
    case 'emphasis': return `<em>${await children()}</em>`;
    case 'delete': return `<del>${await children()}</del>`;
    case 'inlineCode': return `<code class="document-inline-code">${escaped()}</code>`;
    case 'code': {
      const language = ((node as { lang?: string }).lang ?? '').split(/\s+/)[0];
      if (language && highlight.getLanguage(language)) return `<pre class="document-code"><code class="hljs">${highlight.highlight(value.value ?? '', { language, ignoreIllegals: true }).value}</code></pre>`;
      return `<pre class="document-code"><code>${escaped()}</code></pre>`;
    }
    case 'inlineMath': return math(value.value ?? '');
    case 'math': return `<div class="formula">${math(value.value ?? '', true)}</div>`;
    case 'break': return '<br>';
    case 'thematicBreak': return '<hr>';
    case 'blockquote': return `<blockquote>${await children()}</blockquote>`;
    case 'list': return value.ordered ? `<ol start="${Number.isSafeInteger(value.start) ? value.start : 1}">${await children()}</ol>` : `<ul>${await children()}</ul>`;
    case 'listItem': return `<li>${value.checked === null || value.checked === undefined ? '' : value.checked ? '☑ ' : '☐ '}${await children()}</li>`;
    case 'link': case 'linkReference': return `<span class="document-link">${await children()}</span>`;
    case 'image': {
      const image = value.url ?? '';
      try { publicationImage(image, false); } catch { throw new Error('笔记图片尚未本地化，请保存图片后重新导出。'); }
      images.add(image);
      return `<img src="${image}" alt="${escapePublicationText(value.alt ?? '')}">`;
    }
    case 'imageReference': throw new Error('笔记包含未解析的图片引用，请先转换为本地图片。');
    case 'table': {
      const rows = value.children ?? [];
      return `<table class="document-table"><thead>${rows[0] ? await renderNode(rows[0], images, true) : ''}</thead><tbody>${(await Promise.all(rows.slice(1).map(row => renderNode(row, images, false)))).join('')}</tbody></table>`;
    }
    case 'tableRow': return `<tr>${await children()}</tr>`;
    case 'tableCell': return headerCell ? `<th>${await children()}</th>` : `<td>${await children()}</td>`;
    case 'footnoteReference': return `<sup>${escapePublicationText(String((node as { identifier?: string }).identifier ?? ''))}</sup>`;
    default: return children();
  }
}


export async function publicationMarkup(input: PublicationRequest, fontCss = '', pageCss = ''): Promise<{ html: string; images: string[]; imageContexts: Map<string, string> }> {
  const { document, options: o, font: customFont, fonts: sceneFonts } = parsePublicationRequest(input);
  if (o.imageMode) return publicationImagePages(document, o, fontCss + (sceneFonts ?? []).map(publicationFontCss).join('\n'));
  const native = o.style === 'document';
  const nativeDom = document.blocks.some(block => block.kind === 'native');
  const sheet = publicationContentSize(o);
  const renderDom = (node: PublicationDomNode): string => {
    if (typeof node === 'string') return escapePublicationText(node);
    const attrs = Object.entries(node.attrs ?? {}).map(([name, value]) => ` ${name}="${escapePublicationText(value)}"`).join('');
    const style = Object.entries(node.style ?? {}).map(([name, value]) => `${name}:${value}`).join(';');
    const open = `<${node.tag}${attrs}${style ? ` style="${escapePublicationText(style)}"` : ''}>`;
    return ['img', 'br', 'hr', 'input'].includes(node.tag) ? open : `${open}${node.children.map(renderDom).join('')}</${node.tag}>`;
  };
  // Cache only within this one document; never keep user images in a process cache.
  const images = new Set<string>();
  const imageContexts = new Map<string, string>();
  const blockImages = document.blocks.map(() => new Set<string>());
  const blockContext = (index: number) => at(fields.document, `第 ${index + 1} 项`, fields[document.blocks[index].kind]);
  const blocks = await Promise.all(document.blocks.map(async (block, index) => {
    const images = blockImages[index];
    try {
      let html: string;
      if (block.kind === 'native') {
        const parsed = parsePublicationDom(block.content); parsed.images.forEach(image => images.add(image));
        html = `<div class="publication-dom" style="zoom:${o.fontSize / documentTheme.fontSize};width:${(sheet.width - 2 * o.margin) * documentTheme.fontSize / o.fontSize}px">${renderDom(parsed.tree)}</div>`;
      }
      else if (block.kind === 'markdown') html = await renderNode(parser.parse(block.content), images);
      else if (block.kind === 'formula') html = `<figure class="formula">${math(block.content, true)}${block.caption ? `<figcaption>${escapePublicationText(block.caption)}</figcaption>` : ''}</figure>`;
      else {
        images.add(block.content);
        html = `<figure><img src="${block.content}" alt="${escapePublicationText(block.caption ?? '')}">${block.caption ? `<figcaption>${escapePublicationText(block.caption)}</figcaption>` : ''}</figure>`;
      }
      return `<section class="source-block" data-publication-block="${escapePublicationText(block.id)}" data-break="${block.breakBefore ? 'true' : 'false'}">${html}</section>`;
    } catch (cause) { return failPublication(blockContext(index), cause instanceof Error ? cause.message : '内容无法读取，请重新生成预览。'); }
  }));
  const addImage = (image: string, context: string) => {
    if (!image) return;
    images.add(image); if (!imageContexts.has(image)) imageContexts.set(image, context);
  };
  blockImages.forEach((images, index) => images.forEach(image => addImage(image, blockContext(index))));
  const textureLayers = publicationTextureLayers(o);
  addImage(o.logo, fields.logo); addImage(o.coverImage, fields.coverImage);
  textureLayers.forEach((layer, index) => addImage(layer.image, at(fields.texture, `第 ${index + 1} 层`, fields.textureImage)));
  // Start binary checks only after all markup has been built. A formula/Markdown
  // failure must not leave a previously started image rejection unobserved.

  const fallbackFont = o.fontFamily === 'serif' ? "'Noto Serif SC Variable',serif" : native ? documentTheme.fontFamily : "'Noto Sans SC Variable',sans-serif";
  const font = customFont ? `${publicationFontFamily(customFont.id)},${fallbackFont}` : fallbackFont;
  const nativeVariables = native ? `--mewiki-document-unit:${o.fontSize / documentTheme.fontSize}px;--mewiki-document-font-size:${o.fontSize}px;--mewiki-document-line-height:${o.lineHeight};--mewiki-document-text:${o.textColor};--mewiki-document-heading:${o.headingColor};--mewiki-document-accent:${o.accentColor};--mewiki-document-font-family:${font}` : '';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${publicationFontOrigin} data:; img-src data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>
${fontCss}
${customFont ? publicationFontCss(customFont) : ''}
${native ? documentContentCss : ''}
${nativeDom ? pageCss : ''}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{color:${o.textColor};font-family:${font};font-size:${o.fontSize}px;line-height:${o.lineHeight};font-synthesis:${customFont ? 'weight' : 'none'};overflow-wrap:anywhere;word-break:normal;background:${o.background}}
.publication-page{width:${o.width}px;height:${o.height}px;position:relative;overflow:hidden;background:${o.background};margin:0}
${publicationFrameCss(o)}
${publicationTextureCss(textureLayers, o.margin)}
.page-body{position:absolute;left:${o.margin}px;right:${o.margin}px;top:${o.margin + o.fontSize}px;bottom:${o.margin + o.fontSize}px;display:flow-root}
.page-header,.page-footer{position:absolute;left:${o.margin}px;right:${o.margin}px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:${Math.max(12, o.fontSize * .48)}px;line-height:1.3;color:${o.textColor};overflow-wrap:anywhere}
.page-header{top:${Math.max(8, o.margin / 2)}px}.page-footer{bottom:${Math.max(8, o.margin / 2)}px}.page-header img{width:${o.fontSize}px;height:${o.fontSize}px;object-fit:contain;margin-right:8px}.page-header .identity{display:flex;align-items:center;min-width:0}.page-number{white-space:nowrap}
.page-body>*{max-width:100%}
${native ? '' : `.page-body>*{margin:0 0 .65em}p{margin:0 0 .65em}h1,h2,h3,h4,h5,h6{color:${o.headingColor};line-height:1.28;margin:.15em 0 .5em;overflow-wrap:anywhere}h1{font-size:1.8em}h2{font-size:1.4em}h3{font-size:1.18em}h4,h5,h6{font-size:1em}
strong{color:${o.headingColor}}blockquote{margin:0 0 .65em;padding:.35em .6em;border-left:4px solid ${o.accentColor};background:#f8fafc;color:#45566e}blockquote p:last-child,li p:last-child{margin-bottom:0}
ul,ol{padding-left:1.5em}li{margin:0 0 .25em}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.82em;background:#fff;color:${documentTheme.textColor}}td,th{padding:.35em .45em;border:1px solid ${documentTableTheme.border};vertical-align:top}td{background:#fff}
table :is(strong,b),blockquote :is(strong,b,h1,h2,h3,h4,h5,h6){color:inherit}table .document-link,blockquote .document-link{color:${documentTheme.accentColor};text-decoration:underline;text-underline-offset:.15em}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;border:1px solid ${documentCodeTheme.border};border-radius:4px;padding:.65em .8em;font-size:.75em;line-height:1.65;tab-size:4}code{font-family:Consolas,"Cascadia Code",monospace}.document-inline-code{font-family:${font};font-size:.85em;border-radius:4px;padding:.1em .3em}`}
${nativeDom ? '' : `figure{text-align:center;margin:0 0 .7em}img{display:inline-block;max-width:100%;max-height:${Math.max(80, sheet.height - 2 * o.margin - 5 * o.fontSize)}px;object-fit:contain;vertical-align:middle}figcaption{font-size:.7em;margin-top:.4em;line-height:1.4}`}
${native ? '' : '.katex{font-size:1.05em}hr{border:0;border-top:2px solid ' + o.accentColor + '}'}
.katex-display{margin:.4em 0;overflow:visible}.formula{overflow:visible;max-width:100%}.formula .katex-display>.katex{white-space:nowrap}.cover-body{display:flex;flex-direction:column;justify-content:center;gap:1em}.cover-body h1{font-size:2em}.subtitle{color:${o.accentColor};font-size:1.12em}.cover-body img{max-height:45%}
${native ? `.publication-native .document-table{width:100%;max-width:100%;min-width:0;table-layout:fixed;border:calc(var(--mewiki-document-unit)*1) solid ${documentTableTheme.border}}.publication-native .document-code{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.publication-native .formula .katex-display{overflow:visible}.publication-native figure img{margin-inline:auto}.publication-native .page-body>h1{overflow-wrap:anywhere}` : ''}
#source{position:absolute;left:-100000px;top:0;width:${sheet.width - 2 * o.margin}px}#pages{width:${o.width}px}
.publication-dom{font-size:15px;line-height:${o.lineHeight};font-family:${font};color:${o.textColor};--mewiki-document-unit:1px;--mewiki-document-font-size:15px;--mewiki-document-line-height:${o.lineHeight};--mewiki-document-font-family:${font};min-width:0;max-width:none!important}.publication-dom .research-note-block{max-width:100%}.publication-dom .research-pdf-sheet img{display:block;max-width:100%}.publication-dom .research-pdf-viewport{max-height:none;overflow:visible}.publication-dom img{max-width:100%}.publication-dom *{animation:none!important;transition:none!important}.has-native-content .document-title{font-size:${o.fontSize * 20 / 15}px;line-height:1.4;font-weight:800;font-synthesis:weight;text-align:center;color:#172033}.has-native-content .page-body>.publication-dom{max-width:none}
${documentCodeCss}
${documentTableHeaderCss}
</style></head><body${native ? ` class="publication-native${nativeDom ? ' has-native-content' : ''}" style="${escapePublicationText(nativeVariables)}"` : ''}><div id="font-probe" style="position:absolute;left:-100000px;top:0">${escapePublicationText([document.title, o.subtitle, o.author, o.header, o.footer, o.date].join(' '))}</div><div id="source"${native && !nativeDom ? ' class="research-markdown"' : ''}>${blocks.join('')}</div>${publicationTextureMarkup(textureLayers)}${publicationFrameMarkup(o)}<div id="pages"></div></body></html>`;
  return { html, images: [...images], imageContexts };
}
