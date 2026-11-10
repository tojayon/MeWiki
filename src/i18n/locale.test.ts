import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, initializeLocale, getLocale, setLocale, subscribeLocale, translate, t, localizeError } from './locale.ts';

afterEach(() => setLocale('zh-CN'));

describe('interface locale', () => {
  it('uses an explicit preference before browser languages, with an English fallback', () => {
    expect(detectLocale('en', ['zh-CN'])).toBe('en');
    expect(detectLocale('zh-CN', ['en-US'])).toBe('zh-CN');
    expect(detectLocale(null, ['zh-TW', 'en'])).toBe('zh-CN');
    expect(detectLocale('invalid', ['en-GB'])).toBe('en');
    expect(detectLocale(null, ['ja-JP'])).toBe('en');
  });
  it('translates explicit UI messages and leaves unknown content intact', () => {
    expect(translate('取消', [], 'en')).toBe('Cancel');
    expect(translate('取消', [], 'zh-CN')).toBe('取消');
    expect(translate('My authored note: 取消', [], 'en')).toBe('My authored note: 取消');
    expect(translate('toString', [], 'en')).toBe('toString');
  });
  it('interpolates once without interpreting user data as another message or markup', () => {
    expect(translate('关闭{0}', ['<script>取消 {1}</script>'], 'en')).toBe('Close <script>取消 {1}</script>');
    setLocale('en');
    expect(t`关闭${'我的笔记'}`).toBe('Close 我的笔记');
    expect(translate('关闭{0}', ['$&'], 'en')).toBe('Close $&');
  });
  it('notifies subscribers without remounting data, and tolerates denied storage', () => {
    const changes: string[] = [];
    const unsubscribe = subscribeLocale(() => changes.push(getLocale()));
    setLocale('en', { setItem() { throw new Error('denied'); } });
    expect(getLocale()).toBe('en');
    expect(changes).toEqual(['en']);
    unsubscribe();
    setLocale('zh-CN');
    expect(changes).toEqual(['en']);
  });
  it('persists only the interface preference and recovers from corrupt storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    setLocale('en', storage);
    expect([...values]).toEqual([['mewiki:locale', 'en']]);
    expect(initializeLocale(storage, ['zh-CN'])).toBe('en');
    values.set('mewiki:locale', 'broken');
    expect(initializeLocale(storage, ['zh-CN'])).toBe('zh-CN');
    expect(initializeLocale({ getItem() { throw new Error('denied'); } }, ['en'])).toBe('en');
  });
});

it('prefers a complete status template over a shorter prefix while preserving dynamic content', () => {
  setLocale('en');
  expect(localizeError('已将 3 项内容放入标签页')).toBe('Moved 3 content items into the tab');
  expect(localizeError('替换图片，原件保留用于历史恢复')).toBe('Replace 图片; the original is preserved for version recovery');
  expect(localizeError('Custom service response: untouched')).toBe('Custom service response: untouched');
  setLocale('zh-CN');
  expect(localizeError('已将 3 项内容放入标签页')).toBe('已将 3 项内容放入标签页');
});
