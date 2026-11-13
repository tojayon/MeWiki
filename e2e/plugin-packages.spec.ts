import { expect, test } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { closeSettingsPage } from './helpers/settings.ts';
import { enableNotebookEditing, runNotebookAction } from './helpers/researchNotebook.ts';
const settings = path.resolve(process.env.MEWIKI_RESEARCH_SETTINGS || '.mewiki/media-e2e-settings.json');
const packageDirectory = settings + '.plugins';
test.beforeEach(async () => {
  expect(packageDirectory.startsWith(path.resolve('.mewiki') + path.sep)).toBe(true);
  await rm(settings, { force: true }); await rm(packageDirectory, { recursive: true, force: true });
});
test.afterEach(async () => { await rm(settings, { force: true }); await rm(packageDirectory, { recursive: true, force: true }); });

test('installs an independent package, inserts content, changes versions and preserves content after uninstall', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByTestId('research-notebook');
  await runNotebookAction(panel, '插件管理');
  const manager = page.getByTestId('mewiki-plugin-manager');
  const source = JSON.parse(await readFile('examples/plugins/measurement/manifest.json', 'utf8'));
  const upload = async (value: unknown) => {
    await manager.getByLabel('选择插件包', { exact: true }).setInputFiles({ name: 'measurement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await expect(manager.getByRole('region', { name: '插件安装预览' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('plugin-install-preview.png') });
    await manager.getByRole('button', { name: '确认安装', exact: true }).click();
    await expect(manager.getByRole('region', { name: '插件安装预览' })).not.toBeVisible();
  };
  await upload(source);
  const row = manager.locator('.mewiki-plugin-row').filter({ hasText: source.id });
  await expect(row).toContainText('1.0.0');
  await row.getByRole('button', { name: '启用', exact: true }).click();
  await closeSettingsPage(page);
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    state.notes = [{ id: 'plugin-note', title: '插件测试', library: 'research', createdAt: '2026-11-10', updatedAt: '2026-11-10', blocks: [{ id: 'p1', type: 'paragraph', text: '保留正文' }] }];
    state.activeNoteId = 'plugin-note'; state.view = 'notes'; localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
  });
  await page.reload(); await enableNotebookEditing(panel);
  await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '插入测量记录', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '插入测量记录', exact: true });
  await picker.getByLabel('记录名称', { exact: true }).fill('记录 A'); await picker.getByLabel('测量值', { exact: true }).fill('12.5');
  await picker.getByRole('button', { name: '插入测量记录', exact: true }).click();
  const card = panel.locator('.mewiki-external-card'); await expect(card).toContainText('12.50 mm');
  await page.reload(); await expect(card).toContainText('记录 A');
  await runNotebookAction(panel, '插件管理');
  await manager.getByLabel('选择插件包', { exact: true }).setInputFiles({ name: 'conflicting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...source, description: '同版本的不同内容' })) });
  await manager.getByRole('button', { name: '确认安装', exact: true }).click();
  await expect(manager.getByRole('alert')).toContainText('同一插件版本');
  await expect(row).toContainText('已启用');
  await expect(row.getByRole('heading')).toContainText('1.0.0');
  await manager.getByRole('region', { name: '插件安装预览' }).getByRole('button', { name: '取消', exact: true }).click();
  await upload({ ...source, version: '1.1.0' });
  await expect(row).toContainText('1.1.0'); await expect(row).toContainText('已停用');
  await row.getByRole('combobox').selectOption('1.0.0'); await expect(row).toContainText('1.0.0');
  await row.getByRole('button', { name: '卸载', exact: true }).click(); await expect(row).toHaveCount(0);
  await closeSettingsPage(page); await expect(card).toContainText('记录 A'); await expect(card).toContainText('测量值：12.5 mm');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes[0].blocks[1].data.value)).toBe(12.5);
});

