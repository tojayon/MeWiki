import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { savePublicationDraft, type PublicationDraft, type PublicationDraftScope } from './publicationDrafts.ts';

export function usePublicationDraft(scope: PublicationDraftScope, tabId: string, value: PublicationDraft) {
  const [status, setStatus] = useState<'saved' | 'pending' | 'error'>('pending');
  const [error, setError] = useState('');
  // Claim an independent slot even when a new tab has inherited another tab's draft.
  const latest = useRef({ value, revision: 1, saved: 0 });
  const writing = useRef<Promise<boolean> | null>(null), alive = useRef(true);
  useLayoutEffect(() => {
    if (latest.current.value !== value) { latest.current.value = value; latest.current.revision++; }
  }, [value]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (writing.current) return writing.current;
    if (latest.current.saved === latest.current.revision) return true;
    const pending = (async () => {
      try {
        do {
          const { value: captured, revision } = latest.current;
          await savePublicationDraft(scope, tabId, captured, revision === 1);
          latest.current.saved = revision;
        } while (latest.current.saved !== latest.current.revision);
        if (alive.current) { setError(''); setStatus('saved'); }
        return true;
      } catch (cause) {
        if (alive.current) { setError(cause instanceof Error ? cause.message : '导出草稿保存失败，当前修改尚未保存。请重试后再离开页面。'); setStatus('error'); }
        return false;
      }
    })();
    writing.current = pending;
    const saved = await pending;
    if (writing.current === pending) writing.current = null;
    return saved;
  }, [scope, tabId]);
  useEffect(() => {
    alive.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (latest.current.saved !== latest.current.revision) { event.preventDefault(); event.returnValue = ''; }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') void flush(); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', onHidden);
    return () => { alive.current = false; window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', onHidden); };
  }, [flush]);
  useEffect(() => {
    if (latest.current.saved === latest.current.revision) return;
    setStatus('pending');
    const timer = window.setTimeout(() => { void flush(); }, 250);
    return () => window.clearTimeout(timer);
  }, [value, flush]);
  const retry = async () => { if (latest.current.saved === latest.current.revision) latest.current.revision++; setStatus('pending'); return flush(); };
  return { status, error, flush, retry };
}
