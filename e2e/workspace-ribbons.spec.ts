import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';
import { createAiSession } from '../src/ai/session.ts';
import { createNoteProposal } from '../src/ai/proposals.ts';
import { runNotebookAction } from './helpers/researchNotebook.ts';

async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'ribbon-source';
  state.notes = [
    { ...createResearchNote('正在阅读的笔记'), id: 'ribbon-source', library: 'research', tags: ['示例/导航'], blocks: [
      { id: 'ribbon-heading', type: 'heading', level: 2, text: '导航标题' },
      { id: 'ribbon-text', type: 'paragraph', text: '正文与浮层分别操作。' },
    ] },
    { ...createResearchNote('另一篇研究记录'), id: 'ribbon-other', library: 'research', tags: ['示例/导航'] },
    { ...createResearchNote('竖栏基础理论'), id: 'ribbon-foundation', library: 'foundation', tags: ['示例/理论'] },
  ];
  state.symbols = [createSymbolEntry({ name: '竖栏符号', notation: 'x', meaning: '虚构符号', slots: [], tags: ['示例'] }, 'ribbon-symbol')];
  state.terms = [{ id: 'ribbon-term', name: '竖栏术语', meaning: '虚构术语', aliases: [], tags: ['示例'] }];
  await page.addInitScript(({ state, english }) => {
    if (!sessionStorage.getItem('ribbon-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'false');
      localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'false');
      sessionStorage.setItem('ribbon-seeded', 'true');
    }
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
  }, { state, english });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '竖栏测试库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'ribbon', providers: [{ id: 'ribbon', name: '受控服务', baseUrl: 'http://127.0.0.1:9999/v1', model: 'ribbon-model', protocol: 'openai-chat', hasApiKey: false }] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  const panel = page.getByTestId('research-notebook');
  await expect(panel.getByLabel(english ? 'Note title' : '笔记标题', { exact: true })).toHaveValue('正在阅读的笔记');
  return panel;
}

test('groups global actions in the left footer and removes the center toolbar bottom border', async ({ page }, info) => {
  const panel = await setup(page), header = panel.getByRole('toolbar', { name: '笔记管理', exact: true });
  const footer = panel.getByRole('toolbar', { name: '页面设置', exact: true });
  const language = footer.getByRole('button', { name: '界面语言', exact: true });
  const plugins = footer.getByRole('button', { name: '插件管理', exact: true });
  const settings = footer.getByRole('button', { name: '应用设置', exact: true });
  await expect(language).toBeVisible(); await expect(plugins).toBeVisible();
  expect((await plugins.boundingBox())!.x + (await plugins.boundingBox())!.width).toBeLessThanOrEqual((await settings.boundingBox())!.x);
  await expect(panel.getByRole('button', { name: /当前资料库.*切换资料库/ })).toHaveCount(1);
  for (const name of ['界面语言', '插件管理', '切换资料库']) await expect(header.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(header).toHaveCSS('border-bottom-width', '0px');
  await language.click(); await expect(page.getByRole('dialog', { name: '界面语言', exact: true })).toBeVisible();
  await expect(page.getByTestId('mewiki-settings-page')).toBeHidden(); await page.keyboard.press('Escape');
  await plugins.click(); await expect(page.getByRole('dialog', { name: '插件管理', exact: true })).toBeVisible();
  await expect(page.getByTestId('mewiki-settings-page')).toBeHidden(); await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('workspace-actions.png') });
});

