import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { parseReplayReference } from './webbench.ts';
import type { ExternalContent } from '../integrations/externalContent.ts';
function WebBenchReplayView({ content }: { content: ExternalContent }) {
  useLocale();
  const { data } = parseReplayReference(content);
  return <dl className="mewiki-replay-details">
    <div><dt>{t("物理时间")}</dt><dd>{data.time.toFixed(6)} s</dd></div>
    {data.loopId && <div><dt>{t("环路")}</dt><dd>{data.loopId}</dd></div>}
    {data.packetId && <div><dt>{t("数据包")}</dt><dd>{data.packetId}</dd></div>}
    {data.eventLabel && <div><dt>{t("事件")}</dt><dd>{data.eventLabel}</dd></div>}
  </dl>;
}
const pluginContentViews = { 'org.mewiki.webbench': WebBenchReplayView };
export default function PluginContentView({ content }: { content: ExternalContent }) {
  useLocale();
  const View = pluginContentViews[content.provider as keyof typeof pluginContentViews];
  return View ? <View content={content} /> : <p>{content.summary}</p>;
}
