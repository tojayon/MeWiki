import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { defaultComposition, newCompositionLayer, resolveComposition, type CompositionLayer, type CompositionSubject } from '../domain/publicationComposition.ts';
import type { PublicationOptions } from '../domain/publicationTypes.ts';
import { createCompositionHistory, pushCompositionHistory, stepCompositionHistory, patchCompositionLayer, removeCompositionLayer, type CompositionItemEdits } from './compositionEdits.ts';
import type { PublicationDraft } from './publicationDrafts.ts';

interface Snapshot { options: PublicationOptions; items: CompositionItemEdits }
export function useCompositionEditor(options: PublicationOptions, setOptions: Dispatch<SetStateAction<PublicationOptions>>, invalidate: () => void, initial?: PublicationDraft['editor']) {
  const [items, setItems] = useState<CompositionItemEdits>(initial?.items ?? {});
  const [scope, setScope] = useState<'all' | 'current'>(initial?.scope ?? 'all');
  const [selectedId, select] = useState(initial?.selectedId ?? '$subject');
  const [textFocus, setTextFocus] = useState(0);
  const [availability, redraw] = useState({ canUndo: false, canRedo: false });
  const history = useRef(createCompositionHistory<Snapshot>({ options, items }));
  const gesture = useRef(false);
  const latest = useRef({ options, items });
  useLayoutEffect(() => { latest.current = { options, items }; }, [options, items]);
  const updateAvailability = () => redraw({ canUndo: !!history.current.past.length, canRedo: !!history.current.future.length });
  const scene = options.composition ?? defaultComposition();
  const commit = (value: Snapshot, transient = gesture.current) => {
    history.current = pushCompositionHistory(history.current, value, latest.current, transient);
    latest.current = value; setItems(value.items); setOptions(value.options); updateAvailability(); invalidate();
  };
  const begin = () => { history.current = pushCompositionHistory(history.current, latest.current, latest.current); gesture.current = true; };
  const end = () => { gesture.current = false; updateAvailability(); };
  const step = (direction: -1 | 1) => {
    history.current.present = latest.current;
    history.current = stepCompositionHistory(history.current, direction);
    latest.current = history.current.present; setItems(latest.current.items); setOptions(latest.current.options); updateAvailability(); invalidate();
  };
  const itemKey = (current?: string) => scope === 'current' ? current : undefined;
  const patchLayer = (id: string, patch: Partial<CompositionLayer>, current?: string) => {
    const base = latest.current.options.composition ?? defaultComposition();
    const changed = patchCompositionLayer(base, latest.current.items, base.layers.find(layer => layer.id === id)?.localOnly ? current : itemKey(current), id, patch);
    commit({ options: { ...latest.current.options, composition: changed.scene }, items: changed.items });
  };
  const patchSubject = (patch: Partial<CompositionSubject>, current?: string) => {
    const key = itemKey(current);
    if (!key) { commit({ options: { ...latest.current.options, composition: { ...scene, subject: { ...scene.subject, ...patch } } }, items: latest.current.items }); return; }
    const item = latest.current.items[key] ?? {};
    commit({ options: latest.current.options, items: { ...latest.current.items, [key]: { ...item, overrides: { ...item.overrides, subject: { ...item.overrides?.subject, ...patch } } } } });
  };
  const add = (type: CompositionLayer['type'], current?: string, patch: Partial<CompositionLayer> = {}) => {
    const layer = { ...newCompositionLayer(type, crypto.randomUUID()), ...patch };
    const key = itemKey(current);
    if (!key) delete layer.localOnly;
    const nextScene = { ...scene, layers: [...scene.layers, key ? { ...layer, hidden: true, localOnly: true } : layer] };
    const changed = key ? patchCompositionLayer(nextScene, latest.current.items, key, layer.id, { hidden: false }) : { scene: nextScene, items: latest.current.items };
    commit({ options: { ...latest.current.options, composition: changed.scene }, items: changed.items }); select(layer.id);
  };
  const remove = (id: string, current?: string) => {
    if (itemKey(current)) { patchLayer(id, { hidden: true }, current); return; }
    const changed = removeCompositionLayer(scene, latest.current.items, id);
    commit({ options: { ...latest.current.options, composition: changed.scene }, items: changed.items }); select('$subject');
  };
  const setItem = (id: string, patch: CompositionItemEdits[string]) => commit({ options: latest.current.options, items: { ...latest.current.items, [id]: { ...latest.current.items[id], ...patch } } });
  const resetItem = (id: string) => { const item = { ...latest.current.items[id] }; delete item.overrides; commit({ options: latest.current.options, items: { ...latest.current.items, [id]: item } }); };
  const replace = (nextOptions: PublicationOptions, nextItems: CompositionItemEdits = latest.current.items, reset = false) => {
    const value = { options: nextOptions, items: nextItems };
    if (reset) { latest.current = value; history.current = createCompositionHistory(value); setItems(nextItems); setOptions(nextOptions); select('$subject'); updateAvailability(); invalidate(); return; }
    commit(value);
  };
  const applyTemplate = (nextOptions: PublicationOptions) => replace(nextOptions, Object.fromEntries(Object.entries(latest.current.items).map(([id, item]) => { const copy = { ...item }; delete copy.overrides; return [id, copy]; })));
  return { scene, items, scope, setScope, selectedId, select, textFocus, editText: (id: string) => { select(id); setTextFocus(value => value + 1); }, patchLayer, patchSubject, add, remove, setItem, resetItem, replace, applyTemplate, begin, end, undo: () => step(-1), redo: () => step(1), ...availability, effective: (id?: string) => resolveComposition(scene, id ? items[id]?.overrides : undefined),
    reorder: (id: string, direction: number) => { const layers = [...scene.layers], index = layers.findIndex(layer => layer.id === id), target = Math.max(0, Math.min(layers.length - 1, index + direction)); if (index < 0 || index === target) return; const [layer] = layers.splice(index, 1); layers.splice(target, 0, layer); replace({ ...options, composition: { ...scene, layers } }); },
  };
}
export type CompositionEditor = ReturnType<typeof useCompositionEditor>;
