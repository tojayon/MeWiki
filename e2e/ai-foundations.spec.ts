import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { defaultCalloutAppearance } from '../src/domain/researchCallout.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';

const sessionKey = 'mewiki:library:default:ai-session:v1';
const provider = { id: 'foundation', name: '理论测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'foundation-model', hasApiKey: false };

async function setup(page: Page, initialView: 'notes' | 'foundations' = 'notes') {
  const state = createNotebookFixture(); state.view = initialView; state.open = true;
  const note = state.notes.find(note => note.id === 'mewiki-example-foundation')!;
  note.title = '选区理论';
  note.blocks = [
    { id: 'foundation-given', type: 'paragraph', section: 'given', text: '条件中的原文需要解释。' },
    { id: 'foundation-text', type: 'paragraph', text: '理论正文中的原文需要润色。' },
    { id: 'foundation-conclusion', type: 'paragraph', section: 'conclusion', text: '结论中的原文保持不变。' },
    { id: 'foundation-list', type: 'list', section: 'given', items: ['条件列表的原文。', '第二项条件保持不变。'] },
    { id: 'foundation-callout', type: 'callout', section: 'conclusion', title: '结论提示', text: '结论提示块的原文。', appearance: defaultCalloutAppearance },
    { id: 'foundation-tabs', type: 'examples', tabs: [
      { id: 'foundation-tab-a', title: '理论定义', blocks: [{ id: 'foundation-tab-text', type: 'paragraph', text: '理论标签页中的原文。' }] },
      { id: 'foundation-tab-b', title: '理论证明', blocks: [{ id: 'foundation-proof', type: 'paragraph', text: '另一标签页的证明原文。' }] },
    ] },
  ];
  state.activeNoteId = initialView === 'foundations' ? note.id : 'fixture-definition';
  state.librarySelections = { foundation: note.id, research: 'fixture-definition' };
  await page.addInitScript(state => {
    if (!sessionStorage.getItem('foundation-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)); sessionStorage.setItem('foundation-seeded', 'yes');
      localStorage.setItem('mewiki:research-notebook-mode', 'read');
    }
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, state);
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return page.getByTestId('mewiki-ai-workspace');
}
async function selectBlock(page: Page, id: string) {
  const text = page.locator(`[data-reading-note-id="mewiki-example-foundation"] [data-block-id="${id}"] .research-read-text`).first();
  await expect(text).toBeVisible(); await text.scrollIntoViewIfNeeded();
  await text.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test('attaches foundation text after opening its workspace tab and switches the selected tab source', async ({ page }) => {
  const ai = await setup(page);
  await page.getByRole('tab', { name: '基础理论', exact: true }).first().click();
  await page.locator('#research-notebook-sidebar').getByRole('button', { name: '选区理论', exact: true }).click();
  for (const id of ['foundation-text', 'foundation-tab-text', 'foundation-proof']) {
    if (id === 'foundation-proof') await page.getByRole('tab', { name: '理论证明', exact: true }).click();
    await selectBlock(page, id);
    const trigger = page.getByRole('button', { name: '用 AI 处理选中文字', exact: true }); await expect(trigger).toBeVisible(); await trigger.click();
    await expect(ai).toBeVisible(); await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('选区理论');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.selection?.blocks.map((block: { id: string }) => block.id), sessionKey)).toEqual([id]);
  }
});

test('attaches visible foundation text in both condition and conclusion drawers', async ({ page }) => {
  const ai = await setup(page, 'foundations');
  await page.getByRole('button', { name: '展开条件与结论', exact: true }).click();
  for (const id of ['foundation-given', 'foundation-conclusion']) {
    await selectBlock(page, id); await page.keyboard.press('Alt+Enter');
    await expect(ai).toBeVisible();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.selection?.blocks.map((block: { id: string }) => block.id), sessionKey)).toEqual([id]);
  }
});

test('attaches condition lists and conclusion callouts with their real source blocks', async ({ page }) => {
  const ai = await setup(page, 'foundations');
  await page.getByRole('button', { name: '展开条件与结论', exact: true }).click();
  for (const id of ['foundation-list', 'foundation-callout']) {
    await selectBlock(page, id);
    const trigger = page.getByRole('button', { name: '用 AI 处理选中文字', exact: true }); await expect(trigger).toBeVisible(); await trigger.click();
    await expect(ai).toBeVisible();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.selection?.blocks.map((block: { id: string }) => block.id), sessionKey)).toEqual([id]);
  }
});

test('opens an AI foundation source without changing it to the research workspace', async ({ page }) => {
  const ai = await setup(page, 'foundations'); await openAiWorkspace(page);
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: ++turn === 1
    ? { role: 'assistant', content: '', toolCalls: [{ id: 'foundation-read', name: 'read_note', arguments: JSON.stringify({ noteId: 'mewiki-example-foundation' }) }] }
    : { role: 'assistant', content: '已核对基础理论。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  await ai.getByLabel('任务要求', { exact: true }).fill('解释当前基础理论'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已核对基础理论。', { exact: true })).toBeVisible();
  await ai.getByRole('group', { name: '参考来源', exact: true }).getByRole('button', { name: '选区理论', exact: true }).click();
  await expect(page.getByRole('tab', { name: '基础理论', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).view)).toBe('foundations');
});

