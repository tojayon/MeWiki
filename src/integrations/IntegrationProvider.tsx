import { translate } from "../i18n/locale.ts";
import { useLocale } from "../i18n/react.ts";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IntegrationContext } from './IntegrationContext.ts';
import { parseExternalContent, type ExternalContent } from './externalContent.ts';
import { loadHostSdk, type ConnectedApplication, type EmbeddedConnection } from './sdk.ts';
import { availablePlugins, loadPluginState, PLUGIN_STORAGE_KEY, updatePluginState, type PluginStatus } from '../plugins/registry.ts';
import PluginManager from '../plugins/PluginManager.tsx';
import './Integration.css';

interface InsertionRequest {
  provider: string;
  resolve: (content: ExternalContent | null) => void;
  dispose: () => void;
}

export default function IntegrationProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [plugins, setPlugins] = useState(() => loadPluginState(window.localStorage));
  const [content, setContent] = useState<ExternalContent | null>(null);
  const [connection, setConnection] = useState<ConnectedApplication | null>(null);
  const [error, setError] = useState('');
  const [manager, setManager] = useState(false);
  const [pending, setPending] = useState<InsertionRequest | null>(null);
  const pendingRef = useRef<InsertionRequest | null>(null);
  const finishInsertion = useCallback((request: InsertionRequest | null, value: ExternalContent | null) => {
    if (!request || pendingRef.current !== request) return;
    pendingRef.current = null; request.dispose(); setPending(null); request.resolve(value);
  }, []);
  useEffect(() => () => finishInsertion(pendingRef.current, null), [finishInsertion]);
  useEffect(() => {
    if (pending && plugins[pending.provider] !== 'enabled') finishInsertion(pending, null);
  }, [plugins, pending, finishInsertion]);
  const bridge = useRef<EmbeddedConnection | null>(null);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === PLUGIN_STORAGE_KEY || event.key === null) setPlugins(loadPluginState(window.localStorage)); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('embed') !== '1') return;
    let disposed = false;
    void loadHostSdk().then(sdk => {
      if (disposed) return;
      bridge.current = sdk.connectHost({
        onConnection: app => { if (!disposed) setConnection(app); },
        onContext: value => { if (disposed) return; const next = value === null ? null : parseExternalContent(value); setContent(next); setError(''); },
      });
      return bridge.current?.ready;
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : '外部程序连接失败。'); });
    return () => { disposed = true; bridge.current?.dispose(); bridge.current = null; };
  }, []);
  const setPlugin = useCallback((id: string, status: PluginStatus) => {
    const next = updatePluginState(loadPluginState(window.localStorage), id, status);
    try { window.localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(next)); setPlugins(next); setError(''); }
    catch { setError('浏览器未能保存插件设置，请检查可用存储空间。'); }
  }, []);
  const insertion = useMemo(() => {
    const plugin = availablePlugins.find(item => item.id === content?.provider && plugins[item.id] === 'enabled');
    if (!plugin || !content) return null;
    try { return { label: translate(plugin.insertionLabel, [], locale), content: plugin.validate(content) }; } catch { return null; }
  }, [plugins, content, locale]);
  const insertions = useMemo(() => availablePlugins.filter(plugin => plugins[plugin.id] === 'enabled').map(plugin => ({
    provider: plugin.id, label: translate(plugin.insertionLabel, [], locale),
    description: insertion?.content.provider === plugin.id ? insertion.content.title : translate(plugin.description, [], locale),
  })), [plugins, insertion, locale]);
  const chooseContent = useCallback((provider: string, signal: AbortSignal): Promise<ExternalContent | null> => {
    const plugin = availablePlugins.find(item => item.id === provider && plugins[item.id] === 'enabled');
    if (!plugin || signal.aborted) return Promise.resolve(null);
    if (insertion?.content.provider === provider) return Promise.resolve(insertion.content);
    finishInsertion(pendingRef.current, null);
    return new Promise(resolve => {
      const request: InsertionRequest = { provider, resolve, dispose: () => signal.removeEventListener('abort', aborted) };
      const aborted = () => finishInsertion(request, null);
      pendingRef.current = request; signal.addEventListener('abort', aborted, { once: true }); setPending(request);
    });
  }, [plugins, insertion, finishInsertion]);
  const openContent = useCallback(async (value: ExternalContent) => {
    const plugin = availablePlugins.find(item => item.id === value.provider && plugins[item.id] === 'enabled');
    if (!plugin) throw new Error('请先安装并启用此内容的插件。');
    const parsed = plugin.validate(value);
    if (connection?.providers.includes(value.provider) && connection.capabilities.includes('content.open') && bridge.current) await bridge.current.openContent(parsed);
    else {
      const opened = window.open(plugin.openUrl(parsed), '_blank', 'noopener,noreferrer');
      // noopener intentionally makes the return value unavailable in some browsers.
      void opened;
    }
  }, [plugins, connection]);
  const pendingPlugin = pending && availablePlugins.find(plugin => plugin.id === pending.provider);
  const ContentPicker = pendingPlugin?.ContentPicker;
  return <IntegrationContext.Provider value={{ plugins, content, insertion, insertions, chooseContent, connection, error, setPlugin, showManager: () => setManager(true), openContent }}>
    {children}
    {manager && <PluginManager onClose={() => setManager(false)} />}
    {pending && pendingPlugin && ContentPicker && <ContentPicker onClose={() => finishInsertion(pending, null)} onSelect={value => {
      if (loadPluginState(window.localStorage)[pending.provider] !== 'enabled') { finishInsertion(pending, null); return; }
      try { finishInsertion(pending, pendingPlugin.validate(value)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '外部内容无效。'); }
    }} />}
  </IntegrationContext.Provider>;
}
