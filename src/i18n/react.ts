import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale } from './locale.ts';

/** Subscribes without changing component identity or resetting editor drafts. */
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
