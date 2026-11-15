import { expect, test, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { researchPdfFixture } from './fixtures/researchPdf.ts';
import { expandAiProposalCards, expectAiPanelInViewport, openAiWorkspace } from './helpers/ai.ts';

async function setup(page: Page, english = false) {
  const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  await page.addInitScript(({ state, english }) => {
    if (!localStorage.getItem('mewiki:research-notebook')) localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN'); localStorage.setItem('mewiki:research-notebook-mode', 'edit');
  }, { state, english });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '辅助文件测试库', directory: null }], contextDefaults: {} } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'test', providers: [{ id: 'test', name: '测试服务', model: 'test', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', hasApiKey: true }] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: english ? 'AI workspace' : 'AI 工作区', exact: true }).first().click();
  const ai = page.getByTestId('mewiki-ai-workspace'); await expect(ai).toBeVisible(); return ai;
}
const textFile = (name = '参考.md', text = '材料结论：需要保留可追溯的引用。') => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
function docx(text: string) {
  return Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), 'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>第二段与表格内容</w:t></w:r></w:p></w:body></w:document>`) }));
}
function xlsx() {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="观测工作表" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>时间</t></is></c><c r="B1" t="inlineStr"><is><t>数值</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>7</v></c></row></sheetData></worksheet>'),
  }));
}

test('uses a local material through tools to propose, review, apply and undo a note edit', async ({ page }, info) => {
  const ai = await setup(page), before = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!));
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile());
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toBeVisible();
  await expect(ai.getByText('材料会随任务提供给所选 AI 服务。', { exact: true })).toBeVisible();
  let turn = 0, materialId = ''; const requests: unknown[] = [];
  await page.route('**/api/mewiki/ai/chat', route => {
    const request = route.request().postDataJSON(); requests.push(request);
    const call = (name: string, args: object) => ({ id: `call-${turn}`, name, arguments: JSON.stringify(args) });
    let tools;
    if (++turn === 1) { expect(JSON.stringify(request)).not.toContain('材料结论：'); tools = [call('list_materials', {})]; }
    else if (turn === 2) { materialId = JSON.parse(request.messages.at(-1).content)[0].id; tools = [call('read_material', { materialId }), call('read_note', { noteId: 'fixture-definition' })]; }
    else if (turn === 3) {
      expect(JSON.stringify(request)).toContain('材料结论：需要保留可追溯的引用。');
      tools = [call('propose_note', { operation: 'replace-text', noteId: 'fixture-definition', blockId: 'fixture-definition:text', content: '根据参考.md：需要保留可追溯的引用。' })];
    }
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: tools ? '' : '已依据参考.md准备修改。', ...(tools ? { toolCalls: tools } : {}) }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('依据辅助材料改写当前说明');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已依据参考.md准备修改。', { exact: true })).toBeVisible();
  await expandAiProposalCards(ai);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes)).toEqual(before.notes);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  await expect(page.getByTestId('mewiki-ai-review').getByText(/需要保留可追溯的引用/)).toBeVisible();
  await ai.screenshot({ path: info.outputPath('materials-chat.png') });
  await ai.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(ai.getByRole('button', { name: '撤回此修改', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks)).toEqual(before.notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks);
  expect(requests.length).toBe(4);
});

