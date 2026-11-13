import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginPackageStore } from './pluginPackageStore.ts';
import { createPluginPackageMiddleware } from './pluginPackagePlugin.ts';

const fixtures: { root: string; server: Server }[] = [];
const manifest = { manifestVersion: 1, apiVersion: 1, id: 'org.example.instrument', name: '测量记录', version: '1.0.0', description: '通用测量卡片',
  capabilities: ['context.read', 'content.open'], contentTypes: [{ id: 'measurement', schemaVersion: 1, insertionLabel: '插入测量', schema: { type: 'object' }, view: [] }] };
afterEach(async () => {
  for (const { root, server } of fixtures.splice(0)) {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('mewiki-plugin-http-')) throw new Error('Unsafe cleanup path');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-plugin-http-'));
  const middleware = createPluginPackageMiddleware(new PluginPackageStore(path.join(root, 'plugins')));
  const server = createServer((request, response) => void middleware(request, response, () => { response.statusCode = 404; response.end(); }));
  fixtures.push({ root, server }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/mewiki/plugins`;
  const headers = { 'Content-Type': 'application/octet-stream', 'X-MeWiki-Request': 'plugins' };
  return { url, headers };
}

describe('local plugin package API', () => {
  it('inspects, installs, lists and removes a declaration through the same API', async () => {
    const { url, headers } = await fixture();
    const inspect = await fetch(url + '/inspect', { method: 'POST', headers, body: JSON.stringify(manifest) });
    expect(inspect.status).toBe(200); expect(await inspect.json()).toMatchObject({ manifest: { id: manifest.id }, sha256: expect.any(String) });
    expect(await (await fetch(url)).json()).toEqual({ plugins: [] });
    const installed = await fetch(url, { method: 'POST', headers, body: JSON.stringify(manifest) });
    expect(installed.status).toBe(200); expect(await installed.json()).toMatchObject({ plugin: { manifest: { id: manifest.id } } });
    const list = await fetch(url); expect(list.headers.get('cache-control')).toBe('no-store');
    expect(await list.json()).toMatchObject({ plugins: [{ manifest: { id: manifest.id } }] });
    const removed = await fetch(url, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: manifest.id }) });
    expect(removed.status).toBe(200); expect(await (await fetch(url)).json()).toEqual({ plugins: [] });
  });
  it('rejects foreign or opaque origins and mutations without the request marker', async () => {
    const { url, headers } = await fixture();
    for (const origin of ['https://example.com', 'null', 'http://localhost:5280']) {
      const response = await fetch(url, { method: 'POST', headers: { ...headers, Origin: origin }, body: JSON.stringify(manifest) });
      expect(response.status).toBe(403); expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect((await fetch(url, { headers: { Origin: origin } })).status).toBe(403);
    }
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: JSON.stringify(manifest) })).status).toBe(403);
    expect(await (await fetch(url)).json()).toEqual({ plugins: [] });
  });
  it('rejects malformed control requests, wrong methods and oversized uploads', async () => {
    const { url, headers } = await fixture();
    expect((await fetch(url, { method: 'PATCH', headers, body: '{}' })).status).toBe(405);
    expect((await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: Buffer.alloc(1024 * 1024 + 1) })).status).toBe(413);
    expect((await fetch(url + '/unknown')).status).toBe(404);
  });
});
