import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { Plug } from 'lucide-react';
import DeviceInspectorModal from '../components/DeviceInspectorModal.tsx';
import { useIntegration } from '../integrations/IntegrationContext.ts';
import { availablePlugins, pluginStatus } from './registry.ts';
export default function PluginManager({ onClose }: { onClose: () => void }) {
  useLocale();
  const integration = useIntegration();
  return <DeviceInspectorModal open title={t("插件管理")} testId="mewiki-plugin-manager" onClose={onClose} className="mewiki-plugin-manager">
    <p>{t("插件为外部程序提供专门的内容卡片与操作。停用或卸载插件会保留笔记中的全部内容。")}</p>
    {availablePlugins.map(plugin => {
      const status = pluginStatus(integration.plugins, plugin.id);
      return <section className="mewiki-plugin-row" key={plugin.id}>
        <Plug size={22} /><div><h3>{t(plugin.name)} <small>{plugin.version}</small></h3><p>{t(plugin.description)}</p>
          <small>{t("能力：读取外部程序提供的当前内容；按你的点击返回外部程序。")}</small>
          <span className="mewiki-plugin-state">{status === 'available' ? t('未安装') : status === 'enabled' ? t('已启用') : t('已停用')}</span>
        </div><div className="mewiki-plugin-actions">
          <button type="button" onClick={() => integration.setPlugin(plugin.id, status === 'enabled' ? 'disabled' : 'enabled')}>{status === 'available' ? t('安装并启用') : status === 'enabled' ? t('停用') : t('启用')}</button>
          {status !== 'available' && <button type="button" onClick={() => integration.setPlugin(plugin.id, 'available')}>{t("卸载")}</button>}
        </div>
      </section>;
    })}
    {integration.connection && <p>{t("已连接：")}{integration.connection.name} · {integration.connection.origin}</p>}
  </DeviceInspectorModal>;
}
