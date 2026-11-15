import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createAiSession, type AiSession } from '../src/ai/session.ts';
import { createAiTextSelection } from '../src/ai/textSelection.ts';
import { beginAiChatTask } from '../src/ai/chatActions.ts';
import { createAiLibraryGuidance, type AiLibraryGuidance, type AiSkill } from '../src/ai/skills.ts';
import type { AiMessage } from '../src/ai/types.ts';
import type { ResearchNotebookState } from '../src/domain/researchNotebook.ts';
import { translate } from '../src/i18n/locale.ts';
import { expectAiPanelInViewport, openAiWorkspace } from './helpers/ai.ts';

const noteId = 'fixture-definition';
const sessionKey = 'mewiki:library:default:ai-session:v1';
const guidanceKey = (library = 'default') => `mewiki:library:${encodeURIComponent(library)}:ai-guidance:v1`;
const provider = { id: 'product-skills-fixture', name: '虚构功能与技能服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'fixture-model', hasApiKey: false };
const done = (message: AiMessage) => JSON.stringify({ type: 'done', result: { message, usage: { inputTokens: 6, outputTokens: 2 } } }) + '\n';
const tool = (name: string, args: object) => ({ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) });
const textResponse = (content = '虚构任务已完成。') => done({ role: 'assistant', content });
const savedSession = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as AiSession, sessionKey);
const savedGuidance = (page: Page, library = 'default') => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as AiLibraryGuidance, guidanceKey(library));
interface ChatRequest { messages: AiMessage[] }

function notebook(): ResearchNotebookState {
  const state = createNotebookFixture(); state.activeNoteId = noteId; state.activeSymbolId = 'example-vector'; state.activeTermId = undefined; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === noteId)!.tags = ['虚构/定义'];
  state.terms = [{ id: 'term-space', name: '测试状态空间', aliases: ['虚构空间'], englishName: 'Fixture state space', meaning: '通用虚构定义。' }];
  state.theoryMaps = { version: 1, activeMapId: 'map-context', documents: [{ id: 'map-context', title: '虚构关系地图', kind: 'topic', noteIds: [noteId], annotations: [], relations: [], createdAt: '', updatedAt: '', view: { expandedNoteIds: [], showAllBlocks: false, layout: { positions: {} } } }], deletedMapIds: [], noteViewOpen: false, noteViews: {} };
  return state;
}
function skill(id: string, fields: Partial<AiSkill> = {}): AiSkill {
  return { id, name: `虚构技能 ${id}`, description: '仅用于隔离检查的文字流程。', instructions: `SKILL_BODY_${id}`, keywords: ['核对'], modules: ['notes'], enabled: true, defaultEnabled: false, ...fields };
}
function guidance(skills: AiSkill[] = [], instructions = ''): AiLibraryGuidance {
  return { ...createAiLibraryGuidance('default'), instructions, skills };
}
async function setup(page: Page, options: { state?: ResearchNotebookState; session?: AiSession; guidance?: AiLibraryGuidance; rawGuidance?: string; english?: boolean } = {}) {
  const initial = options.state ?? notebook();
  await page.addInitScript(({ state, session, guidance, rawGuidance, english }) => {
    if (!sessionStorage.getItem('product-context-skills-seeded')) {
      localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
      localStorage.setItem('mewiki:library:skills-other:notebook', JSON.stringify({ ...state, view: 'notes' }));
      localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
      if (rawGuidance !== undefined) localStorage.setItem('mewiki:library:default:ai-guidance:v1', rawGuidance);
      else if (guidance) localStorage.setItem('mewiki:library:default:ai-guidance:v1', JSON.stringify(guidance));
      sessionStorage.setItem('product-context-skills-seeded', 'yes');
    }
    localStorage.setItem('mewiki:locale', english ? 'en' : 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'read');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state: initial, session: options.session ?? createAiSession('default'), guidance: options.guidance, rawGuidance: options.rawGuidance, english: options.english ?? false });
  await page.route(/\/api\/research-library\/catalog(?:\?|$)/, route => route.fulfill({ json: { libraries: [
    { id: 'default', name: '虚构规范测试库', directory: null }, { id: 'skills-other', name: '虚构隔离库', directory: null },
  ], contextDefaults: { standalone: 'default' } } }));
  await page.route(/\/api\/research-library(?:\?|$)/, route => route.fulfill({ json: { directory: null, file: null } }));
  await page.route(/\/api\/mewiki\/ai\/settings(?:\?|$)/, route => route.fulfill({ json: { revision: '0', defaultProviderId: provider.id, providers: [provider] } }));
  const requests: ChatRequest[] = [];
  let response: (request: ChatRequest, count: number) => string = () => textResponse();
  await page.route('**/api/mewiki/ai/chat', route => {
    const request = route.request().postDataJSON() as ChatRequest; requests.push(request);
    return route.fulfill({ contentType: 'application/x-ndjson', body: response(request, requests.length) });
  });
  page.on('pageerror', error => { throw error; });
  await page.goto('/?library=default');
  const ai = await openAiWorkspace(page, options.english);
  return { ai, requests, setResponse: (next: typeof response) => { response = next; } };
}
async function openSkills(ai: Locator) {
  await ai.getByRole('button', { name: '资料库规范与技能', exact: true }).click();
  const panel = ai.getByRole('dialog', { name: '资料库规范与技能', exact: true });
  await expect(panel).toBeVisible(); return panel;
}
async function send(ai: Locator, prompt: string, response = '虚构任务已完成。') {
  await ai.getByLabel('任务要求', { exact: true }).fill(prompt);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText(response, { exact: true }).last()).toBeVisible();
}

