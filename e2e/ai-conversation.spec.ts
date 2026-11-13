import { expect, test, type Page } from '@playwright/test';
import { createAiSession } from '../src/ai/session.ts';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';

async function setup(page: Page, locale = 'zh-CN') {
  const state = createNotebookFixture();
  state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  await page.addInitScript(({ state, locale }) => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', locale);
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, locale });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'conversation-provider', providers: [
    { id: 'conversation-provider', name: '对话测试服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'conversation-model', hasApiKey: false },
  ] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return state;
}
async function openAi(page: Page, english = false) {
  await page.getByRole('button', { name: english ? 'AI workspace' : 'AI 工作区', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace');
  await expect(ai).toBeVisible();
  return ai;
}
const done = (message: unknown) => JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 10, outputTokens: 2 } } }) + '\n';

test('keeps suggestions with their replies and places tools before branded MeWiki answers after reload', async ({ page }, info) => {
  await setup(page);
  const turns = new Map<string, number>();
  const requests: { messages: Record<string, unknown>[] }[] = [];
  await page.route('**/api/mewiki/ai/chat', route => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const prompt = request.messages.findLast((message: { role: string }) => message.role === 'user').content as string;
    const round = prompt.includes('第一') ? 1 : 2;
    const call = (turns.get(prompt) ?? 0) + 1; turns.set(prompt, call);
    const message = call === 1 ? { role: 'assistant', content: '', toolCalls: [{ id: `read-${round}`, name: 'read_note', arguments: JSON.stringify({ noteId: 'fixture-definition' }) }] }
      : call === 2 ? { role: 'assistant', content: '', toolCalls: [{ id: `propose-${round}`, name: 'propose_note', arguments: JSON.stringify({ operation: 'append', noteId: 'fixture-definition', title: `第 ${round} 轮建议`, content: `第 ${round} 轮补充内容` }) }] }
        : { role: 'assistant', content: `第 ${round} 轮回复正文。` };
    return route.fulfill({ contentType: 'application/x-ndjson', body: done(message) });
  });
  let ai = await openAi(page);
  for (const prompt of ['第一轮修改', '第二轮修改']) {
    await ai.getByLabel('任务要求', { exact: true }).fill(prompt);
    await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toHaveCount(0);
    await expect(ai.locator('.mewiki-ai-proposal')).toHaveCount(turns.size);
  }
  const check = async () => {
    const replies = ai.locator('.mewiki-ai-message[data-role=assistant]');
    await expect(replies).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      const reply = replies.nth(index);
      await expect(reply.getByRole('heading', { name: '修改预览', exact: true })).toBeVisible();
      await expect(reply.locator('.mewiki-ai-proposal')).toHaveCount(1);
      await expect(reply.locator('.mewiki-ai-proposals')).toContainText('1 项修改');
      await expect(reply.locator('.mewiki-ai-proposals')).toContainText('1 个目标');
      await expect(reply.locator('.mewiki-ai-proposals')).not.toContainText(`第 ${index + 1} 轮补充内容`);
      await expect(reply.locator('.mewiki-ai-assistant-name')).toHaveText('MeWiki');
      await expect(reply.locator('.mewiki-ai-avatar svg')).toHaveCount(1);
      await expect(reply.locator(':scope > header')).not.toContainText('AI');
      const tools = reply.locator('.mewiki-ai-tool-progress');
      const text = reply.locator(':scope > .mewiki-ai-text-output');
      expect((await tools.boundingBox())!.y + (await tools.boundingBox())!.height).toBeLessThanOrEqual((await text.boundingBox())!.y);
      expect((await reply.locator('.mewiki-ai-proposals').boundingBox())!.y).toBeGreaterThanOrEqual((await text.boundingBox())!.y + (await text.boundingBox())!.height);
      await tools.locator('summary').click();
      await expect(tools.getByText('阅读原文', { exact: true })).toBeVisible();
      await expect(tools.getByText('准备笔记建议', { exact: true })).toBeVisible();
      await tools.locator('summary').click();
    }
    const badge = replies.first().locator('.mewiki-ai-assistant-name');
    await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(badge).toHaveCSS('border-radius', '4px');
    expect(await badge.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  };
  await check();
  const review = page.getByTestId('mewiki-ai-review');
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  await expect(review.locator('.mewiki-ai-review-blocks ins')).toHaveText(['第 1 轮补充内容', '第 2 轮补充内容']);
  await expect(review.locator('.mewiki-ai-review-position')).toHaveCount(0);
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  expect(requests.at(-1)!.messages.some(message => message.role === 'assistant' && message.content === '第 1 轮回复正文。')).toBe(true);
  expect(requests.every(request => request.messages.every(message => !('activity' in message) && !('providerName' in message)))).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-conversation-desktop.png') });
  await page.reload(); ai = await openAi(page); await check();
  await page.setViewportSize({ width: 390, height: 620 });
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await ai.locator('.mewiki-ai-message[data-role=assistant]').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ai-conversation-mobile.png') });
  const firstProposal = ai.locator('.mewiki-ai-message[data-role=assistant]').first().locator('.mewiki-ai-proposal');
  await firstProposal.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(firstProposal.getByText('已应用', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('第 1 轮补充内容');
  await firstProposal.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect(firstProposal.getByText('已撤回', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '关闭AI 工作区', exact: true }).click();
  await page.evaluate(() => {
    const key = 'mewiki:library:default:ai-session:v1';
    const session = JSON.parse(localStorage.getItem(key)!);
    session.history = session.history.slice(-2);
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload(); ai = await openAi(page);
  await expect(ai.getByRole('region', { name: '历史建议', exact: true }).locator('.mewiki-ai-proposal')).toHaveCount(1);
  await expect(ai.locator('.mewiki-ai-message[data-role=assistant] .mewiki-ai-proposal')).toHaveCount(1);
  await expect(ai).not.toContainText('补充内容');
  await ai.getByRole('button', { name: '关闭AI 工作区', exact: true }).click();
  await page.evaluate(() => {
    const key = 'mewiki:library:default:ai-session:v1';
    const session = JSON.parse(localStorage.getItem(key)!);
    session.history.forEach((message: Record<string, unknown>) => { delete message.activity; });
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload(); ai = await openAi(page);
  await expect(ai.getByRole('region', { name: '历史建议', exact: true }).locator('.mewiki-ai-proposal')).toHaveCount(2);
  await expect(ai.locator('.mewiki-ai-message[data-role=assistant]')).toContainText('第 2 轮回复正文。');
  await expect(ai.locator('.mewiki-ai-message[data-role=assistant] .mewiki-ai-tool-progress')).toHaveCount(1);
});

test('keeps tool-only interrupted suggestions in their original English reply', async ({ page }, info) => {
  await setup(page, 'en');
  let calls = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    calls++;
    if (calls === 1) return route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: '', toolCalls: [{ id: 'tool-only-proposal', name: 'propose_note', arguments: JSON.stringify({ operation: 'create', title: 'Interrupted suggestion', content: 'Unapproved content' }) }] }) });
    await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: 'Late reply' }) }).catch(() => {});
  });
  let ai = await openAi(page, true);
  await ai.getByLabel('Task instructions', { exact: true }).fill('Prepare a note');
  await ai.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  const reply = ai.locator('.mewiki-ai-message[data-role=assistant]');
  await expect(reply.locator('.mewiki-ai-proposal')).toHaveCount(1);
  await expect(reply.locator('.mewiki-ai-proposals')).toContainText('Changes: 1');
  await expect(reply.locator('.mewiki-ai-proposals')).toContainText('Targets: 1');
  await expect(reply.locator('.mewiki-ai-proposals')).not.toContainText('Unapproved content');
  await expect(reply.locator('.mewiki-ai-tool-progress')).toBeVisible();
  await expect(reply.locator('.mewiki-ai-assistant-name')).toHaveText('MeWiki');
  await ai.getByRole('button', { name: 'Stop task', exact: true }).click(); release();
  await ai.getByRole('button', { name: 'Close AI workspace', exact: true }).click();
  ai = await openAi(page, true);
  await expect(ai.locator('.mewiki-ai-message[data-role=assistant] .mewiki-ai-proposal')).toHaveCount(1);
  await expect(ai.getByText('Late reply', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 620 });
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-conversation-english-mobile.png') });
});

