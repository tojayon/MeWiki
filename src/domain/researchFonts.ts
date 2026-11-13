import { sha256 } from '@noble/hashes/sha2.js';

/** Large CJK and variable fonts need a generous limit; keep this aligned with browser attachment capacity. */
export const MAX_USER_FONT_BYTES = 100 * 1024 * 1024;
export const userFontMimes = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' } as const;
export const userFontAccept = '.ttf,.otf,.woff,.woff2';
export interface PublicationFont { id: string; name: string; dataUrl: string }
const invalid = (): never => { throw new Error('字体文件无效，请选择完整的 TTF、OTF、WOFF 或 WOFF2 字体。'); };
export const isUserFontMime = (mime: string) => Object.values(userFontMimes).some(value => value === mime);
export const publicationFontFamily = (id: string) => `MeWikiUserFont_${id}`;

/** Inspect bounded font tables before storage; the browser also decodes the complete face. */
export function fontHeaderInfo(bytes: Uint8Array, size = bytes.length): string {
  if (size > MAX_USER_FONT_BYTES) throw new Error('单个字体最大 100 MiB，请选择较小的字体文件。');
  if (size < 12 || bytes.length < 12) return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const magic = tag(0);
  if (magic === 'wOFF' || magic === 'wOF2') {
    const header = magic === 'wOFF' ? 44 : 48;
    if (bytes.length < header) return invalid();
    const tables = view.getUint16(12);
    if (view.getUint32(8) !== size || tables < 1 || tables > 4096 || view.getUint32(16) > 100 * 1024 * 1024 || view.getUint32(16) < 12) return invalid();
    if (magic === 'wOFF') {
      if (bytes.length < header + tables * 20) return invalid();
      for (let i = 0; i < tables; i++) {
        const at = header + i * 20, offset = view.getUint32(at + 4), length = view.getUint32(at + 8);
        if (offset < header + tables * 20 || offset + length > size || length > view.getUint32(at + 12)) return invalid();
      }
    } else if (view.getUint32(20) < 1 || header + view.getUint32(20) > size) return invalid();
    return magic === 'wOFF' ? 'font/woff' : 'font/woff2';
  }
  if (view.getUint32(0) !== 0x00010000 && magic !== 'OTTO' && magic !== 'true') return invalid();
  const tables = view.getUint16(4);
  if (tables < 1 || tables > 4096 || bytes.length < 12 + tables * 16) return invalid();
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16, offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (offset < 12 + tables * 16 || offset + length > size) return invalid();
  }
  return magic === 'OTTO' ? 'font/otf' : 'font/ttf';
}
export function fontFileMime(file: { name: string; size: number }): string {
  if (file.size > MAX_USER_FONT_BYTES) throw new Error('单个字体最大 100 MiB，请选择较小的字体文件。');
  const extension = file.name.split('.').at(-1)?.toLowerCase() as keyof typeof userFontMimes;
  if (!file.size || !Object.hasOwn(userFontMimes, extension)) return invalid();
  return userFontMimes[extension];
}
export function parsePublicationFont(value: unknown): PublicationFont {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !['id', 'name', 'dataUrl'].includes(key))) return invalid();
  const font = value as PublicationFont;
  if (typeof font.id !== 'string' || !/^[a-f0-9]{64}$/.test(font.id) || typeof font.name !== 'string' || !font.name.trim() || font.name.length > 255 || typeof font.dataUrl !== 'string' || font.dataUrl.length > Math.ceil(MAX_USER_FONT_BYTES / 3) * 4 + 64) return invalid();
  const match = /^data:(font\/(?:ttf|otf|woff|woff2));base64,([A-Za-z0-9+/]+={0,2})$/.exec(font.dataUrl);
  if (!match) return invalid();
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0)); } catch { return invalid(); }
  if (fontHeaderInfo(bytes) !== match[1]) return invalid();
  const digest = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== font.id) return invalid();
  return { id: font.id, name: font.name, dataUrl: font.dataUrl };
}
export function publicationFontCss(font: PublicationFont): string {
  return `@font-face{font-family:${publicationFontFamily(font.id)};src:url("${font.dataUrl}");font-weight:400;font-style:normal;font-display:block}`;
}
