import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { useIntegration } from './IntegrationContext.ts';
export default function IntegrationNotice() {
  useLocale();
  const { content, insertion, plugins, connection, error, showManager } = useIntegration();
  return <>
    {content && !insertion && <aside className="mewiki-integration-notice" role="status"><span>{plugins[content.provider] === 'enabled' ? t('当前插件尚不支持这条外部内容。') : t`${connection?.name ?? t('外部程序')} 已提供内容，启用对应插件后可插入笔记。`}</span><button type="button" onClick={showManager}>{t("管理插件")}</button></aside>}
    {error && <div className="mewiki-integration-error" role="alert">{localizeError(error)}</div>}
  </>;
}
