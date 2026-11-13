import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ArrowUpRight, Bot, Check, ChevronDown, Cpu, Eraser, Eye, FileText, GitCompareArrows, MessageSquareText, Settings2, Square, Undo2, X } from 'lucide-react';
import { getAiSettings } from '../ai/client.ts';
import { undoAiChange, type AiChange, type AiProposal } from '../ai/proposals.ts';
import { aiProposalTargetKey, applyAiProposalGroup } from '../ai/proposalGroup.ts';
import { rebaseAiReviewProposals, reviseAiProposal, type AiProposalAdjustment } from '../ai/reviewDecisions.ts';
import { runAiTask, type AiRunProgress } from '../ai/runner.ts';
import { aiHistoryContextKey, createAiSession, readAiSession, writeAiSession, type AiSession } from '../ai/session.ts';
import { finishAiUsage } from '../ai/usage.ts';
import { createAiToolContext } from '../ai/tools.ts';
import type { AiSettings } from '../ai/types.ts';
import { isMeWikiManualNote } from '../domain/meWikiManual.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { useLibraryWorkspace } from '../state/LibraryWorkspaceContext.ts';
import type { ResearchLibrarySnapshot } from '../state/researchLibraryController.ts';
import { useResearchLibrary } from '../state/useResearchNotebook.ts';
import AiProposalReview from './AiProposalReview.tsx';
import AiUsagePanel from './AiUsagePanel.tsx';
import { nativeOperationLabel } from './aiNativeLabels.ts';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import './AiWorkspace.css';

function restoreSession(libraryId: string): AiSession {
  try { return readAiSession(libraryId, localStorage); }
  catch { return createAiSession(libraryId); }
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'AI 任务失败，请稍后重试。';
}
function finishSession(session: AiSession, status: AiSession['status'], error = ''): AiSession {
  const last = session.history.at(-1);
  const history = session.output && !(last?.role === 'assistant' && last.content === session.output)
    ? [...session.history, { role: 'assistant' as const, content: session.output, providerName: session.providerName, model: session.model, contextKey: session.contextKey }].slice(-20)
    : session.history;
  return { ...session, status, history, error, usageHistory: finishAiUsage(session, status) };
}
function unavailableReason(snapshot: ResearchLibrarySnapshot, readOnly: boolean, switching: boolean): string {
  if (switching) return '资料库正在切换，请稍后重试。';
  if (readOnly) return '当前为只读模式，切换到编辑模式后可应用建议。';
  if (snapshot.busy || snapshot.status === 'loading') return '资料库尚未准备好，请稍后重试。';
  if (snapshot.status === 'error' || snapshot.status === 'conflict') return snapshot.error || '请先处理资料库的保存错误或冲突。';
  return snapshot.cacheError;
}
function proposalLabel(proposal: AiProposal): string {
  if (proposal.kind === 'native') return nativeOperationLabel(proposal.edit.action);
  if (proposal.kind === 'create') return t('创建笔记');
  if (proposal.kind === 'append') return t('追加内容');
  if (proposal.kind === 'replace-text') return t('修改文字块');
  if (proposal.kind === 'delete-text') return t('删除文字块');
  return proposal.before ? t('修改术语') : t('创建术语');
}
function toolLabel(tool: string): string {
  const separator = tool.indexOf(':');
  const name = separator < 0 ? tool : tool.slice(0, separator);
  const labels: Record<string, string> = {
    get_capabilities: t('读取能力'), list_notes: t('浏览笔记'), search_notes: t('检索笔记'),
    read_note: t('阅读原文'), search_dictionary: t('查询词典'),
    propose_note: t('准备笔记建议'), propose_term: t('准备术语建议'),
    read_block: t('读取内容块'), read_dictionary_entry: t('读取完整词条'), read_theory_maps: t('读取理论地图'),
    get_edit_schema: t('读取操作字段'), propose_edit: t('准备内容建议'),
  };
  const label = labels[name] ?? name;
  return separator < 0 ? label : `${label} · ${localizeError(tool.slice(separator + 1).trim())}`;
}
function TextOutput({ text, markdown = false }: { text: string; markdown?: boolean }) {
  return <div className={`mewiki-ai-text-output${markdown ? ' research-markdown' : ''}`}>{markdown ? <ResearchMarkdown text={text} /> : text}</div>;
}
function latestChange(changes: AiChange[], change: AiChange): boolean {
  return changes.findLast(item => item.target === change.target && item.targetId === change.targetId)?.proposalId === change.proposalId;
}

