import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createNoteProposal, type AiProposal } from '../src/ai/proposals.ts';
import { createNativeProposal } from '../src/ai/nativeProposals.ts';
import { createAiSession } from '../src/ai/session.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';

const noteId = 'fixture-definition', sessionKey = 'mewiki:library:default:ai-session:v1';
function fixture() {
  const state = createNotebookFixture(); state.activeNoteId = noteId; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === noteId)!.blocks = [{ id: 'text', type: 'paragraph', text: '最初的原文。' }, { id: 'manual', type: 'paragraph', text: '另一段保持不变。' }];
  return state;
}
async function setup(page: Page, proposals: AiProposal[], options: { oldUndone?: boolean; english?: boolean } = {}) {
  const state = fixture(), session = { ...createAiSession('default'), proposals, ...(options.oldUndone ? { appliedIds: proposals.map(item => item.id) } : {}) };
  await page.addInitScript(({ state, session, english }) => {
    if (!sessionStorage.getItem('redo-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
      sessionStorage.setItem('redo-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, session, english: options.english });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  await page.route('**/api/mewiki/ai/chat', () => { throw new Error('Reapplying a suggestion must not request AI.'); });
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); const ai = await openAiWorkspace(page, options.english); await expandAiProposalCards(ai);
  return ai;
}
const savedSession = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionKey);
const savedNote = (page: Page) => page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === id), noteId);

test('reapplies an undone suggestion repeatedly and keeps each new undo available after reload', async ({ page }, info) => {
  const proposal = createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: 'AI 修改后的文字。' });
  const ai = await setup(page, [proposal]);
  for (let cycle = 0; cycle < 3; cycle++) {
    await ai.getByRole('button', { name: cycle ? '再次应用' : '应用建议', exact: true }).click();
    await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('AI 修改后的文字。');
    await page.reload(); await expandAiProposalCards(ai);
    await expect(ai.getByRole('button', { name: '撤回此修改', exact: true })).toBeEnabled();
    expect((await savedSession(page)).changes).toHaveLength(1);
    expect((await savedSession(page)).appliedIds).toEqual([proposal.id]);
    await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
    await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('最初的原文。');
    await page.reload(); await expandAiProposalCards(ai);
    await expect(ai.getByText('已撤回', { exact: true })).toBeVisible();
    await expect(ai.getByRole('button', { name: '再次应用', exact: true })).toBeEnabled();
  }
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  for (let index = 0; index < 30; index++) await move.press('Shift+ArrowLeft');
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'); await expect(review).toContainText('AI 修改后的文字。');
  await page.screenshot({ path: info.outputPath('redo-rendered-preview.png') });
  await review.getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(ai.getByRole('button', { name: '撤回此修改', exact: true })).toBeEnabled();
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('最初的原文。');
});

test('restores the last pre-application baseline for an overlapping grouped edit and can undo the reapplication', async ({ page }) => {
  const proposals = ['第一项修改。', '第二项最终修改。'].map(content => createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content }));
  const ai = await setup(page, proposals);
  await ai.getByRole('button', { name: '查看修改', exact: true }).first().click();
  await page.getByTestId('mewiki-ai-review').getByRole('button', { name: '应用当前页面修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('第二项最终修改。');
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).last().click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('第一项修改。');
  await ai.getByRole('button', { name: '再次应用', exact: true }).click();
  await page.reload(); await expandAiProposalCards(ai);
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('第二项最终修改。');
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).last().click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('第一项修改。');
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('最初的原文。');
});

test('reuses stable native identities across undo and reapplication', async ({ page }) => {
  const proposal = createNativeProposal(fixture(), 'default', { action: 'block-insert', noteId, blockType: 'paragraph', fields: { text: '固定标识的新段落。' } });
  const ai = await setup(page, [proposal]);
  for (let cycle = 0; cycle < 2; cycle++) {
    await ai.getByRole('button', { name: cycle ? '再次应用' : '应用建议', exact: true }).click();
    await expect.poll(async () => (await savedNote(page)).blocks.filter((block: { id: string }) => block.id === proposal.edit.generatedId)).toHaveLength(1);
    await page.reload(); await expandAiProposalCards(ai);
    await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
    await expect.poll(async () => (await savedNote(page)).blocks.map((block: { id: string }) => block.id)).toEqual(['text', 'manual']);
  }
});

