import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useEffect, useRef, useState } from 'react';
import { Plug, Upload } from 'lucide-react';
import { useIntegration } from '../integrations/IntegrationContext.ts';
import { availablePlugins, pluginStatus } from './registry.ts';
import type { PluginManifest } from './sdk/types.ts';
import { activatePluginVersion, inspectPluginPackage, installPluginPackage, listPluginPackages, notifyPluginPackagesChanged, uninstallPluginPackage, type InstalledPlugin } from './packageClient.ts';
import { localizeError } from '../i18n/locale.ts';
import { useContext } from 'react';
import { LibraryWorkspaceContext } from '../state/LibraryWorkspaceContext.ts';
import { openImageCreation } from '../state/publicationNavigation.ts';
function capabilityLabel(plugin: PluginManifest) {
  const context = plugin.capabilities.includes('context.read');
  const open = plugin.capabilities.includes('content.open');
  const exporting = plugin.exporters?.length ? t('能力：按你的选择排版并导出图文；不访问未选择的资料。') : '';
  if (context && open) return `${exporting}${exporting ? ' ' : ''}${t('能力：读取外部程序提供的当前内容；按你的点击返回外部程序。')}`;
  if (context) return `${exporting}${exporting ? ' ' : ''}${t('能力：读取外部程序提供的当前内容。')}`;
  if (open) return `${exporting}${exporting ? ' ' : ''}${t('能力：按你的点击返回外部程序。')}`;
  if (exporting) return exporting;
  return t('能力：本地表单与内容显示。');
}
export default function PluginManager() {
  useLocale();
  const integration = useIntegration();
  const workspace = useContext(LibraryWorkspaceContext);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [preview, setPreview] = useState<{ file: File; manifest: PluginManifest; sha256: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => { setInstalled(await listPluginPackages()); };
  useEffect(() => { let active = true; void listPluginPackages().then(values => { if (active) setInstalled(values); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法读取已安装的插件。'); }); return () => { active = false; }; }, [integration.catalog]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : '插件管理失败。'); } finally { setBusy(false); }
  };
  return <section aria-label={t("插件管理")} data-testid="mewiki-plugin-manager" className="mewiki-plugin-manager">
    <p>{t("插件为外部程序提供专门的内容卡片与操作。停用或卸载插件会保留笔记中的全部内容。")}</p>
    <div className="mewiki-plugin-install"><input ref={input} type="file" accept=".json,.zip,.mewiki-plugin,application/json,application/zip" aria-label={t('选择插件包')} disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; setPreview(null);
      if (file) void run(async () => { const result = await inspectPluginPackage(file); setPreview({ file, ...result }); });
    }} /><p>{t('支持声明式 JSON 或 ZIP 插件包，最大 1 MiB。')}</p></div>
    {preview && <section className="mewiki-plugin-preview" aria-label={t('插件安装预览')}>
      <h3>{preview.manifest.name} <small>{preview.manifest.version}</small></h3><p>{preview.manifest.description}</p><p>{t('来源：本地文件')} · {preview.file.name}</p><code>{preview.manifest.id}</code><small>SHA-256: {preview.sha256}</small>
      <p>{capabilityLabel(preview.manifest)}</p>
      <div><button type="button" disabled={busy} onClick={() => void run(async () => {
        const checked = await inspectPluginPackage(preview.file);
        if (checked.sha256 !== preview.sha256) throw new Error('插件包在预览后发生变化，请重新选择。');
        await installPluginPackage(preview.file);
        if (integration.catalog.some(item => item.id === preview.manifest.id)) integration.setPlugin(preview.manifest.id, 'disabled');
        notifyPluginPackagesChanged(); await refresh(); setPreview(null); setNotice('插件包已安装，请在下方启用。');
      })}><Upload size={15} />{t('确认安装')}</button><button type="button" disabled={busy} onClick={() => setPreview(null)}>{t('取消')}</button></div>
    </section>}
    {error && <p role="alert">{localizeError(error)}</p>}{notice && <p role="status">{t(notice)}</p>}
    {integration.catalog.map(plugin => {
      const status = pluginStatus(integration.plugins, plugin.id);
      const bundled = availablePlugins.some(item => item.id === plugin.id);
      const record = installed.find(item => item.manifest.id === plugin.id);
      return <section className="mewiki-plugin-row" key={plugin.id}>
        <Plug size={22} /><div><h3>{t(plugin.name)} <small>{plugin.version}</small></h3><p>{t(plugin.description)}</p>
          <small>{bundled ? t('随应用提供') : t('来源：本地文件')}</small><code>{plugin.id}</code>
          <small>{capabilityLabel(plugin)}</small>
          {record && record.versions.length > 1 && <label>{t('已安装版本')}<select aria-label={t`切换 ${plugin.name} 的版本`} value={plugin.version} disabled={busy} onChange={event => void run(async () => {
            await activatePluginVersion(plugin.id, event.target.value); integration.setPlugin(plugin.id, 'disabled'); notifyPluginPackagesChanged(); await refresh(); setNotice('版本已切换，请重新启用插件。');
          })}>{record.versions.map(version => <option key={version} value={version}>{version}</option>)}</select></label>}
          <span className="mewiki-plugin-state">{status === 'available' ? bundled ? t('未安装') : t('已安装，未启用') : status === 'enabled' ? t('已启用') : t('已停用')}</span>
        </div><div className="mewiki-plugin-actions">
          {status === 'enabled' && workspace && plugin.exporters?.map(exporter => <button key={exporter.id} type="button" disabled={busy} onClick={() => openImageCreation(plugin, exporter, workspace.profile.id, workspace.profile.directory, setError, t('图片创作'))}>{t('打开图片创作')}</button>)}
          <button type="button" disabled={busy} onClick={() => integration.setPlugin(plugin.id, status === 'enabled' ? 'disabled' : 'enabled')}>{status === 'available' && bundled ? t('安装并启用') : status === 'enabled' ? t('停用') : t('启用')}</button>
          {(status !== 'available' || !bundled) && <button type="button" disabled={busy} onClick={() => void run(async () => {
            if (!bundled) await uninstallPluginPackage(plugin.id);
            integration.setPlugin(plugin.id, 'available');
            if (!bundled) { notifyPluginPackagesChanged(); await refresh(); }
          })}>{t("卸载")}</button>}
        </div>
      </section>;
    })}
    {integration.connection && <p>{t("已连接：")}{integration.connection.name} · {integration.connection.origin}</p>}
  </section>;
}
