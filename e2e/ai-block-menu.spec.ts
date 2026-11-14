import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createAiSession } from '../src/ai/session.ts';
import { expandAiProposalCards } from './helpers/ai.ts';

const sessionKey = 'mewiki:library:default:ai-session:v1';
async function setup(page: Page, english = false, foundation = false) {
  const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
  state.activeNoteId = note.id; state.view = foundation ? 'foundations' : 'notes'; state.open = true;
  note.library = foundation ? 'foundation' : 'research';
  note.blocks = [
    { id: 'row-text', type: 'paragraph', text: '无需选择就能发送的整行内容。' },
    { id: 'row-formula', type: 'formula', section: foundation ? 'given' : undefined, tex: 'x = 1', caption: '初始条件' },
    { id: 'row-tabs', type: 'examples', tabs: [
      { id: 'row-tab-a', title: '第一页', blocks: [{ id: 'row-child-a', type: 'paragraph', text: '第一页内容' }] },
      { id: 'row-tab-b', title: '第二页', blocks: [{ id: 'row-child-b', type: 'paragraph', text: '第二页内容' }] },
    ] },
    { id: 'row-conclusion', type: 'paragraph', section: foundation ? 'conclusion' : undefined, text: '结论行内容' },
  ];
  await page.addInitScript(({ state, english, sessionKey, session }) => {
    if (!sessionStorage.getItem('block-menu-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem(sessionKey, JSON.stringify(session));
      sessionStorage.setItem('block-menu-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, english, sessionKey, session: { ...createAiSession('default'), draft: '保留已有任务草稿' } });
  let requests = 0;
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'test', providers: [{ id: 'test', name: '测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'test-model', hasApiKey: false }] } }));
  await page.route('**/api/mewiki/ai/chat', route => { requests++; return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '已读取本行引用。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }); });
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return { ai: page.getByTestId('mewiki-ai-workspace'), requests: () => requests };
}

async function attachRow(page: Page, id: string, english = false, menuScreenshot?: string) {
  await page.locator(`[data-block-id="${id}"] > .research-block-insert`).getByRole('button', { name: english ? 'Block actions' : '内容块操作', exact: true }).click();
  const menu = page.getByRole('dialog', { name: english ? 'Block actions' : '内容块操作', exact: true });
  if (menuScreenshot) await page.screenshot({ path: menuScreenshot });
  await menu.getByRole('button', { name: english ? 'Send to AI' : '发送到 AI', exact: true }).click();
  await expect(menu).toBeHidden();
}

test('attaches a whole row without text selection, preserves the draft and restores the reference', async ({ page }, info) => {
  const { ai, requests } = await setup(page);
  await attachRow(page, 'row-text', false, info.outputPath('block-menu-action.png'));
  const quote = ai.getByRole('group', { name: '本行内容', exact: true });
  await expect(quote).toContainText('无需选择就能发送的整行内容。');
  await expect(ai.getByLabel('资料范围', { exact: true })).toHaveValue('selection');
  await expect(ai.getByLabel('资料范围', { exact: true }).locator('option:checked')).toHaveText('本行内容');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留已有任务草稿');
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeFocused();
  expect(requests()).toBe(0);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).selection?.kind, sessionKey)).toBe('block');
  await page.screenshot({ path: info.outputPath('block-menu-quote.png') });
  await page.reload();
  await expect(quote).toContainText('无需选择就能发送的整行内容。');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留已有任务草稿');
  await ai.getByRole('button', { name: '移除本行内容', exact: true }).click();
  await expect(quote).toHaveCount(0); expect(requests()).toBe(0);
});

test('includes the last editor change and attaches nested tab content and formulas', async ({ page }) => {
  const { ai, requests } = await setup(page);
  const editor = page.locator('[data-block-id="row-text"]').getByRole('textbox', { name: '笔记段落', exact: true });
  await editor.click();
  await editor.fill('刚刚编辑后的完整内容。');
  await attachRow(page, 'row-text');
  await expect(ai.getByRole('group', { name: '本行内容', exact: true })).toContainText('刚刚编辑后的完整内容。');
  await expect(ai.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI 工作区', exact: true }).click();
  await page.locator('[data-block-id="row-tabs"]').getByRole('tab', { name: '第二页', exact: true }).click();
  await attachRow(page, 'row-child-b');
  await expect(ai.getByRole('group', { name: '本行内容', exact: true })).toContainText('第二页内容');
  await page.getByRole('button', { name: 'AI 工作区', exact: true }).click();
  await attachRow(page, 'row-formula');
  await expect(ai.getByRole('group', { name: '本行内容', exact: true })).toContainText('x = 1');
  expect(requests()).toBe(0);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.locator('.mewiki-ai-message[data-role="user"] .mewiki-ai-message-quote')).toContainText('x = 1');
  await expect(ai.locator('.mewiki-ai-message[data-role="assistant"]')).toContainText('已读取本行引用。');
  expect(requests()).toBe(1);
});

test('provides the same menu in foundation conditions and conclusions', async ({ page }) => {
  const { ai, requests } = await setup(page, false, true);
  await page.getByRole('button', { name: '展开条件与结论', exact: true }).click();
  await attachRow(page, 'row-formula');
  await expect(ai.getByRole('group', { name: '本行内容', exact: true })).toContainText('初始条件');
  await attachRow(page, 'row-conclusion');
  await expect(ai.getByRole('group', { name: '本行内容', exact: true })).toContainText('结论行内容');
  expect(requests()).toBe(0);
});

test('supports the English action and keyboard navigation without adding an action to the tail picker', async ({ page }) => {
  const { ai, requests } = await setup(page, true);
  await page.locator('[data-block-id="row-text"] > .research-block-insert').getByRole('button', { name: 'Block actions', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Block actions', exact: true });
  await menu.press('End');
  await expect(menu.getByRole('button', { name: 'Send to AI', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(ai.getByRole('group', { name: 'Row content', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Insert at end of note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Insert note content', exact: true }).getByRole('button', { name: 'Send to AI', exact: true })).toHaveCount(0);
  expect(requests()).toBe(0);
});

test('reviews a formula row suggestion, saves only after approval and restores the original on undo', async ({ page }, info) => {
  const { ai } = await setup(page);
  await attachRow(page, 'row-formula');
  const savedBlocks = () => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks);
  const original = await savedBlocks();
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: ++turn === 1
    ? { role: 'assistant', content: '', toolCalls: [{ id: 'row-read', name: 'read_block', arguments: JSON.stringify({ noteId: 'fixture-definition', blockId: 'row-formula' }) }] }
    : turn === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: 'row-edit', name: 'propose_edit', arguments: JSON.stringify({ action: 'block-update', noteId: 'fixture-definition', blockId: 'row-formula', fields: { tex: 'x = 2', caption: '修正后的条件' } }) }] }
    : { role: 'assistant', content: '本行公式建议等待确认。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  await ai.getByLabel('任务要求', { exact: true }).fill('修正本行公式并保留其他内容');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('本行公式建议等待确认。', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review).toContainText('修正后的条件');
  expect(await savedBlocks()).toEqual(original);
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  for (let index = 0; index < 30; index++) await move.press('Shift+ArrowLeft');
  await page.screenshot({ path: info.outputPath('block-menu-formula-review.png') });
  await review.getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect.poll(async () => (await savedBlocks()).find((block: { id: string }) => block.id === 'row-formula')).toEqual({ ...original.find((block: { id: string }) => block.id === 'row-formula'), tex: 'x = 2', caption: '修正后的条件' });
  expect((await savedBlocks()).filter((block: { id: string }) => block.id !== 'row-formula')).toEqual(original.filter((block: { id: string }) => block.id !== 'row-formula'));
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(savedBlocks).toEqual(original);
});
