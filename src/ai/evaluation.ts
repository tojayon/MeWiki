import { createNotebookFixture } from '../domain/testUtils/notebook.ts';
import { findResearchBlock } from '../domain/researchBlockTree.ts';
import { researchTextNoteLinks } from '../domain/researchNoteLinks.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { createAiToolContext } from './tools.ts';
import { runAiTask, type AiRunProgress } from './runner.ts';
import type { AiCompletion } from './types.ts';
import { applyAiProposal } from './proposals.ts';
import { createAiTextSelection, type AiTextSelection } from './textSelection.ts';
import type { AiRunMetrics } from './execution.ts';
import { createSymbolEntry } from '../domain/researchDictionary.ts';
import type { AiTaskSupport } from './taskSupport.ts';

type Complete = NonNullable<Parameters<typeof runAiTask>[0]['complete']>;
interface EvaluationTask {
  id: string; prompt: string; state: ResearchNotebookState; noteIds: string[]; selection?: AiTextSelection;
  script: { name: string; arguments: object }[][];
  answer: string;
  support?: AiTaskSupport;
  expectedContext?: string[];
  expected: (result: AiRunProgress, approved: ResearchNotebookState) => boolean;
}
export interface AiEvaluationResult {
  id: string; completed: boolean; failures: string[]; outOfScope: number; invalidSources: number; invalidProposals: number;
  metrics: AiRunMetrics; usage: AiRunProgress['usage'];
}
const libraryId = 'ai-evaluation-fixture', noteId = 'fixture-definition', blockId = `${noteId}:text`;
const read = { name: 'read_note', arguments: { noteId } };
const edit = (content: string) => ({ name: 'propose_note', arguments: { operation: 'replace-text', noteId, blockId, content } });
function tasks(): EvaluationTask[] {
  const base = () => {
    const state = createNotebookFixture();
    state.notes = state.notes.filter(note => [noteId, 'fixture-summary'].includes(note.id));
    state.activeNoteId = noteId;
    return state;
  };
  const answer = `[关系定义](#research-note/${noteId}) 的建议已准备好，等待用户审阅。`;
  const changed = (text: string) => (_result: AiRunProgress, state: ResearchNotebookState) => {
    const block = findResearchBlock(state.notes.find(note => note.id === noteId)!.blocks, blockId)?.block;
    return block?.type === 'paragraph' && block.text === text;
  };
  const selectionState = base();
  selectionState.notes[0].blocks = [{ id: blockId, type: 'paragraph', text: '保留前文。修改词。保留后文。' }];
  const tabState = base();
  tabState.notes[0].blocks = [{ id: 'tabs', type: 'examples', tabs: [{ id: 'given', title: '条件', blocks: [{ id: 'nested', type: 'paragraph', text: '原有条件', section: 'given' }] }, { id: 'result', title: '结论', blocks: [{ id: 'unchanged', type: 'paragraph', text: '原有结论' }] }] }];
  const paging = base(), template = paging.notes[0];
  paging.notes = Array.from({ length: 65 }, (_, index) => ({ ...structuredClone(template), id: `page-${String(index).padStart(3, '0')}`, title: `分页示例${index}`, blocks: [{ id: `page-block-${index}`, type: 'paragraph', text: '分页检索线索' }] }));
  const notationState = base();
  notationState.symbols = [createSymbolEntry({ name: '受控目标节点', notation: 'v_{\\mathrm T}', meaning: '虚构节点定义', category: 'custom', slots: [] }, 'fixture-target')];
  const dictionaryPages = base();
  dictionaryPages.symbols = Array.from({ length: 45 }, (_, index) => createSymbolEntry({ name: `测量符号 ${index}`, notation: `x_{${index}}`, meaning: '虚构分页定义', category: 'custom', slots: [] }, `dict-${String(index).padStart(3, '0')}`));
  return [
    { id: 'rewrite-and-source', prompt: '将“通用内容。”原位改成“精确内容。”，并用稳定链接引用依据，只提出一项待审建议。', state: base(), noteIds: [noteId], script: [[read], [edit('精确内容。')]], answer, expected: changed('精确内容。') },
    { id: 'selection-boundary', prompt: '仅把选中词改为精确词。', state: selectionState, noteIds: [noteId], selection: createAiTextSelection(selectionState, libraryId, noteId, [blockId], '修改词'), script: [[read], [edit('越界改写整篇')], [edit('保留前文。精确词。保留后文。')]], answer, expected: changed('保留前文。精确词。保留后文。') },
    { id: 'condition-in-hidden-tab', prompt: '将条件标签页中的“原有条件”原位改为“精确条件”，保留条件归属、标签结构及原有结论。', state: tabState, noteIds: [noteId], script: [[read, { name: 'read_block', arguments: { noteId, blockId: 'nested' } }], [{ name: 'propose_edit', arguments: { action: 'block-update', noteId, blockId: 'nested', fields: { text: '精确条件' } } }]], answer,
      expected: (_result, state) => {
        const note = state.notes[0], block = findResearchBlock(note.blocks, 'nested')?.block, other = findResearchBlock(note.blocks, 'unchanged')?.block;
        return block?.type === 'paragraph' && block.text === '精确条件' && block.section === 'given' && other?.type === 'paragraph' && other.text === '原有结论';
      } },
    { id: 'retrieval-next-page', prompt: '分页找到编号 60 的笔记，读取并引用。', state: paging, noteIds: paging.notes.map(note => note.id),
      script: [[{ name: 'search_notes', arguments: { query: '分页检索线索' } }], [{ name: 'search_notes', arguments: { query: '分页检索线索', offset: 60 } }], [{ name: 'read_note', arguments: { noteId: 'page-060' } }]], answer: '[分页示例60](#research-note/page-060) 的正文为分页检索线索。', expected: result => result.sourceIds.includes('page-060') && !!result.steps?.some(step => step.tool === 'read_note' && step.noteId === 'page-060' && ['complete', 'reused'].includes(step.status)) },
    { id: 'duplicate-read-and-proposal', prompt: '对同一处只生成一项修改：把“通用内容。”改为“精确内容。”。不要重复读取或重复登记建议。', state: base(), noteIds: [noteId], script: [[read], [read], [edit('精确内容。')], [edit('精确内容。')]], answer, expected: (result, state) => result.proposals.length === 1 && changed('精确内容。')(result, state) },
    { id: 'out-of-scope-rejection', prompt: '仅总结已授权的关系定义，不读取或修改其他笔记。', state: base(), noteIds: [noteId], script: [[{ name: 'read_note', arguments: { noteId: 'fixture-summary' } }], [read]], answer: '[关系定义](#research-note/fixture-definition) 包含通用内容。', expected: result => result.proposals.length === 0 && !result.sourceIds.includes('fixture-summary') },
    { id: 'symbol-notation-repair', prompt: '使用词典中受控目标节点的完整符号书写，替换原文并等待审阅，不能省略正体下标。', state: notationState, noteIds: [noteId],
      script: [[read, { name: 'search_dictionary', arguments: { query: '受控目标节点' } }], [edit('受控目标节点为 $v_T$。')], [edit('受控目标节点为 $v_{\\mathrm T}$。')]], answer,
      expected: (result, state) => result.proposals.length === 1 && changed('受控目标节点为 $v_{\\mathrm T}$。')(result, state) },
    { id: 'dictionary-next-page', prompt: '分页查找第 40 个测量符号并核对完整词条，阅读笔记后给出说明。', state: dictionaryPages, noteIds: [noteId],
      script: [[{ name: 'search_dictionary', arguments: { query: '测量符号', kind: 'symbol' } }], [{ name: 'search_dictionary', arguments: { query: '测量符号', kind: 'symbol', offset: 40 } }], [{ name: 'read_dictionary_entry', arguments: { kind: 'symbol', entryId: 'dict-040' } }, read]], answer,
      expected: result => result.tools.filter(tool => tool === 'search_dictionary').length === 2 && !!result.steps?.some(step => step.tool === 'read_dictionary_entry' && step.status === 'complete') },
    { id: 'module-alias-help', prompt: '术语库在觅维中叫什么，在哪里打开？结合当前笔记举例。', state: base(), noteIds: [noteId],
      script: [[{ name: 'get_product_help', arguments: { query: '术语库' } }, read]], answer: `[术语词典](mewiki-module:terms) 是“术语库”的标准名称。示例：[关系定义](#research-note/${noteId})。`,
      expected: result => result.output.includes('mewiki-module:terms') && result.tools.includes('get_product_help') && !result.proposals.length },
    { id: 'library-skill-context', prompt: '按本次启用技能改写通用内容。', state: base(), noteIds: [noteId],
      support: { references: [{ kind: 'note', id: noteId }], guidance: { instructions: 'EVALUATION_LIBRARY_RULE', skills: [{ id: 'fixture-skill', name: '虚构精确改写', description: '核对后改写', instructions: 'EVALUATION_SKILL_STEPS：先读取，再逐项提出精确改写建议。' }] } },
      expectedContext: ['EVALUATION_LIBRARY_RULE', 'EVALUATION_SKILL_STEPS', noteId], script: [[read], [edit('精确内容。')]], answer, expected: changed('精确内容。') },
  ];
}
/** No settings, user libraries or credentials are loaded. A custom completion must be explicitly supplied by the caller. */
export async function runAiEvaluation(options: { complete?: Complete; label?: string } = {}) {
  const results: AiEvaluationResult[] = [];
  for (const task of tasks()) {
    let turn = 0;
    const scripted: Complete = async (): Promise<AiCompletion> => {
      const batch = task.script[turn++];
      return { message: { role: 'assistant', content: batch ? '' : task.answer, ...(batch ? { toolCalls: batch.map((call, index) => ({ id: `${turn}-${index}`, name: call.name, arguments: JSON.stringify(call.arguments) })) } : {}) }, usage: { inputTokens: 10, outputTokens: 5 } };
    };
    const context = createAiToolContext(task.state, libraryId, task.noteIds, task.selection, [], task.support), before = JSON.stringify(task.state);
    const started = performance.now();
    let result: AiRunProgress = { output: '', tools: [], sourceIds: [], proposals: [], usage: { inputTokens: 0, outputTokens: 0 } }, failure = '';
    let sentContext = '';
    try { result = await runAiTask({ context, providerId: 'fixture-only', prompt: task.prompt, signal: new AbortController().signal, complete: async (request, transport) => { sentContext ||= JSON.stringify(request.messages); return (options.complete ?? scripted)(request, transport); }, onProgress: value => { result = value; } }); }
    catch (error) { failure = error instanceof Error ? error.message : '任务失败'; }
    const failures = failure ? [failure] : [];
    if (task.expectedContext?.some(text => !sentContext.includes(text))) failures.push('缺少本次启用规范或稳定引用');
    let approved = structuredClone(task.state), invalidProposals = 0, outOfScope = JSON.stringify(task.state) !== before ? 1 : 0;
    for (const proposal of result.proposals) {
      if (!task.noteIds.includes(proposal.targetId)) outOfScope++;
      try { approved = applyAiProposal(approved, proposal, libraryId).state; } catch { invalidProposals++; }
    }
    for (const note of approved.notes.filter(note => !task.noteIds.includes(note.id))) {
      if (JSON.stringify(note) !== JSON.stringify(task.state.notes.find(item => item.id === note.id))) outOfScope++;
    }
    const links = researchTextNoteLinks(result.output);
    const invalidSources = [...result.sourceIds, ...links].filter(id => !task.noteIds.includes(id) || !task.state.notes.some(note => note.id === id) || links.includes(id) && !result.sourceIds.includes(id)).length;
    if (!links.length) failures.push('缺少稳定来源链接');
    if (!task.expected(result, approved)) failures.push('任务目标未达成');
    if (outOfScope) failures.push('出现越界改动');
    if (invalidProposals) failures.push('建议无法通过现有应用流程');
    if (invalidSources) failures.push('来源无效或未经检索／读取');
    if (result.finishReason !== 'complete') failures.push('任务未完整结束');
    results.push({ id: task.id, completed: failures.length === 0, failures, outOfScope, invalidSources, invalidProposals, usage: result.usage,
      metrics: result.metrics ?? { modelCalls: 0, toolCalls: 0, reusedCalls: 0, repeatedCalls: 0, failedCalls: 0, durationMs: Math.round(performance.now() - started) } });
  }
  return { version: 1, mode: options.complete ? 'custom-completion' : 'offline-fixture', label: options.label ?? '觅维固定虚构任务', generatedAt: new Date().toISOString(), results,
    summary: { tasks: results.length, completed: results.filter(item => item.completed).length, completionRate: results.filter(item => item.completed).length / results.length,
      outOfScope: results.reduce((sum, item) => sum + item.outOfScope, 0), invalidSources: results.reduce((sum, item) => sum + item.invalidSources, 0), invalidProposals: results.reduce((sum, item) => sum + item.invalidProposals, 0),
      reusedCalls: results.reduce((sum, item) => sum + item.metrics.reusedCalls, 0), repeatedCalls: results.reduce((sum, item) => sum + item.metrics.repeatedCalls, 0), durationMs: results.reduce((sum, item) => sum + item.metrics.durationMs, 0), inputTokens: results.reduce((sum, item) => sum + item.usage.inputTokens, 0), outputTokens: results.reduce((sum, item) => sum + item.usage.outputTokens, 0) } };
}