test('keeps a single row of sources next to the composer while long conversations scroll', async ({ page }, info) => {
  const state = await setup(page);
  state.notes.forEach((note, index) => { note.title = `参考来源 ${index + 1}：需要截断的很长笔记名称与完整来源信息`; });
  const session = createAiSession('default');
  session.status = 'complete';
  session.sourceIds = state.notes.map(note => note.id);
  session.history = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `第 ${index} 条历史消息。\n`.repeat(20) }));
  await page.evaluate(({ state, session }) => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
  }, { state, session });
  await page.reload();
  const ai = await openAi(page);
  const sources = ai.getByRole('group', { name: '参考来源', exact: true });
  const composer = ai.locator('.mewiki-ai-composer');
  const history = ai.getByRole('region', { name: '会话记录', exact: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 620 }, { width: 1024, height: 420 }]) {
    await page.setViewportSize(viewport);
    await expect(sources).toBeVisible();
    const position = await sources.boundingBox();
    const input = await composer.boundingBox();
    expect(Math.abs(position!.x - input!.x)).toBeLessThanOrEqual(1);
    expect(input!.y - position!.y - position!.height).toBeGreaterThanOrEqual(0);
    expect(input!.y - position!.y - position!.height).toBeLessThanOrEqual(8);
    expect(position!.height).toBeLessThanOrEqual(44);
    expect(input!.y + input!.height).toBeLessThan(viewport.height);
    await history.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(async () => Math.abs((await sources.boundingBox())!.y - position!.y)).toBeLessThanOrEqual(1);
    expect(await history.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const last = sources.getByRole('button').last();
    await last.focus();
    await expect(last).toBeFocused();
    expect((await last.boundingBox())!.x + (await last.boundingBox())!.width).toBeLessThanOrEqual(position!.x + position!.width + 1);
    await page.screenshot({ path: info.outputPath(`ai-sources-${viewport.width}.png`) });
  }
  await sources.getByRole('button').last().click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).activeNoteId)).toBe(state.notes.at(-1)!.id);
});

