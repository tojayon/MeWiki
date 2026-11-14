import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';

const sessionKey = 'mewiki:library:default:ai-session:v1';
const provider = { id: 'actions', name: '操作测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'actions-model', hasApiKey: false };
const done = (content: string) => JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content }, usage: { inputTokens: 9, outputTokens: 3 } } }) + '\n';
async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === state.activeNoteId)!.blocks = [
    { id: 'selection-text', type: 'paragraph', text: '这个句子需要稍微润色。其他内容保持原样。' },
    { id: 'other-text', type: 'paragraph', text: '另一段保留的文字。' },
    { id: 'selection-tabs', type: 'examples', tabs: [
      { id: 'select-tab-a', title: '第一页', blocks: [{ id: 'tab-text-a', type: 'paragraph', text: '第一页的原文。' }] },
      { id: 'select-tab-b', title: '第二页', blocks: [{ id: 'tab-text-b', type: 'paragraph', text: '第二页选中的原文。' }] },
    ] },
    { id: 'peer-link', type: 'paragraph', text: '[对照来源](#research-note/fixture-summary)' },
    { id: 'embedded-source', type: 'noteEmbed', sourceNoteId: 'fixture-summary', blockIds: ['fixture-summary:text'] },
  ];
  state.notes.find(note => note.id === 'fixture-summary')!.blocks = [{ id: 'fixture-summary:text', type: 'paragraph', text: '分屏来源的文字。' }];
  await page.addInitScript(({ state, english }) => {
    if (!sessionStorage.getItem('chat-actions-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)); sessionStorage.setItem('chat-actions-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as typeof window & { copied: string }).copied = text; } } });
  }, { state, english });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: english ? 'AI workspace' : 'AI 工作区', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace'); await expect(ai).toBeVisible(); return ai;
}
async function selectText(page: Page, selector = '[data-block-id="selection-text"] .research-read-text p') {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.locator(selector).first().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test('copies individual messages and the full conversation with visible failure feedback', async ({ page }) => {
  const ai = await setup(page);
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: done('**已整理**\n\n保留格式。') }));
  await ai.getByLabel('任务要求', { exact: true }).fill('请整理这篇笔记'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  const response = ai.locator('.mewiki-ai-message[data-role=assistant]');
  await response.getByRole('button', { name: '复制消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { copied: string }).copied)).toBe('**已整理**\n\n保留格式。');
  await expect(response.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '复制对话', exact: true }).click();
  expect(await page.evaluate(() => (window as typeof window & { copied: string }).copied)).toContain('你\n\n请整理这篇笔记');
  expect(await page.evaluate(() => (window as typeof window & { copied: string }).copied)).toContain('觅维\n\n**已整理**');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await ai.locator('.mewiki-ai-message[data-role=user]').getByRole('button', { name: '复制消息', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('复制失败');
});

test('keeps message actions on the chat background and focuses inputs without a thick outline', async ({ page }, info) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: done('已收到') }));
  const composerBorder = await ai.locator('.mewiki-ai-composer').evaluate(element => getComputedStyle(element).border);
  await input.focus(); await expect(input).toBeFocused();
  expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await input.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await ai.locator('.mewiki-ai-composer').evaluate(element => getComputedStyle(element).border)).toBe(composerBorder);
  await input.fill('操作区透明'); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('已收到', { exact: true })).toBeVisible();
  const message = ai.locator('.mewiki-ai-message[data-role=user]');
  for (const area of [message, message.locator('.mewiki-ai-message-actions')]) expect(await area.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await message.getByRole('button', { name: '编辑消息', exact: true }).click(); const edit = ai.getByLabel('编辑消息内容', { exact: true }); await expect(edit).toBeFocused();
  expect(await edit.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none'); expect(await edit.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  await page.screenshot({ path: info.outputPath('ai-transparent-actions-input.png') });
});

