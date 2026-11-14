import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createResearchNote } from '../src/domain/researchNotebook.ts';
import { createSymbolEntry } from '../src/domain/researchDictionary.ts';

async function openLongNote(page: Page) {
  const state = createNotebookFixture();
  state.terms = [{ id: 'scroll-term', name: '示例术语', aliases: [], meaning: '用于滚动位置回归的虚构定义。' }];
  state.symbols = [createSymbolEntry({ name: '示例记号', notation: 'x_i', meaning: '用于滚动位置回归的虚构符号。', slots: [] }, 'scroll-symbol')];
  const text = Array.from({ length: 50 }, (_, i) => `${i + 1}. **记录 ${i + 1}**：查看[示例术语](mewiki-term:scroll-term)和[$x_i$](mewiki-symbol:scroll-symbol)，行内 $x_i$，继续填写本行记录。`).join('\n');
  state.notes = [{ ...createResearchNote('词典浮层滚动检查'), id: 'scroll-note', blocks: [
    { id: 'scroll-list', type: 'markdown', kind: 'orderedList', text },
    { id: 'scroll-next', type: 'paragraph', text: '**继续记录**：在此填写下一段。' },
    { id: 'scroll-tail', type: 'paragraph', text: '后续内容用于保留页面下方空间。'.repeat(40) },
  ] }];
  state.activeNoteId = 'scroll-note'; state.open = true; state.view = 'notes';
  await page.addInitScript(value => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(value));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
    localStorage.setItem('mewiki:research-notebook-sidebar-collapsed', 'true');
  }, state);
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '默认资料库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.goto('/');
}

for (const width of [1440, 390]) for (const session of ['rendered text', 'an active editor', 'reference editing']) for (const kind of ['term', 'symbol', 'inline'] as const) {
  if (session === 'reference editing' && kind === 'inline') continue;
  test(`keeps the clicked position after dismissing ${kind} details from ${session} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 }); await openLongNote(page);
    const block = page.locator('[data-block-id="scroll-list"]');
    const editor = block.locator('[contenteditable="true"]');
    const active = session !== 'rendered text';
    if (active) {
      await block.locator('strong').first().click(); await expect(editor).toBeFocused();
      await editor.evaluate(element => { (element as HTMLElement).dataset.inspectionSession = 'preserved'; });
    }
    const item = block.locator('li').nth(20);
    await item.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.evaluate(() => document.fonts.ready);
    const reference = item.getByRole('button', { name: kind === 'term' ? '术语：示例术语' : kind === 'symbol' ? '符号：示例记号' : '查看符号 示例记号', exact: true });
    if (session === 'reference editing') await reference.press('F2'); else await reference.click();
    const detail = page.getByRole('dialog', { name: session === 'reference editing' ? '编辑引用' : kind === 'term' ? '术语解释' : '符号含义与推导来源', exact: true });
    await expect(detail).toBeVisible();
    const targetIndex = await block.locator('li').evaluateAll(items => items.map((item, index) => {
      const target = item.querySelector('strong')!, rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + 6, rect.y + rect.height / 2);
      return { index, visible: index !== 20 && rect.y > 70 && rect.bottom < 900 && !!hit && target.contains(hit) };
    }).filter(item => item.visible).sort((a, b) => Math.abs(a.index - 20) - Math.abs(b.index - 20))[0]?.index ?? -1);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const target = block.locator('li').nth(targetIndex).locator('strong');
    const before = (await target.boundingBox())!;
    expect(before.y).toBeGreaterThan(70); expect(before.y + before.height).toBeLessThan(900);
    await page.mouse.click(before.x + 6, before.y + before.height / 2);
    await expect(detail).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after = (await target.boundingBox())!;
    await info.attach('clicked-position.json', { body: JSON.stringify({ before, after }), contentType: 'application/json' });
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await expect(editor).toBeFocused();
    if (active) await expect(editor).toHaveAttribute('data-inspection-session', 'preserved');
    expect(await editor.evaluate((element, expected) => {
      const anchor = document.getSelection()?.anchorNode;
      return !!anchor && element.contains(anchor) && anchor.parentElement?.closest('li')?.querySelector('strong')?.textContent === expected;
    }, `记录 ${targetIndex + 1}`)).toBe(true);
    if (active && session !== 'reference editing' && kind === 'term') await page.screenshot({ path: info.outputPath('continued-at-click.png') });
  });
}

for (const width of [1440, 390]) test(`saves the old editor and keeps the destination when clicking another block after inspection at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 }); await openLongNote(page);
  const list = page.locator('[data-block-id="scroll-list"]'), oldEditor = list.locator('[contenteditable="true"]');
  await list.locator('strong').first().click(); await oldEditor.press('Control+End');
  await page.keyboard.insertText('已填写');
  const target = page.locator('[data-block-id="scroll-next"] strong');
  await target.evaluate(element => {
    element.scrollIntoView({ block: 'end' });
    element.closest('.research-note-scroll')!.scrollTop += 32;
  });
  await list.locator('li').last().getByRole('button', { name: '术语：示例术语', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '术语解释', exact: true }); await expect(detail).toBeVisible();
  const before = (await target.boundingBox())!;
  expect(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + 6, rect.y + rect.height / 2));
  })).toBe(true);
  await page.mouse.click(before.x + 6, before.y + before.height / 2);
  await expect(detail).toHaveCount(0); await expect(oldEditor).toHaveCount(0);
  await expect(page.locator('[data-block-id="scroll-next"] [contenteditable="true"]')).toBeFocused();
  expect(Math.abs((await target.boundingBox())!.y - before.y)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes[0].blocks[0].text)).toContain('已填写');
});