test('makes old v1 undone suggestions reviewable and reapplicable in narrow English UI', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const proposal = createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: 'Recovered suggestion.' });
  const ai = await setup(page, [proposal], { oldUndone: true, english: true });
  const redo = ai.getByRole('button', { name: 'Reapply suggestion', exact: true });
  await expect(redo).toBeInViewport(); await page.screenshot({ path: info.outputPath('redo-english-narrow.png') }); await redo.click();
  await expect(ai.getByRole('button', { name: 'Undo this change', exact: true })).toBeEnabled();
  await ai.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('最初的原文。');
});

test('checks conflicts after undo and never overwrites later manual text', async ({ page }) => {
  const proposal = createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: '旧的 AI 建议。' });
  const ai = await setup(page, [proposal]);
  await ai.getByRole('button', { name: '应用建议', exact: true }).click();
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  const text = page.locator('[data-block-id="text"] .research-editable-text').first();
  await text.click(); await text.locator('[contenteditable=true]').fill('用户在撤回后手动改写。'); await ai.getByLabel('任务要求', { exact: true }).click();
  await ai.getByRole('button', { name: '再次应用', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('目标内容已变化');
  expect((await savedNote(page)).blocks[0].text).toBe('用户在撤回后手动改写。');
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(page.getByTestId('mewiki-ai-review').getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
});

test('keeps the undone suggestion and document when saving reapplication fails', async ({ page }) => {
  const proposal = createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: '不能提前写入的建议。' });
  const ai = await setup(page, [proposal]);
  await ai.getByRole('button', { name: '应用建议', exact: true }).click(); await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('test quota', 'QuotaExceededError'); return original.call(this, name, value); };
  }, sessionKey);
  await ai.getByRole('button', { name: '再次应用', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('AI 会话未能保存');
  expect((await savedNote(page)).blocks[0].text).toBe('最初的原文。');
  await expect(ai.getByText('已撤回', { exact: true })).toBeVisible();
});

test('can reject an undone suggestion, restore it after reload and reapply it', async ({ page }) => {
  const proposal = createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: '恢复后重新同意。' });
  const ai = await setup(page, [proposal], { oldUndone: true });
  await ai.getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await page.reload(); await expandAiProposalCards(ai);
  await expect(ai.getByText('已拒绝', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '恢复此建议', exact: true }).click();
  await expect(page.getByTestId('mewiki-ai-review')).toContainText(proposal.content);
  await ai.getByRole('button', { name: '再次应用', exact: true }).click();
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  expect((await savedNote(page)).blocks[0].text).toBe('最初的原文。');
});

test('allows adjusting an undone suggestion before reapplication and undoing the adjusted result', async ({ page }) => {
  const proposal = createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: '原 AI 建议。' });
  const ai = await setup(page, [proposal], { oldUndone: true });
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  for (let index = 0; index < 30; index++) await move.press('Shift+ArrowLeft');
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review');
  await review.getByRole('button', { name: '调整此修改', exact: true }).click();
  await review.locator('[contenteditable="true"]').fill('用户调整后再次应用。');
  await review.getByRole('button', { name: '保留调整', exact: true }).click();
  expect((await savedNote(page)).blocks[0].text).toBe('最初的原文。');
  await page.reload(); await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '再次应用', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('用户调整后再次应用。');
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('最初的原文。');
});

test('reapplication at the forty-suggestion history limit does not consume another slot', async ({ page }) => {
  const proposals = Array.from({ length: 40 }, (_, index) => createNoteProposal(fixture(), 'default', { operation: 'replace-text', noteId, blockId: 'text', content: `历史建议 ${index}。` }));
  const ai = await setup(page, proposals, { oldUndone: true });
  await ai.getByRole('button', { name: '再次应用', exact: true }).first().click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe(proposals[0].content);
  expect((await savedSession(page)).appliedIds).toHaveLength(40);
  expect((await savedSession(page)).changes).toHaveLength(1);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(async () => (await savedNote(page)).blocks[0].text).toBe('最初的原文。');
});
