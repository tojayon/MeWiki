import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AiNativeProposalReview from '../components/AiNativeProposalReview.tsx';
import { DeleteConfirmationProvider } from '../components/DeleteConfirmation.tsx';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { defaultTabsAppearance } from '../domain/researchExamples.ts';
import { addTheoryMapDocument } from '../domain/researchTheoryMap.ts';
import { createTermEntry } from '../domain/researchTerms.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { applyNativeProposal, createNativeProposal } from './nativeProposals.ts';
import { nativeEntity } from './nativeEdits.ts';

function renderReview(state: ResearchNotebookState, input: unknown, source = false, presentation: Partial<ComponentProps<typeof AiNativeProposalReview>> = {}) {
  const saved = JSON.stringify(state);
  const proposal = createNativeProposal(state, 'a', input);
  const result = applyNativeProposal(state, proposal, 'a');
  const html = renderToStaticMarkup(createElement(DeleteConfirmationProvider, null, createElement(AiNativeProposalReview, {
    proposal, before: proposal.before, after: nativeEntity(result.state, proposal.target, proposal.targetId),
    state: result.state, originalState: state, source, onOpenNote() {}, ...presentation,
  })));
  expect(JSON.stringify(state)).toBe(saved);
  return { html, proposal, result };
}
const occurrences = (html: string, text: string) => html.split(text).length - 1;
function nestedFixture() {
  const state = createNotebookFixture();
  state.notes.find(note => note.id === 'fixture-definition')!.blocks = [
    { id: 'before', type: 'paragraph', text: '保留的前文。' },
    { id: 'tabs', type: 'examples', title: '推导步骤', appearance: { ...defaultTabsAppearance }, tabs: [
      { id: 'tab-a', title: '原标签名', blocks: [
        { id: 'inside-before', type: 'paragraph', text: '标签中的前文。' },
        { id: 'inside', type: 'paragraph', text: '原来的说明。' },
        { id: 'inside-after', type: 'paragraph', text: '标签中的后文。' },
      ] },
      { id: 'tab-b', title: '第二标签', blocks: [{ id: 'sibling', type: 'paragraph', text: '另一标签中的内容。' }] },
      { id: 'tab-c', title: '第三标签', blocks: [{ id: 'last', type: 'paragraph', text: '末尾标签内容。' }] },
    ] },
    { id: 'after', type: 'paragraph', text: '保留的后文。' },
  ];
  return state;
}

