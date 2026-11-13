/** Font decoding itself cannot be cancelled, so bound the caller as well as I/O. */
export async function withFontLoadingLimit<T>(task: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let cancel: () => void;
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => { abort.abort(signal.reason); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const error = new Error('字体加载超时，已使用备用字体。可重新选择或重新导入字体。');
      abort.abort(error); reject(error);
    }, 10000);
  });
  try { return await Promise.race([Promise.resolve().then(() => { abort.signal.throwIfAborted(); return task(abort.signal); }), stopped]); }
  finally { clearTimeout(timer!); signal.removeEventListener('abort', cancel!); }
}