test('explains standard module names from aliases and navigates only on a user click', async ({ page }, info) => {
  const { ai, requests, setResponse } = await setup(page);
  const trigger = ai.getByRole('button', { name: '觅维功能', exact: true }); await trigger.click();
  const panel = ai.getByRole('dialog', { name: '觅维功能', exact: true }), search = panel.getByLabel('搜索功能名称或别称', { exact: true });
  await expect(search).toBeFocused(); await search.fill('符号库');
  await expect(panel.locator('.mewiki-ai-product-help-list > li')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '符号词典', exact: true })).toBeVisible();
  await search.press('Enter'); expect(requests).toHaveLength(0);
  await expect(page.getByRole('tab', { name: '研究记录', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: info.outputPath('standard-name-and-alias.png') });
  await search.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await panel.getByLabel('搜索功能名称或别称', { exact: true }).fill('term dictionary');
  await panel.getByRole('button', { name: '术语词典', exact: true }).click();
  await expect(page.getByRole('tab', { name: '术语', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
  expect(requests).toHaveLength(0);
  setResponse((_request, count) => count === 1 ? done({ role: 'assistant', content: '', toolCalls: [tool('get_product_help', { query: '符号库' })] }) : textResponse('请打开[符号词典](mewiki-module:symbols)。'));
  await send(ai, '符号库在觅维中的标准名称是什么？', '请打开符号词典。');
  const helpResult = requests[1].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content)).find(result => result.modules);
  expect(helpResult.modules[0]).toMatchObject({ id: 'symbols', name: '符号词典', url: 'mewiki-module:symbols' });
  await expect(page.getByRole('tab', { name: '术语', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
  await ai.getByRole('link', { name: '符号词典', exact: true }).click();
  await expect(page.getByRole('tab', { name: '符号', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
});

test('targets the current symbol and refuses to read an old note selection', async ({ page }) => {
  const state = notebook(); state.view = 'dictionary';
  const { ai, requests, setResponse } = await setup(page, { state });
  await expect(ai.getByLabel('本次引用', { exact: true })).toContainText('当前符号 · 状态向量');
  await expect(ai.getByLabel('本次引用', { exact: true })).not.toContainText('关系定义');
  await ai.getByRole('button', { name: '快捷提问', exact: true }).click();
  await ai.getByRole('button', { name: '解释角标', exact: true }).click();
  setResponse((_request, count) => count === 1 ? done({ role: 'assistant', content: '', toolCalls: [tool('read_note', { noteId }), tool('get_capabilities', {})] }) : textResponse('只处理当前符号，未读取旧笔记。'));
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('只处理当前符号，未读取旧笔记。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest).toMatchObject({ noteIds: [], support: { references: [{ kind: 'symbol', id: 'example-vector' }] } });
  const results = requests[1].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  expect(results.some(result => result.error?.includes('不在本次授权范围内'))).toBe(true);
  expect(results.some(result => result.noteCount === 0)).toBe(true);
  expect(JSON.stringify(requests)).not.toContain('通用内容。');
});

test('keeps inline @ references stable across navigation and unbinds only deleted text without submitting', async ({ page }, info) => {
  const { ai, requests } = await setup(page), prompt = ai.getByLabel('任务要求', { exact: true });
  await prompt.fill('请检查 @关系应用');
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true }), search = picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true });
  await expect(search).toBeFocused(); await expect(search).toHaveValue('关系应用'); await search.press('Enter');
  await expect(picker).toHaveCount(0); await expect(prompt).toHaveValue('请检查 @关系应用'); await expect(prompt).toBeFocused();
  await expect.poll(async () => (await savedSession(page)).inlineReferences).toEqual([{ start: 4, end: 9, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } }]);
  expect((await savedSession(page)).references ?? []).toEqual([]); expect(requests).toHaveLength(0);
  await page.locator('#research-notebook-sidebar').getByRole('button', { name: '结果摘要', exact: true }).click();
  await expect(prompt).toHaveValue('请检查 @关系应用');
  await prompt.focus(); await prompt.press('End'); await prompt.pressSequentially(' 与 ');
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click(); await search.fill('状态向量'); await search.press('ArrowDown'); await search.press('Enter');
  await expect(prompt).toHaveValue('请检查 @关系应用 与 @状态向量');
  await expect.poll(async () => (await savedSession(page)).inlineReferences?.length).toBe(2);
  await prompt.evaluate((element: HTMLTextAreaElement) => { const start = element.value.indexOf('@状态向量'); element.setSelectionRange(start, start + '@状态向量'.length); });
  await prompt.press('Backspace');
  await expect.poll(async () => (await savedSession(page)).inlineReferences?.map(item => item.reference)).toEqual([{ kind: 'note', id: 'fixture-application' }]);
  expect((await savedSession(page)).references ?? []).toEqual([]);
  await page.screenshot({ path: info.outputPath('inline-object-reference.png') });
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.support?.references).toEqual([{ kind: 'note', id: 'fixture-application' }]);
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual(['fixture-application']);
  expect(JSON.stringify(requests[0])).toContain('fixture-application');
});

test('shows and blocks missing restored references until explicitly removed', async ({ page }) => {
  const session = createAiSession('default'); session.references = [{ kind: 'note', id: 'deleted-fixture-note' }]; session.draft = '保留引用草稿';
  const { ai, requests } = await setup(page, { session });
  await expect(ai.getByLabel('本次引用', { exact: true })).toContainText('引用对象不可用');
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await page.reload(); await openAiWorkspace(page);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('保留引用草稿');
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled(); expect(requests).toHaveLength(0);
  await ai.getByRole('button', { name: '移除引用：deleted-fixture-note', exact: true }).click();
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await expect.poll(async () => (await savedSession(page)).references).toEqual([]);
});

test('saves library rules and a default skill for new conversations while keeping conversation requirements local', async ({ page }, info) => {
  const initial = createAiSession('default'); initial.memoryInstructions = 'CONVERSATION_REQUIREMENT_ONLY';
  const { ai, requests } = await setup(page, { session: initial });
  const panel = await openSkills(ai);
  await panel.getByLabel('资料库默认规范', { exact: true }).fill('LIBRARY_RULE_PRESERVE_FORMULAS');
  await panel.getByRole('button', { name: '保存资料库默认规范', exact: true }).click();
  await panel.getByRole('button', { name: '新建技能', exact: true }).click();
  await panel.getByLabel('技能名称', { exact: true }).fill('虚构默认润色技能');
  await panel.getByLabel('适用描述', { exact: true }).fill('保留原有事实并核对符号。');
  await panel.getByLabel('说明正文', { exact: true }).fill('DEFAULT_SKILL_READ_THEN_REVIEW');
  await panel.getByLabel('默认启用', { exact: true }).check();
  await panel.getByRole('button', { name: '保存技能', exact: true }).click();
  await expect(panel.getByRole('checkbox', { name: '本次启用技能：虚构默认润色技能', exact: true })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: '本次启用技能：虚构默认润色技能', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('library-skills-management.png') });
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  await send(ai, '第一项虚构任务');
  expect(JSON.stringify(requests[0])).toContain('LIBRARY_RULE_PRESERVE_FORMULAS'); expect(JSON.stringify(requests[0])).toContain('DEFAULT_SKILL_READ_THEN_REVIEW'); expect(JSON.stringify(requests[0])).toContain('CONVERSATION_REQUIREMENT_ONLY');
  await ai.getByText('本次生效规则', { exact: true }).click(); await expect(ai.locator('.mewiki-ai-message-skills')).toContainText('虚构默认润色技能');
  const originalId = (await savedSession(page)).conversationId;
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('dialog', { name: '对话历史', exact: true }).getByRole('button', { name: '新建对话', exact: true }).click();
  await expect.poll(async () => (await savedSession(page)).conversationId).not.toBe(originalId);
  await page.reload(); await openAiWorkspace(page);
  const reopened = await openSkills(ai);
  await expect(reopened.getByLabel('资料库默认规范', { exact: true })).toHaveValue('LIBRARY_RULE_PRESERVE_FORMULAS');
  await expect(reopened.getByRole('checkbox', { name: '本次启用技能：虚构默认润色技能', exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath('library-rules-and-default-skills.png') });
  await reopened.getByRole('button', { name: '关闭', exact: true }).click(); await send(ai, '第二个新对话任务');
  expect(JSON.stringify(requests[1])).toContain('LIBRARY_RULE_PRESERVE_FORMULAS'); expect(JSON.stringify(requests[1])).toContain('DEFAULT_SKILL_READ_THEN_REVIEW'); expect(JSON.stringify(requests[1])).not.toContain('CONVERSATION_REQUIREMENT_ONLY');
  expect((await savedSession(page)).history[0].skillNames).toEqual(['虚构默认润色技能']);
});

test('recommends matching skills without silently enabling them and records explicit selection', async ({ page }) => {
  const recommended = skill('recommended', { name: '虚构核对技能', instructions: 'RECOMMENDED_EXPLICIT_ONLY' });
  const { ai, requests } = await setup(page, { guidance: guidance([recommended]) });
  await ai.getByLabel('任务要求', { exact: true }).fill('请核对当前内容'); const panel = await openSkills(ai);
  await expect(panel.getByRole('checkbox', { name: '本次启用技能：虚构核对技能', exact: true })).not.toBeChecked();
  await expect(panel.locator('[aria-label="推荐技能"]').getByRole('button', { name: '虚构核对技能', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '关闭', exact: true }).click(); await send(ai, '请核对当前内容');
  expect(JSON.stringify(requests[0])).not.toContain('RECOMMENDED_EXPLICIT_ONLY');
  await ai.getByLabel('任务要求', { exact: true }).fill('再次核对当前内容'); const reopened = await openSkills(ai);
  await reopened.locator('[aria-label="推荐技能"]').getByRole('button', { name: '虚构核对技能', exact: true }).click();
  await expect(reopened.getByRole('checkbox', { name: '本次启用技能：虚构核对技能', exact: true })).toBeChecked();
  await reopened.getByRole('button', { name: '关闭', exact: true }).click(); await send(ai, '使用所选技能核对');
  expect(JSON.stringify(requests[1])).toContain('RECOMMENDED_EXPLICIT_ONLY');
  expect((await savedSession(page)).history.filter(message => message.role === 'user').at(-1)?.skillIds).toEqual(['recommended']);
  expect((await savedGuidance(page)).skills[0].defaultEnabled).toBe(false);
});

test('freezes the exact rule and skill text for an explicit retry after edits and reload', async ({ page }) => {
  const { ai, requests, setResponse } = await setup(page, { guidance: guidance([skill('frozen', { defaultEnabled: true, instructions: 'SKILL_SNAPSHOT_V1' })], 'RULE_SNAPSHOT_V1') });
  setResponse((_request, count) => count === 1 ? JSON.stringify({ type: 'error', error: '虚构网络中断，请明确重试。', failure: { kind: 'network', recovery: 'retry' } }) + '\n' : textResponse('原快照重试完成。'));
  await ai.getByLabel('任务要求', { exact: true }).fill('冻结规则的虚构任务'); await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('button', { name: '重试任务', exact: true })).toBeEnabled();
  const frozen = (await savedSession(page)).lastRequest?.support;
  const panel = await openSkills(ai);
  await panel.getByLabel('资料库默认规范', { exact: true }).fill('RULE_SNAPSHOT_V2'); await panel.getByRole('button', { name: '保存资料库默认规范', exact: true }).click();
  await panel.getByRole('button', { name: '编辑技能：虚构技能 frozen', exact: true }).click();
  await panel.getByRole('textbox', { name: '说明正文', exact: true }).fill('SKILL_SNAPSHOT_V2'); await panel.getByRole('button', { name: '保存技能', exact: true }).click();
  await panel.getByRole('button', { name: '关闭', exact: true }).click(); await page.reload(); await openAiWorkspace(page);
  expect(requests).toHaveLength(1); await ai.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(ai.getByText('原快照重试完成。', { exact: true })).toBeVisible(); expect(requests).toHaveLength(2);
  const retried = JSON.stringify(requests[1]); expect(retried).toContain('RULE_SNAPSHOT_V1'); expect(retried).toContain('SKILL_SNAPSHOT_V1'); expect(retried).not.toContain('RULE_SNAPSHOT_V2'); expect(retried).not.toContain('SKILL_SNAPSHOT_V2');
  expect((await savedSession(page)).lastRequest?.support).toEqual(frozen);
  expect((await savedSession(page)).history.filter(message => message.role === 'user')).toHaveLength(1);
  expect((await savedGuidance(page)).instructions).toBe('RULE_SNAPSHOT_V2');
});

test('isolates library guidance, skill choices, references and drafts across library windows', async ({ page }) => {
  const session = createAiSession('default'); session.references = [{ kind: 'symbol', id: 'example-vector' }]; session.skillIds = ['private']; session.draft = '本库的未发送草稿';
  const { ai, requests } = await setup(page, { session, guidance: guidance([skill('private', { instructions: 'DEFAULT_LIBRARY_PRIVATE_SKILL' })], 'DEFAULT_LIBRARY_PRIVATE_RULE') });
  await page.goto('/?library=skills-other'); await openAiWorkspace(page);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
  await expect(ai.locator('.mewiki-ai-reference-tag:not([data-implicit])')).toHaveCount(0);
  const otherPanel = await openSkills(ai);
  await expect(otherPanel.getByLabel('资料库默认规范', { exact: true })).toHaveValue(''); await expect(otherPanel.locator('.mewiki-ai-skill-row')).toHaveCount(0);
  await otherPanel.getByLabel('资料库默认规范', { exact: true }).fill('OTHER_LIBRARY_RULE'); await otherPanel.getByRole('button', { name: '保存资料库默认规范', exact: true }).click();
  await otherPanel.getByRole('button', { name: '关闭', exact: true }).click(); await send(ai, '另一个资料库的任务');
  expect(JSON.stringify(requests[0])).toContain('OTHER_LIBRARY_RULE'); expect(JSON.stringify(requests[0])).not.toContain('DEFAULT_LIBRARY_PRIVATE');
  await page.goto('/?library=default'); await openAiWorkspace(page);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('本库的未发送草稿'); await expect(ai.locator('.mewiki-ai-reference-tag')).toContainText('@状态向量');
  const original = await openSkills(ai); await expect(original.getByLabel('资料库默认规范', { exact: true })).toHaveValue('DEFAULT_LIBRARY_PRIVATE_RULE');
  await expect(original.getByRole('checkbox', { name: '本次启用技能：虚构技能 private', exact: true })).toBeChecked();
  expect((await savedGuidance(page)).instructions).toBe('DEFAULT_LIBRARY_PRIVATE_RULE'); expect((await savedGuidance(page, 'skills-other')).instructions).toBe('OTHER_LIBRARY_RULE');
});

test('creates a template and imports Markdown into an inactive draft before an explicit save', async ({ page }) => {
  const { ai, requests } = await setup(page), panel = await openSkills(ai);
  await panel.getByRole('button', { name: '从模板创建技能', exact: true }).click(); await panel.getByRole('button', { name: '符号一致性检查', exact: true }).click();
  await expect(panel.getByLabel('技能名称', { exact: true })).toHaveValue('符号一致性检查');
  await expect(panel.getByRole('textbox', { name: '说明正文', exact: true })).toHaveValue(/严格沿用符号词典提供的 TeX/);
  expect(await page.evaluate(key => localStorage.getItem(key), guidanceKey())).toBeNull();
  await panel.getByRole('button', { name: '保存技能', exact: true }).click();
  const downloadEvent = page.waitForEvent('download'); await panel.getByRole('button', { name: '导出技能：符号一致性检查', exact: true }).click();
  const download = await downloadEvent, exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toContain('name: 符号一致性检查'); expect(exported).toContain('严格沿用符号词典提供的 TeX');
  const imported = '---\nname: 虚构导入技能\ndescription: 导入后检查并保存\nkeywords: [核对]\nmodules: [symbols]\n---\nIMPORTED_SKILL_READ_ONLY\n';
  await panel.getByLabel('选择技能 Markdown', { exact: true }).setInputFiles({ name: 'fixture-skill.md', mimeType: 'text/markdown', buffer: Buffer.from(imported) });
  await expect(panel.getByLabel('技能名称', { exact: true })).toHaveValue('虚构导入技能');
  await expect(panel.getByRole('textbox', { name: '说明正文', exact: true })).toHaveValue('IMPORTED_SKILL_READ_ONLY');
  await expect(panel.getByLabel('启用技能', { exact: true })).not.toBeChecked(); await expect(panel.getByLabel('默认启用', { exact: true })).not.toBeChecked();
  expect((await savedGuidance(page)).skills).toHaveLength(1);
  await panel.getByRole('button', { name: '保存技能', exact: true }).click();
  expect((await savedGuidance(page)).skills.find(item => item.name === '虚构导入技能')).toMatchObject({ enabled: false, defaultEnabled: false, instructions: 'IMPORTED_SKILL_READ_ONLY' });
  expect(requests).toHaveLength(0);
});

test('retains unsaved rules after a storage error and never overwrites damaged configuration', async ({ page }) => {
  const { ai } = await setup(page, { guidance: guidance([], 'ORIGINAL_SAVED_RULE') }), panel = await openSkills(ai);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('虚构存储已满', 'QuotaExceededError'); return original.call(this, name, value); };
    (window as typeof window & { restoreGuidanceStorage: () => void }).restoreGuidanceStorage = () => { Storage.prototype.setItem = original; };
  }, guidanceKey());
  await panel.getByLabel('资料库默认规范', { exact: true }).fill('UNSAVED_DRAFT_RULE'); await panel.getByRole('button', { name: '保存资料库默认规范', exact: true }).click();
  await expect(ai.getByRole('alert')).toContainText('资料库规范未能保存'); await expect(panel.getByLabel('资料库默认规范', { exact: true })).toHaveValue('UNSAVED_DRAFT_RULE');
  expect((await savedGuidance(page)).instructions).toBe('ORIGINAL_SAVED_RULE');
  await page.evaluate(() => (window as typeof window & { restoreGuidanceStorage: () => void }).restoreGuidanceStorage());
  await panel.getByRole('button', { name: '保存资料库默认规范', exact: true }).click();
  expect((await savedGuidance(page)).instructions).toBe('UNSAVED_DRAFT_RULE');
  await page.evaluate(key => localStorage.setItem(key, '{damaged-fixture'), guidanceKey()); await page.reload(); await openAiWorkspace(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('不得覆盖损坏配置');
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  const damaged = await openSkills(ai); await expect(damaged.getByLabel('资料库默认规范', { exact: true })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), guidanceKey())).toBe('{damaged-fixture');
});

