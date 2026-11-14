import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Copy, Cpu, Eraser, Eye, FileText, GitCompareArrows, Info, LibraryBig, MessageSquareText, Pencil, Play, RotateCcw, Settings2, Sparkles, Square, TextSelect, Undo2, X } from 'lucide-react';
import AiMascot from './AiMascot.tsx';
import { getAiSettings } from '../ai/client.ts';
import { undoAiChange, type AiChange, type AiProposal } from '../ai/proposals.ts';
import { aiProposalTargetKey, applyAiProposalGroup } from '../ai/proposalGroup.ts';
import { rebaseAiReviewProposals, reviseAiProposal, type AiProposalAdjustment } from '../ai/reviewDecisions.ts';
import { runAiTask, type AiRunProgress } from '../ai/runner.ts';
import { createAiSession, isAiProposalApplied, readAiSession, writeAiSession, type AiSession } from '../ai/session.ts';
import { beginAiChatTask, continueAiChatTask, copyAiConversationText, retryAiChatTask, forkAiChatBeforeMessage, type AiChatTask } from '../ai/chatActions.ts';
import { aiTextSelectionError, type AiTextSelection } from '../ai/textSelection.ts';
import { aiConversationHasContent, aiConversationTitle, identifyAiConversation, listAiConversations, readAiConversations, switchAiConversation, touchAiConversation } from '../ai/conversations.ts';
import { finishAiUsage } from '../ai/usage.ts';
import { createAiToolContext } from '../ai/tools.ts';
import { aiFailure, type AiFailure } from '../ai/failures.ts';
import type { AiExecutionStep } from '../ai/execution.ts';
import type { AiSettings } from '../ai/types.ts';
import { isMeWikiManualNote } from '../domain/meWikiManual.ts';
import { openLibraryNote } from '../domain/researchNoteLibraries.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { useLibraryWorkspace } from '../state/LibraryWorkspaceContext.ts';
import type { ResearchLibrarySnapshot } from '../state/researchLibraryController.ts';
import { useResearchLibrary } from '../state/useResearchNotebook.ts';
import AiProposalReview from './AiProposalReview.tsx';
import AiUsagePanel from './AiUsagePanel.tsx';
import AiMemoryPanel from './AiMemoryPanel.tsx';
import AiConversationPanel from './AiConversationPanel.tsx';
import AiMaterials, { AiMaterialPreview } from './AiMaterials.tsx';
import { addAiMaterial, selectAiMaterials, type AiMaterial } from '../ai/materials.ts';
import { nativeOperationLabel } from './aiNativeLabels.ts';
import ResearchMarkdown from './ResearchMarkdown.tsx';
import { ResearchNoteLinkContext } from './ResearchNoteLinkContext.ts';
import './AiWorkspace.css';

