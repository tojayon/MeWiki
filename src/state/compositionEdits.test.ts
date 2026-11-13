import { expect, it } from 'vitest';
import { defaultComposition, newCompositionLayer, resolveComposition } from '../domain/publicationComposition.ts';
import { patchCompositionLayer, removeCompositionLayer, createCompositionHistory, pushCompositionHistory, stepCompositionHistory } from './compositionEdits.ts';

it('keeps per-picture properties when editing shared colors and resets only the selected override', () => {
  const scene = { ...defaultComposition(), layers: [newCompositionLayer('text', 'title')] };
  const first = patchCompositionLayer(scene, {}, 'picture-a', 'title', { x: 33 });
  const shared = patchCompositionLayer(first.scene, first.items, undefined, 'title', { color: '#ef2929' });
  expect(resolveComposition(shared.scene, shared.items['picture-a'].overrides).layers[0]).toMatchObject({ x: 33, color: '#ef2929' });
  expect(resolveComposition(shared.scene, shared.items['picture-b']?.overrides).layers[0].x).toBe(10);
});
it('removes orphan overrides when deleting a shared layer without deleting image data', () => {
  const scene = { ...defaultComposition(), layers: [newCompositionLayer('text', 'title')] };
  const first = patchCompositionLayer(scene, { a: { title: '保留文字' } }, 'a', 'title', { x: 30 });
  const next = removeCompositionLayer(first.scene, first.items, 'title');
  expect(next.scene.layers).toEqual([]); expect(next.items.a.title).toBe('保留文字');
  expect(next.items.a.overrides?.layers).not.toHaveProperty('title');
});
it('records a gesture once, bounds history, supports redo and clears redo after a new change', () => {
  let history = createCompositionHistory(0);
  history = pushCompositionHistory(history, 1, 0);
  history = pushCompositionHistory(history, 2, 0, true);
  expect(history.past).toEqual([0]);
  history = stepCompositionHistory(history, -1); expect(history.present).toBe(0);
  history = stepCompositionHistory(history, 1); expect(history.present).toBe(2);
  history = stepCompositionHistory(history, -1);
  history = pushCompositionHistory(history, 4, history.present);
  expect(history.future).toEqual([]);
  for (let i = 0; i < 100; i++) history = pushCompositionHistory(history, i, history.present);
  expect(history.past.length).toBeLessThanOrEqual(50);
});