test('parses actual PDF, DOCX, CSV, TSV, XLSX and text files locally and previews their sections', async ({ page }, info) => {
  const ai = await setup(page); let modelRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/mewiki/ai/chat')) modelRequests++; });
  const inputs = [
    { file: { name: '文献.pdf', mimeType: 'application/pdf', buffer: researchPdfFixture() }, expected: 'Lunar', section: 'Page 1' },
    { file: { name: '草稿.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx('Word 参考正文') }, expected: 'Word 参考正文' },
    { file: textFile('数据.csv', '时间,数值\n1,3'), expected: '1,3' },
    { file: textFile('数据.tsv', '时间\t数值\n2\t4'), expected: '2,4' },
    { file: { name: '工作簿.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx() }, expected: '1,7' },
    { file: textFile('纯文.txt', '中文纯文本'), expected: '中文纯文本' },
  ];
  for (const { file, expected, section } of inputs) {
    await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(file);
    const trigger = ai.getByRole('button', { name: `查看材料：${file.name}`, exact: true }); await expect(trigger).toBeVisible();
    await trigger.click();
    const preview = page.getByTestId('mewiki-ai-material-preview').filter({ visible: true });
    await expect(preview.locator('pre')).toContainText(expected);
    if (section) { await expect(preview.getByRole('combobox', { name: '材料分段', exact: true })).toHaveValue('0'); await preview.getByRole('combobox').selectOption('1'); await expect(preview.locator('pre')).toContainText('Adoption'); }
    await preview.screenshot({ path: info.outputPath(`preview-${file.name.split('.').at(-1)}.png`) });
    await preview.press('Escape'); await expect(trigger).toBeFocused();
  }
  expect(modelRequests).toBe(0);
  await expect(ai.getByRole('button', { name: '添加外部文件', exact: true })).toBeDisabled();
});

test('retains files across refresh and conversations, removes future access and isolates libraries', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile());
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toBeVisible();
  await ai.getByLabel('任务要求', { exact: true }).fill('文件保留草稿'); await page.reload();
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toHaveCount(0);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新对话', exact: true }).and(ai.locator('button:not([aria-current])')).click();
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '移除材料：参考.md', exact: true }).click();
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:library:default:ai-session:v1')!));
  expect(stored.materials).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('mewiki:library:other:ai-session:v1'))).toBeNull();
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile());
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toBeVisible();
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [{ id: 'default', name: '辅助文件测试库', directory: null }, { id: 'material-other', name: '隔离测试库', directory: null }], contextDefaults: { standalone: 'default' } } }));
  await page.evaluate(state => localStorage.setItem('mewiki:library:material-other:notebook', JSON.stringify(state)), createNotebookFixture());
  await page.goto('/?library=material-other'); await openAiWorkspace(page);
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toHaveCount(0);
  await page.goto('/?library=default'); await openAiWorkspace(page);
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toBeVisible();
});

test('accepts drops on the composer and shows concise errors without losing valid files or the draft', async ({ page }, info) => {
  const ai = await setup(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('保留输入');
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['拖入材料正文'], '拖入.md', { type: 'text/markdown' })); return data; });
  await ai.getByLabel('任务要求', { exact: true }).dispatchEvent('drop', { dataTransfer: transfer });
  await expect(ai.getByRole('button', { name: '查看材料：拖入.md', exact: true })).toBeVisible();
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('不支持.zip', '任意')); await expect(ai.getByRole('alert')).toContainText('支持 TXT');
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('空.txt', ' ')); await expect(ai.getByRole('alert')).toContainText('没有可读取文字');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留输入');
  await page.setViewportSize({ width: 390, height: 620 }); await expectAiPanelInViewport(page);
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeInViewport();
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await ai.screenshot({ path: info.outputPath('materials-phone.png') });
});

test('refuses to report a file as attached when browser storage fails', async ({ page }) => {
  const ai = await setup(page);
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.endsWith(':ai-session:v1') && value.includes('materials')) throw new DOMException('quota', 'QuotaExceededError'); return original.call(this, key, value); }; });
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile());
  await expect(ai.getByRole('alert').first()).toContainText('未能保存');
  await expect(ai.getByRole('button', { name: '查看材料：参考.md', exact: true })).toHaveCount(0);
});