for (const english of [false, true]) for (const viewport of [{ width: 390, height: 620 }, { width: 1024, height: 360 }]) {
  test(`keeps ${english ? 'English' : 'Chinese'} references, help and skills inside a ${viewport.width}×${viewport.height} panel with keyboard support`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const label = (value: string) => translate(value, [], english ? 'en' : 'zh-CN');
    const { ai, requests } = await setup(page, { english, guidance: guidance(Array.from({ length: 14 }, (_, index) => skill(`layout-${index}`))) });
    if (english) expect(label('资料库规范与技能')).not.toBe('资料库规范与技能');
    await expectAiPanelInViewport(page);
    const referenceTrigger = ai.getByRole('button', { name: label('添加对象引用'), exact: true }); await referenceTrigger.focus(); await referenceTrigger.press('Enter');
    const picker = ai.getByRole('dialog', { name: label('添加对象引用'), exact: true }), search = picker.getByLabel(label('搜索笔记、符号、术语或地图'), { exact: true });
    await expect(search).toBeFocused(); await expect(search).toBeInViewport(); await expectInside(picker, ai);
    await search.fill('状态向量');
    await search.dispatchEvent('compositionstart'); await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true }); await search.dispatchEvent('compositionend');
    await expect(picker).toBeVisible(); expect(requests).toHaveLength(0);
    await search.press('Escape'); await expect(referenceTrigger).toBeFocused();
    const skillTrigger = ai.getByRole('button', { name: label('资料库规范与技能'), exact: true }); await skillTrigger.click();
    const skills = ai.getByRole('dialog', { name: label('资料库规范与技能'), exact: true });
    await expectInside(skills, ai);
    expect(await skills.locator('.mewiki-ai-skills-content').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const rules = skills.getByLabel(label('资料库默认规范'), { exact: true }); await rules.fill('LAYOUT_RULE'); await rules.press('Shift+Tab');
    await expect(skills.getByRole('button', { name: label('保存资料库默认规范'), exact: true })).toBeFocused(); await page.keyboard.press('Enter');
    expect((await savedGuidance(page)).instructions).toBe('LAYOUT_RULE'); expect(requests).toHaveLength(0);
    await rules.focus(); await rules.press('Escape'); await expect(skillTrigger).toBeFocused();
    const helpTrigger = ai.getByRole('button', { name: label('觅维功能'), exact: true }); await helpTrigger.click();
    const help = ai.getByRole('dialog', { name: label('觅维功能'), exact: true }); await expectInside(help, ai);
    await help.getByLabel(label('搜索功能名称或别称'), { exact: true }).fill('符号库'); await expect(help.getByRole('button', { name: label('符号词典'), exact: true })).toBeInViewport();
    await help.getByLabel(label('搜索功能名称或别称'), { exact: true }).press('Escape'); await expect(helpTrigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(requests).toHaveLength(0);
    await page.screenshot({ path: info.outputPath(`${english ? 'english' : 'chinese'}-${viewport.width}-${viewport.height}-controls.png`) });
  });
}

