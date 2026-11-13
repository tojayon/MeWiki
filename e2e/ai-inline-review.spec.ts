import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { normalizeResearchNotebook, type ResearchNotebookState } from '../src/domain/researchNotebook.ts';
import { createNoteProposal, type AiProposal } from '../src/ai/proposals.ts';
import { createNativeProposal } from '../src/ai/nativeProposals.ts';
import { createAiSession } from '../src/ai/session.ts';

const noteId = 'fixture-definition', sessionKey = 'mewiki:library:default:ai-session:v1';
function fixture() {
  const state = createNotebookFixture(); state.activeNoteId = noteId; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === noteId)!.blocks = [
    { id: 'intro', type: 'paragraph', text: '原来的前文。' },
    { id: 'tabs', type: 'examples', title: '场景', tabs: [
      { id: 'one', title: '第一场景', blocks: [{ id: 'one-text', type: 'paragraph', text: '第一场景原文。' }] },
      { id: 'two', title: '第二场景', blocks: [{ id: 'two-text', type: 'paragraph', text: '第二场景原文。' }] },
    ] },
  ];
  return normalizeResearchNotebook(state);
}
async function openAi(page: Page, english = false) {
  await page.getByRole('button', { name: english ? 'AI workspace' : 'AI 工作区', exact: true }).first().click();
  return page.getByTestId('mewiki-ai-workspace');
}
async function setup(page: Page, state: ResearchNotebookState, proposals: AiProposal[], english = false) {
  await page.addInitScript(({ state, session, english, sessionKey }) => {
    if (!sessionStorage.getItem('inline-review-preserve')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem(sessionKey, JSON.stringify(session));
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, session: { ...createAiSession('default'), proposals }, english, sessionKey });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  const ai = await openAi(page, english);
  await ai.getByRole('button', { name: english ? 'Review changes' : '查看修改', exact: true }).first().click();
  return { ai, review: page.getByTestId('mewiki-ai-review') };
}
const item = (page: Page, proposal: AiProposal) => page.getByTestId('mewiki-ai-review').locator(`[data-ai-review-proposal-id="${proposal.id}"]`);
async function savedNote(page: Page) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === id), noteId);
}
async function reload(page: Page, english = false) {
  await page.evaluate(() => sessionStorage.setItem('inline-review-preserve', 'true'));
  await page.reload(); return openAi(page, english);
}

test('accepts and rejects at their original positions while retaining one note and the manually selected tab', async ({ page }, info) => {
  const state = fixture();
  const proposals = [createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'intro', content: '**接受的前文**。' }),
    createNativeProposal(state, 'default', { action: 'block-update', noteId, blockId: 'two-text', fields: { text: '拒绝的第二场景改写。' } }),
    createNativeProposal(state, 'default', { action: 'tab-update', noteId, blockId: 'tabs', tabId: 'one', title: '场景一改名' }),
    createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'one-text', content: '接受的第一场景改写。' })];
  const { ai, review } = await setup(page, state, proposals);
  await review.getByRole('tab', { name: '第二场景', exact: true }).click();
  await expect(item(page, proposals[2])).toHaveCount(0);
  await item(page, proposals[0]).getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(review).toBeVisible();
  await expect(review.getByRole('tab', { name: '第二场景', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, proposals[0])).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await savedNote(page))).toContain('接受的前文');
  expect(JSON.stringify(await savedNote(page))).not.toContain('拒绝的第二场景改写');
  await item(page, proposals[1]).getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review.getByRole('tabpanel')).toContainText('第二场景原文。');
  await expect(review.getByRole('tabpanel')).not.toContainText('拒绝的第二场景改写');
  await expect(review.getByRole('tab', { name: '第二场景', exact: true })).toHaveAttribute('aria-selected', 'true');
  await review.getByRole('tab', { name: '场景一改名', exact: true }).click();
  await item(page, proposals[2]).getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review.getByRole('tab', { name: '第一场景', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, proposals[3])).toBeVisible();
  await expect(review.getByRole('tablist')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('inline-decisions-desktop.png') });
  await item(page, proposals[3]).getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(ai.getByText('已应用', { exact: true })).toHaveCount(2);
  await expect(ai.getByText('已拒绝', { exact: true })).toHaveCount(2);
  const saved = JSON.stringify(await savedNote(page));
  expect(saved).toContain('接受的第一场景改写'); expect(saved).not.toContain('场景一改名'); expect(saved).not.toContain('拒绝的第二场景改写');
  const restored = await reload(page);
  await expect(restored.getByText('已拒绝', { exact: true })).toHaveCount(2);
  await expect(restored.getByRole('button', { name: '撤回此修改', exact: true }).last()).toBeEnabled();
  await restored.getByRole('button', { name: '撤回此修改', exact: true }).last().click();
  await restored.getByRole('button', { name: '撤回此修改', exact: true }).click();
  expect((await savedNote(page)).blocks).toEqual(state.notes.find(note => note.id === noteId)!.blocks);
});

