import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import { parsePublicationRequest, type PublicationRequest, type PublicationResult } from '../src/domain/publicationTypes.ts';
import { publicationFontOrigin, publicationFonts, publicationHtml } from './publicationHtml.ts';
import { publicationPagination } from './publicationPagination.ts';
import { publicationStyles } from './publicationStyles.ts';
import { PublicationContentError, readPublicationDiagnostics } from '../src/domain/publicationDiagnostics.ts';

export interface PublicationProgress { completed: number; total: number }
export async function renderPublication(input: PublicationRequest, signal?: AbortSignal, onProgress?: (progress: PublicationProgress) => void, root = process.cwd(), outDir = 'dist'): Promise<PublicationResult> {
  const request = parsePublicationRequest(input);
  const active = signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
  active.throwIfAborted();
  let browser: Browser | undefined;
  const cancel = () => { void browser?.close().catch(() => {}); };
  active.addEventListener('abort', cancel, { once: true });
  try {
    const fonts = request.options.imageMode && !request.options.composition?.layers.some(layer => layer.type === 'text') ? { css: '', assets: new Map<string, string>() } : await publicationFonts(root);
    const css = request.document.blocks.some(block => block.kind === 'native') ? await publicationStyles(root, outDir) : '';
    const html = await publicationHtml(request, fonts.css, css);
    active.throwIfAborted();
    try { browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 }); }
    catch { throw new Error('图片导出需要本机 Microsoft Edge，请安装后重试。'); }
    active.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: request.options.width, height: Math.min(request.options.height, 1440) }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'zh-CN' });
    await context.route('**/*', async route => {
      const url = route.request().url();
      const font = fonts.assets.get(url);
      if (font && url.startsWith(publicationFontOrigin + '/') && route.request().resourceType() === 'font') {
        try { await route.fulfill({ status: 200, contentType: font.endsWith('.woff2') ? 'font/woff2' : font.endsWith('.woff') ? 'font/woff' : 'font/ttf', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(font) }); }
        catch { await route.abort('failed').catch(() => {}); }
      } else await route.abort('blockedbyclient').catch(() => {});
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    active.throwIfAborted();
    // Error properties are not preserved by Playwright's thrown-error transport.
    // Serialize known diagnostics explicitly, keeping other failures on the usual path.
    const layout = await page.evaluate(`(async () => {
      try { return { sizes: await ${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })}) }; }
      catch (cause) { if (Array.isArray(cause?.diagnostics)) return { error: cause.message, diagnostics: cause.diagnostics }; throw cause; }
    })()`) as { sizes: { width: number; height: number }[] } | { error: string; diagnostics: unknown };
    if ('error' in layout) throw new PublicationContentError(layout.error, readPublicationDiagnostics(layout.diagnostics, new Set(request.document.blocks.map(block => block.id))));
    const { sizes } = layout;
    if (!Array.isArray(sizes) || !sizes.length || sizes.length > 50) throw new Error('导出分页结果无效，请调整内容后重试。');
    const result: PublicationResult = { format: request.options.format, pages: [] }; let bytes = 0;
    onProgress?.({ completed: 0, total: sizes.length });
    for (const [index, size] of sizes.entries()) {
      active.throwIfAborted();
      const image = await page.locator('.publication-page').nth(index).screenshot({ type: request.options.format, ...(request.options.format === 'jpeg' ? { quality: request.options.quality } : {}), animations: 'disabled', timeout: 30000 });
      bytes += image.length;
      if (bytes > 32 * 1024 * 1024) throw new Error('导出图片总量超过 32 MiB，请减少内容或使用 JPEG。');
      result.pages.push({ dataUrl: `data:image/${request.options.format};base64,${image.toString('base64')}`, ...size });
      onProgress?.({ completed: index + 1, total: sizes.length });
    }
    active.throwIfAborted(); return result;
  } catch (cause) {
    if (active.aborted) throw new Error(signal?.aborted ? '图片导出已取消。' : '图片导出超过 90 秒，请减少内容后重试。');
    if (cause instanceof Error && cause.message.startsWith('page.evaluate:')) throw new Error(cause.message.replace(/^page\.evaluate:\s*(?:Error:\s*)?/, '').split('\n')[0]);
    throw cause;
  } finally {
    active.removeEventListener('abort', cancel);
    await browser?.close().catch(() => {});
  }
}