test('edits a question during generation, archives the old branch and ignores its late response', async ({ page }, info) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const requests: { messages: { role: string; content: string }[] }[] = [];
  await page.route('**/api/mewiki/ai/chat', async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) { await held; await route.fulfill({ contentType: 'application/x-ndjson', body: done('旧请求迟到回复') }).catch(() => {}); }
    else await route.fulfill({ contentType: 'application/x-ndjson', body: done('新问题的回复') });
  });
  await input.fill('原始问题'); const sent = page.waitForRequest('**/api/mewiki/ai/chat'); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await sent;
  await input.fill('下一条草稿不能丢');
  const user = ai.locator('.mewiki-ai-message[data-role=user]').first();
  await user.getByRole('button', { name: '编辑消息', exact: true }).click();
  await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
  const edit = user.getByLabel('编辑消息内容', { exact: true }); await expect(edit).toHaveValue('原始问题');
  await edit.fill('重新编辑的问题'); await page.reload(); await expect(edit).toHaveValue('重新编辑的问题');
  await expect(input).toHaveValue('下一条草稿不能丢');
  await user.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(ai.getByText('新问题的回复', { exact: true })).toBeVisible(); release();
  await expect(ai.getByText('旧请求迟到回复', { exact: true })).toHaveCount(0);
  await expect(ai.locator('.mewiki-ai-message[data-role=user]')).toHaveCount(1);
  expect(requests[1].messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['重新编辑的问题']);
  await expect(input).toHaveValue('下一条草稿不能丢');
  const bubble = user.locator('.mewiki-ai-user-bubble'), actions = user.locator('.mewiki-ai-message-actions');
  const bubbleBox = (await bubble.boundingBox())!, actionsBox = (await actions.boundingBox())!;
  expect(actionsBox.y).toBeGreaterThanOrEqual(bubbleBox.y + bubbleBox.height); expect(actionsBox.x + actionsBox.width).toBeCloseTo(bubbleBox.x + bubbleBox.width, 0);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click(); await ai.getByRole('button', { name: '原始问题', exact: true }).click();
  await expect(ai.getByText('原始问题', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('ai-edited-message-history.png') });
});

test('keeps the edited message focused after opening, reloading and switching conversations', async ({ page }, info) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await page.route('**/api/mewiki/ai/chat', route => route.fulfill({ contentType: 'application/x-ndjson', body: done('保留的回复\n\n' + '较长的旧回复，用于确认编辑位置不会被自动滚动带走。\n\n'.repeat(18)) }));
  await input.fill('等待修改的问题'); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('保留的回复', { exact: true })).toBeVisible();
  const edit = ai.getByLabel('编辑消息内容', { exact: true });
  const expectEditFocus = async () => {
    await expect(edit).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(edit).toBeFocused();
    await expect(edit).toBeInViewport();
  };
  await ai.getByRole('button', { name: '编辑消息', exact: true }).click(); await expectEditFocus();
  await edit.fill('编辑草稿'); await page.reload(); await expectEditFocus();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click(); await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click(); await ai.getByRole('button', { name: '等待修改的问题', exact: true }).click();
  await expect(edit).toHaveValue('编辑草稿'); await expectEditFocus();
  await page.screenshot({ path: info.outputPath('ai-message-edit-desktop.png') });
  await page.getByTestId('mewiki-ai-launcher').click(); await page.getByTestId('mewiki-ai-launcher').click(); await expectEditFocus();
  await page.setViewportSize({ width: 390, height: 720 }); await expectEditFocus();
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-message-edit-narrow.png') });
});

test('cancels message editing and retains its draft when saving a branch fails', async ({ page }) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  let count = 0;
  await page.route('**/api/mewiki/ai/chat', route => { count++; return route.fulfill({ contentType: 'application/x-ndjson', body: done('原回复') }); });
  await input.fill('已有问题'); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('原回复', { exact: true })).toBeVisible();
  await input.fill('继续追问的草稿'); const user = ai.locator('.mewiki-ai-message[data-role=user]');
  await user.getByRole('button', { name: '编辑消息', exact: true }).click(); await user.getByLabel('编辑消息内容', { exact: true }).fill('尚未提交的改写');
  await user.getByRole('button', { name: '取消编辑', exact: true }).click(); await expect(user).toContainText('已有问题'); await expect(input).toHaveValue('继续追问的草稿');
  await user.getByRole('button', { name: '编辑消息', exact: true }).click(); await user.getByLabel('编辑消息内容', { exact: true }).fill('保存失败仍保留');
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.endsWith(':ai-conversations:v1')) throw new Error('denied'); original.call(this, key, value); }; });
  await user.getByRole('button', { name: '重新发送', exact: true }).click(); await expect(ai.getByRole('alert')).toContainText('保存');
  await expect(user.getByLabel('编辑消息内容', { exact: true })).toHaveValue('保存失败仍保留'); await expect(ai.getByText('原回复', { exact: true })).toBeVisible(); expect(count).toBe(1);
});

