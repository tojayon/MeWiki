import { expect, test, type Page } from '@playwright/test';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createAiSession } from '../src/ai/session.ts';
import { expectAiPanelInViewport, openAiWorkspace as openAi, setAiReferenceScope } from './helpers/ai.ts';
import { openSettingsSection } from './helpers/settings.ts';

async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'fixture-definition';
  state.notes.find(note => note.id === state.activeNoteId)!.blocks = [
    { id: 'floating-source', type: 'paragraph', text: '这段文字用于对照选区附近的 AI 修改。' },
    { id: 'floating-blank', type: 'paragraph', text: '保留原笔记中的其他内容。' },
  ];
  await page.addInitScript(({ state, english }) => {
    if (!sessionStorage.getItem('floating-seeded')) { localStorage.setItem('mewiki:research-notebook', JSON.stringify(state)); sessionStorage.setItem('floating-seeded', 'yes'); }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, english });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'floating', providers: [{ id: 'floating', name: '悬浮测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'floating-test', hasApiKey: false }] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  return page.getByTestId('mewiki-ai-workspace');
}
async function selectSource(page: Page) {
  const source = page.locator('[data-block-id="floating-source"] .research-read-text p');
  await source.click({ trial: true });
  const rect = await source.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
  await expect(page.getByRole('button', { name: '用 AI 处理选中文字', exact: true })).toBeVisible();
  return rect;
}

for (const english of [false, true]) test(`groups unified references in the composer and uses a centered footer handle in ${english ? 'English' : 'Chinese'}`, async ({ page }, info) => {
  await setup(page, english); const ai = await openAi(page, english);
  const scope = ai.locator('.mewiki-ai-reference-tag[data-scope="library"]');
  await expect(ai.getByRole('combobox', { name: english ? 'Source scope' : '资料范围', exact: true })).toHaveCount(0);
  const add = ai.getByRole('button', { name: english ? 'Add external files' : '添加外部文件', exact: true });
  const input = ai.getByLabel(english ? 'Task instructions' : '任务要求', { exact: true });
  await input.fill('范围与底栏调整保留草稿'); await setAiReferenceScope(ai, 'library', english);
  for (const docked of [false, true]) {
    if (docked) await ai.getByRole('button', { name: english ? 'Dock to right sidebar' : '嵌入右侧栏', exact: true }).click();
    const scopeBox = (await scope.boundingBox())!, addBox = (await add.boundingBox())!, composer = (await ai.locator('.mewiki-ai-composer').boundingBox())!;
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(composer.y);
    expect(scopeBox.y).toBeGreaterThanOrEqual(composer.y);
    expect(scopeBox.x).toBeGreaterThanOrEqual(composer.x);
    expect(scopeBox.x + scopeBox.width).toBeLessThanOrEqual(composer.x + composer.width);
    expect(scopeBox.y + scopeBox.height).toBeLessThanOrEqual((await input.boundingBox())!.y);
    const handle = ai.getByRole('button', { name: english ? 'Collapse footer navigation' : '收起底部导航栏', exact: true });
    await expect(handle).toHaveClass('mewiki-ai-footer-handle');
    const handleBox = (await handle.boundingBox())!, footer = (await ai.locator('.mewiki-ai-session-bar').boundingBox())!;
    expect(handleBox.x + handleBox.width / 2).toBeCloseTo(footer.x + footer.width / 2, 0);
    expect(handleBox.y).toBeGreaterThanOrEqual(composer.y + composer.height);
    expect(handleBox.y + handleBox.height).toBeLessThanOrEqual(footer.y);
    expect(handleBox.height).toBeLessThanOrEqual(16);
    await handle.press('Enter');
    const expand = ai.getByRole('button', { name: english ? 'Expand footer navigation' : '展开底部导航栏', exact: true });
    await expect(expand).toBeFocused(); await expect(ai.locator('.mewiki-ai-session-bar')).toBeHidden();
    expect(await expand.evaluate(element => !!element.closest('.mewiki-ai-composer'))).toBe(false);
    const collapsed = (await expand.boundingBox())!, form = (await ai.locator('.mewiki-ai-task-form').boundingBox())!;
    expect(form.y + form.height - collapsed.y - collapsed.height).toBeLessThanOrEqual(8);
    await expect(input).toHaveValue('范围与底栏调整保留草稿'); await expect(scope).toBeVisible();
    await expand.press('Enter'); await expect(handle).toBeFocused();
    await page.screenshot({ path: info.outputPath(`ai-context-controls-${english ? 'en' : 'zh'}-${docked ? 'docked' : 'floating'}.png`) });
  }
});

test('collapses only the footer and toggles the full chat from the edge capsule', async ({ page }, info) => {
  await setup(page); const ai = await openAi(page), entry = page.getByTestId('mewiki-ai-launcher');
  const input = ai.getByLabel('任务要求', { exact: true }); await input.fill('底栏隐藏后仍保留');
  const original = (await ai.boundingBox())!;
  const form = ai.locator('.mewiki-ai-task-form'), originalForm = (await form.boundingBox())!, originalFooter = (await ai.locator('.mewiki-ai-session-bar').boundingBox())!;
  const heading = ai.locator('.mewiki-ai-floating-move > span'); await expect(heading).toHaveText('觅维 智能助理');
  const headingBox = (await heading.boundingBox())!; expect(headingBox.x + headingBox.width / 2).toBeCloseTo(original.x + original.width / 2, 0);
  await expect(ai.getByRole('button', { name: '关闭AI 工作区', exact: true })).toHaveCount(0);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await expect(ai.getByRole('dialog', { name: '对话历史', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).press('Enter');
  await expect(ai.getByRole('dialog', { name: '对话历史', exact: true })).toHaveCount(0);
  await expect(input).toBeVisible(); await expect(input).toHaveValue('底栏隐藏后仍保留');
  await expect(ai.getByRole('button', { name: '对话历史', exact: true })).toBeHidden();
  await expect(ai.locator('.mewiki-ai-session-bar')).toBeHidden();
  expect((await form.boundingBox())!.height).toBeLessThanOrEqual(originalForm.height - originalFooter.height);
  const composer = (await ai.locator('.mewiki-ai-composer').boundingBox())!, compactForm = (await form.boundingBox())!;
  const expand = ai.locator('.mewiki-ai-footer-controls').getByRole('button', { name: '展开底部导航栏', exact: true });
  const expandBox = (await expand.boundingBox())!;
  expect(expandBox.y).toBeCloseTo(composer.y + composer.height, 0);
  expect(compactForm.y + compactForm.height - expandBox.y - expandBox.height).toBeLessThanOrEqual(8);
  await expect(expand).toBeVisible(); await expect(expand).toBeFocused();
  const collapsed = (await ai.boundingBox())!; expect(collapsed.height).toBe(original.height);
  await page.screenshot({ path: info.outputPath('ai-footer-collapsed.png') });
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click();
  await expect(ai.getByRole('button', { name: '收起底部导航栏', exact: true })).toBeFocused();
  expect((await form.boundingBox())!.height).toBe(originalForm.height);
  await expect(ai.getByRole('button', { name: '对话历史', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  await entry.click(); await expect(ai).toHaveCount(0); await expect(entry).toHaveAttribute('aria-expanded', 'false');
  await entry.click(); await expect(input).toHaveValue('底栏隐藏后仍保留');
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click(); await expect(ai.getByRole('button', { name: '对话历史', exact: true })).toBeVisible();
});

test('docks a white capsule half outside either window edge while keeping its avatar usable', async ({ page }, info) => {
  await setup(page); const entry = page.getByTestId('mewiki-ai-launcher'); await expect(entry).toBeVisible();
  for (const edge of ['right', 'left'] as const) {
    await entry.press(edge === 'left' ? 'ArrowLeft' : 'ArrowRight');
    const rect = (await entry.boundingBox())!, size = page.viewportSize()!;
    expect(rect.width).toBe(62); expect(rect.height).toBe(56);
    expect(edge === 'left' ? rect.x : rect.x + rect.width).toBe(edge === 'left' ? 0 : size.width);
    const capsule = await entry.evaluate(element => { const css = getComputedStyle(element, '::before'); return { width: Number.parseFloat(css.width), height: Number.parseFloat(css.height), background: css.backgroundColor, radius: Number.parseFloat(css.borderRadius), shadow: css.boxShadow }; });
    expect(capsule.background).toBe('rgb(255, 255, 255)'); expect(capsule.width).toBe(rect.width * 2); expect(capsule.height).toBe(rect.height); expect(capsule.radius).toBeGreaterThanOrEqual(28); expect(capsule.shadow).not.toBe('none');
    const avatar = (await entry.locator('img').boundingBox())!; expect(avatar.x).toBeGreaterThanOrEqual(0); expect(avatar.x + avatar.width).toBeLessThanOrEqual(size.width);
    const ink = await entry.locator('img').evaluate(async element => {
      const img = element as HTMLImageElement; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 400;
      const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0, 400, 400);
      const pixels = context.getImageData(0, 0, 400, 400).data;
      let left = 400, top = 400, right = 0, bottom = 0;
      for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) if (pixels[(y * 400 + x) * 4 + 3] > 127) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      return { left: left / 10, top: top / 10, right: right / 10, bottom: bottom / 10 };
    });
    const insets = [avatar.x + ink.left - rect.x, avatar.y + ink.top - rect.y, rect.x + rect.width - avatar.x - ink.right, rect.y + rect.height - avatar.y - ink.bottom];
    expect(Math.max(...insets) - Math.min(...insets)).toBeLessThanOrEqual(1);
    await entry.click(); await expect(page.getByTestId('mewiki-ai-workspace')).toBeVisible(); await entry.click(); await expect(page.getByTestId('mewiki-ai-workspace')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ai-capsule-${edge}.png`) });
  }
});

test('uses a compact title, footer-only collapse and invisible resizing edges on every side', async ({ page }) => {
  await setup(page); const ai = await openAi(page), toolbar = ai.locator('.mewiki-ai-floating-toolbar');
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(28);
  const history = (await ai.locator('.mewiki-ai-history').boundingBox())!;
  expect(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('[data-ai-resize-edge]'), { x: history.x + history.width - 2, y: history.y + 30 })).toBe(true);
  await expect(ai.locator('.mewiki-ai-floating-grip')).toHaveCount(0);
  await expect(ai.locator('.mewiki-ai-floating-resize svg')).toHaveCount(0);
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  for (let index = 0; index < 6; index++) await move.press('Shift+ArrowLeft');
  for (const edge of ['w', 'n', 'e', 's'] as const) {
    const before = (await ai.boundingBox())!, grip = ai.locator(`[data-ai-resize-edge="${edge}"]`), box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (edge === 'w' ? -40 : edge === 'e' ? 40 : 0), box.y + box.height / 2 + (edge === 'n' ? -30 : edge === 's' ? 30 : 0), { steps: 6 }); await page.mouse.up();
    const after = (await ai.boundingBox())!;
    if (edge === 'w' || edge === 'e') expect(after.width).toBeGreaterThan(before.width + 35); else expect(after.height).toBeGreaterThan(before.height + 25);
    if (edge === 'w') expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);
    if (edge === 'n') expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
  }
  const fullHeight = (await ai.boundingBox())!.height;
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  expect((await ai.boundingBox())!.height).toBe(fullHeight);
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click();
});

test('keeps an edge entry available after closing or collapsing navigation and returns from settings', async ({ page }, info) => {
  const ai = await setup(page), entry = page.getByTestId('mewiki-ai-launcher');
  await expect(entry).toBeVisible(); await expect(entry).toHaveAccessibleName('AI 工作区');
  await page.getByRole('button', { name: '收起笔记左侧面板', exact: true }).click();
  await expect(entry).toBeInViewport(); await entry.click();
  await ai.getByLabel('任务要求', { exact: true }).fill('从气泡继续的草稿');
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeVisible();
  await entry.click(); await expect(ai).toHaveCount(0); await entry.click(); await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('从气泡继续的草稿');
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeFocused();
  await page.getByTestId('mewiki-ai-launcher').click();
  await expect(ai).toHaveCount(0); await expect(entry).toBeVisible(); await expect(entry).toBeFocused();
  await openSettingsSection(page, 'general'); await expect(entry).toBeVisible(); await entry.click();
  await expect(page.getByTestId('mewiki-settings-page')).toBeHidden();
  await expect(ai).toBeVisible(); await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('从气泡继续的草稿');
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('ai-light-launcher-desktop.png') });
});

test('drags the entry without opening chat and restores its edge after reload and viewport changes', async ({ page }) => {
  const ai = await setup(page), entry = page.getByTestId('mewiki-ai-launcher'); await expect(entry).toBeVisible();
  const grip = (await entry.boundingBox())!;
  await page.mouse.move(grip.x + 22, grip.y + 22); await page.mouse.down();
  await page.mouse.move(30, 260, { steps: 15 }); await expect(ai).toHaveCount(0);
  await page.mouse.up(); await expect(ai).toHaveCount(0);
  await expect.poll(async () => (await entry.boundingBox())!.x).toBe(0);
  await page.reload(); await expect(entry).toBeVisible(); expect((await entry.boundingBox())!.x).toBe(0);
  await page.setViewportSize({ width: 390, height: 230 }); await expect(entry).toBeInViewport();
  await entry.press('ArrowRight'); await expect.poll(async () => { const rect = (await entry.boundingBox())!; return rect.x + rect.width; }).toBe(390);
  await entry.press('Shift+ArrowUp'); await entry.press('Enter'); await expect(ai).toBeVisible();
});

test('moves a chat panel immediately while committing its position only after the drag ends', async ({ page }) => {
  await setup(page); const ai = await openAi(page), key = 'mewiki:library:default:ai-floating-panel:v1';
  await ai.getByLabel('任务要求', { exact: true }).fill('移动时仍保留正文');
  const before = await page.evaluate(key => localStorage.getItem(key), key);
  const grip = (await ai.getByRole('button', { name: '移动AI 面板', exact: true }).boundingBox())!;
  const initial = (await ai.boundingBox())!;
  await page.mouse.move(grip.x + 30, grip.y + 20); await page.mouse.down();
  await page.mouse.move(grip.x - 210, grip.y + 70, { steps: 12 });
  expect((await ai.boundingBox())!.x).toBeLessThan(initial.x - 200);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(before);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).not.toBe(before);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('移动时仍保留正文');
});

test('cancels captured movement on a viewport change without saving the temporary position', async ({ page }) => {
  await setup(page); const ai = await openAi(page), entry = page.getByTestId('mewiki-ai-launcher');
  const panelKey = 'mewiki:library:default:ai-floating-panel:v1', entryKey = 'mewiki:library:default:ai-launcher:v1';
  const panelBefore = await page.evaluate(key => localStorage.getItem(key), panelKey);
  const entryBefore = await page.evaluate(key => localStorage.getItem(key), entryKey);
  const grip = (await ai.getByRole('button', { name: '移动AI 面板', exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + 25, grip.y + 20); await page.mouse.down(); await page.mouse.move(grip.x - 180, grip.y + 45);
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(ai).toHaveAttribute('data-interacting', 'false'); await page.mouse.up();
  expect(await page.evaluate(key => localStorage.getItem(key), panelKey)).toBe(panelBefore);
  await page.getByTestId('mewiki-ai-launcher').click();
  const bubble = (await entry.boundingBox())!;
  await page.mouse.move(bubble.x + 22, bubble.y + 22); await page.mouse.down(); await page.mouse.move(100, 200);
  await page.setViewportSize({ width: 390, height: 620 });
  await expect(entry).not.toHaveAttribute('data-dragging', 'true'); await page.mouse.up();
  await expect(ai).toHaveCount(0); expect(await page.evaluate(key => localStorage.getItem(key), entryKey)).toBe(entryBefore);
  await entry.click(); await expect(ai).toBeVisible(); await expect(ai.getByLabel('任务要求', { exact: true })).toBeFocused();
});

test('floats without resizing the document and stays open after editing or clicking outside', async ({ page }, info) => {
  const ai = await setup(page);
  const before = (await page.locator('.research-reading-rail').boundingBox())!;
  await openAi(page);
  expect(await ai.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  expect((await page.locator('.research-reading-rail').boundingBox())!.width).toBe(before.width);
  await expect(page.locator('#research-note-outline').getByRole('tab', { name: '智能助理', exact: true })).toHaveCount(0);
  await ai.getByLabel('任务要求', { exact: true }).fill('保留悬浮草稿');
  await page.locator('.research-note-scroll').first().click({ position: { x: 15, y: 160 } });
  await expect(ai).toBeVisible(); await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留悬浮草稿');
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  await page.getByLabel('笔记标题', { exact: true }).fill('悬浮时仍可编辑');
  await expect(ai).toBeVisible();
  await page.screenshot({ path: info.outputPath('ai-floating-desktop.png') });
});

test('drags, resizes and restores a bounded position without losing a draft', async ({ page }) => {
  await setup(page); const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('移动时保留');
  const before = (await ai.boundingBox())!;
  const handle = ai.getByRole('button', { name: '移动AI 面板', exact: true }); const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + 35, grip.y + grip.height / 2); await page.mouse.down(); await page.mouse.move(grip.x - 245, grip.y + 85, { steps: 12 }); await page.mouse.up();
  const moved = (await ai.boundingBox())!; expect(moved.x).toBeLessThan(before.x - 200); expect(moved.y).toBeGreaterThan(before.y + 50);
  const resize = ai.getByRole('button', { name: '调整AI 面板大小', exact: true }); const corner = (await resize.boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down(); await page.mouse.move(corner.x + 90, corner.y + 40, { steps: 10 }); await page.mouse.up();
  const resized = (await ai.boundingBox())!; expect(resized.width).toBeGreaterThan(moved.width + 60); expect(resized.height).toBeGreaterThan(moved.height + 15);
  await page.reload(); await expect(ai).toBeVisible();
  const restored = (await ai.boundingBox())!; expect(Math.abs(restored.x - resized.x)).toBeLessThan(2); expect(Math.abs(restored.width - resized.width)).toBeLessThan(2);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('移动时保留');
  await page.setViewportSize({ width: 390, height: 620 }); await expectAiPanelInViewport(page); const narrow = (await ai.boundingBox())!;
  expect(narrow.x).toBeGreaterThanOrEqual(0); expect(narrow.x + narrow.width).toBeLessThanOrEqual(390); expect(narrow.y + narrow.height).toBeLessThanOrEqual(620);
  await expect(page.getByTestId('mewiki-ai-launcher')).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect.poll(async () => Math.abs((await ai.boundingBox())!.width - resized.width)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await ai.boundingBox())!.height - resized.height)).toBeLessThan(2);
});

test('opens beside the source selection and repositions a panel with collapsed footer navigation', async ({ page }, info) => {
  await setup(page); const source = await selectSource(page); await page.keyboard.press('Alt+Enter');
  const ai = page.getByTestId('mewiki-ai-workspace'); await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toBeVisible();
  const frame = (await ai.boundingBox())!;
  const overlaps = Math.max(0, Math.min(frame.x + frame.width, source.x + source.width) - Math.max(frame.x, source.x)) * Math.max(0, Math.min(frame.y + frame.height, source.y + source.height) - Math.max(frame.y, source.y));
  expect(overlaps).toBe(0); await expect(ai.getByLabel('任务要求', { exact: true })).toBeFocused();
  await ai.getByLabel('任务要求', { exact: true }).fill('保留原输入');
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowDown');
  await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowDown');
  await selectSource(page); await page.getByRole('button', { name: '用 AI 处理选中文字', exact: true }).click();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留原输入');
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toBeVisible();
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('ai-floating-selection.png') });
});

test('keeps a task running while footer navigation is collapsed and restores it after closing with the capsule', async ({ page }) => {
  await setup(page); const ai = await openAi(page); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/mewiki/ai/chat', async route => { await pending; await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '收起期间已完成' }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' }).catch(() => {}); });
  await ai.getByLabel('任务要求', { exact: true }).fill('收起后继续');
  const sent = page.waitForRequest('**/api/mewiki/ai/chat'); await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await sent;
  await page.setViewportSize({ width: 390, height: 230 }); await expectAiPanelInViewport(page);
  const stop = ai.getByRole('button', { name: '停止任务', exact: true }); await expect(stop).toBeInViewport();
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  const stopBox = (await stop.boundingBox())!;
  const model = ai.getByRole('button', { name: '模型设置', exact: true }), scope = ai.locator('.mewiki-ai-reference-tag[data-implicit]');
  const modelBox = (await model.boundingBox())!, scopeBox = (await scope.boundingBox())!;
  expect(modelBox.width).toBeGreaterThanOrEqual(41); expect(scopeBox.y + scopeBox.height).toBeLessThanOrEqual(modelBox.y);
  const chevron = (await model.locator('svg').last().boundingBox())!;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('summary')?.getAttribute('aria-label'), { x: chevron.x + chevron.width / 2, y: chevron.y + chevron.height / 2 })).toBe('模型设置');
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: stopBox.x + stopBox.width / 2, y: stopBox.y + stopBox.height / 2 })).toBe('停止任务');
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click();
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click(); release();
  await expect(ai.getByLabel('任务要求', { exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click();
  await expect(ai.getByText('收起期间已完成', { exact: true })).toBeVisible();
  await page.getByTestId('mewiki-ai-launcher').click(); await expect(ai).toHaveCount(0);
  await openAi(page); await expect(ai.getByText('收起期间已完成', { exact: true })).toBeVisible();
});

for (const english of [false, true]) test(`moves and resizes flush to every edge behind the launcher in ${english ? 'narrow English' : 'desktop Chinese'}`, async ({ page }, info) => {
  if (english) await page.setViewportSize({ width: 390, height: 720 });
  await setup(page, english); const ai = await openAi(page, english), entry = page.getByTestId('mewiki-ai-launcher');
  const viewport = page.viewportSize()!, move = ai.locator('.mewiki-ai-floating-move');
  const drag = async (target: typeof move, x: number, y: number) => {
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up();
  };
  await drag(move, 1, 1);
  let frame = (await ai.boundingBox())!; expect(frame.x).toBe(0); expect(frame.y).toBe(0);
  await drag(move, viewport.width - 1, viewport.height - 1);
  frame = (await ai.boundingBox())!; expect(frame.x + frame.width).toBe(viewport.width); expect(frame.y + frame.height).toBe(viewport.height);
  await drag(ai.locator('[data-ai-resize-edge=n]'), viewport.width / 2, -20);
  await drag(ai.locator('[data-ai-resize-edge=w]'), -20, viewport.height / 2);
  frame = (await ai.boundingBox())!;
  expect(frame).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  const fullFrame = { ...frame };
  for (const edge of ['right', 'left'] as const) {
    await entry.press(edge === 'left' ? 'ArrowLeft' : 'ArrowRight');
    await expect(entry).toHaveAttribute('data-edge', edge);
    expect(await ai.boundingBox()).toEqual(fullFrame);
    const capsule = (await entry.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="mewiki-ai-launcher"]'), { x: capsule.x + capsule.width / 2, y: capsule.y + capsule.height / 2 })).toBe(true);
    await drag(entry, capsule.x + capsule.width / 2, capsule.y + capsule.height / 2 - 40);
    expect((await entry.boundingBox())!.y).toBeCloseTo(capsule.y - 40, 1);
    expect(await ai.boundingBox()).toEqual(fullFrame); await expect(entry).toHaveAttribute('aria-expanded', 'true');
    await entry.click(); await expect(ai).toHaveCount(0); await openAi(page, english);
    expect(await ai.boundingBox()).toEqual(fullFrame);
  }
  await page.reload(); await expect(ai).toBeVisible(); expect(await ai.boundingBox()).toEqual(fullFrame);
  await ai.getByLabel(english ? 'Task instructions' : '任务要求', { exact: true }).fill('贴边后保留草稿');
  await page.screenshot({ path: info.outputPath(`ai-flush-${english ? 'narrow-en' : 'desktop-zh'}.png`) });
});

test('supports keyboard movement and resize with reachable English controls on a narrow screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 720 }); await setup(page, true); const ai = await openAi(page, true);
  await expect(ai.locator('.mewiki-ai-floating-move > span')).toHaveText('MeWiki AI Assistant');
  await expectAiPanelInViewport(page); await expect(page.getByTestId('mewiki-ai-launcher')).toBeInViewport();
  const handle = ai.getByRole('button', { name: 'Move AI panel', exact: true }); await handle.focus();
  const before = (await ai.boundingBox())!; await handle.press('ArrowDown'); expect((await ai.boundingBox())!.y).toBeGreaterThan(before.y);
  const resize = ai.getByRole('button', { name: 'Resize AI panel', exact: true }); await resize.press('ArrowUp');
  await ai.getByRole('button', { name: 'Quick prompts', exact: true }).click();
  await expect(ai.getByRole('button', { name: 'Summarize note', exact: true })).toBeInViewport();
  await ai.getByRole('button', { name: 'Summarize note', exact: true }).press('Escape');
  await expect(ai).toBeVisible(); await ai.getByRole('button', { name: 'Quick prompts', exact: true }).press('Escape');
  await expect(ai).toBeVisible(); await expect(page.getByTestId('research-notebook')).toBeVisible();
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await ai.getByRole('button', { name: 'Collapse footer navigation', exact: true }).click();
  await expect(ai.locator('.mewiki-ai-session-bar')).toBeHidden();
  const expand = ai.locator('.mewiki-ai-footer-controls').getByRole('button', { name: 'Expand footer navigation', exact: true });
  await expect(expand).toBeInViewport(); await expect(expand).toBeFocused();
  const send = ai.getByRole('button', { name: 'Send message', exact: true }); await expect(send).toBeInViewport();
  const sendBox = (await send.boundingBox())!, expandBox = (await expand.boundingBox())!;
  expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(expandBox.y);
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expand.press('Enter'); await expect(ai.getByRole('button', { name: 'Collapse footer navigation', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('ai-floating-narrow-en.png') });
});

for (const hasTouch of [false, true]) test.describe(`selected context with ${hasTouch ? 'touch' : 'mouse'} controls`, () => {
test.use({ hasTouch });
test('keeps send, stop and window controls reachable in keyboard-height space with selected text', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 720 }); await setup(page);
  const session = { ...createAiSession('default'), sourceIds: ['fixture-definition'], history: [{ role: 'user' as const, content: '短窗原对话' }] };
  await page.evaluate(session => localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session)), session);
  await page.reload();
  await selectSource(page); await page.keyboard.press('Alt+Enter');
  const ai = page.getByTestId('mewiki-ai-workspace'); await ai.getByLabel('任务要求', { exact: true }).fill('润色所选文字');
  await page.setViewportSize({ width: 390, height: 230 });
  await expect(ai).toHaveAttribute('data-compact', 'true');
  // With the panel allowed behind the capsule, move the entry clear of the composer.
  const entry = page.getByTestId('mewiki-ai-launcher');
  for (let step = 0; step < 5; step++) await entry.press('Shift+ArrowUp');
  await expect(ai.getByRole('group', { name: '参考来源', exact: true })).toBeInViewport();
  const send = ai.getByRole('button', { name: '发送消息', exact: true }); await expect(send).toBeInViewport();
  const box = (await send.boundingBox())!;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe('发送消息');
  const input = ai.getByLabel('任务要求', { exact: true }); await expect(input).toBeInViewport();
  const inputBox = (await input.boundingBox())!;
  expect(inputBox.y + inputBox.height - box.y).toBeLessThanOrEqual(1);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: inputBox.x + inputBox.width / 2, y: inputBox.y + inputBox.height / 2 })).toBe('mewiki-ai-task-prompt');
  await expect(page.getByTestId('mewiki-ai-launcher')).toBeInViewport();
  await expect(ai.getByRole('button', { name: '复制对话', exact: true })).toBeInViewport();
  await ai.getByRole('button', { name: '快捷提问', exact: true }).click();
  await expect(ai.getByRole('button', { name: '润色选中文字', exact: true })).toBeInViewport();
  await ai.getByRole('button', { name: '润色选中文字', exact: true }).click();
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue(/润色/);
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  await expect(ai.locator('.mewiki-ai-session-bar')).toBeHidden();
  await expect(ai.locator('.mewiki-ai-footer-controls').getByRole('button', { name: '展开底部导航栏', exact: true })).toBeInViewport();
  await expect(send).toBeInViewport();
  await page.screenshot({ path: info.outputPath('ai-floating-keyboard-height.png') });
  await page.setViewportSize({ width: 390, height: 720 });
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '短窗原对话', exact: true }).click();
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toBeVisible();
  await input.focus(); await page.setViewportSize({ width: 390, height: 230 });
  await expect(input).toBeInViewport();
  const restoredInput = (await input.boundingBox())!;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: restoredInput.x + restoredInput.width / 2, y: restoredInput.y + restoredInput.height / 2 })).toBe('mewiki-ai-task-prompt');
});
});

test('yields to delete confirmation and restores the conversation on cancel', async ({ page }) => {
  await setup(page); const ai = await openAi(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('确认后继续的草稿');
  for (let index = 0; index < 10; index++) await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowLeft');
  await page.getByRole('button', { name: '切换为编辑模式', exact: true }).click();
  await page.getByRole('button', { name: '更多笔记功能', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除笔记', exact: true }).click();
  await expect(ai).toBeHidden();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(ai).toBeVisible(); await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('确认后继续的草稿');
});

test('keeps the full window bounded when moving toward the bottom with its footer collapsed', async ({ page }) => {
  await setup(page); const ai = await openAi(page);
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  const move = ai.getByRole('button', { name: '移动AI 面板', exact: true });
  for (let index = 0; index < 30; index++) await move.press('Shift+ArrowDown');
  expect((await ai.boundingBox())!.y).toBeGreaterThan(300);
  await expectAiPanelInViewport(page);
  await ai.getByRole('button', { name: '展开底部导航栏', exact: true }).click();
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport();
});

test('keeps separate floating positions and drafts for stable library identities', async ({ page }) => {
  await setup(page);
  const other = createNotebookFixture(); other.activeNoteId = 'fixture-summary'; other.view = 'notes'; other.open = true;
  await page.evaluate(state => { localStorage.setItem('mewiki:library:float-other:notebook', JSON.stringify(state)); }, other);
  await page.route('**/api/research-library/catalog', route => route.fulfill({ json: {
    libraries: [{ id: 'default', name: '默认资料库', directory: null }, { id: 'float-other', name: '浮窗隔离库', directory: null }], contextDefaults: { standalone: 'default' },
  } }));
  await page.route('**/api/research-library?library=float-other', route => route.fulfill({ json: { directory: null, file: null } }));
  const entry = page.getByTestId('mewiki-ai-launcher');
  await entry.press('ArrowLeft'); await entry.press('Shift+ArrowUp');
  const entryOriginal = (await entry.boundingBox())!;
  const ai = await openAi(page); await ai.getByLabel('任务要求', { exact: true }).fill('默认库的窗口草稿');
  for (let index = 0; index < 10; index++) await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowLeft');
  const original = (await ai.boundingBox())!;
  await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).click();
  await page.goto('/?library=float-other'); await openAi(page);
  await expect(ai.getByRole('button', { name: '收起底部导航栏', exact: true })).toBeVisible();
  expect((await entry.boundingBox())!.x).toBeGreaterThan(1300);
  expect((await ai.boundingBox())!.x).toBeGreaterThan(original.x + 200); await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
  await ai.getByRole('button', { name: '移动AI 面板', exact: true }).press('Shift+ArrowDown');
  await page.goto('/?library=default'); await expect(ai).toBeVisible();
  await expect.poll(async () => Math.abs((await entry.boundingBox())!.y - entryOriginal.y)).toBeLessThan(2);
  expect((await entry.boundingBox())!.x).toBe(0);
  expect(Math.abs((await ai.boundingBox())!.x - original.x)).toBeLessThan(2);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('默认库的窗口草稿');
  await expect(ai.getByRole('button', { name: '展开底部导航栏', exact: true })).toBeVisible();
});

test.describe('touchscreen floating panel', () => {
  test.use({ hasTouch: true });
  test('touch-drags the edge entry without opening chat or scrolling the note', async ({ page }) => {
    await setup(page); const entry = page.getByTestId('mewiki-ai-launcher'); await entry.click({ trial: true });
    const box = (await entry.boundingBox())!, scroll = page.locator('.research-note-scroll').first();
    const top = await scroll.evaluate(element => element.scrollTop), touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 22, y: box.y + 22, id: 0 }] });
    for (let step = 1; step <= 12; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 22 + (30 - box.x - 22) * step / 12, y: box.y + 22 + (280 - box.y - 22) * step / 12, id: 0 }] });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await entry.boundingBox())!.x).toBe(0);
    await expect(page.getByTestId('mewiki-ai-workspace')).toHaveCount(0);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(top);
    await touch.detach();
    await entry.tap(); const ai = page.getByTestId('mewiki-ai-workspace'); await expect(ai).toBeVisible();
    await page.setViewportSize({ width: 390, height: 230 }); await expectAiPanelInViewport(page);
    await ai.getByRole('button', { name: '收起底部导航栏', exact: true }).tap();
    await expect(ai.locator('.mewiki-ai-session-bar')).toBeHidden();
    const expand = ai.getByRole('button', { name: '展开底部导航栏', exact: true }); await expect(expand).toBeInViewport();
    const send = ai.getByRole('button', { name: '发送消息', exact: true }), sendBox = (await send.boundingBox())!, expandBox = (await expand.boundingBox())!;
    expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(expandBox.y);
    expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expand.tap(); await expect(ai.getByRole('button', { name: '收起底部导航栏', exact: true })).toBeInViewport();
  });
  test('moves with an actual touch drag without scrolling the note', async ({ page }) => {
    await setup(page); const ai = await openAi(page);
    const before = (await ai.boundingBox())!, handle = (await ai.getByRole('button', { name: '移动AI 面板', exact: true }).boundingBox())!;
    const scroll = page.locator('.research-note-scroll').first(), top = await scroll.evaluate(element => element.scrollTop);
    const touch = await page.context().newCDPSession(page);
    const x = handle.x + 80, y = handle.y + 20;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 240, y: y + 80, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await ai.boundingBox())!.x).toBeLessThan(before.x - 200);
    const moved = (await ai.boundingBox())!, right = (await ai.locator('[data-ai-resize-edge=e]').boundingBox())!;
    const resizeX = right.x + right.width / 2, resizeY = right.y + right.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: resizeX, y: resizeY, id: 2 }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: resizeX + 80 * step / 8, y: resizeY, id: 2 }] });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await ai.boundingBox())!.width).toBeGreaterThan(moved.width + 70);
    expect((await ai.boundingBox())!.x).toBeCloseTo(moved.x, 0);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(top);
    await touch.detach();
  });
});
