import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { openAiWorkspace } from './helpers/ai.ts';
import { createAiSession } from '../src/ai/session.ts';
import { createNoteProposal } from '../src/ai/proposals.ts';
import { closeSettingsPage, openSettingsSection } from './helpers/settings.ts';

async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'fixture-definition';
  state.terms = [{ id: 'dock-term', name: '嵌入测试术语', meaning: '用于切换内容的虚构术语。', aliases: [] }];
  await page.addInitScript(({ state, english }) => {
    if (!sessionStorage.getItem('ai-docking-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
      localStorage.setItem('mewiki:research-notebook-mode', 'edit');
      sessionStorage.setItem('ai-docking-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
  }, { state, english });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'dock-test', providers: [
    { id: 'dock-test', name: '嵌入测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'dock-model', hasApiKey: false },
  ] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return openAiWorkspace(page, english);
}

test('docks the same chat into the right column, remembers it and restores the floating frame', async ({ page }, info) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('嵌入后保留的草稿');
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles({ name: '嵌入参考.json', mimeType: 'application/json', buffer: Buffer.from('{"title":"辅助资料"}') });
  await expect(ai.getByRole('button', { name: '查看材料：嵌入参考.json', exact: true })).toBeVisible();
  const frame = (await ai.boundingBox())!;
  await input.evaluate(element => element.dataset.dockingIdentity = 'same-input');
  const dock = ai.getByRole('button', { name: '嵌入右侧栏', exact: true });
  await expect(dock).toBeVisible({ timeout: 3000 }); await dock.click();
  await expect(ai).toHaveAttribute('data-placement', 'right');
  await expect(ai.getByRole('tab', { name: '智能助理', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('data-docking-identity', 'same-input');
  await expect(input).toHaveValue('嵌入后保留的草稿');
  await expect(ai.getByRole('button', { name: '查看材料：嵌入参考.json', exact: true })).toBeVisible();
  const layout = (await page.locator('.research-notebook-layout').boundingBox())!, docked = (await ai.boundingBox())!;
  expect(Math.abs(docked.x + docked.width - layout.x - layout.width)).toBeLessThan(2);
  expect(Math.abs(docked.height - layout.height)).toBeLessThan(2);
  const content = (await page.locator('.research-reading-rail').boundingBox())!;
  expect(content.x + content.width).toBeLessThanOrEqual(docked.x + 1);
  await expect(page.getByTestId('mewiki-ai-launcher')).toBeHidden();
  await expect(ai.getByRole('button', { name: '移动AI 面板', exact: true })).toHaveCount(0);
  const separator = page.getByRole('separator', { name: '调整右侧栏宽度', exact: true });
  const before = docked.width; await separator.focus(); await separator.press('ArrowLeft');
  await expect.poll(async () => (await ai.boundingBox())!.width).toBeGreaterThan(before);
  await page.screenshot({ path: info.outputPath('ai-docked-desktop.png') });
  await page.reload();
  await expect(ai).toBeVisible(); await expect(ai).toHaveAttribute('data-placement', 'right');
  await expect(input).toHaveValue('嵌入后保留的草稿');
  await expect(ai.getByRole('button', { name: '查看材料：嵌入参考.json', exact: true })).toBeVisible();
  await openSettingsSection(page, 'general'); await expect(ai).toBeHidden();
  await closeSettingsPage(page); await expect(ai).toBeVisible();
  await ai.getByRole('button', { name: '切换为浮窗', exact: true }).click();
  await expect(ai).toHaveAttribute('data-placement', 'floating');
  const restored = (await ai.boundingBox())!;
  expect(Math.abs(restored.x - frame.x)).toBeLessThan(2);
  expect(Math.abs(restored.width - frame.width)).toBeLessThan(2);
  expect(Math.abs(restored.height - frame.height)).toBeLessThan(2);
  await expect(page.locator('#research-note-outline')).toHaveCount(0);
  await expect(input).toHaveValue('嵌入后保留的草稿');
});

test('keeps one task running through docking, content tabs and sidebar collapse', async ({ page }) => {
  const ai = await setup(page); let release!: () => void, requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    requests++; await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '切换位置期间完成的回复' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }).catch(() => {});
  });
  try {
    await ai.getByLabel('任务要求', { exact: true }).fill('切换位置时继续运行');
    await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await ai.getByLabel('任务要求', { exact: true }).fill('下一条追问');
    await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
    await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
    await ai.getByRole('button', { name: '切换为浮窗', exact: true }).click();
    await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
    await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
    await ai.getByRole('tab', { name: '大纲', exact: true }).click();
    await expect(ai).toBeHidden();
    const outline = page.locator('#research-note-outline');
    await outline.getByRole('tab', { name: '反向链接', exact: true }).click();
    await outline.getByRole('tab', { name: '智能助理', exact: true }).click();
    await expect(ai).toBeVisible(); await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收起AI 工作区', exact: true }).first().click();
    await expect(ai).toBeHidden();
    release();
    await openAiWorkspace(page);
    await expect(ai.getByText('切换位置期间完成的回复', { exact: true })).toBeVisible();
    await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('下一条追问');
    expect(requests).toBe(1);
  } finally { release(); }
});

test('keeps docked chat available after leaving the outline for a term without a right-side tool', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('切到术语也保留');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await ai.getByRole('tab', { name: '大纲', exact: true }).click();
  await page.getByRole('tab', { name: '术语', exact: true }).click();
  await page.getByRole('button', { name: '嵌入测试术语', exact: true }).click();
  await expect(ai).toBeVisible();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('切到术语也保留');
});