function restoreSession(libraryId: string): AiSession {
  try { return identifyAiConversation(readAiSession(libraryId, localStorage)); }
  catch { return identifyAiConversation(createAiSession(libraryId)); }
}
function errorMessage(cause: unknown): string {
  if (cause instanceof TypeError) return '网络连接失败，请检查连接后重试。';
  return cause instanceof Error ? cause.message : 'AI 任务失败，请稍后重试。';
}
function finishSession(session: AiSession, status: AiSession['status'], error = '', failure?: AiFailure): AiSession {
  const last = session.history.at(-1);
  const history = session.output && last?.role !== 'assistant'
    ? [...session.history, { role: 'assistant' as const, content: session.output, providerName: session.providerName, model: session.model, contextKey: session.contextKey }]
    : session.history;
  return { ...session, status, failure, steps: session.steps?.map(step => step.status === 'running' ? { ...step, status: 'interrupted' } : step), history: history.map((message, index) => index === history.length - 1 && message.role === 'assistant' ? { ...message, status } : message), error, usageHistory: finishAiUsage(session, status) };
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
    list_materials: t('浏览辅助材料'), search_materials: t('检索辅助材料'), read_material: t('阅读辅助材料'),
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

export default function AiWorkspace({ readOnly, reviewHost, reviewControls, reviewActions, onClose, onSettings, onOpenNote, selectionRequest, onSelectionConsumed }: {
  readOnly: boolean; reviewHost: HTMLElement | null; reviewControls?: ReactNode; reviewActions?: ReactNode; onClose: () => void; onSettings: () => void;
  onOpenNote: (noteId: string, blockId?: string, source?: HTMLElement) => void;
  selectionRequest?: { id: string; selection: AiTextSelection };
  onSelectionConsumed?: (id: string) => void;
}) {
  useLocale();
  const workspace = useLibraryWorkspace();
  const library = useResearchLibrary();
  const { controller } = library;
  const libraryId = workspace.profile.id;
  const footerPreferenceKey = `mewiki:library:${encodeURIComponent(libraryId)}:ai-footer-collapsed:v1`;
  const [footerCollapsed, setFooterCollapsed] = useState(() => {
    try { return localStorage.getItem(footerPreferenceKey) === 'true'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(footerPreferenceKey, String(footerCollapsed)); } catch { /* Keep the footer usable without saved preferences. */ } }, [footerCollapsed, footerPreferenceKey]);
  const reviewLocation = JSON.stringify([library.notebook.view, library.notebook.activeNoteId, library.notebook.activeSymbolId, library.notebook.activeTermId, library.notebook.theoryMaps?.activeMapId]);
  const reviewLocationRef = useRef(reviewLocation);
  const [session, setSession] = useState(() => restoreSession(libraryId));
  const sessionRef = useRef(session);
  const [savedConversations, setSavedConversations] = useState<AiSession[]>([]);
  const [activePanel, setActivePanel] = useState<'history' | 'usage' | 'model' | 'quick' | 'memory' | null>(null);
  const [visibleHistory, setVisibleHistory] = useState({ id: session.conversationId, count: 40 });
  const olderScroll = useRef<{ top: number; height: number } | null>(null);
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const retryAt = session.failure?.retryAt ?? 0;
  const retrySeconds = Math.max(0, Math.ceil((retryAt - retryClock) / 1000));
  useEffect(() => {
    const update = setTimeout(() => setRetryClock(Date.now()), 0);
    if (retryAt <= Date.now()) return () => clearTimeout(update);
    const timer = setInterval(() => { setRetryClock(Date.now()); if (Date.now() >= retryAt) clearInterval(timer); }, 250);
    return () => { clearTimeout(update); clearInterval(timer); };
  }, [retryAt, session.conversationId]);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [scope, setScope] = useState<'current' | 'library'>('current');
  const prompt = session.draft ?? '';
  const [storageError, setStorageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [mutating, setMutating] = useState(false);
  const [materialImporting, setMaterialImporting] = useState(false);
  const [materialPreview, setMaterialPreview] = useState<AiMaterial | null>(null);
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
  const composerContentRef = useRef<HTMLDivElement | null>(null);
  const toggleFooter = () => { setActivePanel(null); setFooterCollapsed(value => !value); };
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelMenuRef = useRef<HTMLDetailsElement | null>(null);
  const quickMenuRef = useRef<HTMLDivElement | null>(null);
  const quickTriggerRef = useRef<HTMLButtonElement | null>(null);
  const consumedSelection = useRef('');
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
    const value = typeof update === 'function' ? update(sessionRef.current) : update;
    const next = touchAiConversation(value);
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
  const openHistory = useCallback((open: boolean) => {
    if (!open) { setActivePanel(panel => panel === 'history' ? null : panel); return; }
    try { setSavedConversations(readAiConversations(libraryId, localStorage)); setActionError(''); }
    catch (cause) { setActionError(errorMessage(cause)); return; }
    setActivePanel('history');
  }, [libraryId]);
  const openUsage = useCallback((open: boolean) => setActivePanel(panel => open ? 'usage' : panel === 'usage' ? null : panel), []);
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

  useEffect(() => { mounted.current = true; return dispose; }, [dispose]);
  useEffect(() => {
    if (!selectionRequest || consumedSelection.current === selectionRequest.id || selectionRequest.selection.libraryId !== libraryId) return;
    consumedSelection.current = selectionRequest.id;
    publish(current => ({ ...current, selection: selectionRequest.selection }));
    onSelectionConsumed?.(selectionRequest.id);
    setActivePanel(null); setActionError(''); setClearing(false);
    requestAnimationFrame(() => { if (mounted.current) (sessionRef.current.messageEdit ? editRef.current : promptRef.current)?.focus({ preventScroll: true }); });
  }, [selectionRequest, libraryId, publish, onSelectionConsumed]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(''), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const abort = new AbortController();
    void getAiSettings(abort.signal).then(value => {
      if (!mounted.current || abort.signal.aborted) return;
      const selected = value.providers.find(item => item.id === value.defaultProviderId) ?? value.providers[0];
      setSettings(value); setProviderId(selected?.id ?? ''); setModel(selected?.model ?? '');
    }).catch(cause => {
      if (mounted.current && !abort.signal.aborted) setSettingsError(errorMessage(cause));
    }).finally(() => { if (mounted.current && !abort.signal.aborted) setSettingsLoading(false); });
    return () => {
      abort.abort();
    };
  }, [settingsAttempt]);

  const provider = settings?.providers.find(item => item.id === providerId);
  const running = session.status === 'running';
  const blockedReason = unavailableReason(library, readOnly, workspace.switching);
  const currentNote = library.notebook.notes.find(note => note.id === library.notebook.activeNoteId);
  const noteCount = session.selection ? 1 : scope === 'library' ? library.notebook.notes.filter(note => !isMeWikiManualNote(note)).length : currentNote ? 1 : 0;
  const modelScopeInfo = `${t('选定资料会发送给所选服务，请按需要选择范围。')}${scope === 'library' ? ` ${t('整库范围不包含使用手册。')}` : ''}`;
  const selectionError = session.selection ? aiTextSelectionError(library.notebook, libraryId, session.selection) : '';
  const availableToRun = !running && !materialImporting && !mutating && !clearing && !adjustingIds.length && !workspace.switching && !library.busy && !['loading', 'error', 'conflict'].includes(library.status);
  const readyToRun = availableToRun && !session.messageEdit && session.proposals.length < 40;
  const materialError = (() => { try { selectAiMaterials(session.materials ?? [], session.activeMaterialIds ?? []); return ''; } catch (cause) { return errorMessage(cause); } })();
  const waitingForProvider = retrySeconds > 0 && provider?.id === session.lastRequest?.providerId;
  const canRun = !!provider && !!model.trim() && !!prompt.trim() && readyToRun && !selectionError && !materialError && !waitingForProvider;
  const retryAvailable = !session.messageEdit && !!session.lastRequest && ['error', 'interrupted', 'cancelled'].includes(session.status);
  const continueAvailable = !session.messageEdit && session.status === 'partial' && !!session.lastRequest && !!session.checkpoint;
  const editedSelection = session.messageEdit && session.history[session.messageEdit.index]?.selection;
  const editSelectionError = editedSelection ? aiTextSelectionError(library.notebook, libraryId, editedSelection) : '';
  const canResend = availableToRun && !!provider && !!model.trim() && !!session.messageEdit?.content.trim() && !editSelectionError && !waitingForProvider;
  const editIndex = session.messageEdit?.index;
  useLayoutEffect(() => {
    if (editIndex === undefined || !editRef.current) return;
    const input = editRef.current;
    let pending = 0;
    const focusWhenAvailable = () => {
      if (!input.isConnected || !input.getClientRects().length || input.closest('[inert], [hidden], dialog:not([open])')) return;
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
      if (document.activeElement === input) observer.disconnect();
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(focusWhenAvailable);
    });
    // Restored drafts mount before the native dialog opens and local fonts release inert.
    for (let ancestor: HTMLElement | null = input; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['open', 'inert', 'hidden'] });
    }
    focusWhenAvailable();
    return () => { observer.disconnect(); cancelAnimationFrame(pending); };
  }, [editIndex, session.conversationId]);

  useLayoutEffect(() => {
    const input = promptRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [prompt]);

  const revealPrompt = useCallback(() => {
    const content = composerContentRef.current, input = promptRef.current;
    if (!content || !input || document.activeElement !== input || content.scrollHeight <= content.clientHeight) return;
    const bounds = content.getBoundingClientRect(), field = input.getBoundingClientRect();
    if (field.bottom > bounds.bottom) content.scrollTop += field.bottom - bounds.bottom;
    else if (field.top < bounds.top) content.scrollTop -= bounds.top - field.top;
  }, []);
  useLayoutEffect(() => {
    const content = composerContentRef.current, input = promptRef.current;
    if (!content || !input) return;
    const observer = new ResizeObserver(revealPrompt);
    observer.observe(content); observer.observe(input);
    return () => observer.disconnect();
  }, [revealPrompt, session.conversationId]);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!session.messageEdit && followLatest.current && history?.clientHeight) history.scrollTop = history.scrollHeight;
  }, [session, settingsLoading, settingsError, blockedReason, storageError, actionError, notice]);
  useLayoutEffect(() => {
    const history = historyRef.current, anchor = olderScroll.current;
    if (history && anchor) { history.scrollTop = anchor.top + history.scrollHeight - anchor.height; olderScroll.current = null; }
  }, [visibleHistory]);
  useEffect(() => {
    const history = historyRef.current;
    const content = historyContentRef.current;
    if (!history || !content) return;
    const observer = new ResizeObserver(() => {
      if (!sessionRef.current.messageEdit && followLatest.current && history.clientHeight) history.scrollTop = history.scrollHeight;
    });
    observer.observe(history); observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const menu = modelMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) setActivePanel(panel => panel === 'model' ? null : panel);
      const quick = quickMenuRef.current;
      if (quick && event.target instanceof Node && !quick.contains(event.target)) setActivePanel(panel => panel === 'quick' ? null : panel);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useLayoutEffect(() => {
    const menu = modelMenuRef.current, root = menu?.closest('.mewiki-ai-workspace'), composer = menu?.closest('.mewiki-ai-composer'), form = menu?.closest('form');
    if (activePanel !== 'model' || !menu || !root || !composer || !form) return;
    const place = () => menu.style.setProperty('--ai-model-max-height', `${Math.max(0, composer.getBoundingClientRect().top - root.getBoundingClientRect().top - 8)}px`);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root); observer.observe(composer); observer.observe(form);
    return () => observer.disconnect();
  }, [activePanel]);

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
  function editMessage(index: number, trigger: HTMLButtonElement) {
    if (mutatingRef.current || clearing || adjustingIds.length || workspace.switching || library.busy || sessionRef.current.messageEdit) return;
    const message = sessionRef.current.history[index];
    if (message?.role !== 'user' || message.content.length > 12000) return;
    stop(); closeReview(); editTriggerRef.current = trigger; setActionError(''); setActivePanel(null);
    publish(current => ({ ...current, messageEdit: { index, content: message.content } }), 'now');
  }
  function cancelMessageEdit() {
    publish(current => ({ ...current, messageEdit: undefined })); setActionError('');
    requestAnimationFrame(() => editTriggerRef.current?.isConnected ? editTriggerRef.current.focus({ preventScroll: true }) : promptRef.current?.focus({ preventScroll: true }));
  }
  function activateConversation(target: AiSession): boolean {
    if (mutatingRef.current || adjustingIds.length || clearing && target.conversationId !== sessionRef.current.conversationId) return false;
    const current = sessionRef.current;
    const stopped = current.status === 'running' ? finishSession(current, 'interrupted') : current;
    const next = touchAiConversation(target);
    setMaterialPreview(null);
    try { setSavedConversations(switchAiConversation(stopped, next, localStorage)); }
    catch (cause) { setActionError(errorMessage(cause)); return false; }
    generation.current++; request.current?.abort(); request.current = null;
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    writeTimer.current = null;
    followLatest.current = true; setFollowing(true);
    publish(next, 'none'); setStorageError(''); setActionError(''); setNotice(''); setCopied(''); setClearing(false); setPreviewSelection(null); setMaterialPreview(null); setActivePanel(null); setAdjustingIds([]);
    pauseLiveReview(); setLiveDraft(null); draftRef.current = null; lastGenerated.current = null;
    requestAnimationFrame(() => { if (mounted.current) (sessionRef.current.messageEdit ? editRef.current : promptRef.current)?.focus({ preventScroll: true }); });
    return true;
  }
  function newConversation() {
    if (!aiConversationHasContent(sessionRef.current)) { setActivePanel(null); promptRef.current?.focus(); return; }
    activateConversation(identifyAiConversation(createAiSession(libraryId)));
  }
  function clearSession() {
    activateConversation(identifyAiConversation(createAiSession(libraryId), sessionRef.current.conversationId));
  }
  function selectConversation(target: AiSession) {
    if (target.conversationId === sessionRef.current.conversationId) { setActivePanel(null); (sessionRef.current.messageEdit ? editRef.current : promptRef.current)?.focus({ preventScroll: true }); return; }
    activateConversation(target);
  }
  async function run(event?: FormEvent<HTMLFormElement>, retry = false, editingMessage = false, continuing = false) {
    event?.preventDefault();
    const resuming = retry || continuing;
    if (!(editingMessage ? canResend : resuming ? readyToRun && (continuing ? continueAvailable : retryAvailable && !retrySeconds && (!session.failure || session.failure.recovery === 'retry')) && settings : canRun) || request.current || mutatingRef.current || sessionRef.current.status === 'running') return;
    const snapshot = controller.getSnapshot();
    if (access.current.switching || snapshot.busy || ['loading', 'error', 'conflict'].includes(snapshot.status)) return;
    const original = sessionRef.current;
    let previous = original;
    const noteIds = scope === 'library'
      ? snapshot.notebook.notes.filter(note => !isMeWikiManualNote(note)).map(note => note.id)
      : snapshot.notebook.notes.filter(note => note.id === snapshot.notebook.activeNoteId).map(note => note.id);
    let task: AiChatTask;
    try {
      if (editingMessage) {
        if (!original.messageEdit) return;
        previous = identifyAiConversation(forkAiChatBeforeMessage(original, original.messageEdit.index));
        if (previous.selection) {
          const reason = aiTextSelectionError(snapshot.notebook, libraryId, previous.selection);
          if (reason) throw new Error(reason);
        }
      }
      task = continuing ? continueAiChatTask(previous, settings!.providers, snapshot.notebook) : retry ? retryAiChatTask(previous, settings!.providers, snapshot.notebook) : beginAiChatTask(previous, provider!, model.trim(), (editingMessage ? original.messageEdit!.content : prompt).trim(), noteIds, snapshot.notebook);
    }
    catch (cause) { setActionError(errorMessage(cause)); return; }
    let context;
    try { context = createAiToolContext(snapshot.notebook, libraryId, task.noteIds, task.selection, task.materials); }
    catch (cause) { setActionError(errorMessage(cause)); return; }
    const next = editingMessage ? { ...task.session, draft: original.draft, selection: original.selection, activeMaterialIds: original.activeMaterialIds } : task.session;
    if (editingMessage) {
      try { setSavedConversations(switchAiConversation({ ...original, messageEdit: undefined }, touchAiConversation(next), localStorage)); }
      catch (cause) { setActionError(errorMessage(cause)); return; }
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = null;
    } else if (!persist(next)) return;
    followLatest.current = true; setFollowing(true);
    setActivePanel(null);
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
          activity: { tools: [...value.tools], steps: value.steps, proposalIds: value.proposals.map(proposal => proposal.id).filter(id => proposals.slice(0, 40).some(proposal => proposal.id === id)) } } : message),
      }));
      lastGenerated.current = value.proposals.at(-1) ?? null;
      if (liveFollow.current && !draftRef.current && lastGenerated.current) setPreviewSelection({ id: lastGenerated.current.id, location: reviewLocationRef.current });
      if (proposals.length > 40) throw new Error('本会话建议已达到上限，请新建会话后继续。');
    };
    try {
      if (resuming) {
        const freshSettings = await getAiSettings(abort.signal);
        if (!accept()) return;
        setSettings(freshSettings);
        task = continuing ? continueAiChatTask(previous, freshSettings.providers, controller.getSnapshot().notebook) : retryAiChatTask(previous, freshSettings.providers, controller.getSnapshot().notebook);
      }
      const result = await runAiTask({ context, providerId: task.provider.id, model: task.model, prompt: task.prompt, signal: abort.signal, history: task.history, memoryInstructions: task.memoryInstructions, existingProposals: resuming ? previous.proposals : [], checkpoint: task.checkpoint, requestId: task.session.lastRequest!.messageId, proposalLimit: 40 - previous.proposals.length, onProgress: progress,
        onDraft: value => {
          if (!accept()) return;
          draftRef.current = value; setLiveDraft(value);
          if (liveFollow.current) setPreviewSelection({ id: value?.id ?? lastGenerated.current?.id ?? 'live:waiting', location: reviewLocationRef.current });
        } });
      if (!accept()) return;
      progress(result); finishLiveDraft(); publish(current => finishSession(current, result.finishReason === 'complete' ? 'complete' : 'partial'), 'now');
    } catch (cause) {
      if (!accept()) return;
      finishLiveDraft();
      publish(current => finishSession(current, 'error', errorMessage(cause), aiFailure(cause)), 'now');
    } finally { if (generation.current === token) request.current = null; }
  }
  function continueReview(next: AiSession, target: AiProposal) {
    const selected = sessionRef.current.proposals.find(item => item.id === previewSelection?.id);
    if (!selected || aiProposalTargetKey(selected) !== aiProposalTargetKey(target)) return;
    pauseLiveReview();
    const remaining = next.proposals.filter(item => aiProposalTargetKey(item) === aiProposalTargetKey(target) && !isAiProposalApplied(next, item.id) && !next.rejectedIds?.includes(item.id));
    if (!remaining.length) { closeReview(); return; }
    setPreviewSelection(selection => selection ? { ...selection, id: remaining.find(item => item.id === selection.id)?.id ?? remaining[0].id } : null);
  }
  function rejectProposal(proposal: AiProposal, restore = false) {
    if (mutatingRef.current || sessionRef.current.status === 'running' || storageError || adjustingIds.includes(proposal.id)) return;
    const reason = unavailableReason(controller.getSnapshot(), access.current.readOnly, access.current.switching);
    if (reason) { setActionError(reason); return; }
    const current = sessionRef.current;
    if (!current.proposals.includes(proposal) || isAiProposalApplied(current, proposal.id)) return;
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
    if (!current.proposals.includes(proposal) || isAiProposalApplied(current, proposal.id) || current.rejectedIds?.includes(proposal.id)) return false;
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
        nextSession = { ...current, changes: current.changes.filter(item => item.proposalId !== proposal.id),
          proposals: current.proposals.map(item => item.id === proposal.id ? { ...item, before: structuredClone(change.before) } as AiProposal : item) };
      } else {
        if (isAiProposalApplied(current, proposal.id)) return;
        const pending = (group ?? [proposal]).filter(item => !isAiProposalApplied(current, item.id) && !current.rejectedIds?.includes(item.id));
        if (!pending.length) return;
        const appliedIds = [...new Set([...current.appliedIds, ...pending.map(item => item.id)])];
        if (appliedIds.length > 40) throw new Error('本会话建议已达到上限，请新建会话后继续。');
        if (pending.some(item => !current.proposals.includes(item))) throw new Error('AI 建议目标无效。');
        const result = applyAiProposalGroup(snapshot.notebook, pending, libraryId, current.changes);
        nextState = result.state;
        nextSession = { ...current, changes: [...current.changes, ...result.changes], appliedIds,
          mergedIds: [...(current.mergedIds ?? []), ...result.mergedIds] };
      }
      const pending = nextSession.proposals.filter(item => !isAiProposalApplied(nextSession, item.id) && !nextSession.rejectedIds?.includes(item.id));
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
    controller.setState({ ...openLibraryNote(snapshot.notebook, noteId, false), open: true });
  }
  function closeReview() {
    pauseLiveReview();
    setPreviewSelection(null);
    requestAnimationFrame(() => {
      const target = sessionRef.current.messageEdit ? editRef.current : previewTrigger.current?.isConnected ? previewTrigger.current : promptRef.current;
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
  const pendingProposals = session.proposals.filter(proposal => !isAiProposalApplied(session, proposal.id) && !session.rejectedIds?.includes(proposal.id));
  const previewProposal = liveDraft?.id === previewId ? liveDraft : pendingProposals.find(proposal => proposal.id === previewId);
  const showReview = !!previewSelection && (!!previewProposal || running && previewId === 'live:waiting');
  const lastMessage = session.history.at(-1);
  const showOutput = !!session.output && !(lastMessage?.role === 'assistant' && lastMessage.content === session.output) || lastMessage?.role !== 'assistant' && !!session.tools.length;
  const messages = showOutput ? [...session.history, { role: 'assistant' as const, content: session.output, providerName: session.providerName, model: session.model }] : session.history;
  const lastAssistant = messages.findLastIndex(message => message.role === 'assistant');
  const historyStart = Math.max(0, Math.min(session.messageEdit?.index ?? Infinity, messages.length - (visibleHistory.id === session.conversationId ? visibleHistory.count : 40)));
  function loadOlderMessages() {
    const history = historyRef.current;
    if (history) olderScroll.current = { top: history.scrollTop, height: history.scrollHeight };
    followLatest.current = false; setFollowing(false);
    setVisibleHistory(current => ({ id: session.conversationId, count: (current.id === session.conversationId ? current.count : 40) + 40 }));
  }
  function stepLabel(step: AiExecutionStep) {
    return [toolLabel(step.tool), step.title ? `《${step.title}》` : '', step.status === 'reused' ? t('复用已有结果') : step.status === 'error' ? localizeError(step.detail ?? '') : step.status === 'interrupted' ? t('已中断') : ''].filter(Boolean).join(' · ');
  }
  function currentProgressLabel() {
    const step = session.steps?.at(-1);
    if (session.phase === 'tool' && step) return stepLabel(step);
    if (session.phase === 'responding') return t('正在整理回复…');
    return t('正在分析任务…');
  }
  const assignedProposals = new Set(session.history.flatMap(message => message.activity?.proposalIds ?? []));
  const earlierProposals = session.proposals.filter(proposal => !assignedProposals.has(proposal.id));
  const conversationTitle = aiConversationTitle(session) || t('AI 对话');
  const sourceNotes = session.sourceIds.flatMap(id => {
    const note = library.notebook.notes.find(item => item.id === id);
    return note ? [note] : [];
  });

  async function copyText(text: string, id: string) {
    const conversation = sessionRef.current.conversationId;
    try {
      await navigator.clipboard.writeText(text);
      if (!mounted.current || sessionRef.current.conversationId !== conversation) return;
      setCopied(id); setActionError('');
    } catch {
      if (mounted.current && sessionRef.current.conversationId === conversation) {
        setCopied(''); setActionError('复制失败，请允许浏览器访问剪贴板后重试。');
      }
    }
  }
  function quickPrompt(task: string) {
    const draft = sessionRef.current.draft ?? '';
    const next = draft.trim() ? `${draft}\n\n${task}` : task;
    if (next.length > 12000) { setActionError('任务要求过长，请精简后再添加快捷提问。'); return; }
    setPrompt(next); setActivePanel(null); setActionError('');
    if (!sessionRef.current.selection) setScope('current');
    promptRef.current?.focus({ preventScroll: true });
  }
  const blockReference = session.selection?.kind === 'block';
  const referenceLabel = blockReference ? t('本行内容') : t('当前选区');
  const quickPrompts = blockReference ? [
    { label: t('解释本行内容'), task: t('请解释引用的本行内容、依据和适用条件，不修改笔记。') },
    { label: t('检查本行内容'), task: t('请检查引用的本行内容中的表达、错误和歧义，只对本行提出局部修改建议。') },
    { label: t('精简本行内容'), task: t('请精简引用的本行内容，保留关键信息和原有格式，只提出局部修改建议。') },
  ] : session.selection ? [
    { label: t('解释选中文字'), task: t('请解释选中文字的含义、依据和适用条件，不修改笔记。') },
    { label: t('润色选中文字'), task: t('请润色选中文字，保持原意与专业术语，只提出局部修改建议。') },
    { label: t('精简选中文字'), task: t('请精简选中文字，保留关键信息和原有格式，只提出局部修改建议。') },
  ] : [
    { label: t('总结当前笔记'), task: t('请总结当前笔记的核心观点、依据和待解决问题，不修改笔记。') },
    { label: t('检查表达'), task: t('请检查当前笔记中的表达、错别字和歧义，只对需要调整的原文提出修改建议。') },
    { label: t('梳理结构'), task: t('请分析当前笔记的结构，指出重复内容、逻辑缺口和可改进之处，先给出建议。') },
  ];

  function renderProposals(proposals: AiProposal[], earlier = false) {
    const targets = new Set(proposals.map(proposal => `${proposal.kind === 'native' ? proposal.target : proposal.kind === 'term' ? 'term' : 'note'}:${proposal.targetId}`)).size;
    return !!proposals.length && <section className="mewiki-ai-proposals" aria-label={earlier ? t('历史建议') : t('待审阅建议')}>
      <details className="mewiki-ai-proposal-card">
      <summary aria-description={t`${targets} 个目标`}><ChevronDown size={13} aria-hidden="true" /><GitCompareArrows size={14} aria-hidden="true" /><span>{earlier ? t('历史建议') : t('修改预览')}</span><span className="mewiki-ai-proposal-count" title={t`${targets} 个目标`}>{t`${proposals.length} 项修改`}</span></summary>
      {proposals.map(proposal => {
        const applied = isAiProposalApplied(session, proposal.id);
        const undone = !applied && session.appliedIds.includes(proposal.id);
        const rejected = session.rejectedIds?.includes(proposal.id);
        const decidingDisabled = running || mutating || !!blockedReason || !!storageError || adjustingIds.includes(proposal.id);
        const change = session.changes.find(item => item.proposalId === proposal.id);
        const last = !!change && latestChange(session.changes, change);
        const merged = session.mergedIds?.includes(proposal.id);
        return <article key={proposal.id} className="mewiki-ai-proposal" data-status={rejected ? 'rejected' : applied ? 'applied' : undone ? 'undone' : 'pending'}>
          <header><FileText size={13} aria-hidden="true" /><strong title={`${proposal.title} · ${proposalLabel(proposal)}`}>{proposal.title}</strong></header>
          <div className="mewiki-ai-proposal-actions">{rejected ? <><span>{t('已拒绝')}</span><button type="button" data-ui="icon-action" aria-label={t('恢复此建议')} title={t('恢复此建议')} disabled={decidingDisabled} onClick={() => rejectProposal(proposal, true)}><Undo2 size={14} /></button></> : !applied ? <>{undone && <span className="mewiki-ai-undone"><Undo2 size={13} />{t('已撤回')}</span>}<button type="button" data-ui="icon-action" aria-label={t('查看修改')} title={t('查看修改')} disabled={mutating || !reviewHost} aria-pressed={previewId === proposal.id} onClick={event => { previewTrigger.current = event.currentTarget; setActionError(''); selectReview(proposal.id); }}><GitCompareArrows size={14} /></button><button type="button" data-ui="icon-action" aria-label={undone ? t('再次应用') : t('应用建议')} title={undone ? t('再次应用') : t('应用建议')} disabled={decidingDisabled} onClick={() => void changeProposal(proposal)}>{undone ? <RotateCcw size={14} /> : <Check size={14} />}</button><button type="button" data-ui="icon-action" aria-label={t('拒绝此修改')} title={t('拒绝此修改')} disabled={decidingDisabled} onClick={() => rejectProposal(proposal)}><X size={14} /></button></>
            : change ? <><span className="mewiki-ai-applied"><Check size={13} />{t('已应用')}</span><button type="button" data-ui="icon-action" aria-label={t('撤回此修改')} disabled={!last || running || mutating || !!blockedReason || !!storageError} title={!last ? t('请先撤回此目标的最后一项修改。') : t('撤回此修改')} onClick={() => void changeProposal(proposal, true)}><Undo2 size={14} /></button></>
              : <span className={merged ? 'mewiki-ai-applied' : 'mewiki-ai-undone'}>{merged ? <Check size={13} /> : <Undo2 size={13} />}{merged ? t('已合并') : t('已撤回')}</span>}</div>
        </article>;
      })}
      </details>
    </section>;
  }

  function openReplyNote(noteId: string, blockId?: string, source?: HTMLElement) {
    const snapshot = controller.getSnapshot();
    if (!snapshot.notebook.notes.some(note => note.id === noteId) || snapshot.busy || snapshot.status === 'loading' || access.current.switching || mutatingRef.current) return;
    setPreviewSelection(null); pauseLiveReview();
    onOpenNote(noteId, blockId, source);
  }

  return <ResearchNoteLinkContext.Provider value={{ notes: library.notebook.notes, symbols: library.notebook.symbols, terms: library.notebook.terms ?? [], state: library.notebook, sourceNoteId: library.notebook.activeNoteId, openNote: openReplyNote }}><section aria-label={t('AI 对话')} className="mewiki-ai-workspace">
    {!!sourceNotes.length && <div className="mewiki-ai-sources" role="group" aria-label={t('参考来源')}><div>{sourceNotes.map(note =>
      <button key={note.id} type="button" title={note.title || t('未命名笔记')} disabled={mutating || library.busy || workspace.switching || library.status === 'loading'} onClick={() => openSource(note.id)}><FileText size={13} /><span>{note.title || t('未命名笔记')}</span><ArrowUpRight size={12} /></button>,
    )}</div></div>}
    <div className="mewiki-ai-history-shell">
      <div ref={historyRef} className="mewiki-ai-history" role="region" aria-label={t('会话记录')} tabIndex={0} onScroll={event => {
        const history = event.currentTarget;
        if (!history.clientHeight) return;
        const nearBottom = history.scrollHeight - history.clientHeight - history.scrollTop < 48;
        followLatest.current = nearBottom; setFollowing(nearBottom);
      }}>
      <div ref={historyContentRef} className="mewiki-ai-history-content">
      <section className="mewiki-ai-conversation">
        {!session.history.length && !session.output && <div className="mewiki-ai-welcome"><AiMascot size={80} /><h3>{t('开始一段笔记对话')}</h3></div>}
        <div className="mewiki-ai-messages" key={session.conversationId}>
          {renderProposals(earlierProposals, true)}
          {historyStart > 0 && <button type="button" className="mewiki-ai-load-history" onClick={loadOlderMessages}>{t('加载更早的消息')}</button>}
          {messages.slice(historyStart).map((message, visibleIndex) => {
            const index = historyStart + visibleIndex;
            const tools = message.role === 'assistant' ? message.activity?.tools ?? (index === lastAssistant ? session.tools : []) : [];
            const steps = message.role === 'assistant' ? message.activity?.steps ?? (index === lastAssistant ? session.steps : undefined) : undefined;
            const copyId = `message:${message.id ?? index}`;
            return <article key={message.id ?? index} className="mewiki-ai-message" data-role={message.role} aria-label={message.role === 'user' ? t('你') : t('觅维')}>
              {message.role === 'assistant' && <header className="mewiki-ai-assistant-header">
                <span className="mewiki-ai-avatar" aria-hidden="true"><AiMascot size={32} /></span>
                <strong className="mewiki-ai-assistant-name" title={[message.providerName, message.model].filter(Boolean).join(' · ')}>{t('觅维')}</strong>
              </header>}
              {!!tools.length && <details className="mewiki-ai-tool-progress"><summary>{t`工具进度（${tools.length}）`}</summary><ol>{steps?.length ? steps.map((step, stepIndex) => <li key={stepIndex} data-status={step.status}>{step.noteId && library.notebook.notes.some(note => note.id === step.noteId) ? <button type="button" onClick={event => openReplyNote(step.noteId!, step.blockId, event.currentTarget)}>{stepLabel(step)}<ArrowUpRight size={11} /></button> : stepLabel(step)}</li>) : tools.map((tool, toolIndex) => <li key={toolIndex}>{toolLabel(tool)}</li>)}</ol></details>}
              <div className={message.role === 'user' ? 'mewiki-ai-user-bubble' : undefined}>
              {!!message.materialIds?.length && <div className="mewiki-ai-message-materials" aria-label={t('消息辅助材料')}>{message.materialIds.map(id => {
                const material = session.materials?.find(item => item.id === id);
                return <button key={id} type="button" title={material?.name} aria-label={material ? t`查看材料：${material.name}` : t('辅助材料不可用')} disabled={!material} onClick={() => setMaterialPreview(material!)}><FileText size={12} /><span>{material?.name ?? t('辅助材料不可用')}</span></button>;
              })}</div>}
              {message.selection && <blockquote className="mewiki-ai-message-quote"><strong>{message.selection.noteTitle}</strong><span>{message.selection.text}</span></blockquote>}
              {session.messageEdit?.index === index && message.role === 'user' ? <form className="mewiki-ai-message-editor" onSubmit={event => void run(event, false, true)}>
                <label className="visually-hidden" htmlFor="mewiki-ai-message-edit">{t('编辑消息内容')}</label>
                <textarea ref={editRef} id="mewiki-ai-message-edit" value={session.messageEdit.content} maxLength={12000} rows={3}
                  onChange={event => publish(current => ({ ...current, messageEdit: current.messageEdit ? { ...current.messageEdit, content: event.target.value } : undefined }))}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelMessageEdit(); }
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (canResend) event.currentTarget.form?.requestSubmit(); }
                  }} />
                {editSelectionError && <p role="alert">{localizeError(editSelectionError)}</p>}
                <div><button type="button" onClick={cancelMessageEdit}>{t('取消编辑')}</button><button type="submit" disabled={!canResend}>{t('重新发送')}</button></div>
              </form> : !!message.content && <TextOutput text={message.content} markdown={message.role === 'assistant'} />}
              </div>
              {message.role === 'assistant' && renderProposals(session.proposals.filter(proposal => message.activity?.proposalIds.includes(proposal.id)))}
              <div className="mewiki-ai-message-actions">
                {message.role === 'user' && !session.messageEdit && <button type="button" data-ui="icon-action" aria-label={t('编辑消息')} title={t('编辑消息')} disabled={mutating || clearing || !!adjustingIds.length || workspace.switching || library.busy || message.content.length > 12000} onClick={event => editMessage(index, event.currentTarget)}><Pencil size={13} /></button>}
                {!!message.content && <button type="button" data-ui="icon-action" aria-label={copied === copyId ? t('已复制') : t('复制消息')} title={copied === copyId ? t('已复制') : t('复制消息')} disabled={running && index === messages.length - 1} onClick={() => void copyText(message.content, copyId)}>{copied === copyId ? <Check size={13} /> : <Copy size={13} />}</button>}
                {message.role === 'assistant' && message.status && ['error', 'interrupted', 'cancelled'].includes(message.status) && <span>{message.status === 'error' ? t('发送失败') : message.status === 'cancelled' ? t('已停止') : t('已中断')}</span>}
                {message.role === 'assistant' && message.status === 'partial' && <span>{t('部分完成')}</span>}
                {retryAvailable && index === lastAssistant && (!session.failure || session.failure.recovery === 'retry') && <button type="button" data-ui="icon-action" aria-label={t('重试任务')} title={retrySeconds ? t`${retrySeconds} 秒后可重试` : t('重试任务')} disabled={!readyToRun || settingsLoading || !settings || !!retrySeconds} onClick={() => void run(undefined, true)}><RotateCcw size={13} /></button>}
                {continueAvailable && index === lastAssistant && <button type="button" data-ui="icon-action" aria-label={t('继续剩余任务')} title={t('继续剩余任务')} disabled={!readyToRun || settingsLoading || !settings} onClick={() => void run(undefined, false, false, true)}><Play size={13} /></button>}
              </div>
            </article>;
          })}
        </div>
      </section>
      <div className="mewiki-ai-task-status" aria-live="polite">
        {settingsLoading && <p role="status">{t('正在加载 AI 服务…')}</p>}
        {settingsError && <p className="mewiki-ai-error" role="alert">{localizeError(settingsError)} <button type="button" className="mewiki-ai-text-button" disabled={settingsLoading} onClick={() => { setSettingsLoading(true); setSettingsError(''); setSettingsAttempt(value => value + 1); }}>{t('重新加载服务')}</button></p>}
        {!settingsLoading && settings && !settings.providers.length && <p>{t('请先配置 AI 服务，再运行笔记任务。')} <button type="button" className="mewiki-ai-text-button" onClick={() => { close(); onSettings(); }}>{t('前往 AI 服务设置')}</button></p>}
        {running && <p role="status" className="mewiki-ai-current-progress">{currentProgressLabel()}</p>}
        {session.status === 'cancelled' && <p role="status">{t('任务已停止，已生成的结果仍可查看。')}</p>}
        {session.status === 'interrupted' && <p role="status">{t('上次任务已中断，已生成的结果仍可查看。')}</p>}
        {session.proposals.length >= 40 && <p>{t('本会话建议已达到上限，请新建会话后继续。')}</p>}
        {blockedReason && <p>{localizeError(blockedReason)}</p>}
        {storageError && <p className="mewiki-ai-error" role="alert">{localizeError(storageError)}</p>}
        {session.error && <p className="mewiki-ai-error" role="alert">{localizeError(session.error)}{session.failure?.recovery === 'settings' && <> <button type="button" className="mewiki-ai-text-button" onClick={() => { close(); onSettings(); }}>{t('前往 AI 服务设置')}</button></>}{!!retrySeconds && <span className="mewiki-ai-retry-wait">{t`${retrySeconds} 秒后可重试`}</span>}</p>}
        {session.failure?.recovery === 'revise' && session.lastRequest && <p><button type="button" className="mewiki-ai-text-button" disabled={!availableToRun} onClick={event => {
          const index = session.history.findIndex(message => message.id === session.lastRequest?.messageId && message.role === 'user');
          if (index >= 0) editMessage(index, event.currentTarget);
        }}>{t('修改要求后重新发送')}</button></p>}
        {actionError && <p className="mewiki-ai-error" role="alert">{localizeError(actionError)}</p>}
        {selectionError && <p className="mewiki-ai-error" role="alert">{localizeError(selectionError)}</p>}
        {materialError && <p className="mewiki-ai-error" role="alert">{localizeError(materialError)}</p>}
        {notice && <p role="status">{localizeError(notice)}</p>}
        {copied && <p role="status">{t('已复制')}</p>}
      </div>
      </div>
      </div>
      {!following && <button type="button" className="mewiki-ai-jump-latest" onClick={scrollToLatest}><ArrowDown size={13} /><span>{t('返回最新消息')}</span></button>}
    </div>
    <form className="mewiki-ai-task-form" data-footer-collapsed={footerCollapsed} onSubmit={event => void run(event)}>
      {clearing && <div className="mewiki-ai-clear-confirmation" role="group" aria-label={t('清空会话确认')}>
        <p>{t('清空当前对话、建议和撤回记录，其他对话与已应用的内容保留。')}</p>
        <div><button type="button" onClick={clearSession}>{t('确认清空')}</button><button type="button" onClick={() => setClearing(false)}>{t('取消')}</button></div>
      </div>}
      <AiMaterials key={`${libraryId}:${session.conversationId}`} libraryId={libraryId} materials={session.materials ?? []} activeIds={session.activeMaterialIds ?? []}
        disabled={running || mutating || clearing || workspace.switching || !!session.messageEdit || !!adjustingIds.length} onBusyChange={setMaterialImporting} onPreview={setMaterialPreview}
        scopeControl={<div className="mewiki-ai-scope-control">
          {session.selection ? <TextSelect size={13} aria-hidden="true" /> : scope === 'library' ? <LibraryBig size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
          <select className="mewiki-ai-scope" aria-label={t('资料范围')} title={session.selection ? referenceLabel : scope === 'library' ? t('当前资料库与词典') : t('当前笔记与词典')} value={session.selection ? 'selection' : scope} disabled={running || mutating || clearing || !!session.selection} onChange={event => setScope(event.target.value as typeof scope)}>
          {session.selection && <option value="selection">{referenceLabel}</option>}<option value="current">{t('当前笔记')}</option><option value="library">{t('当前资料库')}</option>
          </select>
        </div>}
        onAdd={material => {
          const current = sessionRef.current;
          if (!mounted.current || current.conversationId !== session.conversationId || current.libraryId !== material.libraryId) return;
          const materials = addAiMaterial(current.materials ?? [], material);
          const activeMaterialIds = [...new Set([...(current.activeMaterialIds ?? []), material.id])];
          if (activeMaterialIds.length > 6) throw new Error('一次最多使用 6 份辅助材料。');
          const next = { ...current, materials, activeMaterialIds };
          if (!persist(next)) throw new Error('AI 会话未能保存，请保持窗口打开。');
          publish(next, 'none');
        }} onRemove={id => {
          const current = sessionRef.current, activeMaterialIds = (current.activeMaterialIds ?? []).filter(item => item !== id);
          const referenced = current.history.some(message => message.materialIds?.includes(id));
          const next = { ...current, activeMaterialIds, materials: referenced ? current.materials : current.materials?.filter(item => item.id !== id) };
          if (persist(next)) publish(next, 'none');
        }}>
      <div className="mewiki-ai-composer">
        <div ref={composerContentRef} className="mewiki-ai-composer-content">
        {session.selection && <div className="mewiki-ai-selection" role="group" aria-label={blockReference ? t('本行内容') : t('选中文字')}>
          <button type="button" className="mewiki-ai-selection-source" title={session.selection.noteTitle} onClick={() => openReplyNote(session.selection!.noteId, session.selection!.blocks[0]?.id)}><FileText size={13} /><span title={session.selection.noteTitle}>{session.selection.noteTitle || t('未命名笔记')}</span></button>
          <button type="button" data-ui="icon-action" aria-label={blockReference ? t('移除本行内容') : t('移除选中文字')} title={blockReference ? t('移除本行内容') : t('移除选中文字')} onClick={() => publish(current => ({ ...current, selection: undefined }))}><X size={13} /></button>
          <blockquote title={session.selection.text}>{session.selection.text}</blockquote>
        </div>}
        <label className="visually-hidden" htmlFor="mewiki-ai-task-prompt">{t('任务要求')}</label>
        <textarea ref={promptRef} id="mewiki-ai-task-prompt" value={prompt} onFocus={revealPrompt} onChange={event => setPrompt(event.target.value)} disabled={mutating || clearing} maxLength={12000} rows={2} placeholder={t('向 AI 提问，或描述要完成的笔记任务…')} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
          event.preventDefault();
          if (canRun) event.currentTarget.form?.requestSubmit();
        }} />
        </div>
        <div className="mewiki-ai-composer-controls">
          <div ref={quickMenuRef} className="mewiki-ai-quick-menu" onKeyDown={event => {
            if (event.key === 'Escape' && activePanel === 'quick') { event.preventDefault(); event.stopPropagation(); setActivePanel(null); quickTriggerRef.current?.focus(); }
          }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setActivePanel(panel => panel === 'quick' ? null : panel); }}>
            <button ref={quickTriggerRef} type="button" data-ui="icon-action" aria-label={t('快捷提问')} title={t('快捷提问')} aria-expanded={activePanel === 'quick'} aria-controls="mewiki-ai-quick-prompts" disabled={mutating || clearing} onClick={() => setActivePanel(panel => panel === 'quick' ? null : 'quick')}><Sparkles size={15} /></button>
            {activePanel === 'quick' && <div className="mewiki-ai-quick-options" id="mewiki-ai-quick-prompts" role="group" aria-label={t('快捷提问')}>{quickPrompts.map(item => <button type="button" key={item.label} onClick={() => quickPrompt(item.task)}><MessageSquareText size={14} /><span>{item.label}</span></button>)}</div>}
          </div>
          <details ref={modelMenuRef} open={activePanel === 'model'} className="mewiki-ai-model-menu" onToggle={event => {
            const open = event.currentTarget.open;
            setActivePanel(panel => open ? 'model' : panel === 'model' ? null : panel);
          }} onBlur={event => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setActivePanel(panel => panel === 'model' ? null : panel);
          }} onKeyDown={event => {
            if (event.key !== 'Escape' || !event.currentTarget.open) return;
            event.preventDefault(); event.stopPropagation(); setActivePanel(null);
            event.currentTarget.querySelector('summary')?.focus();
          }}>
            <summary role="button" aria-label={t('模型设置')} title={provider ? `${provider.name} · ${model}` : t('模型设置')}><Cpu size={13} aria-hidden="true" /><span>{model || t('选择模型')}</span><ChevronDown size={12} aria-hidden="true" /></summary>
            <div className="mewiki-ai-model-options">
              <fieldset disabled={running || mutating || settingsLoading || clearing}>
                <legend className="visually-hidden">{t('模型设置')}</legend>
                <label htmlFor="mewiki-ai-run-provider"><span>{t('服务')}</span><select aria-label={t('AI 服务')} id="mewiki-ai-run-provider" value={providerId} onChange={event => {
                  setProviderId(event.target.value); setModel(settings?.providers.find(item => item.id === event.target.value)?.model ?? '');
                }}>
                  {!settings?.providers.length && <option value="">{t('尚未添加 AI 服务')}</option>}
                  {settings?.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label htmlFor="mewiki-ai-run-model"><span>{t('模型')}</span><input aria-label={t('本次模型')} id="mewiki-ai-run-model" value={model} onChange={event => setModel(event.target.value)} maxLength={256} autoComplete="off" spellCheck={false} /></label>
              </fieldset>
              <div className="mewiki-ai-model-scope"><FileText size={13} aria-hidden="true" /><span>{noteCount === 1 ? t('1 篇笔记与词典') : t`${noteCount} 篇笔记与词典`}</span><span role="img" aria-label={modelScopeInfo} title={modelScopeInfo} tabIndex={0}><Info size={13} aria-hidden="true" /></span></div>
            </div>
          </details>
          {running && <button type="button" data-ui="icon-action" aria-label={t('跟随 AI 修改')} title={t('跟随 AI 修改')} aria-pressed={liveFollowing} onClick={() => liveFollowing ? closeReview() : resumeLiveReview()}><Eye size={15} /></button>}
          {running ? <button type="button" className="mewiki-ai-send mewiki-ai-stop" aria-label={t('停止任务')} title={t('停止任务')} onClick={stop}><Square size={15} fill="currentColor" /></button>
            : <button type="submit" className="mewiki-ai-send" aria-label={t('发送消息')} title={t('发送消息')} disabled={!canRun}><ArrowUp size={18} /></button>}
        </div>
      </div>
      </AiMaterials>
      <div className="mewiki-ai-footer-controls">
      <button type="button" className="mewiki-ai-footer-handle" aria-label={footerCollapsed ? t('展开底部导航栏') : t('收起底部导航栏')} title={footerCollapsed ? t('展开底部导航栏') : t('收起底部导航栏')} aria-expanded={!footerCollapsed} aria-controls="mewiki-ai-session-bar" onClick={toggleFooter}><span aria-hidden="true" /></button>
      <footer id="mewiki-ai-session-bar" className="mewiki-ai-session-bar" hidden={footerCollapsed}>
        <div id="mewiki-ai-session-navigation" className="mewiki-ai-session-navigation" hidden={footerCollapsed}>
        <AiConversationPanel sessions={listAiConversations(savedConversations, session)} currentId={session.conversationId!} open={activePanel === 'history'} disabled={mutating || clearing || !!adjustingIds.length} onOpenChange={openHistory} onSelect={selectConversation} onCreate={newConversation} />
        <span className="mewiki-ai-session-title" title={conversationTitle}>{conversationTitle}</span>
        <div role="toolbar" aria-label={t('AI 会话操作')}>
          <button type="button" data-ui="icon-action" aria-label={t('复制对话')} title={t('复制对话')} disabled={running || !messages.some(message => !!message.content)} onClick={() => void copyText(copyAiConversationText(messages, t('你'), t('觅维')), 'conversation')}>{copied === 'conversation' ? <Check size={14} /> : <Copy size={14} />}</button>
          <AiUsagePanel session={session} open={activePanel === 'usage'} onOpenChange={openUsage} />
          <AiMemoryPanel value={session.memoryInstructions ?? ''} count={session.history.length} open={activePanel === 'memory'} disabled={running || mutating || clearing || !!session.messageEdit} onOpenChange={open => setActivePanel(panel => open ? 'memory' : panel === 'memory' ? null : panel)} onChange={memoryInstructions => publish(current => ({ ...current, memoryInstructions }))} />
          <button type="button" data-ui="icon-action" aria-label={t('清空会话')} title={t('清空会话')} disabled={running || mutating || clearing || !!adjustingIds.length} onClick={() => { setActivePanel(null); setClearing(true); }}><Eraser size={14} /></button>
          <button type="button" data-ui="icon-action" aria-label={t('AI 服务设置')} title={t('AI 服务设置')} onClick={() => { close(); onSettings(); }}><Settings2 size={14} /></button>
        </div>
        </div>
      </footer>
      </div>
    </form>
    {reviewHost && showReview && createPortal(<AiProposalReview proposal={previewProposal ?? null} proposals={liveDraft && previewId === liveDraft.id ? [...pendingProposals, liveDraft] : pendingProposals} state={library.notebook} libraryId={libraryId} changes={session.changes}
      disabledReason={blockedReason || storageError || actionError} mutating={mutating} running={running} streaming={previewId === liveDraft?.id} autoFollow={liveFollowing} onStop={stop}
      onApply={group => { if (previewProposal && previewProposal !== liveDraft) void changeProposal(previewProposal, false, group); }} onClose={closeReview} onSelect={selectReview} focusKey={previewSelection?.focus} pageControls={reviewControls} panelControls={reviewActions}
      onApplyItem={proposal => void changeProposal(proposal, false, undefined, true)} onReject={proposal => rejectProposal(proposal)} onRevise={reviseProposal}
      onEditingChange={adjustingChanged}
      onOpenNote={(noteId) => {
        const snapshot = controller.getSnapshot();
        if (snapshot.busy || snapshot.status === 'loading' || access.current.switching || mutatingRef.current || !snapshot.notebook.notes.some(note => note.id === noteId)) return;
        closeReview(); controller.setState({ ...openLibraryNote(snapshot.notebook, noteId, false), open: true });
      }} />, reviewHost)}
    <AiMaterialPreview material={materialPreview} onClose={() => setMaterialPreview(null)} />
  </section></ResearchNoteLinkContext.Provider>;
}