test('restores chat and an unsent draft across panel tabs, view tabs, closing and page reload', async ({ page }) => {
  await setup(page);
  let requests = 0;
  await page.route('**/api/mewiki/ai/chat', route => {
    requests++;
    return route.fulfill({ contentType: 'application/x-ndjson', body: done({ role: 'assistant', content: '需要保留的聊天答复。' }) });
  });
  let ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('需要保留的提问');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('需要保留的聊天答复。', { exact: true })).toBeVisible();
  const draft = '还没发送的追问\n第二行继续编辑';
  await ai.getByLabel('任务要求', { exact: true }).fill(draft);
  const right = page.locator('#research-note-outline');
  await right.getByRole('tab', { name: '大纲', exact: true }).click();
  await right.getByRole('tab', { name: 'AI', exact: true }).click();
  await page.getByRole('tab', { name: '符号', exact: true }).click();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue(draft);
  await page.getByRole('tab', { name: '研究记录', exact: true }).click();
  await ai.getByRole('button', { name: '关闭AI 工作区', exact: true }).click();
  ai = await openAi(page);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue(draft);
  await page.reload();
  ai = page.getByTestId('mewiki-ai-workspace');
  await expect(ai).toBeVisible();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue(draft);
  await expect(ai.getByRole('region', { name: '会话记录', exact: true }).getByText('需要保留的提问', { exact: true })).toBeVisible();
  await expect(ai.getByText('需要保留的聊天答复。', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await right.getByRole('tab', { name: '大纲', exact: true }).click();
  await page.reload();
  await expect(ai).toHaveCount(0);
  ai = await openAi(page);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue(draft);
  await expect(ai.getByText('需要保留的聊天答复。', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '清空会话', exact: true }).click();
  await ai.getByRole('button', { name: '确认清空', exact: true }).click();
  await page.reload();
  await expect(ai).toBeVisible();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
  await expect(ai).not.toContainText('需要保留的聊天答复。');
  await ai.getByRole('button', { name: '关闭AI 工作区', exact: true }).click();
  await page.reload();
  await expect(ai).toHaveCount(0);
});