async function expectInside(panel: Locator, ai: Locator) {
  await expect.poll(async () => {
    const child = await panel.boundingBox(), parent = await ai.boundingBox();
    return !!child && !!parent && child.x >= parent.x - 1 && child.y >= parent.y - 1 && child.x + child.width <= parent.x + parent.width + 1 && child.y + child.height <= parent.y + parent.height + 1;
  }).toBe(true);
}

test('keeps Enter inside single-line skill fields from submitting the unsent chat draft', async ({ page }) => {
  const { ai, requests } = await setup(page), prompt = ai.getByLabel('任务要求', { exact: true });
  await prompt.fill('保持未发送的聊天任务');
  const panel = await openSkills(ai); await panel.getByRole('button', { name: '新建技能', exact: true }).click();
  for (const [label, value] of [['技能名称', '尚在编辑的技能'], ['适用描述', '先填写再保存'], ['推荐关键词', '核对, 改写']]) {
    const field = panel.getByLabel(label, { exact: true }); await field.fill(value); await field.press('Enter');
    await expect(prompt).toHaveValue('保持未发送的聊天任务'); expect(requests).toHaveLength(0);
    await expect(panel.getByLabel('技能名称', { exact: true })).toHaveValue('尚在编辑的技能');
  }
  const body = panel.getByRole('textbox', { name: '说明正文', exact: true }); await body.fill('第一步核对原文'); await body.press('End'); await body.press('Enter'); await body.pressSequentially('第二步等待审阅');
  await expect(body).toHaveValue('第一步核对原文\n第二步等待审阅');
  await expect(prompt).toHaveValue('保持未发送的聊天任务'); expect(requests).toHaveLength(0);
  await panel.getByRole('button', { name: '保存技能', exact: true }).focus(); await page.keyboard.press('Enter');
  expect((await savedGuidance(page)).skills[0].name).toBe('尚在编辑的技能'); expect(requests).toHaveLength(0);
});

test('rereads a recovered library rule without replacing it with the initially empty disabled draft', async ({ page }) => {
  const { ai, requests } = await setup(page, { rawGuidance: '{initially-damaged-fixture' });
  const panel = await openSkills(ai), rules = panel.getByRole('textbox', { name: '资料库默认规范', exact: true });
  await expect(rules).toBeDisabled(); await expect(rules).toHaveValue('');
  await panel.getByRole('button', { name: '关闭', exact: true }).click();
  const restored = guidance([], 'ORIGINAL_RULE_RECOVERED');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: guidanceKey(), value: restored });
  await ai.getByRole('button', { name: '重新读取规范', exact: true }).click();
  await expect(ai.getByRole('button', { name: '重新读取规范', exact: true })).toHaveCount(0);
  const reopened = await openSkills(ai);
  await expect(reopened.getByRole('textbox', { name: '资料库默认规范', exact: true })).toBeEnabled();
  await expect(reopened.getByRole('textbox', { name: '资料库默认规范', exact: true })).toHaveValue('ORIGINAL_RULE_RECOVERED');
  await expect(reopened.getByRole('button', { name: '保存资料库默认规范', exact: true })).toBeDisabled();
  expect(await savedGuidance(page)).toEqual(restored); expect(requests).toHaveLength(0);
});

