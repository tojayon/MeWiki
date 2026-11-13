import { fontHeaderInfo, isUserFontMime, userFontMimes } from './researchFonts.ts';
export type ResearchMediaKind = "image" | "audio" | "video" | "pdf" | "file";

export const mediaKindLabels = { image: "图片", audio: "音频", video: "视频", pdf: "PDF 文档", file: "附件" } as const;
export const mediaMimeExtensions: Record<string, string> = {
  ...Object.fromEntries(Object.entries(userFontMimes).map(([extension, mime]) => [mime, extension])),
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "weba",
  "video/mp4": "mp4", "video/webm": "webm",
  "application/pdf": "pdf", "application/octet-stream": "bin",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip", "application/gzip": "gz", "application/x-7z-compressed": "7z", "application/vnd.rar": "rar",
  "text/plain": "txt", "text/csv": "csv", "text/markdown": "md", "application/json": "jsondata",
};
const extensionMimes = Object.fromEntries(Object.entries(mediaMimeExtensions).map(([mime, extension]) => [extension, mime]));
Object.assign(extensionMimes, { jpeg: "image/jpeg", oga: "audio/ogg", log: "text/plain", json: "application/json" });
const mimeAliases: Record<string, string> = { "audio/mp3": "audio/mpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "audio/x-m4a": "audio/mp4", "application/x-pdf": "application/pdf", "application/x-zip-compressed": "application/zip", "application/x-gzip": "application/gzip", "application/x-rar-compressed": "application/vnd.rar" };

export function canonicalMediaMime(mime: string): string {
  const value = mime.toLowerCase().split(";")[0].trim();
  return Object.hasOwn(mimeAliases, value) ? mimeAliases[value] : value;
}
export function mediaKindFromMime(mime: string): ResearchMediaKind | undefined {
  const value = canonicalMediaMime(mime);
  if (!Object.hasOwn(mediaMimeExtensions, value)) return;
  if (value === "application/pdf") return "pdf";
  return /^(image|audio|video)\//.test(value) ? value.split("/")[0] as ResearchMediaKind : "file";
}
export function mediaFileMime(file: { name: string; type: string }): string {
  const mime = canonicalMediaMime(file.type);
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!mime || mime === "application/octet-stream") return Object.hasOwn(extensionMimes, extension) ? extensionMimes[extension] : "application/octet-stream";
  // Unknown formats are downloadable originals only. Never serve active formats inline.
  if (Object.hasOwn(mediaMimeExtensions, mime)) return mime;
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? "application/octet-stream" : "";
}
export function mediaFileKind(file: { name: string; type: string }): ResearchMediaKind | undefined {
  return mediaKindFromMime(mediaFileMime(file));
}
export function mediaFileAccept(kind: ResearchMediaKind): string {
  if (kind === "file") return "";
  return [...Object.entries(extensionMimes).filter(([, mime]) => mediaKindFromMime(mime) === kind).map(([extension]) => `.${extension}`), ...Object.keys(mediaMimeExtensions).filter(mime => mediaKindFromMime(mime) === kind)].join(",");
}

export interface MediaHeaderInfo { mimeType: string; width?: number; height?: number }
export function imageHeaderInfo(bytes: Uint8Array): MediaHeaderInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 24 && text(1, 3) === "PNG" && bytes[0] === 137 && view.getUint32(4) === 0x0d0a1a0a && text(12, 4) === "IHDR") return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(text(0, 6))) return { mimeType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    if (text(12, 4) === "VP8X") return { mimeType: "image/webp", width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(26, true) >>> 8) };
    if (text(12, 4) === "VP8 " && text(23, 3) === "\x9d\x01\x2a") return { mimeType: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (text(12, 4) === "VP8L" && bytes[20] === 47) { const bits = view.getUint32(21, true); return { mimeType: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
    return { mimeType: "image/webp" };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) return { mimeType: "image/jpeg", width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      offset += length;
    }
    return { mimeType: "image/jpeg" };
  }
  throw new Error("文件内容不是受支持的图片，请检查文件。");
}

/** Checks bounded container headers; codec support is determined by the player. */
export function mediaHeaderInfo(bytes: Uint8Array, declaredMime: string, totalBytes = bytes.length): MediaHeaderInfo {
  const mime = canonicalMediaMime(declaredMime);
  if (isUserFontMime(mime)) {
    if (fontHeaderInfo(bytes, totalBytes) !== mime) throw new Error('字体文件内容与声明格式不匹配，请选择原始字体。');
    return { mimeType: mime };
  }
  const kind = mediaKindFromMime(mime);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (kind === "image") return imageHeaderInfo(bytes);
  if (kind === "pdf") {
    if (!/^(?:\uFEFF)?\s*%PDF-\d\.\d/.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) throw new Error("文件内容不是 PDF，请选择原始 PDF 文档。");
    return { mimeType: mime };
  }
  if (kind === "file") return { mimeType: mime };
  let actual = "";
  if (bytes.length >= 44 && text(0, 4) === "RIFF" && text(8, 4) === "WAVE") actual = "audio/wav";
  else if (bytes.length >= 10 && text(0, 3) === "ID3" && bytes[3] >= 2 && bytes[3] <= 4) actual = "audio/mpeg";
  else if (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0 && (bytes[2] & 0xf0) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c) actual = "audio/mpeg";
  else if (bytes.length >= 27 && text(0, 4) === "OggS" && bytes[4] === 0) actual = "audio/ogg";
  else if (bytes.length >= 8 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && new TextDecoder().decode(bytes.subarray(4, 4096)).includes("webm")) actual = kind === "audio" ? "audio/webm" : "video/webm";
  else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset + 16 <= Math.min(bytes.length, 65536);) {
      const size = view.getUint32(offset);
      if (size < 16 || size > bytes.length - offset) break;
      if (text(offset + 4, 4) === "ftyp") { actual = kind === "audio" ? "audio/mp4" : "video/mp4"; break; }
      if (!["free", "skip", "wide"].includes(text(offset + 4, 4))) break;
      offset += size;
    }
  }
  if (!actual || actual !== mime) throw new Error("文件内容不是声明格式的媒体，请选择原始音频或视频文件。");
  return { mimeType: actual };
}
