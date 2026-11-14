import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { normalizeResearchNotebook, type ResearchNotebookState } from '../src/domain/researchNotebook.ts';
import { createNoteProposal, createTermProposal, type AiProposal } from '../src/ai/proposals.ts';
import { createNativeProposal } from '../src/ai/nativeProposals.ts';
import { createAiSession } from '../src/ai/session.ts';
import { expandAiProposalCards, openAiWorkspace, replaceRenderedAiReviewText } from './helpers/ai.ts';

const noteId = 'fixture-definition', sessionKey = 'mewiki:library:default:ai-session:v1';
function fixture() {
  const state = createNotebookFixture(); state.activeNoteId = noteId; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === noteId)!.blocks = [
    { id: 'direct-text', type: 'paragraph', text: '**原始表述**和 $x^2$。' },
    { id: 'direct-formula', type: 'formula', tex: 'x = 1', caption: '初始条件' },
    { id: 'direct-tabs', type: 'examples', title: '示例', tabs: [
      { id: 'direct-one', title: '第一页', blocks: [{ id: 'direct-child', type: 'paragraph', text: '页签中的原文。' }] },
      { id: 'direct-two', title: '第二页', blocks: [{ id: 'direct-other', type: 'paragraph', text: '第二页保持原样。' }] },
    ] },
  ];
  return normalizeResearchNotebook(state);
}
async function setup(page: Page, state: ResearchNotebookState, proposals: AiProposal[], english = false) {
  await page.addInitScript(({ state, session, english, sessionKey }) => {
    if (!sessionStorage.getItem('direct-review-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)); localStorage.setItem(sessionKey, JSON.stringify(session));
      sessionStorage.setItem('direct-review-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN'); localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, session: { ...createAiSession('default'), proposals }, english, sessionKey });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); const ai = await openAiWorkspace(page, english); await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: english ? 'Review changes' : '查看修改', exact: true }).first().click();
  const move = ai.getByRole('button', { name: english ? 'Move AI panel' : '移动AI 面板', exact: true });
  for (let i = 0; i < 30; i++) await move.press('Shift+ArrowLeft');
  return { ai, review: page.getByTestId('mewiki-ai-review') };
}
const savedNote = (page: Page) => page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === id), noteId);

test('keeps decisions between the red and green surfaces and only splits those surfaces into columns', async ({ page }, info) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'direct-text', content: '**AI 表述**和 $x^3$。' });
  const { review, ai } = await setup(page, state, [proposal]);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  const block = review.locator('[data-review-block-id="direct-text"]');
  const red = block.locator('.mewiki-ai-review-before'), green = block.locator('.mewiki-ai-review-after'), actions = block.getByRole('group', { name: '此处修改操作', exact: true });
  const a = (await red.locator('.mewiki-ai-diff-row').first().boundingBox())!, b = (await green.locator('.mewiki-ai-diff-row').first().boundingBox())!, c = (await actions.boundingBox())!;
  expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 1); expect(c.y + c.height).toBeLessThanOrEqual(b.y + 1);
  await page.screenshot({ path: info.outputPath('direct-review-stacked.png') });
  await review.getByRole('button', { name: '左右对比', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-layout', 'split');
  const left = (await red.boundingBox())!, right = (await green.boundingBox())!, middle = (await actions.boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(middle.x + 1); expect(middle.x + middle.width).toBeLessThanOrEqual(right.x + 1);
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  await expect(review.locator('[data-review-block-id="direct-formula"]')).toHaveCount(1);
  await expect(review.getByRole('tablist')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('direct-review-split.png') });
});

