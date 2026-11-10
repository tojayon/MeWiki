import { mediaKindLabels } from '../domain/researchMediaFormats.ts';
import { localizeError, t, translate } from './locale.ts';

const mediaErrorTemplates = [
  '{0}无法播放，文件编码可能不受当前浏览器支持，或来源暂时不可用。可下载原件查看或替换。',
  '请输入 HTTP 或 HTTPS {0}直链。',
  '下载保存网络{0}需要先设置本地资料库。',
  '该地址返回的文件不是{0}，原内容已保留。',
  '请选择{0}文件，当前内容保持不变。',
] as const;

/** Store source messages; translate the system media kind only at display time. */
export function localizeMediaError(message: string): string {
  for (const template of mediaErrorTemplates) {
    for (const sourceLabel of Object.values(mediaKindLabels)) {
      if (message === translate(template, [sourceLabel], 'zh-CN')) {
        return translate(template, [t(sourceLabel)]);
      }
    }
  }
  return localizeError(message);
}