test('shows material limits in a dismissible warning bubble without resizing the chat', async ({ page }, info) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('文件超限也保留这条草稿');
  const name = 'research-library-2026-11-12T02-52-46.976Z.webbench.json';
  const file = textFile(name, JSON.stringify({ text: 'a'.repeat(100001) }));
  const notice = page.locator('.mewiki-ai-material-notice');
  for (const placement of ['floating', 'right']) {
    if (placement === 'right') await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
    await expect(ai).toHaveAttribute('data-placement', placement);
    await input.focus();
    const before = (await ai.locator('.mewiki-ai-composer').boundingBox())!;
    await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(file);
    await expect(notice).toBeVisible();
    const panel = (await ai.boundingBox())!, bubble = (await notice.boundingBox())!, toolbar = (await ai.locator('.mewiki-ai-floating-toolbar').boundingBox())!;
    expect(bubble.x).toBeGreaterThanOrEqual(panel.x + 5); expect(bubble.x + bubble.width).toBeLessThanOrEqual(panel.x + panel.width - 5);
    expect(bubble.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height + 5); expect(bubble.y - toolbar.y - toolbar.height).toBeLessThanOrEqual(12);
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(panel.y + panel.height - 5);
    const close = (await notice.getByRole('button', { name: '关闭提示', exact: true }).boundingBox())!;
    expect(close.y - bubble.y).toBeLessThanOrEqual(8); expect(bubble.x + bubble.width - close.x - close.width).toBeLessThanOrEqual(8);
    await expect(notice.getByRole('alert')).toContainText(name);
    await expect(notice.getByRole('alert')).toContainText('文字超过 100000 字符');
    await expect(input).toBeFocused();
    const after = (await ai.locator('.mewiki-ai-composer').boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1); expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    await expect(ai.locator('.mewiki-ai-materials > p[role="alert"]')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 620 });
    await expectAiPanelInViewport(page);
    await expect(notice).toBeInViewport();
    const narrowPanel = (await ai.boundingBox())!, narrowBubble = (await notice.boundingBox())!;
    expect(narrowBubble.x).toBeGreaterThanOrEqual(narrowPanel.x + 5); expect(narrowBubble.x + narrowBubble.width).toBeLessThanOrEqual(narrowPanel.x + narrowPanel.width - 5);
    expect(await notice.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`material-warning-${placement}-390.png`) });
    await notice.getByRole('button', { name: '关闭提示', exact: true }).click();
    await expect(notice).toHaveCount(0); await expect(ai.getByRole('button', { name: '添加外部文件', exact: true })).toBeFocused();
    await expect(input).toHaveValue('文件超限也保留这条草稿');
    await page.setViewportSize({ width: 1440, height: 960 });
  }
});

