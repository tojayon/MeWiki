import { useState, type ReactNode } from 'react';
import type { AiNativeProposal } from '../ai/nativeProposals.ts';
import type { AiProposal } from '../ai/proposals.ts';
import type { AiReviewLocation } from '../ai/reviewDecisions.ts';
import { flattenResearchBlocks } from '../domain/researchBlockTree.ts';
import { diffAiText } from '../ai/diff.ts';
import { isTextBlock, textOf } from '../ai/reviewContent.ts';
import { nativeFingerprint, type AiNativeEntity } from '../ai/nativeEdits.ts';
import { aiMapFields, aiNoteFields, aiSymbolFields, aiTermFields } from '../ai/nativeSchema.ts';
import type { ResearchNote, ResearchNotebookBlock, ResearchNotebookState } from '../domain/researchNotebook.ts';
import { getResearchNoteMetadata } from '../domain/researchFrontmatter.ts';
import { resolveSymbolEntry, type ResearchSymbolEntry } from '../domain/researchDictionary.ts';
import { researchTabsTitle, type ResearchExamplesBlock } from '../domain/researchExamples.ts';
import { isPlainResearchText } from '../domain/researchMarkdown.ts';
import { resolveTheoryReference, theoryRelationKinds, theoryRoles, type TheoryReference } from '../domain/researchTheoryMap.ts';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { Formula } from './Formula.tsx';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import ResearchMathText from './ResearchMathText.tsx';
import ResearchReadOnlyContent from './ResearchReadOnlyContent.tsx';
import ResearchExamples from './ResearchExamples.tsx';
import { RenderedChange, TextDiff } from './AiReviewChanges.tsx';
import './AiNativeProposalReview.css';

