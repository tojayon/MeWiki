import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { AI_MATERIAL_MAX_TEXT, type AiMaterialSection } from './materials.ts';
import type { AiMaterialImportOptions } from './materialImport.ts';

GlobalWorkerOptions.workerSrc = workerUrl;
export async function parseAiPdf(buffer: ArrayBuffer, options: AiMaterialImportOptions): Promise<AiMaterialSection[]> {
  options.signal?.throwIfAborted();
  const resources = new URL(import.meta.env.BASE_URL + 'pdfjs/', window.location.origin).href;
  const task = getDocument({ data: new Uint8Array(buffer), enableXfa: false, cMapUrl: resources + 'cmaps/', cMapPacked: true, standardFontDataUrl: resources + 'standard_fonts/', wasmUrl: resources + 'wasm/', iccUrl: resources + 'iccs/' });
  let rejectCancellation!: (cause: unknown) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const wait = <T>(promise: Promise<T>) => Promise.race([promise, cancelled]);
  const cancel = () => { rejectCancellation(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')); void task.destroy().catch(() => {}); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  task.onPassword = () => cancel();
  try {
    const pdf = await wait(task.promise);
    if (pdf.numPages > 200) throw new Error('辅助 PDF 最多支持 200 页，请拆分后添加。');
    const sections: AiMaterialSection[] = []; let length = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      options.signal?.throwIfAborted();
      const content = await wait((await wait(pdf.getPage(page))).getTextContent());
      options.signal?.throwIfAborted();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
      length += text.length;
      if (length > AI_MATERIAL_MAX_TEXT) throw new Error('辅助材料文字超过 100000 字符，请拆分后添加。');
      sections.push({ label: `Page ${page}`, text }); options.onProgress?.(page, pdf.numPages);
    }
    return sections;
  } catch (cause) {
    options.signal?.throwIfAborted();
    if (cause instanceof Error && /100000|200 页/.test(cause.message)) throw cause;
    throw new Error('PDF 无法解析，请检查是否损坏或加密；扫描件需先识别文字。');
  } finally { options.signal?.removeEventListener('abort', cancel); await task.destroy().catch(() => {}); }
}
