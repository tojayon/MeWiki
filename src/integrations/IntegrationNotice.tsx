import { useIntegration } from './IntegrationContext.ts';
export default function IntegrationNotice() {
  const { content, insertion, plugins, connection, error, showManager } = useIntegration();
  return <>
    {content && !insertion && <aside className="mewiki-integration-notice" role="status"><span>{plugins[content.provider] === 'enabled' ? '当前插件尚不支持这条外部内容。' : `${connection?.name ?? '外部程序'} 已提供内容，启用对应插件后可插入笔记。`}</span><button type="button" onClick={showManager}>管理插件</button></aside>}
    {error && <div className="mewiki-integration-error" role="alert">{error}</div>}
  </>;
}
