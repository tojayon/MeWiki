import { AI_MATERIAL_MAX_BYTES, aiMaterialKindForName, createAiMaterial, type AiMaterialSection } from './materials.ts';
import { Unzip, UnzipInflate } from 'fflate';
import { parseDatasetFile, type DatasetWorkerResult } from '../domain/researchDatasetImport.ts';
import { serializeDatasetCsv } from '../domain/researchDataset.ts';

export interface AiMaterialImportOptions { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void }
const check = (options: AiMaterialImportOptions) => options.signal?.throwIfAborted();
const decode = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 32 && ![9, 10, 13].includes(code)) throw new Error();
    }
    return text;
  } catch { throw new Error('文件文字无法读取，请另存为 UTF-8 后重新添加。'); }
};
async function documentXml(buffer: ArrayBuffer, options: AiMaterialImportOptions): Promise<string> {
  let count = 0, total = 0, result = '', found = false, failure: Error | undefined;
  const unzip = new Unzip(file => {
    if (failure) return;
    if (++count > 2048 || file.name.split('/').includes('..') || /^(?:\/|[a-z]:)/i.test(file.name)) { failure = new Error('Word 文件目录无效。'); return; }
    if (file.originalSize !== undefined && file.originalSize > 20_000_000) { failure = new Error('Word 文件展开内容过大，请拆分后添加。'); return; }
    if (file.name !== 'word/document.xml') return;
    if (found) { failure = new Error('Word 文件目录无效。'); return; }
    found = true;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    file.ondata = (error, bytes, final) => {
      if (failure) return;
      total += bytes.length;
      if (error || total > 4_000_000) { failure = new Error('Word 文件展开内容过大或已损坏，请拆分后添加。'); return; }
      try { result += decoder.decode(bytes, { stream: !final }); } catch { failure = new Error('Word 文件文字无法读取。'); }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const bytes = new Uint8Array(buffer);
  try {
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      check(options);
      unzip.push(bytes.subarray(offset, offset + 65536), offset + 65536 >= bytes.length);
      if (failure) throw failure;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } catch (cause) { check(options); throw failure ?? new Error('Word 文件无法解析，请检查文件是否完整。', { cause }); }
  if (!found || !result) throw new Error('请选择有效的 DOCX 文件。');
  return result;
}
function wordText(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Word 文件包含不支持的 XML 声明。');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Word 文件内容损坏，无法解析。');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const walk = (node: Node): string => {
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.namespaceURI === ns) {
      if (['del', 'instrText'].includes(element.localName)) return '';
      if (element.localName === 't') return element.textContent ?? '';
      if (element.localName === 'tab') return '\t';
      if (['br', 'cr'].includes(element.localName)) return '\n';
    }
    const text = [...element.childNodes].map(walk).join('');
    return text + (element.namespaceURI === ns && element.localName === 'p' ? '\n' : '');
  };
  return walk(doc.documentElement).trim();
}
async function dataset(buffer: ArrayBuffer, name: string, options: AiMaterialImportOptions) {
  check(options);
  if (typeof Worker === 'undefined') return parseDatasetFile(buffer, name);
  const worker = new Worker(new URL('../components/researchDataset.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Awaited<ReturnType<typeof parseDatasetFile>>>((resolve, reject) => {
    const cleanup = () => { worker.terminate(); options.signal?.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<DatasetWorkerResult>) => { cleanup(); if ('error' in data) reject(new Error(data.error)); else resolve(data.result); };
    worker.onerror = () => { cleanup(); reject(new Error('表格文件无法解析，请检查文件内容。')); };
    worker.postMessage({ buffer, name }, [buffer]);
  });
}
export async function parseAiMaterial(libraryId: string, name: string, buffer: ArrayBuffer, options: AiMaterialImportOptions = {}) {
  check(options);
  const size = buffer.byteLength;
  if (!size || size > AI_MATERIAL_MAX_BYTES) throw new Error('辅助文件需大于 0 字节且不超过 20 MB。');
  const kind = aiMaterialKindForName(name);
  if (!kind) throw new Error('支持 TXT、Markdown、JSON、TeX 等文本、代码和配置文件，以及 PDF、DOCX、CSV、TSV 和 XLSX。');
  let sections: AiMaterialSection[];
  if (['txt', 'md', 'text'].includes(kind)) sections = [{ label: '正文', text: decode(buffer) }];
  else if (kind === 'docx') sections = [{ label: '正文', text: wordText(await documentXml(buffer, options)) }];
  else if (['csv', 'tsv', 'xlsx'].includes(kind)) {
    const result = await dataset(buffer, name, options);
    sections = result.sheets.map((sheet, index) => ({ label: sheet.name || `Sheet ${index + 1}`, text: serializeDatasetCsv({ columns: sheet.columns, rows: sheet.rows }) }));
  } else if (kind === 'pdf') sections = await (await import('./materialPdf.ts')).parseAiPdf(buffer, options);
  else throw new Error('支持 TXT、Markdown、JSON、TeX 等文本、代码和配置文件，以及 PDF、DOCX、CSV、TSV 和 XLSX。');
  check(options); options.onProgress?.(1, 1);
  return createAiMaterial(libraryId, name, kind, size, sections);
}
