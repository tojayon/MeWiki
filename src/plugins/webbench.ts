import { parseExternalContent, type ExternalContent } from '../integrations/externalContent.ts';

export type ReplayAddress = {
  runId: string;
  replayId: string;
  recordDigest: string;
  serviceBase: string;
  webbenchOrigin: string;
  time: number;
  loopId?: string;
  packetId?: string;
  eventLabel?: string;
};
export type ReplayReference = ExternalContent & { data: ReplayAddress };
export function localApplicationUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('缺少本地程序地址。');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('回放地址必须是本机程序地址。');
  return url.origin;
}
export function parseReplayReference(value: unknown): ReplayReference {
  const content = parseExternalContent(value);
  if (content.provider !== 'org.mewiki.webbench' || content.contentType !== 'replay-position' || content.schemaVersion !== 1) throw new Error('此回放插件不支持该内容版本。');
  const data = content.data;
  if (!['runId', 'replayId', 'recordDigest'].every(key => typeof data[key] === 'string' && String(data[key]).length > 0 && String(data[key]).length <= 512) || typeof data.time !== 'number' || !Number.isFinite(data.time) || data.time < 0) throw new Error('实验身份或回放时间无效。');
  for (const key of ['loopId', 'packetId', 'eventLabel']) if (data[key] !== undefined && (typeof data[key] !== 'string' || String(data[key]).length > 2000)) throw new Error('环路、数据包或事件格式无效。');
  return { ...content, data: { ...data, serviceBase: localApplicationUrl(data.serviceBase), webbenchOrigin: localApplicationUrl(data.webbenchOrigin) } as ReplayAddress };
}
export function replayDeepLink(content: ReplayReference): string {
  const reference = parseReplayReference(content);
  const url = new URL(reference.data.webbenchOrigin);
  url.searchParams.set('mewikiReplay', JSON.stringify(reference.data));
  return url.href;
}
export const webbenchPlugin = {
  id: 'org.mewiki.webbench', name: 'WebBench 仿真回放', version: '1.0.0', protocolVersion: 1,
  description: '将真实实验的回放位置保存为笔记卡片，点击返回对应时间、环路和数据包。',
  contentTypes: ['replay-position'], capabilities: ['context.read', 'content.open'],
  insertionLabel: '插入回放位置', validate: parseReplayReference, openUrl: replayDeepLink,
} as const;
