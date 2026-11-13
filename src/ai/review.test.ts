import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AiProposalReview from '../components/AiProposalReview.tsx';
import { DeleteConfirmationProvider } from '../components/DeleteConfirmation.tsx';
import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { createNoteProposal, createTermProposal } from './proposals.ts';
import { applyAiProposalGroup } from './proposalGroup.ts';
import { rebaseAiReviewProposals } from './reviewDecisions.ts';
import { createNativeProposal } from './nativeProposals.ts';

const renderReview = (props: Pick<ComponentProps<typeof AiProposalReview>, 'state' | 'proposal'> & Partial<ComponentProps<typeof AiProposalReview>>) => renderToStaticMarkup(createElement(DeleteConfirmationProvider, null, createElement(AiProposalReview, {
  proposals: props.proposal ? [props.proposal] : [], libraryId: 'a', changes: [], disabledReason: '', mutating: false,
  onApply() {}, onClose() {}, onSelect() {}, onOpenNote() {}, ...props,
})));

function fiveTabFixture() {
  const state = createNotebookFixture();
  const note = state.notes.find(item => item.id === 'fixture-definition')!;
  note.blocks = [{ id: 'events', type: 'examples', title: '控制闭环通信事件', tabs: Array.from({ length: 5 }, (_, index) => ({
    id: `event-${index}`, title: `事件 ${index + 1}`, blocks: index === 3 ? [{ id: 'target', type: 'paragraph' as const, text: '原来的事件说明。' }] : [],
  })) }];
  return { state, note };
}