for (const english of [false, true]) test(`keeps panel switches in their own bars and preserves keyboard focus${english ? ' on a narrow English page' : ''}`, async ({ page }, info) => {
  if (english) await page.setViewportSize({ width: 390, height: 680 });
  const panel = await setup(page, english), left = panel.locator('.research-notebook-mode-tabs');
  const outline = panel.locator('#research-note-outline');
  const collapseLeft = english ? 'Collapse note left panel' : '收起笔记左侧面板';
  const expandLeft = english ? 'Expand note left panel' : '展开笔记左侧面板';
  const collapseRight = english ? 'Collapse Outline' : '收起文章大纲';
  const expandRight = english ? 'Expand Outline' : '展开文章大纲';
  await expect(left.getByRole('button').first()).toHaveAccessibleName(collapseLeft);
  await expect(outline.locator('header').getByRole('button').last()).toHaveAccessibleName(collapseRight);
  await expect(panel.locator('.research-page-leading-actions, .research-page-trailing-actions')).toHaveCount(0);
  await expect(panel.getByRole('toolbar', { name: english ? 'Note management' : '笔记管理', exact: true }).locator('.research-notebook-sidebar-toggle, .research-outline-toggle')).toHaveCount(0);
  await left.getByRole('button', { name: collapseLeft, exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(left.getByRole('button').first()).toHaveAccessibleName(expandLeft);
  await expect(left.getByRole('button').first()).toBeFocused();
  await outline.getByRole('button', { name: collapseRight, exact: true }).focus();
  await page.keyboard.press('Enter');
  const right = panel.locator('.research-sidebar-ribbon.is-right');
  await expect(right.getByRole('button').first()).toHaveAccessibleName(expandRight);
  await expect(right.getByRole('button').first()).toBeFocused();
  await right.getByRole('tab', { name: english ? 'Outline' : '大纲', exact: true }).click();
  await expect(outline).toBeVisible();
  await expect(outline.locator('header .research-outline-toggle')).toHaveCount(0);
  await right.getByRole('button').first().press('Enter');
  await expect(right).toHaveCount(0);
  await expect(outline.locator('header').getByRole('button').first()).toBeFocused();
  await expect(outline.locator('header').getByRole('button').first()).toHaveAccessibleName(collapseRight);
  await page.keyboard.press('Escape');
  await expect(right.getByRole('button').first()).toBeFocused();
  await right.getByRole('button').first().press('Space');
  await expect(outline.locator('header').getByRole('button').first()).toBeFocused();
  await left.getByRole('button').first().press('Enter');
  await expect(left.getByRole('button').first()).toHaveAccessibleName(collapseLeft);
  await expect(left.getByRole('button').first()).toBeFocused();
  await page.screenshot({ path: info.outputPath(english ? 'panel-switches-phone.png' : 'panel-switches-desktop.png') });
});

test('keeps ribbon switches reachable during narrow AI review without copying them into its toolbar', async ({ page }, info) => {
  const panel = await setup(page);
  await page.evaluate(() => {
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'true');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  });
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!));
  const proposal = createNoteProposal(state, 'default', { operation: 'replace-text', noteId: 'ribbon-source', blockId: 'ribbon-text', content: '新的审阅正文。' });
  await page.evaluate(session => localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session)), { ...createAiSession('default'), proposals: [proposal] });
  await page.reload();
  const ai = await openAiWorkspace(page); await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 680 });
  const review = page.getByTestId('mewiki-ai-review'), left = panel.locator('.research-notebook-mode-tabs'), right = panel.locator('.research-sidebar-ribbon.is-right');
  await expect(review).toBeVisible();
  await expect(review.locator('.research-notebook-sidebar-toggle, .research-outline-toggle')).toHaveCount(0);
  // Keep the floating chat away from the edge switches under test.
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await expect(ai.locator('header').getByRole('button').last()).toHaveAccessibleName('收起AI 工作区');
  await expect(panel.locator('.research-outline-toggle')).toHaveCount(1);
  await panel.getByRole('button', { name: '收起AI 工作区', exact: true }).click();
  for (const bar of [left, right]) {
    const control = bar.getByRole('button').first();
    await expect(control).toBeVisible(); await expect(control).toBeEnabled();
    await control.focus(); await expect(control).toBeFocused();
  }
  await right.getByRole('tab', { name: '大纲', exact: true }).click();
  await expect(panel.locator('#research-note-outline')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(right.getByRole('tab', { name: '大纲', exact: true })).toBeFocused();
  await left.getByRole('tab', { name: '研究记录', exact: true }).click();
  await expect(panel.locator('#research-notebook-sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('panel-switches-ai-review-phone.png') });
});

test('keeps left categories in a vertical ribbon and opens a temporary panel without resizing the article', async ({ page }, info) => {
  const panel = await setup(page);
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  const tabs = panel.getByRole('tablist', { name: '科研笔记视图', exact: true });
  await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
  expect((await tabs.boundingBox())!.width).toBe(44);
  await expect(tabs.locator('img')).toBeHidden();
  const article = panel.locator('.research-reading-rail'), before = (await article.boundingBox())!;
  for (const [name, id] of [['符号', 'research-dictionary-sidebar'], ['术语', 'research-term-dictionary-sidebar'], ['基础理论', 'research-notebook-sidebar'], ['研究记录', 'research-notebook-sidebar'], ['理论地图', 'research-theory-sidebar']]) {
    await tabs.getByRole('tab', { name, exact: true }).click();
    await expect(panel.locator(`#${id}`)).toBeVisible();
    await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('正在阅读的笔记');
    expect((await article.boundingBox())!.width).toBe(before.width);
  }
  await tabs.getByRole('tab', { name: '研究记录', exact: true }).click();
  await panel.getByLabel('搜索研究笔记', { exact: true }).fill('另一篇');
  await panel.locator('#research-notebook-sidebar').getByRole('button', { name: '另一篇研究记录', exact: true }).click();
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('另一篇研究记录');
  await expect(panel.locator('#research-notebook-sidebar')).toBeHidden();
  await expect(tabs.getByRole('tab', { name: '研究记录', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await tabs.getByRole('tab', { name: '研究记录', exact: true }).click();
  await expect(panel.getByLabel('搜索研究笔记', { exact: true })).toHaveValue('另一篇');
  await page.keyboard.press('Escape');
  await expect(tabs.getByRole('tab', { name: '研究记录', exact: true })).toBeFocused();
  await expect(panel.locator('#research-notebook-sidebar')).toBeHidden();
  await tabs.getByRole('tab', { name: '研究记录', exact: true }).press('ArrowUp');
  await expect(tabs.getByRole('tab', { name: '基础理论', exact: true })).toBeFocused();
  await expect(panel.locator('#research-notebook-sidebar')).toBeVisible();
  await page.screenshot({ path: info.outputPath('workspace-left-ribbon.png') });
});

test('opens right outline and backlinks as overlays and keeps both article edges fixed', async ({ page }, info) => {
  const panel = await setup(page);
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await panel.getByRole('button', { name: '收起文章大纲', exact: true }).click();
  const ribbon = panel.locator('.research-sidebar-ribbon.is-right');
  await expect(ribbon).toBeVisible(); await expect(ribbon).toHaveAttribute('aria-orientation', 'vertical');
  const article = panel.locator('.research-reading-rail'), before = (await article.boundingBox())!;
  await ribbon.getByRole('tab', { name: '大纲', exact: true }).click();
  await expect(panel.locator('#research-note-outline')).toBeVisible();
  await expect(panel.getByRole('button', { name: /导航标题/ })).toBeVisible();
  expect((await article.boundingBox())!.width).toBe(before.width);
  await ribbon.getByRole('tab', { name: '反向链接', exact: true }).click();
  await expect(panel.getByRole('navigation', { name: '引用当前笔记的笔记', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(ribbon.getByRole('tab', { name: '反向链接', exact: true })).toBeFocused();
  await expect(panel.locator('#research-note-outline')).toBeHidden();
  await ribbon.getByRole('tab', { name: '反向链接', exact: true }).click();
  await panel.locator('.research-note-scroll').click({ position: { x: 15, y: 100 } });
  await expect(panel.locator('#research-note-outline')).toBeHidden();
  expect((await article.boundingBox())!.x).toBe(before.x);
  await page.screenshot({ path: info.outputPath('workspace-both-ribbons.png') });
});

test('keeps only one edge overlay open on a phone and restores collapsed preferences after reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 640 }); const panel = await setup(page);
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await panel.getByRole('button', { name: '收起文章大纲', exact: true }).click();
  const left = panel.locator('.research-notebook-mode-tabs'), right = panel.locator('.research-sidebar-ribbon.is-right');
  await left.getByRole('tab', { name: '研究记录', exact: true }).click();
  const list = panel.locator('#research-notebook-sidebar'); await expect(list).toBeVisible();
  const box = (await list.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(44); expect(box.x + box.width).toBeLessThanOrEqual(346);
  await right.getByRole('tab', { name: '大纲', exact: true }).click();
  await expect(list).toBeHidden(); await expect(panel.locator('#research-note-outline')).toBeVisible();
  expect(await panel.locator('.research-notebook-layout').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('workspace-ribbons-phone.png') });
  await page.reload(); await expect(left).toBeVisible(); await expect(right).toBeVisible();
  await expect(panel.locator('#research-note-outline')).toHaveCount(0);
  await expect(list).toBeHidden();
});

test('opens the docked assistant from the right ribbon without recreating its input', async ({ page }, info) => {
  const panel = await setup(page), ai = await openAiWorkspace(page);
  const input = ai.getByLabel('任务要求', { exact: true }); await input.fill('竖栏切换保留草稿');
  await input.evaluate(element => element.dataset.ribbonIdentity = 'same-input');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await panel.getByRole('button', { name: '收起AI 工作区', exact: true }).first().click();
  const right = panel.locator('.research-sidebar-ribbon.is-right');
  await right.getByRole('tab', { name: '智能助理', exact: true }).click();
  await expect(ai).toBeVisible(); await expect(input).toHaveValue('竖栏切换保留草稿'); await expect(input).toHaveAttribute('data-ribbon-identity', 'same-input');
  const frame = (await ai.boundingBox())!, ribbon = (await right.boundingBox())!;
  expect(frame.x + frame.width).toBeLessThanOrEqual(ribbon.x);
  await right.getByRole('tab', { name: '大纲', exact: true }).click(); await expect(ai).toBeHidden();
  await right.getByRole('tab', { name: '智能助理', exact: true }).click(); await expect(input).toHaveValue('竖栏切换保留草稿');
  await page.screenshot({ path: info.outputPath('workspace-ribbon-ai.png') });
  await input.focus(); await input.press('Escape');
  await expect(ai).toBeHidden(); await expect(right.getByRole('tab', { name: '智能助理', exact: true })).toBeFocused();
});

test('navigates symbols, terms, foundations, maps and the manual from the collapsed left edge', async ({ page }) => {
  const panel = await setup(page), tabs = panel.locator('.research-notebook-mode-tabs');
  await runNotebookAction(panel, '使用手册');
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  for (const [tab, sidebar, item] of [
    ['符号', 'research-dictionary-sidebar', '竖栏符号'], ['术语', 'research-term-dictionary-sidebar', '竖栏术语'],
    ['基础理论', 'research-notebook-sidebar', '竖栏基础理论'], ['理论地图', 'research-theory-sidebar', '打开地图 全局地图'],
    ['使用手册', 'research-manual-sidebar', '界面与阅读'],
  ]) {
    await tabs.getByRole('tab', { name: tab, exact: true }).click();
    const list = panel.locator(`#${sidebar}`); await expect(list).toBeVisible();
    await list.getByRole('button', { name: item, exact: true }).click();
    await expect(list).toBeHidden();
    await expect(tabs.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.locator('.research-reading-rail .research-notebook-sidebar-toggle, .research-symbol-pane .research-notebook-sidebar-toggle, .research-notebook-editor .research-notebook-sidebar-toggle')).toHaveCount(0);
    if (tab === '符号') await expect(panel.locator('#research-note-outline header').getByRole('button').first()).toHaveAccessibleName('收起反向链接');
  }
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue('界面与阅读');
});

test('keeps filters and footer tools usable in a temporary category panel', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 640 });
  const panel = await setup(page), tabs = panel.locator('.research-notebook-mode-tabs');
  await panel.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await panel.getByRole('button', { name: '收起文章大纲', exact: true }).click();
  await tabs.getByRole('tab', { name: '研究记录', exact: true }).click();
  const list = panel.locator('#research-notebook-sidebar');
  await list.getByRole('button', { name: '全部折叠分类', exact: true }).click();
  await expect(list).toBeVisible(); await expect(list.locator('[data-research-choice]:visible')).toHaveCount(0);
  await list.getByRole('button', { name: '全部展开分类', exact: true }).click();
  await list.getByLabel('搜索研究笔记', { exact: true }).fill('另一篇');
  await expect(list.getByRole('button', { name: '另一篇研究记录', exact: true })).toBeVisible();
  const footer = panel.locator('.research-sidebar-footer');
  expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (const name of ['界面语言', '插件管理', '应用设置']) await expect(footer.getByRole('button', { name, exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('workspace-ribbon-footer-phone.png') });
  await footer.getByRole('button', { name: '界面语言', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '界面语言', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(list).toBeVisible();
  await page.keyboard.press('Escape'); await expect(list).toBeHidden();
  await tabs.getByRole('tab', { name: '研究记录', exact: true }).click(); await expect(list).toBeVisible();
});

test('localizes both ribbons and shows recipes without moving the note', async ({ page }, info) => {
  const panel = await setup(page, true);
  await panel.getByRole('button', { name: 'Collapse note left panel', exact: true }).click();
  await panel.getByRole('button', { name: 'Collapse Outline', exact: true }).click();
  const right = panel.locator('.research-sidebar-ribbon.is-right');
  await right.getByRole('tab', { name: 'Variable recipe', exact: true }).click();
  await expect(panel.locator('#research-note-recipe-panel')).toBeVisible();
  await expect(panel.locator('#research-note-recipe-panel')).toContainText('No variable selected.');
  await expect(panel.getByLabel('Note title', { exact: true })).toHaveValue('正在阅读的笔记');
  await page.screenshot({ path: info.outputPath('workspace-ribbon-english.png') });
});

test('continues the same AI task while its edge preview is hidden and reopened', async ({ page }) => {
  const panel = await setup(page), ai = await openAiWorkspace(page); let requests = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => {
    requests++; await pending;
    await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '临时面板隐藏期间完成的回复' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }).catch(() => {});
  });
  try {
    const input = ai.getByLabel('任务要求', { exact: true });
    await input.fill('在侧栏切换时完成此任务'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect.poll(() => requests).toBe(1); await input.fill('保留的后续问题');
    await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
    await panel.getByRole('button', { name: '收起AI 工作区', exact: true }).first().click();
    const ribbon = panel.locator('.research-sidebar-ribbon.is-right');
    await ribbon.getByRole('tab', { name: '智能助理', exact: true }).click();
    await expect(ai.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
    await ribbon.getByRole('tab', { name: '大纲', exact: true }).click(); await expect(ai).toBeHidden();
    release(); await ribbon.getByRole('tab', { name: '智能助理', exact: true }).click();
    await expect(ai.getByText('临时面板隐藏期间完成的回复', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('保留的后续问题'); expect(requests).toBe(1);
  } finally { release(); }
});