test('keeps English docked controls reachable on narrow and short screens', async ({ page }, info) => {
  const ai = await setup(page, true);
  await page.setViewportSize({ width: 390, height: 620 });
  await ai.getByRole('button', { name: 'Dock to right sidebar', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(ai).toHaveAttribute('data-placement', 'right');
  await ai.getByLabel('Task instructions', { exact: true }).fill('A draft that stays available in the docked sidebar.');
  await expect(ai.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport();
  const tabBounds = (await ai.getByRole('tab', { name: 'AI Assistant', exact: true }).boundingBox())!;
  const tabsBounds = (await ai.getByRole('tablist').boundingBox())!;
  expect(tabBounds.x).toBeGreaterThanOrEqual(tabsBounds.x - 1);
  expect(tabBounds.x + tabBounds.width).toBeLessThanOrEqual(tabsBounds.x + tabsBounds.width + 1);
  await ai.getByRole('button', { name: 'Send message', exact: true }).click({ trial: true });
  await page.screenshot({ path: info.outputPath('ai-docked-english-narrow.png') });
  await page.setViewportSize({ width: 390, height: 320 });
  await ai.getByRole('button', { name: 'Send message', exact: true }).click({ trial: true });
  await ai.getByRole('button', { name: 'Switch to floating window', exact: true }).click({ trial: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ai.getByRole('button', { name: 'Switch to floating window', exact: true }).click();
  await expect(ai).toHaveAttribute('data-placement', 'floating');
  await expect(ai.getByLabel('Task instructions', { exact: true })).toHaveValue('A draft that stays available in the docked sidebar.');
});

test('isolates docking preferences by library and restores the original library chat', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('本库嵌入草稿');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [
    { id: 'default', name: '嵌入测试库', directory: null }, { id: 'dock-other', name: '另一个嵌入测试库', directory: null },
  ], contextDefaults: { standalone: 'default' } } }));
  await page.evaluate(state => localStorage.setItem('mewiki:library:dock-other:notebook', JSON.stringify(state)), createNotebookFixture());
  await page.goto('/?library=dock-other'); await openAiWorkspace(page);
  await expect(ai).toHaveAttribute('data-placement', 'floating');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
  await page.goto('/?library=default'); await openAiWorkspace(page);
  await expect(ai).toHaveAttribute('data-placement', 'right');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('本库嵌入草稿');
});

