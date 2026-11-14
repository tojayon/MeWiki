import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import type { AiProvider, AiSettings } from '../src/ai/types.ts';
import type { ResearchNotebookState } from '../src/domain/researchNotebook.ts';
import { normalizeResearchNotebook } from '../src/domain/researchNotebook.ts';
import { createNoteProposal } from '../src/ai/proposals.ts';
import { createNativeProposal } from '../src/ai/nativeProposals.ts';
import { createAiSession } from '../src/ai/session.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';

async function useNarrowReview(page: Page) {
  const collapse = page.getByRole('button', { name: '收起笔记左侧面板', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.setViewportSize({ width: 390, height: 680 });
}

async function setup(page: Page, configured = true, locale = 'zh-CN', initial: Partial<ResearchNotebookState> = {}) {
  const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  Object.assign(state, initial);
  await page.addInitScript(({ state, locale }) => {
    if (!sessionStorage.getItem('mewiki-test-preserve-state')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', locale);
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, locale });
  let settings: AiSettings = { revision: '0', defaultProviderId: configured ? 'provider-1' : null,
    providers: configured ? [{ id: 'provider-1', name: '测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'test-agent', hasApiKey: true }] : [] };
  const saved: unknown[] = [];
  await page.route('**/api/mewiki/ai/settings', async route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); saved.push(input);
      settings = { revision: String(Number(settings.revision) + 1), defaultProviderId: input.defaultProviderId,
        providers: input.providers.map((provider: AiProvider & { apiKey?: string }) => { const { apiKey, ...rest } = provider; return { ...rest, hasApiKey: apiKey === undefined ? settings.providers.find(item => item.id === provider.id)?.hasApiKey ?? false : !!apiKey }; }) };
    }
    await route.fulfill({ json: settings });
  });
  await page.route('**/api/mewiki/ai/test', route => route.fulfill({ json: { response: true, stream: true, tools: true, message: '模型响应、流式输出和工具调用测试通过。' } }));
  await page.route('**/api/mewiki/ai/models', route => route.fulfill({ json: { models: ['test-agent', 'another-model'] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return { saved };
}
async function openAi(page: Page) {
  const dialog = await openAiWorkspace(page); await expandAiProposalCards(dialog, false); return dialog;
}

async function suggestEdits(page: Page, suggestions: Record<string, string>[]) {
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    turn++;
    const message = turn === 1 ? { role: 'assistant', content: '', toolCalls: [{ id: 'review-read', name: 'read_note', arguments: JSON.stringify({ noteId: 'fixture-definition' }) }] }
      : turn === 2 ? { role: 'assistant', content: '', toolCalls: suggestions.map((args, index) => ({ id: `review-${index}`, name: 'propose_note', arguments: JSON.stringify(args) })) }
        : { role: 'assistant', content: '已准备修改，等待审阅。' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('审阅并修改当前笔记');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已准备修改，等待审阅。', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai);
  return ai;
}

async function suggestNativeOperations(page: Page, reads: { name: string; args: Record<string, unknown> }[], edits: Record<string, unknown>[], scope = 'current') {
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    const operations = ++turn === 1 ? reads : turn === 2 ? edits.map(args => ({ name: 'propose_edit', args })) : [];
    const message = operations.length ? { role: 'assistant', content: '', toolCalls: operations.map((call, index) => ({ id: `native-${turn}-${index}`, name: call.name, arguments: JSON.stringify(call.args) })) }
      : { role: 'assistant', content: '原生修改已准备，等待审阅。' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  const ai = await openAi(page);
  await ai.getByRole('combobox', { name: '资料范围', exact: true }).selectOption(scope);
  await ai.getByLabel('任务要求', { exact: true }).fill('按原生内容修改并保留稳定引用');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('原生修改已准备，等待审阅。', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai);
  return ai;
}

function tabbedFixture() {
  const state = createNotebookFixture();
  state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === 'fixture-definition')!.blocks = [{ id: 'tabs', type: 'examples', tabs: [
    { id: 'event', title: '通信事件', blocks: [{ id: 'nested', type: 'paragraph', text: '原来的通信事件说明。' }] },
    { id: 'other', title: '保留标签', blocks: [{ id: 'unchanged', type: 'paragraph', text: '这段继续保留。' }] },
  ] }];
  return state;
}

function fiveTabFixture() {
  const state = createNotebookFixture();
  state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === 'fixture-definition')!.blocks = [{ id: 'events', type: 'examples', title: '控制闭环通信事件', tabs:
    ['状态采样事件', '中继调度事件', '控制计算事件', '输入执行事件', '状态更新事件'].map((title, index) => ({
      id: `event-${index}`, title, blocks: index === 1 ? [] : [{ id: `event-${index}:text`, type: 'paragraph' as const, text: `保留事件 ${index + 1} 的说明。` }],
    })),
  }];
  return state;
}

test('resolves existing AI reply citations in the current library and keeps real missing links disabled after reload', async ({ page }) => {
  const state = createNotebookFixture(), encodedId = 'citation/中文 空格';
  state.notes.push({ ...state.notes.find(note => note.id === 'fixture-conditions')!, id: encodedId, title: '引用测试笔记' });
  await setup(page, true, 'zh-CN', { notes: state.notes });
  const href = `#research-note/${encodeURIComponent(encodedId)}`;
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: `参见[定义](#research-note/fixture-definition)与[来源](${href})。缺失的[关系定义](#research-note/actually-missing)。` }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('解释引用');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  const citation = ai.locator(`a[data-reference-href="${href}"]`);
  await expect(citation).not.toHaveAttribute('aria-disabled', 'true');
  await expect(citation).toHaveText('引用测试笔记');
  const missing = ai.locator('a[data-reference-href="#research-note/actually-missing"]');
  await expect(missing).toHaveAttribute('aria-disabled', 'true');
  await expect(missing).toHaveAttribute('title', '目标笔记已移除');
  await citation.click();
  await expect(page.locator(`.research-reading-pane[data-reading-note-id="${encodedId}"]`)).toBeVisible();
  await expect(ai).toBeVisible();
  await page.reload();
  await expect(citation).not.toHaveAttribute('aria-disabled', 'true');
  await expect(citation).toHaveText('引用测试笔记');
  await expect(missing).toHaveAttribute('aria-disabled', 'true');
});

test('highlights distant changed words in rendered Markdown without marking shared prose as deleted', async ({ page }, info) => {
  const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
  const before = `保留 **原有格式** 与 [参考](#research-note/fixture-conditions)，系统始终稳定。${'保留背景条件。'.repeat(100)}响应迅速，$x^2$ 不变。`;
  note.blocks = [{ id: 'rich-words', type: 'markdown', kind: 'markdown', text: before }];
  await setup(page, true, 'zh-CN', { notes: state.notes });
  await suggestEdits(page, [{ operation: 'replace-text', noteId: note.id, blockId: 'rich-words', content: before.replace('始终', '局部').replace('迅速', '平稳') }]);
  const review = page.getByTestId('mewiki-ai-review');
  const block = review.locator('[data-review-block-id="rich-words"]');
  await expect(block.locator('del.mewiki-ai-inline-change')).toHaveText(['始终', '迅速']);
  await expect(block.locator('ins.mewiki-ai-inline-change')).toHaveText(['局部', '平稳']);
  await expect(block.locator('strong')).toHaveText(['原有格式', '原有格式']);
  await expect(block.locator('.katex')).toHaveCount(2);
  await expect(block.locator('a.research-note-link[aria-disabled="true"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('precise-markdown-desktop.png') });
  await page.setViewportSize({ width: 390, height: 620 });
  await expect(block.locator('ins.mewiki-ai-inline-change').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('precise-markdown-mobile.png') });
  await review.getByRole('button', { name: '查看源码差异', exact: true }).click();
  await expect(block.locator('del.mewiki-ai-inline-change')).toHaveText(['始终', '迅速']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks[0].text);
  expect(saved).toBe(before);
});

test('shows visible change markers on rendered code and table structure despite their native backgrounds', async ({ page }, info) => {
  const state = createNotebookFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
  note.blocks = [
    { id: 'marked-code', type: 'markdown', kind: 'code', text: '```js\nconst value = 1;\n```' },
    { id: 'marked-table', type: 'markdown', kind: 'table', text: '| 列 |\n| :--- |\n| 保留值 |' },
  ];
  await setup(page, true, 'zh-CN', { notes: state.notes });
  await suggestEdits(page, [
    { operation: 'replace-text', noteId: note.id, blockId: 'marked-code', content: '```js\nconst value = 2;\n```' },
    { operation: 'replace-text', noteId: note.id, blockId: 'marked-table', content: '| 列 |\n| ---: |\n| 保留值 |' },
  ]);
  const review = page.getByTestId('mewiki-ai-review');
  for (const [kind, color] of [['remove', 'rgb(247, 203, 208)'], ['add', 'rgb(188, 228, 200)']]) {
    const code = review.locator(`code[data-ai-change="${kind}"]`);
    await expect(code).toBeVisible();
    await expect(code).toHaveCSS('box-shadow', `${color} 3px 0px 0px 0px inset`);
    const cells = review.locator(`table[data-ai-change="${kind}"] :is(th, td)`);
    await expect(cells).toHaveCount(2);
    for (const cell of await cells.all()) await expect(cell).toHaveCSS('background-color', color);
  }
  await page.screenshot({ path: info.outputPath('precise-code-table-desktop.png') });
});

test('combines seven alternating text and native changes in one note with switchable tabs and batch approval', async ({ page }, info) => {
  const state = fiveTabFixture(), id = 'fixture-definition';
  const note = state.notes.find(note => note.id === id)!;
  note.blocks.unshift({ id: 'preface', type: 'paragraph', text: '原来的前文。' });
  const original = structuredClone(note.blocks);
  await setup(page, true, 'zh-CN', state);
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    turn++;
    const reads = [{ name: 'read_note', args: { noteId: id } }, ...['events', 'event-3:text'].map(blockId => ({ name: 'read_block', args: { noteId: id, blockId } }))];
    const edits = [
      { name: 'propose_note', args: { operation: 'replace-text', noteId: id, blockId: 'preface', content: '**整篇前文改写**。' } },
      { name: 'propose_edit', args: { action: 'block-update', noteId: id, blockId: 'events', fields: { title: '控制闭环通信事件总览' } } },
      { name: 'propose_note', args: { operation: 'replace-text', noteId: id, blockId: 'event-0:text', content: '**采样改写**。' } },
      { name: 'propose_edit', args: { action: 'block-insert', noteId: id, blockType: 'paragraph', fields: { text: '**调度补充**。' }, container: { exampleBlockId: 'events', tabId: 'event-1' } } },
      { name: 'propose_note', args: { operation: 'replace-text', noteId: id, blockId: 'event-2:text', content: '**计算改写**。' } },
      { name: 'propose_edit', args: { action: 'block-update', noteId: id, blockId: 'event-3:text', fields: { text: '**执行改写**。' } } },
      { name: 'propose_note', args: { operation: 'replace-text', noteId: id, blockId: 'event-4:text', content: '**更新改写**。' } },
    ];
    const operations = turn === 1 ? reads : turn === 2 ? edits : [];
    const message = operations.length ? { role: 'assistant', content: '', toolCalls: operations.map((operation, index) => ({ id: `combined-${turn}-${index}`, name: operation.name, arguments: JSON.stringify(operation.args) })) }
      : { role: 'assistant', content: '七处修改已准备。' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('一起修改整篇笔记和五个标签');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('七处修改已准备。', { exact: true })).toBeVisible();
  await expect(ai.locator('.mewiki-ai-proposals')).toContainText('7 项修改');
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByRole('button', { name: '下一个目标', exact: true })).toHaveCount(0);
  await expect(review.locator('.mewiki-ai-review-position')).toHaveCount(0);
  await expect(review.getByRole('tablist')).toHaveCount(1);
  await expect(review.getByRole('tabpanel')).toHaveCount(1);
  await expect(review.locator('ins strong').filter({ hasText: '整篇前文改写' })).toBeVisible();
  for (const [title, text] of [['状态采样事件', '采样改写'], ['中继调度事件', '调度补充'], ['控制计算事件', '计算改写'], ['输入执行事件', '执行改写'], ['状态更新事件', '更新改写']]) {
    await review.getByRole('tab', { name: title, exact: true }).click();
    await expect(review.getByRole('tabpanel').locator('ins strong')).toHaveText(text);
    await expect(review.locator('ins strong').filter({ hasText: '整篇前文改写' })).toBeVisible();
    await expect(review.getByRole('tablist')).toHaveCount(1);
  }
  await page.screenshot({ path: info.outputPath('ai-combined-note-tabs.png') });
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).nth(1).click();
  await expect(review.getByRole('tablist')).toHaveCount(1);
  await expect(review.getByRole('tabpanel')).toHaveCount(1);
  await review.getByRole('tab', { name: '输入执行事件', exact: true }).click();
  await expect(review.getByRole('tabpanel').locator('ins strong')).toHaveText('执行改写');
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('整篇前文改写');
  await review.getByRole('button', { name: '应用当前页面修改', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((item: { id: string }) => item.id === 'fixture-definition'));
  expect(saved.blocks).toHaveLength(2);
  expect(saved.blocks[1].tabs).toHaveLength(5);
  for (const text of ['整篇前文改写', '采样改写', '调度补充', '计算改写', '执行改写', '更新改写']) expect(JSON.stringify(saved)).toContain(text);
  await page.evaluate(() => sessionStorage.setItem('mewiki-test-preserve-state', 'true'));
  await page.reload(); ai = await openAi(page);
  for (let index = 6; index >= 0; index--) {
    await expandAiProposalCards(ai);
    await ai.getByRole('button', { name: '撤回此修改', exact: true }).nth(index).click();
    await expect(ai.getByText('此项修改已撤回并保存。', { exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((item: { id: string }) => item.id === 'fixture-definition').blocks)).toEqual(original);
});

test('merges redundant pending edits without creating a false undo record and restores their status', async ({ page }) => {
  const state = normalizeResearchNotebook(tabbedFixture()), id = 'fixture-definition';
  state.notes.find(note => note.id === id)!.blocks.unshift({ id: 'heading', type: 'heading', level: 2, text: '旧标题' });
  const proposals = [createNoteProposal(state, 'default', { operation: 'replace-text', noteId: id, blockId: 'heading', content: '新标题' }),
    createNativeProposal(state, 'default', { action: 'block-update', noteId: id, blockId: 'heading', fields: { level: 3 } }),
    createNativeProposal(state, 'default', { action: 'block-update', noteId: id, blockId: 'heading', fields: { text: '新标题' } })];
  await page.addInitScript(session => {
    if (!sessionStorage.getItem('mewiki-test-preserve-state')) localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
  }, { ...createAiSession('default'), proposals });
  await setup(page, true, 'zh-CN', state);
  let ai = await openAi(page);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  await page.getByTestId('mewiki-ai-review').getByRole('button', { name: '应用当前页面修改', exact: true }).click();
  await expect(ai.getByText('已合并', { exact: true })).toHaveCount(1);
  await expect(ai.getByText('已撤回', { exact: true })).toHaveCount(0);
  await expandAiProposalCards(ai);
  await expect(ai.getByRole('button', { name: '撤回此修改', exact: true })).toHaveCount(2);
  await page.evaluate(() => sessionStorage.setItem('mewiki-test-preserve-state', 'true'));
  await page.reload(); ai = await openAi(page);
  await expect(ai.getByText('已合并', { exact: true })).toHaveCount(1);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).last().click();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect(ai.getByText('已撤回', { exact: true })).toHaveCount(2);
  await expect(ai.getByText('已合并', { exact: true })).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks[0]);
  expect(saved).toEqual({ id: 'heading', type: 'heading', level: 2, text: '旧标题' });
});

test('focuses a selected tab rename after earlier changes and can refocus the same suggestion', async ({ page }) => {
  const state = tabbedFixture();
  const note = state.notes.find(note => note.id === 'fixture-definition')!;
  const tabs = note.blocks[0];
  if (tabs.type !== 'examples') throw new Error('Expected tabs');
  tabs.tabs[1].blocks.push(...Array.from({ length: 30 }, (_, index) => ({ id: `tab-context-${index}`, type: 'paragraph' as const, text: `标签内的上下文 ${index + 1}。` })));
  note.blocks.unshift(...Array.from({ length: 30 }, (_, index) => ({ id: `context-${index}`, type: 'paragraph' as const, text: `保持的上下文 ${index + 1}。` })));
  await setup(page, true, 'zh-CN', state);
  const ai = await suggestNativeOperations(page, [
    { name: 'read_block', args: { noteId: 'fixture-definition', blockId: 'context-0' } },
    { name: 'read_block', args: { noteId: 'fixture-definition', blockId: 'nested' } },
    { name: 'read_block', args: { noteId: 'fixture-definition', blockId: 'tabs' } },
  ], [
    { action: 'block-update', noteId: 'fixture-definition', blockId: 'context-0', fields: { text: '顶部已修改。' } },
    { action: 'block-update', noteId: 'fixture-definition', blockId: 'nested', fields: { text: '第一页已修改。' } },
    { action: 'tab-update', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'other', title: '改名后的第二页' },
    { action: 'block-insert', noteId: 'fixture-definition', blockType: 'paragraph', fields: { text: '**目标页末尾新增**。' }, container: { exampleBlockId: 'tabs', tabId: 'other' } },
  ]);
  const review = page.getByTestId('mewiki-ai-review');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  await expect.poll(() => review.locator('.mewiki-ai-review-scroll').evaluate(element => element.scrollTop)).toBeLessThan(200);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).nth(2).click();
  await expect(review.getByRole('tab', { name: '改名后的第二页', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => review.locator('.mewiki-ai-review-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  await review.getByRole('tab', { name: '通信事件', exact: true }).click();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).nth(2).click();
  await expect(review.getByRole('tab', { name: '改名后的第二页', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.getByRole('tabpanel')).toContainText('这段继续保留。');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).last().click();
  await expect(review.locator('ins strong').filter({ hasText: '目标页末尾新增' })).toBeInViewport();
});

test('reviews hidden-tab text in one container and keeps tab navigation out of saved preferences', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('mewiki:research-example-tab:events', 'event-0'));
  await setup(page, true, 'zh-CN', fiveTabFixture());
  const savedBlocks = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks);
  const ai = await suggestEdits(page, [
    { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'event-3:text', content: '**执行事件**的新说明。' },
    { operation: 'delete-text', noteId: 'fixture-definition', blockId: 'event-4:text', content: '' },
  ]);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByRole('tablist', { name: '标签切换', exact: true })).toHaveCount(1);
  await expect(review.getByRole('tabpanel')).toHaveCount(1);
  await expect(review.locator('.research-examples-label')).toHaveCount(1);
  await expect(review.getByRole('tab', { name: '输入执行事件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.locator('[data-review-block-id="event-3:text"] .mewiki-ai-diff-row[data-kind="remove"]')).toContainText('保留事件 4 的说明。');
  await expect(review.locator('del.mewiki-ai-inline-change')).toHaveText(['保留', ' 4 ']);
  await expect(review.locator('ins strong')).toHaveText('执行事件');
  await review.getByRole('tab', { name: '中继调度事件', exact: true }).click();
  await expect(review.locator('.mewiki-ai-native-tab-body')).toBeEmpty();
  await review.getByRole('tab', { name: '状态采样事件', exact: true }).click();
  await expect(review.getByRole('tabpanel')).toHaveText('保留事件 1 的说明。');
  await review.getByRole('tab', { name: '状态采样事件', exact: true }).press('End');
  await expect(review.getByRole('tab', { name: '状态更新事件', exact: true })).toBeFocused();
  await expect(review.locator('del')).toHaveText('保留事件 5 的说明。');
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-example-tab:events'))).toBe('event-0');
  await expect(review.getByRole('button', { name: '下一个目标', exact: true })).toHaveCount(0);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).last().click();
  await expect(review.getByRole('tab', { name: '状态更新事件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.locator('del')).toHaveText('保留事件 5 的说明。');
  await expect(review.locator('ins')).toHaveCount(0);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  await expect(review.getByRole('tab', { name: '输入执行事件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await review.getByRole('button', { name: '查看源码差异', exact: true }).click();
  await expect(review.locator('.mewiki-ai-diff-row[data-kind="add"] .mewiki-ai-diff-text')).toHaveText('**执行事件**的新说明。');
  await expect(review.getByRole('tablist')).toHaveCount(1);
  await review.getByRole('button', { name: '查看渲染差异', exact: true }).click();
  await page.screenshot({ path: info.outputPath('ai-single-tab-review.png') });
  await useNarrowReview(page);
  await expect(review.getByRole('tab', { name: '输入执行事件', exact: true })).toBeInViewport();
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-single-tab-review-mobile.png') });
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('**执行事件**');
  await page.setViewportSize({ width: 1440, height: 960 });
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '应用建议', exact: true }).first().click();
  const applied = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks);
  expect(applied).toHaveLength(1);
  expect(applied[0].tabs).toHaveLength(5);
  expect(applied[0].tabs[3].blocks[0].text).toBe('**执行事件**的新说明。');
  expect(applied[0].tabs[4].blocks[0].text).toBe('保留事件 5 的说明。');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks)).toEqual(savedBlocks);
});

test('keeps one tab container while live text updates preserve a manually selected sibling tab', async ({ page }) => {
  await controlledLiveStream(page);
  await setup(page, true, 'zh-CN', fiveTabFixture());
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('实时修改输入执行事件');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.opened)).toBe(true);
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByRole('tablist')).toHaveCount(1);
  const prefix = '{"operation":"replace-text","noteId":"fixture-definition","blockId":"event-3:text","content":"**实时执行**说明';
  await page.evaluate(argumentsText => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'tabs-live', name: 'propose_note', arguments: argumentsText } }]), prefix);
  await expect(review.getByRole('tab', { name: '输入执行事件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.locator('ins strong')).toHaveText('实时执行');
  await review.getByRole('tab', { name: '状态采样事件', exact: true }).click();
  await page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'tabs-live', name: 'propose_note', arguments: '，继续生成。' } }]));
  await expect(review.getByRole('tab', { name: '状态采样事件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(review.getByRole('tabpanel')).toHaveText('保留事件 1 的说明。');
  await review.getByRole('tab', { name: '输入执行事件', exact: true }).click();
  await expect(review.locator('.mewiki-ai-diff-row[data-kind="add"]')).toContainText('继续生成。');
  await expect(review.locator('ins.mewiki-ai-inline-change').last()).toHaveText('，继续生成');
  await expect(review.getByRole('tablist')).toHaveCount(1);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('实时执行');
  await review.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(review).toHaveCount(0);
});

test('reviews native changes inside examples, renames a tab and safely restores them after reload', async ({ page }) => {
  await setup(page, true, 'zh-CN', tabbedFixture());
  let ai = await suggestNativeOperations(page, [
    { name: 'read_block', args: { noteId: 'fixture-definition', blockId: 'nested' } },
    { name: 'read_block', args: { noteId: 'fixture-definition', blockId: 'tabs' } },
  ], [
    { action: 'block-update', noteId: 'fixture-definition', blockId: 'nested', fields: { text: '**控制闭环**中的通信事件。' } },
    { action: 'tab-update', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'event', title: '控制闭环通信事件' },
  ]);
  await expect(ai.locator('.mewiki-ai-proposals')).toHaveCount(1);
  await expect(ai.locator('.mewiki-ai-proposals')).toContainText('2 项修改');
  await expect(ai.locator('.mewiki-ai-proposal-count')).toHaveAttribute('title', '1 个目标');
  await expect(ai.locator('.mewiki-ai-proposals')).not.toContainText('**控制闭环**中的通信事件。');
  const review = page.getByTestId('mewiki-ai-review');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  await expect(review.locator('ins strong')).toHaveText('控制闭环');
  await expect(review.getByText('这段继续保留。', { exact: true })).toHaveCount(0);
  await review.getByRole('tab', { name: '保留标签', exact: true }).click();
  await expect(review.getByText('这段继续保留。', { exact: true })).toHaveCount(1);
  await review.getByRole('tab', { name: /通信事件/ }).click();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('**控制闭环**');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '应用建议', exact: true }).first().click();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(review.getByRole('tab', { name: '控制闭环通信事件', exact: true })).toBeVisible();
  await expect(review.getByRole('tabpanel').locator('.mewiki-ai-review-after')).toContainText('控制闭环通信事件');
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(ai.getByText('建议已应用并保存。', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('mewiki-test-preserve-state', 'true'));
  await page.reload();
  ai = await openAi(page);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('控制闭环通信事件');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).first().click();
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('mewiki:research-notebook')))!);
  expect(saved.notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks[0]).toMatchObject({ id: 'tabs', tabs: [
    { id: 'event', title: '通信事件', blocks: [{ id: 'nested', text: '原来的通信事件说明。' }] }, { id: 'other', blocks: [{ id: 'unchanged' }] },
  ] });
});

