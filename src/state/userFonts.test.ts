/// <reference types="node" />
import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { browserFontStore } from './researchMediaStorage.ts';
import { createBrowserMediaArchive } from './researchMediaArchive.ts';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { listUserFonts, loadUserFontFace } from './userFonts.ts';

vi.mock('./researchMediaClient.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./researchMediaClient.ts')>();
  return { ...actual, researchMediaClient: new actual.ResearchMediaClient((input, init) => fetch(input, init)) };
});

afterEach(() => vi.unstubAllGlobals());

it('uses the current library binding for fonts after an open export page has moved from browser to local storage', async () => {
  const libraryId = crypto.randomUUID();
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  await browserFontStore(libraryId).put(new File([bytes], '原浏览器字体.woff2', { type: 'font/woff2' }));
  const directory = 'D:\\font-test-library';
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input), 'http://127.0.0.1');
    if (url.pathname === '/api/research-library/catalog') return Response.json({ libraries: [{ id: libraryId, name: '已迁移资料库', directory }], contextDefaults: {} });
    expect(url.pathname).toBe('/api/research-library/media/fonts');
    expect(url.searchParams.get('directory')).toBe(directory);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await listUserFonts(libraryId)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not fall back to browser fonts for a library removed from the catalog', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ libraries: [], contextDefaults: {} })));
  await expect(listUserFonts(crypto.randomUUID())).rejects.toThrow('指定的资料库不存在或已从列表移除');
});

it('decodes the current library original as binary without a base64 copy', async () => {
  const libraryId = crypto.randomUUID();
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  const asset = await browserFontStore(libraryId).put(new File([bytes], '界面字体.woff2', { type: 'font/woff2' }));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ libraries: [{ id: libraryId, name: '字体库', directory: null }], contextDefaults: {} })));
  vi.stubGlobal('btoa', () => { throw new Error('The interface should not encode base64.'); });
  let decoded: ArrayBuffer | undefined;
  vi.stubGlobal('FontFace', class {
    family: string;
    constructor(family: string, data: ArrayBuffer) { this.family = family; decoded = data; }
    async load() { return this; }
  });
  const face = await loadUserFontFace(libraryId, asset.id);
  expect(face.family).toBe(`MeWikiUserFont_${asset.id}`);
  expect(Buffer.from(decoded!)).toEqual(bytes);
  await expect(loadUserFontFace(crypto.randomUUID(), asset.id)).rejects.toThrow('指定的资料库不存在或已从列表移除');
});

it('rejects corrupted local font bytes before decoding and honors cancellation', async () => {
  const libraryId = crypto.randomUUID();
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  const asset = await browserFontStore(libraryId).put(new File([bytes], '界面字体.woff2', { type: 'font/woff2' }));
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input), 'http://127.0.0.1');
    if (url.pathname.endsWith('/catalog')) return Response.json({ libraries: [{ id: libraryId, name: '本地字体库', directory: 'D:\\font-test-only' }], contextDefaults: {} });
    if (url.pathname.endsWith('/content')) return new Response(corrupt);
    return Response.json(asset);
  }));
  const decode = vi.fn(); vi.stubGlobal('FontFace', decode);
  await expect(loadUserFontFace(libraryId, asset.id)).rejects.toThrow('字体原件缺失或损坏');
  expect(decode).not.toHaveBeenCalled();
  const abort = new AbortController(); abort.abort();
  await expect(loadUserFontFace(libraryId, asset.id, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('persists browser fonts per library and includes them without a note reference in a full backup', async () => {
  const libraryId = crypto.randomUUID();
  const bytes = await readFile('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2');
  const store = browserFontStore(libraryId);
  const asset = await store.put(new File([bytes], '我的字体.woff2', { type: 'font/woff2' }));
  expect(asset.mimeType).toBe('font/woff2');
  expect((await store.put(new File([bytes], '副本.woff2', { type: 'font/woff2' }))).id).toBe(asset.id);
  expect(await browserFontStore(libraryId).listFonts()).toEqual([asset]);
  expect(await browserFontStore(crypto.randomUUID()).listFonts()).toEqual([]);
  const archive = await createBrowserMediaArchive(createNotebookFixture(), 'library', undefined, undefined, libraryId);
  const reader = new ZipReader(new BlobReader(archive));
  try {
    const names = (await reader.getEntries()).map(entry => entry.filename);
    expect(names).toContain(`assets/${asset.id}.woff2`);
    expect(names).toContain(`assets/${asset.id}.json`);
  } finally { await reader.close(); }
});
