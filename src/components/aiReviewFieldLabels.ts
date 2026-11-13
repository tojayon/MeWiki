import { t } from '../i18n/locale.ts';

export function aiReviewFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: t('标题'), content: t('建议正文'), text: t('内容'), name: t('名称'), meaning: t('定义'), englishName: t('英文名称'), englishAbbreviation: t('英文缩写'), chineseAbbreviation: t('中文缩写'),
    aliases: t('别名'), aliasEntries: t('别名'), atoms: t('原子词汇'), tags: t('标签'), scope: t('适用范围'), unit: t('单位'), status: t('状态'),
    notation: t('符号模板'), slots: t('索引槽位'), category: t('分类'), library: t('笔记分区'), researchType: t('研究类型'), basisNoteIds: t('依据笔记'), reviewStatus: t('核对状态'),
    createdAt: t('创建时间'), updatedAt: t('修改时间'), reviewedAt: t('核对时间'), frontmatter: t('自定义属性'), noteIds: t('笔记'), annotations: t('角色标记'), relations: t('理论关系'), view: t('地图布局'),
    tex: 'LaTeX', caption: t('说明'), conditions: t('适用条件'), parts: t('内容'), outputs: t('结果'), layout: t('布局'), section: t('理论分区'),
    items: t('内容'), columns: t('列'), rows: t('行'), notes: t('备注'), note: t('备注'), description: t('说明'), url: t('链接'), siteName: t('网站名称'), authors: t('作者'), year: t('年份'), venue: t('来源'), doi: 'DOI',
    source: t('来源'), kind: t('类型'), type: t('类型'), assetId: t('资源标识'), sourceNoteId: t('来源笔记'), blockIds: t('内容块'), sourceTitle: t('来源标题'), alt: t('替代文字'),
    labelPosition: t('名称位置'), appearance: t('面板配色'), borderColor: t('边框颜色'), backgroundColor: t('内容背景色'), headerBackground: t('标签栏背景色'), labelBackground: t('徽标背景色'), labelColor: t('徽标文字色'), accentColor: t('选中标签颜色'),
    key: t('位置'), defaultValue: t('默认值'), borderStyle: t('边框样式'), borderWidth: t('边框宽度'), level: t('标题级别'),
    active: t('使用中'), deprecated: t('已停用'), pending: t('待核对'), reviewing: t('核对中'), reviewed: t('已核对'), foundation: t('基础理论'), research: t('研究记录'), derivation: t('推导'), application: t('应用'),
    left: t('靠左'), center: t('居中'), right: t('靠右'), given: t('前提条件'), conclusion: t('结论'), target: t('目标'), entryId: t('词条'), noteId: t('笔记'), blockId: t('内容块'), bindings: t('变量'),
  };
  return labels[field] ?? field;
}
