import type { PluginExportPreset, PluginExportTemplate } from '../plugins/sdk/exportTypes.ts';
import { defaultPublicationOptions, type PublicationOptions } from './publicationTypes.ts';
import { documentTheme } from '../styles/documentTheme.ts';

export function applyPublicationTemplate(options: PublicationOptions, template: PluginExportTemplate): PublicationOptions {
  const { style: _style, ...base } = options;
  if ('style' in template) return { ...base, style: 'document', background: documentTheme.background, textColor: documentTheme.textColor, headingColor: documentTheme.headingColor, accentColor: documentTheme.accentColor, fontFamily: 'sans', fontSize: 32, lineHeight: documentTheme.lineHeight };
  const { background, textColor, headingColor, accentColor, fontFamily, fontSize, lineHeight } = template;
  return { ...base, background, textColor, headingColor, accentColor, fontFamily, fontSize, lineHeight };
}

export function systemPublicationOptions(template: PluginExportTemplate, preset: PluginExportPreset): PublicationOptions {
  return { ...applyPublicationTemplate(defaultPublicationOptions(), template), width: preset.width, height: preset.height };
}
