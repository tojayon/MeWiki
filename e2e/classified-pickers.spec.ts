import { expectEditorSource, startEditorComposition, finishEditorComposition } from "./helpers/referenceEditor.ts";
import { createNotebookFixture as createResearchNotebook } from "../src/domain/testUtils/notebook.ts";
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';
import { runNotebookAction } from './helpers/researchNotebook.ts';

async function seed(page: Page, nestedCategories = false) {
  const state = createResearchNotebook();
  state.symbols = [
    createSymbolEntry({ name: '测量状态', notation: 'x', meaning: '状态说明', tags: ['控制/状态', '常用'], slots: [] }, 'choice-x'),
    createSymbolEntry({ name: '测量输入', notation: 'u', meaning: '输入说明', tags: ['控制/输入'], slots: [] }, 'choice-u'),
  ];
  state.notes = [
    { ...createResearchNote('编辑笔记'), id: 'owner', tags: ['研究'], blocks: [{ id: 'text', type: 'paragraph', text: '输入测试' }, { id: 'formula', type: 'formula', tex: '', parts: [{ type: 'symbol', entryId: 'choice-x', bindings: {} }] }] },
    { ...createResearchNote('状态理论'), id: 'source', library: 'foundation', tags: ['控制/状态', '常用'], blocks: [{ id: 'source-text', type: 'paragraph', text: '来源段落' }, { id: 'source-formula', type: 'formula', tex: 'x=1', outputs: [{ id: 'output', entryId: 'choice-x', bindings: {} }], caption: '状态定义' }] },
    { ...createResearchNote('输入理论'), id: 'other', library: 'foundation', tags: ['控制/输入'], blocks: [] },
  ];
  if (nestedCategories) {
    for (const note of state.notes.slice(1)) note.tags!.push('框架/状态/模型');
    for (const symbol of state.symbols) symbol.tags!.push('框架/状态/模型');
  }
  state.activeNoteId = 'owner'; state.librarySelections = { research: 'owner' }; state.view = 'notes'; state.open = true;
  await page.addInitScript(state => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, state);
  await page.goto('/');
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('编辑笔记');
}