test('keeps the warning inside the chat while moving, resizing and changing its placement', async ({ page }, info) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('气泡不影响输入');
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles([textFile('空文件一.txt', ' '), textFile('空文件二.txt', ' ')]);
  const notice = ai.locator('.mewiki-ai-material-notice'); await expect(notice).toBeVisible();
  // Keep the warning open while checking geometry, without relying on a slow timer.
  await notice.getByRole('button', { name: '关闭提示', exact: true }).focus();
  const before = (await notice.boundingBox())!, grip = (await ai.getByRole('button', { name: '移动AI 面板', exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + 70, grip.y + 14); await page.mouse.down(); await page.mouse.move(grip.x - 90, grip.y + 74, { steps: 8 }); await page.mouse.up();
  expect((await notice.boundingBox())!.x).toBeLessThan(before.x - 100);
  const assertContained = async () => {
    const panel = (await ai.boundingBox())!, bubble = (await notice.boundingBox())!, toolbar = (await ai.locator('.mewiki-ai-floating-toolbar').boundingBox())!;
    expect(bubble.x).toBeGreaterThanOrEqual(panel.x + 5); expect(bubble.x + bubble.width).toBeLessThanOrEqual(panel.x + panel.width - 5);
    expect(bubble.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height + 5); expect(bubble.y + bubble.height).toBeLessThanOrEqual(panel.y + panel.height - 5);
    const dismiss = notice.getByRole('button', { name: '关闭提示', exact: true }), box = (await dismiss.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.mewiki-ai-material-notice button'), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);
  };
  await assertContained();
  const edge = ai.locator('[data-ai-resize-edge=e]'); await edge.focus(); await edge.press('Shift+ArrowLeft');
  await assertContained();
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click(); await assertContained();
  await page.setViewportSize({ width: 390, height: 230 }); await expectAiPanelInViewport(page); await assertContained();
  expect(await notice.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('material-warning-docked-short.png') });
  await notice.getByRole('button', { name: '关闭提示', exact: true }).click(); await expect(notice).toHaveCount(0);
  await expect(input).toHaveValue('气泡不影响输入');
});

test('groups file warnings, pauses expiry while reading and resets for a repeated failure', async ({ page }) => {
  const ai = await setup(page, true), input = ai.getByLabel('Task instructions', { exact: true });
  await input.fill('Keep my draft.');
  await ai.getByLabel('Choose supporting files', { exact: true }).setInputFiles(textFile());
  await expect(ai.getByRole('button', { name: 'View file: 参考.md', exact: true })).toBeVisible();
  await page.clock.install();
  const picker = ai.getByLabel('Choose supporting files', { exact: true }), notice = page.locator('.mewiki-ai-material-notice');
  await picker.setInputFiles([textFile('first.txt', ' '), textFile('second.txt', ' ')]);
  await expect(notice.getByRole('alert')).toContainText('first.txt'); await expect(notice.getByRole('alert')).toContainText('second.txt');
  await notice.hover(); await page.clock.runFor(9000); await expect(notice).toBeVisible();
  const close = notice.getByRole('button', { name: 'Dismiss notification', exact: true }); await close.focus();
  await page.mouse.move(1, 600); await page.clock.runFor(9000); await expect(notice).toBeVisible();
  await close.press('Escape'); await expect(notice).toHaveCount(0);
  await picker.setInputFiles(textFile('second.txt', ' ')); await expect(notice).toBeVisible();
  await input.focus(); await page.clock.runFor(8500); await expect(notice).toHaveCount(0); await expect(input).toBeFocused();
  await picker.setInputFiles(textFile('second.txt', ' ')); await expect(notice).toBeVisible();
  await ai.getByRole('button', { name: 'Conversation history', exact: true }).click();
  await ai.getByRole('dialog', { name: 'Conversation history', exact: true }).locator('header').getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(notice).toHaveCount(0);
});

test('removes a warning when its docked chat is hidden instead of leaving it above the note', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('空.txt', ' '));
  const notice = page.locator('.mewiki-ai-material-notice'); await expect(notice).toBeVisible();
  await ai.getByRole('tab', { name: '大纲', exact: true }).click();
  await expect(notice).toHaveCount(0);
});

test('keeps the original sent material for retry and message resend while removing it from future tasks', async ({ page }) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('原材料.md', '原任务材料'));
  await expect(ai.getByRole('button', { name: '查看材料：原材料.md', exact: true })).toBeVisible();
  let fail = true; const names: string[][] = [];
  await page.route('**/api/mewiki/ai/chat', route => {
    if (fail) return route.fulfill({ status: 503, json: { error: '测试中断' } });
    const request = route.request().postDataJSON(), tool = request.messages.findLast((message: { role: string }) => message.role === 'tool');
    if (!tool) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: '', toolCalls: [{ id: 'files', name: 'list_materials', arguments: '{}' }] }, usage: { inputTokens: 1, outputTokens: 0 } } }) + '\n' });
    const listed = JSON.parse(tool.content); names.push(listed.map((file: { name: string }) => file.name));
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: `材料范围检查 ${names.length}` }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  await input.fill('根据原材料补充'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('测试中断');
  await ai.getByRole('button', { name: '移除材料：原材料.md', exact: true }).click();
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('后加材料.md', '只用于后续要求'));
  await expect(ai.getByRole('button', { name: '查看材料：后加材料.md', exact: true })).toBeVisible();
  fail = false; await page.reload();
  await ai.getByRole('button', { name: '重试任务', exact: true }).click(); await expect(ai.getByText('材料范围检查 1', { exact: true })).toBeVisible();
  expect(names[0]).toEqual(['原材料.md']);
  const originalMessage = ai.locator('.mewiki-ai-message[data-role=user]').first();
  await originalMessage.getByRole('button', { name: '查看材料：原材料.md', exact: true }).click();
  const preview = page.getByTestId('mewiki-ai-material-preview'); await expect(preview.locator('pre')).toContainText('原任务材料'); await preview.press('Escape');
  await input.fill('后续草稿');
  await originalMessage.getByRole('button', { name: '编辑消息', exact: true }).click();
  await ai.getByLabel('编辑消息内容', { exact: true }).fill('原任务的新写法'); await ai.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(ai.getByText('材料范围检查 2', { exact: true })).toBeVisible(); expect(names[1]).toEqual(['原材料.md']);
  await expect(input).toHaveValue('后续草稿');
  await expect(ai.getByRole('button', { name: '查看材料：后加材料.md', exact: true })).toBeVisible();
  await input.fill('使用新材料继续'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('材料范围检查 3', { exact: true })).toBeVisible(); expect(names[2]).toEqual(['后加材料.md']);
});