test('edits the green suggestion in place, retains only the pending proposal, then approves and undoes after reload', async ({ page }, info) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'direct-text', content: '**AI 表述**和 $x^3$。' });
  const { review, ai } = await setup(page, state, [proposal]);
  const block = review.locator('[data-review-block-id="direct-text"]'), green = block.locator('.mewiki-ai-review-after');
  await green.getByRole('textbox', { name: '编辑建议内容', exact: true }).click();
  const editor = green.getByRole('region', { name: '调整建议', exact: true });
  await expect(editor).toBeVisible(); await expect(block.locator('.mewiki-ai-adjustment')).toHaveCount(1);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await expect(ai.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await replaceRenderedAiReviewText(editor.locator('[contenteditable="true"]'), '**用户确认的表述**和 $x^4$。');
  await review.getByRole('button', { name: '左右对比', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator('strong')).toHaveText('用户确认的表述');
  await editor.getByRole('textbox', { name: '建议正文', exact: true }).click();
  await expect(editor.locator('[contenteditable="true"] strong')).toHaveText('用户确认的表述');
  await expect(editor.locator('[contenteditable="true"] .katex')).toBeVisible();
  await expect(editor.locator('[contenteditable="true"]')).not.toContainText('**');
  await green.screenshot({ path: info.outputPath('direct-review-green-editor.png') });
  await block.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(editor).toHaveCount(0); await expect(green.locator('strong')).toHaveText('用户确认的表述');
  await expect(green.locator('.katex')).toBeVisible();
  expect(JSON.stringify(await savedNote(page))).not.toContain('用户确认的表述');
  await page.screenshot({ path: info.outputPath('direct-review-adjusted.png') });
  await page.reload(); const reopened = await openAiWorkspace(page); await expandAiProposalCards(reopened);
  await reopened.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-layout', 'split');
  await block.getByRole('button', { name: '同意此修改', exact: true }).click();
  expect(JSON.stringify(await savedNote(page))).toContain('**用户确认的表述**和 $x^4$。');
  await reopened.getByRole('button', { name: '撤回此修改', exact: true }).click();
  expect((await savedNote(page)).blocks).toEqual(state.notes.find(note => note.id === noteId)!.blocks);
});

test('edits formula fields in the green region and cancels with Escape without changing the proposal', async ({ page }) => {
  const state = fixture(), proposal = createNativeProposal(state, 'default', { action: 'block-update', noteId, blockId: 'direct-formula', fields: { tex: 'x = 2', caption: 'AI 条件' } });
  const { review } = await setup(page, state, [proposal]);
  const block = review.locator('[data-review-block-id="direct-formula"]'), green = block.locator('.mewiki-ai-review-after');
  await block.getByRole('button', { name: '调整此修改', exact: true }).click();
  await green.getByRole('textbox', { name: 'LaTeX', exact: true }).fill('x = 5');
  await green.getByRole('textbox', { name: 'LaTeX', exact: true }).press('Escape');
  await expect(block.getByRole('button', { name: '保留调整', exact: true })).toHaveCount(0);
  expect((await savedNote(page)).blocks.find((item: { id: string }) => item.id === 'direct-formula').tex).toBe('x = 1');
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).proposals[0], sessionKey);
  expect(stored.edit.fields.tex).toBe('x = 2');
  await block.getByRole('button', { name: '调整此修改', exact: true }).click();
  await green.getByRole('textbox', { name: 'LaTeX', exact: true }).fill('x = 6');
  await block.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(green.locator('.katex')).toContainText('x=6');
});

test('keeps a single tab container and a usable split comparison on a narrow English page', async ({ page }, info) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'direct-child', content: 'A revised example.' });
  const { review, ai } = await setup(page, state, [proposal], true);
  await review.getByRole('button', { name: 'Side-by-side comparison', exact: true }).click();
  await ai.getByRole('button', { name: 'Dock to right sidebar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 740 });
  await page.getByRole('button', { name: 'Collapse note left panel', exact: true }).click();
  await ai.getByRole('button', { name: 'Collapse AI workspace', exact: true }).click();
  await expect(page.locator('.research-notebook-mode-tabs').getByRole('button').first()).toHaveAccessibleName('Expand note left panel');
  await expect(page.locator('.research-sidebar-ribbon.is-right').getByRole('button').first()).toHaveAccessibleName('Expand AI workspace');
  await expect(review.getByRole('tablist')).toHaveCount(1);
  const block = review.locator('[data-review-block-id="direct-child"]');
  for (const name of ['Accept this change', 'Reject this change', 'Adjust this change']) await expect(block.getByRole('button', { name, exact: true })).toBeInViewport();
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await review.getByRole('tab', { name: '第二页', exact: true }).click();
  await expect(review.getByRole('tabpanel')).toContainText('第二页保持原样。');
  await review.getByRole('tab', { name: '第一页', exact: true }).click();
  await expect(block.locator('.mewiki-ai-review-after')).toContainText('A revised example.');
  await page.screenshot({ path: info.outputPath('direct-review-split-mobile.png') });
});

