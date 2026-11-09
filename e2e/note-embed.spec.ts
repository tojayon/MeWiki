import { expect, test, type Page } from '@playwright/test';
import { runNotebookAction } from './helpers/researchNotebook.ts';

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('research-notebook')).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    const now = new Date().toISOString();
    const note = (id: string, title: string, blocks: unknown[]) => ({ id, title, blocks, createdAt: now, updatedAt: now, library: 'research', reviewStatus: 'pending', tags: [] });
    state.notes = [
      note('note-a', '引用笔记 A', [{ id: 'a-intro', type: 'paragraph', text: 'A 原有的独立内容' }]),
      note('note-b', '来源笔记 B', [
        { id: 'b-first', type: 'paragraph', text: '来源第一段：需要同步的原文。' },
        { id: 'b-second', type: 'paragraph', text: '来源第二段：暂不引用。' },
        { id: 'b-formula', type: 'formula', tex: 'x^2+y^2=z^2', caption: '原始公式' },
        { id: 'b-tabs', type: 'examples', title: '更多内容', tabs: [{ id: 'tab-one', title: '第一组', blocks: [{ id: 'nested', type: 'paragraph', text: '标签页中的来源内容' }] }, { id: 'tab-two', title: '第二组', blocks: [] }] },
      ]),
      note('note-c', '其他笔记 C', []),
    ];
    state.view = 'notes'; state.activeNoteId = 'note-a'; state.librarySelections = { research: 'note-a' }; state.noteFilters = { query: '', tag: '', status: 'all' };
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  });
  await page.reload();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('引用笔记 A');
}
async function picker(page: Page) {
  await page.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '引用笔记内容', exact: true }).click();
  return page.getByTestId('research-note-embed-picker');
}
test('embeds selected blocks and follows source edits and renames after reload', async ({ page }) => {
  await seed(page);
  const dialog = await picker(page);
  await dialog.getByLabel('搜索来源笔记', { exact: true }).fill('来源笔记 B');
  await dialog.getByRole('option', { name: /来源笔记 B/ }).click();
  await dialog.getByLabel('选择内容 1', { exact: true }).check();
  await dialog.getByLabel('选择内容 3', { exact: true }).check();
  await expect(dialog.getByRole('group', { name: '来源内容', exact: true })).toContainText('来源第一段');
  await dialog.getByRole('button', { name: '插入引用', exact: true }).click();
  const embed = page.locator('[data-note-embed]').first();
  await expect(embed).toContainText('来源第一段');
  await expect(embed).toContainText('原始公式');
  await expect(embed).not.toContainText('来源第二段');
  await expect(embed.getByRole('button', { name: '编辑公式', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '来源笔记 B', exact: true }).click();
  await page.locator('[data-block-id="b-first"]').getByRole('textbox').click();
  await page.locator('[data-block-id="b-first"] textarea').fill('来源第一段：已经更新，A 应同步显示。');
  await page.getByLabel('笔记标题', { exact: true }).fill('来源笔记 B 已改名');
  await page.getByLabel('笔记标题', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '引用笔记 A', exact: true }).click();
  await expect(page.locator('[data-note-embed]').first()).toContainText('已经更新，A 应同步显示');
  await expect(page.locator('[data-note-embed]').first()).toContainText('来源笔记 B 已改名');
  await page.reload();
  await expect(page.locator('[data-note-embed]').first()).toContainText('已经更新，A 应同步显示');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'note-a'));
  expect(stored.blocks.find((block: { type: string }) => block.type === 'noteEmbed').blockIds).toEqual(['b-first', 'b-formula']);
  expect(JSON.stringify(stored)).not.toContain('已经更新，A 应同步显示');
  await runNotebookAction(page.getByTestId('research-notebook'), '切换为只读模式');
  await expect(page.locator('[data-note-embed]').first()).toContainText('已经更新，A 应同步显示');
});

