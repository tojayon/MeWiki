import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import DeviceInspectorModal from '../components/DeviceInspectorModal.tsx';
import { useLocale } from '../i18n/react.ts';
import { localizeError, t } from '../i18n/locale.ts';
import type { ExternalContent } from '../integrations/externalContent.ts';
import type { PluginManifest, PluginContentType } from './sdk/types.ts';
import { createPluginContent, fetchPluginCatalog, pluginCatalogValue, readPluginValue } from './sdk/runtime.ts';
import { validatePluginOrigin } from './sdk/manifest.ts';

interface Props { plugin: PluginManifest; type: PluginContentType; onSelect: (content: ExternalContent) => void; onClose: () => void }
export default function PluginContentPicker({ plugin, type, onSelect, onClose }: Props) {
  useLocale();
  const picker = type.picker!;
  const storageKey = `mewiki:plugins:${plugin.id}:connection:v1`;
  const [connection, setConnection] = useState<Record<string, string>>(() => {
    let saved: Record<string, unknown> = {};
    try { const source = localStorage.getItem(storageKey) ?? (picker.connectionStorageKey ? localStorage.getItem(picker.connectionStorageKey) : null); const value = JSON.parse(source ?? '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch { /* Use declared defaults. */ }
    return Object.fromEntries((picker.connection ?? []).map(field => { let value = field.default; try { if (typeof saved[field.key] === 'string') value = validatePluginOrigin(saved[field.key], true); } catch { /* Invalid preferences are not used. */ } return [field.key, value]; }));
  });
  const [request, setRequest] = useState<Record<string, string> | null>(picker.catalog ? connection : null);
  const [entries, setEntries] = useState<Record<string, unknown>[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [fields, setFields] = useState<Record<string, string | number>>(() => Object.fromEntries(picker.fields.map(field => [field.key, field.default ?? ''])));
  const [loading, setLoading] = useState(!!picker.catalog);
  const [error, setError] = useState('');
  const catalog = picker.catalog;
  useEffect(() => {
    if (!request || !catalog) return;
    const controller = new AbortController();
    void fetchPluginCatalog(catalog, request, controller.signal).then(items => {
      if (!controller.signal.aborted) setEntries(items);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error && !['TypeError', 'TimeoutError'].includes(cause.name) ? cause.message : t('无法连接插件目录服务，请检查地址后重试。'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, catalog]);
  const selected = catalog ? entries?.find(item => pluginCatalogValue(item, catalog.idPath) === selectedId) : undefined;
  const scope = { fields, connection, selected };
  let reference: ExternalContent | null = null, validation = '';
  if (!catalog || selected) {
    try { reference = createPluginContent(plugin, type.id, scope); }
    catch (cause) { validation = cause instanceof Error ? cause.message : t('插件内容无效。'); }
  }
  function refresh() {
    try {
      const normalized = Object.fromEntries(Object.entries(connection).map(([key, value]) => [key, validatePluginOrigin(value.trim(), true)]));
      setConnection(normalized); setEntries(null); setSelectedId(''); setError(''); setLoading(!!catalog); setRequest(catalog ? normalized : null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('插件连接地址无效。')); }
  }
  function choose(id: string) {
    setSelectedId(id);
    const item = entries?.find(entry => pluginCatalogValue(entry, catalog!.idPath) === id);
    setFields(Object.fromEntries(picker.fields.map(field => {
      let value: string | number = field.default ?? '';
      if (item && field.initial) { try { const initial = readPluginValue(field.initial, { selected: item }); if (typeof initial === 'number' || typeof initial === 'string') value = initial; } catch { /* Missing fields cannot be submitted. */ } }
      return [field.key, value];
    })));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reference || loading) return;
    try { localStorage.setItem(storageKey, JSON.stringify(connection)); } catch { /* Connection preferences are optional. */ }
    onSelect(reference);
  }
  return <DeviceInspectorModal open title={t(picker.title)} testId="mewiki-plugin-picker" onClose={onClose} className="mewiki-plugin-picker">
    <form onSubmit={submit} noValidate>
      {catalog && <>
        <div className="mewiki-plugin-catalog-label"><label htmlFor="mewiki-plugin-record">{t(catalog.label)}</label><button type="button" data-ui="icon-action" aria-label={t(catalog.refreshLabel)} title={t(catalog.refreshLabel)} onClick={refresh}><RefreshCw size={16} /></button></div>
        <select id="mewiki-plugin-record" value={selectedId} disabled={loading || !entries?.length} onChange={event => choose(event.target.value)}>
          <option value="">{loading ? t(catalog.loadingText) : t('选择一条记录…')}</option>
          {entries?.map(item => { const id = String(pluginCatalogValue(item, catalog.idPath)); return <option key={id} value={id}>{String(pluginCatalogValue(item, catalog.labelPath) ?? id)}</option>; })}
        </select>
        {loading && <p role="status">{t(catalog.loadingText)}</p>}
        {entries?.length === 0 && <p role="status">{t(catalog.emptyText)}</p>}
      </>}
      {(!catalog || selected) && <div className="mewiki-plugin-fields">{picker.fields.map(field => {
        let options: unknown[] = [], min: number | undefined, max: number | undefined;
        try {
          if (field.options) { const list = readPluginValue(field.options, scope); if (Array.isArray(list)) options = list; }
          const low = typeof field.min === 'object' ? readPluginValue(field.min, scope) : field.min;
          const high = typeof field.max === 'object' ? readPluginValue(field.max, scope) : field.max;
          if (typeof low === 'number') min = low; if (typeof high === 'number') max = high;
        } catch { /* Invalid data cannot be submitted. */ }
        const optionValue = (option: unknown) => typeof option === 'object' && option ? (option as Record<string, unknown>).id : option;
        return <label key={field.key}>{t(field.label)}{field.type === 'select' ? <select aria-label={t(field.label)} value={options.findIndex(option => optionValue(option) === fields[field.key]) < 0 ? '' : String(options.findIndex(option => optionValue(option) === fields[field.key]))} onChange={event => {
          const value = event.target.value === '' ? '' : optionValue(options[Number(event.target.value)]);
          if (typeof value === 'string' || typeof value === 'number') setFields(previous => ({ ...previous, [field.key]: value }));
        }}>
          <option value="">{field.emptyLabel ? t(field.emptyLabel) : t('请选择…')}</option>{options.map((option, index) => { const value = optionValue(option); const label = field.optionsLabelPath ? pluginCatalogValue(option, field.optionsLabelPath) : value; return <option key={index} value={String(index)}>{String(label ?? value)}</option>; })}
        </select> : <input type={field.type} step={field.type === 'number' ? 'any' : undefined} min={min} max={max} value={fields[field.key] ?? ''} aria-invalid={!!validation} onChange={event => setFields(previous => ({ ...previous, [field.key]: field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value }))} />}</label>;
      })}</div>}
      {(error || validation) && <p role="alert">{localizeError(error || validation)}</p>}
      {!!picker.connection?.length && <details className="mewiki-plugin-connection"><summary>{t('连接设置')}</summary>{picker.connection.map(field => <label key={field.key}>{t(field.label)}<input type="url" value={connection[field.key] ?? field.default} onChange={event => {
        setConnection(previous => ({ ...previous, [field.key]: event.target.value })); setRequest(null); setEntries(null); setSelectedId(''); setError(''); setLoading(false);
      }} /></label>)}{catalog && <button type="button" onClick={refresh}>{t('连接并刷新')}</button>}</details>}
      <footer><button type="button" onClick={onClose}>{t('取消')}</button><button type="submit" disabled={!reference || loading}>{t(type.insertionLabel)}</button></footer>
    </form>
  </DeviceInspectorModal>;
}
