import { fontFileMime, fontHeaderInfo, isUserFontMime, MAX_USER_FONT_BYTES, parsePublicationFont, publicationFontFamily, type PublicationFont } from '../domain/researchFonts.ts';
import type { ResearchMediaAsset } from '../domain/researchMedia.ts';
import { browserFontStore } from './researchMediaStorage.ts';
import { hashMediaBlob, researchMediaClient } from './researchMediaClient.ts';
import { ResearchLibraryClient } from './researchLibraryClient.ts';

const USER_FONTS_CHANGED_EVENT = 'mewiki:user-fonts-changed';
const fontRevisionKey = (libraryId: string) => `mewiki:library:${encodeURIComponent(libraryId)}:fonts-revision`;
function notifyUserFonts(libraryId: string, id: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(USER_FONTS_CHANGED_EVENT, { detail: { libraryId, id } }));
  try { localStorage.setItem(fontRevisionKey(libraryId), `${id}:${crypto.randomUUID()}`); } catch { /* Same-window refresh remains available. */ }
}
export function subscribeUserFonts(libraryId: string, listener: (fontId?: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<{ libraryId: string; id: string }>).detail;
    if (detail?.libraryId === libraryId) listener(detail.id);
  };
  const stored = (event: StorageEvent) => {
    if (event.key !== fontRevisionKey(libraryId) && event.key !== null) return;
    const id = event.newValue?.split(':')[0];
    listener(id && /^[a-f0-9]{64}$/.test(id) ? id : undefined);
  };
  window.addEventListener(USER_FONTS_CHANGED_EVENT, changed);
  window.addEventListener('storage', stored);
  return () => { window.removeEventListener(USER_FONTS_CHANGED_EVENT, changed); window.removeEventListener('storage', stored); };
}

async function fontDirectory(libraryId: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const catalog = await new ResearchLibraryClient(undefined, libraryId).catalog(signal);
  signal?.throwIfAborted();
  const profile = catalog.libraries.find(item => item.id === libraryId);
  if (!profile) throw new Error('指定的资料库不存在或已从列表移除，请重新选择。');
  return profile.directory;
}
export async function listUserFonts(libraryId: string, signal?: AbortSignal): Promise<ResearchMediaAsset[]> {
  const directory = await fontDirectory(libraryId, signal);
  const fonts = directory ? await researchMediaClient.fonts(directory, signal) : await browserFontStore(libraryId).listFonts();
  signal?.throwIfAborted();
  return fonts.filter(font => isUserFontMime(font.mimeType));
}
async function blobResource(blob: Blob, asset: ResearchMediaAsset): Promise<PublicationFont> {
  if (!isUserFontMime(asset.mimeType) || blob.size > MAX_USER_FONT_BYTES || blob.size !== asset.size) throw new Error('字体原件缺失或损坏，请重新导入字体。');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return parsePublicationFont({ id: asset.id, name: asset.name, dataUrl: `data:${asset.mimeType};base64,${btoa(parts.join(''))}` });
}
async function readFontOriginal(libraryId: string, id: string, signal?: AbortSignal): Promise<{ asset: ResearchMediaAsset; blob: Blob }> {
  const directory = await fontDirectory(libraryId, signal);
  if (directory) {
    const asset = await researchMediaClient.metadata(directory, id, signal);
    if (!isUserFontMime(asset.mimeType) || asset.size > MAX_USER_FONT_BYTES) throw new Error('所选资源不是可用的字体。');
    const response = await fetch(researchMediaClient.contentUrl(directory, id), { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('字体原件缺失或损坏，请重新导入字体。');
    const blob = await response.blob();
    signal?.throwIfAborted();
    return { asset, blob };
  }
  const stored = await browserFontStore(libraryId).get(id);
  signal?.throwIfAborted();
  if (!stored) throw new Error('所选字体不在当前资料库中，请重新导入字体。');
  return stored;
}
export async function readUserFont(libraryId: string, id: string, signal?: AbortSignal): Promise<PublicationFont> {
  const { asset, blob } = await readFontOriginal(libraryId, id, signal);
  const resource = await blobResource(blob, asset);
  signal?.throwIfAborted();
  return resource;
}
/** Interface text can decode the original directly; exports keep their portable data URL. */
export async function loadUserFontFace(libraryId: string, id: string, signal?: AbortSignal): Promise<FontFace> {
  const { asset, blob } = await readFontOriginal(libraryId, id, signal);
  if (asset.id !== id || asset.sha256 !== id || !isUserFontMime(asset.mimeType) || blob.size !== asset.size || blob.size > MAX_USER_FONT_BYTES || await hashMediaBlob(blob, undefined, signal) !== id) throw new Error('字体原件缺失或损坏，请重新导入字体。');
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  if (fontHeaderInfo(new Uint8Array(bytes)) !== asset.mimeType) throw new Error('字体原件缺失或损坏，请重新导入字体。');
  try {
    const face = await new FontFace(publicationFontFamily(id), bytes, { weight: '400', style: 'normal' }).load();
    signal?.throwIfAborted();
    return face;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error('浏览器无法读取此字体，请选择其他 TTF、OTF、WOFF 或 WOFF2 文件。');
  }
}
export async function decodeUserFont(font: PublicationFont, signal?: AbortSignal): Promise<FontFace> {
  signal?.throwIfAborted();
  try {
    const face = await new FontFace(publicationFontFamily(font.id), `url("${font.dataUrl}")`, { weight: '400', style: 'normal' }).load();
    signal?.throwIfAborted();
    return face;
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error('浏览器无法读取此字体，请选择其他 TTF、OTF、WOFF 或 WOFF2 文件。');
  }
}
export async function importUserFont(libraryId: string, file: File, signal?: AbortSignal): Promise<ResearchMediaAsset> {
  const mime = fontFileMime(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (fontHeaderInfo(bytes) !== mime) throw new Error('字体文件内容与扩展名不匹配，请选择原始字体。');
  // Decode before publishing so an unusable file never appears as an imported font.
  try { await new FontFace('MeWikiImportFont', bytes).load(); }
  catch { throw new Error('浏览器无法读取此字体，请选择其他 TTF、OTF、WOFF 或 WOFF2 文件。'); }
  signal?.throwIfAborted();
  const original = new File([file], file.name, { type: mime });
  // Export pages freeze note content, while the font library follows its stable library ID.
  // Recheck after saving so a concurrent directory move cannot report a misplaced font as saved.
  let directory = await fontDirectory(libraryId, signal);
  for (let attempt = 0; attempt < 2; attempt++) {
    const asset = directory ? await researchMediaClient.upload(directory, original, undefined, signal) : await browserFontStore(libraryId).put(original, undefined, signal);
    const current = await fontDirectory(libraryId, signal);
    if (current === directory) { notifyUserFonts(libraryId, asset.id); return asset; }
    directory = current;
  }
  throw new Error('资料库保存位置已改变，请重新导入字体。');
}
export function userFontFile(font: PublicationFont): File {
  const checked = parsePublicationFont(font);
  const [header, encoded] = checked.dataUrl.split(',');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new File([bytes], checked.name, { type: header.slice(5, header.indexOf(';')) });
}
