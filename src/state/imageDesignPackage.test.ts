import { expect, it } from 'vitest';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { createImageDesignPackage, readImageDesignPackage } from './imageDesignPackage.ts';
import { defaultPublicationOptions } from '../domain/publicationTypes.ts';
import { defaultComposition } from '../domain/publicationComposition.ts';
import type { ImageDesign } from '../domain/imageWorkspace.ts';
const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const id = Buffer.from(sha256(image)).toString('hex');
const design: ImageDesign = { id: 'sample', name: '宣传作品', updatedAt: '2026-11-12', options: { ...defaultPublicationOptions(), imageMode: { fit: 'contain' }, composition: defaultComposition() }, items: [{ id: 'image-one', name: '原图.png', assetId: id }] };
const asBlob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);
it('roundtrips an editable design and deduplicated originals without library identities', async () => {
  const load = async () => 'data:image/png;base64,' + Buffer.from(image).toString('base64');
  const archive = await createImageDesignPackage(design, load, async () => { throw new Error('unused'); });
  const opened = await readImageDesignPackage(archive);
  try { expect(opened.design).toEqual(design); expect(await opened.asset(id)).toBe(await load()); expect(opened.fonts).toEqual([]); }
  finally { await opened.close(); }
});
it('rejects traversal, duplicate entries, missing originals and oversized ZIP declarations', async () => {
  const manifest = strToU8(JSON.stringify({ format: 'mewiki-image-design', version: 1, design, fonts: [] }));
  const malformed: Zippable[] = [{ 'manifest.json': manifest }, { 'manifest.json': manifest, '../outside': image }, { 'manifest.json': manifest, [`assets/${id}.image`]: image, 'extra': image }];
  for (const entries of malformed) {
    await expect(readImageDesignPackage(asBlob(zipSync(entries)))).rejects.toThrow();
  }
  const bytes = zipSync({ 'manifest.json': manifest, [`assets/${id}.image`]: image });
  for (let n = 0; n < bytes.length - 28; n++) if (new DataView(bytes.buffer).getUint32(n, true) === 0x02014b50) { new DataView(bytes.buffer).setUint32(n + 24, 600 * 1024 * 1024, true); break; }
  await expect(readImageDesignPackage(asBlob(bytes))).rejects.toThrow();
});
it('verifies original digests before exposing imported resources', async () => {
  const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'mewiki-image-design', version: 1, design, fonts: [] })), [`assets/${id}.image`]: Uint8Array.of(1, 2, 3) });
  const opened = await readImageDesignPackage(asBlob(bytes));
  try { await expect(opened.asset(id)).rejects.toThrow(); } finally { await opened.close(); }
});
