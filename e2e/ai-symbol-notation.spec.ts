import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';
import type { AiMessage } from '../src/ai/types.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';

const noteId = 'fixture-definition', blockId = `${noteId}:text`;
const original = '受控目标节点的说明待完善。', revised = '受控目标节点为 $v_{\\mathrm T}$，用于虚构示例。';
const provider = { id: 'notation-fixture', name: '虚构符号服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'fixture-model', hasApiKey: false };
const tool = (name: string, args: object) => ({ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) });
const savedNote = (page: Page) => page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === id), noteId);
const savedSession = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:library:default:ai-session:v1')!));

for (const native of [false, true]) {
  test(`repairs dictionary typography before ${native ? 'native' : 'legacy'} review, approval and undo`, async ({ page }, info) => {
    const state = createNotebookFixture(); state.activeNoteId = noteId; state.view = 'notes'; state.open = true;
    state.symbols = [createSymbolEntry({ name: '受控目标节点', notation: 'v_{\\mathrm T}', meaning: '虚构定义', category: 'custom', slots: [] }, 'fixture-target')];
    state.notes.find(note => note.id === noteId)!.blocks = [{ id: blockId, type: 'paragraph', text: original }];
    await page.addInitScript(state => {
      if (!sessionStorage.getItem('notation-seeded')) {
        localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)); sessionStorage.setItem('notation-seeded', 'yes');
      }
      localStorage.setItem('mewiki:locale', 'zh-CN');
      localStorage.setItem('mewiki:research-notebook-mode', 'edit');
      localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
    }, state);
    await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
    const requests: { messages: AiMessage[] }[] = [];
    let unapprovedCount = -1;
    const proposal = (text: string) => native
      ? tool('propose_edit', { action: 'block-update', noteId, blockId, fields: { text } })
      : tool('propose_note', { operation: 'replace-text', noteId, blockId, content: text });
    await page.route('**/api/mewiki/ai/chat', async route => {
      requests.push(route.request().postDataJSON());
      const turn = requests.length;
      if (turn === 3) unapprovedCount = (await savedSession(page)).proposals.length;
      const calls = turn === 1 ? [tool('read_note', { noteId }), ...(native ? [tool('read_block', { noteId, blockId })] : []), tool('search_dictionary', { query: '受控目标节点' })]
        : turn === 2 ? [proposal('受控目标节点为 $v_T$，用于虚构示例。')]
          : turn === 3 ? [proposal(revised)] : undefined;
      const message: AiMessage = { role: 'assistant', content: calls ? '' : '符号已按词典核对，建议等待审阅。', ...(calls ? { toolCalls: calls } : {}) };
      await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 5, outputTokens: 2 } } }) + '\n' });
    });
    page.on('pageerror', error => { throw error; });
    await page.goto('/'); const ai = await openAiWorkspace(page);
    await ai.getByLabel('任务要求', { exact: true }).fill('依据符号词典完善当前笔记中受控目标节点的说明，先提出建议。');
    await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(ai.getByText('符号已按词典核对，建议等待审阅。', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(4); expect(unapprovedCount).toBe(0);
    expect(requests[0].messages[0].content).toContain('正体、斜体、粗体、大小写、上下标');
    const dictionary = requests[1].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).find(result => result.symbols);
    expect(dictionary.symbols[0].resolved.tex).toBe('v_{\\mathrm T}');
    expect(dictionary.symbols[0].resolved.markdown).toContain('mewiki-symbol:fixture-target');
    const errors = requests[2].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).filter(result => result.error);
    expect(errors).toHaveLength(1); expect(errors[0].error).toContain('v_{\\mathrm T}');
    expect((await savedSession(page)).proposals).toHaveLength(1);
    expect((await savedNote(page)).blocks[0].text).toBe(original);
    await expandAiProposalCards(ai);
    const review = page.getByTestId('mewiki-ai-review');
    if (!await review.isVisible()) await ai.getByRole('button', { name: '查看修改', exact: true }).click();
    const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
    for (let index = 0; index < 25; index++) await move.press('Shift+ArrowLeft');
    await expect(review.locator('.mewiki-ai-review-after .katex').first()).toBeVisible();
    await expect(review.locator('.mewiki-ai-review-after .katex-mathml mi[mathvariant="normal"]').filter({ hasText: 'T' })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('dictionary-notation-rendered-review.png') });
    await review.getByRole('button', { name: '同意此修改', exact: true }).click();
    await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(revised);
    await page.reload(); await openAiWorkspace(page); await expandAiProposalCards(ai);
    await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
    await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(original);
    expect(requests).toHaveLength(4);
  });
}
