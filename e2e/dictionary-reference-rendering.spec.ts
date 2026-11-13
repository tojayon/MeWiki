import { expect, test, type Locator, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';
import { enableNotebookEditing } from './helpers/researchNotebook.ts';

async function referenceStyles(container: Locator) {
  return container.locator('.research-dictionary-term-reference, .research-dictionary-symbol-reference').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    const parent = getComputedStyle(element.parentElement!);
    return {
      display: style.display,
      margin: style.margin,
      padding: style.padding,
      border: style.borderWidth,
      background: style.backgroundColor,
      decoration: style.textDecorationLine,
      verticalAlign: style.verticalAlign,
      inheritsText: ['color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight'].every(property => style[property as keyof CSSStyleDeclaration] === parent[property as keyof CSSStyleDeclaration]),
    };
  }));
}

async function seed(page: Page) {
  const state = createNotebookFixture();
  state.symbols = [createSymbolEntry({ name: '样本状态', notation: 'q', meaning: '样本的当前状态。', slots: [] }, 'render-symbol')];
  state.terms = [{ id: 'render-term', name: '轨道面', aliases: [], meaning: '描述轨道方向的几何平面。', atoms: [
    { id: 'render-orbit', text: '轨道', meaning: '天体运行的路径。' },
    { id: 'render-plane', text: '面', meaning: '承载轨道的几何平面。' },
  ] }];
  const source = createResearchNote('词典引用来源');
  source.id = 'render-source';
  source.blocks = [{ id: 'render-list', type: 'list', items: ['使用[轨道面](mewiki-term:render-term)描述[$q$](mewiki-symbol:render-symbol)。'] }];
  const owner = createResearchNote('引用样式对照');
  owner.id = 'render-owner';
  owner.blocks = [
    { id: 'render-link', type: 'paragraph', text: '[词典引用来源](#research-note/render-source)' },
    { id: 'render-embed', type: 'noteEmbed', sourceNoteId: source.id, sourceTitle: source.title, blockIds: ['render-list'] },
  ];
  state.notes = [source, owner];
  state.activeNoteId = source.id;
  state.librarySelections = { research: source.id };
  state.view = 'notes';
  state.open = true;
  await page.addInitScript(value => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(value));
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '默认资料库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto('/');
  const panel = page.getByTestId('research-notebook');
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue(source.title);
  const direct = panel.locator('.research-notebook-editor [data-block-id="render-list"]');
  const baseline = await referenceStyles(direct);
  expect(baseline).toHaveLength(2);
  expect(baseline.every(style => style.border === '0px' && style.background === 'rgba(0, 0, 0, 0)' && style.decoration === 'none' && style.inheritsText)).toBe(true);
  await panel.locator('#research-notebook-sidebar').getByRole('button', { name: owner.title, exact: true }).click();
  await expect(panel.getByLabel('笔记标题', { exact: true })).toHaveValue(owner.title);
  return { panel, baseline };
}

for (const surface of ['linked reading pane', 'embedded content', 'content selection preview'] as const) {
  test(`keeps list dictionary references consistent with the original note in ${surface}`, async ({ page }, info) => {
    const { panel, baseline } = await seed(page);
    let list: Locator;
    if (surface === 'linked reading pane') {
      await panel.locator('[data-block-id="render-link"]').getByRole('link', { name: '词典引用来源', exact: true }).click();
      list = panel.locator('[data-reading-note-id="render-source"] [data-block-id="render-list"]');
    } else if (surface === 'embedded content') {
      list = panel.locator('[data-note-embed="render-embed"] [data-referenced-block-id="render-list"]');
    } else {
      await enableNotebookEditing(panel);
      await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
      await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '引用笔记内容', exact: true }).click();
      const picker = page.getByTestId('research-note-embed-picker');
      await picker.getByRole('option', { name: '词典引用来源', exact: true }).click();
      list = picker.locator('[data-selection-block-id="render-list"]');
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await page.mouse.move(0, 0);
      await expect(list).toBeVisible();
      await list.scrollIntoViewIfNeeded();
      await expect(list).toBeInViewport();
      await expect.poll(() => referenceStyles(list)).toEqual(baseline);
      await page.screenshot({ path: info.outputPath(`dictionary-references-${surface.replaceAll(' ', '-')}-${width}.png`) });
      const term = list.getByRole('button', { name: '术语：轨道面', exact: true });
      const symbol = list.getByRole('button', { name: '符号：样本状态', exact: true });
      await term.hover();
      await expect(term).toHaveCSS('text-decoration-line', 'underline');
      await expect(term).toHaveCSS('text-decoration-style', 'dotted');
      await symbol.hover();
      await expect(symbol).toHaveCSS('text-decoration-line', 'underline');
      await expect(symbol).toHaveCSS('text-decoration-style', 'dashed');
      await term.click();
      const explanation = page.getByRole('dialog', { name: '术语解释', exact: true });
      await expect(explanation).toBeVisible();
      await expect(explanation).toContainText('描述轨道方向的几何平面。');
      await expect(explanation).toContainText('天体运行的路径。');
      await page.keyboard.press('Escape');
      await expect(explanation).toHaveCount(0);
      await expect(term).toBeFocused();
      await expect(term).toHaveCSS('outline-style', 'auto');
      await expect(term).toHaveCSS('outline-offset', '0px');
      await term.press('Enter');
      await expect(explanation).toBeVisible();
      await page.keyboard.press('Escape');
      await term.evaluate(element => element.blur());
    }
  });
}
