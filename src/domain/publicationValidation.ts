/** System labels only. Never include user text, file paths or resource data in a diagnostic context. */
export const publicationFields = {
  request: '导出请求', options: '导出设置', document: '导出内容',
  width: '画幅 → 输出宽度', height: '画幅 → 输出高度', longHeight: '画幅 → 长图最大高度',
  pixels: '画幅', bodyWidth: '画幅与样式 → 正文宽度', bodyHeight: '画幅与样式 → 正文高度',
  margin: '样式 → 页面留白', fontSize: '样式 → 正文字号', lineHeight: '样式 → 正文行距', quality: '样式 → JPEG 质量',
  background: '样式 → 背景颜色', textColor: '样式 → 正文颜色', headingColor: '样式 → 标题颜色', accentColor: '样式 → 强调颜色',
  title: '内容 → 导出标题', subtitle: '内容 → 副标题', author: '内容 → 作者署名', header: '内容 → 页眉文字', footer: '内容 → 页脚文字', date: '内容 → 显示日期',
  cover: '内容 → 单独生成封面', showPageNumbers: '内容 → 显示页码',
  fontFamily: '样式 → 本地字体', mode: '画幅 → 导出形式', format: '画幅 → 图片格式',
  logo: '内容 → 作者头像或 Logo', coverImage: '样式 → 封面图片', image: '图片',
  style: '选择模板', texture: '样式 → 笔记背景纹理', textureKind: '纹理预设', textureColor: '纹理颜色',
  textureImage: '纹理图片', opacity: '纹理强度', textureScale: '纹理大小', seed: '纹理变体', character: '纹理质感', rotation: '纹理方向', scope: '纹理位置与范围', fit: '纹理铺放',
  frame: '画幅 → 设备边框', frameBackground: '设备外背景', frameScale: '设备大小', shadow: '设备阴影', contentScale: '屏幕内容缩放',
  plain: '导出文案', id: '内容标识', kind: '内容类型', markdown: '文字内容', formula: '公式', native: '原生内容', caption: '图片说明', breakBefore: '此前分页',
  imageMode: '内容 → 图片导出', imageFit: '内容 → 图片适配', crop: '图片取景', cropX: '水平位置', cropY: '垂直位置', cropZoom: '图片缩放',
} as const;

export const publicationContext = (...parts: string[]) => parts.join(' → ');
export function failPublication(context: string, detail: string): never { throw new Error(`${context}：${detail}`); }
export function publicationObject(value: unknown, fields: readonly string[], context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return failPublication(context, '设置或内容结构不完整，请恢复模板样式或重新打开导出页面。');
  if (Object.keys(value).some(key => !fields.includes(key))) return failPublication(context, '包含当前版本不支持的设置，请恢复模板样式或重新打开导出页面。');
  return value as Record<string, unknown>;
}
export function publicationText(value: unknown, max: number, context: string): string {
  if (typeof value !== 'string') return failPublication(context, '缺少文字或资源数据，请重新填写或导入。');
  if (value.length > max) return failPublication(context, `当前长度为 ${value.length}，最多允许 ${max} 个字符。请缩短内容或减少资源。`);
  return value;
}
export function publicationNumber(value: unknown, min: number, max: number, context: string, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return failPublication(context, integer ? `请填写 ${min}–${max} 之间的整数。` : `请填写 ${min}–${max} 之间的数值。`);
  if (value < min || value > max || integer && !Number.isSafeInteger(value)) return failPublication(context, integer ? `当前值为 ${value}，请填写 ${min}–${max} 之间的整数。` : `当前值为 ${value}，请填写 ${min}–${max} 之间的数值。`);
  return value;
}
export function publicationChoice<T extends string>(value: unknown, choices: readonly T[], context: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return failPublication(context, '所选项无效，请重新选择或恢复模板样式。');
  return value as T;
}
export function publicationColor(value: unknown, context: string): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) return failPublication(context, '请使用 #RRGGBB 格式的六位颜色，或恢复模板样式。');
  return value;
}
/** Preserve the diagnostic from resource/native validators and add its position in this export. */
export function withPublicationContext<T>(context: string, action: () => T): T {
  try { return action(); }
  catch (cause) { return failPublication(context, cause instanceof Error ? cause.message : '内容无法读取，请重新生成预览。'); }
}