for (const kind of ['reference', 'skill'] as const) {
  test(`archives an unsent ${kind}-only conversation when creating a new empty conversation`, async ({ page }) => {
    const session = createAiSession('default');
    session.conversationId = 'draft-only-conversation';
    if (kind === 'reference') session.references = [{ kind: 'symbol', id: 'example-vector' }];
    else session.skillIds = ['draft-only'];
    const { ai, requests } = await setup(page, { session, guidance: guidance([skill('draft-only')]) });
    expect((await savedSession(page)).conversationId).toBe('draft-only-conversation');
    const originalId = (await savedSession(page)).conversationId;
    await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
    await ai.getByRole('button', { name: '对话历史', exact: true }).click();
    await ai.getByRole('dialog', { name: '对话历史', exact: true }).getByRole('button', { name: '新建对话', exact: true }).click();
    await expect.poll(async () => (await savedSession(page)).conversationId).not.toBe(originalId);
    expect((await savedSession(page)).references ?? []).toEqual([]); expect((await savedSession(page)).skillIds ?? []).toEqual([]);
    await expect(ai.locator('.mewiki-ai-reference-tag:not([data-implicit])')).toHaveCount(0);
    await page.reload(); await openAiWorkspace(page);
    await ai.getByRole('button', { name: '对话历史', exact: true }).click();
    const history = ai.getByRole('dialog', { name: '对话历史', exact: true });
    await expect(history.locator('ol button')).toHaveCount(2);
    await history.locator('ol button:not([aria-current="true"])').click();
    await expect.poll(async () => (await savedSession(page)).conversationId).toBe(originalId);
    await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('');
    if (kind === 'reference') {
      await expect(ai.locator('.mewiki-ai-reference-tag')).toContainText('@状态向量');
      expect((await savedSession(page)).references).toEqual([{ kind: 'symbol', id: 'example-vector' }]);
    } else {
      const skills = await openSkills(ai);
      await expect(skills.getByRole('checkbox', { name: '本次启用技能：虚构技能 draft-only', exact: true })).toBeChecked();
      expect((await savedSession(page)).skillIds).toEqual(['draft-only']);
    }
    expect((await savedSession(page)).history).toEqual([]); expect(requests).toHaveLength(0);
  });
}

test('keeps the current symbol alongside an explicit note reference when choosing a symbol quick prompt', async ({ page }) => {
  const state = notebook(); state.view = 'dictionary';
  const { ai, requests } = await setup(page, { state });
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click();
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true });
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).fill('关系应用');
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('@关系应用');
  await ai.getByRole('button', { name: '快捷提问', exact: true }).click();
  await ai.getByRole('button', { name: '解释角标', exact: true }).click();
  await expect(ai.getByLabel('本次引用', { exact: true })).toContainText('@状态向量');
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue(/@关系应用/);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  const last = (await savedSession(page)).lastRequest;
  expect(last?.support?.references).toHaveLength(2);
  expect(last?.support?.references).toEqual(expect.arrayContaining([{ kind: 'symbol', id: 'example-vector' }, { kind: 'note', id: 'fixture-application' }]));
  expect(last?.noteIds).toEqual(['fixture-application']);
  expect(JSON.stringify(requests[0])).toContain('example-vector'); expect(JSON.stringify(requests[0])).toContain('fixture-application');
});

test('continues a complete sentence with module and note mentions and renders both as clickable inline references', async ({ page }, info) => {
  const { ai, requests } = await setup(page), prompt = ai.getByLabel('任务要求', { exact: true });
  await prompt.fill('请阅读 @符号库');
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true });
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await expect(prompt).toHaveValue('请阅读 @符号词典'); await expect(prompt).toBeFocused();
  await prompt.pressSequentially(' 中的内容，然后修改 '); await prompt.pressSequentially('@');
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).fill('关系定义');
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await prompt.pressSequentially(' 的第二段。');
  const complete = '请阅读 @符号词典 中的内容，然后修改 @关系定义 的第二段。';
  await expect(prompt).toHaveValue(complete);
  const bindings = [
    { start: complete.indexOf('@符号词典'), end: complete.indexOf('@符号词典') + '@符号词典'.length, text: '@符号词典', reference: { kind: 'module', id: 'symbols' } },
    { start: complete.indexOf('@关系定义'), end: complete.indexOf('@关系定义') + '@关系定义'.length, text: '@关系定义', reference: { kind: 'note', id: noteId } },
  ];
  await expect.poll(async () => (await savedSession(page)).inlineReferences).toEqual(bindings);
  expect((await savedSession(page)).references ?? []).toEqual([]); expect(requests).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('inline-sentence-composer.png') });
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect(requests[0].messages.at(-1)).toMatchObject({ role: 'user', content: complete });
  const session = await savedSession(page), user = session.history.find(message => message.role === 'user')!;
  expect(user.inlineReferences).toEqual(bindings); expect(user.content).toBe(complete);
  expect(session.lastRequest?.support?.references).toEqual(bindings.map(item => item.reference));
  const message = ai.locator('.mewiki-ai-message[data-role="user"]');
  await expect(message.locator('.mewiki-ai-inline-reference')).toHaveCount(2);
  await expect(message.locator('.mewiki-ai-message-references button')).toHaveCount(0);
  await message.getByRole('button', { name: '@符号词典', exact: true }).click();
  await expect(page.getByRole('tab', { name: '符号', exact: true }).first()).toHaveAttribute('aria-selected', 'true');
  await message.getByRole('button', { name: '@关系定义', exact: true }).click();
  await expect(page.getByLabel('笔记标题', { exact: true })).toHaveValue('关系定义');
  await page.screenshot({ path: info.outputPath('sentence-with-inline-object-references.png') });
});

test('inserts a picker reference at the caret, shifts its range after prefix edits and unbinds only the deleted occurrence', async ({ page }) => {
  const { ai, requests } = await setup(page), prompt = ai.getByLabel('任务要求', { exact: true });
  await prompt.fill('请检查 后面的说明');
  await prompt.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(4, 4));
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click();
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true }), search = picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true });
  await search.fill('关系应用'); await search.press('Enter');
  await expect(prompt).toHaveValue('请检查 @关系应用 后面的说明');
  await expect.poll(async () => (await savedSession(page)).inlineReferences).toEqual([{ start: 4, end: 9, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } }]);
  await prompt.press('Home'); await prompt.pressSequentially('先核对。');
  await expect.poll(async () => (await savedSession(page)).inlineReferences?.[0]).toMatchObject({ start: 8, end: 13, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } });
  await prompt.press('End'); await prompt.pressSequentially('，再核对 ');
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click(); await search.fill('关系应用'); await search.press('Enter');
  await expect.poll(async () => (await savedSession(page)).inlineReferences?.length).toBe(2);
  const first = (await savedSession(page)).inlineReferences![0];
  await prompt.evaluate((element: HTMLTextAreaElement, range) => element.setSelectionRange(range.start, range.end), first); await prompt.press('Backspace');
  await expect.poll(async () => (await savedSession(page)).inlineReferences?.length).toBe(1);
  const remaining = (await savedSession(page)).inlineReferences![0], text = await prompt.inputValue();
  expect(text.slice(remaining.start, remaining.end)).toBe('@关系应用'); expect(remaining.reference).toEqual({ kind: 'note', id: 'fixture-application' });
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.support?.references).toEqual([{ kind: 'note', id: 'fixture-application' }]);
  await prompt.fill('只是提到 @关系应用 ，没有选择引用。');
  await expect.poll(async () => (await savedSession(page)).inlineReferences ?? []).toEqual([]);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect.poll(() => requests.length).toBe(2);
  await expect(ai.locator('.mewiki-ai-message[data-role="user"]').last().locator('.mewiki-ai-inline-reference')).toHaveCount(0);
  expect((await savedSession(page)).lastRequest?.support?.references).not.toContainEqual({ kind: 'note', id: 'fixture-application' });
});

