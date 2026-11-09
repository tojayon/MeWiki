import { localApplicationUrl, parseReplayReference, type ReplayReference } from './webbench.ts';

export interface ReplayConnection { serviceBase: string; webbenchOrigin: string }
export interface ReplayCatalogEntry {
  id: string;
  file: string;
  manifest: {
    format: 'cislunar-replay-sqlite/v2';
    sealed: true;
    run: { id: string; title: string };
    recordDigest: string;
    timeBase: { unit: 's'; origin: 'scenario'; start: number; end: number };
    loopIds: string[];
  };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;

export function parseReplayCatalog(value: unknown): ReplayCatalogEntry[] {
  if (!object(value) || !Array.isArray(value.items)) throw new Error('回放服务返回的实验列表格式无效。');
  return value.items.map((item: unknown) => {
    if (!object(item) || !text(item.id) || !text(item.file, 4000) || !object(item.manifest)) throw new Error('实验记录缺少有效身份。');
    const manifest = item.manifest;
    const time = manifest.timeBase;
    if (manifest.format !== 'cislunar-replay-sqlite/v2' || manifest.sealed !== true || !object(manifest.run)
      || !text(manifest.run.id) || !text(manifest.run.title, 1000) || !text(manifest.recordDigest)
      || !object(time) || time.unit !== 's' || time.origin !== 'scenario'
      || typeof time.start !== 'number' || !Number.isFinite(time.start) || time.start < 0
      || typeof time.end !== 'number' || !Number.isFinite(time.end) || time.end < time.start
      || !Array.isArray(manifest.loopIds) || !manifest.loopIds.every(id => text(id, 2000))) {
      throw new Error('实验记录的身份、时间范围或环路无效，请检查回放查询服务。');
    }
    return item as unknown as ReplayCatalogEntry;
  });
}

export async function fetchReplayCatalog(serviceBase: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ReplayCatalogEntry[]> {
  const origin = localApplicationUrl(serviceBase);
  const response = await fetcher(`${origin}/api/replays`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`读取实验列表失败（${response.status}）。请检查回放查询服务后重试。`);
  return parseReplayCatalog(await response.json());
}

export function createReplayReference(entry: ReplayCatalogEntry, connection: ReplayConnection, time: number, loopId?: string): ReplayReference {
  const manifest = entry.manifest;
  if (!Number.isFinite(time) || time < manifest.timeBase.start || time > manifest.timeBase.end) {
    throw new Error(`时间应在 ${manifest.timeBase.start} 至 ${manifest.timeBase.end} 秒之间。`);
  }
  if (loopId && !manifest.loopIds.includes(loopId)) throw new Error('所选环路不属于此实验。');
  return parseReplayReference({
    provider: 'org.mewiki.webbench', contentType: 'replay-position', schemaVersion: 1,
    title: manifest.run.title,
    summary: `t = ${time} s${loopId ? ` · ${loopId}` : ''}`,
    data: {
      runId: manifest.run.id, replayId: entry.id, recordDigest: manifest.recordDigest,
      serviceBase: connection.serviceBase, webbenchOrigin: connection.webbenchOrigin,
      time, ...(loopId ? { loopId } : {}),
    },
  });
}
