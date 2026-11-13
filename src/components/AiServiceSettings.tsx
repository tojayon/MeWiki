import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Eraser, Plus, RefreshCw, Save, Square, Trash2, Undo2, X } from 'lucide-react';
import { getAiModels, getAiSettings, saveAiSettings, testAiProvider } from '../ai/client.ts';
import type { AiConnectionTest, AiProtocol, AiProvider, AiProviderInput, AiSettings } from '../ai/types.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './AiServiceSettings.css';

type Operation = 'loading' | 'saving' | 'testing' | 'models';
function editable(provider: AiProvider): AiProviderInput {
  return { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, protocol: provider.protocol, model: provider.model };
}
function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : 'AI 服务操作失败，请稍后重试。'; }

export default function AiServiceSettings() {
  useLocale();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [providers, setProviders] = useState<AiProviderInput[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Operation | null>('loading');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<AiConnectionTest | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const abortCurrent = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  const provider = providers.find(item => item.id === selectedId);
  const saved = settings?.providers.find(item => item.id === selectedId);
  const dirty = settings !== null && (JSON.stringify(providers) !== JSON.stringify(settings.providers.map(editable)) || defaultId !== settings.defaultProviderId);
  const locked = busy !== null || reloadRequired;
  const canProbe = !!saved && !dirty && !locked;

  function restore(snapshot: AiSettings, selection?: string) {
    setSettings(snapshot); setProviders(snapshot.providers.map(editable)); setDefaultId(snapshot.defaultProviderId);
    setSelectedId(snapshot.providers.some(item => item.id === selection) ? selection! : snapshot.defaultProviderId ?? snapshot.providers[0]?.id ?? '');
    setModels([]); setTestResult(null); setReloadRequired(false);
  }
  useEffect(() => {
    const controller = new AbortController(); request.current = controller; const token = ++generation.current;
    void getAiSettings(controller.signal).then(snapshot => {
      if (token !== generation.current || controller.signal.aborted) return;
      setSettings(snapshot); setProviders(snapshot.providers.map(editable)); setDefaultId(snapshot.defaultProviderId);
      setSelectedId(snapshot.defaultProviderId ?? snapshot.providers[0]?.id ?? '');
    }).catch(cause => {
      if (token === generation.current && !controller.signal.aborted) setError(errorText(cause));
    }).finally(() => { if (token === generation.current) { request.current = null; setBusy(null); } });
    return abortCurrent;
  }, [abortCurrent]);

  async function perform(operation: Operation, work: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const controller = new AbortController(); request.current = controller; const token = ++generation.current;
    setBusy(operation); setNotice(''); setError('');
    try { await work(controller.signal); }
    catch (cause) {
      if (token === generation.current && !controller.signal.aborted) {
        const message = errorText(cause); setError(message);
        if (operation === 'saving' && message.includes('其他窗口')) setReloadRequired(true);
      }
    } finally { if (token === generation.current) { request.current = null; setBusy(null); } }
  }
  function cancel() {
    request.current?.abort(); request.current = null; generation.current++;
    if (busy === 'saving') {
      setReloadRequired(true);
      setNotice('保存请求已停止，请重新加载服务配置确认结果。');
      setProviders(current => current.map(item => { const { apiKey: _key, ...rest } = item; return rest; }));
    } else setNotice('操作已取消。');
    setBusy(null);
  }
  function update(change: Partial<AiProviderInput>) {
    setProviders(current => current.map(item => item.id === selectedId ? { ...item, ...change } : item));
    setNotice(''); setError(''); setTestResult(null);
    if ('baseUrl' in change || 'protocol' in change) setModels([]);
  }
  function changeKey(value: string) {
    setProviders(current => current.map(item => {
      if (item.id !== selectedId) return item;
      const { apiKey: _key, ...rest } = item;
      return value ? { ...rest, apiKey: value } : rest;
    }));
    setNotice(''); setError(''); setTestResult(null);
  }
  function add() {
    const next: AiProviderInput = { id: 'provider-' + crypto.randomUUID(), name: t('新 AI 服务'), baseUrl: '', protocol: 'openai-chat', model: '' };
    setProviders(current => [...current, next]); setSelectedId(next.id);
    if (!providers.length) setDefaultId(next.id);
    setModels([]); setTestResult(null); setNotice(''); setError('');
    requestAnimationFrame(() => nameInput.current?.focus());
  }
  function remove() {
    const remaining = providers.filter(item => item.id !== selectedId);
    setProviders(remaining); setSelectedId(remaining[0]?.id ?? '');
    if (defaultId === selectedId) setDefaultId(remaining[0]?.id ?? null);
    setModels([]); setTestResult(null); setError(''); setNotice('服务已从配置中移除，保存后生效；笔记和会话保留。');
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || locked) return;
    if (providers.some(item => !item.name.trim() || !item.baseUrl.trim() || !item.model.trim())) { setError('请填写每项服务的名称、API 地址和模型名称。'); return; }
    void perform('saving', async signal => {
      const result = await saveAiSettings({ revision: settings.revision, defaultProviderId: defaultId, providers }, signal);
      if (signal.aborted) return;
      restore(result, selectedId); setNotice('AI 服务配置已保存。');
    });
  }
  function reload() {
    void perform('loading', async signal => {
      const snapshot = await getAiSettings(signal);
      if (signal.aborted) return;
      restore(snapshot, selectedId); setNotice('AI 服务配置已重新加载。');
    });
  }

  return <div className="mewiki-ai-service-settings" data-testid="mewiki-ai-service-settings">
    <p className="mewiki-ai-service-intro">{t('自行配置服务地址、API Key 和模型。请求由 MeWiki 本机服务转发，费用由所选服务商结算。')}</p>
    <div className="mewiki-ai-provider-controls" role="toolbar" aria-label={t('AI 服务操作')}>
      <label className="mewiki-ai-provider-select" htmlFor="mewiki-ai-provider"><span>{t('服务配置')}</span><select id="mewiki-ai-provider" value={selectedId} disabled={locked || !providers.length} onChange={event => { setSelectedId(event.target.value); setModels([]); setTestResult(null); setNotice(''); setError(''); }}>
        {!providers.length && <option value="">{t('尚未添加 AI 服务')}</option>}
        {providers.map(item => <option key={item.id} value={item.id}>{item.name || t('未命名服务')}{item.id === defaultId ? ` · ${t('默认')}` : ''}</option>)}
      </select></label>
      <button type="button" data-ui="icon-action" aria-label={t('添加服务')} title={t('添加服务')} disabled={locked || !settings || providers.length >= 20} onClick={add}><Plus size={16} /></button>
      <button type="button" data-ui="icon-action" data-tone="danger" aria-label={t('删除服务')} title={t('删除服务')} disabled={locked || !provider} onClick={remove}><Trash2 size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('重新加载服务配置')} title={t('重新加载服务配置')} disabled={busy !== null} onClick={reload}><RefreshCw size={16} /></button>
    </div>
    <form className="mewiki-ai-service-form" onSubmit={save}>
      {provider && <fieldset disabled={locked}>
        <legend>{t('连接设置')}</legend>
        <div className="mewiki-ai-service-fields">
          <label htmlFor="mewiki-ai-provider-name"><span>{t('服务名称')}</span><input ref={nameInput} id="mewiki-ai-provider-name" value={provider.name} required maxLength={120} onChange={event => update({ name: event.target.value })} /></label>
          <label htmlFor="mewiki-ai-protocol"><span>{t('接口类型')}</span><select id="mewiki-ai-protocol" value={provider.protocol} onChange={event => update({ protocol: event.target.value as AiProtocol })}>
            <option value="openai-chat">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option>
          </select></label>
          <label className="mewiki-ai-field-wide" htmlFor="mewiki-ai-base-url"><span>{t('API 地址')}</span><input id="mewiki-ai-base-url" type="url" value={provider.baseUrl} required maxLength={2048} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} onChange={event => update({ baseUrl: event.target.value })} /></label>
          <div className="mewiki-ai-field-wide mewiki-ai-secret-field">
            <label htmlFor="mewiki-ai-api-key"><span>{t('API Key')}</span><input id="mewiki-ai-api-key" type="password" value={provider.apiKey ?? ''} maxLength={8192} autoComplete="new-password" spellCheck={false} aria-describedby="mewiki-ai-key-description" onChange={event => changeKey(event.target.value)} /></label>
            {saved?.hasApiKey && <button type="button" data-ui="icon-action" data-tone={provider.apiKey === '' ? undefined : 'danger'} aria-label={provider.apiKey === '' ? t('保留已保存密钥') : t('清除已保存密钥')} title={provider.apiKey === '' ? t('保留已保存密钥') : t('清除已保存密钥')} onClick={() => {
              if (provider.apiKey === '') changeKey(''); else update({ apiKey: '' });
            }}>{provider.apiKey === '' ? <Undo2 size={16} /> : <Eraser size={16} />}</button>}
            <small id="mewiki-ai-key-description">{provider.apiKey === '' ? t('保存时将清除密钥。') : saved?.hasApiKey ? t('已保存 API Key；留空保留，输入新值可替换。') : t('密钥只发送到本机服务保存；免密的本地服务可以留空。')}</small>
          </div>
          <label className="mewiki-ai-field-wide" htmlFor="mewiki-ai-model"><span>{t('模型名称')}</span><input id="mewiki-ai-model" value={provider.model} required maxLength={256} autoComplete="off" spellCheck={false} list={models.length ? 'mewiki-ai-model-options' : undefined} onChange={event => update({ model: event.target.value })} /><datalist id="mewiki-ai-model-options">{models.map(model => <option key={model} value={model} />)}</datalist></label>
        </div>
        <label className="mewiki-ai-default-option"><input type="checkbox" checked={defaultId === provider.id} onChange={event => { setDefaultId(event.target.checked ? provider.id : null); setNotice(''); }} /><span>{t('设为默认 AI 服务')}</span></label>
      </fieldset>}
      {!provider && !busy && !error && <p className="mewiki-ai-service-empty">{t('添加一项服务后，即可选择模型并使用 AI 工作区。')}</p>}
      <div className="mewiki-ai-service-actions">
        <button type="submit" className="mewiki-ai-save" disabled={!settings || !dirty || locked}><Save size={15} /><span>{t('保存服务')}</span></button>
        <button type="button" disabled={!canProbe} onClick={() => void perform('testing', async signal => {
          const result = await testAiProvider(selectedId, signal); if (!signal.aborted) setTestResult(result);
        })}>{t('测试服务')}</button>
        <button type="button" disabled={!canProbe} onClick={() => void perform('models', async signal => {
          const result = await getAiModels(selectedId, signal); if (!signal.aborted) { setModels(result); setNotice('模型列表已获取，可在模型名称中选择或继续手动填写。'); }
        })}>{t('获取模型')}</button>
        {busy && <button type="button" onClick={cancel}><Square size={14} /><span>{t('取消操作')}</span></button>}
      </div>
    </form>
    <div className="mewiki-ai-service-feedback" aria-live="polite">
      {busy && <p role="status">{busy === 'loading' ? t('正在加载 AI 服务…') : busy === 'saving' ? t('正在保存 AI 服务…') : busy === 'testing' ? t('正在测试模型响应、流式输出和工具调用…') : t('正在获取模型列表…')}</p>}
      {dirty && !busy && !reloadRequired && <p>{t('有未保存的修改，请先保存后再测试或获取模型。')}</p>}
      {reloadRequired && <p>{t('请重新加载服务配置后继续编辑。')}</p>}
      {notice && <p role="status">{localizeError(notice)}</p>}
      {error && <p className="mewiki-ai-service-error" role="alert">{localizeError(error)}</p>}
      {testResult && <div className="mewiki-ai-test-result">
        <p role="status">{localizeError(testResult.message)}</p>
        <dl>{([
          ['response', t('模型响应')], ['stream', t('流式输出')], ['tools', t('工具调用')],
        ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{testResult[key] ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}{testResult[key] ? t('通过') : t('未通过')}</dd></div>)}</dl>
      </div>}
    </div>
    <div className="mewiki-ai-service-notes">
      <p>{t('测试会发送一条不含笔记资料的模型请求，可能产生少量费用。模型列表不可用时，可以直接手动填写。')}</p>
      <p>{t('密钥与笔记备份分开保存。Windows 使用当前用户的系统加密保护，其他平台使用仅当前用户可读写的文件存储。')}</p>
      <p>{t('使用云端地址时，AI 任务中选定的资料会发送给该服务；使用本地模型地址时可在本机推理。')}</p>
    </div>
  </div>;
}