test('preserves the selected stable identity when a same-name target is renamed before sending', async ({ page }) => {
  const state = notebook(), first = state.notes.find(note => note.id === noteId)!; first.title = '同名笔记';
  state.notes.push({ ...first, id: 'same-name-selected', tags: ['另一个分组/定义'] }); state.activeNoteId = 'fixture-summary';
  const { ai, requests } = await setup(page, { state }), prompt = ai.getByLabel('任务要求', { exact: true });
  await prompt.fill('阅读 @同名笔记');
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true });
  await expect(picker.getByRole('option')).toHaveCount(2);
  await picker.getByRole('option').filter({ hasText: '另一个分组/定义' }).getByRole('button').click();
  await expect(prompt).toHaveValue('阅读 @同名笔记');
  await expect.poll(async () => (await savedSession(page)).inlineReferences?.map(item => item.reference)).toEqual([{ kind: 'note', id: 'same-name-selected' }]);
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('mewiki:research-notebook')!);
    value.notes.find((note: { id: string }) => note.id === 'same-name-selected').title = '已改名的目标';
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(value));
  });
  await page.reload(); await openAiWorkspace(page); await expect(prompt).toHaveValue('阅读 @同名笔记');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.support?.references).toEqual([{ kind: 'note', id: 'same-name-selected' }]);
  await ai.locator('.mewiki-ai-message[data-role="user"]').getByRole('button', { name: '@同名笔记', exact: true }).click();
  const target = page.locator('.research-reading-pane[data-reading-note-id="same-name-selected"]');
  await expect(target).toBeVisible(); await expect(target).toHaveAttribute('data-reading-active', 'true');
  await expect(target.locator('.research-reading-pane-header strong')).toHaveText('已改名的目标');
  expect(requests).toHaveLength(1);
});

test('preserves inline bindings when branching an edited user message and copies the complete visible sentence', async ({ page }) => {
  const { ai, requests, setResponse } = await setup(page), prompt = ai.getByLabel('任务要求', { exact: true });
  setResponse((_request, count) => textResponse(count === 1 ? '原句已收到。' : '编辑分支已收到。'));
  await prompt.fill('请检查 @关系应用');
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true }); await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await prompt.pressSequentially(' 的叙述。'); const original = '请检查 @关系应用 的叙述。';
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('原句已收到。', { exact: true })).toBeVisible();
  const originalId = (await savedSession(page)).conversationId;
  await prompt.fill('下一问草稿');
  await ai.locator('.mewiki-ai-message[data-role="user"]').getByRole('button', { name: '编辑消息', exact: true }).click();
  const edit = ai.getByLabel('编辑消息内容', { exact: true }); await expect(edit).toHaveValue(original); await edit.press('Home'); await edit.pressSequentially('再次');
  await ai.getByRole('button', { name: '重新发送', exact: true }).click(); await expect(ai.getByText('编辑分支已收到。', { exact: true })).toBeVisible();
  await expect.poll(async () => (await savedSession(page)).conversationId).not.toBe(originalId);
  await expect(prompt).toHaveValue('下一问草稿');
  const edited = await savedSession(page), user = edited.history.find(message => message.role === 'user')!;
  expect(user.content).toBe('再次' + original); expect(user.inlineReferences).toEqual([{ start: 6, end: 11, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } }]);
  expect(edited.lastRequest?.support?.references).toEqual([{ kind: 'note', id: 'fixture-application' }]);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as typeof window & { copiedInlineMessage: string }).copiedInlineMessage = value; } } }));
  const message = ai.locator('.mewiki-ai-message[data-role="user"]'); await expect(message.locator('.mewiki-ai-inline-reference')).toHaveCount(1);
  await message.getByRole('button', { name: '复制消息', exact: true }).click();
  expect(await page.evaluate(() => (window as typeof window & { copiedInlineMessage: string }).copiedInlineMessage)).toBe('再次' + original);
  await ai.getByRole('button', { name: '对话历史', exact: true }).click();
  await ai.getByRole('dialog', { name: '对话历史', exact: true }).getByRole('button', { name: original, exact: true }).click();
  await expect.poll(async () => (await savedSession(page)).conversationId).toBe(originalId);
  expect((await savedSession(page)).history.find(message => message.role === 'user')?.inlineReferences).toEqual([{ start: 4, end: 9, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } }]);
  expect(requests).toHaveLength(2);
});

for (const editor of ['composer', 'message'] as const) {
  test(`native deletion of the first same-name mention preserves the second identity in the ${editor} editor`, async ({ page }) => {
    const state = notebook(), first = state.notes.find(note => note.id === noteId)!; first.title = '同名笔记';
    state.notes.push({ ...first, id: 'same-name-second', tags: ['另一个分组/定义'] }); state.activeNoteId = 'fixture-summary';
    const token = '@同名笔记', original = `${token} ${token}`, session = createAiSession('default');
    session.draft = original;
    session.inlineReferences = [
      { start: 0, end: token.length, text: token, reference: { kind: 'note', id: noteId } },
      { start: token.length + 1, end: original.length, text: token, reference: { kind: 'note', id: 'same-name-second' } },
    ];
    const originalBindings = structuredClone(session.inlineReferences);
    const { ai, requests } = await setup(page, { state, session }), prompt = ai.getByLabel('任务要求', { exact: true });
    await expect(prompt).toHaveValue(original);
    let input = prompt, originalId: string | undefined;
    if (editor === 'message') {
      await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
      originalId = (await savedSession(page)).conversationId;
      await prompt.fill('同名引用编辑后的下一问草稿');
      await ai.locator('.mewiki-ai-message[data-role="user"]').getByRole('button', { name: '编辑消息', exact: true }).click();
      input = ai.getByLabel('编辑消息内容', { exact: true }); await expect(input).toHaveValue(original);
    }
    await input.evaluate((element: HTMLTextAreaElement, end) => element.setSelectionRange(0, end), token.length + 1);
    await input.press('Backspace'); await expect(input).toHaveValue(token);
    const remaining = [{ start: 0, end: token.length, text: token, reference: { kind: 'note', id: 'same-name-second' } }];
    if (editor === 'composer') {
      await expect.poll(async () => (await savedSession(page)).inlineReferences).toEqual(remaining);
      await ai.getByRole('button', { name: '发送消息', exact: true }).click();
    } else await ai.getByRole('button', { name: '重新发送', exact: true }).click();
    await expect.poll(() => requests.length).toBe(editor === 'composer' ? 1 : 2);
    await expect(ai.getByText('虚构任务已完成。', { exact: true }).last()).toBeVisible();
    const saved = await savedSession(page), user = saved.history.find(message => message.role === 'user')!;
    expect(user.content).toBe(token); expect(user.inlineReferences).toEqual(remaining);
    expect(saved.lastRequest?.support?.references).toEqual([{ kind: 'note', id: 'same-name-second' }]);
    await ai.locator('.mewiki-ai-message[data-role="user"]').getByRole('button', { name: token, exact: true }).click();
    await expect(page.locator('.research-reading-pane[data-reading-note-id="same-name-second"]')).toBeVisible();
    if (editor === 'message') {
      expect(saved.conversationId).not.toBe(originalId); await expect(prompt).toHaveValue('同名引用编辑后的下一问草稿');
      await ai.getByRole('button', { name: '对话历史', exact: true }).click();
      await ai.getByRole('dialog', { name: '对话历史', exact: true }).getByRole('button', { name: original, exact: true }).click();
      await expect.poll(async () => (await savedSession(page)).conversationId).toBe(originalId);
      expect((await savedSession(page)).history.find(message => message.role === 'user')?.inlineReferences).toEqual(originalBindings);
    }
  });
}