test('resends an earlier question without future messages and blocks a stale original selection', async ({ page }) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true }), requests: { messages: { role: string; content: string }[] }[] = [];
  await page.route('**/api/mewiki/ai/chat', route => { requests.push(route.request().postDataJSON()); return route.fulfill({ contentType: 'application/x-ndjson', body: done(`回复${requests.length}`) }); });
  for (const question of ['第一问', '后续不应发送']) { await input.fill(question); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText(`回复${requests.length || 1}`, { exact: true }).last()).toBeVisible(); }
  await ai.locator('.mewiki-ai-message[data-role=user]').first().getByRole('button', { name: '编辑消息', exact: true }).click();
  await ai.getByLabel('编辑消息内容', { exact: true }).fill('第一问的新版本'); await ai.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(ai.getByText('回复3', { exact: true })).toBeVisible();
  expect(requests[2].messages.filter(message => message.role !== 'system').map(message => message.content)).toEqual(['第一问的新版本']);
  await selectText(page); await page.getByRole('button', { name: '用 AI 处理选中文字', exact: true }).click();
  await input.fill('润色所选'); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('回复4', { exact: true })).toBeVisible();
  const lastUser = ai.locator('.mewiki-ai-message[data-role=user]').last(); await lastUser.getByRole('button', { name: '编辑消息', exact: true }).click();
  await lastUser.getByLabel('编辑消息内容', { exact: true }).fill('换种方式润色');
  await page.reload(); await expect(lastUser.getByLabel('编辑消息内容', { exact: true })).toHaveValue('换种方式润色');
  await page.evaluate(() => { const key = 'mewiki:research-notebook', state = JSON.parse(localStorage.getItem(key)!); state.notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks[0].text = '已经改变的原文'; localStorage.setItem(key, JSON.stringify(state)); });
  await page.reload(); await expect(ai.getByRole('button', { name: '重新发送', exact: true })).toBeDisabled(); await expect(lastUser.getByRole('alert')).toContainText('变化'); expect(requests).toHaveLength(4);
});

