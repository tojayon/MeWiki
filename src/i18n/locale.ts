import { english } from './en.ts';

export type Locale = 'zh-CN' | 'en';
export const LOCALE_STORAGE_KEY = 'mewiki:locale';
export const supportedLocales: readonly Locale[] = ['zh-CN', 'en'];
let locale: Locale = 'zh-CN';
const listeners = new Set<() => void>();

export function detectLocale(saved: string | null, languages: readonly string[] = []): Locale {
  if (saved === 'zh-CN' || saved === 'en') return saved;
  return languages[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
export function getLocale(): Locale { return locale; }
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setLocale(next: Locale, storage?: Pick<Storage, 'setItem'>) {
  if (!supportedLocales.includes(next)) return;
  try { storage?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Language selection also works without storage. */ }
  if (locale === next) return;
  locale = next;
  for (const listener of listeners) listener();
}
export function initializeLocale(storage?: Pick<Storage, 'getItem'>, languages: readonly string[] = []): Locale {
  let saved: string | null = null;
  try { saved = storage?.getItem(LOCALE_STORAGE_KEY) ?? null; } catch { /* Use the browser preference. */ }
  setLocale(detectLocale(saved, languages));
  return locale;
}

/** Explicit UI messages only. Never walk or translate saved notebook data. */
export function translate(message: string, values: readonly unknown[] = [], language: Locale = locale): string {
  const template = language === 'en' && Object.hasOwn(english, message) ? english[message] : message;
  return template.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
}
export function t(message: string): string;
export function t(message: TemplateStringsArray, ...values: unknown[]): string;
export function t(message: string | TemplateStringsArray, ...values: unknown[]): string {
  if (typeof message === 'string') return translate(message);
  return translate(message.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, ''), values);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let errorPatterns: { key: string; pattern: RegExp }[] | undefined;
/** Localize errors at the presentation boundary; server messages and data stay stable. */
export function localizeError(message: string | undefined | null): string {
  if (!message || locale === 'zh-CN') return message ?? '';
  if (Object.hasOwn(english, message)) return translate(message);
  errorPatterns ??= Object.keys(english).filter(key => /\{\d+\}/.test(key)).sort((a, b) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length).map(key => ({ key,
    pattern: new RegExp('^' + key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? '([\\s\\S]*?)' : escapeRegex(part)).join('') + '$'),
  }));
  for (const { key, pattern } of errorPatterns) {
    const match = pattern.exec(message);
    if (match) return translate(key, match.slice(1));
  }
  return message;
}

export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(locale, options).format(date);
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
