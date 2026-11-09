import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
function health(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (request.url?.split('?')[0] !== '/api/mewiki/integration') return next();
  response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
  response.end(JSON.stringify({ name: 'MeWiki', integrationVersion: 1, sdk: '/integration/mewiki-host.js' }));
}
export function integrationPlugin(): Plugin {
  return { name: 'mewiki-integration', configureServer(server) {
    server.middlewares.use(health);
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/integration/mewiki-host.js') return next();
      // The SDK is an untransformed public module, including when imported by MeWiki itself.
      const origin = request.headers.origin;
      if (origin) {
        try { if (['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) response.setHeader('Access-Control-Allow-Origin', origin); } catch { /* Invalid origins receive no access grant. */ }
        response.setHeader('Vary', 'Origin');
      }
      void readFile(new URL('../public/integration/mewiki-host.js', import.meta.url)).then(source => {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.end(source);
      }).catch(next);
    });
    server.middlewares.use((request, _response, next) => { if (request.url?.split('?')[0] === '/integration/legacy-export.js') request.url = '/src/integrations/legacyBrowserExport.ts'; next(); });
  }, configurePreviewServer(server) { server.middlewares.use(health); } };
}