test('retries a partial network failure after reload without duplicating the question or losing the next draft', async ({ page }) => {
  const ai = await setup(page); const requests: { messages: { role: string; content: string }[] }[] = [];
  await page.route('**/api/mewiki/ai/chat', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/x-ndjson', body: requests.length === 1 ? JSON.stringify({ type: 'text', text: '部分回复仍要保留' }) + '\n' : done('重试成功') });
  });
  const input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('帮我检查措辞'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('中断');
  await input.fill('还没发送的下一条'); await page.reload();
  await expect(input).toHaveValue('还没发送的下一条');
  await ai.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(ai.getByText('重试成功', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('还没发送的下一条');
  await expect(ai.locator('.mewiki-ai-message[data-role=user]')).toHaveCount(1);
  await expect(ai.getByText('部分回复仍要保留', { exact: true })).toBeVisible();
  expect(requests[1].messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['帮我检查措辞']);
  expect(requests[1].messages.some(message => message.content.includes('部分回复仍要保留'))).toBe(false);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionKey);
  expect(stored.usageHistory).toHaveLength(1);
});

test('attaches a note selection, keeps the draft and sends a bounded quick editing request', async ({ page }) => {
  const ai = await setup(page); const input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('保持专业语气');
  await selectText(page);
  await page.getByRole('button', { name: '用 AI 处理选中文字', exact: true }).click();
  const quote = ai.getByRole('group', { name: '选中文字', exact: true });
  await expect(quote).toContainText('这个句子需要稍微润色'); await expect(input).toHaveValue('保持专业语气');
  await ai.getByRole('button', { name: '快捷提问', exact: true }).click();
  await ai.getByRole('button', { name: '润色选中文字', exact: true }).click();
  await expect(input).toHaveValue(/保持专业语气[\s\S]*润色/);
  let request: { messages: { role: string; content: string }[] } | undefined;
  await page.route('**/api/mewiki/ai/chat', route => { request = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/x-ndjson', body: done('选区建议准备中') }); });
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('选区建议准备中', { exact: true })).toBeVisible();
  expect(request!.messages[0].content).toContain('selection-text');
  expect(request!.messages[0].content).toContain('这个句子需要稍微润色');
  await expect(quote).toHaveCount(0);
  await expect(ai.locator('.mewiki-ai-message[data-role=user] blockquote')).toContainText('这个句子需要稍微润色');
  await selectText(page, '.mewiki-ai-message[data-role=assistant] p');
  await expect(page.getByRole('button', { name: '用 AI 处理选中文字', exact: true })).toHaveCount(0);
});

test('supports keyboard selection, removable context and quick prompts on a narrow English screen', async ({ page }, info) => {
  const ai = await setup(page, true); await page.setViewportSize({ width: 390, height: 720 });
  await selectText(page); await page.keyboard.press('Alt+Enter');
  const quote = ai.getByRole('group', { name: 'Selected text', exact: true });
  await expect(quote).toBeVisible(); await expect(ai.locator('#mewiki-ai-task-prompt')).toBeFocused();
  await page.getByTestId('mewiki-ai-launcher').press('ArrowLeft');
  await expect(ai.getByLabel('Source scope', { exact: true }).locator('option:checked')).toHaveText('Current selection');
  await ai.getByRole('button', { name: 'Quick prompts', exact: true }).click();
  await expect(ai.getByRole('button', { name: 'Polish selected text', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-selection-narrow-en.png') });
  await ai.getByRole('button', { name: 'Polish selected text', exact: true }).press('Escape');
  await ai.getByRole('button', { name: 'Remove selected text', exact: true }).click(); await expect(quote).toHaveCount(0);
  const trigger = ai.getByRole('button', { name: 'Quick prompts', exact: true }); await trigger.click();
  await expect(ai.getByRole('button', { name: 'Summarize note', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: 'Summarize note', exact: true }).press('Escape'); await expect(trigger).toBeFocused();
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-actions-narrow-en.png') });
});

test('dismisses the floating selection action with Escape until the selection changes', async ({ page }) => {
  await setup(page); await selectText(page);
  const trigger = page.getByRole('button', { name: '用 AI 处理选中文字', exact: true });
  await expect(trigger).toBeVisible(); await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(trigger).toHaveCount(0);
});

test('does not resurrect a consumed selection after removing it and reopening the panel', async ({ page }) => {
  const ai = await setup(page);
  await selectText(page); await page.keyboard.press('Alt+Enter');
  await ai.getByRole('button', { name: '移除选中文字', exact: true }).click();
  await page.getByTestId('mewiki-ai-launcher').click();
  await page.getByRole('button', { name: 'AI 工作区', exact: true }).first().click();
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toHaveCount(0);
});

test('offers the selection action again after attaching, dismissing and a cancelled pointer gesture', async ({ page }) => {
  const ai = await setup(page), trigger = page.getByRole('button', { name: '用 AI 处理选中文字', exact: true });
  const source = page.locator('[data-block-id="selection-text"] .research-read-text p');
  for (let index = 0; index < 2; index++) {
    await source.dblclick({ position: { x: 24, y: 10 } });
    await expect(trigger).toBeVisible(); await trigger.click();
    await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toBeVisible();
  }
  await selectText(page); await expect(trigger).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toHaveCount(0);
  await page.evaluate(() => { document.getSelection()?.removeAllRanges(); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await selectText(page); await expect(trigger).toBeVisible();
  await trigger.click();
  // A touch selection can be cancelled by the browser without a matching pointerup.
  await source.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 });
  await source.dispatchEvent('pointercancel', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  await selectText(page, '[data-block-id="other-text"] .research-read-text p');
  await expect(trigger).toBeVisible(); await trigger.click();
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('另一段保留的文字。');
});

test('keeps selected context to two compact gray lines and gives every scope the same native style', async ({ page }, info) => {
  const ai = await setup(page);
  const title = '一份需要在狭窄面板中省略显示但仍能打开来源的很长笔记名称'.repeat(3);
  const text = '第一行是选中的原文。\n第二行继续保留。\n这段选区只做摘要显示，实际发送保留完整文字。'.repeat(8);
  await page.evaluate(({ title, text }) => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    const note = state.notes.find((note: { id: string }) => note.id === 'fixture-definition');
    note.title = title; note.blocks[0].text = text;
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  }, { title, text });
  await page.reload();
  const scope = ai.getByLabel('资料范围', { exact: true });
  const style = () => scope.evaluate(element => { const css = getComputedStyle(element); return { background: css.backgroundColor, color: css.color, border: css.border, radius: css.borderRadius, padding: css.padding, height: css.height }; });
  const normalStyle = await style();
  await scope.selectOption('library'); expect(await style()).toEqual(normalStyle);
  await selectText(page); await page.keyboard.press('Alt+Enter');
  const quote = ai.getByRole('group', { name: '选中文字', exact: true });
  await expect(quote).toBeVisible(); await expect(scope).toHaveValue('selection');
  await expect(scope.locator('option:checked')).toHaveText('当前选区'); expect(await style()).toEqual(normalStyle);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 720 });
    const name = quote.locator('.mewiki-ai-selection-source > span'), excerpt = quote.locator('blockquote');
    await expect(name).toHaveText(title); await expect(excerpt).toHaveText(text);
    await expect(name).toHaveAttribute('title', title); await expect(excerpt).toHaveAttribute('title', text);
    for (const line of [name, excerpt]) { await expect(line).toHaveCSS('white-space', 'nowrap'); await expect(line).toHaveCSS('text-overflow', 'ellipsis'); }
    const box = (await quote.boundingBox())!; expect(box.height).toBeLessThanOrEqual(46);
    expect(await quote.evaluate(element => getComputedStyle(element).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/);
    expect(await excerpt.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ai-context-lines-${width}.png`) });
  }
  let request: { messages: { role: string; content: string }[] } | undefined;
  await page.route('**/api/mewiki/ai/chat', route => { request = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/x-ndjson', body: done('收到完整选区') }); });
  await ai.getByLabel('任务要求', { exact: true }).fill('保留换行润色');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('收到完整选区', { exact: true })).toBeVisible();
  expect(request!.messages[0].content).toContain(JSON.stringify(text).slice(1, -1));
});

test('saves the active text editor before attaching a selection and rejects a later stale quote', async ({ page }) => {
  const ai = await setup(page);
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  const block = page.locator('[data-block-id="selection-text"]').first();
  await block.locator('.research-editable-text').click();
  const editor = block.locator('[contenteditable=true]');
  await editor.fill('刚刚编辑但尚未失焦的原文。');
  await editor.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Alt+Enter');
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('刚刚编辑但尚未失焦的原文。');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks[0].text)).toBe('刚刚编辑但尚未失焦的原文。');
  await ai.getByLabel('任务要求', { exact: true }).fill('润色这句话');
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await page.getByTestId('mewiki-ai-launcher').click();
  await block.locator('.research-editable-text').click({ position: { x: 10, y: 10 } }); await block.locator('[contenteditable=true]').fill('再次改过的原文。');
  await page.getByTestId('mewiki-ai-launcher').click();
  await ai.getByLabel('任务要求', { exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('选区原文已变化');
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await ai.getByRole('button', { name: '移除选中文字', exact: true }).click();
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
});

test('retries settings loading without discarding the question', async ({ page }) => {
  const ai = await setup(page); await ai.getByLabel('任务要求', { exact: true }).fill('保留服务加载失败时的草稿');
  await page.getByTestId('mewiki-ai-launcher').click();
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ status: 503, json: { error: '模拟暂时无法加载服务' } }));
  await page.getByRole('button', { name: 'AI 工作区', exact: true }).first().click();
  await expect(ai.getByRole('alert')).toContainText('暂时无法加载服务');
  await page.unroute('**/api/mewiki/ai/settings');
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
  await ai.getByRole('button', { name: '重新加载服务', exact: true }).click();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留服务加载失败时的草稿');
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
});

test('refreshes the original provider before retry and blocks a changed destination', async ({ page }) => {
  const ai = await setup(page); let chats = 0;
  await page.route('**/api/mewiki/ai/chat', route => { chats++; return route.fulfill({ status: 503, json: { error: '模拟网络失败' } }); });
  await ai.getByLabel('任务要求', { exact: true }).fill('不得转发到新地址'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('模拟网络失败');
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '1', defaultProviderId: provider.id, providers: [{ ...provider, baseUrl: 'http://127.0.0.1:8888/v1' }] } }));
  await ai.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(ai.getByRole('alert').filter({ hasText: '原任务的 AI 服务配置已变化' })).toBeVisible();
  expect(chats).toBe(1);
});

test('retains complete suggestions and reuses them when retrying a partially failed run', async ({ page }) => {
  const ai = await setup(page); let turn = 0; let reused: { reused?: boolean; proposalId?: string } | undefined;
  await page.route('**/api/mewiki/ai/chat', route => {
    const index = turn++;
    if (index === 2) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', text: '建议已准备但连接中断' }) + '\n' });
    if (index === 5) {
      const request = route.request().postDataJSON(); reused = JSON.parse(request.messages.at(-1).content);
      return route.fulfill({ contentType: 'application/x-ndjson', body: done('建议保留一份，请审阅') });
    }
    const name = index % 3 === 0 ? 'read_note' : 'propose_note';
    const args = name === 'read_note' ? { noteId: 'fixture-definition' } : { operation: 'create', title: '只保留一份的新笔记', content: '完整的建议内容' };
    const body = JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '', toolCalls: [{ id: `turn-${index}`, name, arguments: JSON.stringify(args) }] }, usage: { inputTokens: 5, outputTokens: 1 } } }) + '\n';
    return route.fulfill({ contentType: 'application/x-ndjson', body });
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('生成一篇新笔记'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('中断'); await expect(ai.locator('.mewiki-ai-proposal')).toHaveCount(1);
  const firstId = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).proposals[0].id, sessionKey);
  await ai.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(ai.getByText('建议保留一份，请审阅', { exact: true })).toBeVisible();
  await expect(ai.locator('.mewiki-ai-proposal')).toHaveCount(1); expect(reused).toMatchObject({ proposalId: firstId, reused: true });
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionKey);
  expect(stored.usageHistory).toHaveLength(2); expect(stored.history.filter((message: { role: string }) => message.role === 'user')).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.some((note: { title: string }) => note.title === '只保留一份的新笔记'))).toBe(false);
});

test('selects a nested tab and a split note by their real stable sources while excluding embeds', async ({ page }, info) => {
  const ai = await setup(page);
  await page.getByRole('tab', { name: '第二页', exact: true }).click();
  await selectText(page, '[data-block-id="tab-text-b"] .research-read-text p'); await page.keyboard.press('Alt+Enter');
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('第二页选中的原文。');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.selection?.blocks[0].id, sessionKey)).toBe('tab-text-b');
  await page.screenshot({ path: info.outputPath('ai-selection-tab-desktop.png') });
  await ai.getByRole('button', { name: '移除选中文字', exact: true }).click();
  await selectText(page, '[data-note-embed="embedded-source"] .research-read-text p');
  await expect(page.getByRole('button', { name: '用 AI 处理选中文字', exact: true })).toHaveCount(0);
  await page.locator('[data-block-id="peer-link"]').getByRole('link', { name: '结果摘要', exact: true }).click();
  const peer = page.locator('[data-reading-note-id="fixture-summary"]'); await expect(peer).toBeVisible();
  await selectText(page, '[data-reading-note-id="fixture-summary"] [data-block-id="fixture-summary:text"] .research-read-text p'); await page.keyboard.press('Alt+Enter');
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('结果摘要');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.selection?.noteId, sessionKey)).toBe('fixture-summary');
  await expect(page.locator('[data-reading-note-id="fixture-definition"]')).toBeVisible();
});

test('limits a note quick prompt to the current note even after a library-wide selection', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByLabel('资料范围', { exact: true }).selectOption('library');
  await ai.getByRole('button', { name: '快捷提问', exact: true }).click();
  await ai.getByRole('button', { name: '总结当前笔记', exact: true }).click();
  await expect(ai.getByLabel('资料范围', { exact: true })).toHaveValue('current');
  let request: { messages: { role: string; content: string }[] } | undefined;
  await page.route('**/api/mewiki/ai/chat', route => { request = route.request().postDataJSON(); return route.fulfill({ contentType: 'application/x-ndjson', body: done('总结完成') }); });
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('总结完成', { exact: true })).toBeVisible();
  expect(request!.messages[0].content).toContain('1 篇笔记');
});

test('ignores a late service refresh after switching away from a retried conversation', async ({ page }) => {
  const ai = await setup(page); let chats = 0;
  await page.route('**/api/mewiki/ai/chat', route => { chats++; return route.fulfill({ status: 503, json: { error: '模拟网络失败' } }); });
  await ai.getByLabel('任务要求', { exact: true }).fill('等待重试的旧对话'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('模拟网络失败');
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); let loading = false;
  await page.route('**/api/mewiki/ai/settings', async route => { loading = true; await pending; await route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }).catch(() => {}); });
  await ai.getByRole('button', { name: '重试任务', exact: true }).click(); await expect.poll(() => loading).toBe(true);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click(); await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  release(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(ai.locator('.mewiki-ai-message')).toHaveCount(0); expect(chats).toBe(1);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
});
