// MeWiki Integration SDK v1. This file is served by MeWiki and shared by every host.
export const PROTOCOL = 'mewiki.integration';
export async function exportLegacyBrowserNotebook() {
  const url = new URL('./legacy-export.js', import.meta.url).href;
  const exporter = await import(url);
  return exporter.exportLegacyBrowserNotebook();
}
const LIMIT = 280 * 1024;
function originOf(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error('需要准确的程序来源地址。');
  return url.origin;
}
function sessionId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(value)) throw new Error('连接会话无效。');
  return value;
}
function jsonSize(value) {
  const text = JSON.stringify(value);
  if (!text || text.length > LIMIT) throw new Error('传递的内容过大，请使用附件或内容引用。');
}
export function integrationUrl(url, { hostOrigin, session }) {
  const target = new URL(url);
  originOf(target.origin);
  target.searchParams.set('embed', '1');
  target.searchParams.set('hostOrigin', originOf(hostOrigin));
  target.searchParams.set('session', sessionId(session));
  return target.href;
}
export function createMessagePeer({ target, origin, session, self = window, timeout = 12000 }) {
  origin = originOf(origin); session = sessionId(session);
  const handlers = new Map(); const pending = new Map(); const received = new Map();
  let disposed = false; let sequence = 0;
  function send(fields) {
    if (disposed) throw new Error('连接已关闭。');
    const message = { protocol: PROTOCOL, version: 1, session, ...fields };
    jsonSize(message); target.postMessage(message, origin);
  }
  async function receive(event) {
    if (disposed || event.origin !== origin || event.source !== target) return;
    const message = event.data;
    if (!message || message.protocol !== PROTOCOL || message.version !== 1 || message.session !== session) return;
    try { jsonSize(message); } catch { return; }
    if (typeof message.replyTo === 'string') {
      const waiting = pending.get(message.replyTo);
      if (!waiting) return;
      clearTimeout(waiting.timer); pending.delete(message.replyTo);
      if (message.error) waiting.reject(new Error(typeof message.error.message === 'string' ? message.error.message : '对方无法执行此操作。'));
      else waiting.resolve(message.result);
      return;
    }
    if (typeof message.id !== 'string' || message.id.length > 128 || typeof message.method !== 'string' || message.method.length > 100) return;
    if (!received.has(message.id)) {
      if (received.size >= 256) received.delete(received.keys().next().value);
      received.set(message.id, Promise.resolve().then(async () => {
        const handler = handlers.get(message.method);
        if (!handler) return { error: { code: 'unsupported_method', message: '对方尚未支持此操作。' } };
        try { return { result: await handler(message.params) ?? null }; }
        catch (error) { return { error: { code: 'request_failed', message: error instanceof Error ? error.message : '操作未完成。' } }; }
      }));
    }
    const response = await received.get(message.id);
    if (!disposed) { try { send({ replyTo: message.id, ...response }); } catch { /* A disconnected or oversized reply cannot be delivered. */ } }
  }
  self.addEventListener('message', receive);
  return {
    handle(method, handler) { handlers.set(method, handler); return () => handlers.delete(method); },
    request(method, params = null) {
      if (disposed) return Promise.reject(new Error('连接已关闭。'));
      return new Promise((resolve, reject) => {
        const id = `${session}-${++sequence}`;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('连接超时，请确认对方程序正在运行。')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        try { send({ id, method, params }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    dispose() {
      disposed = true; self.removeEventListener('message', receive); handlers.clear(); received.clear();
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('连接已关闭。')); } pending.clear();
    },
  };
}
function validateApplication(app) {
  if (!app || typeof app.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(app.id) || typeof app.name !== 'string' || app.name.length > 100 || !Array.isArray(app.providers) || app.providers.length > 20 || !app.providers.every(id => typeof id === 'string' && /^[a-zA-Z0-9._-]{1,128}$/.test(id)) || !Array.isArray(app.capabilities) || !app.capabilities.every(cap => ['context.read', 'content.open'].includes(cap))) throw new Error('程序身份或接口能力无效。');
  return { id: app.id, name: app.name, providers: app.providers, capabilities: app.capabilities };
}
export function connectMeWiki({ iframe, url, app, onOpen, timeout = 35000 }) {
  const identity = validateApplication(app); const session = crypto.randomUUID();
  const origin = new URL(url).origin;
  const peer = createMessagePeer({ target: iframe.contentWindow, origin, session, timeout });
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const timer = setTimeout(() => rejectReady(new Error('MeWiki 连接超时，请启动或更新 MeWiki。')), timeout);
  peer.handle('embed.ready', () => ({ app: identity }));
  peer.handle('embed.connected', () => { clearTimeout(timer); resolveReady(); return { connected: true }; });
  peer.handle('content.open', async content => {
    if (!identity.capabilities.includes('content.open') || !identity.providers.includes(content?.provider) || !onOpen) throw new Error('此程序没有开放相应的内容操作。');
    await onOpen(content); return { opened: true };
  });
  iframe.src = integrationUrl(url, { hostOrigin: window.location.origin, session });
  return {
    ready,
    async setContext(content) {
      await ready;
      if (!identity.capabilities.includes('context.read') || (content && !identity.providers.includes(content.provider))) throw new Error('此程序没有开放相应的内容来源。');
      return peer.request('context.set', content);
    },
    dispose() { clearTimeout(timer); rejectReady(new Error('连接已关闭。')); peer.dispose(); },
  };
}
export function connectHost({ onContext, onConnection, timeout = 35000 }) {
  const query = new URLSearchParams(window.location.search);
  if (query.get('embed') !== '1' || window.parent === window) return null;
  const origin = originOf(query.get('hostOrigin')); const session = sessionId(query.get('session'));
  const peer = createMessagePeer({ target: window.parent, origin, session, timeout });
  let app;
  peer.handle('context.set', async content => {
    if (!app?.capabilities.includes('context.read') || (content && !app.providers.includes(content.provider))) throw new Error('未授权的内容来源。');
    await onContext(content); return { accepted: true };
  });
  const ready = peer.request('embed.ready').then(async result => {
    app = validateApplication(result?.app); onConnection?.({ ...app, origin });
    await peer.request('embed.connected'); return app;
  });
  ready.catch(() => {});
  return {
    ready,
    async openContent(content) {
      await ready;
      if (!app.capabilities.includes('content.open') || !app.providers.includes(content.provider)) throw new Error('当前程序未提供此内容的打开能力。');
      return peer.request('content.open', content);
    },
    dispose() { peer.dispose(); },
  };
}