test('retains central rendered review and approve/undo while docking and resizing to narrow screens', async ({ page }, info) => {
  const ai = await setup(page);
  const state = createNotebookFixture(), proposal = createNoteProposal(state, 'default', { operation: 'create', title: '嵌入审阅测试', content: '需要用户同意的新增笔记。' });
  await page.addInitScript(session => localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session)), { ...createAiSession('default'), status: 'complete' as const, proposals: [proposal] });
  await page.reload(); await expect(ai).toBeVisible();
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await ai.locator('.mewiki-ai-proposal-card summary').click();
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByText('需要用户同意的新增笔记。', { exact: true })).toBeVisible();
  await expect(ai).toBeVisible();
  await page.setViewportSize({ width: 390, height: 620 });
  await page.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await expect(ai).toBeVisible(); await expect(ai).not.toHaveAttribute('inert');
  await expect(ai.locator('header .research-outline-toggle')).toBeVisible();
  await ai.getByRole('button', { name: '收起AI 工作区', exact: true }).click();
  await expect(ai).toBeHidden();
  await expect(review.getByRole('button', { name: '返回编辑', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-docked-narrow-review.png') });
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await page.locator('.research-sidebar-ribbon.is-right').getByRole('tab', { name: '智能助理', exact: true }).click();
  await expect(ai).toBeVisible(); await expect(ai).not.toHaveAttribute('inert');
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await page.locator('.research-sidebar-ribbon.is-right').getByRole('tab', { name: '智能助理', exact: true }).click();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.locator('.research-sidebar-ribbon.is-right').getByRole('tab', { name: '智能助理', exact: true }).click();
  await expect(ai).toBeVisible();
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect(ai.locator('.mewiki-ai-proposal')).toHaveAttribute('data-status', 'undone');
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.some((note: { id: string }) => note.id === id), proposal.targetId)).toBe(false);
});

test('restores a previously visible outline when undocking', async ({ page }) => {
  const ai = await setup(page);
  await page.getByRole('button', { name: '展开文章大纲', exact: true }).first().click();
  await expect(page.locator('#research-note-outline')).toBeVisible();
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await expect(page.locator('#research-note-outline')).toBeHidden();
  await ai.getByRole('button', { name: '切换为浮窗', exact: true }).click();
  await expect(page.locator('#research-note-outline')).toBeVisible();
  await expect(page.locator('#research-note-outline header').getByRole('button').first()).toHaveAccessibleName('收起文章大纲');
});

test('keeps a newly docked chat and its panel switch usable during narrow central review', async ({ page }) => {
  const ai = await setup(page);
  const proposal = createNoteProposal(createNotebookFixture(), 'default', { operation: 'create', title: '窄屏切换测试', content: '只供本地验证。' });
  await page.addInitScript(session => localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session)), { ...createAiSession('default'), proposals: [proposal] });
  await page.reload(); await expect(ai).toBeVisible();
  await page.setViewportSize({ width: 390, height: 620 });
  await ai.locator('.mewiki-ai-proposal-card summary').click();
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'); await expect(review).toBeVisible();
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await expect(ai).toBeVisible(); await expect(ai).not.toHaveAttribute('inert');
  await ai.getByRole('button', { name: '收起AI 工作区', exact: true }).click();
  const ribbon = page.locator('.research-sidebar-ribbon.is-right');
  await expect(ribbon.getByRole('button').first()).toBeFocused();
  await ribbon.getByRole('tab', { name: '智能助理', exact: true }).click();
  await expect(ai).toBeVisible();
  await page.keyboard.press('Escape'); await expect(ai).toBeHidden();
  await ribbon.getByRole('button').first().click(); await expect(ai).toBeVisible();
  await ai.getByRole('button', { name: '收起AI 工作区', exact: true }).click();
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await ribbon.getByRole('button').first().click();
  await expect(ai).toBeVisible(); await expect(ai).not.toHaveAttribute('inert');
});
