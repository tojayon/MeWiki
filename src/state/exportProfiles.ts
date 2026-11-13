import { parsePublicationOptions, type PublicationOptions } from '../domain/publicationTypes.ts';
import { parsePublicationFont, type PublicationFont } from '../domain/researchFonts.ts';
import { compositionFontIds } from '../domain/publicationComposition.ts';
export interface ExportProfile { id: string; name: string; templateId: string; templateVersion: string; options: PublicationOptions }
export interface ExportProfileCollection { revision: string; profiles: ExportProfile[] }
/** JSON templates may inline a 100 MiB font, whose Base64 form is about 133 MiB. */
export const MAX_EXPORT_TEMPLATE_BYTES = 140 * 1024 * 1024;
export function parseExportProfiles(value: unknown): ExportProfile[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('个人模板最多保存 20 份。');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['id', 'name', 'templateId', 'templateVersion', 'options'].includes(key))) throw new Error('个人模板格式无效。');
    const profile = item as ExportProfile;
    if (typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(profile.id) || ids.has(profile.id)) throw new Error('个人模板标识重复或无效。');
    ids.add(profile.id);
    for (const key of ['name', 'templateId', 'templateVersion'] as const) if (typeof profile[key] !== 'string' || !profile[key].trim() || profile[key].length > 100) throw new Error('请填写不超过 100 字符的模板名称和版本。');
    return { id: profile.id, name: profile.name, templateId: profile.templateId, templateVersion: profile.templateVersion, options: parsePublicationOptions(profile.options) };
  });
}
export function exportProfileFile(profile: ExportProfile, font?: PublicationFont, fonts?: PublicationFont[]): string {
  const checked = parseExportProfiles([profile])[0];
  const checkedFont = font ? parsePublicationFont(font) : undefined;
  if (checked.options.fontAssetId !== checkedFont?.id) throw new Error('模板使用的字体缺失，请在当前资料库中重新导入字体。');
  const sceneFonts = checked.options.composition ? (fonts ?? []).map(value => parsePublicationFont(value)) : undefined;
  const required = compositionFontIds(checked.options.composition);
  if (sceneFonts && (required.length !== sceneFonts.length || new Set(sceneFonts.map(font => font.id)).size !== sceneFonts.length || sceneFonts.some(font => !required.includes(font.id)))) throw new Error('模板使用的字体缺失，请在当前资料库中重新导入字体。');
  const file = JSON.stringify({ format: 'mewiki-export-template', version: checked.options.composition ? 2 : 1, profile: checked, ...(checkedFont ? { font: checkedFont } : {}), ...(sceneFonts?.length ? { fonts: sceneFonts } : {}) }, null, 2);
  if (new TextEncoder().encode(file).length > MAX_EXPORT_TEMPLATE_BYTES) throw new Error('个人模板文件超过大小限制。');
  return file;
}
export function importExportProfile(source: string): ExportProfile {
  return importExportProfileFile(source).profile;
}
export function importExportProfileFile(source: string): { profile: ExportProfile; font?: PublicationFont; fonts?: PublicationFont[] } {
  if (source.length > MAX_EXPORT_TEMPLATE_BYTES) throw new Error('个人模板文件超过大小限制。');
  const value = JSON.parse(source);
  if (!value || typeof value !== 'object' || value.format !== 'mewiki-export-template' || ![1, 2].includes(value.version) || Object.keys(value).some(key => !['format', 'version', 'profile', 'font', ...(value.version === 2 ? ['fonts'] : [])].includes(key))) throw new Error('请选择 MeWiki 个人导出模板。');
  const profile = parseExportProfiles([value.profile])[0];
  const font = Object.hasOwn(value, 'font') ? parsePublicationFont(value.font) : undefined;
  if (profile.options.fontAssetId !== font?.id) throw new Error('模板使用的字体缺失，请重新导出含字体的模板文件。');
  if (value.fonts !== undefined && (!profile.options.composition || !Array.isArray(value.fonts) || value.fonts.length > 8)) throw new Error('模板使用的字体缺失，请重新导出含字体的模板文件。');
  const fonts = value.fonts?.map((font: unknown) => parsePublicationFont(font)) as PublicationFont[] | undefined;
  const required = compositionFontIds(profile.options.composition);
  if (required.length !== (fonts?.length ?? 0) || new Set(fonts?.map(font => font.id)).size !== (fonts?.length ?? 0) || fonts?.some(font => !required.includes(font.id))) throw new Error('模板使用的字体缺失，请重新导出含字体的模板文件。');
  if (profile.options.composition && value.version !== 2) throw new Error('请选择 MeWiki 个人导出模板。');
  return { profile, ...(font ? { font } : {}), ...(fonts ? { fonts } : {}) };
}
export async function readExportProfiles(libraryId: string, pluginId: string, signal?: AbortSignal): Promise<ExportProfileCollection> {
  return profileRequest(`?${new URLSearchParams({ library: libraryId, plugin: pluginId })}`, { signal });
}
export async function saveExportProfiles(libraryId: string, pluginId: string, collection: ExportProfileCollection, signal?: AbortSignal): Promise<ExportProfileCollection> {
  return profileRequest('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId, pluginId, ...collection }), signal });
}
async function profileRequest(route: string, init: RequestInit): Promise<ExportProfileCollection> {
  const response = await fetch(`/api/mewiki/export-profiles${route}`, { ...init, cache: 'no-store', headers: { ...init.headers, 'X-MeWiki-Request': 'export-profiles' } });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('导出服务尚未加载，请重启 MeWiki 本地服务。');
  const value = await response.json() as ExportProfileCollection & { error?: string };
  if (!response.ok) throw new Error(value.error ?? '个人模板保存失败。');
  if (typeof value.revision !== 'string') throw new Error('个人模板格式无效。');
  return { revision: value.revision, profiles: parseExportProfiles(value.profiles) };
}
