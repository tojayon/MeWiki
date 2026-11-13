import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useState } from 'react';
import { ExternalLink, Plug } from 'lucide-react';
import type { ExternalContentBlock } from './externalContent.ts';
import { useIntegration } from './IntegrationContext.ts';
import { parsePluginContent, pluginContentType } from '../plugins/sdk/runtime.ts';
import PluginContentView from '../plugins/PluginContentView.tsx';

export default function ExternalContentCard({ block, readOnly = true, onNote }: { block: ExternalContentBlock; readOnly?: boolean; onNote?: (note: string) => void }) {
  useLocale();
  const integration = useIntegration(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const plugin = integration.catalog.find(item => item.id === block.provider && integration.plugins[item.id] === 'enabled');
  let valid = false;
  try { valid = !!plugin && !!parsePluginContent(plugin, block); } catch { /* Unknown versions remain readable with their complete payload retained. */ }
  const canOpen = valid && plugin?.capabilities.includes('content.open') && (
    pluginContentType(plugin, block.contentType).source ||
    integration.connection?.providers.includes(block.provider) && integration.connection.capabilities.includes('content.open')
  );
  async function open() {
    setError(''); setBusy(true);
    try { await integration.openContent(block); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开外部内容。'); } finally { setBusy(false); }
  }
  return <article className="mewiki-external-card" data-provider={block.provider}>
    <header><Plug size={15} /><span>{plugin?.name ?? t('外部内容')}</span>
      {canOpen ? <button type="button" onClick={() => void open()} disabled={busy} title={t("在来源程序中定位此内容")}><ExternalLink size={14} />{busy ? t('正在定位…') : t('打开来源')}</button>
        : !valid && <button type="button" onClick={integration.showManager}>{plugin ? t('查看插件版本') : t('管理插件')}</button>}
    </header>
    <strong>{block.title}</strong>
    {valid && plugin ? <PluginContentView plugin={plugin} content={block} /> : block.summary && <p>{block.summary}</p>}
    {!valid && <small>{plugin ? t('此插件尚不支持该内容版本，原始内容已保留。') : t('启用对应插件后可打开来源。')}</small>}
    {readOnly ? block.note && <p className="mewiki-external-note">{block.note}</p> : <textarea aria-label={t("外部内容备注")} placeholder={t("记录观察…")} rows={2} value={block.note ?? ''} onChange={event => onNote?.(event.target.value)} />}
    <details><summary>{t("来源信息")}</summary><code>{block.provider} · {block.contentType} · v{block.schemaVersion}</code><pre>{JSON.stringify(block.data, null, 2)}</pre></details>
    {error && <p role="alert">{localizeError(error)}</p>}
  </article>;
}
