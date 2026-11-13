import { describe, expect, it, vi } from 'vitest';
import { resolvePublicationImage } from './publicationSource.ts';

describe('publication image scope', () => {
  it('refuses network and invalid asset sources before any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(resolvePublicationImage({ type: 'url', url: 'https://example.com/image.png' }, null, new AbortController().signal)).rejects.toThrow('本地');
    await expect(resolvePublicationImage({ type: 'asset', assetId: '../other' }, 'D:/fictional', new AbortController().signal)).rejects.toThrow('来源');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it('honors cancellation before reading a local asset', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(resolvePublicationImage({ type: 'asset', assetId: 'a'.repeat(64) }, 'D:/fictional', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