test('keeps a rendered adjustment as a pending suggestion and only saves it after explicit acceptance, including undo after refresh', async ({ page }, info) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'one-text', content: '**AI 建议**与 $x^2$。' });
  const { ai: initialAi, review } = await setup(page, state, [proposal]);
  await item(page, proposal).getByRole('button', { name: '调整此修改', exact: true }).click();
  const adjustment = item(page, proposal).getByRole('region', { name: '调整建议', exact: true });
  await expect(adjustment.locator('strong')).toHaveText('AI 建议');
  await expect(adjustment.locator('.katex')).toBeVisible();
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await expect(initialAi.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await expect(initialAi.getByRole('button', { name: '拒绝此修改', exact: true })).toBeDisabled();
  await adjustment.getByRole('textbox', { name: '建议正文', exact: true }).click();
  await adjustment.locator('[contenteditable="true"]').fill('**用户补充**与 $x^3$。');
  await page.screenshot({ path: info.outputPath('inline-adjustment-editor.png') });
  await adjustment.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(adjustment).toHaveCount(0);
  await expect(review.locator('ins strong')).toHaveText('用户补充');
  await expect(review.locator('ins .katex')).toBeVisible();
  expect(JSON.stringify(await savedNote(page))).not.toContain('用户补充');
  expect(await page.evaluate(key => localStorage.getItem(key), sessionKey)).toContain('用户补充');
  await page.screenshot({ path: info.outputPath('inline-adjusted-rendered.png') });
  let ai = await reload(page);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(review.locator('ins strong')).toHaveText('用户补充');
  await item(page, proposal).getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(JSON.stringify(await savedNote(page))).toContain('**用户补充**与 $x^3$。');
  ai = await reload(page);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  expect((await savedNote(page)).blocks).toEqual(state.notes.find(note => note.id === noteId)!.blocks);
});

test('adjusts a native tab name and inserted content while preserving stable IDs and remaining suggestions', async ({ page }) => {
  const state = fixture();
  const rename = createNativeProposal(state, 'default', { action: 'tab-update', noteId, blockId: 'tabs', tabId: 'one', title: 'AI 标签' });
  const insert = createNativeProposal(state, 'default', { action: 'block-insert', noteId, blockType: 'paragraph', fields: { text: '**AI 新段落**。' }, container: { exampleBlockId: 'tabs', tabId: 'one' } });
  const { review } = await setup(page, state, [rename, insert]);
  await item(page, rename).getByRole('button', { name: '调整此修改', exact: true }).click();
  await item(page, rename).getByRole('textbox', { name: '标题', exact: true }).fill('用户标签');
  await item(page, rename).getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(review.getByRole('tab', { name: '用户标签', exact: true })).toBeVisible();
  await item(page, rename).getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(review.getByRole('tab', { name: '用户标签', exact: true })).toHaveAttribute('aria-selected', 'true');
  await item(page, insert).getByRole('button', { name: '调整此修改', exact: true }).click();
  await item(page, insert).getByRole('textbox', { name: '内容', exact: true }).click();
  await item(page, insert).locator('[contenteditable="true"]').fill('用户调整的新段落。');
  await item(page, insert).getByRole('button', { name: '保留调整', exact: true }).click();
  const pending = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).proposals, sessionKey);
  expect(pending.find((entry: AiProposal) => entry.id === insert.id).edit).toMatchObject({ generatedId: insert.edit.generatedId, generatedAt: insert.edit.generatedAt, block: { id: insert.edit.generatedId, text: '用户调整的新段落。' } });
  expect(JSON.stringify(await savedNote(page))).not.toContain('用户调整的新段落');
  await item(page, insert).getByRole('button', { name: '同意此修改', exact: true }).click();
  const tabs = (await savedNote(page)).blocks[1];
  expect(tabs.tabs[0]).toMatchObject({ id: 'one', title: '用户标签' });
  expect(tabs.tabs[0].blocks[1]).toMatchObject({ id: insert.edit.generatedId, text: '用户调整的新段落。' });
  const ai = await reload(page);
  await expect(ai.getByRole('button', { name: '撤回此修改', exact: true })).toHaveCount(2);
});