test('keeps container and multi-field decisions beside the first field that actually changed', async ({ page }) => {
  const state = fixture();
  const container = createNativeProposal(state, 'default', { action: 'block-update', noteId, blockId: 'direct-tabs', fields: { title: '更新后的示例' } });
  const metadata = createNativeProposal(state, 'default', { action: 'note-update', noteId, fields: { title: state.notes.find(note => note.id === noteId)!.title, tags: ['待核对'] } });
  const { review } = await setup(page, state, [container, metadata]);
  const containerItem = review.locator(`[data-ai-review-proposal-id="${container.id}"]`);
  await expect(containerItem).toHaveCount(1);
  await expect(containerItem.locator('.mewiki-ai-review-after')).toContainText('更新后的示例');
  await containerItem.getByRole('button', { name: '调整此修改', exact: true }).click();
  await containerItem.locator('.mewiki-ai-review-after').getByRole('textbox', { name: '标题', exact: true }).fill('用户示例标题');
  await containerItem.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(review.getByRole('tablist')).toHaveCount(1);
  const metadataItem = review.locator(`[data-ai-review-proposal-id="${metadata.id}"]`);
  await expect(metadataItem).toHaveCount(1);
  await expect(metadataItem.locator('.mewiki-ai-review-after')).toContainText('待核对');
  await metadataItem.getByRole('button', { name: '同意此修改', exact: true }).click();
  expect((await savedNote(page)).tags).toEqual(['待核对']);
});

test('edits a new note in its green body without a detached form or a duplicate note', async ({ page }) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'create', title: 'AI 新笔记', content: '**待审正文**。' });
  const { review } = await setup(page, state, [proposal]);
  const item = review.locator(`[data-ai-review-proposal-id="${proposal.id}"]`), green = item.locator('.mewiki-ai-review-after').first();
  await expect(green).toContainText('待审正文');
  await green.getByRole('textbox', { name: '编辑建议内容', exact: true }).click();
  await green.getByRole('textbox', { name: '标题', exact: true }).fill('用户新笔记');
  await green.getByRole('textbox', { name: '建议正文', exact: true }).click();
  await replaceRenderedAiReviewText(green.locator('[contenteditable="true"]'), '用户调整的正文。');
  await item.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(review.getByRole('heading', { name: '用户新笔记', exact: true })).toHaveCount(1);
  await item.getByRole('button', { name: '同意此修改', exact: true }).click();
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.filter((note: { id: string }) => note.id === id), proposal.targetId);
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ title: '用户新笔记', blocks: [{ text: '用户调整的正文。' }] });
});

test('keeps a term proposal editable in the changed green field', async ({ page }) => {
  const state = fixture(), proposal = createTermProposal(state, 'default', { name: '闭环', meaning: '**反馈结构**。' });
  const { review } = await setup(page, state, [proposal]);
  const item = review.locator(`[data-ai-review-proposal-id="${proposal.id}"]`), green = item.locator('.mewiki-ai-review-after');
  await expect(green).toContainText('闭环');
  await green.getByRole('textbox', { name: '编辑建议内容', exact: true }).click();
  await green.getByRole('textbox', { name: '名称', exact: true }).fill('反馈环');
  await item.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(green).toContainText('反馈环');
  await item.getByRole('button', { name: '同意此修改', exact: true }).click();
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).terms.find((term: { id: string }) => term.id === id), proposal.targetId);
  expect(saved).toMatchObject({ name: '反馈环', meaning: '**反馈结构**。' });
});

test('renders removed tab decisions at the red content and moved block decisions only at the destination', async ({ page }) => {
  const state = fixture();
  const removed = createNativeProposal(state, 'default', { action: 'tab-delete', noteId, blockId: 'direct-tabs', tabId: 'direct-two' });
  const moved = createNativeProposal(state, 'default', { action: 'block-move', noteId, blockId: 'direct-text', beforeBlockId: 'direct-tabs' });
  const { review } = await setup(page, state, [removed, moved]);
  const movedItem = review.locator(`[data-ai-review-proposal-id="${moved.id}"]`);
  await expect(movedItem).toHaveCount(1);
  await review.getByRole('tab', { name: '第二页', exact: true }).click();
  const removedItem = review.locator(`[data-ai-review-proposal-id="${removed.id}"]`);
  await expect(removedItem).toHaveCount(1);
  await expect(removedItem.locator('.mewiki-ai-review-before')).toContainText('第二页保持原样。');
  await expect(removedItem.getByRole('button', { name: '调整此修改', exact: true })).toHaveCount(0);
  await removedItem.getByRole('button', { name: '拒绝此修改', exact: true }).click();
  await expect(review.getByRole('tablist')).toHaveCount(1);
});

