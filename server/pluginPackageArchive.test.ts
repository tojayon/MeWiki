import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { inspectPluginPackage } from './pluginPackageArchive.ts';

const manifest = { manifestVersion: 1, apiVersion: 1, id: 'org.example.archive', name: '打包示例', version: '1.0.0', description: '测试包',
  capabilities: ['context.read'], contentTypes: [{ id: 'measurement', schemaVersion: 1, insertionLabel: '插入测量', schema: { type: 'object' }, view: [] }] };
async function zip(files: { name: string; data: string; compress?: boolean }[]) {
  const archive = new ZipFile(); const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on('data', chunk => chunks.push(chunk)); archive.outputStream.on('end', () => resolve(Buffer.concat(chunks))); archive.outputStream.on('error', reject);
  });
  for (const file of files) archive.addBuffer(Buffer.from(file.data), file.name, { compress: file.compress ?? false });
  archive.end(); return output;
}
function replaceName(buffer: Buffer, name: string) {
  const old = Buffer.from('manifest.json'); const next = Buffer.from(name);
  if (old.length !== next.length) throw new Error('Fixture names require equal lengths');
  let index = buffer.indexOf(old);
  while (index !== -1) { next.copy(buffer, index); index = buffer.indexOf(old, index + old.length); }
  return buffer;
}

describe('plugin package archive boundaries', () => {
  it('rejects traversal, absolute-drive, backslash and null-byte paths', async () => {
    const valid = await zip([{ name: 'manifest.json', data: JSON.stringify(manifest) }]);
    for (const name of ['../outside.js', 'X:manifest.js', '..\\outside.js', 'manifest.jso\0']) {
      await expect(inspectPluginPackage(replaceName(Buffer.from(valid), name))).rejects.toThrow();
    }
  });
  it('rejects a ZIP without a manifest or with too many entries', async () => {
    await expect(inspectPluginPackage(await zip([{ name: 'README.md', data: '说明' }]))).rejects.toThrow();
    await expect(inspectPluginPackage(await zip(Array.from({ length: 5 }, () => ({ name: 'manifest.json', data: JSON.stringify(manifest) }))))).rejects.toThrow();
  });
  it('rejects extreme expansion ratios before decompressing', async () => {
    await expect(inspectPluginPackage(await zip([{ name: 'manifest.json', data: JSON.stringify(manifest) }, { name: 'README.md', data: 'A'.repeat(50000), compress: true }]))).rejects.toThrow(/压缩比/);
  });
  it('rejects encrypted and unsupported-compression metadata', async () => {
    const valid = await zip([{ name: 'manifest.json', data: JSON.stringify(manifest) }]);
    for (const encrypt of [true, false]) {
      const mutated = Buffer.from(valid); const central = mutated.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      if (encrypt) mutated.writeUInt16LE(mutated.readUInt16LE(central + 8) | 1, central + 8);
      else mutated.writeUInt16LE(99, central + 10);
      await expect(inspectPluginPackage(mutated)).rejects.toThrow();
    }
  });
  it('rejects corrupted file bytes instead of accepting a damaged CRC', async () => {
    const valid = await zip([{ name: 'manifest.json', data: JSON.stringify(manifest) }]);
    const mutated = Buffer.from(valid); const label = Buffer.from('1.0.0'); const offset = mutated.indexOf(label);
    mutated[offset + 4] = '1'.charCodeAt(0);
    await expect(inspectPluginPackage(mutated)).rejects.toThrow();
  });
});