test('cancels parsing, reports timeout and rejects damaged or textless PDFs without losing the draft', async ({ page }) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('出错也保留');
  await page.evaluate(() => { const original = File.prototype.arrayBuffer; File.prototype.arrayBuffer = async function() { if (this.name.startsWith('慢')) await new Promise(resolve => setTimeout(resolve, 400)); return original.call(this); }; });
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('慢取消.md'));
  await ai.getByRole('button', { name: '取消文件解析', exact: true }).click();
  await expect(ai.getByRole('button', { name: '取消文件解析', exact: true })).toHaveCount(0);
  await expect(ai.getByRole('button', { name: '查看材料：慢取消.md', exact: true })).toHaveCount(0);
  await expect(ai.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { const original = AbortSignal.timeout; AbortSignal.timeout = () => original(30); });
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('慢超时.md'));
  await expect(ai.getByRole('alert')).toContainText('解析超时');
  await page.reload();
  for (const file of [textFile('损坏.pdf', 'not a pdf'), { name: '扫描件.pdf', mimeType: 'application/pdf', buffer: Buffer.from(researchPdfFixture().toString().replace(/\([^()]*\) Tj/g, match => `(${''.padEnd(match.length - 5, ' ')}) Tj`)) }]) {
    await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(file);
    await expect(ai.getByRole('alert')).toContainText(/损坏|可读取文字/);
    await expect(ai.getByRole('button', { name: `查看材料：${file.name}`, exact: true })).toHaveCount(0);
  }
  await expect(input).toHaveValue('出错也保留');
});

