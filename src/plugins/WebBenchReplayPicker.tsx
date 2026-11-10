import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import DeviceInspectorModal from '../components/DeviceInspectorModal.tsx';
import type { ContentPickerProps } from './ContentPickerProps.ts';
import { localApplicationUrl } from './webbench.ts';
import { createReplayReference, fetchReplayCatalog, type ReplayCatalogEntry, type ReplayConnection } from './webbenchReplayCatalog.ts';

const settingsKey = 'mewiki:plugins:webbench:connection:v1';
function readConnection(): ReplayConnection {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) ?? 'null');
    return { serviceBase: localApplicationUrl(saved?.serviceBase), webbenchOrigin: localApplicationUrl(saved?.webbenchOrigin) };
  } catch { return { serviceBase: 'http://127.0.0.1:8766', webbenchOrigin: 'http://127.0.0.1:4173' }; }
}

export default function WebBenchReplayPicker({ onSelect, onClose }: ContentPickerProps) {
  useLocale();
  const [connection] = useState(readConnection);
  const [serviceBase, setServiceBase] = useState(connection.serviceBase);
  const [webbenchOrigin, setWebbenchOrigin] = useState(connection.webbenchOrigin);
  const [request, setRequest] = useState<{ base: string } | null>({ base: connection.serviceBase });
  const [entries, setEntries] = useState<ReplayCatalogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [time, setTime] = useState('');
  const [loopId, setLoopId] = useState('');

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void fetchReplayCatalog(request.base, controller.signal).then(items => {
      if (!controller.signal.aborted) setEntries(items);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error && !['TypeError', 'TimeoutError'].includes(cause.name)
        ? cause.message : '无法连接回放查询服务。请确认服务已启动，检查连接地址后刷新实验列表。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);

  const selected = entries?.find(item => item.id === selectedId);
  let reference = null;
  let validation = '';
  if (selected) {
    try {
      if (!time.trim()) throw new Error('请输入物理时间。');
      reference = createReplayReference(selected, { serviceBase, webbenchOrigin }, Number(time), loopId || undefined);
    } catch (cause) { validation = cause instanceof Error ? cause.message : t('回放位置无效。'); }
  }
  const refresh = () => {
    try {
      const base = localApplicationUrl(serviceBase.trim());
      setEntries(null); setSelectedId(''); setError(''); setLoading(true); setRequest({ base });
    }
    catch { setError('查询服务地址应为本机 HTTP 或 HTTPS 地址。'); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reference || loading) return;
    try { localStorage.setItem(settingsKey, JSON.stringify({ serviceBase: reference.data.serviceBase, webbenchOrigin: reference.data.webbenchOrigin })); } catch { /* Connection preferences are optional. */ }
    onSelect(reference);
  };
  return <DeviceInspectorModal open title={t("插入回放位置")} testId="mewiki-replay-picker" onClose={onClose} className="mewiki-replay-picker">
    <form onSubmit={submit} noValidate>
      <div className="mewiki-replay-catalog-label"><label htmlFor="mewiki-replay-select">{t("实验回放")}</label>
        <button type="button" data-ui="icon-action" aria-label={t("刷新实验列表")} title={t("刷新实验列表")} onClick={refresh}><RefreshCw size={16} /></button>
      </div>
      <select id="mewiki-replay-select" value={selectedId} disabled={loading || !entries?.length} onChange={event => {
        const item = entries?.find(entry => entry.id === event.target.value);
        setSelectedId(event.target.value); setTime(item ? String(item.manifest.timeBase.start) : ''); setLoopId('');
      }}>
        <option value="">{loading ? t('正在读取实验…') : t('选择一个实验…')}</option>
        {entries?.map(item => <option key={item.id} value={item.id}>{item.manifest.run.title} · {item.file}</option>)}
      </select>
      {loading && <p role="status">{t("正在读取实验…")}</p>}
      {entries?.length === 0 && <p role="status">{t("还没有可用的实验回放。请先通过 WebBench 准备实验记录，再刷新列表。")}</p>}
      {selected && <>
        <p className="mewiki-replay-range">{t("时间范围：")}{selected.manifest.timeBase.start}–{selected.manifest.timeBase.end}  {t("秒")}</p>
        <div className="mewiki-replay-fields">
          <label>{t("物理时间（秒）")}<input type="number" step="any" min={selected.manifest.timeBase.start} max={selected.manifest.timeBase.end}
            value={time} onChange={event => setTime(event.target.value)} aria-invalid={!!validation} /></label>
          <label>{t("环路")}<select value={loopId} onChange={event => setLoopId(event.target.value)}>
            <option value="">{t("全部环路")}</option>{selected.manifest.loopIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select></label>
        </div>
      </>}
      {(error || validation) && <p role="alert">{localizeError(error || validation)}</p>}
      <details className="mewiki-replay-connection"><summary>{t("连接设置")}</summary>
        <label>{t("回放查询服务")}<input type="url" value={serviceBase} onChange={event => {
          setServiceBase(event.target.value); setRequest(null); setEntries(null); setSelectedId(''); setError(''); setLoading(false);
        }} /></label>
        <label>{t("WebBench 地址")}<input type="url" value={webbenchOrigin} onChange={event => setWebbenchOrigin(event.target.value)} /></label>
        <button type="button" onClick={refresh}>{t("连接并刷新")}</button>
      </details>
      <footer><button type="button" onClick={onClose}>{t("取消")}</button><button type="submit" disabled={!reference || loading}>{t("插入回放位置")}</button></footer>
    </form>
  </DeviceInspectorModal>;
}
