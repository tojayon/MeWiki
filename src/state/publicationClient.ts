import type { PublicationJob, PublicationRequest, PublicationResult } from '../domain/publicationTypes.ts';
import { PublicationContentError, readPublicationDiagnostics } from '../domain/publicationDiagnostics.ts';
async function request(route: string, init: RequestInit = {}): Promise<PublicationJob> {
  const response = await fetch('/api/mewiki/publications/jobs' + route, { ...init, cache: 'no-store', headers: { ...init.headers, 'X-MeWiki-Request': 'publications' } });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('导出服务尚未加载，请重启 MeWiki 本地服务。');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? '图文导出失败，请重试。');
  return value;
}
export async function generatePublication(value: PublicationRequest, signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<PublicationResult> {
  let id: string | undefined;
  let released = false;
  const release = () => {
    if (!id || released) return;
    released = true;
    void request('/' + encodeURIComponent(id), { method: 'DELETE', keepalive: true }).catch(() => {});
  };
  // Start cleanup during the exit event, before the document stops processing promises.
  window.addEventListener('pagehide', release);
  signal.addEventListener('abort', release, { once: true });
  try {
    const job = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal });
    if (typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(job.id)) throw new Error('图文导出服务返回了无效的任务。');
    id = job.id;
    for (;;) {
      signal.throwIfAborted();
      const state = await request('/' + encodeURIComponent(id), { signal });
      progress(state.completed, state.total);
      if (state.status === 'error') {
        const message = state.error ?? '图文导出失败，请重试。';
        const diagnostics = readPublicationDiagnostics(state.diagnostics, new Set(value.document.blocks.map(block => block.id)));
        throw diagnostics.length ? new PublicationContentError(message, diagnostics) : new Error(message);
      }
      if (state.status === 'complete' && state.result) return state.result;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 400);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  } finally {
    window.removeEventListener('pagehide', release);
    signal.removeEventListener('abort', release);
    release();
  }
}