test('renders a native formula edit and complete symbol fields before approval', async ({ page }, info) => {
  await setup(page, true, 'zh-CN', { activeNoteId: 'fixture-application' });
  const ai = await suggestNativeOperations(page, [
    { name: 'read_block', args: { noteId: 'fixture-application', blockId: 'fixture-application:formula' } },
    { name: 'read_dictionary_entry', args: { kind: 'symbol', entryId: 'example-matrix' } },
  ], [
    { action: 'block-update', noteId: 'fixture-application', blockId: 'fixture-application:formula', fields: { tex: 'E=mc^2', parts: [] } },
    { action: 'symbol-save', entryId: 'example-matrix', fields: { unit: '无量纲', scope: '线性系统', meaning: '闭环反馈映射。' } },
  ]);
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByText('无量纲', { exact: true })).toBeVisible();
  await expect(review.getByText('线性系统', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: '上一个目标', exact: true }).click();
  await expect(review.locator('ins .katex')).toBeVisible();
  await expect(review.locator('ins annotation')).toHaveText('E=mc^2');
  await page.screenshot({ path: info.outputPath('ai-native-formula-review.png') });
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('E=mc^2');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('闭环反馈映射');
});

test('reviews map creation and note relations with readable targets and reverses approved changes', async ({ page }) => {
  await setup(page);
  const ai = await suggestNativeOperations(page, [
    { name: 'read_note', args: { noteId: 'fixture-definition' } },
    { name: 'read_note', args: { noteId: 'fixture-summary' } },
  ], [
    { action: 'map-create', fields: { title: '闭环事件图', noteIds: ['fixture-definition', 'fixture-summary'] } },
    { action: 'relation-save', noteId: 'fixture-definition', fields: { source: { noteId: 'fixture-summary' }, target: { noteId: 'fixture-definition' }, kind: 'assumption', description: '以结果摘要作为适用条件。' } },
  ], 'library');
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByText('以结果摘要作为适用条件。', { exact: true })).toBeVisible();
  await expect(review.locator('ins').getByRole('button', { name: /结果摘要/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('以结果摘要作为适用条件');
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(review.getByRole('heading', { name: '闭环事件图', exact: true })).toBeVisible();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('闭环事件图');
  await page.getByRole('tab', { name: '理论地图', exact: true }).click();
  await page.getByRole('button', { name: '打开地图 闭环事件图', exact: true }).click();
  await expect(page.getByRole('region', { name: '理论地图文档', exact: true })).toBeVisible();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('闭环事件图');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).view)).toBe('maps');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('以结果摘要作为适用条件');
});