test('cancels local adjustments and restores a rejected suggestion without changing the note', async ({ page }) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'intro', content: '原建议。' });
  const { ai, review } = await setup(page, state, [proposal]);
  const original = await page.evaluate(key => localStorage.getItem(key), sessionKey);
  for (const escape of [false, true]) {
    await item(page, proposal).getByRole('button', { name: '调整此修改', exact: true }).click();
    await item(page, proposal).getByRole('textbox', { name: '建议正文', exact: true }).click();
    await item(page, proposal).locator('[contenteditable="true"]').fill('放弃的草稿');
    if (escape) await item(page, proposal).getByRole('button', { name: '取消调整', exact: true }).press('Escape');
    else await item(page, proposal).getByRole('button', { name: '取消调整', exact: true }).click();
    await expect(review).toBeVisible();
    await expect(item(page, proposal).getByRole('button', { name: '保留调整', exact: true })).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), sessionKey)).toBe(original);
  }
  await item(page, proposal).getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review).toHaveCount(0);
  await ai.getByRole('button', { name: '恢复此建议', exact: true }).click();
  await expect(review).toBeVisible();
  await expect(review.locator('ins')).toContainText('原建议。');
  expect((await savedNote(page)).blocks).toEqual(state.notes.find(note => note.id === noteId)!.blocks);
});

test('keeps inline controls accessible on a narrow English page and disables decisions in read-only mode', async ({ page }, info) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'intro', content: '**Revised text**.' });
  const { ai, review } = await setup(page, state, [proposal], true);
  await page.setViewportSize({ width: 390, height: 680 });
  for (const name of ['Accept this change', 'Reject this change', 'Adjust this change']) await expect(item(page, proposal).getByRole('button', { name, exact: true })).toBeInViewport();
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('inline-decisions-english-mobile.png') });
  await review.getByRole('button', { name: 'Return to editing', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await ai.getByRole('button', { name: 'Close AI workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to read-only mode', exact: true }).click();
  const reopened = await openAi(page, true);
  await reopened.getByRole('button', { name: 'Review changes', exact: true }).click();
  for (const name of ['Accept this change', 'Reject this change', 'Adjust this change']) await expect(item(page, proposal).getByRole('button', { name, exact: true })).toBeDisabled();
});

test('retains the suggestion and note if persisting a rejection fails', async ({ page }) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'intro', content: '不能丢失的建议。' });
  const { ai, review } = await setup(page, state, [proposal]);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Storage full', 'QuotaExceededError'); original.call(this, name, value); };
  }, sessionKey);
  await item(page, proposal).getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review).toBeVisible();
  await expect(ai.getByText('已拒绝', { exact: true })).toHaveCount(0);
  await expect(ai.getByRole('alert')).toBeVisible();
  await expect(item(page, proposal).getByRole('button', { name: '同意此修改', exact: true })).toBeDisabled();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionKey);
  expect(stored.rejectedIds ?? []).toEqual([]);
  expect((await savedNote(page)).blocks).toEqual(state.notes.find(note => note.id === noteId)!.blocks);
});

test('retains scroll after a decision and does not leave the current note when rejecting another target', async ({ page }) => {
  const state = fixture(), note = state.notes.find(note => note.id === noteId)!;
  note.blocks.splice(1, 0, ...Array.from({ length: 40 }, (_, index) => ({ id: `context-${index}`, type: 'paragraph' as const, text: `继续保留的上下文 ${index + 1}。` })));
  const proposals = [createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'context-35', content: '靠近末尾的第一处建议。' }),
    createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'context-38', content: '靠近末尾的第二处建议。' }),
    createNoteProposal(state, 'default', { operation: 'append', noteId: 'fixture-summary', content: '另一个目标的建议。' })];
  const { ai, review } = await setup(page, state, proposals);
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  await item(page, proposals[0]).getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(item(page, proposals[1])).toBeVisible();
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
  await ai.locator('.mewiki-ai-proposal').last().getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review.getByRole('heading', { name: '关系定义', exact: true })).toBeAttached();
  await expect(item(page, proposals[1])).toBeVisible();
});

test('blocks overlapping edits while retaining the rendered diff and approval of independent suggestions', async ({ page }) => {
  const state = fixture();
  const first = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'intro', content: '已接受的前文。' });
  const overlap = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'intro', content: '冲突的前文建议。' });
  const independent = createNativeProposal(state, 'default', { action: 'block-update', noteId, blockId: 'two-text', fields: { text: '**独立修改仍可审阅**。' } });
  const { review } = await setup(page, state, [first, overlap, independent]);
  await review.getByRole('tab', { name: '第二场景', exact: true }).click();
  await item(page, first).getByRole('button', { name: '同意此修改', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('目标内容已变化');
  await expect(item(page, overlap).getByRole('button', { name: '同意此修改', exact: true })).toBeDisabled();
  await expect(review.getByRole('tabpanel').locator('ins strong')).toHaveText('独立修改仍可审阅');
  await expect(item(page, independent).getByRole('button', { name: '同意此修改', exact: true })).toBeEnabled();
  await item(page, independent).getByRole('button', { name: '同意此修改', exact: true }).click();
  expect(JSON.stringify(await savedNote(page))).toContain('已接受的前文');
  expect(JSON.stringify(await savedNote(page))).toContain('独立修改仍可审阅');
  await item(page, overlap).getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review).toHaveCount(0);
});