test('preserves two stable references through successive message edits, a saved edit draft and reload', async ({ page }) => {
  const original = '请阅读 @符号词典，再检查 @关系应用。', session = createAiSession('default');
  session.draft = original;
  session.inlineReferences = [
    { start: original.indexOf('@符号词典'), end: original.indexOf('@符号词典') + '@符号词典'.length, text: '@符号词典', reference: { kind: 'module', id: 'symbols' } },
    { start: original.indexOf('@关系应用'), end: original.indexOf('@关系应用') + '@关系应用'.length, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } },
  ];
  const bindings = structuredClone(session.inlineReferences);
  const { ai, requests } = await setup(page, { session });
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  const originalId = (await savedSession(page)).conversationId;
  await ai.locator('.mewiki-ai-message[data-role="user"]').getByRole('button', { name: '编辑消息', exact: true }).click();
  const edit = ai.getByLabel('编辑消息内容', { exact: true });
  await edit.press('Control+Home'); await edit.pressSequentially('先');
  await edit.press('Control+End'); await edit.pressSequentially('请谨慎。');
  const draft = '先' + original + '请谨慎。';
  const shiftedOnce = bindings.map(item => ({ ...item, start: item.start + 1, end: item.end + 1 }));
  await expect.poll(async () => (await savedSession(page)).messageEdit).toMatchObject({ content: draft, inlineReferences: shiftedOnce });
  await page.reload(); await openAiWorkspace(page);
  await expect(edit).toHaveValue(draft); expect(requests).toHaveLength(1);
  expect((await savedSession(page)).messageEdit?.inlineReferences).toEqual(shiftedOnce);
  await edit.press('Control+Home'); await edit.pressSequentially('现在');
  await edit.press('Control+End'); await edit.pressSequentially('再次核对。');
  const edited = '现在' + draft + '再次核对。';
  const shifted = bindings.map(item => ({ ...item, start: item.start + 3, end: item.end + 3 }));
  await expect.poll(async () => (await savedSession(page)).messageEdit).toMatchObject({ content: edited, inlineReferences: shifted });
  await ai.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  const result = await savedSession(page), user = result.history.find(message => message.role === 'user')!;
  expect(result.conversationId).not.toBe(originalId); expect(user.content).toBe(edited); expect(user.inlineReferences).toEqual(shifted);
  expect(result.lastRequest?.support?.references).toEqual(bindings.map(item => item.reference));
  expect(requests[1].messages.at(-1)).toMatchObject({ role: 'user', content: edited });
  await expect(ai.locator('.mewiki-ai-message[data-role="user"] .mewiki-ai-inline-reference')).toHaveCount(2);
});

test('blocks a damaged inline draft until references are cleared, preserving the sentence for explicit rebinding', async ({ page }) => {
  const original = '保留这段文字，检查 @关系应用。', session = createAiSession('default');
  session.draft = original;
  session.inlineReferences = [{ start: original.length + 1, end: original.length + 6, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } }];
  const { ai, requests } = await setup(page, { session }), prompt = ai.getByLabel('任务要求', { exact: true });
  await expect(prompt).toHaveValue(original);
  await expect(ai.getByRole('alert').filter({ hasText: '句内引用已失效' })).toBeVisible();
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await page.reload(); await openAiWorkspace(page);
  await expect.poll(async () => (await savedSession(page)).inlineReferencesInvalid).toBe(true);
  await expect(prompt).toHaveValue(original); await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
  await ai.getByRole('button', { name: '清除失效引用', exact: true }).click();
  await expect(prompt).toHaveValue(original);
  await expect(ai.getByRole('alert').filter({ hasText: '句内引用已失效' })).toHaveCount(0);
  await expect(ai.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  expect((await savedSession(page)).inlineReferencesInvalid).toBeUndefined(); expect((await savedSession(page)).inlineReferences).toEqual([]);
  const start = original.indexOf('@关系应用');
  await prompt.focus(); await prompt.evaluate((element: HTMLTextAreaElement, start) => element.setSelectionRange(start, start + '@关系应用'.length), start);
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click();
  const search = ai.getByRole('dialog', { name: '添加对象引用', exact: true }).getByLabel('搜索笔记、符号、术语或地图', { exact: true });
  await search.fill('关系应用'); await search.press('Enter'); await expect(prompt).toHaveValue(original);
  const expected = [{ start, end: start + '@关系应用'.length, text: '@关系应用', reference: { kind: 'note', id: 'fixture-application' } }];
  await expect.poll(async () => (await savedSession(page)).inlineReferences).toEqual(expected); expect(requests).toHaveLength(0);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  const result = await savedSession(page);
  expect(result.history.find(message => message.role === 'user')?.inlineReferences).toEqual(expected);
  expect(result.lastRequest?.support?.references).toEqual([{ kind: 'note', id: 'fixture-application' }]); expect(requests).toHaveLength(1);
});

test('unbinds a reference replaced with identical text through native input events without changing the visible sentence', async ({ page }) => {
  const token = '@关系应用', sentence = `检查 ${token} 的说明。`, start = sentence.indexOf(token), session = createAiSession('default');
  session.draft = sentence;
  session.inlineReferences = [{ start, end: start + token.length, text: token, reference: { kind: 'note', id: 'fixture-application' } }];
  const { ai, requests } = await setup(page, { session }), prompt = ai.getByLabel('任务要求', { exact: true });
  await expect(prompt).toHaveValue(sentence);
  await prompt.evaluate((element: HTMLTextAreaElement, { start, token }) => {
    element.focus(); element.setSelectionRange(start, start + token.length);
    element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertFromPaste', data: token }));
    element.setRangeText(token, start, start + token.length, 'end');
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertFromPaste', data: token }));
  }, { start, token });
  await expect(prompt).toHaveValue(sentence);
  await expect.poll(async () => (await savedSession(page)).inlineReferences).toEqual([]);
  expect((await savedSession(page)).draft).toBe(sentence); expect(requests).toHaveLength(0);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click(); await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  const result = await savedSession(page), user = result.history.find(message => message.role === 'user')!;
  expect(user.content).toBe(sentence); expect(user.inlineReferences ?? []).toEqual([]);
  expect(result.lastRequest?.support?.references ?? []).not.toContainEqual({ kind: 'note', id: 'fixture-application' });
  await expect(ai.locator('.mewiki-ai-message[data-role="user"] .mewiki-ai-inline-reference')).toHaveCount(0);
});

test('removes the default context without restoring it after navigation or reload, and re-adds a stable current object through @', async ({ page }, info) => {
  const { ai, requests } = await setup(page);
  await expect(ai.getByRole('combobox', { name: '资料范围', exact: true })).toHaveCount(0);
  await expect(ai.getByLabel('本次引用', { exact: true })).toContainText('当前笔记 · 关系定义');
  await ai.getByRole('button', { name: '移除引用：关系定义', exact: true }).click();
  await page.locator('#research-notebook-sidebar').getByRole('button', { name: '结果摘要', exact: true }).click();
  await expect(ai.getByLabel('本次引用', { exact: true })).toHaveCount(0);
  await page.reload(); await openAiWorkspace(page);
  await expect(ai.getByLabel('本次引用', { exact: true })).toHaveCount(0);
  await send(ai, '只讨论一般方法');
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual([]);
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click();
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true });
  await picker.getByRole('button', { name: '当前笔记', exact: true }).click();
  await expect(ai.getByLabel('本次引用', { exact: true })).toContainText('@结果摘要');
  await page.locator('#research-notebook-sidebar').getByRole('button', { name: '关系定义', exact: true }).click();
  await expect(ai.getByLabel('本次引用', { exact: true })).toContainText('@结果摘要');
  await page.screenshot({ path: info.outputPath('unified-current-object-reference.png') });
  await send(ai, '只阅读已引用对象');
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual(['fixture-summary']);
  expect(requests).toHaveLength(2);
});

test('authorizes an inline target alone and refuses a read of the open note', async ({ page }) => {
  const { ai, requests, setResponse } = await setup(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('只修改 @结果摘要');
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true });
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await expect(ai.getByRole('button', { name: '移除引用：关系定义', exact: true })).toHaveCount(0);
  setResponse((_request, count) => count === 1 ? done({ role: 'assistant', content: '', toolCalls: [tool('read_note', { noteId }), tool('get_capabilities', {})] }) : textResponse('只使用明确引用的笔记。'));
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('只使用明确引用的笔记。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual(['fixture-summary']);
  const results = requests[1].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
  expect(results.some(result => result.error?.includes('不在本次授权范围内'))).toBe(true);
  expect(results.some(result => result.noteCount === 1)).toBe(true);
});

