import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import type { ResearchMediaBlock } from '../src/domain/researchMedia.ts';

test.use({ locale: 'en-US' });

async function seedMedia(page: Page, withSource: boolean) {
  const note = { ...createResearchNote('Media language fixture'), id: 'media-language-note', library: 'research' as const };
  note.blocks = (['audio', 'video'] as const).map(kind => ({
    id: `media-language-${kind}`, type: 'media', kind, alt: `Authored ${kind} title`,
    ...(withSource ? { source: { type: 'url', url: `https://example.test/${kind}` } } : {}),
  } satisfies ResearchMediaBlock));
  const state = { ...createNotebookFixture(), notes: [note], activeNoteId: note.id, view: 'notes' as const };
  await page.route('https://example.test/**', route => route.abort());
  await page.addInitScript(state => localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)), state);
  await page.goto('/');
}

async function chooseLanguage(page: Page, language: 'en' | 'zh-CN') {
  await page.getByRole('button', { name: /^(Interface language|界面语言)$/ }).click();
  const settings = page.getByTestId('mewiki-language-settings');
  await settings.getByRole('radio', { name: language === 'en' ? /English/ : /简体中文/ }).check();
  await settings.getByRole('button', { name: /^(Close|关闭)$/ }).click();
}

test('keeps existing audio and video playback errors in the selected interface language', async ({ page }) => {
  await seedMedia(page, true);
  for (const kind of ['audio', 'video'] as const) {
    const block = page.locator(`.research-media-block[data-media-kind="${kind}"]`);
    await block.locator(kind).dispatchEvent('error');
    await expect(block.getByRole('alert')).toContainText(`Unable to play ${kind === 'audio' ? 'Audio' : 'Video'}.`);
  }
  await chooseLanguage(page, 'zh-CN');
  for (const [kind, label] of [['audio', '音频'], ['video', '视频']] as const) {
    const block = page.locator(`.research-media-block[data-media-kind="${kind}"]`);
    await expect(block.getByRole('alert')).toHaveText(`${label}无法播放，文件编码可能不受当前浏览器支持，或来源暂时不可用。可下载原件查看或替换。`);
    await expect(block.getByText(`Authored ${kind} title`, { exact: true })).toBeVisible();
  }
  await chooseLanguage(page, 'en');
  for (const [kind, label] of [['audio', 'Audio'], ['video', 'Video']] as const) {
    await expect(page.locator(`.research-media-block[data-media-kind="${kind}"]`).getByRole('alert')).toContainText(`Unable to play ${label}.`);
  }
});

test('keeps invalid media URL feedback localized across language changes without losing the draft', async ({ page }) => {
  await seedMedia(page, false);
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  for (const kind of ['audio', 'video'] as const) {
    const block = page.locator(`.research-media-block[data-media-kind="${kind}"]`);
    await block.locator('input[type="url"]').fill('file:///unsupported');
    await block.getByRole('button', { name: 'Use link', exact: true }).click();
  }
  await chooseLanguage(page, 'zh-CN');
  for (const [kind, label] of [['audio', '音频'], ['video', '视频']] as const) {
    const block = page.locator(`.research-media-block[data-media-kind="${kind}"]`);
    await expect(block.getByRole('alert')).toContainText(`请输入 HTTP 或 HTTPS ${label}直链。`);
    await expect(block.locator('input[type="url"]')).toHaveValue('file:///unsupported');
  }
  await chooseLanguage(page, 'en');
  for (const [kind, label] of [['audio', 'Audio'], ['video', 'Video']] as const) {
    await expect(page.locator(`.research-media-block[data-media-kind="${kind}"]`).getByRole('alert')).toContainText(`Enter a direct HTTP or HTTPS ${label} URL.`);
  }
});
