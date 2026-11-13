import { createHash } from 'node:crypto';
import { fromBuffer, type Entry } from 'yauzl';
import { parsePluginManifest } from '../src/plugins/sdk/manifest.ts';
import type { PluginManifest } from '../src/plugins/sdk/types.ts';

export const PLUGIN_PACKAGE_LIMIT = 1024 * 1024;
const MANIFEST_LIMIT = 256 * 1024;
const DOCUMENT_LIMIT = 64 * 1024;
const EXPANDED_LIMIT = 512 * 1024;
const allowedNames = new Set(['manifest.json', 'README.md', 'LICENSE', 'LICENSE.txt']);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function decodeJson(bytes: Buffer): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('插件清单不是有效的 UTF-8 JSON。'); }
}

function checkEntry(entry: Entry, seen: Set<string>, total: number) {
  const name = entry.fileName;
  const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (!allowedNames.has(name) || seen.has(name.toLowerCase()) || (fileType !== 0 && fileType !== 0x8000) || (entry.externalFileAttributes & 0x10)) {
    throw new Error('插件包包含不允许的文件、重复路径或链接。');
  }
  if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw new Error('插件包不能加密或使用不支持的压缩方式。');
  const limit = name === 'manifest.json' ? MANIFEST_LIMIT : DOCUMENT_LIMIT;
  if (entry.uncompressedSize > limit || total + entry.uncompressedSize > EXPANDED_LIMIT || entry.uncompressedSize > Math.max(entry.compressedSize, 1) * 100) {
    throw new Error('插件包解压大小或压缩比超过限制。');
  }
  seen.add(name.toLowerCase());
  return limit;
}

async function manifestFromZip(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (error) { reject(new Error('插件 ZIP 包无效。')); return; }
      let settled = false; let total = 0; let manifest: Buffer | undefined;
      const seen = new Set<string>();
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true; archive.close(); reject(cause instanceof Error ? cause : new Error('插件 ZIP 包无效。'));
      };
      archive.on('error', fail);
      archive.on('end', () => {
        if (settled) return;
        settled = true;
        if (!manifest) reject(new Error('插件包缺少 manifest.json。')); else resolve(manifest);
      });
      archive.on('entry', (entry: Entry) => {
        try {
          if (seen.size >= 4) throw new Error('插件包文件数量超过限制。');
          const limit = checkEntry(entry, seen, total);
          total += entry.uncompressedSize;
          archive.openReadStream(entry, (streamError, stream) => {
            if (streamError) { fail(streamError); return; }
            let actual = 0; let crc = 0xffffffff; const chunks: Buffer[] = [];
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              actual += chunk.length;
              if (actual > limit || actual > entry.uncompressedSize) {
                stream.destroy(new Error('插件包文件大小超过限制。')); return;
              }
              for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
              if (entry.fileName === 'manifest.json') chunks.push(chunk);
            });
            stream.on('end', () => {
              if (settled) return;
              if (actual !== entry.uncompressedSize) { fail(new Error('插件包文件大小不匹配。')); return; }
              if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) { fail(new Error('插件包文件 CRC 校验失败。')); return; }
              if (entry.fileName === 'manifest.json') manifest = Buffer.concat(chunks);
              archive.readEntry();
            });
          });
        } catch (cause) { fail(cause); }
      });
      if (archive.entryCount > 4) { fail(new Error('插件包文件数量超过限制。')); return; }
      archive.readEntry();
    });
  });
}

export async function inspectPluginPackage(value: Uint8Array): Promise<{ manifest: PluginManifest; sha256: string }> {
  const bytes = Buffer.from(value);
  if (!bytes.length || bytes.length > PLUGIN_PACKAGE_LIMIT) throw new Error('插件包为空或超过 1 MiB。');
  const zipped = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (!zipped && bytes.length > MANIFEST_LIMIT) throw new Error('插件清单超过 256 KiB。');
  const source = zipped ? await manifestFromZip(bytes) : bytes;
  const manifest = parsePluginManifest(decodeJson(source));
  return { manifest, sha256: createHash('sha256').update(bytes).digest('hex') };
}
