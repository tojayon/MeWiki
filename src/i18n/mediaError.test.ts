import { afterEach, expect, it } from 'vitest';
import { validateMediaFile } from '../domain/researchMedia.ts';
import { setLocale } from './locale.ts';
import { localizeMediaError } from './mediaError.ts';

afterEach(() => setLocale('zh-CN'));

it('renders stored media failures in the current language including their system type', () => {
  const failures = [
    ['audio', '音频无法播放，文件编码可能不受当前浏览器支持，或来源暂时不可用。可下载原件查看或替换。', 'Unable to play Audio. The encoding may be unsupported by this browser, or the source may be temporarily unavailable. Download the original to view it, or replace it.'],
    ['video', '请输入 HTTP 或 HTTPS 视频直链。', 'Enter a direct HTTP or HTTPS Video URL.'],
    ['image', '下载保存网络图片需要先设置本地资料库。', 'Set up a local library before downloading online Image.'],
    ['pdf', '该地址返回的文件不是PDF 文档，原内容已保留。', 'The file returned by this URL is not PDF document. Existing content has been preserved.'],
  ] as const;
  for (const [, source, english] of failures) {
    setLocale('en');
    expect(localizeMediaError(source)).toBe(english);
    setLocale('zh-CN');
    expect(localizeMediaError(source)).toBe(source);
  }
});

it('localizes domain validation errors while preserving unknown external messages', () => {
  let message = '';
  try { validateMediaFile({ name: 'picture.png', type: 'image/png', size: 100 }, 'audio'); }
  catch (cause) { message = (cause as Error).message; }
  setLocale('en');
  expect(localizeMediaError(message)).toBe('Select a file of type Audio. Existing content is unchanged.');
  expect(localizeMediaError('External failure for 我的音频.wav: {0}')).toBe('External failure for 我的音频.wav: {0}');
  setLocale('zh-CN');
  expect(localizeMediaError(message)).toBe('请选择音频文件，当前内容保持不变。');
});

it('uses the poster validation type when a video requires an image file', () => {
  let message = '';
  try { validateMediaFile({ name: 'poster.wav', type: 'audio/wav', size: 100 }, 'image'); }
  catch (cause) { message = (cause as Error).message; }
  setLocale('en');
  expect(localizeMediaError(message)).toBe('Select a file of type Image. Existing content is unchanged.');
});
