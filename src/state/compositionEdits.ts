import type { CompositionLayer, CompositionOverrides, PublicationComposition } from '../domain/publicationComposition.ts';
import type { PublicationImageCrop } from '../domain/publicationTypes.ts';
export interface CompositionItemEdit { title?: string; subtitle?: string; crop?: PublicationImageCrop; overrides?: CompositionOverrides }
export type CompositionItemEdits = Record<string, CompositionItemEdit>;
export function patchCompositionLayer(scene: PublicationComposition, items: CompositionItemEdits, itemId: string | undefined, layerId: string, patch: Partial<CompositionLayer>) {
  if (!itemId) return { scene: { ...scene, layers: scene.layers.map(layer => layer.id === layerId ? { ...layer, ...patch } : layer) }, items };
  const item = items[itemId] ?? {}, overrides = item.overrides ?? {};
  return { scene, items: { ...items, [itemId]: { ...item, overrides: { ...overrides, layers: { ...overrides.layers, [layerId]: { ...overrides.layers?.[layerId], ...patch } } } } } };
}
export function removeCompositionLayer(scene: PublicationComposition, items: CompositionItemEdits, id: string) {
  return { scene: { ...scene, layers: scene.layers.filter(layer => layer.id !== id) }, items: Object.fromEntries(Object.entries(items).map(([key, item]) => {
    const layers = { ...item.overrides?.layers }; delete layers[id];
    return [key, { ...item, ...(item.overrides ? { overrides: { ...item.overrides, layers } } : {}) }];
  })) };
}
export interface CompositionHistory<T> { present: T; past: T[]; future: T[] }
export const createCompositionHistory = <T>(present: T): CompositionHistory<T> => ({ present, past: [], future: [] });
export function pushCompositionHistory<T>(history: CompositionHistory<T>, value: T, previous: T, transient = false): CompositionHistory<T> {
  return { present: value, past: transient ? history.past : [...history.past, previous].slice(-50), future: [] };
}
export function stepCompositionHistory<T>(history: CompositionHistory<T>, direction: -1 | 1): CompositionHistory<T> {
  if (direction === -1) return history.past.length ? { present: history.past.at(-1)!, past: history.past.slice(0, -1), future: [history.present, ...history.future].slice(0, 50) } : history;
  return history.future.length ? { present: history.future[0], past: [...history.past, history.present].slice(-50), future: history.future.slice(1) } : history;
}