test('opens a foundation reference from an AI review of a research note in library scope', async ({ page }) => {
  const ai = await setup(page); await openAiWorkspace(page);
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  await ai.getByLabel('资料范围', { exact: true }).selectOption('library');
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: ++turn === 1
    ? { role: 'assistant', content: '', toolCalls: [
      { id: 'research-read', name: 'read_note', arguments: JSON.stringify({ noteId: 'fixture-definition' }) },
      { id: 'foundation-read', name: 'read_note', arguments: JSON.stringify({ noteId: 'mewiki-example-foundation' }) },
    ] }
    : turn === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: 'reference-edit', name: 'propose_note', arguments: JSON.stringify({ operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '参见[选区理论](#research-note/mewiki-example-foundation)。' }) }] }
    : { role: 'assistant', content: '已建议引用基础理论。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  await ai.getByLabel('任务要求', { exact: true }).fill('在研究笔记中引用基础理论'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已建议引用基础理论。', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await review.locator('a[data-reference-href="#research-note/mewiki-example-foundation"]').click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('textbox', { name: '笔记标题', exact: true })).toHaveValue('选区理论');
  await expect(page.getByRole('tab', { name: '基础理论', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).librarySelections.foundation)).toBe('mewiki-example-foundation');
});

test('supports actual selection and unsaved text editors in both foundation drawers', async ({ page }) => {
  const ai = await setup(page, 'foundations'), trigger = page.getByRole('button', { name: '用 AI 处理选中文字', exact: true });
  await page.getByRole('button', { name: '展开条件与结论', exact: true }).click();
  const given = page.locator('[data-block-id="foundation-given"] .research-read-text'); await given.scrollIntoViewIfNeeded();
  await given.dblclick({ position: { x: 35, y: 10 } }); await expect(trigger).toBeVisible(); await trigger.click();
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  const callout = page.locator('[data-block-id="foundation-callout"] .research-editable-text'); await callout.scrollIntoViewIfNeeded(); await callout.click();
  const editor = callout.locator('[contenteditable=true]'); await editor.fill('尚未失焦的新结论。');
  await editor.press('Control+A'); await expect(trigger).toBeVisible(); await trigger.click();
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('尚未失焦的新结论。');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'mewiki-example-foundation').blocks.find((block: { id: string }) => block.id === 'foundation-callout').text)).toBe('尚未失焦的新结论。');
  await expect(ai.getByRole('alert')).toHaveCount(0);
});

for (const [id, fields, changedText] of [
  ['foundation-list', { items: ['经核对的条件原文。', '第二项条件保持不变。'] }, '经核对的条件原文。'],
  ['foundation-callout', { text: '经核对的结论原文。' }, '经核对的结论原文。'],
] as const) test(`reviews, applies and undoes a selected foundation ${id} without changing its section`, async ({ page }, info) => {
  const ai = await setup(page, 'foundations');
  await page.getByRole('button', { name: '展开条件与结论', exact: true }).click();
  await selectBlock(page, id); await page.keyboard.press('Alt+Enter');
  const savedNote = () => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'mewiki-example-foundation'));
  const before = await savedNote();
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: ++turn === 1
    ? { role: 'assistant', content: '', toolCalls: [{ id: 'selected-read', name: 'read_block', arguments: JSON.stringify({ noteId: 'mewiki-example-foundation', blockId: id }) }] }
    : turn === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: 'selected-edit', name: 'propose_edit', arguments: JSON.stringify({ action: 'block-update', noteId: 'mewiki-example-foundation', blockId: id, fields }) }] }
    : { role: 'assistant', content: '理论选区建议等待确认。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  await ai.getByLabel('任务要求', { exact: true }).fill('准确表述选中的文字，保留其余内容'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('理论选区建议等待确认。', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai); await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'); await expect(review).toContainText(changedText);
  expect((await savedNote()).blocks).toEqual(before.blocks);
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  for (let index = 0; index < 30; index++) await move.press('Shift+ArrowLeft');
  await page.screenshot({ path: info.outputPath(`${id}-rendered-review.png`) });
  await review.getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect.poll(async () => JSON.stringify((await savedNote()).blocks)).toContain(changedText);
  const applied = await savedNote(); expect(applied.library).toBe('foundation');
  expect(applied.blocks.find((block: { id: string }) => block.id === id)).toEqual({ ...before.blocks.find((block: { id: string }) => block.id === id), ...fields });
  expect(applied.blocks.filter((block: { id: string }) => block.id !== id)).toEqual(before.blocks.filter((block: { id: string }) => block.id !== id));
  await page.reload(); await expect(ai).toBeVisible(); await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote()).blocks).toEqual(before.blocks);
  await expect(page.getByRole('tab', { name: '基础理论', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
});
