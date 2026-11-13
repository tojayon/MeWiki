import { afterEach, expect, it, vi } from 'vitest';
import { withFontLoadingLimit } from './fontLoading.ts';

afterEach(() => vi.useRealTimers());

it('returns a ready font without retaining its deadline', async () => {
  vi.useFakeTimers();
  await expect(withFontLoadingLimit(async () => 'ready', new AbortController().signal)).resolves.toBe('ready');
  expect(vi.getTimerCount()).toBe(0);
});

it('stops an unresponsive decoder and releases the caller at the deadline', async () => {
  vi.useFakeTimers();
  let taskSignal: AbortSignal | undefined;
  const waiting = withFontLoadingLimit(signal => { taskSignal = signal; return new Promise(() => {}); }, new AbortController().signal);
  const failed = expect(waiting).rejects.toThrow('字体加载超时');
  await vi.advanceTimersByTimeAsync(10000);
  await failed;
  expect(taskSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a pending load on unmount without waiting for the decoder', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const waiting = withFontLoadingLimit(() => new Promise(() => {}), abort.signal);
  const failed = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await failed;
  expect(vi.getTimerCount()).toBe(0);
});
