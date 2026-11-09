import { parseReplayReference } from './webbench.ts';
import type { ExternalContent } from '../integrations/externalContent.ts';
function WebBenchReplayView({ content }: { content: ExternalContent }) {
  const { data } = parseReplayReference(content);
  return <dl className="mewiki-replay-details">
    <div><dt>物理时间</dt><dd>{data.time.toFixed(6)} s</dd></div>
    {data.loopId && <div><dt>环路</dt><dd>{data.loopId}</dd></div>}
    {data.packetId && <div><dt>数据包</dt><dd>{data.packetId}</dd></div>}
    {data.eventLabel && <div><dt>事件</dt><dd>{data.eventLabel}</dd></div>}
  </dl>;
}
const pluginContentViews = { 'org.mewiki.webbench': WebBenchReplayView };
export default function PluginContentView({ content }: { content: ExternalContent }) {
  const View = pluginContentViews[content.provider as keyof typeof pluginContentViews];
  return View ? <View content={content} /> : <p>{content.summary}</p>;
}
