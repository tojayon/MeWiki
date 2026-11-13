import { useEffect, useState } from 'react';
import { compositionFontIds, resolveComposition, type PublicationComposition } from '../domain/publicationComposition.ts';
import type { CompositionItemEdits } from './compositionEdits.ts';
import type { PublicationFont } from '../domain/researchFonts.ts';
import { readUserFont, subscribeUserFonts } from './userFonts.ts';
const emptyFonts: PublicationFont[] = [];
export function useCompositionFonts(libraryId: string, scene: PublicationComposition | undefined, items: CompositionItemEdits, selectedIds: string[]) {
  const scenes = scene ? selectedIds.length ? selectedIds.map(id => resolveComposition(scene, items[id]?.overrides)) : [scene] : [];
  const ids = [...new Set(scenes.flatMap(value => compositionFontIds(value)))].sort();
  const key = ids.join(',');
  const [revision, setRevision] = useState(0), [state, setState] = useState<{ key: string; fonts: PublicationFont[]; error: string; failedId?: string }>({ key: '', fonts: [], error: '' });
  const requestKey = JSON.stringify([libraryId, key, revision]);
  useEffect(() => subscribeUserFonts(libraryId, () => setRevision(value => value + 1)), [libraryId]);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      let failedId: string | undefined;
      try {
        if (key.split(',').filter(Boolean).length > 8) throw new Error('每个画布最多使用 8 种资料库字体。');
        const fonts: PublicationFont[] = [];
        for (const id of key.split(',').filter(Boolean)) { failedId = id; fonts.push(await readUserFont(libraryId, id, abort.signal)); }
        if (!abort.signal.aborted) setState({ key: requestKey, fonts, error: '' });
      } catch (cause) { if (!abort.signal.aborted) setState({ key: requestKey, fonts: [], error: cause instanceof Error ? cause.message : '无法读取已导入字体。', failedId }); }
    })();
    return () => abort.abort();
  }, [libraryId, key, requestKey]);
  const sceneIndex = state.failedId ? scenes.findIndex(scene => scene.layers.some(layer => layer.fontAssetId === state.failedId && layer.type === 'text')) : -1;
  const layerIndex = sceneIndex >= 0 ? scenes[sceneIndex].layers.findIndex(layer => layer.fontAssetId === state.failedId && layer.type === 'text') : -1;
  const target = layerIndex >= 0 ? { index: selectedIds.length ? sceneIndex + 1 : undefined, layerId: scenes[sceneIndex].layers[layerIndex].id } : undefined;
  const context = target ? `图片创作 → ${target.index ? `第 ${target.index} 张` : '画布'} → 第 ${layerIndex + 1} 个图层 → 字体` : '图片创作 → 字体';
  return { fonts: state.key === requestKey ? state.fonts : emptyFonts, error: state.key === requestKey && state.error ? context + '：' + state.error : '', ready: !key || state.key === requestKey && !state.error, target };
}
