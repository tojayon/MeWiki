import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import AiMascot from './AiMascot.tsx';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { createAiTextSelection, type AiTextSelection } from '../ai/textSelection.ts';
import type { AiSelectionHint } from '../ai/selectionRanges.ts';
import type { AiPanelBounds } from './aiFloatingPanelLayout.ts';
import './AiSelectionToolbar.css';

interface Candidate { noteId: string; blockIds: string[]; text: string; hints: AiSelectionHint[]; anchor: AiPanelBounds; host: Element }
function selectedDocumentText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('.research-heading-number, .research-text-view-toggle').forEach(element => element.remove());
  return fragment.textContent ?? '';
}
function candidateFromDom(root: HTMLElement, state: ResearchNotebookState): Candidate | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const start = element(range.startContainer), end = element(range.endContainer);
  if (!start || !end || !root.contains(start) || !root.contains(end)) return null;
  const pane = start.closest<HTMLElement>('[data-reading-note-id]');
  if (!pane || pane !== end.closest('[data-reading-note-id]') || pane.closest('[aria-hidden=true]') ||
    start.closest('.research-note-embed') || end.closest('.research-note-embed') ||
    !start.closest('.research-read-text, .research-editable-text') || !end.closest('.research-read-text, .research-editable-text')) return null;
  const noteId = pane.dataset.readingNoteId!, note = state.notes.find(note => note.id === noteId);
  if (!note) return null;
  const selected = [...pane.querySelectorAll<HTMLElement>('[data-block-id]')].filter(block => range.intersectsNode(block) &&
    !block.classList.contains('is-examples') && !block.closest('.research-note-embed'));
  const blockIds = selected.map(block => block.dataset.blockId!);
  const text = (range.cloneContents().querySelector('.research-heading-number') ? selectedDocumentText(range) : selection.toString()).trim();
  const hints: AiSelectionHint[] = selected.map(block => {
    const content = block.querySelector('.research-read-text, .research-editable-text');
    if (!content || !range.intersectsNode(content)) return { id: block.dataset.blockId!, text: '', prefix: '' };
    const clipped = range.cloneRange(), bounds = range.cloneRange();
    bounds.selectNodeContents(content);
    if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) clipped.setStart(bounds.startContainer, bounds.startOffset);
    if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) clipped.setEnd(bounds.endContainer, bounds.endOffset);
    const before = bounds.cloneRange(); before.setEnd(clipped.startContainer, clipped.startOffset);
    return { id: block.dataset.blockId!, text: selectedDocumentText(clipped), prefix: selectedDocumentText(before) };
  });
  if (!text || text.length > 4000 || !blockIds.length || blockIds.length > 20 || hints.some(hint => !hint.text.trim())) return null;
  // An active editor may contain text not committed to the controller until blur.
  // Validate its exact ranges after that commit; read surfaces can be checked now.
  if (!start.closest('.research-editable-text') || !pane.contains(pane.ownerDocument.activeElement)) {
    try { createAiTextSelection(state, '', noteId, blockIds, text, hints); } catch { return null; }
  }
  const rect = range.getBoundingClientRect();
  if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) return null;
  return { noteId, blockIds, text, hints, anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, host: pane.closest('dialog') ?? root.ownerDocument.body };
}

export default function AiSelectionToolbar({ rootRef, state, libraryId, disabled, getState, onSelect }: {
  rootRef: RefObject<HTMLElement | null>; state: ResearchNotebookState; libraryId: string; disabled: boolean;
  getState: () => ResearchNotebookState; onSelect: (selection: AiTextSelection, anchor: AiPanelBounds) => void;
}) {
  const locale = useLocale();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const toolbar = useRef<HTMLDivElement | null>(null);
  const pendingAttach = useRef(0);
  const latest = useRef({ state, libraryId, disabled, getState, onSelect });
  useLayoutEffect(() => { latest.current = { state, libraryId, disabled, getState, onSelect }; }, [state, libraryId, disabled, getState, onSelect]);
  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!candidate || !element) return;
    const rect = element.getBoundingClientRect(), anchor = candidate.anchor;
    const below = anchor.top + anchor.height + 5;
    element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${below + rect.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - rect.height - 5)}px`;
  }, [candidate, locale, disabled]);
  const choose = useCallback(() => {
    const root = rootRef.current, current = root && candidateFromDom(root, latest.current.getState());
    if (!current || latest.current.disabled) return;
    // Commit the ordinary text editor before taking the source baseline.
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) active.blur();
    const origin = latest.current.libraryId;
    setCandidate(null); document.getSelection()?.removeAllRanges();
    cancelAnimationFrame(pendingAttach.current);
    pendingAttach.current = requestAnimationFrame(() => {
      pendingAttach.current = 0;
      if (latest.current.libraryId !== origin || latest.current.disabled || !root.isConnected) return;
      try {
        const selection = createAiTextSelection(latest.current.getState(), origin, current.noteId, current.blockIds, current.text, current.hints);
        latest.current.onSelect(selection, current.anchor);
      } catch { /* A stale or ambiguous DOM range must never widen the task. */ }
    });
  }, [rootRef]);
  useEffect(() => {
    let frame = 0, pointerSelecting = false;
    let dismissed = '';
    const signature = (value: Candidate | null) => value ? JSON.stringify([value.noteId, value.blockIds, value.text, value.hints]) : '';
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (toolbar.current?.contains(document.activeElement)) return;
        const next = !latest.current.disabled && root ? candidateFromDom(root, latest.current.state) : null;
        if (!next || signature(next) !== dismissed) dismissed = '';
        setCandidate(next && signature(next) !== dismissed ? next : null);
      });
    };
    const down = (event: PointerEvent) => {
      if (toolbar.current?.contains(event.target as Node)) return;
      pointerSelecting = event.button === 0 && !!rootRef.current?.contains(event.target as Node);
      dismissed = ''; setCandidate(null);
    };
    const up = () => { pointerSelecting = false; update(); };
    const changed = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') return;
        pointerSelecting = false;
      }
      if (!pointerSelecting) update();
    };
    const blur = () => { pointerSelecting = false; cancelAnimationFrame(frame); setCandidate(null); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissed = signature(rootRef.current && candidateFromDom(rootRef.current, latest.current.state));
        cancelAnimationFrame(frame); setCandidate(null); return;
      }
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'Enter' && rootRef.current && candidateFromDom(rootRef.current, latest.current.getState())) {
        event.preventDefault(); event.stopPropagation(); choose();
      }
    };
    document.addEventListener('selectionchange', changed); document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true); document.addEventListener('lostpointercapture', up, true);
    document.addEventListener('keyup', changed); document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    window.addEventListener('blur', blur); window.addEventListener('focus', update);
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(pendingAttach.current); document.removeEventListener('selectionchange', changed); document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true); document.removeEventListener('lostpointercapture', up, true);
      document.removeEventListener('keyup', changed); document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update);
      window.removeEventListener('blur', blur); window.removeEventListener('focus', update);
    };
  }, [rootRef, choose]);
  if (!candidate || disabled) return null;
  return createPortal(<div ref={toolbar} className="mewiki-ai-selection-toolbar">
    <button type="button" data-ui="menu-action" aria-label={t('用 AI 处理选中文字')} title={t('用 AI 处理选中文字')} aria-keyshortcuts="Alt+Enter" onPointerDown={event => event.preventDefault()} onClick={choose}><AiMascot size={22} /><span>{t('用 AI 处理选中文字')}</span></button>
  </div>, candidate.host);
}
