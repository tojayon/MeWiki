import { translate } from "../i18n/locale.ts";
import { useLocale } from "../i18n/react.ts";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IntegrationContext } from './IntegrationContext.ts';
import { parseExternalContent, type ExternalContent } from './externalContent.ts';
import { loadHostSdk, type ConnectedApplication, type EmbeddedConnection } from './sdk.ts';
import { availablePlugins, createPluginRegistry, loadPluginState, PLUGIN_STORAGE_KEY, updatePluginState, type PluginStatus } from '../plugins/registry.ts';
import type { PluginManifest } from '../plugins/sdk/types.ts';
import { buildPluginSourceUrl, parsePluginContent, pluginContentType } from '../plugins/sdk/runtime.ts';
import { listPluginPackages, PLUGIN_PACKAGES_EVENT, PLUGIN_PACKAGES_STORAGE_KEY } from '../plugins/packageClient.ts';
import PluginContentPicker from '../plugins/PluginContentPicker.tsx';
import { openSettings } from '../state/settingsNavigation.ts';
import './Integration.css';

interface InsertionRequest {
  provider: string;
  contentType: string;
  definition: PluginManifest;
  resolve: (content: ExternalContent | null) => void;
  dispose: () => void;
}

export default function IntegrationProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [catalog, setCatalog] = useState<readonly PluginManifest[]>(availablePlugins);
  const [catalogReady, setCatalogReady] = useState(false);
  const catalogRef = useRef(catalog);
  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  const [plugins, setPlugins] = useState(() => loadPluginState(window.localStorage));
  const [content, setContent] = useState<ExternalContent | null>(null);
  const [connection, setConnection] = useState<ConnectedApplication | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<InsertionRequest | null>(null);
  const pendingRef = useRef<InsertionRequest | null>(null);
  const finishInsertion = useCallback((request: InsertionRequest | null, value: ExternalContent | null) => {
    if (!request || pendingRef.current !== request) return;
    pendingRef.current = null; request.dispose(); setPending(null); request.resolve(value);
  }, []);
  useEffect(() => () => finishInsertion(pendingRef.current, null), [finishInsertion]);
  useEffect(() => {
    if (pending && (plugins[pending.provider] !== 'enabled' || !catalog.includes(pending.definition))) finishInsertion(pending, null);
  }, [plugins, pending, catalog, finishInsertion]);
  const bridge = useRef<EmbeddedConnection | null>(null);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === PLUGIN_STORAGE_KEY || event.key === null) setPlugins(loadPluginState(window.localStorage)); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    let sequence = 0, disposed = false;
    const reload = async () => {
      const revision = ++sequence;
      try {
        const installed = await listPluginPackages();
        const next = createPluginRegistry([...availablePlugins, ...installed.map(item => item.manifest)]);
        if (!disposed && revision === sequence) setCatalog(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      } catch (cause) { if (!disposed && revision === sequence) setError(cause instanceof Error ? cause.message : '无法读取已安装的插件。'); }
      finally { if (!disposed && revision === sequence) setCatalogReady(true); }
    };
    const changed = (event: StorageEvent) => { if (event.key === PLUGIN_PACKAGES_STORAGE_KEY || event.key === null) void reload(); };
    const refresh = () => { void reload(); };
    refresh(); window.addEventListener(PLUGIN_PACKAGES_EVENT, refresh); window.addEventListener('storage', changed); window.addEventListener('focus', refresh);
    return () => { disposed = true; window.removeEventListener(PLUGIN_PACKAGES_EVENT, refresh); window.removeEventListener('storage', changed); window.removeEventListener('focus', refresh); };
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
    const next = updatePluginState(loadPluginState(window.localStorage), id, status, catalogRef.current);
    try { window.localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(next)); setPlugins(next); setError(''); }
    catch { setError('浏览器未能保存插件设置，请检查可用存储空间。'); }
  }, []);
  const insertion = useMemo(() => {
    const plugin = catalog.find(item => item.id === content?.provider && plugins[item.id] === 'enabled' && item.capabilities.includes('context.read'));
    if (!plugin || !content) return null;
    try { return { label: translate(pluginContentType(plugin, content.contentType).insertionLabel, [], locale), content: parsePluginContent(plugin, content) }; } catch { return null; }
  }, [catalog, plugins, content, locale]);
  const insertions = useMemo(() => catalog.filter(plugin => plugins[plugin.id] === 'enabled').flatMap(plugin => plugin.contentTypes.filter(type => type.picker || insertion?.content.provider === plugin.id && insertion.content.contentType === type.id).map(type => ({
    provider: `${plugin.id}#${type.id}`, label: translate(type.insertionLabel, [], locale),
    description: insertion?.content.provider === plugin.id && insertion.content.contentType === type.id ? insertion.content.title : translate(plugin.description, [], locale),
  }))), [catalog, plugins, insertion, locale]);
  const chooseContent = useCallback((token: string, signal: AbortSignal): Promise<ExternalContent | null> => {
    const [provider, requestedType] = token.split('#');
    const plugin = catalog.find(item => item.id === provider && plugins[item.id] === 'enabled');
    if (!plugin || signal.aborted) return Promise.resolve(null);
    const type = plugin.contentTypes.find(item => requestedType ? item.id === requestedType : item.picker || insertion?.content.provider === provider && insertion.content.contentType === item.id);
    if (!type) return Promise.resolve(null);
    if (insertion?.content.provider === provider && insertion.content.contentType === type.id) return Promise.resolve(insertion.content);
    if (!type.picker) return Promise.resolve(null);
    finishInsertion(pendingRef.current, null);
    return new Promise(resolve => {
      const request: InsertionRequest = { provider, contentType: type.id, definition: plugin, resolve, dispose: () => signal.removeEventListener('abort', aborted) };
      const aborted = () => finishInsertion(request, null);
      pendingRef.current = request; signal.addEventListener('abort', aborted, { once: true }); setPending(request);
    });
  }, [catalog, plugins, insertion, finishInsertion]);
  const openContent = useCallback(async (value: ExternalContent) => {
    const plugin = catalogRef.current.find(item => item.id === value.provider && loadPluginState(window.localStorage)[item.id] === 'enabled' && item.capabilities.includes('content.open'));
    if (!plugin) throw new Error('请先安装并启用此内容的插件。');
    const parsed = parsePluginContent(plugin, value);
    if (connection?.providers.includes(value.provider) && connection.capabilities.includes('content.open') && bridge.current) await bridge.current.openContent(parsed);
    else {
      const opened = window.open(buildPluginSourceUrl(plugin, parsed), '_blank', 'noopener,noreferrer');
      // noopener intentionally makes the return value unavailable in some browsers.
      void opened;
    }
  }, [connection]);
  const pendingPlugin = pending && catalog.find(plugin => plugin === pending.definition);
  const pendingType = pendingPlugin?.contentTypes.find(type => type.id === pending?.contentType);
  return <IntegrationContext.Provider value={{ catalogReady, catalog, plugins, content, insertion, insertions, chooseContent, connection, error, setPlugin, showManager: () => openSettings('plugins'), openContent }}>
    {children}
    {pending && pendingPlugin && pendingType?.picker && <PluginContentPicker key={`${pendingPlugin.id}:${pendingType.id}`} plugin={pendingPlugin} type={pendingType} onClose={() => finishInsertion(pending, null)} onSelect={value => {
      if (loadPluginState(window.localStorage)[pending.provider] !== 'enabled' || !catalogRef.current.includes(pending.definition)) { finishInsertion(pending, null); return; }
      try { finishInsertion(pending, parsePluginContent(pendingPlugin, value)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '外部内容无效。'); }
    }} />}
  </IntegrationContext.Provider>;
}