test('reviews and approves the global map with ordinary library scope while keeping manuals private', async ({ page }) => {
  const fixture = createNotebookFixture();
  const notes = fixture.notes.filter(note => ['fixture-definition', 'fixture-summary'].includes(note.id));
  notes.push({ ...structuredClone(notes[0]), id: 'mewiki-manual-private', title: 'PRIVATE_MANUAL_CONTENT', blocks: [] });
  await setup(page, true, 'zh-CN', { notes, theoryMaps: undefined, theoryMap: undefined });
  const requests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/mewiki/ai/chat')) requests.push(request.postData() ?? ''); });
  const ai = await suggestNativeOperations(page, [
    { name: 'read_note', args: { noteId: 'fixture-definition' } },
    { name: 'read_note', args: { noteId: 'fixture-summary' } },
    { name: 'read_theory_maps', args: { mapId: 'global' } },
  ], [{ action: 'map-update', mapId: 'global', fields: { title: '控制闭环全局图' } }], 'library');
  const review = page.getByTestId('mewiki-ai-review');
  expect(requests.join('\n')).not.toContain('PRIVATE_MANUAL_CONTENT');
  expect(requests.join('\n')).not.toContain('mewiki-manual-private');
  await expect(review.getByRole('heading', { name: '全局地图', exact: true, level: 1 })).toBeVisible();
  await expect(review.locator('[data-review-field="title"] .mewiki-ai-diff-row[data-kind="add"]')).toContainText('控制闭环全局图');
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('控制闭环全局图');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('控制闭环全局图');
});