test('cancels without inserting, selects nested content and lets users adjust the range on a narrow screen', async ({ page }) => {
  await seed(page);
  let dialog = await picker(page);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('[data-note-embed]')).toHaveCount(0);
  dialog = await picker(page);
  await dialog.getByRole('option', { name: /来源笔记 B/ }).click();
  await dialog.getByLabel('选择内容 5', { exact: true }).check();
  await dialog.getByRole('button', { name: '插入引用', exact: true }).click();
  await expect(page.locator('[data-note-embed]').first()).toContainText('标签页中的来源内容');
  await runNotebookAction(page.getByTestId('research-notebook'), '收起笔记左侧面板');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '修改引用范围', exact: true }).click();
  dialog = page.getByTestId('research-note-embed-picker');
  await dialog.getByLabel('选择内容 5', { exact: true }).uncheck();
  await dialog.getByLabel('选择内容 2', { exact: true }).check();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '.mewiki/note-embed-picker-mobile.png' });
  await dialog.getByRole('button', { name: '保存引用范围', exact: true }).click();
  await expect(page.locator('[data-note-embed]').first()).toContainText('来源第二段');
  await expect(page.locator('[data-note-embed]').first()).not.toContainText('标签页中的来源内容');
});

test('updates an open embed when another window edits or reorders its source', async ({ page, context }) => {
  await seed(page);
  const dialog = await picker(page);
  await dialog.getByRole('option', { name: /来源笔记 B/ }).click();
  await dialog.getByLabel('选择内容 1', { exact: true }).check();
  await dialog.getByLabel('选择内容 3', { exact: true }).check();
  await dialog.getByRole('button', { name: '插入引用', exact: true }).click();
  const other = await context.newPage();
  await other.goto('/');
  await other.evaluate(() => {
    const key = 'mewiki:research-notebook';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.notes.find((note: { id: string }) => note.id === 'note-b').blocks[0].text = '另一个窗口修改后的最新来源';
    localStorage.setItem(key, JSON.stringify(state));
  });
  await expect(page.locator('[data-note-embed]').first()).toContainText('另一个窗口修改后的最新来源');
  await other.evaluate(() => {
    const key = 'mewiki:research-notebook';
    const state = JSON.parse(localStorage.getItem(key)!);
    const b = state.notes.find((item: { id: string }) => item.id === 'note-b');
    const formula = b.blocks.find((item: { id: string }) => item.id === 'b-formula');
    b.blocks = [formula, { id: 'inserted-front', type: 'paragraph', text: '新增但不应自动引用的段落' }, ...b.blocks.filter((item: { id: string }) => item.id !== 'b-formula')];
    localStorage.setItem(key, JSON.stringify(state));
  });
  const items = page.locator('[data-note-embed]').first().locator(':scope > .research-reference-blocks > [data-referenced-block-id]');
  await expect(items.first()).toHaveAttribute('data-referenced-block-id', 'b-formula');
  await expect(page.locator('[data-note-embed]').first()).not.toContainText('新增但不应自动引用');
  await other.close();
  await page.getByRole('button', { name: '打开引用来源：来源笔记 B', exact: true }).click();
  await expect(page.getByRole('region', { name: '阅读笔记 来源笔记 B', exact: true })).toBeVisible();
});

test('shows missing and cyclic sources explicitly and preserves their reference settings', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const key = 'mewiki:research-notebook';
    const state = JSON.parse(localStorage.getItem(key)!);
    const a = state.notes.find((item: { id: string }) => item.id === 'note-a');
    const b = state.notes.find((item: { id: string }) => item.id === 'note-b');
    a.blocks.push({ id: 'missing', type: 'noteEmbed', sourceNoteId: 'note-b', blockIds: ['removed-id', 'b-first'], sourceTitle: '来源笔记 B' });
    a.blocks.push({ id: 'cyclic', type: 'noteEmbed', sourceNoteId: 'note-b', blockIds: ['reverse'] });
    b.blocks.push({ id: 'reverse', type: 'noteEmbed', sourceNoteId: 'note-a', blockIds: ['cyclic'] });
    localStorage.setItem(key, JSON.stringify(state));
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.locator('[data-note-embed="missing"]')).toContainText('所引用的内容已删除');
  await expect(page.locator('[data-note-embed="missing"]')).toContainText('来源第一段');
  await expect(page.locator('[data-note-embed="cyclic"]')).toContainText('循环引用');
  await page.locator('[data-note-embed="cyclic"]').getByRole('button', { name: '修改引用范围', exact: true }).click();
  const dialog = page.getByTestId('research-note-embed-picker');
  await expect(dialog.getByLabel('选择内容 6', { exact: true })).toBeChecked();
  await dialog.getByLabel('选择内容 6', { exact: true }).uncheck();
  await dialog.getByLabel('选择内容 1', { exact: true }).check();
  await dialog.getByRole('button', { name: '保存引用范围', exact: true }).click();
  await expect(page.locator('[data-note-embed="cyclic"]')).toContainText('来源第一段');
  await expect(page.locator('[data-note-embed="cyclic"]')).not.toContainText('循环引用');
  expect(errors).toEqual([]);
});