for (const commitOrder of ['before', 'after'] as const) test(`opens the symbol picker after a composed fullwidth yuan sign commits ${commitOrder} compositionend`, async ({ page }) => {
  await seed(page);
  const block = page.locator('[data-block-id="text"]');
  await block.getByRole('textbox').click();
  const editor = block.locator('[contenteditable="true"]');
  await startEditorComposition(editor, '$');
  await expect(page.getByRole('dialog', { name: '插入词典符号', exact: true })).toHaveCount(0);
  await finishEditorComposition(editor, '￥', commitOrder);
  const picker = page.getByRole('dialog', { name: '插入词典符号', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('option', { name: '测量状态', exact: true }).first().click();
  await expectEditorSource(editor, '[$x$](mewiki-symbol:choice-x)');
});

test('uses the fullwidth yuan trigger for symbol search and leaves currency text intact on cancel', async ({ page }) => {
  await seed(page);
  const block = page.locator('[data-block-id="text"]');
  await block.getByRole('textbox').click();
  const editor = block.locator('[contenteditable="true"]');
  await editor.fill('金额￥100');
  const picker = page.getByRole('dialog', { name: '插入词典符号', exact: true });
  await expect(picker).toBeVisible();
  await editor.press('Escape');
  await expect(picker).toHaveCount(0);
  await expectEditorSource(editor, '金额￥100');
  await editor.fill('使用￥测量输入');
  await expect(picker.getByRole('option', { name: '测量输入', exact: true }).first()).toBeVisible();
  await expect(picker.getByRole('option', { name: '测量状态', exact: true })).toHaveCount(0);
  await editor.press('Enter');
  await expectEditorSource(editor, '使用[$u$](mewiki-symbol:choice-u)');
});

test('keeps nested category cells contiguous in inline pickers', async ({ page }, info) => {
  await seed(page, true);
  const block = page.locator('[data-block-id="text"]');
  await block.getByRole('textbox').click();
  const editor = block.locator('[contenteditable="true"]');

  for (const picker of [
    { trigger: '@', label: '插入笔记引用', cancel: '取消笔记选择' },
    { trigger: '$', label: '插入词典符号', cancel: '取消符号选择' },
  ]) {
    await editor.fill(picker.trigger);
    const dialog = page.getByRole('dialog', { name: picker.label, exact: true });
    const tree = dialog.locator('.research-note-tree');
    const root = tree.locator('[data-tag-path="框架"] > .research-note-folder');
    const middle = tree.locator('[data-tag-path="框架/状态"] > .research-note-folder');
    const leaf = tree.locator('[data-tag-path="框架/状态/模型"] > .research-note-folder');
    const rows = tree.locator('[data-tag-path="框架/状态/模型"] > .research-note-tree-children > .research-note-tree-note');
    await expect(rows).toHaveCount(2);

    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(leaf).toBeVisible();
      const [treeBox, rootBox, middleBox, leafBox, firstBox, secondBox] = await Promise.all([
        tree.boundingBox(), root.boundingBox(), middle.boundingBox(), leaf.boundingBox(), rows.nth(0).boundingBox(), rows.nth(1).boundingBox(),
      ]);
      const treeSpacing = await tree.evaluate(element => [...element.querySelectorAll<HTMLElement>('ul, li')].map(item => {
        const style = getComputedStyle(item);
        return { margin: style.margin, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
      }));
      expect(treeSpacing.every(item => item.margin === '0px' && item.paddingLeft === '0px' && item.paddingRight === '0px')).toBe(true);
      expect(Math.abs(rootBox!.x - treeBox!.x - 1)).toBeLessThanOrEqual(1);
      expect(Math.abs(middleBox!.x - rootBox!.x - rootBox!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(leafBox!.x - middleBox!.x - middleBox!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(firstBox!.x - leafBox!.x - leafBox!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(secondBox!.y - firstBox!.y - firstBox!.height)).toBeLessThanOrEqual(1);
      await expect(rows.nth(0)).toBeInViewport();
      await dialog.screenshot({ path: info.outputPath(`contiguous-${picker.trigger === '@' ? 'notes' : 'symbols'}-${viewport.width}.png`) });
    }
    await dialog.getByRole('button', { name: picker.cancel, exact: true }).click();
  }
});

async function expectClassificationWidths(tree: Locator) {
  const parent = tree.locator('[data-tag-path="控制"] > .research-note-folder');
  const leaf = tree.locator('[data-tag-path="控制/状态"] > .research-note-folder');
  await expect(parent).toBeVisible();
  await expect(leaf).toBeVisible();
  await expect(parent.locator('.research-note-folder-label')).toHaveCSS('writing-mode', 'vertical-rl');
  await expect(leaf.locator('.research-note-folder-label')).toHaveCSS('writing-mode', 'horizontal-tb');
  const parentWidth = (await parent.boundingBox())!.width;
  const leafWidth = (await leaf.boundingBox())!.width;
  expect(leafWidth).toBeGreaterThanOrEqual(80);
  expect(parentWidth).toBeLessThan(leafWidth * .7);
}

test('allocates shared category widths in inline and content pickers', async ({ page }, info) => {
  await seed(page);
  const block = page.locator('[data-block-id="text"]');
  await block.getByRole('textbox').click();
  const editor = block.locator('[contenteditable="true"]');
  await editor.fill('@');
  const picker = page.getByRole('dialog', { name: '插入笔记引用', exact: true });
  await expectClassificationWidths(picker);
  const search = picker.getByRole('searchbox', { name: '搜索笔记', exact: true });
  await search.fill('控制/状态');
  await expectClassificationWidths(picker);
  await picker.getByRole('button', { name: '取消笔记选择', exact: true }).click();

  await editor.fill('$');
  const symbols = page.getByRole('dialog', { name: '插入词典符号', exact: true });
  await expectClassificationWidths(symbols);
  await symbols.getByRole('searchbox', { name: '搜索符号', exact: true }).fill('控制/状态');
  await expectClassificationWidths(symbols);
  await symbols.getByRole('button', { name: '取消符号选择', exact: true }).click();

  await page.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('button', { name: '引用笔记内容', exact: true }).click();
  const sourcePicker = page.getByTestId('research-note-embed-picker');
  await expectClassificationWidths(sourcePicker);
  await sourcePicker.getByLabel('搜索来源笔记', { exact: true }).fill('控制/状态');
  await expectClassificationWidths(sourcePicker);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectClassificationWidths(sourcePicker);
  await expect(sourcePicker.getByRole('option', { name: '状态理论', exact: true }).first()).toBeVisible();
  await sourcePicker.screenshot({ path: info.outputPath('classified-widths-mobile.png') });
});

test('uses classified note and symbol tables for inline insertion with visible-row keyboard navigation', async ({ page }, info) => {
  await seed(page);
  const block = page.locator('[data-block-id="text"]');
  await block.getByRole('textbox').click();
  const editor = block.locator('[contenteditable="true"]');
  await editor.fill('@');
  const picker = page.getByRole('dialog', { name: '插入笔记引用', exact: true });
  await expect(picker.locator('.research-note-tree')).toBeVisible();
  await picker.screenshot({ path: info.outputPath('classified-inline-note.png') });
  await picker.getByRole('button', { name: '收起标签 控制', exact: true }).click();
  await editor.press('ArrowDown');
  await editor.press('Enter');
  await expectEditorSource(editor, /#research-note\/source/);
  await editor.fill('$');
  const symbols = page.getByRole('dialog', { name: '插入词典符号', exact: true });
  await expect(symbols.locator('.research-note-tree')).toBeVisible();
  await editor.press('Tab');
  const search = symbols.getByRole('searchbox', { name: '搜索符号', exact: true });
  await search.fill('控制/输入');
  await expect(symbols.getByRole('option', { name: '测量输入', exact: true })).toBeVisible();
  await expect(symbols.getByRole('option', { name: '测量状态', exact: true })).toHaveCount(0);
  await search.press('Enter');
  await expectEditorSource(editor, /mewiki-symbol:/);
});

test('uses the same classification for content sources and manual theory basis selection', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('button', { name: '引用笔记内容', exact: true }).click();
  let picker = page.getByTestId('research-note-embed-picker');
  await expect(picker.locator('.research-note-tree')).toBeVisible();
  await picker.getByLabel('搜索来源笔记', { exact: true }).fill('控制/状态');
  await picker.getByRole('option', { name: '状态理论', exact: true }).first().click();
  await picker.getByLabel('选择内容 1', { exact: true }).check();
  await picker.getByRole('button', { name: '插入引用', exact: true }).click();
  await expect(page.locator('[data-note-embed]').first()).toContainText('来源段落');
  await runNotebookAction(page.getByTestId('research-notebook'), '笔记元数据');
  await page.getByRole('button', { name: '编辑元数据', exact: true }).click();
  await page.getByRole('button', { name: '添加理论依据', exact: true }).click();
  picker = page.getByRole('dialog', { name: '添加理论依据', exact: true });
  await expect(picker.locator('.research-note-tree')).toBeVisible();
  await picker.getByRole('searchbox').fill('输入');
  await picker.getByRole('option', { name: '输入理论', exact: true }).click();
  await expect(page.locator('.research-metadata-basis-list')).toContainText('输入理论');
});

test('allows multiple map members through the shared classified table', async ({ page }) => {
  await seed(page);
  await page.getByRole('tab', { name: '理论地图', exact: true }).click();
  await page.getByRole('button', { name: '新建地图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建地图', exact: true });
  await dialog.getByLabel('地图名称', { exact: true }).fill('分类选择测试');
  await expect(dialog.locator('.research-note-tree')).toBeVisible();
  await dialog.getByRole('option', { name: '状态理论', exact: true }).first().click();
  for (const option of await dialog.getByRole('option', { name: '状态理论', exact: true }).all()) await expect(option).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('option', { name: '输入理论', exact: true }).click();
  await dialog.getByRole('button', { name: '保存地图文档', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).theoryMaps.documents.find((item: { title: string }) => item.title === '分类选择测试')?.noteIds)).toEqual(['source', 'other']);
});

test('uses classified symbols for formula results and keeps the settings open when a nested picker is dismissed', async ({ page }, info) => {
  await seed(page);
  const formula = page.locator('[data-formula-id="formula"]');
  await formula.hover(); await formula.getByRole('button', { name: '公式设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '公式设置', exact: true });
  await settings.getByRole('button', { name: '添加结果符号', exact: true }).click();
  await settings.getByRole('button', { name: '结果符号 1', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '结果符号 1', exact: true });
  await expect(popup.locator('.research-note-tree')).toBeVisible();
  await popup.getByRole('searchbox').press('Escape');
  await expect(popup).toHaveCount(0); await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: '结果符号 1', exact: true }).click();
  await popup.getByRole('searchbox').fill('控制/输入');
  await popup.getByRole('searchbox').press('Enter');
  await expect(settings.getByRole('button', { name: '结果符号 1', exact: true })).toContainText('测量输入');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  await formula.hover(); await formula.getByRole('button', { name: '编辑公式', exact: true }).click();
  await formula.locator('[data-formula-index="0"]').dblclick();
  const editor = page.getByRole('dialog', { name: '编辑公式项', exact: true });
  await editor.getByRole('button', { name: '高级设置', exact: true }).click();
  await editor.getByRole('button', { name: '推导来源', exact: true }).click();
  const sources = page.getByRole('dialog', { name: '推导来源', exact: true });
  await expect(sources.locator('.research-note-tree')).toBeVisible();
  await expect(sources.getByRole('option', { name: '仅使用词典定义', exact: true })).toHaveAttribute('aria-selected', 'true');
  await sources.getByRole('searchbox').press('Enter');
  await expect(editor.getByRole('button', { name: '推导来源', exact: true })).toContainText('仅使用词典定义');
  await editor.getByRole('button', { name: '推导来源', exact: true }).click();
  await sources.getByRole('searchbox').fill('控制/状态');
  await sources.screenshot({ path: info.outputPath('classified-formula-source.png') });
  await sources.getByRole('option', { name: '状态理论 · 状态定义', exact: true }).first().click();
  await expect(editor.getByRole('button', { name: '推导来源', exact: true })).toContainText('状态定义');
  await editor.getByRole('button', { name: '保存公式项', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'owner').blocks.find((block: { id: string }) => block.id === 'formula').parts[0].source)).toEqual({ noteId: 'source', formulaId: 'source-formula', outputId: 'output' });
});

test('selects theory relation endpoints through the classified note catalogue on a narrow screen', async ({ page }, info) => {
  await seed(page);
  await page.getByRole('tab', { name: '理论地图', exact: true }).click();
  await page.getByRole('button', { name: '打开地图 全局地图', exact: true }).click();
  await page.getByRole('button', { name: '新增理论关系', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '关系起点', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '关系起点', exact: true });
  await popup.getByRole('searchbox').fill('状态理论');
  await expect(popup.locator('.research-note-tree')).toBeVisible();
  expect(await popup.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await popup.screenshot({ path: info.outputPath('classified-note-mobile.png') });
  await popup.getByRole('option', { name: '状态理论 · 整篇笔记', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '关系起点', exact: true })).toContainText('状态理论');
  await page.getByRole('button', { name: '关系终点', exact: true }).click();
  const targets = page.getByRole('dialog', { name: '关系终点', exact: true });
  await targets.getByRole('searchbox').fill('编辑笔记');
  await targets.getByRole('option', { name: '编辑笔记 · 整篇笔记', exact: true }).click();
  await page.getByRole('button', { name: '保存理论关系', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).theoryMaps.documents[0].relations.some((relation: { source: { noteId: string }; target: { noteId: string } }) => relation.source.noteId === 'source' && relation.target.noteId === 'owner'))).toBe(true);
});

test('confirms the active keyboard row even when another result exactly matches the search', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.symbols[0].name = '状态'; state.symbols[1].name = '状态估计';
    state.symbols.forEach((symbol: { tags: string[] }) => { symbol.tags = ['控制']; });
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const formula = page.locator('[data-formula-id="formula"]');
  await formula.hover(); await formula.getByRole('button', { name: '公式设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '公式设置', exact: true });
  await settings.getByRole('button', { name: '添加结果符号', exact: true }).click();
  await settings.getByRole('button', { name: '结果符号 1', exact: true }).click();
  const popup = page.getByRole('dialog', { name: '结果符号 1', exact: true });
  const search = popup.getByRole('searchbox');
  await search.fill('状态'); await search.press('ArrowUp');
  const activeId = await search.getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute('aria-label', '状态估计');
  await search.press('Enter');
  await expect(settings.getByRole('button', { name: '结果符号 1', exact: true })).toContainText('状态估计');
  await settings.getByRole('button', { name: '结果符号 1', exact: true }).click();
  await popup.getByRole('searchbox').press('Enter');
  await expect(settings.getByRole('button', { name: '结果符号 1', exact: true })).toContainText('状态估计');
});

test('saves a text draft when focus leaves a picker category and another note is opened', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes.find((note: { id: string }) => note.id === 'other').library = 'research';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload();
  const editor = page.locator('[data-block-id="text"] [contenteditable="true"]');
  await page.locator('[data-block-id="text"]').getByRole('textbox').click();
  await editor.fill('切换笔记后仍保留这段草稿 @');
  await editor.press('Tab'); await page.keyboard.press('Tab');
  await expect(page.getByRole('dialog', { name: '插入笔记引用', exact: true }).getByRole('button', { name: '收起标签 常用', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '输入理论', exact: true }).click();
  await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await expect(page.locator('[data-block-id="text"]')).toContainText('切换笔记后仍保留这段草稿');
});
