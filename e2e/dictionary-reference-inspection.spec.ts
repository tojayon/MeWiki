import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';
import { defaultCalloutAppearance } from '../src/domain/researchCallout.ts';

async function openInspectionNote(page: Page) {
  const state = createNotebookFixture();
  state.symbols = [createSymbolEntry({ name: '观测状态', notation: 'x_{[x2]}', meaning: '每个样本的观测状态。', slots: [{ key: 'x2', label: '下标', defaultValue: 'n', description: '样本编号' }] }, 'inspect-symbol')];
  state.terms = [{ id: 'inspect-term', name: '均方误差', aliases: [], meaning: '误差平方的均值。' }];
  const text = '查看 **定义**：[均方误差](mewiki-term:inspect-term) 和 [$x_i$](mewiki-symbol:inspect-symbol?x2=i)。';
  const note = { ...createResearchNote('词典引用查看'), id: 'inspect-note', blocks: [
    { id: 'inspect-paragraph', type: 'paragraph' as const, text },
    { id: 'inspect-heading', type: 'heading' as const, level: 2 as const, text },
    { id: 'inspect-list', type: 'list' as const, items: [text] },
    { id: 'inspect-callout', type: 'callout' as const, title: '提示', text, appearance: { ...defaultCalloutAppearance } },
    { id: 'inspect-table', type: 'paragraph' as const, text: `| 定义 |\n| --- |\n| ${text} |` },
    { id: 'inspect-tabs', type: 'examples' as const, tabs: [{ id: 'inspect-tab', title: '词典引用', blocks: [{ id: 'inspect-tab-body', type: 'paragraph' as const, text }] }] },
  ] };
  state.notes = [note]; state.activeNoteId = note.id; state.view = 'notes'; state.open = true;
  await page.addInitScript(value => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(value));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'true');
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '默认资料库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto('/');
}

for (const width of [1440, 390]) for (const kind of ['term', 'symbol'] as const) {
  test(`inspects a rendered ${kind} without activating any text editor at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await openInspectionNote(page);
    const blocks = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes[0].blocks);
    const dialog = page.getByRole('dialog', { name: kind === 'term' ? '术语解释' : '符号含义与推导来源', exact: true });
    for (const [index, id] of ['inspect-paragraph', 'inspect-heading', 'inspect-list', 'inspect-callout', 'inspect-table', 'inspect-tab-body'].entries()) {
      const block = page.locator(`[data-block-id="${id}"]`);
      const reference = block.getByRole('button', { name: kind === 'term' ? '术语：均方误差' : '符号：观测状态', exact: true });
      if (index % 3 === 0) await reference.click();
      else { await reference.focus(); await reference.press(index % 3 === 1 ? 'Enter' : 'Space'); }
      await expect(block.locator('[contenteditable="true"], textarea')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(kind === 'term' ? '误差平方的均值。' : '每个样本的观测状态。');
      if (kind === 'symbol') await expect(dialog.locator('.research-formula-symbol-instance annotation')).toHaveText('x_{i}');
      const meaning = dialog.locator(kind === 'term' ? '.research-term-popover-meaning' : '.research-formula-symbol-meaning');
      await meaning.click();
      await expect(dialog).toBeVisible();
      await expect(block.locator('[contenteditable="true"], textarea')).toHaveCount(0);
      await meaning.dblclick({ position: { x: 12, y: 8 } });
      await expect.poll(() => page.evaluate(() => document.getSelection()?.toString().trim().length ?? 0)).toBeGreaterThan(0);
      await expect(dialog).toBeVisible();
      await expect(block.locator('[contenteditable="true"], textarea')).toHaveCount(0);
      await dialog.locator(kind === 'term' ? '.research-term-popover-atom h4' : '.research-formula-symbol-instance').first().click();
      await expect(dialog).toBeVisible();
      await expect(block.locator('[contenteditable="true"], textarea')).toHaveCount(0);
      await expect(block.locator('strong').first()).toHaveText('定义');
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (index === 0) await page.screenshot({ path: info.outputPath(`rendered-${kind}-details.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(reference).toBeFocused();
      await expect(block.locator('[contenteditable="true"], textarea')).toHaveCount(0);
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes[0].blocks)).toEqual(blocks);
    const paragraph = page.locator('[data-block-id="inspect-paragraph"]');
    await paragraph.locator('strong').click();
    const editor = paragraph.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.locator(`[data-reference-kind="${kind}"]`).click();
    await expect(dialog).toBeVisible();
    await expect(editor.locator('strong')).toHaveText('定义');
    await page.keyboard.press('Escape');
    await editor.locator(`[data-reference-kind="${kind}"]`).press('F2');
    await expect(page.getByRole('dialog', { name: '编辑引用', exact: true })).toBeVisible();
  });
}