test('renders source images in place and exposes an embedding note in the source backlinks', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: '来源笔记 B', exact: true }).click();
  await page.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '图片', exact: true }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAYAAACbU/80AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie2WsQ0AAAjC+JqfeLKe4dKB3QSEpoNPxQOqBTOE+IZYRLWK5xjhHCOQVCSbUMpLDg7V2l2IkGDTEwAAAABJRU5ErkJggg==', 'base64');
  await page.getByLabel('选择图片文件', { exact: true }).setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.research-media-block img')).toBeVisible();
  await page.getByRole('button', { name: '引用笔记 A', exact: true }).click();
  const dialog = await picker(page);
  await dialog.getByRole('option', { name: /来源笔记 B/ }).click();
  await expect(dialog.locator('.research-note-embed-choices img')).toBeVisible();
  await dialog.getByLabel('选择内容 6', { exact: true }).check();
  await dialog.getByRole('button', { name: '插入引用', exact: true }).click();
  await expect(page.locator('[data-note-embed] img')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-note-embed] img')).toBeVisible();
  await page.getByRole('button', { name: '来源笔记 B', exact: true }).click();
  const tab = page.getByRole('tab', { name: '反向链接', exact: true });
  if (!await tab.isVisible()) await runNotebookAction(page.getByTestId('research-notebook'), '展开文章大纲');
  await tab.click();
  await expect(page.locator('.research-note-outline')).toContainText('引用笔记 A');
});

test('rejects selecting the tab group that contains the pending insertion', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: '来源笔记 B', exact: true }).click();
  await page.locator('[data-block-id="b-tabs"]').getByRole('button', { name: '在标签页中插入', exact: true }).click();
  await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '引用笔记内容', exact: true }).click();
  const dialog = page.getByTestId('research-note-embed-picker');
  await dialog.getByRole('option', { name: '来源笔记 B', exact: true }).click();
  await expect(dialog.getByLabel('选择内容 4', { exact: true })).toBeDisabled();
  await dialog.getByLabel('选择内容 1', { exact: true }).check();
  await dialog.getByRole('button', { name: '插入引用', exact: true }).click();
  await expect(page.locator('[data-block-id="b-tabs"] [data-note-embed]')).toContainText('来源第一段');
  await expect(page.locator('[data-block-id="b-tabs"] [data-note-embed]')).not.toContainText('循环引用');
});