for (const english of [false, true]) test(`uses the single @ entry for visible, removable library search in ${english ? 'English' : 'Chinese'}`, async ({ page }, info) => {
  const label = (value: string) => translate(value, [], english ? 'en' : 'zh-CN');
  const { ai, requests } = await setup(page, { english });
  const prompt = ai.getByLabel(label('任务要求'), { exact: true });
  await prompt.fill('跨笔记检查 @资料库');
  const picker = ai.getByRole('dialog', { name: label('添加对象引用'), exact: true });
  await picker.getByRole('button', { name: label('整库检索'), exact: true }).click();
  await expect(prompt).toHaveValue('跨笔记检查 '); await expect(prompt).toBeFocused();
  await expect(ai.locator('.mewiki-ai-reference-tag[data-scope="library"]')).toHaveText(label('整库检索'));
  await expect(ai.locator('.mewiki-ai-reference-tag[data-implicit]')).toHaveCount(0);
  await ai.getByRole('button', { name: label('添加对象引用'), exact: true }).click();
  await expect(picker.getByRole('button', { name: label('整库检索'), exact: true })).toHaveAttribute('aria-pressed', 'true');
  await picker.getByLabel(label('搜索笔记、符号、术语或地图'), { exact: true }).press('Escape');
  await page.reload(); await openAiWorkspace(page, english);
  await expect(ai.locator('.mewiki-ai-reference-tag[data-scope="library"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`unified-library-search-${english ? 'en' : 'zh'}.png`) });
  await ai.getByRole('button', { name: label('移除整库检索'), exact: true }).click();
  await expect(ai.getByLabel(label('本次引用'), { exact: true })).toHaveCount(0);
  await ai.getByRole('button', { name: label('发送消息'), exact: true }).click();
  await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual([]); expect(requests).toHaveLength(1);
});

test('freezes library scope for retry and old-message edits while preserving the next draft context', async ({ page }) => {
  const { ai, requests, setResponse } = await setup(page);
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click();
  await ai.getByRole('dialog', { name: '添加对象引用', exact: true }).getByRole('button', { name: '整库检索', exact: true }).click();
  setResponse((_request, count) => count === 1 ? JSON.stringify({ type: 'error', error: '虚构网络中断', failure: { kind: 'network', recovery: 'retry' } }) + '\n' : textResponse('原资料范围任务完成。'));
  await ai.getByLabel('任务要求', { exact: true }).fill('跨笔记检索');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByRole('button', { name: '重试任务', exact: true })).toBeEnabled();
  const frozen = (await savedSession(page)).lastRequest;
  expect(frozen?.support?.scope).toBe('library'); expect(frozen?.noteIds).toContain('fixture-summary');
  await ai.getByRole('button', { name: '移除整库检索', exact: true }).click();
  await ai.getByLabel('任务要求', { exact: true }).fill('下一问 @关系应用');
  await ai.getByRole('dialog', { name: '添加对象引用', exact: true }).getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await page.reload(); await openAiWorkspace(page);
  await ai.getByRole('button', { name: '重试任务', exact: true }).click();
  await expect(ai.getByText('原资料范围任务完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest).toEqual(frozen);
  await expect(ai.getByLabel('任务要求', { exact: true })).toHaveValue('下一问 @关系应用');
  await ai.getByRole('button', { name: '编辑消息', exact: true }).first().click();
  await ai.getByLabel('编辑消息内容', { exact: true }).fill('重新检查整库');
  await ai.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(ai.getByText('原资料范围任务完成。', { exact: true }).last()).toBeVisible();
  const edited = await savedSession(page);
  expect(edited.lastRequest?.support?.scope).toBe('library'); expect(edited.lastRequest?.noteIds).toEqual(frozen?.noteIds);
  expect(edited.inlineReferences?.[0].reference.id).toBe('fixture-application');
  expect(edited.libraryScope).toBeUndefined(); expect(requests).toHaveLength(3);
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(async () => (await savedSession(page)).history.filter(message => message.role === 'user').length).toBe(2);
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual(['fixture-application']);
});

test('keeps the selection card as the visible boundary and disables library expansion in the @ menu', async ({ page }) => {
  const state = notebook(), selection = createAiTextSelection(state, 'default', noteId, ['fixture-definition:text'], '通用');
  const { ai, requests } = await setup(page, { state, session: { ...createAiSession('default'), selection, draft: '只解释选区' } });
  await expect(ai.getByRole('group', { name: '选中文字', exact: true })).toContainText('关系定义');
  await expect(ai.getByRole('combobox', { name: '资料范围', exact: true })).toHaveCount(0);
  await ai.getByRole('button', { name: '添加对象引用', exact: true }).click();
  const picker = ai.getByRole('dialog', { name: '添加对象引用', exact: true });
  await expect(picker.getByRole('button', { name: '整库检索', exact: true })).toBeDisabled();
  await picker.getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Escape');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual([noteId]);
  expect((await savedSession(page)).history[0].selection?.text).toBe('通用'); expect(requests).toHaveLength(1);
});

for (const metadata of [false, true]) test(`recovers the exact legacy ${metadata ? 'multiple-note' : 'single-note'} sources visibly before editing a message`, async ({ page }) => {
  const state = notebook(); state.activeNoteId = 'fixture-results';
  const ids = [noteId, ...(metadata ? ['fixture-summary'] : [])];
  const task = beginAiChatTask(createAiSession('default'), provider, provider.model, '旧版本的提问', ids, state, metadata ? { references: [{ kind: 'note', id: noteId }], guidance: { instructions: '', skills: [] } } : undefined);
  const session: AiSession = { ...task.session, status: 'complete', history: task.session.history.map(message => message.role === 'assistant' ? { ...message, content: '旧版本的答复', status: 'complete' } : message) };
  const { ai, requests } = await setup(page, { state, session });
  await ai.getByRole('button', { name: '编辑消息', exact: true }).first().click();
  await expect(ai.getByLabel('原消息引用', { exact: true })).toContainText(metadata ? '@结果摘要' : '@关系定义');
  await ai.getByLabel('编辑消息内容', { exact: true }).fill('保持原来源重新阅读');
  await ai.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual(ids);
  expect((await savedSession(page)).history.find(message => message.role === 'user')?.libraryScope).toBe(false);
  expect(requests).toHaveLength(1);
});

test('keeps an unprovable legacy message editable but requires explicit source selection before a new send', async ({ page }) => {
  const state = notebook(), task = beginAiChatTask(createAiSession('default'), provider, provider.model, '来源记录不完整的旧提问', [noteId], state);
  const { ai, requests } = await setup(page, { session: { ...task.session, status: 'complete', lastRequest: undefined } });
  await ai.getByRole('button', { name: '编辑消息', exact: true }).first().click();
  await expect(ai.getByLabel('编辑消息内容', { exact: true })).toHaveValue('来源记录不完整的旧提问');
  await expect(ai.getByRole('button', { name: '重新发送', exact: true })).toBeDisabled();
  await expect(ai.getByRole('alert').filter({ hasText: '旧消息的资料范围无法完整恢复' })).toBeVisible();
  expect(requests).toHaveLength(0);
  await ai.getByRole('button', { name: '取消编辑', exact: true }).click();
  await ai.getByLabel('任务要求', { exact: true }).fill('重新确定来源 @关系定义');
  await ai.getByRole('dialog', { name: '添加对象引用', exact: true }).getByLabel('搜索笔记、符号、术语或地图', { exact: true }).press('Enter');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(ai.getByText('虚构任务已完成。', { exact: true })).toBeVisible();
  expect((await savedSession(page)).lastRequest?.noteIds).toEqual([noteId]);
});
