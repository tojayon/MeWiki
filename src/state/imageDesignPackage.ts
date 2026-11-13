import { BlobReader, BlobWriter, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { parseImageDesigns, type ImageDesign } from '../domain/imageWorkspace.ts';
import { compositionFontIds, resolveComposition } from '../domain/publicationComposition.ts';
import { publicationObject, publicationText } from '../domain/publicationValidation.ts';
import { fontHeaderInfo, MAX_USER_FONT_BYTES, parsePublicationFont, type PublicationFont } from '../domain/researchFonts.ts';
import { imageHeaderInfo } from '../domain/researchMediaFormats.ts';

export const IMAGE_DESIGN_PACKAGE_LIMIT = 512 * 1024 * 1024;
const CONFIG_LIMIT = 32 * 1024 * 1024, IMAGE_LIMIT = 8 * 1024 * 1024;
const invalid = (): never => { throw new Error('作品备份格式无效或素材缺失，请选择完整的 MeWiki 图片设计 ZIP。'); };
const tooLarge = (): never => { throw new Error('作品备份最多 512 MiB，请减少主图或字体后分开备份。'); };
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const base64 = (bytes: Uint8Array) => { const chunks: string[] = []; for (let n = 0; n < bytes.length; n += 32768) chunks.push(String.fromCharCode(...bytes.subarray(n, n + 32768))); return btoa(chunks.join('')); };
const fontIds = (design: ImageDesign) => [...new Set([...compositionFontIds(design.options.composition), ...design.items.flatMap(item => compositionFontIds(resolveComposition(design.options.composition!, item.imageData?.overrides)))])];
function imageUrl(bytes: Uint8Array, id: string) {
  const header = imageHeaderInfo(bytes);
  if (bytes.length > IMAGE_LIMIT || !['image/png', 'image/jpeg'].includes(header.mimeType) || !header.width || !header.height || header.width * header.height > 16_000_000 || digest(bytes) !== id) return invalid();
  return `data:${header.mimeType};base64,${base64(bytes)}`;
}
interface FontDescriptor { id: string; name: string; mime: string }

/** Binary ZIP entries avoid base64 expansion; sources are read one at a time. */
export async function createImageDesignPackage(design: ImageDesign, asset: (id: string) => Promise<string>, font: (id: string) => Promise<PublicationFont>): Promise<Blob> {
  const checked = parseImageDesigns([design])[0], ids = fontIds(checked);
  if (ids.length > 8) return invalid();
  const output = new BlobWriter('application/zip'), sink = output.writable.getWriter(); let written = 0, total = 0;
  const writer = new ZipWriter(new WritableStream<Uint8Array>({ write: async chunk => { written += chunk.byteLength; if (written > IMAGE_DESIGN_PACKAGE_LIMIT) tooLarge(); await sink.write(chunk); }, close: () => sink.close(), abort: reason => sink.abort(reason) }), { useWebWorkers: false, level: 0 });
  const add = async (name: string, blob: Blob) => { total += blob.size; if (total > IMAGE_DESIGN_PACKAGE_LIMIT - 65536) tooLarge(); await writer.add(name, blob.stream()); };
  try {
    const fonts: FontDescriptor[] = [];
    for (const id of ids) {
      const value = parsePublicationFont(await font(id)); if (value.id !== id) return invalid();
      const blob = await (await fetch(value.dataUrl)).blob(); fonts.push({ id, name: value.name, mime: blob.type });
      await add(`fonts/${id}.font`, blob);
    }
    for (const id of new Set(checked.items.map(item => item.assetId))) {
      const blob = await (await fetch(await asset(id))).blob();
      imageUrl(new Uint8Array(await blob.arrayBuffer()), id); await add(`assets/${id}.image`, blob);
    }
    const manifest = new Blob([JSON.stringify({ format: 'mewiki-image-design', version: 1, design: checked, fonts })]);
    if (manifest.size > CONFIG_LIMIT) return invalid();
    await add('manifest.json', manifest); await writer.close(); return await output.getData();
  } catch (cause) { await sink.abort(cause).catch(() => {}); throw cause; }
}

/** Check the ZIP directory first, then bound every decompressed stream independently. */
export async function readImageDesignPackage(blob: Blob) {
  if (!blob.size || blob.size > IMAGE_DESIGN_PACKAGE_LIMIT) tooLarge();
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  try {
    const entries = new Map<string, FileEntry>(); let total = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory || entry.symlink || entry.encrypted || entries.has(entry.filename) || entries.size >= 60 || !/^(manifest\.json|assets\/[a-f0-9]{64}\.image|fonts\/[a-f0-9]{64}\.font)$/.test(entry.filename)) return invalid();
      const limit = entry.filename === 'manifest.json' ? CONFIG_LIMIT : entry.filename.startsWith('fonts/') ? MAX_USER_FONT_BYTES : IMAGE_LIMIT;
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > limit) return invalid();
      total += entry.uncompressedSize; if (total > IMAGE_DESIGN_PACKAGE_LIMIT) tooLarge();
      entries.set(entry.filename, entry);
    }
    const read = async (name: string) => {
      const entry = entries.get(name); if (!entry) return invalid();
      const output = new BlobWriter(), sink = output.writable.getWriter(); let size = 0;
      try {
        await entry.getData(new WritableStream<Uint8Array>({ write: async chunk => { size += chunk.byteLength; if (size > entry.uncompressedSize) invalid(); await sink.write(chunk); }, close: () => sink.close(), abort: cause => sink.abort(cause) }), { checkSignature: true });
        if (size !== entry.uncompressedSize) return invalid(); return await output.getData();
      } catch (cause) { await sink.abort(cause).catch(() => {}); throw cause; }
    };
    const manifest = publicationObject(JSON.parse(await (await read('manifest.json')).text()), ['format', 'version', 'design', 'fonts'], '图片创作 → 作品备份');
    if (manifest.format !== 'mewiki-image-design' || manifest.version !== 1 || !Array.isArray(manifest.fonts) || manifest.fonts.length > 8) return invalid();
    const design = parseImageDesigns([manifest.design])[0];
    const fonts = manifest.fonts.map(value => {
      const raw = publicationObject(value, ['id', 'name', 'mime'], '图片创作 → 作品备份');
      if (typeof raw.id !== 'string' || !/^[a-f0-9]{64}$/.test(raw.id) || !['font/ttf', 'font/otf', 'font/woff', 'font/woff2'].includes(String(raw.mime))) return invalid();
      return { id: raw.id, name: publicationText(raw.name, 255, '图片创作 → 作品备份'), mime: String(raw.mime) };
    });
    const requiredFonts = fontIds(design);
    if (new Set(fonts.map(font => font.id)).size !== fonts.length || requiredFonts.length !== fonts.length || requiredFonts.some(id => !fonts.some(font => font.id === id))) return invalid();
    const expected = new Set(['manifest.json', ...design.items.map(item => `assets/${item.assetId}.image`), ...fonts.map(font => `fonts/${font.id}.font`)]);
    if (expected.size !== entries.size || [...expected].some(name => !entries.has(name))) return invalid();
    return { design, fonts,
      asset: async (id: string) => { if (!expected.has(`assets/${id}.image`)) return invalid(); return imageUrl(new Uint8Array(await (await read(`assets/${id}.image`)).arrayBuffer()), id); },
      font: async (font: FontDescriptor) => { const bytes = new Uint8Array(await (await read(`fonts/${font.id}.font`)).arrayBuffer()); if (fontHeaderInfo(bytes) !== font.mime || digest(bytes) !== font.id) return invalid(); return parsePublicationFont({ id: font.id, name: font.name, dataUrl: `data:${font.mime};base64,${base64(bytes)}` }); },
      close: () => reader.close(),
    };
  } catch (cause) { await reader.close(); throw cause; }
}
