import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import type { ExternalContent } from '../integrations/externalContent.ts';
import type { PluginManifest } from './sdk/types.ts';
import { pluginViewFields } from './sdk/runtime.ts';
export default function PluginContentView({ plugin, content }: { plugin: PluginManifest; content: ExternalContent }) {
  useLocale();
  const fields = pluginViewFields(plugin, content);
  return <>{content.summary && <p>{content.summary}</p>}{fields.length > 0 && <dl className="mewiki-plugin-details">{fields.map((field, index) => <div key={index}><dt>{t(field.label)}</dt><dd>{field.value}</dd></div>)}</dl>}</>;
}