test('keeps long file names, previews and sending accessible in a narrow English window', async ({ page }, info) => {
  const ai = await setup(page, true);
  await expect(ai.getByRole('button', { name: 'Add external files', exact: true })).toBeVisible();
  const name = `${'long file name '.repeat(12)}.md`;
  await ai.getByLabel('Choose supporting files', { exact: true }).setInputFiles(textFile(name));
  const trigger = ai.getByRole('button', { name: `View file: ${name}`, exact: true }); await expect(trigger).toBeVisible();
  await ai.getByLabel('Task instructions', { exact: true }).fill('Use the attached file.');
  await page.setViewportSize({ width: 390, height: 620 }); await expectAiPanelInViewport(page);
  expect(await ai.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await trigger.click(); const preview = page.getByTestId('mewiki-ai-material-preview'); await expect(preview.locator('pre')).toContainText('材料结论');
  await expect(preview).toBeInViewport(); await preview.press('Escape'); await expect(trigger).toBeFocused();
  await expect(ai.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport();
  await ai.screenshot({ path: info.outputPath('materials-english-narrow.png') });
});

test('rejects a password-protected PDF promptly instead of leaving parsing busy', async ({ page }) => {
  const ai = await setup(page);
  // One blank page encrypted with a fixture-only password; no user content.
  const buffer = Buffer.from('JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGJiMmJmNmFlYmY+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAxMDAgMTAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8OGYxOTY0MTI5OGQ2ZGU0ODUwODBhNGI0ZDBhNmIzNzhlNmUzNjQ2Y2QwMGJiNTUyNzNhMzU5MGY1ZTZjYWJlYj4KL1UgPDdmMzlkYmM5OTM2OTk5NjhlMzc5NzQyNDI0ZTE5YzhmMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDMwMzkzNTMzMzE2NjYzMzg2MTM3MzAzMTYzMzczMDYyMzc2MzM3MzIzMzMwMzAzNjM4MzUzNjMyMzYzODY0NjM+IDwzMDM5MzUzMzMxNjY2MzM4NjEzNzMwMzE2MzM3MzA2MjM3NjMzNzMyMzMzMDMwMzYzODM1MzYzMjM2Mzg2NDYzPiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK', 'base64');
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles({ name: '加密.pdf', mimeType: 'application/pdf', buffer });
  await expect(ai.getByRole('alert')).toContainText('加密');
  await expect(ai.getByRole('button', { name: '取消文件解析', exact: true })).toHaveCount(0);
  await expect(ai.getByRole('button', { name: '查看材料：加密.pdf', exact: true })).toHaveCount(0);
});

test('discards late parsing after switching conversations and keeps the previous draft', async ({ page }) => {
  const ai = await setup(page), input = ai.getByLabel('任务要求', { exact: true });
  await input.fill('解析前的草稿');
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function() {
      await new Promise(resolve => setTimeout(resolve, 600));
      const bytes = await original.call(this);
      document.documentElement.dataset.materialReadComplete = 'true';
      return bytes;
    };
  });
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(textFile('切换时解析.md'));
  await expect(ai.getByRole('button', { name: '取消文件解析', exact: true })).toBeVisible();
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('html')).toHaveAttribute('data-material-read-complete', 'true');
  await expect(ai.getByRole('button', { name: '取消文件解析', exact: true })).toHaveCount(0);
  await expect(ai.getByRole('button', { name: '查看材料：切换时解析.md', exact: true })).toHaveCount(0);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('button', { name: '新对话', exact: true }).and(ai.locator('button:not([aria-current])')).click();
  await expect(input).toHaveValue('解析前的草稿');
  await expect(ai.getByRole('button', { name: '查看材料：切换时解析.md', exact: true })).toHaveCount(0);
});