test('shows complete term edits in English rendered review on a narrow read-only screen', async ({ page }, info) => {
  await setup(page, true, 'en', { terms: [{ id: 'closed-loop', name: '闭环', meaning: '反馈结构', aliases: [], englishName: 'Closed loop' }] });
  await page.getByRole('button', { name: 'Switch to read-only mode', exact: true }).click();
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    const message = ++turn === 1 ? { role: 'assistant', content: '', toolCalls: [{ id: 'term-read', name: 'read_dictionary_entry', arguments: '{"kind":"term","entryId":"closed-loop"}' }] }
      : turn === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: 'term-edit', name: 'propose_edit', arguments: JSON.stringify({ action: 'term-save', entryId: 'closed-loop', fields: { englishAbbreviation: 'CL', chineseAbbreviation: '闭环', aliasEntries: [{ id: 'feedback', name: '反馈环路' }], atoms: [{ id: 'closed', text: '闭', meaning: '闭合' }, { id: 'loop', text: '环', meaning: '环路' }], scope: '**控制系统**', status: 'deprecated' } }) }] }
        : { role: 'assistant', content: 'Term fields ready.' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  await page.getByRole('button', { name: 'AI workspace', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace');
  await ai.getByLabel('Task instructions', { exact: true }).fill('Update all term fields');
  await ai.getByRole('button', { name: 'Send message', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByRole('heading', { name: 'English abbreviation', exact: true })).toBeVisible();
  await expect(review.getByText('CL', { exact: true })).toBeVisible();
  await expect(review.locator('ins strong')).toHaveText('控制系统');
  await expect(review.getByRole('button', { name: 'Apply suggestion', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 680 });
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(review.getByRole('button', { name: 'Return to editing', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-native-term-mobile-en.png') });
});

type LiveStreamWindow = Window & { mewikiLiveTest: { opened: boolean; cancelled: boolean; push: (events: unknown[], close?: boolean) => boolean } };
async function controlledLiveStream(page: Page, readBlockId?: string) {
  await page.addInitScript(readBlockId => {
    const originalFetch = window.fetch.bind(window);
    let turn = 0, stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + '\n');
    const done = (message: unknown) => ({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } });
    const harness = { opened: false, cancelled: false, push: (events: unknown[], close = false) => {
      if (!stream) return false;
      for (const event of events) stream.enqueue(encode(event));
      if (close) { stream.close(); stream = null; }
      return true;
    } };
    (window as LiveStreamWindow).mewikiLiveTest = harness;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/mewiki/ai/chat')) return originalFetch(input, init);
      turn++;
      if (turn !== 2) return new Response(encode(done(turn === 1
        ? { role: 'assistant', content: '', toolCalls: [{ id: 'read-live', name: readBlockId ? 'read_block' : 'read_note', arguments: JSON.stringify({ noteId: 'fixture-definition', ...(readBlockId ? { blockId: readBlockId } : {}) }) }] }
        : { role: 'assistant', content: '完成，等待审阅。' })), { headers: { 'Content-Type': 'application/x-ndjson' } });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        stream = controller; harness.opened = true;
        init?.signal?.addEventListener('abort', () => { harness.cancelled = true; stream?.error(new DOMException('cancelled', 'AbortError')); stream = null; }, { once: true });
      }, cancel() { stream = null; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  }, readBlockId);
}

test('flushes streamed chat and the next input before refresh without saving an unfinished note preview', async ({ page }) => {
  await controlledLiveStream(page);
  await setup(page);
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('刷新前保留当前任务');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.opened)).toBe(true);
  await ai.getByLabel('任务要求', { exact: true }).fill('正在编辑的下一条追问');
  const saved = await page.evaluate(async () => {
    (window as LiveStreamWindow).mewikiLiveTest.push([
      { type: 'text', text: '刷新前刚收到的部分答复。' },
      { type: 'tool', update: { key: 'unfinished', name: 'propose_note', arguments: '{"operation":"append","noteId":"fixture-definition","content":"仅供预览的未完成修改' } },
    ]);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return JSON.parse(localStorage.getItem('mewiki:library:default:ai-session:v1')!);
  });
  expect(saved.output).toBe('刷新前刚收到的部分答复。');
  expect(saved.draft).toBe('正在编辑的下一条追问');
  expect(JSON.stringify(saved)).not.toContain('仅供预览的未完成修改');
  expect(saved.proposals).toEqual([]);
  expect(await page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.cancelled)).toBe(false);
  await page.reload();
  await expect(ai).toBeVisible();
  await expect(ai.getByText('刷新前刚收到的部分答复。', { exact: true })).toBeVisible();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('正在编辑的下一条追问');
  await expect(ai.getByText('上次任务已中断，已生成的结果仍可查看。', { exact: true })).toBeVisible();
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
});

test('renders a live draft before completion, pauses following and applies only the completed suggestion', async ({ page }, info) => {
  await controlledLiveStream(page);
  await setup(page);
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('实时改写当前内容');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.opened)).toBe(true);
  const review = page.getByTestId('mewiki-ai-review');
  const first = '## 新标题\n\n**实时** 修改 $x^2$。';
  const more = '\n\n- 第一条\n- 第二条\n\n| 字段 | 结果 |\n| --- | --- |\n| 状态 | 就绪 |';
  const prefix = JSON.stringify({ operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '' }).slice(0, -2) + JSON.stringify(first).slice(1, -1);
  await page.evaluate(argumentsText => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'live', name: 'propose_note', arguments: argumentsText } }]), prefix);
  await expect(review.getByRole('heading', { name: '新标题', exact: true, level: 2 })).toBeVisible();
  await expect(review.locator('.katex')).toBeVisible();
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('**实时**');
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(review).toHaveCount(0);
  const delta = JSON.stringify(more).slice(1, -1);
  await page.evaluate(argumentsText => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'live', name: 'propose_note', arguments: argumentsText } }]), delta);
  await expect(review).toHaveCount(0);
  await expect(page.locator('.research-reading-rail')).toBeVisible();
  await ai.getByRole('button', { name: '跟随 AI 修改', exact: true }).click();
  await expect(review.getByRole('listitem')).toHaveCount(2);
  await expect(review.getByRole('table')).toBeVisible();
  const nextPrompt = ai.getByLabel('任务要求', { exact: true });
  await nextPrompt.fill('下一步检查引用');
  await nextPrompt.focus();
  const argumentsText = prefix + delta + '"}';
  await page.evaluate(args => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'done', result: { message: { role: 'assistant', content: '', toolCalls: [{ id: 'finished-live', name: 'propose_note', arguments: args }] }, usage: { inputTokens: 1, outputTokens: 1 } } }], true), argumentsText);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeEnabled();
  await expect(nextPrompt).toBeFocused();
  await expect(review.getByRole('table')).toBeVisible();
  await review.getByRole('button', { name: '查看源码差异', exact: true }).click();
  await expect(review.locator('ins').filter({ hasText: '**实时**' })).toHaveCount(1);
  await review.getByRole('button', { name: '查看渲染差异', exact: true }).click();
  await expect(review.getByRole('heading', { name: '新标题', exact: true, level: 2 })).toBeVisible();
  await page.screenshot({ path: info.outputPath('ai-live-rendered-desktop.png') });
  await useNarrowReview(page);
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-live-rendered-mobile.png') });
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('**实时**');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('**实时**');
});

test('streams a native change inside its tab and requires approval after completion', async ({ page }, info) => {
  await controlledLiveStream(page, 'nested');
  await setup(page, true, 'zh-CN', tabbedFixture());
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('修改控制闭环通信事件中的段落');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.opened)).toBe(true);
  const args = '{"action":"block-update","noteId":"fixture-definition","blockId":"nested","fields":{"text":"**实时闭环**说明';
  await page.evaluate(argumentsText => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'native-live', name: 'propose_edit', arguments: argumentsText } }]), args);
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.locator('ins strong')).toHaveText('实时闭环');
  await expect(review.getByText('这段继续保留。', { exact: true })).toHaveCount(0);
  await review.getByRole('tab', { name: '保留标签', exact: true }).click();
  await expect(review.getByText('这段继续保留。', { exact: true })).toHaveCount(1);
  await review.getByRole('tab', { name: '通信事件', exact: true }).click();
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('实时闭环');
  await page.screenshot({ path: info.outputPath('ai-native-streaming-tab.png') });
  await page.evaluate(argumentsText => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'done', result: { message: { role: 'assistant', content: '', toolCalls: [{ id: 'native-finished', name: 'propose_edit', arguments: argumentsText }] }, usage: { inputTokens: 1, outputTokens: 1 } } }], true), args + '"}}');
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeEnabled();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('实时闭环');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('实时闭环');
});