for (const action of ['upgrade', 'uninstall'] as const) test(`cancels a pending package form after another window performs ${action}`, async ({ page, context }) => {
  const source = JSON.parse(await readFile('examples/plugins/measurement/manifest.json', 'utf8'));
  await page.goto('/');
  const installed = await page.request.post('/api/mewiki/plugins', { headers: { 'X-MeWiki-Request': 'plugins', 'Content-Type': 'application/json' }, data: source });
  expect(installed.ok()).toBe(true);
  await page.evaluate(id => localStorage.setItem('mewiki:plugins:v1', JSON.stringify({ [id]: 'enabled' })), source.id);
  await page.reload();
  const panel = page.getByTestId('research-notebook');
  await panel.getByRole('tab', { name: '研究记录', exact: true }).click();
  await panel.getByRole('button', { name: '新建笔记', exact: true }).click();
  await enableNotebookEditing(panel);
  await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '插入测量记录', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '插入测量记录', exact: true });
  await picker.getByLabel('记录名称', { exact: true }).fill('尚未确认');
  await picker.getByLabel('测量值', { exact: true }).fill('8');
  const other = await context.newPage();
  await other.goto('/?page=settings&section=plugins');
  const manager = other.getByTestId('mewiki-plugin-manager');
  const row = manager.locator('.mewiki-plugin-row').filter({ hasText: source.id });
  if (action === 'upgrade') {
    await manager.getByLabel('选择插件包', { exact: true }).setInputFiles({ name: 'upgrade.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...source, version: '1.1.0' })) });
    await manager.getByRole('button', { name: '确认安装', exact: true }).click();
    await expect(row).toContainText('1.1.0');
    await expect(row).toContainText('已停用');
  } else {
    await row.getByRole('button', { name: '卸载', exact: true }).click();
    await expect(row).toHaveCount(0);
  }
  await expect(picker).not.toBeVisible();
  await expect(panel.locator('.mewiki-external-card')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    return state.notes.find((note: { id: string }) => note.id === state.activeNoteId).blocks.length;
  })).toBe(0);
});

test('supports multiple content types and shows only the declared capabilities', async ({ page }) => {
  const source = JSON.parse(await readFile('examples/plugins/measurement/manifest.json', 'utf8'));
  const first = source.contentTypes[0];
  delete first.source;
  const second = structuredClone(first);
  second.id = 'calibration'; second.schemaVersion = 2; second.insertionLabel = '插入校准记录'; second.picker.title = '插入校准记录';
  second.schema.required.push('channel'); second.schema.properties.channel = { type: 'string', const: 'B' };
  second.picker.content.data.channel = { literal: 'B' };
  source.capabilities = []; source.contentTypes.push(second);
  await page.goto('/?page=settings&section=plugins');
  const manager = page.getByTestId('mewiki-plugin-manager');
  await manager.getByLabel('选择插件包', { exact: true }).setInputFiles({ name: 'multi.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  const preview = manager.getByRole('region', { name: '插件安装预览' });
  await expect(preview).toContainText('能力：本地表单与内容显示。');
  await preview.getByRole('button', { name: '确认安装', exact: true }).click();
  const row = manager.locator('.mewiki-plugin-row').filter({ hasText: source.id });
  await row.getByRole('button', { name: '启用', exact: true }).click();
  await closeSettingsPage(page);
  const panel = page.getByTestId('research-notebook');
  await panel.getByRole('tab', { name: '研究记录', exact: true }).click();
  await panel.getByRole('button', { name: '新建笔记', exact: true }).click();
  await enableNotebookEditing(panel);
  for (const label of ['插入测量记录', '插入校准记录']) {
    await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
    await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: label, exact: true }).click();
    const picker = page.getByRole('dialog', { name: label, exact: true });
    await picker.getByLabel('记录名称', { exact: true }).fill(label);
    await picker.getByLabel('测量值', { exact: true }).fill('7');
    await picker.getByRole('button', { name: label, exact: true }).click();
  }
  const cards = panel.locator('.mewiki-external-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.getByRole('button', { name: '打开来源', exact: true })).toHaveCount(0);
  const blocks = await page.evaluate(() => {
    const notebook = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    return notebook.notes.find((item: { id: string }) => item.id === notebook.activeNoteId).blocks.filter((block: { type: string }) => block.type === 'external');
  });
  expect(blocks.map((block: { contentType: string; schemaVersion: number }) => [block.contentType, block.schemaVersion])).toEqual([['measurement', 1], ['calibration', 2]]);
  expect(blocks[1].data.channel).toBe('B');
});

test('rejects an executable package without registering it or changing the bundled plugin', async ({ page }) => {
  await page.goto('/?page=settings&section=plugins');
  const manager = page.getByTestId('mewiki-plugin-manager');
  const source = JSON.parse(await readFile('examples/plugins/measurement/manifest.json', 'utf8'));
  await manager.getByLabel('选择插件包', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...source, entry: 'unsafe.js' })) });
  await expect(manager.getByRole('alert')).toContainText('清单');
  await expect(manager.locator('.mewiki-plugin-row').filter({ hasText: source.id })).toHaveCount(0);
  await expect(manager.locator('.mewiki-plugin-row').filter({ hasText: 'org.mewiki.webbench' })).toContainText('WebBench 仿真回放');
  expect((await page.request.get('/api/mewiki/plugins')).ok()).toBe(true);
});