function fieldLabel(field: string) {
  const labels: Record<string, string> = { title: t('标题'), name: t('名称'), meaning: t('定义'), englishName: t('英文名称'), englishAbbreviation: t('英文缩写'), chineseAbbreviation: t('中文缩写'),
    aliases: t('别名'), aliasEntries: t('别名'), atoms: t('原子词汇'), tags: t('标签'), scope: t('适用范围'), unit: t('单位'), status: t('状态'),
    notation: t('符号模板'), slots: t('索引槽位'), category: t('分类'), library: t('笔记分区'), researchType: t('研究类型'), basisNoteIds: t('依据笔记'), reviewStatus: t('核对状态'),
    createdAt: t('创建时间'), updatedAt: t('修改时间'), reviewedAt: t('核对时间'), frontmatter: t('自定义属性'), noteIds: t('笔记'), annotations: t('角色标记'), relations: t('理论关系'), view: t('地图布局'),
    id: t('标识'), key: t('位置'), text: t('内容'), label: t('名称'), domain: t('索引域'), defaultValue: t('默认值'), description: t('说明'), examples: t('示例'), optional: t('可选'), placement: t('位置'),
    source: t('来源'), target: t('目标'), kind: t('类型'), noteId: t('笔记'), blockId: t('内容块'), ref: t('关联内容'), role: t('角色'), expandedNoteIds: t('展开的笔记'), showAllBlocks: t('显示全部内容'), selectedNodeId: t('选中节点'), layout: t('布局'), positions: t('节点位置'), viewport: t('视口'), zoom: t('缩放'), x: t('横坐标'), y: t('纵坐标'),
    labelPosition: t('名称位置'), appearance: t('面板配色'), borderColor: t('边框颜色'), backgroundColor: t('内容背景色'), headerBackground: t('标签栏背景色'), labelBackground: t('徽标背景色'), labelColor: t('徽标文字色'), accentColor: t('选中标签颜色'), section: t('理论分区'),
  };
  return labels[field] ?? field;
}
function valueLabel(field: string, value: string) {
  const labels: Record<string, Record<string, string>> = {
    status: { active: t('使用中'), deprecated: t('已停用') }, reviewStatus: { reviewed: t('已核对'), reviewing: t('核对中'), pending: t('待核对') },
    library: { foundation: t('基础理论'), research: t('研究记录') }, researchType: { application: t('应用'), derivation: t('推导') },
    category: { time: t('时间'), index: t('索引'), state: t('状态'), control: t('控制'), communication: t('通信'), scheduler: t('调度'), evaluation: t('评估'), custom: t('自定义') },
    domain: { packet: t('数据包'), adoption: t('采用事件'), 'scheduler-event': t('调度事件'), loop: t('控制回路'), time: t('时间'), generic: t('通用') },
    placement: { inline: t('行内'), parentheses: t('括号'), 'suffix-subscript': t('下标') },
    key: { x1: t('右上角标 x1'), x2: t('右下角标 x2'), x3: t('右侧变量 x3') }, labelPosition: { left: t('靠左'), center: t('居中'), right: t('靠右') }, section: { given: t('前提条件'), conclusion: t('结论') },
  };
  if (field === 'kind') return t(theoryRelationKinds.find(item => item.value === value)?.label ?? value);
  if (field === 'role') return t(theoryRoles.find(item => item.value === value)?.label ?? value);
  return labels[field]?.[value] ?? value;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
function asReference(value: unknown): TheoryReference | null {
  const item = record(value);
  return item && typeof item.noteId === 'string' ? { noteId: item.noteId, ...(typeof item.blockId === 'string' ? { blockId: item.blockId } : {}) } : null;
}
function symbolTex(entry: ResearchSymbolEntry) {
  return resolveSymbolEntry(entry, Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue]))).tex;
}
function entryIdentity(value: unknown, index: number): string {
  const item = record(value);
  if (typeof item?.id === 'string') return item.id;
  if (typeof item?.key === 'string') return item.key;
  if (asReference(item?.ref)) return nativeFingerprint(item!.ref);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : String(index);
}
interface EntryPair<T> { key: string; id: string; before?: T; after?: T }
/** Removed entries stay beside their original neighbours; only the moved target gets two positions. */
function pairEntries<T>(before: T[], after: T[], identity: (item: T, index: number) => string, movedIds: ReadonlySet<string> = new Set()): EntryPair<T>[] {
  const left = new Map(before.map((item, index) => [identity(item, index), item]));
  const right = new Set(after.map(identity));
  const pairs = after.map((item, index) => {
    const id = identity(item, index);
    return { key: id, id, before: movedIds.has(id) ? undefined : left.get(id), after: item } as EntryPair<T>;
  });
  before.forEach((item, index) => {
    const id = identity(item, index);
    if (right.has(id) && !movedIds.has(id)) return;
    const next = before.slice(index + 1).map((value, offset) => identity(value, index + 1 + offset)).find(key => right.has(key) && !movedIds.has(key));
    const position = next === undefined ? pairs.length : pairs.findIndex(pair => pair.key === next);
    pairs.splice(position, 0, { key: `before:${id}`, id, before: item });
  });
  return pairs;
}
function Change({ kind, children }: { kind: 'add' | 'remove'; children: ReactNode }) {
  return <div className="mewiki-ai-diff-row mewiki-ai-rendered-diff-row" data-kind={kind}>
    <span className="mewiki-ai-diff-sign" aria-hidden="true">{kind === 'add' ? '+' : '−'}</span>
    {kind === 'add' ? <ins className="mewiki-ai-review-rendered-change" aria-label={t('新增的内容')}>{children}</ins> : <del className="mewiki-ai-review-rendered-change" aria-label={t('删除的内容')}>{children}</del>}
  </div>;
}
type OpenNote = (id: string, blockId?: string) => void;
interface DisplayProps { value: unknown; state: ResearchNotebookState; field?: string; symbol?: ResearchSymbolEntry; onOpenNote: OpenNote }
function Reference({ reference, state, onOpenNote }: { reference: TheoryReference; state: ResearchNotebookState; onOpenNote: OpenNote }) {
  const node = resolveTheoryReference(state, reference);
  return <button type="button" className="mewiki-ai-native-reference" data-review-note-id={reference.noteId} data-review-reference-block-id={reference.blockId} disabled={node.missing}
    onClick={() => onOpenNote(reference.noteId, reference.blockId)}><span>{node.noteTitle}</span>{reference.blockId && <span><ResearchMathText text={node.title} /></span>}</button>;
}
function referenceFromNodeId(state: ResearchNotebookState, id: string): TheoryReference | null {
  try {
    const parsed: unknown = JSON.parse(id);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return { noteId: parsed[0], ...(typeof parsed[1] === 'string' ? { blockId: parsed[1] } : {}) };
  } catch { /* Simple note IDs are also accepted. */ }
  return state.notes.some(note => note.id === id) ? { noteId: id } : null;
}
function DisplayValue({ value, state, field = '', symbol, onOpenNote }: DisplayProps): ReactNode {
  if (value === undefined || value === null || value === '') return <span>—</span>;
  if (typeof value === 'boolean') return value ? t('是') : t('否');
  if (field === 'notation' && symbol) return <Formula tex={symbolTex(symbol)} block />;
  if (typeof value === 'string' || typeof value === 'number') {
    if (typeof value === 'number') return String(value);
    if (['noteId', 'noteIds', 'basisNoteIds', 'expandedNoteIds'].includes(field)) return <Reference reference={{ noteId: value }} state={state} onOpenNote={onOpenNote} />;
    if (field === 'selectedNodeId') {
      const reference = referenceFromNodeId(state, value);
      return reference ? <Reference reference={reference} state={state} onOpenNote={onOpenNote} /> : t('来源内容已移除');
    }
    return <div className="research-markdown"><ResearchMarkdown text={valueLabel(field, value)} /></div>;
  }
  if (Array.isArray(value)) return <ul className="mewiki-ai-native-values">{value.map((item, index) => <li key={entryIdentity(item, index)} data-review-entry-id={entryIdentity(item, index)}><DisplayValue value={item} state={state} field={field} symbol={symbol} onOpenNote={onOpenNote} /></li>)}</ul>;
  const object = record(value)!;
  const reference = asReference(value);
  if (reference) return <Reference reference={reference} state={state} onOpenNote={onOpenNote} />;
  if (field === 'positions') return <dl>{Object.entries(object).map(([id, position]) => {
    const node = referenceFromNodeId(state, id);
    return <div key={id}><dt>{node ? <Reference reference={node} state={state} onOpenNote={onOpenNote} /> : t('来源内容已移除')}</dt><dd><DisplayValue value={position} state={state} onOpenNote={onOpenNote} /></dd></div>;
  })}</dl>;
  if (asReference(object.source) && asReference(object.target)) return <article className="mewiki-ai-native-relation">
    <div className="mewiki-ai-native-relation-route"><Reference reference={asReference(object.source)!} state={state} onOpenNote={onOpenNote} /><span aria-hidden="true">→</span><Reference reference={asReference(object.target)!} state={state} onOpenNote={onOpenNote} /><strong>{valueLabel('kind', String(object.kind))}</strong></div>
    {typeof object.description === 'string' && object.description && <div className="research-markdown"><ResearchMarkdown text={object.description} /></div>}
  </article>;
  return <dl>{Object.entries(object).filter(([key]) => key !== 'id').map(([key, item]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd><DisplayValue value={item} state={state} field={key} onOpenNote={onOpenNote} /></dd></div>)}</dl>;
}
interface FieldsProps {
  before: Record<string, unknown>; after: Record<string, unknown>; keys: string[]; state: ResearchNotebookState; originalState: ResearchNotebookState; source: boolean; onOpenNote: OpenNote;
  beforeSymbol?: ResearchSymbolEntry; afterSymbol?: ResearchSymbolEntry; sourceNoteId?: string;
  renderActions?: (location: AiReviewLocation) => ReactNode; blockId?: string;
}
function Fields({ before, after, keys, state, originalState, source, onOpenNote, beforeSymbol, afterSymbol, sourceNoteId = '', renderActions, blockId }: FieldsProps) {
  const display = (value: unknown, field: string, viewState: ResearchNotebookState, symbol?: ResearchSymbolEntry) => <ResearchNoteLinkContext.Provider value={{ notes: viewState.notes, symbols: viewState.symbols, terms: viewState.terms ?? [], state: viewState, sourceNoteId, openNote: onOpenNote }}>
    {source ? <pre>{JSON.stringify(value, null, 2)}</pre> : <DisplayValue value={value} state={viewState} field={field} symbol={symbol} onOpenNote={onOpenNote} />}
  </ResearchNoteLinkContext.Provider>;
  return keys.filter(key => nativeFingerprint(before[key]) !== nativeFingerprint(after[key]) || (key === 'notation' && beforeSymbol && afterSymbol && symbolTex(beforeSymbol) !== symbolTex(afterSymbol))).map(key => {
    const left = before[key], right = after[key];
    return <section key={key} className="mewiki-ai-review-term-field" data-review-field={key} data-review-changed="true">{renderActions?.({ kind: 'field', field: key, ...(blockId ? { blockId } : {}) })}<h2>{fieldLabel(key)}</h2>
      {!source && (Array.isArray(left) || Array.isArray(right)) ? <ul className="mewiki-ai-native-values">{pairEntries(Array.isArray(left) ? left : [], Array.isArray(right) ? right : [], entryIdentity).map(pair => <li key={pair.key} data-review-entry-id={pair.id}>
        {nativeFingerprint(pair.before) === nativeFingerprint(pair.after) ? display(pair.after, key, state, afterSymbol) : <>
          {pair.before !== undefined && <Change kind="remove">{display(pair.before, key, originalState, beforeSymbol)}</Change>}
          {pair.after !== undefined && <Change kind="add">{display(pair.after, key, state, afterSymbol)}</Change>}
        </>}
      </li>)}</ul> : <>
        {left !== undefined && <Change kind="remove">{display(left, key, originalState, beforeSymbol)}</Change>}
        {right !== undefined && <Change kind="add">{display(right, key, state, afterSymbol)}</Change>}
      </>}
    </section>;
  });
}
export default function AiNativeProposalReview({ proposal, before, after, state, originalState, source, onOpenNote, operations = [], selectedTabs, onSelectTab, renderActions }: {
  proposal: Pick<AiNativeProposal, 'target' | 'targetId' | 'title'> & Partial<Pick<AiNativeProposal, 'edit'>>;
  before: AiNativeEntity | null; after: AiNativeEntity | null; state: ResearchNotebookState; originalState: ResearchNotebookState; source: boolean; onOpenNote: OpenNote;
  operations?: AiProposal[]; selectedTabs?: Record<string, string>; onSelectTab?: (blockId: string, tabId: string) => void;
  renderActions?: (location: AiReviewLocation) => ReactNode;
}) {
  useLocale();
  const [localTabs, setLocalTabs] = useState<Record<string, string>>({});
  const edits = [...operations.flatMap(operation => operation.kind === 'native' ? [operation.edit] : []), ...(proposal.edit ? [proposal.edit] : [])];
  const movedBlocks = new Set(edits.filter(edit => edit.action === 'block-move').map(edit => edit.blockId!));
  const fieldProps = { state, originalState, source, onOpenNote, renderActions, sourceNoteId: proposal.target === 'note' ? proposal.targetId : '' };
  const afterBlockIds = new Set(proposal.target === 'note' && after ? flattenResearchBlocks((after as ResearchNote).blocks).map(block => block.id) : []);
  const renderBlock = (block: ResearchNotebookBlock, note: ResearchNote, viewState: ResearchNotebookState) => <ResearchNoteLinkContext.Provider value={{ notes: viewState.notes, symbols: viewState.symbols, terms: viewState.terms ?? [], state: viewState, sourceNoteId: note.id, openNote: onOpenNote }}>
    <ResearchReadOnlyContent block={block} note={note} state={viewState} onOpenNote={onOpenNote} staticView selectedTabs={selectedTabs} onSelectTab={onSelectTab} />
  </ResearchNoteLinkContext.Provider>;
  const renderBlocks = (left: ResearchNotebookBlock[], right: ResearchNotebookBlock[], previous: ResearchNote | null, current: ResearchNote | null, viewState = state, showMoves = true): ReactNode => pairEntries(left, right, block => block.id, showMoves ? movedBlocks : undefined).map(pair => {
    const a = pair.before, b = pair.after;
    const nested = (a?.type === 'examples' && (!b || b.type === 'examples')) || (!a && b?.type === 'examples');
    const changed = nested ? !a || !b : nativeFingerprint(a) !== nativeFingerprint(b);
    const textDiff = changed && a && b && isTextBlock(a) && isTextBlock(b)
      && nativeFingerprint({ ...a, text: undefined }) === nativeFingerprint({ ...b, text: undefined })
      && (source || isPlainResearchText(a.text) && isPlainResearchText(b.text));
    const tabs = nested ? renderTabs(a as ResearchExamplesBlock | undefined, b as ResearchExamplesBlock | undefined, previous, current, viewState, showMoves) : null;
    return <div key={pair.key} className="mewiki-ai-review-block" data-review-block-id={pair.id} data-review-changed={changed}>
      {(b || !afterBlockIds.has(pair.id)) && renderActions?.({ kind: 'block', blockId: pair.id })}
      {nested ? a && b ? tabs : <RenderedChange kind={b ? 'add' : 'remove'} added={!!b}>{tabs}</RenderedChange>
        : !changed && b ? renderBlock(b, current!, viewState) : textDiff ? <TextDiff lines={diffAiText(textOf(a), textOf(b))} block={source ? undefined : b} /> : <>
        {a && <RenderedChange kind="remove">{source ? <pre>{JSON.stringify(a, null, 2)}</pre> : renderBlock(a, previous!, originalState)}</RenderedChange>}
        {b && (source && isTextBlock(b) && !a ? <TextDiff lines={diffAiText('', b.text)} /> : <RenderedChange kind="add" added={!a}>{source ? <pre>{JSON.stringify(b, null, 2)}</pre> : renderBlock(b, current!, viewState)}</RenderedChange>)}
      </>}
    </div>;
  });
  function renderTabs(previous: ResearchExamplesBlock | undefined, current: ResearchExamplesBlock | undefined, previousNote: ResearchNote | null, currentNote: ResearchNote | null, viewState: ResearchNotebookState, showMoves: boolean): ReactNode {
    const block = (current ?? previous)!;
    const pairs = pairEntries(previous?.tabs ?? [], current?.tabs ?? [], tab => tab.id);
    const display = { ...block, tabs: pairs.map(pair => (pair.after ?? pair.before)!) };
    const movedTabs = new Set(edits.filter(edit => edit.action === 'tab-move' && edit.blockId === block.id).map(edit => edit.tabId));
    const moveDestination = [...edits].reverse().find(edit => edit.action === 'block-move' && edit.container?.exampleBlockId === block.id)?.container?.tabId;
    const initialTab = moveDestination ?? pairs.find(pair => nativeFingerprint(pair.before) !== nativeFingerprint(pair.after))?.id ?? pairs[0]?.id;
    return <div className="mewiki-ai-native-tabs-review">
      {previous && current && <Fields before={{ ...previous, title: researchTabsTitle(previous) }} after={{ ...current, title: researchTabsTitle(current) }} keys={['title', 'labelPosition', 'appearance', 'section']} {...fieldProps} blockId={block.id} />}
      <ResearchExamples block={display} readOnly staticView selectedTabId={selectedTabs?.[block.id] ?? localTabs[block.id] ?? initialTab}
        onSelect={tabId => { setLocalTabs(tabs => ({ ...tabs, [block.id]: tabId })); onSelectTab?.(block.id, tabId); }}
        renderTabTitle={tab => {
          const pair = pairs.find(pair => pair.id === tab.id)!;
          const a = pair.before, b = pair.after;
          const renamed = !!a && !!b && a.title !== b.title;
          return <span className="mewiki-ai-review-tab-label" data-review-tab-id={pair.id} data-review-tab-changed={nativeFingerprint(a) !== nativeFingerprint(b) || movedTabs.has(pair.id)} data-review-tab-moved={movedTabs.has(pair.id) || undefined}>
            {!b ? <del aria-label={t('删除的内容')}>{a!.title}</del> : !a ? <ins aria-label={t('新增的内容')}>{b.title}</ins> : renamed ? <><del aria-label={t('删除的内容')}>{a.title}</del><ins aria-label={t('新增的内容')}>{b.title}</ins></> : b.title}
            {movedTabs.has(pair.id) && <span aria-hidden="true">↔</span>}
          </span>;
        }}
        renderBlocks={(_, container) => {
          const pair = pairs.find(pair => pair.id === container.tabId)!;
          const a = pair.before, b = pair.after;
          const tabChanged = !a || !b || a.title !== b.title || movedTabs.has(pair.id);
          const whole = !previous || !current;
          const body = a && b ? renderBlocks(a.blocks, b.blocks, previousNote, currentNote, viewState, showMoves)
            : b ? renderBlocks(b.blocks, b.blocks, currentNote, currentNote, viewState, false)
              : renderBlocks(a!.blocks, a!.blocks, previousNote, previousNote, originalState, false);
          const content = <section className="mewiki-ai-native-tab-body" data-review-tab-id={pair.id} data-review-changed={tabChanged}>{renderActions?.({ kind: 'tab', blockId: block.id, tabId: pair.id })}{body}</section>;
          return whole || a && b ? content : <RenderedChange kind={b ? 'add' : 'remove'}>{content}</RenderedChange>;
        }} />
    </div>;
  }
  if (proposal.target === 'note') {
    const previous = before as ResearchNote | null, current = after as ResearchNote | null;
    const metadata = (note: ResearchNote | null) => note ? { ...getResearchNoteMetadata(note), frontmatter: note.frontmatter, annotations: note.theory?.annotations, relations: note.theory?.relations } : {};
    return <div className="mewiki-ai-native-review" data-native-review="note"><h1 className={!previous && current ? 'mewiki-ai-review-new-title' : undefined}>{current?.title ?? previous?.title ?? proposal.title}</h1>
      {renderActions?.({ kind: 'page' })}
      <Fields before={metadata(previous)} after={metadata(current)} keys={[...Object.keys(aiNoteFields).filter(key => key !== 'updatedAt' || edits.some(edit => edit.fields.updatedAt !== undefined)), 'annotations', 'relations']} {...fieldProps} />
      <div className="mewiki-ai-review-blocks">{renderBlocks(previous?.blocks ?? [], current?.blocks ?? [], previous, current)}</div>
    </div>;
  }
  const keys = proposal.target === 'symbol' ? Object.keys(aiSymbolFields) : proposal.target === 'term' ? Object.keys(aiTermFields).filter(key => key !== 'aliases' || !(before && 'aliasEntries' in before) && !(after && 'aliasEntries' in after)) : [...Object.keys(aiMapFields), 'relations'];
  return <div className="mewiki-ai-native-review" data-native-review={proposal.target}><h1>{proposal.title}</h1>
    {renderActions?.({ kind: 'page' })}
    <Fields before={record(before) ?? {}} after={record(after) ?? {}} keys={keys} {...fieldProps}
      beforeSymbol={proposal.target === 'symbol' && before ? before as ResearchSymbolEntry : undefined} afterSymbol={proposal.target === 'symbol' && after ? after as ResearchSymbolEntry : undefined} />
  </div>;
}