describe('AI proposal rendering', () => {
  it('places independent decision controls at the changed text and native tab, with no duplicate container controls', () => {
    const { state, note } = fiveTabFixture();
    const text = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'target', content: '待审文字' });
    const tab = createNativeProposal(state, 'a', { action: 'tab-update', noteId: note.id, blockId: 'events', tabId: 'event-3', title: '待审页签' });
    const html = renderReview({ state, proposal: text, proposals: [text, tab], onApplyItem() {}, onReject() {}, onRevise: async () => true });
    expect(html.match(/aria-label="同意此修改"/g)).toHaveLength(2);
    expect(html.match(/aria-label="拒绝此修改"/g)).toHaveLength(2);
    expect(html.match(/aria-label="调整此修改"/g)).toHaveLength(2);
    expect(html.match(/data-ai-review-proposal-id=/g)).toHaveLength(2);
  });
  it('places a moved block decision only at the destination and disables all decisions while running', () => {
    const { state, note } = fiveTabFixture();
    const proposal = createNativeProposal(state, 'a', { action: 'block-move', noteId: note.id, blockId: 'target', container: { exampleBlockId: 'events', tabId: 'event-4' } });
    const html = renderReview({ state, proposal, running: true, onApplyItem() {}, onReject() {}, onRevise: async () => true });
    expect(html.match(/data-ai-review-proposal-id=/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="同意此修改"[^>]*disabled/);
    expect(html).toMatch(/aria-label="拒绝此修改"[^>]*disabled/);
    expect(html).not.toContain('调整此修改');
  });

  it('keeps actions reachable when an aggregate field change cancels out', () => {
    const { state, note } = fiveTabFixture();
    const first = createNativeProposal(state, 'a', { action: 'note-update', noteId: note.id, fields: { title: '临时新标题' } });
    const second = createNativeProposal(state, 'a', { action: 'note-update', noteId: note.id, fields: { title: note.title, tags: ['new'] } });
    const html = renderReview({ state, proposal: first, proposals: [first, second], onApplyItem() {}, onReject() {}, onRevise: async () => true });
    expect(html.match(/data-ai-review-proposal-id=/g)).toHaveLength(2);
  });
  it('keeps independent changes visible when another pending suggestion conflicts with an accepted edit', () => {
    const { state, note } = fiveTabFixture();
    note.blocks.unshift({ id: 'intro', type: 'paragraph', text: '前文原文' });
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'intro', content: '接受的前文' });
    const overlap = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'intro', content: '冲突前文' });
    const independent = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'target', content: '**独立修改仍可审阅**' });
    const accepted = applyAiProposalGroup(state, [first], 'a');
    const pending = rebaseAiReviewProposals(state, accepted.state, [overlap, independent], 'a');
    const html = renderReview({ state: accepted.state, proposal: pending[1], proposals: pending, changes: accepted.changes, onApplyItem() {}, onReject() {}, onRevise: async () => true });
    expect(html).toContain('<strong>独立修改仍可审阅</strong>');
    expect(html).toContain('接受的前文');
    expect(html).toContain('目标内容已变化');
  });
  it.each(['tab-update', 'tab-delete', 'tab-insert'] as const)('opens the selected native %s tab while keeping other note changes visible', action => {
    const { state, note } = fiveTabFixture();
    note.blocks.unshift({ id: 'preface', type: 'paragraph', text: '前文。' });
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'preface', content: '**改写前文**。' });
    const earlier = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'target', content: '另一页的修改。' });
    const proposal = createNativeProposal(state, 'a', { action, noteId: note.id, blockId: 'events', ...(action !== 'tab-insert' ? { tabId: 'event-4' } : {}), ...(action !== 'tab-delete' ? { title: '目标标签' } : {}) });
    const html = renderReview({ state, proposal, proposals: [first, earlier, proposal] });
    const tabId = action === 'tab-insert' ? proposal.edit.generatedId : 'event-4';
    expect(html).toContain(`data-example-id="${tabId}" aria-selected="true"`);
    expect(html).toContain('<strong>改写前文</strong>');
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
  });
  it('shows all pending changes for the same note in one page across legacy and native tools', () => {
    const { state, note } = fiveTabFixture();
    note.blocks.unshift({ id: 'before', type: 'paragraph', text: '前文原句。' });
    const first = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'before', content: '**前文改写**。' });
    const second = createNativeProposal(state, 'a', { action: 'block-update', noteId: note.id, blockId: 'target', fields: { text: '**标签内改写**。' } });
    const html = renderReview({ state, proposal: second, proposals: [first, second] });
    expect(html).toContain('<strong>前文改写</strong>');
    expect(html).toContain('<strong>标签内改写</strong>');
    expect(html.match(/role="tablist"/g)).toHaveLength(1);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(html).not.toContain('下一项建议');
    expect(html.match(/class="mewiki-ai-native-tab-body"/g)).toHaveLength(1);
  });

  it.each(['replace-text', 'delete-text'] as const)('renders one tab container and opens the affected hidden tab for %s', operation => {
    const { state, note } = fiveTabFixture();
    const saved = JSON.stringify(state);
    const proposal = createNoteProposal(state, 'a', { operation, noteId: note.id, blockId: 'target', content: operation === 'delete-text' ? '' : '**新的事件说明**。' });
    const html = renderReview({ state, proposal });
    expect(html.match(/role="tablist"/g)).toHaveLength(1);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(html.match(/class="research-examples-label"/g)).toHaveLength(1);
    expect(html).toMatch(/data-example-id="event-3" aria-selected="true"/);
    expect(html).toContain('原来的事件说明。');
    if (operation === 'replace-text') expect(html).toContain('<strong>新的事件说明</strong>');
    else expect(html).not.toContain('data-kind="add"');
    expect(JSON.stringify(state)).toBe(saved);
  });

  it('keeps unchanged tab context in a single panel for append and pending live previews', () => {
    const { state, note } = fiveTabFixture();
    state.activeNoteId = note.id;
    const proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: note.id, content: '页尾补充。' });
    for (const current of [proposal, null]) {
      const html = renderReview({ state, proposal: current, running: true });
      expect(html.match(/role="tablist"/g)).toHaveLength(1);
      expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
    }
  });

  it('opens each ancestor tab for a deeply nested replacement without duplicating containers', () => {
    const { state, note } = fiveTabFixture();
    const group = note.blocks[0];
    if (group.type !== 'examples') throw new Error('Expected tabs');
    group.tabs[3].blocks = [{ id: 'inner', type: 'examples', tabs: [
      { id: 'inner-empty', title: '空页', blocks: [] },
      { id: 'inner-target', title: '目标页', blocks: [{ id: 'target', type: 'paragraph', text: '嵌套原文。' }] },
    ] }];
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'target', content: '嵌套修改。' });
    const html = renderReview({ state, proposal });
    expect(html.match(/role="tablist"/g)).toHaveLength(2);
    expect(html).toMatch(/data-example-id="event-3" aria-selected="true"/);
    expect(html).toMatch(/data-example-id="inner-target" aria-selected="true"/);
    expect(html).toContain('嵌套');
    expect(html).toContain('data-review-block-id="target" data-review-changed="true"');
  });

  it('marks deletion of a transient empty text block as removal, never as addition', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks = [{ id: 'empty', type: 'paragraph', text: '' }];
    const proposal = createNoteProposal(state, 'a', { operation: 'delete-text', noteId: note.id, blockId: 'empty', content: '' });
    const html = renderToStaticMarkup(createElement(AiProposalReview, { proposal, proposals: [proposal], state, libraryId: 'a', changes: [], disabledReason: '', mutating: false,
      onApply() {}, onClose() {}, onSelect() {}, onOpenNote() {} }));
    expect(html).toContain('data-kind="remove"');
    expect(html).toContain('新增 0 行，删除 1 行');
    expect(html).not.toContain('mewiki-ai-review-added-block');
  });

  it('renders Markdown replacements as native before and after content by default', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks = [{ id: 'rich', type: 'markdown', kind: 'markdown', text: '## 旧标题\n\n旧 **定义** 与 $x^2$。\n\n- 旧条件\n\n| 条目 | 值 |\n| --- | --- |\n| 旧值 | 1 |' }];
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'rich', content: '## 新标题\n\n新 **定义** 与 $x^3$。\n\n- 新条件\n\n| 条目 | 值 |\n| --- | --- |\n| 新值 | 2 |' });
    const html = renderReview({ state, proposal });
    expect(html).toContain('data-review-mode="rendered"');
    expect(html).toContain('<h2>旧标题</h2>');
    expect(html).toContain('<h2>新标题</h2>');
    expect(html).toContain('<strong>定义</strong>');
    expect(html).toContain('<li>新条件</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('**定义**');
    expect(html).toContain('查看源码差异');
  });

  it('keeps heading structure and ordinary text word-level edits', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    note.blocks = [{ id: 'heading', type: 'heading', level: 2, text: '系统始终稳定' }];
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: 'heading', content: '系统局部稳定' });
    const html = renderReview({ state, proposal });
    expect(html).toContain('<h2>');
    expect(html).toContain('data-kind="remove"');
    expect(html).toContain('data-kind="add"');
    expect(html).toContain('<strong>始终</strong>');
    expect(html).toContain('<strong>局部</strong>');
  });

  it('renders an appended list and links as content inside a green addition', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    const proposal = createNoteProposal(state, 'a', { operation: 'append', noteId: note.id, content: '- **有效条件**\n- [参考](https://example.test/source)' });
    const html = renderReview({ state, proposal });
    expect(html).toContain('mewiki-ai-review-added-block');
    expect(html).toContain('<ins');
    expect(html).toContain('<strong>有效条件</strong>');
    expect(html).toContain('<ul');
    expect(html).toContain('href="https://example.test/source"');
    expect(html).not.toContain('**有效条件**');
  });

  it('renders the current note before a streamed suggestion is available and disables approval', () => {
    const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition';
    const html = renderReview({ state, proposal: null, running: true, autoFollow: true, onStop() {} });
    expect(html).toContain('关系定义');
    expect(html).toContain('通用内容。');
    expect(html).toContain('role="status"');
    expect(html).toContain('停止任务');
    expect(html).toMatch(/aria-label="应用建议"[^>]*disabled/);
    expect(html).not.toContain('role="alert"');
  });

  it('shows a streamed draft but keeps its approval disabled', () => {
    const state = createNotebookFixture(), note = state.notes.find(item => item.id === 'fixture-definition')!;
    const proposal = createNoteProposal(state, 'a', { operation: 'replace-text', noteId: note.id, blockId: note.blocks[0].id, content: '正在生成的 **修改**。' });
    const html = renderReview({ state, proposal, streaming: true, running: true, onStop() {} });
    expect(html).toContain('<strong>修改</strong>');
    expect(html).toContain('正在修改');
    expect(html).toMatch(/aria-label="应用建议"[^>]*disabled/);
    expect(html).not.toContain('role="alert"');
  });

  it('renders an unchanged rich term definition without marking it as replaced', () => {
    const state = createNotebookFixture();
    state.terms = [{ id: 'rich-term', name: '原名称', meaning: '**保持的定义** 与 $x^2$。', aliases: [] }];
    const proposal = createTermProposal(state, 'a', { termId: 'rich-term', name: '新名称', meaning: state.terms[0].meaning });
    const html = renderReview({ state, proposal });
    const definition = html.slice(html.indexOf('<h2>定义</h2>'));
    expect(definition).toContain('<strong>保持的定义</strong>');
    expect(definition).toContain('class="katex"');
    expect(definition).not.toContain('data-kind="remove"');
    expect(definition).not.toContain('data-kind="add"');
  });
});