export default function AiWorkspace({ readOnly, reviewHost, reviewControls, reviewActions, onClose, onSettings }: {
  readOnly: boolean; reviewHost: HTMLElement | null; reviewControls?: ReactNode; reviewActions?: ReactNode; onClose: () => void; onSettings: () => void;
}) {
  useLocale();
  const workspace = useLibraryWorkspace();
  const library = useResearchLibrary();
  const { controller } = library;
  const libraryId = workspace.profile.id;
  const reviewLocation = JSON.stringify([library.notebook.view, library.notebook.activeNoteId, library.notebook.activeSymbolId, library.notebook.activeTermId, library.notebook.theoryMaps?.activeMapId]);
  const reviewLocationRef = useRef(reviewLocation);
  const [session, setSession] = useState(() => restoreSession(libraryId));
  const sessionRef = useRef(session);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [scope, setScope] = useState<'current' | 'library'>('current');
  const prompt = session.draft ?? '';
  const [storageError, setStorageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [mutating, setMutating] = useState(false);
  const [adjustingIds, setAdjustingIds] = useState<string[]>([]);
  const adjustingChanged = useCallback((id: string, editing: boolean) => setAdjustingIds(ids => editing ? ids.includes(id) ? ids : [...ids, id] : ids.includes(id) ? ids.filter(item => item !== id) : ids), []);
  const [clearing, setClearing] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<{ id: string; location: string; focus?: number } | null>(null);
  const reviewFocus = useRef(0);
  const [liveDraft, setLiveDraft] = useState<AiProposal | null>(null);
  const [liveFollowing, setLiveFollowing] = useState(false);
  const liveFollow = useRef(false);
  const draftRef = useRef<AiProposal | null>(null);
  const lastGenerated = useRef<AiProposal | null>(null);
  const previewId = previewSelection?.location === reviewLocation ? previewSelection.id : null;
  if (previewSelection && previewSelection.location !== reviewLocation) {
    setPreviewSelection(null); setLiveFollowing(false); setLiveDraft(null);
  }
  useLayoutEffect(() => { reviewLocationRef.current = reviewLocation; liveFollow.current = false; draftRef.current = null; }, [reviewLocation]);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const [following, setFollowing] = useState(true);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const historyContentRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const modelMenuRef = useRef<HTMLDetailsElement | null>(null);
  const followLatest = useRef(true);
  const composing = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutatingRef = useRef(false);
  const access = useRef({ readOnly, switching: workspace.switching });
  useLayoutEffect(() => { access.current = { readOnly, switching: workspace.switching }; }, [readOnly, workspace.switching]);

  const persist = useCallback((value: AiSession): boolean => {
    try {
      writeAiSession(value, localStorage);
      if (mounted.current) setStorageError('');
      return true;
    } catch (cause) {
      if (mounted.current) setStorageError(errorMessage(cause));
      return false;
    }
  }, []);
  const publish = useCallback((update: AiSession | ((current: AiSession) => AiSession), save: 'now' | 'later' | 'none' = 'later') => {
    const next = typeof update === 'function' ? update(sessionRef.current) : update;
    sessionRef.current = next;
    if (mounted.current) setSession(next);
    if (save === 'none') return;
    if (save === 'now') {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = null;
      persist(next);
    } else if (writeTimer.current === null) {
      writeTimer.current = setTimeout(() => { writeTimer.current = null; persist(sessionRef.current); }, 250);
    }
  }, [persist]);
  function setPrompt(draft: string) { publish(current => ({ ...current, draft })); }
  useEffect(() => {
    const flush = () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = null;
      persist(sessionRef.current);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [persist]);
  const dispose = useCallback(() => {
    mounted.current = false; generation.current++; request.current?.abort(); request.current = null;
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    const current = sessionRef.current;
    const latest = current.status === 'running' ? finishSession(current, 'interrupted') : current;
    sessionRef.current = latest; persist(latest);
  }, [persist]);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void getAiSettings(abort.signal).then(value => {
      if (!mounted.current || abort.signal.aborted) return;
      const selected = value.providers.find(item => item.id === value.defaultProviderId) ?? value.providers[0];
      setSettings(value); setProviderId(selected?.id ?? ''); setModel(selected?.model ?? '');
    }).catch(cause => {
      if (mounted.current && !abort.signal.aborted) setSettingsError(errorMessage(cause));
    }).finally(() => { if (mounted.current && !abort.signal.aborted) setSettingsLoading(false); });
    return () => {
      abort.abort(); dispose();
    };
  }, [dispose]);

  const provider = settings?.providers.find(item => item.id === providerId);
  const running = session.status === 'running';
  const blockedReason = unavailableReason(library, readOnly, workspace.switching);
  const currentNote = library.notebook.notes.find(note => note.id === library.notebook.activeNoteId);
  const noteCount = scope === 'library' ? library.notebook.notes.filter(note => !isMeWikiManualNote(note)).length : currentNote ? 1 : 0;
  const canRun = !!provider && !!model.trim() && !!prompt.trim() && !running && !mutating && !clearing && !workspace.switching && !library.busy && library.status !== 'loading' && session.proposals.length < 40;

  useLayoutEffect(() => {
    const input = promptRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [prompt]);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (followLatest.current && history?.clientHeight) history.scrollTop = history.scrollHeight;
  }, [session, settingsLoading, settingsError, blockedReason, storageError, actionError, notice]);
  useEffect(() => {
    const history = historyRef.current;
    const content = historyContentRef.current;
    if (!history || !content) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current && history.clientHeight) history.scrollTop = history.scrollHeight;
    });
    observer.observe(history); observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const menu = modelMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  function scrollToLatest() {
    followLatest.current = true; setFollowing(true);
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }

  function close() {
    generation.current++; request.current?.abort(); request.current = null;
    if (sessionRef.current.status === 'running') publish(current => finishSession(current, 'interrupted'), 'now');
    onClose();
  }
  function stop() {
    if (sessionRef.current.status !== 'running') return;
    generation.current++; request.current?.abort(); request.current = null;
    finishLiveDraft();
    publish(current => finishSession(current, 'cancelled'), 'now');
  }
  function newSession() {
    if (mutatingRef.current) return;
    generation.current++; request.current?.abort(); request.current = null;
    followLatest.current = true; setFollowing(true);
    publish(createAiSession(libraryId), 'now'); setActionError(''); setNotice(''); setClearing(false); setPreviewSelection(null);
    pauseLiveReview(); setLiveDraft(null); draftRef.current = null; lastGenerated.current = null;
  }
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRun || request.current || mutatingRef.current || sessionRef.current.status === 'running') return;
    const actualProvider = provider!;
    const actualModel = model.trim();
    const task = prompt.trim();
    const snapshot = controller.getSnapshot();
    if (access.current.switching || snapshot.busy || snapshot.status === 'loading') return;
    const noteIds = scope === 'library'
      ? snapshot.notebook.notes.filter(note => !isMeWikiManualNote(note)).map(note => note.id)
      : snapshot.notebook.notes.filter(note => note.id === snapshot.notebook.activeNoteId).map(note => note.id);
    const context = createAiToolContext(snapshot.notebook, libraryId, noteIds);
    const contextKey = aiHistoryContextKey(actualProvider, actualModel, noteIds);
    const previous = sessionRef.current;
    const next: AiSession = { ...previous, status: 'running', draft: '', output: '', tools: [], usage: { inputTokens: 0, outputTokens: 0 },
      history: [...previous.history, { role: 'user' as const, content: task, contextKey },
        { role: 'assistant' as const, content: '', contextKey, providerName: actualProvider.name, model: actualModel, activity: { tools: [], proposalIds: [] } }].slice(-20),
      error: '', providerName: actualProvider.name, model: actualModel, contextKey };
    if (!persist(next)) return;
    followLatest.current = true; setFollowing(true);
    if (modelMenuRef.current) modelMenuRef.current.open = false;
    publish(next, 'none'); setActionError(''); setNotice('');
    liveFollow.current = true; setLiveFollowing(true); setLiveDraft(null); draftRef.current = null; lastGenerated.current = null;
    setPreviewSelection({ id: 'live:waiting', location: reviewLocation });
    const abort = new AbortController(); request.current = abort; const token = ++generation.current;
    const accept = () => mounted.current && generation.current === token && !abort.signal.aborted;
    const progress = (value: AiRunProgress) => {
      if (!accept()) return;
      const proposals = [...previous.proposals, ...value.proposals];
      publish(current => ({ ...current, ...value, sourceIds: [...new Set([...previous.sourceIds, ...value.sourceIds])].slice(0, 1000), proposals: proposals.slice(0, 40),
        history: current.history.map((message, index) => index === current.history.length - 1 ? { ...message, content: value.output,
          activity: { tools: [...value.tools], proposalIds: value.proposals.map(proposal => proposal.id).filter(id => proposals.slice(0, 40).some(proposal => proposal.id === id)) } } : message),
      }));
      lastGenerated.current = value.proposals.at(-1) ?? null;
      if (liveFollow.current && !draftRef.current && lastGenerated.current) setPreviewSelection({ id: lastGenerated.current.id, location: reviewLocationRef.current });
      if (proposals.length > 40) throw new Error('本会话建议已达到上限，请新建会话后继续。');
    };
    try {
      const result = await runAiTask({ context, providerId: actualProvider.id, model: actualModel, prompt: task, signal: abort.signal, history: previous.history.filter(message => message.contextKey === contextKey), onProgress: progress,
        onDraft: value => {
          if (!accept()) return;
          draftRef.current = value; setLiveDraft(value);
          if (liveFollow.current) setPreviewSelection({ id: value?.id ?? lastGenerated.current?.id ?? 'live:waiting', location: reviewLocationRef.current });
        } });
      if (!accept()) return;
      progress(result); finishLiveDraft(); publish(current => finishSession(current, 'complete'), 'now');
    } catch (cause) {
      if (!accept()) return;
      finishLiveDraft();
      publish(current => finishSession(current, 'error', errorMessage(cause)), 'now');
    } finally { if (generation.current === token) request.current = null; }
  }
  function continueReview(next: AiSession, target: AiProposal) {
    const selected = sessionRef.current.proposals.find(item => item.id === previewSelection?.id);
    if (!selected || aiProposalTargetKey(selected) !== aiProposalTargetKey(target)) return;
    pauseLiveReview();
    const remaining = next.proposals.filter(item => aiProposalTargetKey(item) === aiProposalTargetKey(target) && !next.appliedIds.includes(item.id) && !next.rejectedIds?.includes(item.id));
    if (!remaining.length) { closeReview(); return; }
    setPreviewSelection(selection => selection ? { ...selection, id: remaining.find(item => item.id === selection.id)?.id ?? remaining[0].id } : null);
  }
  function rejectProposal(proposal: AiProposal, restore = false) {
    if (mutatingRef.current || sessionRef.current.status === 'running' || storageError || adjustingIds.includes(proposal.id)) return;
    const reason = unavailableReason(controller.getSnapshot(), access.current.readOnly, access.current.switching);
    if (reason) { setActionError(reason); return; }
    const current = sessionRef.current;
    if (!current.proposals.includes(proposal) || current.appliedIds.includes(proposal.id)) return;
    const next: AiSession = { ...current, rejectedIds: restore ? (current.rejectedIds ?? []).filter(id => id !== proposal.id) : [...new Set([...(current.rejectedIds ?? []), proposal.id])] };
    if (!persist(next)) return;
    publish(next, 'none'); setActionError(''); setNotice('');
    if (restore) selectReview(proposal.id);
    else if (previewSelection) continueReview(next, proposal);
  }
  async function reviseProposal(proposal: AiProposal, adjustment: AiProposalAdjustment): Promise<boolean> {
    if (mutatingRef.current || sessionRef.current.status === 'running' || storageError) return false;
    const snapshot = controller.getSnapshot();
    const reason = unavailableReason(snapshot, access.current.readOnly, access.current.switching);
    if (reason) throw new Error(reason);
    const current = sessionRef.current;
    if (!current.proposals.includes(proposal) || current.appliedIds.includes(proposal.id) || current.rejectedIds?.includes(proposal.id)) return false;
    const adjusted = reviseAiProposal(snapshot.notebook, proposal, adjustment, libraryId, current.changes);
    const next = { ...current, proposals: current.proposals.map(item => item.id === proposal.id ? adjusted : item) };
    if (!persist(next)) return false;
    publish(next, 'none'); setActionError(''); setNotice('');
    return true;
  }
  async function changeProposal(proposal: AiProposal, undo = false, group?: AiProposal[], keepReview = false) {
    if (mutatingRef.current || sessionRef.current.status === 'running') return;
    if (!undo && (group ?? [proposal]).some(item => adjustingIds.includes(item.id))) return;
    if (!sessionRef.current.proposals.some(item => item.id === proposal.id)) return;
    const { readOnly: currentReadOnly, switching } = access.current;
    const reason = unavailableReason(controller.getSnapshot(), currentReadOnly, switching);
    if (reason) { setActionError(reason); return; }
    if (storageError) return;
    const token = generation.current;
    mutatingRef.current = true; setMutating(true); setActionError(''); setNotice('');
    try {
      await controller.flush();
      if (!mounted.current || token !== generation.current) return;
      const snapshot = controller.getSnapshot();
      const unavailable = unavailableReason(snapshot, access.current.readOnly, access.current.switching);
      if (unavailable) throw new Error(unavailable);
      const current = sessionRef.current;
      let nextState;
      let nextSession: AiSession;
      if (undo) {
        const change = current.changes.find(item => item.proposalId === proposal.id);
        if (!change || !latestChange(current.changes, change)) throw new Error('请先撤回此目标的最后一项修改。');
        nextState = undoAiChange(snapshot.notebook, change, libraryId);
        nextSession = { ...current, changes: current.changes.filter(item => item.proposalId !== proposal.id) };
      } else {
        if (current.appliedIds.includes(proposal.id)) return;
        if (current.appliedIds.length >= 40) throw new Error('本会话建议已达到上限，请新建会话后继续。');
        const pending = (group ?? [proposal]).filter(item => !current.appliedIds.includes(item.id) && !current.rejectedIds?.includes(item.id));
        if (!pending.length) return;
        if (pending.some(item => !current.proposals.includes(item))) throw new Error('AI 建议目标无效。');
        const result = applyAiProposalGroup(snapshot.notebook, pending, libraryId, current.changes);
        nextState = result.state;
        nextSession = { ...current, changes: [...current.changes, ...result.changes], appliedIds: [...current.appliedIds, ...pending.map(item => item.id)],
          mergedIds: [...(current.mergedIds ?? []), ...result.mergedIds] };
      }
      const pending = nextSession.proposals.filter(item => !nextSession.appliedIds.includes(item.id) && !nextSession.rejectedIds?.includes(item.id));
      const rebased = new Map(rebaseAiReviewProposals(snapshot.notebook, nextState, pending, libraryId, current.changes).map(item => [item.id, item]));
      nextSession = { ...nextSession, proposals: nextSession.proposals.map(item => rebased.get(item.id) ?? item) };
      // Record approval before changing the notebook, including when its durable save later fails.
      if (!persist(nextSession)) return;
      publish(nextSession, 'none'); controller.setState(nextState);
      if (keepReview || undo && previewSelection) continueReview(nextSession, proposal);
      else if (!undo) closeReview();
      await controller.flush();
      const saved = controller.getSnapshot();
      if (saved.cacheError) throw new Error(saved.cacheError);
      if (saved.status === 'error' || saved.status === 'conflict') throw new Error(saved.error || '请先处理资料库的保存错误或冲突。');
      if (mounted.current && generation.current === token) setNotice(undo ? '此项修改已撤回并保存。' : '建议已应用并保存。');
    } catch (cause) {
      if (mounted.current && generation.current === token) setActionError(errorMessage(cause));
    } finally { mutatingRef.current = false; if (mounted.current) setMutating(false); }
  }
  function openSource(noteId: string) {
    const snapshot = controller.getSnapshot();
    if (!sessionRef.current.sourceIds.includes(noteId) || !snapshot.notebook.notes.some(note => note.id === noteId) || snapshot.busy || snapshot.status === 'loading' || access.current.switching || mutatingRef.current) return;
    setPreviewSelection(null); pauseLiveReview();
    controller.setState({ ...snapshot.notebook, activeNoteId: noteId, view: 'notes', open: true });
  }
  function closeReview() {
    pauseLiveReview();
    setPreviewSelection(null);
    requestAnimationFrame(() => {
      const target = previewTrigger.current?.isConnected ? previewTrigger.current : promptRef.current;
      if (mounted.current && target && target.getClientRects().length) target.focus({ preventScroll: true });
    });
  }
  function pauseLiveReview() { liveFollow.current = false; setLiveFollowing(false); }
  function finishLiveDraft() {
    draftRef.current = null; setLiveDraft(null);
    if (liveFollow.current) setPreviewSelection(lastGenerated.current ? { id: lastGenerated.current.id, location: reviewLocationRef.current } : null);
    // Keep the final review mounted; subsequent explicit selections are manual.
    pauseLiveReview();
  }
  function selectReview(id: string) { pauseLiveReview(); setPreviewSelection({ id, location: reviewLocation, focus: ++reviewFocus.current }); }
  function resumeLiveReview() {
    liveFollow.current = true; setLiveFollowing(true);
    setPreviewSelection({ id: draftRef.current?.id ?? lastGenerated.current?.id ?? 'live:waiting', location: reviewLocation });
  }
  const pendingProposals = session.proposals.filter(proposal => !session.appliedIds.includes(proposal.id) && !session.rejectedIds?.includes(proposal.id));
  const previewProposal = liveDraft?.id === previewId ? liveDraft : pendingProposals.find(proposal => proposal.id === previewId);
  const showReview = !!previewSelection && (!!previewProposal || running && previewId === 'live:waiting');
  const lastMessage = session.history.at(-1);
  const showOutput = !!session.output && !(lastMessage?.role === 'assistant' && lastMessage.content === session.output) || lastMessage?.role !== 'assistant' && !!session.tools.length;
  const messages = showOutput ? [...session.history, { role: 'assistant' as const, content: session.output, providerName: session.providerName, model: session.model }] : session.history;
  const lastAssistant = messages.findLastIndex(message => message.role === 'assistant');
  const assignedProposals = new Set(session.history.flatMap(message => message.activity?.proposalIds ?? []));
  const earlierProposals = session.proposals.filter(proposal => !assignedProposals.has(proposal.id));
  const conversationTitle = session.history.find(message => message.role === 'user')?.content.replace(/\s+/g, ' ').trim() || t('AI 对话');
  const sourceNotes = session.sourceIds.flatMap(id => {
    const note = library.notebook.notes.find(item => item.id === id);
    return note ? [note] : [];
  });

  function renderProposals(proposals: AiProposal[], earlier = false) {
    const targets = new Set(proposals.map(proposal => `${proposal.kind === 'native' ? proposal.target : proposal.kind === 'term' ? 'term' : 'note'}:${proposal.targetId}`)).size;
    return !!proposals.length && <section className="mewiki-ai-proposals" aria-label={earlier ? t('历史建议') : t('待审阅建议')}>
      <h3>{earlier ? t('历史建议') : t('修改预览')}</h3>
      <p className="mewiki-ai-proposal-stats"><span>{t`${proposals.length} 项修改`}</span><span>{t`${targets} 个目标`}</span></p>
      {proposals.map(proposal => {
        const applied = session.appliedIds.includes(proposal.id);
        const rejected = session.rejectedIds?.includes(proposal.id);
        const decidingDisabled = running || mutating || !!blockedReason || !!storageError || adjustingIds.includes(proposal.id);
        const change = session.changes.find(item => item.proposalId === proposal.id);
        const last = !!change && latestChange(session.changes, change);
        return <article key={proposal.id} className="mewiki-ai-proposal">
          <header><small>{proposalLabel(proposal)}</small><strong title={proposal.title}>{proposal.title}</strong></header>
          <div className="mewiki-ai-proposal-actions">{rejected ? <><span>{t('已拒绝')}</span><button type="button" disabled={decidingDisabled} onClick={() => rejectProposal(proposal, true)}><Undo2 size={14} /><span>{t('恢复此建议')}</span></button></> : !applied ? <><button type="button" disabled={mutating || !reviewHost} aria-pressed={previewId === proposal.id} onClick={event => { previewTrigger.current = event.currentTarget; setActionError(''); selectReview(proposal.id); }}><GitCompareArrows size={14} /><span>{t('查看修改')}</span></button><button type="button" disabled={decidingDisabled} onClick={() => void changeProposal(proposal)}><Check size={14} /><span>{t('应用建议')}</span></button><button type="button" aria-label={t('拒绝此修改')} title={t('拒绝此修改')} disabled={decidingDisabled} onClick={() => rejectProposal(proposal)}><X size={14} /></button></>
            : change ? <><span className="mewiki-ai-applied"><Check size={13} />{t('已应用')}</span><button type="button" disabled={!last || running || mutating || !!blockedReason || !!storageError} title={!last ? t('请先撤回此目标的最后一项修改。') : undefined} onClick={() => void changeProposal(proposal, true)}><Undo2 size={14} /><span>{t('撤回此修改')}</span></button></>
              : <span>{session.mergedIds?.includes(proposal.id) ? t('已合并') : t('已撤回')}</span>}</div>
        </article>;
      })}
    </section>;
  }

  return <section aria-label={t('AI 工作区')} data-testid="mewiki-ai-workspace" className="mewiki-ai-workspace">
    <div className="mewiki-ai-history-shell">
      <div ref={historyRef} className="mewiki-ai-history" role="region" aria-label={t('会话记录')} tabIndex={0} onScroll={event => {
        const history = event.currentTarget;
        if (!history.clientHeight) return;
        const nearBottom = history.scrollHeight - history.clientHeight - history.scrollTop < 48;
        followLatest.current = nearBottom; setFollowing(nearBottom);
      }}>
      <div ref={historyContentRef} className="mewiki-ai-history-content">
      <section className="mewiki-ai-conversation">
        {!session.history.length && !session.output && <div className="mewiki-ai-welcome"><MessageSquareText size={24} aria-hidden="true" /><h3>{t('开始一段笔记对话')}</h3></div>}
        <div className="mewiki-ai-messages">
          {renderProposals(earlierProposals, true)}
          {messages.map((message, index) => {
            const tools = message.role === 'assistant' ? message.activity?.tools ?? (index === lastAssistant ? session.tools : []) : [];
            return <article key={index} className="mewiki-ai-message" data-role={message.role} aria-label={message.role === 'user' ? t('你') : 'MeWiki'}>
              {message.role === 'assistant' && <header className="mewiki-ai-assistant-header">
                <span className="mewiki-ai-avatar" aria-hidden="true"><Bot size={16} /></span>
                <strong className="mewiki-ai-assistant-name" title={[message.providerName, message.model].filter(Boolean).join(' · ')}>MeWiki</strong>
              </header>}
              {!!tools.length && <details className="mewiki-ai-tool-progress" open={running && index === messages.length - 1}><summary>{t`工具进度（${tools.length}）`}</summary><ol>{tools.map((tool, toolIndex) => <li key={toolIndex}>{toolLabel(tool)}</li>)}</ol></details>}
              {!!message.content && <TextOutput text={message.content} markdown={message.role === 'assistant'} />}
              {message.role === 'assistant' && renderProposals(session.proposals.filter(proposal => message.activity?.proposalIds.includes(proposal.id)))}
            </article>;
          })}
        </div>
      </section>
      <div className="mewiki-ai-task-status" aria-live="polite">
        {settingsLoading && <p role="status">{t('正在加载 AI 服务…')}</p>}
        {settingsError && <p className="mewiki-ai-error" role="alert">{localizeError(settingsError)}</p>}
        {!settingsLoading && settings && !settings.providers.length && <p>{t('请先配置 AI 服务，再运行笔记任务。')} <button type="button" className="mewiki-ai-text-button" onClick={() => { close(); onSettings(); }}>{t('前往 AI 服务设置')}</button></p>}
        {running && <p role="status">{t('任务执行中…')}</p>}
        {session.status === 'cancelled' && <p role="status">{t('任务已停止，已生成的结果仍可查看。')}</p>}
        {session.status === 'interrupted' && <p role="status">{t('上次任务已中断，已生成的结果仍可查看。')}</p>}
        {session.proposals.length >= 40 && <p>{t('本会话建议已达到上限，请新建会话后继续。')}</p>}
        {blockedReason && <p>{localizeError(blockedReason)}</p>}
        {storageError && <p className="mewiki-ai-error" role="alert">{localizeError(storageError)}</p>}
        {session.error && <p className="mewiki-ai-error" role="alert">{localizeError(session.error)}</p>}
        {actionError && <p className="mewiki-ai-error" role="alert">{localizeError(actionError)}</p>}
        {notice && <p role="status">{localizeError(notice)}</p>}
      </div>
      </div>
      </div>
      {!following && <button type="button" className="mewiki-ai-jump-latest" onClick={scrollToLatest}><ArrowDown size={13} /><span>{t('返回最新消息')}</span></button>}
    </div>
    <form className="mewiki-ai-task-form" onSubmit={event => void run(event)}>
      {clearing && <div className="mewiki-ai-clear-confirmation" role="group" aria-label={t('清空会话确认')}>
        <p>{t('清空后会删除本库的 AI 会话、建议和撤回记录，已应用到笔记与词典的内容保留。')}</p>
        <div><button type="button" onClick={newSession}>{t('确认清空')}</button><button type="button" onClick={() => setClearing(false)}>{t('取消')}</button></div>
      </div>}
      {!!sourceNotes.length && <div className="mewiki-ai-sources" role="group" aria-label={t('参考来源')}><div>{sourceNotes.map(note =>
        <button key={note.id} type="button" title={note.title || t('未命名笔记')} disabled={mutating || library.busy || workspace.switching || library.status === 'loading'} onClick={() => openSource(note.id)}><FileText size={13} /><span>{note.title || t('未命名笔记')}</span><ArrowUpRight size={12} /></button>,
      )}</div></div>}
      <div className="mewiki-ai-composer">
        <label className="visually-hidden" htmlFor="mewiki-ai-task-prompt">{t('任务要求')}</label>
        <textarea ref={promptRef} id="mewiki-ai-task-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} disabled={mutating || clearing} maxLength={12000} rows={2} placeholder={t('向 AI 提问，或描述要完成的笔记任务…')} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
          event.preventDefault();
          if (canRun) event.currentTarget.form?.requestSubmit();
        }} />
        <div className="mewiki-ai-composer-controls">
          <details ref={modelMenuRef} className="mewiki-ai-model-menu" onKeyDown={event => {
            if (event.key !== 'Escape' || !event.currentTarget.open) return;
            event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
          }}>
            <summary role="button" aria-label={t('模型设置')} title={provider ? `${provider.name} · ${model}` : t('模型设置')}><Cpu size={13} aria-hidden="true" /><span>{model || t('选择模型')}</span><ChevronDown size={12} aria-hidden="true" /></summary>
            <div className="mewiki-ai-model-options">
              <fieldset disabled={running || mutating || settingsLoading || clearing}>
                <legend className="visually-hidden">{t('模型设置')}</legend>
                <label htmlFor="mewiki-ai-run-provider"><span>{t('AI 服务')}</span><select id="mewiki-ai-run-provider" value={providerId} onChange={event => {
                  setProviderId(event.target.value); setModel(settings?.providers.find(item => item.id === event.target.value)?.model ?? '');
                }}>
                  {!settings?.providers.length && <option value="">{t('尚未添加 AI 服务')}</option>}
                  {settings?.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label htmlFor="mewiki-ai-run-model"><span>{t('本次模型')}</span><input id="mewiki-ai-run-model" value={model} onChange={event => setModel(event.target.value)} maxLength={256} autoComplete="off" spellCheck={false} /></label>
              </fieldset>
              <p>{t`本次可读取 ${noteCount} 篇笔记及当前资料库词典。`}{scope === 'library' && ` ${t('整库范围不包含使用手册。')}`}</p>
              <p>{t('选定资料会发送给所选服务，请按需要选择范围。')}</p>
            </div>
          </details>
          <select className="mewiki-ai-scope" aria-label={t('资料范围')} title={scope === 'library' ? t('当前资料库与词典') : t('当前笔记与词典')} value={scope} disabled={running || mutating || clearing} onChange={event => setScope(event.target.value as typeof scope)}>
            <option value="current">{t('当前笔记')}</option><option value="library">{t('当前资料库')}</option>
          </select>
          {running && <button type="button" data-ui="icon-action" aria-label={t('跟随 AI 修改')} title={t('跟随 AI 修改')} aria-pressed={liveFollowing} onClick={() => liveFollowing ? closeReview() : resumeLiveReview()}><Eye size={15} /></button>}
          {running ? <button type="button" className="mewiki-ai-send mewiki-ai-stop" aria-label={t('停止任务')} title={t('停止任务')} onClick={stop}><Square size={15} fill="currentColor" /></button>
            : <button type="submit" className="mewiki-ai-send" aria-label={t('发送消息')} title={t('发送消息')} disabled={!canRun}><ArrowUp size={18} /></button>}
        </div>
      </div>
      <footer className="mewiki-ai-session-bar">
        <span className="mewiki-ai-session-title" title={conversationTitle}>{conversationTitle}</span>
        <div role="toolbar" aria-label={t('AI 会话操作')}>
          <AiUsagePanel session={session} onOpen={() => { if (modelMenuRef.current) modelMenuRef.current.open = false; }} />
          <button type="button" data-ui="icon-action" aria-label={t('清空会话')} title={t('清空会话')} disabled={running || mutating || clearing} onClick={() => setClearing(true)}><Eraser size={14} /></button>
          <button type="button" data-ui="icon-action" aria-label={t('AI 服务设置')} title={t('AI 服务设置')} onClick={() => { close(); onSettings(); }}><Settings2 size={14} /></button>
          <button type="button" data-ui="icon-action" aria-label={t('关闭AI 工作区')} title={t('关闭AI 工作区')} onClick={close}><X size={14} /></button>
        </div>
      </footer>
    </form>
    {reviewHost && showReview && createPortal(<AiProposalReview proposal={previewProposal ?? null} proposals={liveDraft && previewId === liveDraft.id ? [...pendingProposals, liveDraft] : pendingProposals} state={library.notebook} libraryId={libraryId} changes={session.changes}
      disabledReason={blockedReason || storageError || actionError} mutating={mutating} running={running} streaming={previewId === liveDraft?.id} autoFollow={liveFollowing} onStop={stop}
      onApply={group => { if (previewProposal && previewProposal !== liveDraft) void changeProposal(previewProposal, false, group); }} onClose={closeReview} onSelect={selectReview} focusKey={previewSelection?.focus} pageControls={reviewControls} panelControls={reviewActions}
      onApplyItem={proposal => void changeProposal(proposal, false, undefined, true)} onReject={proposal => rejectProposal(proposal)} onRevise={reviseProposal}
      onEditingChange={adjustingChanged}
      onOpenNote={(noteId) => {
        const snapshot = controller.getSnapshot();
        if (snapshot.busy || snapshot.status === 'loading' || access.current.switching || mutatingRef.current || !snapshot.notebook.notes.some(note => note.id === noteId)) return;
        closeReview(); controller.setState({ ...snapshot.notebook, activeNoteId: noteId, view: 'notes', open: true });
      }} />, reviewHost)}
  </section>;
}