test('stops an unfinished live draft from the mobile central toolbar without saving it', async ({ page }) => {
  await controlledLiveStream(page);
  await setup(page);
  await page.setViewportSize({ width: 390, height: 680 });
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('写一段补充');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.opened)).toBe(true);
  await page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'live', name: 'propose_note', arguments: '{"operation":"append","noteId":"fixture-definition","content":"不能保存的半成品' } }]));
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByText('不能保存的半成品', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(ai).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.cancelled)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('不能保存的半成品');
  await expect(ai.getByRole('button', { name: '查看修改', exact: true })).toHaveCount(0);
});

test('pauses on note navigation, resumes following there and clears a failed draft', async ({ page }) => {
  await controlledLiveStream(page);
  await setup(page);
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('补充说明并保持导航');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.opened)).toBe(true);
  const push = (argumentsText: string) => page.evaluate(args => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'tool', update: { key: 'live', name: 'propose_note', arguments: args } }]), argumentsText);
  await push('{"operation":"append","noteId":"fixture-definition","content":"暂态内容');
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByText('暂态内容', { exact: true })).toBeVisible();
  await page.locator('#research-notebook-sidebar').getByText('结果摘要', { exact: true }).click();
  await expect(review).toHaveCount(0);
  await push('继续生成');
  await expect(review).toHaveCount(0);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('结果摘要');
  await ai.getByRole('button', { name: '跟随 AI 修改', exact: true }).click();
  await expect(review.getByText('暂态内容继续生成', { exact: true })).toBeVisible();
  await push('恢复后新增');
  await expect(review.getByText('暂态内容继续生成恢复后新增', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as LiveStreamWindow).mewikiLiveTest.push([{ type: 'error', error: '测试服务中断。' }], true));
  await expect(review).toHaveCount(0);
  await expect(ai.getByRole('alert')).toContainText('测试服务中断');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('暂态内容');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('结果摘要');
});

test('reviews inline edits in the central note before applying and safely undoing', async ({ page }, info) => {
  const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
  note.blocks = [
    { id: 'intro', type: 'paragraph', text: '这里是保留的前文。' },
    { id: 'edit', type: 'paragraph', text: '系统始终稳定。\n已过时的假设。' },
    { id: 'math', type: 'formula', tex: 'E=mc^2' },
    { id: 'tail', type: 'paragraph', text: '这里是保留的后文。' },
  ];
  await setup(page, true, 'zh-CN', { notes: state.notes });
  const ai = await suggestEdits(page, [{ operation: 'replace-text', noteId: note.id, blockId: 'edit', content: '系统局部稳定。\n需要检查初始条件。' }]);
  await ai.getByLabel('任务要求', { exact: true }).fill('下一条草稿');
  await expandAiProposalCards(ai);
  const documentBounds = (await page.locator('.research-reading-rail').boundingBox())!;
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review).toBeVisible();
  await expect(page.locator('.research-reading-rail')).toBeHidden();
  await expect(page.locator('.research-reading-rail [data-reading-pane-id="primary"]')).toHaveCount(1);
  await expect(review.getByText('这里是保留的前文。', { exact: true })).toBeVisible();
  await expect(review.getByText('这里是保留的后文。', { exact: true })).toBeVisible();
  await expect(review.locator('.mewiki-ai-diff-row[data-kind="remove"]').first()).toContainText('系统始终稳定。');
  await expect(review.locator('del.mewiki-ai-inline-change').first()).toHaveText('始终');
  await expect(review.locator('ins.mewiki-ai-inline-change').first()).toHaveText('局部');
  await expect(review.locator('[data-review-block-id="math"] .katex')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('系统局部稳定');
  const center = (await review.boundingBox())!;
  expect(center.x).toBeCloseTo(documentBounds.x, 0);
  expect(center.x + center.width).toBeCloseTo(documentBounds.x + documentBounds.width, 0);
  expect(await ai.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  for (let index = 0; index < 30; index++) await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowLeft');
  const formula = review.locator('[data-review-block-id="math"]');
  const formulaBounds = (await formula.boundingBox())!, copyBounds = (await formula.getByRole('button', { name: '复制公式 LaTeX', exact: true }).boundingBox())!;
  expect(copyBounds.y).toBeGreaterThanOrEqual(formulaBounds.y);
  expect(copyBounds.x + copyBounds.width).toBeLessThanOrEqual(formulaBounds.x + formulaBounds.width);
  await formula.hover();
  await expect(formula.getByRole('button', { name: '复制公式 LaTeX', exact: true })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('ai-review-desktop.png') });
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('下一条草稿');
  await expect(page.locator('.research-reading-rail')).toBeVisible();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('系统局部稳定');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('系统始终稳定');
});

test('previews a nested text deletion with its original context and keeps rich content', async ({ page }) => {
  const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
  note.blocks.push({ id: 'examples', type: 'examples', title: '证明示例', tabs: [
    { id: 'first', title: '其他标签', blocks: [{ id: 'other', type: 'paragraph', text: '另一个标签中的文字' }] },
    { id: 'second', title: '目标标签', blocks: [{ id: 'outdated', type: 'paragraph', text: '需要删除的过时结论。' }, { id: 'formula-kept', type: 'formula', tex: 'x=1' }] },
  ] });
  note.blocks.push({ id: 'plugin-kept', type: 'external', provider: 'unknown', contentType: 'record', schemaVersion: 99, title: '原始插件资料', summary: '保留插件摘要', data: { original: 'unchanged' } });
  await setup(page, true, 'zh-CN', { notes: state.notes });
  const ai = await suggestEdits(page, [{ operation: 'delete-text', noteId: note.id, blockId: 'outdated', content: '' }]);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.locator('del')).toHaveText('需要删除的过时结论。');
  await expect(review.locator('ins')).toHaveCount(0);
  await expect(review.getByRole('tab', { name: '目标标签', exact: true }).last()).toBeVisible();
  await expect(review.locator('[data-review-block-id="formula-kept"] .katex')).toBeVisible();
  await expect(review.getByText('保留插件摘要', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!));
  const savedNote = saved.notes.find((item: { id: string }) => item.id === note.id);
  expect(JSON.stringify(savedNote)).not.toContain('需要删除的过时结论');
  expect(JSON.stringify(savedNote)).toContain('formula-kept');
  expect(savedNote.blocks.at(-1).data).toEqual({ original: 'unchanged' });
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('需要删除的过时结论');
});

test('closes the enlarged diagram with Escape before leaving the AI review', async ({ page }) => {
  const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
  note.blocks.push({ id: 'review-diagram', type: 'diagram', mode: 'mermaid', title: '审阅流程图', code: 'flowchart LR\n A[开始] --> B[完成]', strokes: [] });
  await setup(page, true, 'zh-CN', { notes: state.notes });
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks);
  const ai = await suggestEdits(page, [{ operation: 'append', noteId: note.id, content: '尚待批准的补充。' }]);
  await expandAiProposalCards(ai);
  const reviewTrigger = ai.getByRole('button', { name: '查看修改', exact: true });
  await reviewTrigger.click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review).toBeVisible();
  for (let index = 0; index < 30; index++) await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowLeft');
  const enlarge = review.getByRole('button', { name: '放大流程图', exact: true });
  await enlarge.click();
  const dialog = page.getByRole('dialog', { name: '流程图预览', exact: true });
  await expect(dialog.getByRole('img', { name: '审阅流程图', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(review).toBeVisible();
  await expect(enlarge).toBeFocused();
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks)).toEqual(original);
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(reviewTrigger).toBeFocused();
});

test('places appended text at the real end, navigates proposals and fits the mobile review', async ({ page }, info) => {
  await setup(page);
  const ai = await suggestEdits(page, [
    { operation: 'append', noteId: 'fixture-definition', content: '页尾补充的新条件。' },
    { operation: 'create', title: '新建审阅草稿', content: '新笔记中的文字。' },
  ]);
  await expect(ai.locator('.mewiki-ai-proposals')).toHaveCount(1);
  await expect(ai.locator('.mewiki-ai-proposals')).toContainText('2 项修改');
  await expect(ai.locator('.mewiki-ai-proposal-count')).toHaveAttribute('title', '2 个目标');
  await expect(ai.locator('.mewiki-ai-proposals')).not.toContainText('页尾补充的新条件。');
  await expect(ai.locator('.mewiki-ai-proposals')).not.toContainText('新笔记中的文字。');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.locator('[data-review-block-id]').first()).toContainText('通用内容。');
  await expect(review.locator('[data-review-block-id]').last()).toContainText('页尾补充的新条件。');
  await expect(review.locator('del')).toHaveCount(0);
  await review.getByRole('button', { name: '下一个目标', exact: true }).click();
  await expect(review.getByRole('heading', { name: '新建审阅草稿', exact: true })).toBeVisible();
  await expect(review.locator('.mewiki-ai-review-after ins')).toContainText('新笔记中的文字。');
  await useNarrowReview(page);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeInViewport();
  const box = (await review.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThan(280);
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 44);
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-review-mobile.png') });
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(ai).toBeVisible();
  await expect(review).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('新笔记中的文字');
});

test('disables outdated previews and clears them when the AI session is cleared', async ({ page }) => {
  await setup(page);
  let ai = await suggestEdits(page, [{ operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '不能覆盖手工编辑的旧建议。' }]);
  await page.getByTestId('mewiki-ai-launcher').click();
  await page.getByLabel('笔记标题', { exact: true }).fill('用户刚修改的标题');
  await page.getByLabel('笔记标题', { exact: true }).press('Tab');
  const editedText = page.locator('[data-block-id="fixture-definition:text"] .research-editable-text').first();
  await editedText.click(); await editedText.locator('[contenteditable=true]').fill('用户已手动修改建议涉及的正文。');
  await page.getByLabel('笔记标题', { exact: true }).click();
  ai = await openAi(page);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.getByRole('alert')).toContainText('目标内容已变化');
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await expect(review.getByRole('button', { name: '同意此修改', exact: true })).toBeDisabled();
  await expect(review.getByRole('button', { name: '调整此修改', exact: true })).toBeDisabled();
  await ai.getByRole('button', { name: '清空会话', exact: true }).click();
  await ai.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('用户刚修改的标题');
});

