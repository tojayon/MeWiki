import { publicationFields } from '../domain/publicationValidation.ts';
import { getLocale, localizeError, t, translate } from './locale.ts';

const labels = new Set(Object.values(publicationFields).flatMap(field => field.split(' → ')));
for (const label of ['图片创作', '画布', '主体', '主体位置', '主体大小', '主体旋转', '单图调整', '图层', '标识', '装饰图片', '水平位置', '垂直位置', '宽度', '高度', '旋转', '透明度', '文字', '文字大小', '颜色', '底色', '行距', '字间距', '内边距', '圆角', '保存设计', '作品备份', '图片信息', '字体']) labels.add(label);
/** Translate only recognized system contexts; never translate arbitrary text inside an error. */
export function localizePublicationError(message: string): string {
  if (getLocale() === 'zh-CN') return message;
  const separator = message.indexOf('：');
  if (separator < 0) return localizeError(message);
  const parts = message.slice(0, separator).split(' → ');
  const translated: string[] = [];
  for (const part of parts) {
    if (labels.has(part)) translated.push(t(part));
    else {
      const index = /^第 (\d+) (层|项|张|个图层)$/.exec(part);
      if (!index) return localizeError(message);
      translated.push(translate(index[2] === '层' ? '纹理第 {0} 层' : index[2] === '项' ? '导出内容第 {0} 项' : index[2] === '张' ? '图片第 {0} 张' : '画布第 {0} 个图层', [index[1]]));
    }
  }
  return translated.join(' → ') + ': ' + localizeError(message.slice(separator + 1));
}
