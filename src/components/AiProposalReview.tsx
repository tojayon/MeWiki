import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Code2, Eye, GitCompareArrows, Square } from 'lucide-react';
import { diffAiText, type AiDiffLine } from '../ai/diff.ts';
import { previewAiProposal, type AiChange, type AiProposal, type AiProposalPreview } from '../ai/proposals.ts';
import { findResearchBlock, flattenResearchBlocks } from '../domain/researchBlockTree.ts';
import { aiProposalTarget, aiProposalTargetKey, applyAiProposalGroup } from '../ai/proposalGroup.ts';
import { aiReviewLocation, aiReviewLocationKey, type AiProposalAdjustment, type AiReviewLocation } from '../ai/reviewDecisions.ts';
import { nativeFingerprint } from '../ai/nativeEdits.ts';
import { getResearchNoteMetadata } from '../domain/researchFrontmatter.ts';
import { isPlainResearchText } from '../domain/researchMarkdown.ts';
import { ensureTheoryMaps } from '../domain/researchTheoryMap.ts';
import type { ResearchNote, ResearchNotebookState } from '../domain/researchNotebook.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import AiNativeProposalReview from './AiNativeProposalReview.tsx';
import AiInlineSuggestion from './AiInlineSuggestion.tsx';
import { TextDiff, RenderedChange } from './AiReviewChanges.tsx';
import { textOf, isTextBlock } from '../ai/reviewContent.ts';
import './AiProposalReview.css';

/** A stale suggestion can still be inspected against its captured original; it cannot be applied. */
function reviewModel(state: ResearchNotebookState, proposal: AiProposal, libraryId: string, changes: AiChange[]): { preview: AiProposalPreview | null; error: string } {
  try { return { preview: previewAiProposal(state, proposal, libraryId, changes), error: '' }; }
  catch (cause) {
    const error = cause instanceof Error ? cause.message : 'AI 修改预览不可用。';
    const restore = <T extends { id: string }>(items: T[], before: T | null) => [...items.filter(item => item.id !== proposal.targetId), ...(before ? [before] : [])];
    let snapshot: ResearchNotebookState;
    if (proposal.kind !== 'native') snapshot = proposal.kind === 'term'
      ? { ...state, terms: restore(state.terms ?? [], proposal.before) }
      : { ...state, notes: restore(state.notes, proposal.before) };
    else if (proposal.target === 'note') snapshot = { ...state, notes: restore(state.notes, proposal.before as ResearchNote | null) };
    else if (proposal.target === 'term') snapshot = { ...state, terms: restore(state.terms ?? [], proposal.before as NonNullable<ResearchNotebookState['terms']>[number] | null) };
    else if (proposal.target === 'symbol') snapshot = { ...state, symbols: restore(state.symbols, proposal.before as ResearchNotebookState['symbols'][number] | null) };
    else {
      const maps = ensureTheoryMaps(state).theoryMaps!;
      snapshot = { ...state, theoryMaps: { ...maps, documents: restore(maps.documents, proposal.before as typeof maps.documents[number] | null) } };
    }
    try { return { preview: previewAiProposal(snapshot, proposal, libraryId), error }; }
    catch { return { preview: null, error }; }
  }
}

