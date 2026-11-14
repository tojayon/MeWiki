import { expect, test, type Locator, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';

async function openLongNote(page: Page, kind: 'paragraphs' | 'list' | 'formulas' | 'formula paragraphs') {
  const state = createNotebookFixture();
  const sentence = '在原有位置继续编辑这一段记录，页面中的其他文字也应该保持原来的位置。';
  const rows = Array.from({ length: 50 }, (_, index) => `**记录 ${index + 1}**：${kind.includes('formula') ? `${sentence}采样 $x_i$ 与 $y_j$，周期 $T_s$。`.repeat(4) : sentence}`);
  state.notes = [{ ...createResearchNote('正文点击位置检查'), id: 'click-note', blocks: kind.includes('paragraphs')
    ? rows.map((text, index) => ({ id: `click-row-${index}`, type: 'paragraph' as const, text }))
    : [{ id: 'click-list', type: 'markdown' as const, kind: 'orderedList' as const, text: rows.map((row, index) => `${index + 1}. ${row}`).join('\n') }],
  }];
  state.activeNoteId = 'click-note'; state.open = true; state.view = 'notes';
  await page.addInitScript(value => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(value));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'true');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '默认资料库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto('/'); await page.evaluate(() => document.fonts.ready);
}

async function geometry(target: Locator) {
  return target.evaluate(element => {
    const block = element.closest<HTMLElement>('[data-block-id]')!, scroll = element.closest<HTMLElement>('.research-note-scroll')!;
    return { y: element.getBoundingClientRect().y, height: block.getBoundingClientRect().height, scroll: scroll.scrollTop, documentHeight: scroll.scrollHeight,
      markers: [...scroll.querySelectorAll('strong')].map(marker => ({ text: marker.textContent, y: marker.getBoundingClientRect().y })) };
  });
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => { let frames = 0; const next = () => ++frames < 8 ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }));
}

function expectStable(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  expect(Math.abs(after.scroll - before.scroll)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(.1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(.1);
  expect(after.documentHeight).toBe(before.documentHeight);
  expect(after.markers.map(marker => marker.text)).toEqual(before.markers.map(marker => marker.text));
  for (let index = 0; index < before.markers.length; index++) expect(Math.abs(after.markers[index].y - before.markers[index].y)).toBeLessThanOrEqual(.1);
}

for (const width of [1440, 390]) for (const kind of ['paragraphs', 'list', 'formulas', 'formula paragraphs'] as const) {
  test(`keeps the viewport when clicking ordinary ${kind} text at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 }); await openLongNote(page, kind);
    const target = kind.includes('paragraphs') ? page.locator('[data-block-id="click-row-20"] strong') : page.locator('[data-block-id="click-list"] li').nth(20).locator('strong');
    await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const before = await geometry(target), box = (await target.boundingBox())!;
    await page.mouse.click(box.x + 8, box.y + box.height / 2); await settle(page);
    const after = await geometry(target);
    await info.attach('click-position.json', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
    expectStable(before, after);
    const editor = page.locator('[contenteditable="true"]'); await expect(editor).toBeFocused();
    expect(await editor.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.closest('strong')?.textContent)).toBe('记录 21');
    if (kind === 'formulas') await page.screenshot({ path: info.outputPath('clicked-long-formulas.png') });
    await editor.press('Escape'); await settle(page); expectStable(before, await geometry(target));
  });
}

for (const width of [1440, 390]) for (const kind of ['formula paragraphs', 'formulas'] as const) {
  test(`keeps later text and repeated clicks in ${kind} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); await openLongNote(page, kind);
    for (const index of [20, 21, 20, 49]) {
      const row = kind === 'formula paragraphs' ? page.locator(`[data-block-id="click-row-${index}"] .research-editable-text`) : page.locator('[data-block-id="click-list"] li').nth(index);
      await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
      const marker = row.locator('strong'), before = await geometry(marker);
      const point = await row.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node: Node | null = null;
        while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('.katex, button, strong') && walker.currentNode.textContent!.length > 12) node = walker.currentNode;
        if (!node) throw new Error('No editable body text found');
        const range = document.createRange(); range.setStart(node, 5); range.setEnd(node, 6);
        const rect = range.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        if (!element.contains(document.elementFromPoint(x, y))) throw new Error('The clicked text must be visible and unobscured');
        return { x, y, text: node.textContent };
      });
      await page.mouse.click(point.x, point.y); await settle(page);
      expectStable(before, await geometry(marker));
      const editor = page.locator('[contenteditable="true"]'); await expect(editor).toBeFocused();
      expect(await editor.evaluate((element, text) => {
        const selection = document.getSelection();
        return !!selection?.anchorNode && element.contains(selection.anchorNode) && selection.anchorNode.textContent === text && [5, 6].includes(selection.anchorOffset);
      }, point.text)).toBe(true);
    }
  });
}
