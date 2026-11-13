import type { ImageWorkspaceCollection } from '../domain/imageWorkspace.ts';
export function imageWorkspaceClient(library: string, plugin: string) {
  const query = new URLSearchParams({ library, plugin });
  const request = async <T>(route: string, init: RequestInit = {}, id?: string): Promise<T> => {
    const params = new URLSearchParams(query); if (id) params.set('id', id);
    const response = await fetch(`/api/mewiki/image-workspace${route}?${params}`, { ...init, cache: 'no-store', headers: { ...init.headers, 'X-MeWiki-Request': 'image-workspace' } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('图片创作服务尚未加载，请重启 MeWiki 本地服务。');
    const value = await response.json(); if (!response.ok) throw new Error(value.error ?? '图片设计保存失败。'); return value;
  };
  return {
    read: (signal?: AbortSignal) => request<ImageWorkspaceCollection>('', { signal }),
    save: (collection: ImageWorkspaceCollection, signal?: AbortSignal) => request<ImageWorkspaceCollection>('', { method: 'PUT', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collection) }),
    asset: async (id: string, signal?: AbortSignal) => (await request<{ dataUrl: string }>('/assets', { signal }, id)).dataUrl,
    putAsset: async (dataUrl: string, signal?: AbortSignal) => (await request<{ id: string }>('/assets', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) })).id,
  };
}
