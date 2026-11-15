import { expect, test, type Locator, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { openAiWorkspace } from './helpers/ai.ts';

async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'fixture-definition';
  await page.addInitScript(({ state, english }) => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'true');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, english });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '弹层检查库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'popup', providers: [{ id: 'popup', name: '虚构服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'popup-test', hasApiKey: false }] } }));
  await page.route('**/api/mewiki/ai/chat', () => { throw new Error('Opening configuration must not request AI'); });
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return openAiWorkspace(page, english);
}

async function expectAnchored(panel: Locator, trigger: Locator, ai: Locator) {
  await expect(panel).toBeVisible();
  await expect.poll(async () => {
    const box = (await panel.boundingBox())!, button = (await trigger.boundingBox())!;
    return Math.min(Math.abs(button.y - box.y - box.height - 6), Math.abs(box.y - button.y - button.height - 6));
  }).toBeLessThan(2);
  const box = (await panel.boundingBox())!, bounds = (await ai.boundingBox())!, button = (await trigger.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(bounds.x);
  expect(box.y).toBeGreaterThanOrEqual(bounds.y);
  expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  expect(box.x).toBeLessThan(button.x + button.width);
  expect(box.x + box.width).toBeGreaterThan(button.x);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

for (const english of [false, true]) for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 320 }]) test(`keeps dark action popovers beside their actual buttons over a long composer in ${english ? 'English' : 'Chinese'} at ${viewport.width}px`, async ({ page }, info) => {
  await page.setViewportSize(viewport);
  const ai = await setup(page, english), input = ai.getByLabel(english ? 'Task instructions' : '任务要求', { exact: true });
  await input.fill('草稿继续保留\n'.repeat(10));
  for (const [zh, en, selector] of [
    ['快捷提问', 'Quick prompts', '.mewiki-ai-quick-options'],
    ['模型设置', 'Model settings', '.mewiki-ai-model-options'],
    ['添加对象引用', 'Add an object reference', '.mewiki-ai-reference-picker'],
    ['对话历史', 'Conversation history', '.mewiki-ai-conversation-panel'],
    ['Token 使用记录', 'Token usage history', '.mewiki-ai-usage-panel'],
    ['觅维功能', 'MeWiki features', '.mewiki-ai-product-help-panel'],
  ]) {
    const trigger = ai.getByRole('button', { name: english ? en : zh, exact: true });
    await trigger.click(); const panel = ai.locator(selector);
    await expect(panel).toHaveCSS('background-color', 'rgb(38, 52, 73)');
    await expectAnchored(panel, trigger, ai);
    await expect(ai.locator('.mewiki-ai-popover-backdrop')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${english ? 'en' : 'zh'}-${selector.slice(11)}.png`) });
    const control = panel.locator('button, input, select, [tabindex]').first();
    await (await control.count() ? control : trigger).press('Escape');
    await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
  }
  await expect(input).toHaveValue('草稿继续保留\n'.repeat(10));
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 320 }]) test(`anchors editor panels with a local backdrop and retains drafts at ${viewport.width}px`, async ({ page }, info) => {
  await page.setViewportSize(viewport); const ai = await setup(page);
  const prompt = ai.getByLabel('任务要求', { exact: true }); await prompt.fill('保留聊天草稿');
  for (const [name, selector, field] of [
    ['对话记忆', '.mewiki-ai-memory-panel', '本对话固定要求'],
    ['资料库规范与技能', '.mewiki-ai-skills-panel', '资料库默认规范'],
  ]) {
    const trigger = ai.getByRole('button', { name, exact: true }); await trigger.click();
    const panel = ai.locator(selector), backdrop = ai.locator('.mewiki-ai-popover-backdrop');
    await expectAnchored(panel, trigger, ai); await expect(backdrop).toBeVisible();
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(panel.locator('header')).toHaveCSS('background-color', 'rgb(38, 52, 73)');
    await panel.getByLabel(field, { exact: true }).fill('编辑草稿保留');
    const cover = (await backdrop.boundingBox())!, bounds = (await ai.boundingBox())!;
    expect(cover.x).toBeGreaterThanOrEqual(bounds.x); expect(cover.y).toBeGreaterThan(bounds.y);
    expect(cover.x + cover.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(cover.y + cover.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    await page.screenshot({ path: info.outputPath(`${viewport.width}-${selector.slice(11)}.png`) });
    await backdrop.click({ position: { x: cover.width / 2, y: 2 } });
    await expect(panel).toBeHidden(); await expect(trigger).toBeFocused(); await expect(ai).toBeVisible();
    await trigger.click(); await expect(panel.getByLabel(field, { exact: true })).toHaveValue('编辑草稿保留');
    await panel.getByLabel(field, { exact: true }).press('Escape'); await expect(trigger).toBeFocused();
  }
  await expect(prompt).toHaveValue('保留聊天草稿');
});

test('keeps an open editor attached while moving, resizing, touching an edge and docking', async ({ page }, info) => {
  const ai = await setup(page), trigger = ai.getByRole('button', { name: '资料库规范与技能', exact: true });
  await trigger.click();
  const panel = ai.locator('.mewiki-ai-skills-panel');
  await panel.getByLabel('资料库默认规范', { exact: true }).fill('移动缩放不丢草稿');
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  const grip = (await move.boundingBox())!;
  await page.mouse.move(grip.x + 60, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x - 500, -30, { steps: 10 }); await page.mouse.up();
  await expectAnchored(panel, trigger, ai);
  expect((await ai.boundingBox())!.y).toBe(0);
  const sizeBefore = (await ai.boundingBox())!, edge = ai.locator('[data-ai-resize-edge=se]'), corner = (await edge.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
  await page.mouse.move(corner.x + 120, corner.y + 100, { steps: 10 }); await page.mouse.up();
  expect((await ai.boundingBox())!.width).toBeGreaterThan(sizeBefore.width + 100);
  expect((await ai.boundingBox())!.height).toBeGreaterThan(sizeBefore.height + 80);
  await expectAnchored(panel, trigger, ai);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await expect(ai).toHaveAttribute('data-placement', 'right');
  await expectAnchored(panel, trigger, ai);
  await expect(panel.getByLabel('资料库默认规范', { exact: true })).toHaveValue('移动缩放不丢草稿');
  await page.screenshot({ path: info.outputPath('docked-editor.png') });
  await panel.getByLabel('资料库默认规范', { exact: true }).press('Escape');
  await expect(trigger).toBeFocused(); await expect(ai).toBeVisible();
});

test('reanchors the reference picker after mention queries change and preserves keyboard search', async ({ page }) => {
  const ai = await setup(page), prompt = ai.getByLabel('任务要求', { exact: true });
  const trigger = ai.getByRole('button', { name: '添加对象引用', exact: true });
  const panel = ai.locator('.mewiki-ai-reference-picker');
  for (const query of ['关', '关系', '定义']) {
    await prompt.fill(`请看 @${query}`);
    await expect(panel.getByRole('combobox')).toHaveValue(query);
    await expectAnchored(panel, trigger, ai);
    await expect(panel).toHaveCSS('background-color', 'rgb(38, 52, 73)');
  }
  const search = panel.getByRole('combobox');
  await search.evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  await expect(panel).toBeVisible();
  await search.fill('关系定义'); await search.press('ArrowDown'); await search.press('ArrowUp'); await search.press('Enter');
  await expect(panel).toBeHidden();
  await expect(prompt).toHaveValue('请看 @关系定义'); await expect(prompt).toBeFocused();
});