export default function AiProposalReview({ proposal, proposals, state, libraryId, changes, disabledReason, mutating, running = false, streaming = false, autoFollow = false, focusKey = 0, onStop, onApply, onApplyItem, onReject, onRevise, onEditingChange, onClose, onSelect, onOpenNote, pageControls, panelControls }: {
  proposal: AiProposal | null; proposals: AiProposal[]; state: ResearchNotebookState; libraryId: string; changes: AiChange[];
  disabledReason: string; mutating: boolean; onApply: (proposals: AiProposal[]) => void; onClose: () => void; onSelect: (id: string) => void;
  running?: boolean; streaming?: boolean; autoFollow?: boolean; focusKey?: number; onStop?: () => void;
  onApplyItem?: (proposal: AiProposal) => void; onReject?: (proposal: AiProposal) => void;
  onRevise?: (proposal: AiProposal, adjustment: AiProposalAdjustment) => Promise<boolean>;
  onEditingChange?: (id: string, editing: boolean) => void;
  onOpenNote: (id: string, blockId?: string) => void; pageControls?: ReactNode; panelControls?: ReactNode;
}) {
  useLocale();
  const { preview, error } = useMemo(() => proposal ? reviewModel(state, proposal, libraryId, changes) : { preview: null, error: '' }, [state, proposal, libraryId, changes]);
  const group = useMemo(() => proposal ? aiProposalTarget(proposal) === 'note' ? proposals.filter(item => aiProposalTargetKey(item) === aiProposalTargetKey(proposal)) : [proposal] : [], [proposal, proposals]);
  const targetKey = (item: AiProposal) => aiProposalTarget(item) === 'note' ? aiProposalTargetKey(item) : item.id;
  const targets = [...new Map(proposals.map(item => [targetKey(item), item])).values()];
  const noteReview = useMemo(() => {
    if (!proposal || aiProposalTarget(proposal) !== 'note') return null;
    const compose = (base: ResearchNotebookState, items = group) => {
      const result = applyAiProposalGroup(base, items, libraryId, changes);
      return { before: base.notes.find(note => note.id === proposal.targetId) ?? null,
        after: result.state.notes.find(note => note.id === proposal.targetId) ?? null, state: result.state, changes: result.changes, available: true };
    };
    try { return { ...compose(state), error: '' }; }
    catch (cause) {
      const error = cause instanceof Error ? cause.message : 'AI 修改预览不可用。';
      const valid = group.filter(item => {
        try { previewAiProposal(state, item, libraryId, changes); return true; }
        catch { return false; }
      });
      if (valid.length && valid.length < group.length) {
        try { return { ...compose(state, valid), error }; }
        catch { /* Structurally incompatible changes still require a fresh suggestion. */ }
      }
      const captured = group[0]?.before as ResearchNote | null;
      const base = { ...state, notes: [...state.notes.filter(note => note.id !== proposal.targetId), ...(captured ? [captured] : [])] };
      try { return { ...compose(base), error }; }
      catch {
        const original = state.notes.find(note => note.id === proposal.targetId) ?? captured;
        return { before: original, after: original, state, changes: [] as AiChange[], available: false, error };
      }
    }
  }, [proposal, group, libraryId, changes, state]);
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const editingChanged = useCallback((id: string, editing: boolean) => {
    setEditingIds(ids => editing ? ids.includes(id) ? ids : [...ids, id] : ids.includes(id) ? ids.filter(item => item !== id) : ids);
    onEditingChange?.(id, editing);
  }, [onEditingChange]);
  const reviewKey = JSON.stringify([libraryId, proposal ? aiProposalTargetKey(proposal) : state.activeNoteId, focusKey]);
  const [tabSelection, setTabSelection] = useState<{ key: string; tabs: Record<string, string> }>({ key: reviewKey, tabs: {} });
  if (tabSelection.key !== reviewKey) setTabSelection({ key: reviewKey, tabs: {} });
  const [focusSelection, setFocusSelection] = useState({ key: reviewKey, proposal });
  if (focusSelection.key !== reviewKey || autoFollow && focusSelection.proposal !== proposal) setFocusSelection({ key: reviewKey, proposal });
  const focusProposal = focusSelection.key === reviewKey && !autoFollow ? focusSelection.proposal : proposal;
  const focusEdit = focusProposal?.kind === 'native' ? focusProposal.edit : undefined;
  const focusBlockId = focusEdit?.action === 'block-insert' ? focusEdit.generatedId : focusEdit?.blockId ?? (focusProposal && 'blockId' in focusProposal ? focusProposal.blockId : undefined);
  const focusTabId = focusEdit?.action.startsWith('tab-') ? focusEdit.action === 'tab-insert' ? focusEdit.generatedId : focusEdit.tabId : focusEdit?.container?.tabId;
  const focusContainerId = focusEdit?.action.startsWith('tab-') ? focusEdit.blockId : focusEdit?.container?.exampleBlockId;
  const pathId = focusBlockId ?? focusContainerId;
  const targetPath = pathId ? [noteReview?.after, noteReview?.before].flatMap(note => note ? [findResearchBlock(note.blocks, pathId)] : []).find(Boolean)?.path ?? [] : [];
  const selectedTabs = { ...Object.fromEntries(targetPath.map(({ exampleBlockId, tabId }) => [exampleBlockId, tabId])),
    ...(focusTabId && focusContainerId ? { [focusContainerId]: focusTabId } : {}), ...(tabSelection.key === reviewKey ? tabSelection.tabs : {}) };
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);
  const presentation = useRef<{ id: string | undefined; target: string; automatic: boolean; focusKey: number } | null>(null);
  const index = targets.findIndex(item => proposal && targetKey(item) === targetKey(proposal));
  const textChanges = useMemo(() => {
    if (noteReview) {
      const before = new Map(flattenResearchBlocks(noteReview.before?.blocks ?? []).map(block => [block.id, block]));
      const after = new Map(flattenResearchBlocks(noteReview.after?.blocks ?? []).map(block => [block.id, block]));
      return new Map([...new Set([...before.keys(), ...after.keys()])].filter(id => isTextBlock(before.get(id)) || isTextBlock(after.get(id))).map(id => {
        const lines = diffAiText(textOf(before.get(id)), textOf(after.get(id)));
        return [id, before.has(id) && !after.has(id) && !lines.length ? [{ kind: 'remove', text: '', beforeLine: 1, parts: [{ text: '', changed: true }] } as AiDiffLine] : lines];
      }));
    }
    if (!preview || !proposal || preview.target !== 'term') return new Map<string, AiDiffLine[]>();
    if (preview.target === 'term') return new Map(['name', 'englishName', 'meaning'].map(field => {
      const key = field as 'name' | 'englishName' | 'meaning';
      return [field, diffAiText(preview.before?.[key] ?? '', preview.after[key] ?? '')];
    }));
    return new Map<string, AiDiffLine[]>();
  }, [preview, proposal, noteReview]);
  const counts = [...textChanges.values()].flat().reduce((count, line) => ({ added: count.added + Number(line.kind === 'add'), removed: count.removed + Number(line.kind === 'remove') }), { added: 0, removed: 0 });
  useLayoutEffect(() => {
    const previous = presentation.current;
    presentation.current = { id: proposal?.id, target: reviewKey, automatic: autoFollow, focusKey };
    if (previous?.id === proposal?.id && previous?.automatic === autoFollow && previous?.focusKey === focusKey) return;
    // Finishing an automatic preview must preserve an in-progress reply and reading position.
    if (previous?.automatic && !autoFollow && !running && previous?.focusKey === focusKey) return;
    if (previous && !previous.automatic && !autoFollow && previous.target === reviewKey) return;
    if (!autoFollow) returnRef.current?.focus({ preventScroll: true });
    const scroll = scrollRef.current;
    const tab = focusTabId ? [...scroll?.querySelectorAll<HTMLElement>('.mewiki-ai-native-tab-body') ?? []].find(element => element.dataset.reviewTabId === focusTabId) : undefined;
    const block = focusBlockId ? [...scroll?.querySelectorAll<HTMLElement>('[data-review-block-id]') ?? []].find(element => element.dataset.reviewBlockId === focusBlockId) : undefined;
    const field = focusEdit ? [...scroll?.querySelectorAll<HTMLElement>('[data-review-field]') ?? []].find(element => Object.hasOwn(focusEdit.fields, element.dataset.reviewField ?? '')) : undefined;
    const target = focusEdit?.action.startsWith('tab-') ? tab ?? block : block ?? tab;
    const changed = target ?? field ?? scroll?.querySelector<HTMLElement>('[data-review-changed="true"]');
    if (scroll) scroll.scrollTop = changed ? Math.max(0, changed.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 64) : 0;
  }, [proposal?.id, autoFollow, running, focusKey, focusBlockId, focusTabId, focusEdit, reviewKey]);
  useLayoutEffect(() => {
    const layout = rootRef.current?.closest<HTMLElement>('.research-notebook-layout');
    if (!layout) return;
    const covered = new Map<HTMLElement, boolean>();
    const restore = () => {
      for (const [element, inert] of covered) { element.inert = inert; element.removeAttribute('data-ai-review-covered'); }
      covered.clear();
    };
    const update = () => {
      restore();
      const narrow = layout.getBoundingClientRect().width < 1000;
      const selectors = '.research-reading-rail, .research-symbol-pane, .research-notebook-editor' + (narrow
        ? ', .research-notebook-sidebar, .research-dictionary-sidebar, .research-sidebar-footer, .research-notebook-mode-tabs, .research-notebook-divider, #research-note-outline' : '');
      for (const element of layout.querySelectorAll<HTMLElement>(selectors)) {
        covered.set(element, element.inert); element.inert = true; element.setAttribute('data-ai-review-covered', '');
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return restore;
    const resize = new ResizeObserver(update); resize.observe(layout);
    return () => { resize.disconnect(); restore(); };
  }, []);

  function renderNote(before: ResearchNote | null, after: ResearchNote | null, viewState: ResearchNotebookState) {
    const note = after ?? before;
    if (!note) return null;
    return <AiNativeProposalReview proposal={{ target: 'note', targetId: note.id, title: note.title }} before={before} after={after}
      state={viewState} originalState={state} source={mode === 'source'} onOpenNote={onOpenNote} operations={group} selectedTabs={selectedTabs}
      onSelectTab={(blockId, tabId) => setTabSelection(current => ({ key: reviewKey, tabs: { ...(current.key === reviewKey ? current.tabs : {}), [blockId]: tabId } }))} renderActions={renderActions} />;
  }

  // A superseded field may disappear from the combined diff; keep its decision reachable at page level.
  const itemLocations = group.map(item => {
    const location = aiReviewLocation(item, noteReview?.changes.find(change => change.proposalId === item.id));
    if (location.kind === 'field') {
      const metadata = (note: ResearchNote | null) => note ? { ...getResearchNoteMetadata(note), frontmatter: note.frontmatter, annotations: note.theory?.annotations, relations: note.theory?.relations } : {};
      const left = noteReview ? metadata(noteReview.before) : preview?.before ?? {};
      const right = noteReview ? metadata(noteReview.after) : preview?.after ?? {};
      if (nativeFingerprint((left as Record<string, unknown>)[location.field!]) === nativeFingerprint((right as Record<string, unknown>)[location.field!])) return { item, location: { kind: 'page' } as AiReviewLocation };
    } else if (location.kind === 'block' || location.kind === 'tab') {
      const blocks = [noteReview?.before, noteReview?.after].flatMap(note => flattenResearchBlocks(note?.blocks ?? []));
      const available = blocks.some(block => block.id === location.blockId && (location.kind !== 'tab' || block.type === 'examples' && block.tabs.some(tab => tab.id === location.tabId)));
      if (!available) return { item, location: { kind: 'page' } as AiReviewLocation };
    }
    return { item, location };
  });
  function renderActions(location: AiReviewLocation): ReactNode {
    if (!onApplyItem || !onReject || !onRevise) return null;
    return itemLocations.filter(entry => aiReviewLocationKey(entry.location) === aiReviewLocationKey(location)).map(({ item }) => <AiInlineSuggestion key={item.id}
      proposal={item} state={state} disabled={running || streaming || mutating || !!disabledReason} error={reviewModel(state, item, libraryId, changes).error || (noteReview && !noteReview.available ? noteReview.error : '')}
      onApprove={onApplyItem!} onReject={onReject!} onRevise={onRevise!} onEditingChange={editingChanged} />);
  }

  const currentNote = state.notes.find(note => note.id === state.activeNoteId);
  const reviewError = (noteReview ? noteReview.error : error) || disabledReason;
  const applyLabel = group.length > 1 ? t('应用当前页面修改') : t('应用建议');
  return <section ref={rootRef} className="mewiki-ai-review" data-testid="mewiki-ai-review" data-review-mode={mode} aria-label={t('AI 修改预览')} onKeyDown={event => {
    if (event.key === 'Escape' && !mutating) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="mewiki-ai-review-toolbar" role="toolbar" aria-label={t('修改审阅操作')}>
      <div className="mewiki-ai-review-leading">
        {pageControls}
        <GitCompareArrows size={16} aria-hidden="true" /><strong>{t('修改预览')}</strong>
        {(running || streaming) && <span className="mewiki-ai-review-status" role="status">{streaming ? t('正在修改') : t('任务执行中…')}</span>}
      </div>
      {proposal && (noteReview || proposal.kind !== 'native') && <div className="mewiki-ai-review-counts" aria-label={t`新增 ${counts.added} 行，删除 ${counts.removed} 行`}><span>+{counts.added}</span><span>−{counts.removed}</span></div>}
      <div className="mewiki-ai-review-actions">
        <button type="button" data-ui="icon-action" aria-label={mode === 'rendered' ? t('查看源码差异') : t('查看渲染差异')} title={mode === 'rendered' ? t('查看源码差异') : t('查看渲染差异')} aria-pressed={mode === 'source'} onClick={() => setMode(value => value === 'rendered' ? 'source' : 'rendered')}>{mode === 'rendered' ? <Code2 size={16} /> : <Eye size={16} />}</button>
        {targets.length > 1 && <>
          <button type="button" data-ui="icon-action" aria-label={t('上一个目标')} title={t('上一个目标')} disabled={index <= 0 || mutating} onClick={() => onSelect(targets[index - 1].id)}><ChevronLeft size={16} /></button>
          <span className="mewiki-ai-review-position">{index + 1}/{targets.length}</span>
          <button type="button" data-ui="icon-action" aria-label={t('下一个目标')} title={t('下一个目标')} disabled={index < 0 || index >= targets.length - 1 || mutating} onClick={() => onSelect(targets[index + 1].id)}><ChevronRight size={16} /></button>
        </>}
        <button type="button" data-ui="icon-action" aria-label={applyLabel} title={applyLabel} disabled={running || streaming || mutating || !!reviewError || !preview || !proposal || !!editingIds.length} onClick={() => onApply(group)}><Check size={17} /></button>
        {(running || streaming) && onStop && <button type="button" data-ui="icon-action" aria-label={t('停止任务')} title={t('停止任务')} onClick={onStop}><Square size={15} fill="currentColor" /></button>}
        <button ref={returnRef} type="button" data-ui="icon-action" aria-label={t('返回编辑')} title={t('返回编辑')} disabled={mutating} onClick={onClose}><ArrowLeft size={17} /></button>
        {panelControls}
      </div>
    </header>
    {reviewError && <p className="mewiki-ai-review-error" role="alert">{localizeError(reviewError)}</p>}
    <div ref={scrollRef} className="mewiki-ai-review-scroll" tabIndex={0} role="region" aria-label={t('笔记修改差异')}>
      <article className="mewiki-ai-review-page">
        {noteReview ? renderNote(noteReview.before, noteReview.after, noteReview.state) : preview?.target === 'native' && proposal?.kind === 'native' ? <AiNativeProposalReview proposal={proposal} before={preview.before} after={preview.after} state={preview.state} originalState={state} source={mode === 'source'} onOpenNote={onOpenNote} renderActions={renderActions} />
          : preview?.target === 'term' ? <>
          <h1>{proposal?.title}</h1>
          {renderActions({ kind: 'page' })}
          {(['name', 'englishName', 'meaning'] as const).map(field => {
            const lines = textChanges.get(field) ?? [];
            if (!lines.length) return null;
            const changed = lines.some(line => line.kind !== 'context');
            return <section key={field} className="mewiki-ai-review-term-field" data-review-changed={changed}>
              <h2>{field === 'name' ? t('术语名称') : field === 'englishName' ? t('英文名称') : t('定义')}</h2>
              {mode === 'source' ? <TextDiff lines={lines} /> : field !== 'meaning' || (isPlainResearchText(preview.before?.[field] ?? '') && isPlainResearchText(preview.after[field] ?? ''))
                ? <TextDiff lines={lines} block={{ id: field, type: 'paragraph', text: preview.after[field] ?? '' }} />
                : !changed ? <ResearchMarkdown text={preview.after[field] ?? ''} /> : <div className="mewiki-ai-text-diff mewiki-ai-rendered-diff">
                  {preview.before?.[field] && <RenderedChange kind="remove"><ResearchMarkdown text={preview.before[field]} /></RenderedChange>}
                  <RenderedChange kind="add"><ResearchMarkdown text={preview.after[field] ?? ''} /></RenderedChange>
                </div>}
            </section>;
          })}
        </> : currentNote ? renderNote(currentNote, currentNote, state) : null}
      </article>
    </div>
  </section>;
}
