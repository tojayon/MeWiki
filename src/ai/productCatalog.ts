import type { ResearchNotebookState } from '../domain/researchNotebook.ts';

export type AiProductModuleId = 'symbols' | 'terms' | 'foundations' | 'notes' | 'maps' | 'library' | 'manual';
export interface AiProductModule {
  id: AiProductModuleId;
  name: string;
  englishName: string;
  aliases: string[];
  description: string;
  actions: string[];
  view?: ResearchNotebookState['view'];
}

/** Product vocabulary only. Opening a module never grants access to its contents. */
export const aiProductModules: readonly AiProductModule[] = [
  { id: 'symbols', name: '符号词典', englishName: 'Symbol dictionary', aliases: ['符号库', '符号表', 'Symbol library', 'Symbol table'],
    description: '管理符号的名称、含义、字体和角标；完整书写以词条的默认实例为准。',
    actions: ['检索符号词条', '读取符号定义与默认书写', '提出符号词条修改建议'], view: 'dictionary' },
  { id: 'terms', name: '术语词典', englishName: 'Term dictionary', aliases: ['术语库', '术语表', 'Term library', 'Glossary'],
    description: '管理术语的名称、别名、中英文名称与缩写以及含义。',
    actions: ['检索术语词条', '读取术语完整定义', '提出术语词条修改建议'], view: 'dictionary' },
  { id: 'foundations', name: '基础理论', englishName: 'Foundations', aliases: ['理论笔记', '基础理论笔记', 'Foundation notes', 'Theory notes'],
    description: '保存定义、条件、结论等理论知识，并与研究记录建立关系。',
    actions: ['检索授权的理论笔记', '读取条件与结论', '提出笔记内容和关系修改建议'], view: 'foundations' },
  { id: 'notes', name: '研究记录', englishName: 'Research notes', aliases: ['研究笔记', '研究日志', 'Research records', 'Research journal'],
    description: '记录研究过程与结果，支持正文、公式、表格、标签页等内容。',
    actions: ['检索授权的研究记录', '读取笔记原文和内容块', '提出笔记创建与修改建议'], view: 'notes' },
  { id: 'maps', name: '理论地图', englishName: 'Knowledge map', aliases: ['知识地图', '关系图', 'Theory map', 'Knowledge graph'],
    description: '以地图组织笔记及其关系，显示理论知识之间的链接。',
    actions: ['浏览授权范围内的地图', '读取笔记关系', '提出地图和关系修改建议'], view: 'maps' },
  { id: 'library', name: '资料库', englishName: 'Library', aliases: ['知识库', '文档库', 'Knowledge base'],
    description: '独立保存笔记、词典与理论地图的本地资料集合。',
    actions: ['列出授权笔记', '检索授权内容', '查询本次工具能力与授权范围'] },
  { id: 'manual', name: '使用手册', englishName: 'User manual', aliases: ['操作手册', '帮助文档', 'Manual', 'Help'],
    description: '提供产品的操作说明与通用示例，手册笔记同样遵循本次授权范围。',
    actions: ['检索授权的手册笔记', '读取授权的操作说明'] },
];

const comparable = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

export function findAiProductModules(query = ''): AiProductModule[] {
  const normalized = comparable(query), words = normalized.split(' ').filter(Boolean);
  return aiProductModules.map((module, index) => {
    const names = [module.name, module.englishName].map(comparable);
    const aliases = [module.id, ...module.aliases].map(comparable);
    const text = [...names, ...aliases, comparable(module.description), ...module.actions.map(comparable)].join(' ');
    const score = names.includes(normalized) ? 100 : aliases.includes(normalized) ? 90 : 0;
    return { module, index, score, matches: words.every(word => text.includes(word)) };
  }).filter(item => item.matches).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.module);
}

export function aiProductModuleUrl(id: AiProductModuleId): string {
  if (!aiProductModules.some(module => module.id === id)) throw new Error('未知的觅维功能模块。');
  return `mewiki-module:${id}`;
}

export function aiProductModuleId(url: string): AiProductModuleId | null {
  return aiProductModules.find(module => url === `mewiki-module:${module.id}`)?.id ?? null;
}