describe('native operation review', () => {
  it('compares a complete note projection without requiring an individual operation', () => {
    const state = nestedFixture(), note = state.notes.find(note => note.id === 'fixture-definition')!;
    const after = structuredClone(note), tabs = after.blocks[1];
    if (tabs.type !== 'examples' || after.blocks[0].type !== 'paragraph') throw new Error('Expected fixture shape');
    after.blocks[0].text = '**一并修改的前文**。';
    tabs.tabs[0].blocks = [{ id: 'inside', type: 'paragraph', text: '**修改的第一页**。' }];
    tabs.tabs[1].blocks = [{ id: 'sibling', type: 'paragraph', text: '**修改的第二页**。' }];
    const render = (tabId: string) => renderToStaticMarkup(createElement(DeleteConfirmationProvider, null, createElement(AiNativeProposalReview, {
      proposal: { target: 'note', targetId: note.id, title: note.title }, before: note, after,
      state: { ...state, notes: state.notes.map(item => item.id === note.id ? after : item) }, originalState: state, source: false, onOpenNote() {}, selectedTabs: { tabs: tabId },
    })));
    for (const tabId of ['tab-a', 'tab-b']) {
      const html = render(tabId);
      expect(html).toContain('<strong>一并修改的前文</strong>');
      expect(occurrences(html, 'role="tablist"')).toBe(1);
      expect(occurrences(html, 'role="tabpanel"')).toBe(1);
      expect(html).toContain(tabId === 'tab-a' ? '<strong>修改的第一页</strong>' : '<strong>修改的第二页</strong>');
      expect(html).not.toContain(tabId === 'tab-a' ? '<strong>修改的第二页</strong>' : '<strong>修改的第一页</strong>');
    }
  });

  it('does not hide a heading-level edit behind an empty text diff', () => {
    const state = nestedFixture();
    state.notes.find(note => note.id === 'fixture-definition')!.blocks = [{ id: 'heading', type: 'heading', level: 2, text: '标题原文' }];
    const { html } = renderReview(state, { action: 'block-update', noteId: 'fixture-definition', blockId: 'heading', fields: { level: 3 } });
    expect(html).toContain('<h2>标题原文</h2>');
    expect(html).toContain('<h3>标题原文</h3>');
  });

  it('keeps the native tab container and selects a hidden edited page instead of expanding every page', () => {
    const { html } = renderReview(nestedFixture(), { action: 'block-update', noteId: 'fixture-definition', blockId: 'sibling', fields: { text: '**更新的第二页**。' } });
    expect(occurrences(html, 'role="tablist"')).toBe(1);
    expect(occurrences(html, 'role="tabpanel"')).toBe(1);
    expect(occurrences(html, 'class="research-examples-label"')).toBe(1);
    expect(html).toMatch(/data-example-id="tab-b" aria-selected="true"/);
    expect(html).toContain('<strong>更新的第二页</strong>');
    expect(html).not.toContain('标签中的前文。');
    expect(html).not.toContain('末尾标签内容。');
  });

  it('renders a removed container as one selectable tab group', () => {
    const { html } = renderReview(nestedFixture(), { action: 'block-delete', noteId: 'fixture-definition', blockId: 'tabs' });
    expect(occurrences(html, 'role="tablist"')).toBe(1);
    expect(occurrences(html, 'role="tabpanel"')).toBe(1);
    expect(html).toContain('data-kind="remove"');
    expect(html).not.toContain('末尾标签内容。');
  });

  it('renders formula changes using the note renderer and preserves the block identity', () => {
    const { html } = renderReview(createNotebookFixture(), { action: 'block-update', noteId: 'fixture-application', blockId: 'fixture-application:formula', fields: { tex: 'E=mc^2', parts: [] } });
    expect(html).toContain('data-native-review="note"');
    expect(html).toContain('data-review-block-id="fixture-application:formula"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('data-kind="remove"');
    expect(html).toContain('data-kind="add"');
    expect(html).toContain('E=mc^2');
    expect(html).not.toContain('&quot;tex&quot;');
  });

  it('renders lists and tables as content on both sides', () => {
    const state = createNotebookFixture();
    const note = state.notes.find(note => note.id === 'fixture-definition')!;
    note.blocks = [{ id: 'list', type: 'list', items: ['旧条件'] }, { id: 'table', type: 'markdown', kind: 'table', text: '| 项 | 值 |\n| --- | --- |\n| 旧值 | 1 |' }];
    const list = renderReview(state, { action: 'block-update', noteId: note.id, blockId: 'list', fields: { items: ['**有效条件**', '[参考](https://example.test/source)'] } }).html;
    expect(list).toContain('<ul');
    expect(list).toContain('<strong>有效条件</strong>');
    expect(list).toContain('href="https://example.test/source"');
    expect(list).not.toContain('**有效条件**');
    const table = renderReview(state, { action: 'block-update', noteId: note.id, blockId: 'table', fields: { text: '| 项 | 值 |\n| --- | --- |\n| 新值 | 2 |' } }).html;
    expect(occurrences(table, '<table>')).toBe(2);
    expect(table).toMatch(/<ins[^>]*>新<\/ins>值/);
    expect(table).not.toContain('| 新值 |');
  });

  it('marks only the changed nested block and renders sibling content once', () => {
    const { html } = renderReview(nestedFixture(), { action: 'block-update', noteId: 'fixture-definition', blockId: 'inside', fields: { text: '**改后的说明**。' } });
    expect(html).toContain('data-review-block-id="inside" data-review-changed="true"');
    expect(html).toContain('data-review-tab-id="tab-a"');
    expect(html).toContain('<strong>改后的说明</strong>');
    for (const text of ['保留的前文。', '保留的后文。', '标签中的前文。', '标签中的后文。']) expect(occurrences(html, text)).toBe(1);
    expect(html).not.toContain('另一标签中的内容。');
    expect(html).not.toContain('末尾标签内容。');
  });

  it('compares a renamed tab without duplicating its unchanged contents', () => {
    const { html } = renderReview(nestedFixture(), { action: 'tab-update', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'tab-a', title: '新标签名' });
    expect(html).toContain('data-review-tab-id="tab-a"');
    expect(html).toMatch(/<del[^>]*>原标签名<\/del>/);
    expect(html).toMatch(/<ins[^>]*>新标签名<\/ins>/);
    expect(occurrences(html, '原来的说明。')).toBe(1);
    expect(html).not.toContain('另一标签中的内容。');
  });

  it('keeps a deleted nested block between its original neighbours', () => {
    const { html } = renderReview(nestedFixture(), { action: 'block-delete', noteId: 'fixture-definition', blockId: 'inside' });
    expect(html.indexOf('标签中的前文。')).toBeLessThan(html.indexOf('原来的说明。'));
    expect(html.indexOf('原来的说明。')).toBeLessThan(html.indexOf('标签中的后文。'));
    expect(html).toContain('data-review-block-id="inside" data-review-changed="true"');
    expect(html).toContain('data-kind="remove"');
    expect(html).not.toContain('data-kind="add"');
    expect(html).not.toContain('另一标签中的内容。');
  });

  it('keeps a deleted tab in place with its contents and no added markers', () => {
    const { html } = renderReview(nestedFixture(), { action: 'tab-delete', noteId: 'fixture-definition', blockId: 'tabs', tabId: 'tab-b' });
    expect(html).toContain('另一标签中的内容。');
    expect(html).not.toContain('原来的说明。');
    expect(html).not.toContain('末尾标签内容。');
    expect(html.indexOf('data-example-id="tab-a"')).toBeLessThan(html.indexOf('data-example-id="tab-b"'));
    expect(html.indexOf('data-example-id="tab-b"')).toBeLessThan(html.indexOf('data-example-id="tab-c"'));
    expect(html).toContain('data-review-tab-id="tab-b"');
    expect(html).toContain('data-kind="remove"');
    expect(html).not.toContain('data-kind="add"');
    expect(html).toMatch(/<del[^>]*>第二标签<\/del>/);
  });

  it('shows only the moved block at its old and new positions', () => {
    const input = { action: 'block-move', noteId: 'fixture-definition', blockId: 'inside', container: { exampleBlockId: 'tabs', tabId: 'tab-b' } };
    const { html } = renderReview(nestedFixture(), input);
    expect(occurrences(html, 'data-review-block-id="inside"')).toBe(1);
    expect(occurrences(html, '原来的说明。')).toBe(1);
    expect(html).toContain('data-kind="add"');
    expect(occurrences(html, '另一标签中的内容。')).toBe(1);
    expect(html).not.toContain('标签中的前文。');
    const originalTab = renderReview(nestedFixture(), input, false, { selectedTabs: { tabs: 'tab-a' } }).html;
    expect(occurrences(originalTab, 'data-review-block-id="inside"')).toBe(1);
    expect(originalTab).toContain('data-kind="remove"');
    expect(occurrences(originalTab, '标签中的前文。')).toBe(1);
  });

  it('renders symbol templates before and after, with readable complete slot fields', () => {
    const state = createNotebookFixture(), symbol = state.symbols.find(item => item.id === 'example-matrix')!;
    const { html } = renderReview(state, { action: 'symbol-save', entryId: symbol.id, fields: {
      notation: '\\boldsymbol{M}^{[x1]}_{[x2]}[x3]', unit: '无量纲', scope: '线性系统', category: 'state',
      slots: symbol.slots.map((slot, index) => ({ key: slot.key, defaultValue: index === 1 ? 'k' : slot.defaultValue,
        ...(index === 1 ? { description: '矩阵所属的对象' } : slot.description ? { description: slot.description } : {}) })),
    } });
    expect(html).toContain('data-native-review="symbol"');
    for (const text of ['单位', '无量纲', '线性系统', '右下角标 x2', '矩阵所属的对象', '默认值', '可选', '索引域', '状态']) expect(html).toContain(text);
    expect(html).toContain('data-review-entry-id="x2"');
    expect(occurrences(html, 'class="katex"')).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('^{[x1]}');
  });

  it('compares every term field while keeping stable alias and atom identities', () => {
    const state = createNotebookFixture();
    state.terms = [createTermEntry({ name: '闭环', meaning: '**反馈**结构', englishName: 'Closed loop', aliases: [],
      aliasEntries: [{ id: 'alias-1', name: '旧别名' }], atoms: [{ id: 'atom-1', text: '闭', meaning: '闭合' }, { id: 'atom-2', text: '环', meaning: '环路' }] }, 'closed-loop')];
    const { html } = renderReview(state, { action: 'term-save', entryId: 'closed-loop', fields: {
      englishName: '', englishAbbreviation: 'CL', chineseAbbreviation: '闭环', aliasEntries: [{ id: 'alias-1', name: '新别名' }],
      atoms: [{ id: 'atom-1', text: '闭', meaning: '闭合的路径' }, { id: 'atom-2', text: '环', meaning: '环路' }], tags: ['控制'], scope: '控制系统', status: 'deprecated',
    } });
    for (const value of ['英文名称', 'Closed loop', '英文缩写', 'CL', '中文缩写', '别名', '新别名', '原子词汇', '闭合的路径', '适用范围', '控制系统', '标签', '控制', '状态', '已停用']) expect(html.replace(/<[^>]*>/g, '')).toContain(value);
    expect(html).toContain('data-review-entry-id="alias-1"');
    expect(html).toContain('data-review-entry-id="atom-1"');
    expect(occurrences(html, '环路')).toBe(1);
  });

  it('shows map relations using note and block names without duplicating unchanged relations', () => {
    const state = addTheoryMapDocument(createNotebookFixture(), '推导地图', ['fixture-definition', 'fixture-application', 'fixture-summary']);
    const map = state.theoryMaps!.documents.find(item => item.id === state.theoryMaps!.activeMapId)!;
    map.relations = [
      { id: 'relation-kept', source: { noteId: 'fixture-definition' }, target: { noteId: 'fixture-summary' }, kind: 'assumption', description: '保留的关系说明' },
      { id: 'relation-edit', source: { noteId: 'fixture-definition', blockId: 'fixture-definition:text' }, target: { noteId: 'fixture-application', blockId: 'fixture-application:formula' }, kind: 'derivation', description: '原关系说明' },
    ];
    const { html } = renderReview(state, { action: 'relation-save', mapId: map.id, relationId: 'relation-edit', fields: {
      source: { noteId: 'fixture-definition', blockId: 'fixture-definition:text' }, target: { noteId: 'fixture-application', blockId: 'fixture-application:formula' }, kind: 'adaptation', description: '修改后的关系说明',
    } });
    for (const text of ['关系定义', '关系应用', '通用内容。', '场景适配']) expect(html).toContain(text);
    expect(html).toContain('data-review-entry-id="relation-edit"');
    expect(occurrences(html, '保留的关系说明')).toBe(1);
    expect(html).not.toContain('>fixture-definition:text<');
  });

  it('also reviews theory relations stored on a note', () => {
    const { html } = renderReview(createNotebookFixture(), { action: 'relation-save', noteId: 'fixture-application', fields: {
      source: { noteId: 'fixture-definition' }, target: { noteId: 'fixture-application' }, kind: 'derivation', description: '**新增关系说明**',
    } });
    for (const text of ['理论关系', '<strong>新增关系说明</strong>', '关系定义', '关系应用']) expect(html).toContain(text);
  });

  it('shows a removed symbol as a rendered red deletion', () => {
    const state = createNotebookFixture();
    state.notes = state.notes.map(note => ({ ...note, blocks: [] }));
    const { html } = renderReview(state, { action: 'symbol-delete', entryId: 'example-matrix' });
    expect(html).toContain('class="katex"');
    expect(html).toContain('data-kind="remove"');
    expect(html).not.toContain('data-kind="add"');
    expect(html).not.toContain('^{[x1]}');
  });

  it('shows line source for text while keeping the surrounding tabs native', () => {
    const { html } = renderReview(nestedFixture(), { action: 'block-update', noteId: 'fixture-definition', blockId: 'inside', fields: { text: '修改后的文字。' } }, true);
    expect(html).toContain('mewiki-ai-diff-number');
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/<ins[^>]*>修改后<\/ins>/);
    expect(html).not.toContain('&quot;tabs&quot;');
  });
});
