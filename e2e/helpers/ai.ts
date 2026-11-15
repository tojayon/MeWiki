import { expect, type Locator, type Page } from '@playwright/test';

/** The edge entry is a toggle; a restored open chat already satisfies an open request. */
export async function openAiWorkspace(page: Page, english = false) {
  const ai = page.getByTestId('mewiki-ai-workspace');
  const entry = page.getByRole('button', { name: english ? 'AI workspace' : 'AI 工作区', exact: true }).first();
  await expect.poll(async () => await ai.isVisible() || await entry.isVisible()).toBe(true);
  if (await ai.isVisible()) return ai;
  await expect(entry).toBeVisible();
  if (await entry.getAttribute('aria-expanded') !== 'true') await entry.click();
  await expect(ai).toBeVisible();
  return ai;
}

/** Viewport resize is followed by a measured, bounded floating-panel layout update. */
export async function expectAiPanelInViewport(page: Page) {
  const size = page.viewportSize()!;
  await expect.poll(async () => {
    const frame = await page.getByTestId('mewiki-ai-workspace').boundingBox();
    return !!frame && frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= size.width + 1 && frame.y + frame.height <= size.height + 1;
  }).toBe(true);
}

/** Scope is selected through the same visible @ entry as object references. */
export async function setAiReferenceScope(ai: Locator, scope: 'current' | 'library', english = false) {
  const removeLibrary = ai.getByRole('button', { name: english ? 'Remove library search' : '移除整库检索', exact: true });
  if (scope === 'library' && await removeLibrary.count()) return;
  if (scope === 'current' && await removeLibrary.count()) await removeLibrary.click();
  await ai.getByRole('button', { name: english ? 'Add an object reference' : '添加对象引用', exact: true }).click();
  const picker = ai.getByRole('dialog', { name: english ? 'Add an object reference' : '添加对象引用', exact: true });
  await picker.getByRole('button', { name: scope === 'library' ? english ? 'Search library' : '整库检索' : english ? /^Current (note|symbol|term|map|page)$/ : /^当前(笔记|符号|术语|地图|页面)$/, exact: true }).click();
}

/** Open the compact cards before exercising their actions. New UI tests verify the collapsed default separately. */
export async function expandAiProposalCards(ai: Locator, wait = true) {
  if (wait) await ai.locator('.mewiki-ai-proposal-card').first().waitFor({ state: 'attached' });
  for (const card of await ai.locator('.mewiki-ai-proposal-card').all()) {
    if (await card.getAttribute('open') === null) await card.locator('summary').click();
  }
}

/** Replace rendered content through the editor's Markdown paste action, rather than typing source markers as text. */
export async function replaceRenderedAiReviewText(editor: Locator, source: string) {
  await editor.press('ControlOrMeta+a');
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, source);
}
