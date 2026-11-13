import type { AiNativeAction } from '../ai/nativeSchema.ts';
import { t } from '../i18n/locale.ts';

export function nativeOperationLabel(action: AiNativeAction): string {
  const labels: Record<AiNativeAction, string> = {
    'note-update': t('修改笔记属性'), 'note-delete': t('删除笔记'), 'block-insert': t('插入内容块'), 'block-update': t('修改内容块'), 'block-delete': t('删除内容块'), 'block-move': t('移动内容块'),
    'tab-insert': t('新增标签页'), 'tab-update': t('修改标签页'), 'tab-delete': t('删除标签页'), 'tab-move': t('移动标签页'),
    'symbol-save': t('编辑符号'), 'symbol-delete': t('删除符号'), 'term-save': t('修改术语'), 'term-delete': t('删除术语'),
    'map-create': t('新建地图'), 'map-update': t('修改地图'), 'map-delete': t('删除地图'), 'relation-save': t('编辑关系'), 'relation-delete': t('删除关系'),
  };
  return labels[action];
}
