import { afterEach, expect, it, vi } from 'vitest';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));
import { parseAiPdf } from './materialPdf.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('settles cancellation even when PDF loading never resolves after its worker is destroyed', async () => {
  vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:5525' } });
  const destroy = vi.fn().mockResolvedValue(undefined);
  getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
  const controller = new AbortController();
  const result = parseAiPdf(new ArrayBuffer(1), { signal: controller.signal }).then(() => 'resolved', cause => cause.name);
  controller.abort();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('pending'), 100); });
  try { expect(await Promise.race([result, timeout])).toBe('AbortError'); }
  finally { clearTimeout(timer!); }
  expect(destroy).toHaveBeenCalled();
});