test('dismisses central review on note navigation and on closing the AI panel', async ({ page }) => {
  await setup(page);
  let ai = await suggestEdits(page, [{ operation: 'append', noteId: 'fixture-definition', content: '仍待审阅的建议' }]);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review).toBeVisible();
  await page.locator('#research-notebook-sidebar').getByText('结果摘要', { exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('结果摘要');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(review).toBeVisible();
  await page.getByTestId('mewiki-ai-launcher').click();
  await expect(review).toHaveCount(0);
  ai = await openAi(page);
  await expect(review).toHaveCount(0);
  await expandAiProposalCards(ai);
  await expect(ai.getByRole('button', { name: '查看修改', exact: true })).toBeVisible();
});

test('renders added formulas natively and marks the whole new block', async ({ page }) => {
  await setup(page);
  const ai = await suggestEdits(page, [{ operation: 'append', noteId: 'fixture-definition', content: '新公式：\n\n$$\nx^2+y^2=1\n$$' }]);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review.locator('.mewiki-ai-review-added-block .katex')).toBeVisible();
  await expect(review.locator('ins').filter({ hasText: '新公式：' })).toHaveCount(1);
  await expect(review.locator('del')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('x^2+y^2=1');
});

test('reviews term fields in English and enforces read-only approval', async ({ page }, info) => {
  await setup(page, true, 'en', { terms: [{ id: 'stability', name: '稳定性', englishName: 'Stability', meaning: 'Original definition.', aliases: ['稳定'] }] });
  await page.getByRole('button', { name: 'Switch to read-only mode', exact: true }).click();
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    const message = ++turn === 1 ? { role: 'assistant', content: '', toolCalls: [{ id: 'term-draft', name: 'propose_term', arguments: JSON.stringify({ termId: 'stability', name: '稳定性', englishName: 'Local stability', meaning: 'Revised definition.' }) }] }
      : { role: 'assistant', content: 'Term suggestion ready.' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  await page.getByRole('button', { name: 'AI workspace', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace');
  await ai.getByLabel('Task instructions', { exact: true }).fill('Clarify this term');
  await ai.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(ai.getByText('Term suggestion ready.', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await expect(review).toHaveAccessibleName('AI change preview');
  await expect(review.getByRole('heading', { name: 'English name', exact: true })).toBeVisible();
  await expect(review.locator('.mewiki-ai-review-term-field').last().locator('.mewiki-ai-diff-row[data-kind="remove"]')).toContainText('Original definition.');
  await expect(review.locator('.mewiki-ai-review-term-field').last().locator('.mewiki-ai-diff-row[data-kind="add"]')).toContainText('Revised definition.');
  await expect(review.getByRole('button', { name: 'Apply suggestion', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('ai-review-term-en.png') });
  await review.getByRole('button', { name: 'Return to editing', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to edit mode', exact: true }).click();
  await ai.getByRole('button', { name: 'Review changes', exact: true }).click();
  await review.getByRole('button', { name: 'Apply suggestion', exact: true }).click();
  await expect(review).toHaveCount(0);
  const term = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).terms.find((item: { id: string }) => item.id === 'stability'));
  expect(term).toMatchObject({ name: '稳定性', englishName: 'Local stability', meaning: 'Revised definition.', aliases: ['稳定'] });
});

test('keeps keyboard focus out of the covered workspace and restores its controls', async ({ page }) => {
  await setup(page);
  const ai = await suggestEdits(page, [{ operation: 'append', noteId: 'fixture-definition', content: '键盘审阅内容' }]);
  await expandAiProposalCards(ai);
  const reviewTrigger = ai.getByRole('button', { name: '查看修改', exact: true });
  await reviewTrigger.click();
  const review = page.getByTestId('mewiki-ai-review');
  expect(await page.locator('.research-reading-rail').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await page.setViewportSize({ width: 390, height: 680 });
  expect(await page.locator('.research-sidebar-footer').evaluate(element => (element as HTMLElement).inert)).toBe(false);
  expect(await page.locator('#research-notebook-sidebar').evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await expect(page.locator('.research-notebook-mode-tabs .research-notebook-sidebar-toggle')).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.research-reading-rail, .research-symbol-pane, .research-notebook-editor'))).toBe(false);
  }
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(await page.locator('.research-reading-rail').evaluate(element => (element as HTMLElement).inert)).toBe(false);
  expect(await page.locator('.research-sidebar-footer').evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await expect(ai).toBeVisible();
  await expect(reviewTrigger).toBeFocused();
  await reviewTrigger.press('Enter');
  await expect(review).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
  await expect(reviewTrigger).toBeFocused();
  expect(await page.locator('.research-reading-rail').evaluate(element => (element as HTMLElement).inert)).toBe(false);
  expect(await page.locator('.research-sidebar-footer').evaluate(element => (element as HTMLElement).inert)).toBe(false);
});

test('groups the conversation title and session actions below the composer', async ({ page }, info) => {
  await setup(page);
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '已准备好。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  const ai = await openAi(page);
  const footer = ai.locator('.mewiki-ai-session-bar');
  const title = footer.locator('.mewiki-ai-session-title');
  await expect(title).toHaveText('AI 对话');
  await expect(ai.locator('.mewiki-ai-workspace-topbar')).toHaveCount(0);
  await expect(ai.getByText('Enter 发送，Shift+Enter 换行', { exact: true })).toHaveCount(0);
  const task = '整理当前笔记中的定义及其适用条件，保留原文中的引用和完整公式';
  await ai.getByLabel('任务要求', { exact: true }).fill(task);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已准备好。', { exact: true })).toBeVisible();
  await expect(title).toHaveText(task);
  await expect(title).toHaveAttribute('title', task);
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }]) {
    await page.setViewportSize(viewport);
    const composer = (await ai.locator('.mewiki-ai-composer').boundingBox())!;
    const bar = (await footer.boundingBox())!;
    expect(bar.y).toBeGreaterThanOrEqual(composer.y + composer.height);
    for (const name of ['清空会话', 'AI 服务设置']) await expect(footer.getByRole('button', { name, exact: true })).toBeInViewport();
    await expect(page.getByTestId('mewiki-ai-launcher')).toBeInViewport();
    expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ai-session-footer-${viewport.width}.png`) });
  }
  await footer.getByRole('button', { name: '清空会话', exact: true }).click();
  await expect(ai.getByRole('button', { name: '确认清空', exact: true })).toBeInViewport();
  await ai.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(title).toHaveText('AI 对话');
  await footer.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await expect(page.getByTestId('mewiki-settings-page').getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible();
});

test('aligns the right panel divider with the document toolbar', async ({ page }) => {
  const fixture = createNotebookFixture();
  fixture.notes.find(note => note.id === 'fixture-summary')!.blocks = [{ id: 'summary-reference', type: 'paragraph', text: '[关系定义](#research-note/fixture-definition)' }];
  await setup(page, true, 'zh-CN', { notes: fixture.notes });
  await openAi(page);
  await page.getByRole('button', { name: '展开文章大纲', exact: true }).click();
  const right = page.locator('#research-note-outline');
  const checkAlignment = async () => {
    const toolbar = (await page.locator('.research-notebook-toolbar:visible').first().boundingBox())!;
    const tabs = (await right.locator(':scope > header').boundingBox())!;
    expect(tabs.height).toBe(44);
    expect(Math.abs(tabs.y + tabs.height - toolbar.y - toolbar.height)).toBeLessThan(1);
  };
  await checkAlignment();
  // The floating conversation is independent of the document's right panel.
  await page.getByTestId('mewiki-ai-workspace').getByRole('button', { name: '移动AI 面板', exact: true }).press('ArrowLeft');
  for (const name of ['大纲', '反向链接']) {
    await right.getByRole('tab', { name, exact: true }).click();
    await checkAlignment();
    if (name === '反向链接') {
      const backlink = right.locator('.research-note-backlinks').getByRole('button', { name: /结果摘要/ });
      await expect(backlink).toBeVisible();
      expect(await backlink.evaluate(element => getComputedStyle(element).display)).toBe('flex');
    }
  }
});

test('renders assistant Markdown with contained tables, code and safe links', async ({ page }, info) => {
  await setup(page);
  const reply = [
    '## 审阅结果', '', '**关键定义**与*适用条件*，使用 `state.id`。', '',
    '1. 第一项', '2. 第二项', '', '- 普通条目', '- [x] 已核对', '', '> 原文引用', '',
    '| 条件 | 结论 | 附加说明 |', '| --- | --- | --- |', '| 有界 | 成立 | 这是一个需要在窄面板中完整保留的较长表格单元格 |', '',
    '```ts', `const id = "${'long-value-'.repeat(35)}";`, '```', '',
    '行内公式 $x^2$。', '', '$$', '\\sum_{i=1}^{n} i', '$$', '',
    '[参考页面](https://example.invalid/reference)', '', '[无效链接](javascript:alert(1))', '',
    '<script>window.aiUnsafeHtml = true</script>', '<img src="invalid" onerror="window.aiUnsafeHtml = true">',
  ].join('\n');
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', text: reply }) + '\n' + JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: reply }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('**保留我的原始输入**\n第二行');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  const markdown = ai.locator('.mewiki-ai-message[data-role=assistant] .research-markdown');
  await expect(markdown.getByRole('heading', { name: '审阅结果', exact: true })).toBeVisible();
  await expect(markdown.locator('strong')).toHaveText('关键定义');
  await expect(markdown.locator('em')).toHaveText('适用条件');
  await expect(markdown.locator('ol > li')).toHaveCount(2);
  expect(await markdown.locator('ol').evaluate(element => getComputedStyle(element).listStyleType)).toBe('decimal');
  await expect(markdown.locator('ul > li')).toHaveCount(2);
  await expect(markdown.getByRole('checkbox')).toBeChecked();
  await expect(markdown.locator('blockquote')).toContainText('原文引用');
  await expect(markdown.getByRole('table')).toContainText('有界');
  await expect(markdown.locator('pre code')).toHaveClass(/language-ts/);
  await expect(markdown.getByRole('button', { name: '复制代码', exact: true })).toBeVisible();
  await expect(markdown.locator('.katex')).toHaveCount(2);
  const link = markdown.getByRole('link', { name: '参考页面', exact: true });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(markdown.locator('script, img, a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => 'aiUnsafeHtml' in window)).toBe(false);
  await expect(ai.locator('.mewiki-ai-message[data-role=user]')).toContainText('**保留我的原始输入**\n第二行');
  await expect(ai.locator('.mewiki-ai-message[data-role=user] strong')).toHaveCount(0);
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }]) {
    await page.setViewportSize(viewport);
    expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await ai.getByRole('region', { name: '会话记录', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await markdown.locator('pre').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await markdown.getByRole('heading', { name: '审阅结果', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`ai-markdown-${viewport.width}.png`) });
  }
  await page.getByTestId('mewiki-ai-launcher').click();
  ai = await openAi(page);
  await expect(ai.locator('.mewiki-ai-message[data-role=assistant]').getByRole('heading', { name: '审阅结果', exact: true })).toBeVisible();
});

test('keeps the chat composer at the bottom while history scrolls independently', async ({ page }, info) => {
  await setup(page);
  let calls = 0;
  let releaseReply!: () => void;
  const pendingReply = new Promise<void>(resolve => { releaseReply = resolve; });
  const longReply = Array.from({ length: 32 }, (_, index) => `第 ${index + 1} 条说明：这是用于检查历史滚动的通用测试内容。`).join('\n\n');
  await page.route('**/api/mewiki/ai/chat', async route => {
    calls++;
    if (calls === 2) await pendingReply;
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: calls === 1 ? longReply : '对话中的第二次回复。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  const ai = await openAi(page);
  const prompt = ai.getByLabel('任务要求', { exact: true });
  const checkPosition = async () => {
    const panel = (await ai.boundingBox())!;
    const input = (await prompt.boundingBox())!;
    expect(panel.y + panel.height - input.y - input.height).toBeLessThan(130);
    await expect(prompt).toBeInViewport();
    expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  };
  await checkPosition();
  await prompt.fill('先给出一段较长的说明');
  await prompt.press('Enter');
  const history = ai.getByRole('region', { name: '会话记录', exact: true });
  await expect(history.getByText('第 32 条说明：这是用于检查历史滚动的通用测试内容。', { exact: true })).toBeVisible();
  await expect.poll(() => history.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  const before = (await prompt.boundingBox())!;
  await history.hover();
  await page.mouse.wheel(0, -10000);
  await expect(ai.getByRole('button', { name: '返回最新消息', exact: true })).toBeVisible();
  expect(Math.abs((await prompt.boundingBox())!.y - before.y)).toBeLessThan(1);
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBeLessThan(3);
  await ai.getByRole('button', { name: '返回最新消息', exact: true }).click();
  await expect.poll(() => history.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  await prompt.fill('继续解释');
  await prompt.press('Enter');
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await history.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBeLessThan(3);
  releaseReply();
  await expect(history.getByText('对话中的第二次回复。', { exact: true })).toBeVisible();
  await expect.poll(() => history.evaluate(element => element.scrollTop)).toBeLessThan(3);
  expect(calls).toBe(2);
  await ai.getByRole('button', { name: '返回最新消息', exact: true }).click();
  await page.screenshot({ path: info.outputPath('ai-chat-desktop.png') });
  await page.setViewportSize({ width: 390, height: 620 });
  await checkPosition();
  await ai.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect(ai.getByRole('combobox', { name: 'AI 服务', exact: true })).toBeInViewport();
  await expect(ai.getByLabel('本次模型', { exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-chat-mobile-models.png') });
  await page.keyboard.press('Escape');
  await expect(ai).toBeVisible();
  await expect(ai.getByRole('combobox', { name: 'AI 服务', exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('ai-chat-mobile.png') });
});

test('preserves newlines and IME confirmation and lets the user draft while a reply is pending', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests: unknown[] = [];
  await page.route('**/api/mewiki/ai/chat', async route => {
    requests.push(route.request().postDataJSON());
    await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '输入交互检查完成。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  const ai = await openAi(page);
  const prompt = ai.getByLabel('任务要求', { exact: true });
  await prompt.fill('第一行');
  await prompt.press('Shift+Enter');
  await prompt.pressSequentially('第二行');
  await expect(prompt).toHaveValue('第一行\n第二行');
  await prompt.dispatchEvent('compositionstart');
  await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
  await prompt.dispatchEvent('compositionend');
  await prompt.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 });
  await expect(prompt).toHaveValue('第一行\n第二行');
  expect(requests).toHaveLength(0);
  const sent = page.waitForRequest('**/api/mewiki/ai/chat');
  await prompt.press('Enter');
  await sent;
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await prompt.fill('等待时准备的追问');
  release();
  await expect(ai.getByText('输入交互检查完成。', { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('等待时准备的追问');
  expect(requests).toHaveLength(1);
});

test('floats AI independently and keeps a running task while using the document outline', async ({ page }, info) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '切换标签后任务完成。' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  const ai = await openAi(page);
  await page.getByRole('button', { name: '展开文章大纲', exact: true }).click();
  const right = page.locator('#research-note-outline');
  await expect(right.getByTestId('mewiki-ai-workspace')).toHaveCount(0);
  expect(await ai.evaluate(element => element.tagName)).not.toBe('DIALOG');
  await expect(right.getByRole('tab', { name: '智能助理', exact: true })).toHaveCount(0);
  await page.getByLabel('笔记标题', { exact: true }).fill('AI 旁边仍可编辑正文');
  await ai.getByLabel('任务要求', { exact: true }).fill('在侧栏中执行任务');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowLeft');
  await right.getByRole('tab', { name: '大纲', exact: true }).click();
  await expect(ai).toBeVisible();
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  release();
  await expect(ai.getByText('切换标签后任务完成。', { exact: true })).toBeVisible();
  const panel = await ai.boundingBox();
  expect(panel!.width).toBeLessThan(500);
  await page.screenshot({ path: info.outputPath('ai-independent-panel-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-independent-panel-mobile.png') });
});

for (const view of ['dictionary', 'maps'] as const) test(`opens a floating AI panel from the ${view} view and retains its draft across tabs`, async ({ page }) => {
  await setup(page, true, 'zh-CN', { view, activeSymbolId: 'example-matrix', activeTermId: undefined });
  const ai = await openAi(page);
  const right = page.locator('#research-note-outline');
  await ai.getByLabel('任务要求', { exact: true }).fill('保留侧栏任务草稿');
  if (view === 'dictionary') {
    await page.getByRole('button', { name: '展开反向链接', exact: true }).click();
    // Move the floating panel clear of the right panel's tabs.
    for (let index = 0; index < 10; index++) await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowLeft');
    await right.getByRole('tab', { name: '反向链接', exact: true }).click();
    await expect(ai).toBeVisible();
    await right.getByRole('tab', { name: '变量配方', exact: true }).click();
    await expect(right.getByRole('tab', { name: '变量配方', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(ai).toBeVisible();
    await right.getByRole('tab', { name: '反向链接', exact: true }).click();
  } else {
    await expect(right).toHaveCount(0);
  }
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留侧栏任务草稿');
  await expect(ai).toBeVisible();
});

test('interrupts a running task on explicit floating panel close and restores its record', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '收起后迟到的响应', toolCalls: [{ id: 'late', name: 'propose_note', arguments: '{"operation":"create","title":"不应生成","content":"迟到建议"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }).catch(() => {});
  });
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('收起侧栏时中断');
  const sent = page.waitForRequest('**/api/mewiki/ai/chat');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await sent;
  await page.getByTestId('mewiki-ai-launcher').click();
  await expect(ai).toHaveCount(0);
  release();
  ai = await openAi(page);
  await expect(ai.getByText('上次任务已中断，已生成的结果仍可查看。', { exact: true })).toBeVisible();
  await expect(ai.getByRole('region', { name: '会话记录', exact: true }).getByText('收起侧栏时中断', { exact: true })).toBeVisible();
  await expect(ai.getByText('收起后迟到的响应', { exact: true })).toHaveCount(0);
  await expect(ai.getByRole('button', { name: '应用建议', exact: true })).toHaveCount(0);
});

test('configures a custom provider, verifies capabilities and keeps keys out of browser persistence', async ({ page }) => {
  const { saved } = await setup(page, false);
  await page.goto('/?page=settings&section=ai');
  const settings = page.getByTestId('mewiki-settings-page');
  await expect(settings.getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '添加服务', exact: true }).click();
  await settings.getByLabel('服务名称', { exact: true }).fill('我的自配服务');
  await settings.getByLabel('API 地址', { exact: true }).fill('https://models.example.invalid/v1');
  await settings.getByLabel('API Key', { exact: true }).fill('fake-key-e2e-only');
  await settings.getByLabel('模型名称', { exact: true }).fill('my-agent-model');
  await settings.getByRole('button', { name: '保存服务', exact: true }).click();
  await expect(settings.getByText('AI 服务配置已保存。', { exact: true })).toBeVisible();
  expect(JSON.stringify(saved)).toContain('fake-key-e2e-only');
  await expect(settings.getByLabel('API Key', { exact: true })).toHaveValue('');
  await settings.getByRole('button', { name: '测试服务', exact: true }).click();
  await expect(settings.getByText('模型响应、流式输出和工具调用测试通过。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fake-key-e2e-only');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('reads a scoped note, proposes edits, applies once and safely undoes them', async ({ page }, info) => {
  await setup(page);
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', async route => {
    const input = route.request().postDataJSON(); expect(input.messages[0].content).toContain('工具版本');
    turn++;
    const message = turn === 1 ? { role: 'assistant', content: '先读取原始定义。', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }
      : turn === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: 'draft', name: 'propose_note', arguments: '{"operation":"append","noteId":"fixture-definition","content":"AI 审阅补充：定义的适用条件需要明确。"}' }] }
        : { role: 'assistant', content: '已根据原文准备补充建议。' };
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', text: message.content }) + '\n' + JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 10, outputTokens: 5 } } }) + '\n' });
  });
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('读取当前笔记并补充适用条件');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已根据原文准备补充建议。', { exact: true })).toBeVisible();
  await ai.locator('.mewiki-ai-sources').getByRole('button', { name: '关系定义', exact: true }).click();
  await expect(ai).toBeVisible();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('关系定义');
  await expandAiProposalCards(ai);
  await expect(ai.getByRole('button', { name: '应用建议', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('AI 审阅补充');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '应用建议', exact: true }).click();
  await expandAiProposalCards(ai);
  await expect(ai.getByRole('button', { name: '撤回此修改', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('AI 审阅补充');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).not.toContain('AI 审阅补充');
  await ai.screenshot({ path: info.outputPath('ai-workspace-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await ai.screenshot({ path: info.outputPath('ai-workspace-mobile.png') });
});

test('cancels pending work and restores the library session without accepting late tools', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '迟到结果', toolCalls: [{ id: 'late', name: 'propose_note', arguments: '{"operation":"create","title":"不应出现","content":"迟到建议"}' }] }, usage: { inputTokens: 0, outputTokens: 0 } } }) + '\n' }).catch(() => {});
  });
  const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('等待取消');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await ai.getByRole('button', { name: '停止任务', exact: true }).click();
  release();
  await expect(ai.getByText('任务已停止，已生成的结果仍可查看。', { exact: true })).toBeVisible();
  await expect(ai.getByRole('button', { name: '应用建议', exact: true })).toHaveCount(0);
  await page.getByTestId('mewiki-ai-launcher').click();
  await openAi(page);
  await expect(ai.getByText('任务已停止，已生成的结果仍可查看。', { exact: true })).toBeVisible();
});

test('reuses conversation only for the same service, model and authorized notes', async ({ page }) => {
  await setup(page);
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'provider-1', providers: [
    { id: 'provider-1', name: '测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'test-agent', hasApiKey: true },
    { id: 'provider-2', name: '另一服务', baseUrl: 'http://127.0.0.1:9998/v1', protocol: 'openai-chat', model: 'test-agent', hasApiKey: true },
  ] } }));
  const requests: string[] = [];
  await page.route('**/api/mewiki/ai/chat', async route => {
    requests.push(route.request().postData()!);
    const content = requests.length === 1 ? 'OUT_OF_SCOPE_LIBRARY_HISTORY' : `范围内结果${requests.length}`;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  const ai = await openAi(page);
  const run = async (task: string, expected: string) => {
    await ai.getByLabel('任务要求', { exact: true }).fill(task);
    await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(ai.getByText(expected, { exact: true })).toBeVisible();
  };
  await ai.getByRole('combobox', { name: '资料范围', exact: true }).selectOption('library');
  await run('整库任务', 'OUT_OF_SCOPE_LIBRARY_HISTORY');
  await ai.getByRole('combobox', { name: '资料范围', exact: true }).selectOption('current');
  await run('当前任务', '范围内结果2');
  expect(requests[1]).not.toContain('OUT_OF_SCOPE_LIBRARY_HISTORY');
  await run('当前范围的追问', '范围内结果3');
  expect(requests[2]).toContain('范围内结果2');
  expect(requests[2]).not.toContain('OUT_OF_SCOPE_LIBRARY_HISTORY');
  await ai.getByRole('button', { name: '模型设置', exact: true }).click();
  await ai.getByLabel('本次模型', { exact: true }).fill('another-model');
  await page.keyboard.press('Escape');
  await run('换模型', '范围内结果4');
  expect(requests[3]).not.toContain('范围内结果2');
  await ai.getByRole('button', { name: '模型设置', exact: true }).click();
  await ai.getByRole('combobox', { name: 'AI 服务', exact: true }).selectOption('provider-2');
  await page.keyboard.press('Escape');
  await run('换服务', '范围内结果5');
  expect(requests[4]).not.toContain('范围内结果4');
  await ai.getByRole('button', { name: '清空会话', exact: true }).click();
  await ai.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(ai.getByText('OUT_OF_SCOPE_LIBRARY_HISTORY', { exact: true })).toHaveCount(0);
});

test('rejects a structural append after the user edits the original note content', async ({ page }) => {
  await setup(page);
  let turn = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    turn++;
    const message = turn === 1 ? { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }
      : turn === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: 'draft', name: 'propose_note', arguments: '{"operation":"append","noteId":"fixture-definition","content":"应拒绝的旧建议"}' }] }
        : { role: 'assistant', content: '等待审阅。' };
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('提出建议');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expandAiProposalCards(ai);
  await expect(ai.getByRole('button', { name: '应用建议', exact: true })).toBeEnabled();
  await page.getByTestId('mewiki-ai-launcher').click();
  await page.getByLabel('笔记标题', { exact: true }).fill('用户修改过的新标题');
  await page.getByLabel('笔记标题', { exact: true }).press('Tab');
  const editedText = page.locator('[data-block-id="fixture-definition:text"] .research-editable-text').first();
  await editedText.click(); await editedText.locator('[contenteditable=true]').fill('用户已改变追加内容所依赖的正文。');
  await page.getByLabel('笔记标题', { exact: true }).click();
  ai = await openAi(page);
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(ai.getByText('目标内容已变化，请重新生成建议。', { exact: true })).toBeVisible();
  const data = await page.evaluate(() => localStorage.getItem('mewiki:research-notebook'));
  expect(data).toContain('用户修改过的新标题');
  expect(data).not.toContain('应拒绝的旧建议');
});

test('keeps restored conversations in their own library', async ({ page }) => {
  await setup(page);
  const other = createNotebookFixture(); other.activeNoteId = 'fixture-summary'; other.view = 'notes';
  await page.evaluate(state => { localStorage.setItem('mewiki:library:ai-other:notebook', JSON.stringify(state)); }, other);
  await page.route('**/api/research-library/catalog', route => route.fulfill({ json: {
    libraries: [{ id: 'default', name: '默认资料库', directory: null }, { id: 'ai-other', name: '隔离测试库', directory: null }], contextDefaults: { standalone: 'default' },
  } }));
  await page.route('**/api/research-library?library=ai-other', route => route.fulfill({ json: { directory: null, file: null } }));
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '只属于默认库的对话' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }));
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('记录本库任务');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('只属于默认库的对话', { exact: true })).toBeVisible();
  await ai.getByLabel('任务要求', { exact: true }).fill('默认库的未发送追问');
  await page.getByTestId('mewiki-ai-launcher').click();
  await page.goto('/?library=ai-other');
  ai = await openAi(page);
  await expect(ai.getByText('只属于默认库的对话', { exact: true })).toHaveCount(0);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
  await ai.getByLabel('任务要求', { exact: true }).fill('另一个库的独立草稿');
  await page.getByTestId('mewiki-ai-launcher').click();
  await page.goto('/?library=default');
  ai = await openAi(page);
  await expect(ai.getByText('只属于默认库的对话', { exact: true })).toBeVisible();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('默认库的未发送追问');
  await page.goto('/?library=ai-other');
  ai = await openAi(page);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('另一个库的独立草稿');
});

test('renders AI settings and the workspace in English on a narrow screen', async ({ page }) => {
  await setup(page, true, 'en');
  await page.goto('/?page=settings&section=ai');
  const settings = page.getByTestId('mewiki-settings-page');
  await expect(settings.getByRole('heading', { name: 'AI services', exact: true })).toBeVisible();
  await expect(settings.getByLabel('API URL', { exact: true })).toBeVisible();
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'AI workspace', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace');
  await expect(ai.getByLabel('Task instructions', { exact: true })).toBeVisible();
  await expect(ai.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
  const footer = ai.locator('.mewiki-ai-session-bar');
  await expect(footer.locator('.mewiki-ai-session-title')).toHaveText('AI chat');
  for (const name of ['Clear session', 'AI service settings']) await expect(footer.getByRole('button', { name, exact: true })).toBeInViewport();
  await expect(page.getByTestId('mewiki-ai-launcher')).toBeInViewport();
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
