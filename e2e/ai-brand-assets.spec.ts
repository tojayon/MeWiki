import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { openAiWorkspace } from './helpers/ai.ts';
import { openSettingsSection } from './helpers/settings.ts';

async function expectMascotsLoaded(page: Page, minimum: number) {
  const images = page.locator('img.mewiki-ai-mascot:visible');
  await expect.poll(() => images.count()).toBeGreaterThanOrEqual(minimum);
  await expect.poll(() => images.evaluateAll(elements => elements.every(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }))).toBe(true);
}

test('keeps every chat mascot decoded when the old standalone image path returns a fallback page', async ({ page }, info) => {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'fixture-definition';
  await page.addInitScript(state => {
    if (!sessionStorage.getItem('brand-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)); sessionStorage.setItem('brand-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', 'zh-CN'); localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, state);
  await page.route('**/brand/mewiki-ai-mascot.svg*', route => route.request().resourceType() === 'image'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>fallback page</body></html>' }) : route.continue());
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'brand', providers: [{ id: 'brand', name: '头像测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'brand-test', hasApiKey: false }] } }));
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '头像与回复正常显示。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expectMascotsLoaded(page, 1);
  const ai = await openAiWorkspace(page); await expectMascotsLoaded(page, 3);
  await ai.getByLabel('任务要求', { exact: true }).fill('核对头像'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('头像与回复正常显示。', { exact: true })).toBeVisible(); await expectMascotsLoaded(page, 3);
  await page.screenshot({ path: info.outputPath('ai-brand-decoded-chat.png') });
  await page.reload(); await expect(ai).toBeVisible(); await expectMascotsLoaded(page, 3);
  await page.getByTestId('mewiki-ai-launcher').click();
  const text = page.locator('[data-block-id="fixture-definition:text"] .research-read-text').first();
  await text.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByRole('button', { name: '用 AI 处理选中文字', exact: true })).toBeVisible(); await expectMascotsLoaded(page, 2);
  await page.keyboard.press('Escape'); await openSettingsSection(page, 'ai'); await expectMascotsLoaded(page, 2);
  await page.screenshot({ path: info.outputPath('ai-brand-decoded-settings.png') });
});
