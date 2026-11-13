import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { defaultPublicationOptions, type PublicationRequest } from '../src/domain/publicationTypes.ts';
import { createPublicationMiddleware, PublicationJobs } from './publicationPlugin.ts';
import { PublicationContentError } from '../src/domain/publicationDiagnostics.ts';

const fixtures: { server: Server; jobs: PublicationJobs }[] = [];
afterEach(async () => { for (const { server, jobs } of fixtures.splice(0)) { jobs.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const request = (): PublicationRequest => ({ document: { title: '示例', text: '内容', blocks: [{ id: 'a', kind: 'markdown', content: '内容' }] }, options: defaultPublicationOptions() });
async function fixture() {
  const jobs = new PublicationJobs(async (_input, signal, progress) => { progress?.({ completed: 0, total: 1 }); await new Promise<void>((resolve, reject) => { const timeout = setTimeout(resolve, 50); signal?.addEventListener('abort', () => { clearTimeout(timeout); reject(new Error('取消')); }, { once: true }); }); return { format: 'png', pages: [{ dataUrl: 'data:image/png;base64,eA==', width: 1080, height: 1440 }] }; });
  const middleware = createPublicationMiddleware(jobs);
  const server = createServer((req, res) => void middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); fixtures.push({ server, jobs });
  return { jobs, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/mewiki/publications/jobs`, headers: { 'Content-Type': 'application/json', 'X-MeWiki-Request': 'publications' } };
}
describe('local publication jobs', () => {
  it('exposes structured layout diagnostics alongside the original error string', async () => {
    const diagnostics = [{ blockId: 'a', code: 'horizontal-overflow' as const }];
    const jobs = new PublicationJobs(async () => { throw new PublicationContentError('正文超宽。', diagnostics); });
    try {
      const id = jobs.create(request());
      await vi.waitFor(() => expect(jobs.get(id)).toMatchObject({ status: 'error', error: '正文超宽。', diagnostics }));
    } finally { jobs.close(); }
  });
  it('returns the exact invalid setting to clients before starting an export', async () => {
    const { url, headers } = await fixture();
    const input = request(); input.options.width = 320;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/画幅 → 输出宽度.*320.*480.*2160/) });
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(request()) })).status).toBe(200);
  });
  it('creates, polls and removes a bounded snapshot task', async () => {
    const { url, headers } = await fixture();
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request()) }); expect(response.status).toBe(200);
    const { id } = await response.json() as { id: string }; expect(id).toMatch(/^[\da-f-]{36}$/);
    await new Promise(resolve => setTimeout(resolve, 80));
    const result = await fetch(`${url}/${id}`, { headers }); expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ id, status: 'complete', completed: 1, result: { pages: [{ width: 1080 }] } });
    expect((await fetch(`${url}/${id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await fetch(`${url}/${id}`, { headers })).status).toBe(404);
  });
  it('rejects foreign origins, malformed requests and concurrent rendering', async () => {
    const { url, headers } = await fixture();
    for (const origin of ['null', 'https://example.com', 'http://localhost:5280']) expect((await fetch(url, { method: 'POST', headers: { ...headers, Origin: origin }, body: JSON.stringify(request()) })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request()) })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers, body: '{}' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(request()) })).status).toBe(200);
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify(request()) })).status).toBe(429);
  });
  it('aborts rendering when the user removes a running task', async () => {
    const { url, headers } = await fixture();
    const { id } = await (await fetch(url, { method: 'POST', headers, body: JSON.stringify(request()) })).json() as { id: string };
    expect((await fetch(`${url}/${id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await fetch(`${url}/${id}`, { headers })).status).toBe(404);
  });
  it('holds the concurrency slot until cancellation cleanup finishes', async () => {
    let allowCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { allowCleanup = resolve; });
    const jobs = new PublicationJobs(async (_request, signal) => {
      await new Promise<void>(resolve => { signal?.addEventListener('abort', () => resolve(), { once: true }); });
      await cleanup;
      return { format: 'png', pages: [] };
    });
    try {
      const id = jobs.create(request()); jobs.remove(id);
      expect(() => jobs.create(request())).toThrow('正在进行');
      allowCleanup();
      await vi.waitFor(() => expect(() => jobs.create(request())).not.toThrow());
    } finally { allowCleanup(); jobs.close(); }
  });
  it('expires completed results after the bounded retention period', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const jobs = new PublicationJobs(async () => ({ format: 'png', pages: [] }));
    try {
      const id = jobs.create(request());
      await vi.waitFor(() => expect(jobs.get(id).status).toBe('complete'));
      clock.mockReturnValue(1300001);
      expect(() => jobs.get(id)).toThrow('过期');
    } finally { jobs.close(); clock.mockRestore(); }
  });
});