test('keeps the original numeric value when choosing a declared option', async ({ page }) => {
  const source = JSON.parse(await readFile('examples/plugins/measurement/manifest.json', 'utf8'));
  const type = source.contentTypes[0];
  source.capabilities = []; delete type.source;
  type.picker.fields[1] = { key: 'value', label: '测量值', type: 'select', required: true, options: { path: 'selected.values' } };
  type.picker.connection = [{ key: 'origin', label: '测量程序地址', default: 'http://127.0.0.1:7777' }];
  type.picker.catalog = { connection: 'origin', pathname: '/measurements', label: '测量记录', refreshLabel: '刷新记录', loadingText: '读取中', emptyText: '没有记录', itemsPath: 'items', idPath: 'id', labelPath: 'title', itemSchema: { type: 'object' } };
  await page.route('**/measurements', route => route.fulfill({ json: { items: [{ id: 'one', title: '第一组', values: [1, 2] }] } }));
  await page.goto('/?page=settings&section=plugins');
  const manager = page.getByTestId('mewiki-plugin-manager');
  await manager.getByLabel('选择插件包', { exact: true }).setInputFiles({ name: 'numeric.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await manager.getByRole('button', { name: '确认安装', exact: true }).click();
  const row = manager.locator('.mewiki-plugin-row').filter({ hasText: source.id });
  await row.getByRole('button', { name: '启用', exact: true }).click();
  await closeSettingsPage(page);
  const panel = page.getByTestId('research-notebook');
  await panel.getByRole('tab', { name: '研究记录', exact: true }).click();
  await panel.getByRole('button', { name: '新建笔记', exact: true }).click();
  await enableNotebookEditing(panel);
  await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  await page.getByRole('dialog', { name: '插入笔记内容', exact: true }).getByRole('button', { name: '插入测量记录', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '插入测量记录', exact: true });
  await picker.getByLabel('测量记录', { exact: true }).selectOption('one');
  await picker.getByLabel('记录名称', { exact: true }).fill('数值选项');
  await picker.getByRole('combobox', { name: /^测量值/ }).selectOption({ label: '2' });
  await expect(picker.getByRole('button', { name: '插入测量记录', exact: true })).toBeEnabled();
  await picker.getByRole('button', { name: '插入测量记录', exact: true }).click();
  await expect(panel.locator('.mewiki-external-card')).toContainText('2.00 mm');
  const value = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    return state.notes.find((note: { id: string }) => note.id === state.activeNoteId).blocks.find((block: { type: string }) => block.type === 'external').data.value;
  });
  expect(value).toBe(2);
});

test('selects the declared type when another provider supplies a context with the same type name', async ({ page }) => {
  const second = JSON.parse(await readFile('examples/plugins/measurement/manifest.json', 'utf8'));
  const calibration = structuredClone(second.contentTypes[0]);
  calibration.id = 'calibration'; calibration.insertionLabel = '插入校准记录'; calibration.picker.title = '插入校准记录';
  delete second.contentTypes[0].picker; second.contentTypes.push(calibration);
  const first = structuredClone(second);
  first.id = 'org.example.context'; first.name = '上下文记录'; first.contentTypes = [first.contentTypes[0]];
  first.contentTypes[0].insertionLabel = '插入上下文测量';
  await page.goto('/');
  for (const manifest of [first, second]) {
    const response = await page.request.post('/api/mewiki/plugins', { headers: { 'X-MeWiki-Request': 'plugins', 'Content-Type': 'application/json' }, data: manifest });
    expect(response.ok()).toBe(true);
  }
  await page.evaluate(ids => localStorage.setItem('mewiki:plugins:v1', JSON.stringify(Object.fromEntries(ids.map(id => [id, 'enabled'])))), [first.id, second.id]);
  await page.route('**/plugin-host-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe id="wiki" style="width:1400px;height:950px"></iframe><script type="module">
    import { connectMeWiki } from '/integration/mewiki-host.js';
    const connection = connectMeWiki({ iframe: document.querySelector('#wiki'), url: new URL('/', location.href).href, app: { id: 'org.example.context', name: '测试宿主', providers: ['org.example.context'], capabilities: ['context.read'] } });
    await connection.ready;
    await connection.setContext({ provider: 'org.example.context', contentType: 'measurement', schemaVersion: 1, title: '当前测量', data: { recordId: 'current', value: 3, origin: 'http://127.0.0.1:7777' } });
  </script>` }));
  await page.goto('/plugin-host-fixture');
  const frame = page.frameLocator('#wiki');
  const panel = frame.getByTestId('research-notebook');
  await panel.getByRole('tab', { name: '研究记录', exact: true }).click();
  await panel.getByRole('button', { name: '新建笔记', exact: true }).click();
  await enableNotebookEditing(panel);
  await panel.getByRole('button', { name: '在笔记末尾插入', exact: true }).click();
  const menu = frame.getByRole('dialog', { name: '插入笔记内容', exact: true });
  await expect(menu.getByRole('button', { name: '插入上下文测量', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: '插入校准记录', exact: true }).click();
  await expect(frame.getByRole('dialog', { name: '插入校准记录', exact: true })).toBeVisible();
  await expect(panel.locator('.mewiki-external-card')).toHaveCount(0);
});