test('previews JSON, TeX and other text formats verbatim, restores them and exposes their text through tools', async ({ page }, info) => {
  const ai = await setup(page);
  const sources = [
    { name: '参数.JSON', text: '{\n  "title": "中文",\n  "values": [1, 2]\n}\n' },
    { name: '论文.TeX', text: '% 保留注释\n\\section{结论}\n\\input{未添加的章节}\n\\[ E = mc^2 \\]\n' },
    { name: '参考文献.bib', text: '@article{example,\n  title = {中文参考文献},\n}\n' },
    { name: '参数.yaml', text: 'title: 中文\nvalues:\n  - 1\n' },
    { name: '来源.xml', text: '<?xml version="1.0"?>\n<note>中文来源</note>\n' },
    { name: '示例.py', text: '# 保留缩进\ndef sample():\n    return "中文代码"\n' },
  ];
  const accept = (await ai.getByLabel('选择辅助文件', { exact: true }).getAttribute('accept'))!.split(',');
  for (const extension of ['.json', '.tex', '.bib', '.yaml', '.xml', '.py']) expect(accept).toContain(extension);
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(sources.map(({ name, text }) => textFile(name, text)));
  for (const source of sources) {
    const trigger = ai.getByRole('button', { name: `查看材料：${source.name}`, exact: true });
    await expect(trigger).toBeVisible(); await trigger.click();
    const preview = page.getByTestId('mewiki-ai-material-preview');
    expect(await preview.locator('pre').textContent()).toBe(source.text);
    if (source.name.endsWith('TeX')) await preview.screenshot({ path: info.outputPath('tex-preview.png') });
    await preview.press('Escape'); await expect(trigger).toBeFocused();
  }
  await page.reload();
  for (const source of sources) await expect(ai.getByRole('button', { name: `查看材料：${source.name}`, exact: true })).toBeVisible();
  let turn = 0, ids: string[] = [];
  await page.route('**/api/mewiki/ai/chat', route => {
    const request = route.request().postDataJSON();
    const call = (name: string, args: object, index = 0) => ({ id: `text-${turn}-${index}`, name, arguments: JSON.stringify(args) });
    let toolCalls;
    if (++turn === 1) toolCalls = [call('list_materials', {})];
    else if (turn === 2) {
      const directory = JSON.parse(request.messages.at(-1).content); expect(directory.map((entry: { name: string }) => entry.name)).toEqual(sources.map(source => source.name));
      expect(directory.every((entry: { kind: string }) => entry.kind === 'text')).toBe(true);
      ids = directory.map((entry: { id: string }) => entry.id); toolCalls = ids.map((materialId, index) => call('read_material', { materialId }, index));
    } else {
      const contents = request.messages.filter((message: { role: string }) => message.role === 'tool').slice(-sources.length).map((message: { content: string }) => JSON.parse(message.content));
      expect(contents.map((entry: { text: string }) => entry.text)).toEqual(sources.map(source => source.text));
    }
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'done', result: { message: { role: 'assistant', content: toolCalls ? '' : '已读取 JSON、TeX 和其他辅助文字。', ...(toolCalls ? { toolCalls } : {}) }, usage: { inputTokens: 1, outputTokens: 1 } } }) + '\n' });
  });
  await ai.getByLabel('任务要求', { exact: true }).fill('读取这些材料，准备辅助当前笔记');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('已读取 JSON、TeX 和其他辅助文字。', { exact: true })).toBeVisible();
  expect(turn).toBe(3);
});

test('treats HTML, SVG and code as inert text and rejects binary files disguised as text', async ({ page }) => {
  const ai = await setup(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('保留草稿');
  const sources = [
    textFile('网页.html', '<script>window.materialExecuted = true</script><img src="/never-fetch-material-image.png">\n<p>HTML 原文</p>'),
    textFile('图形.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="window.materialExecuted = true"><text>SVG 原文</text></svg>'),
    textFile('程序.js', 'window.materialExecuted = true;\n'),
    textFile('待修.jsonc', '// 原样保留\n{ "value":, }\n'),
  ];
  const requested: string[] = []; page.on('request', request => { if (request.url().includes('never-fetch-material-image')) requested.push(request.url()); });
  const transfer = await page.evaluateHandle(file => { const data = new DataTransfer(); data.items.add(new File([file.text], file.name, { type: 'text/html' })); return data; }, { name: sources[0].name, text: sources[0].buffer.toString() });
  await ai.getByLabel('任务要求', { exact: true }).dispatchEvent('drop', { dataTransfer: transfer });
  await expect(ai.getByRole('button', { name: `查看材料：${sources[0].name}`, exact: true })).toBeVisible();
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles(sources.slice(1));
  for (const source of sources) {
    const trigger = ai.getByRole('button', { name: `查看材料：${source.name}`, exact: true }); await expect(trigger).toBeVisible(); await trigger.click();
    const preview = page.getByTestId('mewiki-ai-material-preview'); expect(await preview.locator('pre').textContent()).toBe(source.buffer.toString());
    await expect(preview.locator('pre').locator('script, img, svg')).toHaveCount(0);
    await preview.press('Escape');
  }
  expect(requested).toEqual([]); expect(await page.evaluate(() => 'materialExecuted' in window)).toBe(false);
  await ai.getByLabel('选择辅助文件', { exact: true }).setInputFiles({ name: '二进制.tex', mimeType: 'text/plain', buffer: Buffer.from([0, 1, 2, 255]) });
  await expect(ai.getByRole('alert')).toContainText('文件文字无法读取');
  await expect(ai.getByRole('button', { name: '查看材料：二进制.tex', exact: true })).toHaveCount(0);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留草稿');
});