test('renders selectable source content like the note page, including math, tables and nested tabs', async ({ page }, testInfo) => {
  await seed(page);
  await page.evaluate(() => {
    const key = 'mewiki:research-notebook';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.notes.find((note: { id: string }) => note.id === 'note-b').blocks = [
      { id: 'render-heading', type: 'heading', level: 2, text: '来源中的完整章节' },
      { id: 'render-paragraph', type: 'paragraph', text: '这是**加粗说明**，行内公式为 $x_i^2$。' },
      { id: 'render-formula', type: 'formula', tex: '\\frac{a+b}{c}', caption: '公式的原始说明' },
      { id: 'render-table', type: 'markdown', kind: 'table', text: '| 参数 | 数值 |\n| --- | --- |\n| $x$ | 42 |' },
      { id: 'render-callout', type: 'callout', title: '来源中的提示', text: '保留原来的提示内容', tone: 'info' },
      { id: 'render-tabs', type: 'examples', title: '分组材料', tabs: [
        { id: 'render-tab-one', title: '文字材料', blocks: [{ id: 'render-nested-text', type: 'paragraph', text: '嵌套的正文内容' }] },
        { id: 'render-tab-two', title: '公式材料', blocks: [{ id: 'render-nested-formula', type: 'formula', tex: 'E=mc^2', caption: '第二标签中的公式' }] },
      ] },
    ];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  const dialog = await picker(page);
  await dialog.getByRole('option', { name: /来源笔记 B/ }).click();
  const content = dialog.getByRole('group', { name: '来源内容', exact: true });
  await expect(content.getByRole('heading', { name: /来源中的完整章节$/ })).toBeVisible();
  await expect(content.locator('strong').filter({ hasText: /^加粗说明$/ })).toBeVisible();
  await expect(content.locator('[data-selection-block-id="render-paragraph"] .katex')).toBeVisible();
  await expect(content.locator('[data-selection-block-id="render-formula"] .katex')).toBeVisible();
  await expect(content.getByRole('table').getByRole('cell', { name: '42', exact: true })).toBeVisible();
  await expect(content.getByText('保留原来的提示内容', { exact: true })).toBeVisible();
  await expect(content.locator('textarea')).toHaveCount(0);
  await expect(content.getByRole('button', { name: '编辑公式', exact: true })).toHaveCount(0);
  await dialog.getByLabel('选择内容 2', { exact: true }).check();
  await content.getByRole('tab', { name: '公式材料', exact: true }).click();
  await expect(content.getByText('第二标签中的公式', { exact: true })).toBeVisible();
  await dialog.getByLabel('选择内容 8', { exact: true }).check();
  await content.getByRole('tab', { name: '文字材料', exact: true }).click();
  await expect(content.getByText('嵌套的正文内容', { exact: true })).toBeVisible();
  await dialog.getByLabel('选择内容 6', { exact: true }).check();
  await expect(dialog.getByLabel('选择内容 7', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('选择内容 7', { exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('embed-picker-rendered-source.png') });
  await dialog.getByRole('button', { name: '插入引用', exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'note-a'));
  expect(stored.blocks.find((block: { type: string }) => block.type === 'noteEmbed').blockIds).toEqual(['render-paragraph', 'render-tabs']);
});

test('keeps a wide classification area, outer spacing and a single action bar on laptop and phone screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 945, height: 593 });
  await seed(page);
  await page.evaluate(() => {
    const key = 'mewiki:research-notebook';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.notes[0].tags = ['策略/控制/输入'];
    state.notes[1].tags = ['模型/控制/零阶保持'];
    state.notes[2].tags = ['模型/调度/队列/负载'];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  const dialog = await picker(page);
  await expect(dialog.locator('.device-record-modal-header')).toHaveCount(0);
  const toolbar = dialog.getByRole('toolbar', { name: '引用内容操作', exact: true });
  await expect(toolbar.getByLabel('搜索来源笔记', { exact: true })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '插入引用', exact: true })).toBeVisible();
  await dialog.getByRole('option', { name: /来源笔记 B/ }).click();
  const laptop = await dialog.evaluate(element => {
    const content = element.querySelector('.device-record-modal-content')!;
    const notes = element.querySelector('.research-note-embed-notes')!;
    const reading = element.querySelector('.research-note-embed-choices')!;
    const contentStyle = getComputedStyle(content);
    return { padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(key => parseFloat(contentStyle[key as keyof CSSStyleDeclaration] as string)), notesWidth: notes.getBoundingClientRect().width, readingWidth: reading.getBoundingClientRect().width, separatingBorder: getComputedStyle(notes).borderRightWidth, overflow: element.scrollWidth > element.clientWidth };
  });
  expect(laptop.padding.every(value => value >= 12)).toBe(true);
  expect(laptop.notesWidth).toBeGreaterThanOrEqual(300);
  expect(laptop.readingWidth).toBeGreaterThan(350);
  expect(laptop.separatingBorder).toBe('0px');
  expect(laptop.overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('embed-picker-laptop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toolbar.getByRole('button', { name: '插入引用', exact: true })).toBeVisible();
  const phone = await dialog.evaluate(element => {
    const search = element.querySelector<HTMLInputElement>('input[aria-label="搜索来源笔记"]')!.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('.research-note-embed-picker-toolbar > button')].map(button => button.getBoundingClientRect());
    const content = element.querySelector('.device-record-modal-content')!;
    return { overflow: element.scrollWidth > element.clientWidth, topPadding: parseFloat(getComputedStyle(content).paddingTop), buttonOffsets: buttons.map(button => Math.abs((button.top + button.bottom - search.top - search.bottom) / 2)), height: element.getBoundingClientRect().height, viewport: innerHeight };
  });
  expect(phone.overflow).toBe(false);
  expect(phone.topPadding).toBeGreaterThanOrEqual(10);
  expect(phone.buttonOffsets).toHaveLength(2);
  expect(phone.buttonOffsets.every(value => value < 2)).toBe(true);
  expect(phone.height).toBeLessThan(phone.viewport);
  await page.screenshot({ path: testInfo.outputPath('embed-picker-phone.png') });
  await toolbar.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