test('keeps keyboard editing in the green surface and saves or cancels without a blur', async ({ page }) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'direct-text', content: '**原建议**。' });
  const { review } = await setup(page, state, [proposal]);
  const block = review.locator('[data-review-block-id="direct-text"]'), green = block.locator('.mewiki-ai-review-after');
  await green.getByRole('textbox', { name: '编辑建议内容', exact: true }).press('Enter');
  await green.locator('[contenteditable=true]').fill('放弃的局部草稿。');
  await green.locator('[contenteditable=true]').press('Escape');
  await expect(block.getByRole('button', { name: '调整此修改', exact: true })).toBeFocused();
  await expect(green.locator('strong')).toHaveText('原建议');
  await block.getByRole('button', { name: '调整此修改', exact: true }).press('Enter');
  await replaceRenderedAiReviewText(green.locator('[contenteditable=true]'), '**键盘保留**。');
  await green.locator('[contenteditable=true]').press('Control+Enter');
  await expect(green.locator('strong')).toHaveText('键盘保留');
  expect(JSON.stringify(await savedNote(page))).not.toContain('键盘保留');
  await block.getByRole('button', { name: '同意此修改', exact: true }).click();
  expect(JSON.stringify(await savedNote(page))).toContain('键盘保留');
});

test('keeps separate text change groups, one shared context and one set of decisions with every green group editable', async ({ page }) => {
  const state = fixture(), note = state.notes.find(note => note.id === noteId)!;
  note.blocks[0] = { id: 'direct-text', type: 'paragraph', text: '甲甲\n中间保留行。\n乙乙' };
  const proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'direct-text', content: '丙丙\n中间保留行。\n丁丁' });
  const { review } = await setup(page, state, [proposal]);
  const block = review.locator('[data-review-block-id="direct-text"]');
  await expect(block.locator('.mewiki-ai-review-pair')).toHaveCount(2);
  await expect(block.getByRole('group', { name: '此处修改操作', exact: true })).toHaveCount(1);
  await expect(block.getByText('中间保留行。', { exact: true })).toHaveCount(1);
  await review.getByRole('button', { name: '左右对比', exact: true }).click();
  await block.locator('.mewiki-ai-review-after').last().getByRole('textbox', { name: '编辑建议内容', exact: true }).click();
  await expect(block.locator('.mewiki-ai-review-pair')).toHaveCount(1);
  await expect(block.locator('.mewiki-ai-review-before')).toContainText('甲甲');
  await expect(block.locator('.mewiki-ai-review-before')).toContainText('乙乙');
  await block.locator('[contenteditable=true]').fill('丙丙\n中间保留行。\n戊戊');
  await block.getByRole('button', { name: '保留调整', exact: true }).click();
  await expect(block.locator('.mewiki-ai-review-pair')).toHaveCount(2);
  await expect(block.locator('.mewiki-ai-review-after').last()).toContainText('戊戊');
  await expect(block.getByText('中间保留行。', { exact: true })).toHaveCount(1);
});

test('keeps split comparisons during replay and stops replay before directly editing the green content', async ({ page }) => {
  const state = fixture(), proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId, blockId: 'direct-text', content: '**用于回放的新表述**和 $x^3$。' });
  const { review, ai } = await setup(page, state, [proposal]);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await review.getByRole('button', { name: '左右对比', exact: true }).click();
  const block = review.locator('[data-review-block-id="direct-text"]'), cannon = page.getByTestId('mewiki-ai-text-cannon');
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => Number(await cannon.getAttribute('data-shots') ?? 0)).toBeGreaterThan(0);
  const left = (await block.locator('.mewiki-ai-review-before').boundingBox())!, right = (await block.locator('.mewiki-ai-review-after').boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  await block.getByRole('button', { name: '调整此修改', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await expect(block.locator('.mewiki-ai-review-after [contenteditable=true]')).toBeVisible();
  await block.getByRole('button', { name: '取消调整', exact: true }).click();
  await expect(review).toHaveAttribute('data-review-layout', 'split');
  await expect(block.locator('.mewiki-ai-review-after strong')).toHaveText('用于回放的新表述');
  expect((await savedNote(page)).blocks).toEqual(state.notes.find(note => note.id === noteId)!.blocks);
});
