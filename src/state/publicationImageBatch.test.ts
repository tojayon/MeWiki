import { expect, it, vi } from 'vitest';
import { generatePublicationImages, type PublicationImageInput } from './publicationImageBatch.ts';
import { defaultPublicationOptions, type PublicationRequest } from '../domain/publicationTypes.ts';
import { defaultComposition, newCompositionLayer } from '../domain/publicationComposition.ts';

const options = () => ({ ...defaultPublicationOptions(), width: 720, height: 720, imageMode: { fit: 'cover' as const } });
const image = (id: string): PublicationImageInput => ({ id, name: id, crop: { x: 50, y: 50, zoom: 100 }, load: vi.fn(async () => 'data:image/png;base64,' + 'A'.repeat(200)) });
const render = (request: PublicationRequest) => Promise.resolve({ format: request.options.format, pages: request.document.blocks.map(block => ({ dataUrl: block.content, width: request.options.width, height: request.options.height })) });
it('keeps the full-batch variable index and per-picture overrides across sequential groups', async () => {
  const inputs = [image('a'), image('b'), image('c')].map((item, index) => ({ ...item, imageData: { title: `标题${index + 1}`, subtitle: '', name: item.name, index: index + 1, total: 3, overrides: { layers: { title: { x: index * 10 } } } } }));
  const calls: PublicationRequest[] = [];
  const settings = { ...options(), composition: { ...defaultComposition(), layers: [newCompositionLayer('text', 'title')] } };
  await generatePublicationImages(inputs, settings, new AbortController().signal, () => {}, { imageBudget: 800, generate: async request => { calls.push(structuredClone(request)); inputs[2].imageData.title = '已改变'; return render(request); } });
  expect(calls.flatMap(call => call.document.blocks.map(block => block.imageData?.title))).toEqual(['标题1', '标题2', '标题3']);
  expect(calls.flatMap(call => call.document.blocks.map(block => block.imageData?.index))).toEqual([1, 2, 3]);
});

it('lazily groups images in order, freezes template and crop settings and reports whole-batch progress', async () => {
  const inputs = [image('a'), image('b'), image('c')], settings = options();
  const calls: PublicationRequest[] = [], progress: number[][] = [];
  const generate = vi.fn(async (request: PublicationRequest) => {
    calls.push(structuredClone(request));
    settings.background = '#000000'; inputs[2].crop!.x = 0;
    return render(request);
  });
  const result = await generatePublicationImages(inputs, settings, new AbortController().signal, (done, total) => progress.push([done, total]), { generate, imageBudget: 460 });
  expect(calls.map(call => call.document.blocks.map(block => block.id))).toEqual([['a', 'b'], ['c']]);
  expect(calls[1].document.blocks[0].crop!.x).toBe(50);
  expect(calls.map(call => call.options.background)).toEqual(['#ffffff', '#ffffff']);
  expect(result.pages).toHaveLength(3);
  expect(progress[0]).toEqual([0, 3]); expect(progress.at(-1)).toEqual([3, 3]);
});
it('stops after cancellation and never loads the remaining batch', async () => {
  const inputs = [image('a'), image('b'), image('c'), image('d')], abort = new AbortController();
  const generate = vi.fn(async (request: PublicationRequest) => { abort.abort(); return render(request); });
  await expect(generatePublicationImages(inputs, options(), abort.signal, () => {}, { generate, imageBudget: 230 })).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(inputs[2].load).not.toHaveBeenCalled(); expect(inputs[3].load).not.toHaveBeenCalled();
});
it('identifies the global failing picture and does not continue after resource or group failure', async () => {
  const inputs = [image('a'), image('b'), image('c'), image('d')];
  inputs[2].load = vi.fn(async () => { throw new Error('本地图片原件未找到。'); });
  await expect(generatePublicationImages(inputs, options(), new AbortController().signal, () => {}, { generate: render, imageBudget: 230 })).rejects.toThrow(/第 3 项.*本地图片原件/);
  expect(inputs[3].load).not.toHaveBeenCalled();
  const generate = vi.fn(async () => { throw new Error('导出内容 → 第 1 项 → 图片：图片损坏。'); });
  await expect(generatePublicationImages([image('a'), image('b')], options(), new AbortController().signal, () => {}, { generate, imageBudget: 230 })).rejects.toThrow(/第 1 项.*图片损坏/);
  expect(generate).toHaveBeenCalledTimes(1);
  const secondGroup = vi.fn(async (request: PublicationRequest) => { if (request.document.blocks[0].id === 'b') throw new Error('导出内容 → 第 1 项 → 图片：图片损坏。'); return render(request); });
  await expect(generatePublicationImages([image('a'), image('b'), image('c')], options(), new AbortController().signal, () => {}, { generate: secondGroup, imageBudget: 230 })).rejects.toThrow(/第 2 项.*图片损坏/);
});
it('checks batch count, pixel budgets and result size before publishing a partial success', async () => {
  const generate = vi.fn(render), signal = new AbortController().signal;
  await expect(generatePublicationImages(Array.from({ length: 51 }, (_, i) => image(String(i))), options(), signal, () => {}, { generate })).rejects.toThrow(/50/);
  await expect(generatePublicationImages(Array.from({ length: 18 }, (_, i) => image(String(i))), { ...options(), width: 2160, height: 2160 }, signal, () => {}, { generate })).rejects.toThrow(/8000 万像素/);
  expect(generate).not.toHaveBeenCalled();
  await expect(generatePublicationImages([image('a')], options(), signal, () => {}, { generate, resultBudget: 1 })).rejects.toThrow(/图片总量/);
});
