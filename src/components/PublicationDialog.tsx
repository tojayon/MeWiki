import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Check, ChevronRight, Copy, Download, Image as ImageIcon, ListChecks, LoaderCircle, MoreHorizontal, PanelRight, RotateCcw, Save, Square, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import { t } from '../i18n/locale.ts';
import { localizePublicationError } from '../i18n/publicationError.ts';
import { useLocale } from '../i18n/react.ts';
import type { PublicationSession } from '../state/publicationNavigation.ts';
import { buildPublicationDocument } from '../domain/publication.ts';
import { systemPublicationOptions } from '../domain/publicationTheme.ts';
import { parsePublicationOptions, type PublicationDocument, type PublicationOptions, type PublicationResult } from '../domain/publicationTypes.ts';
import { generatePublication } from '../state/publicationClient.ts';
import { PublicationContentError, readPublicationDiagnostics, type PublicationContentDiagnostic } from '../domain/publicationDiagnostics.ts';
import { readExportProfiles, saveExportProfiles, exportProfileFile, importExportProfileFile, MAX_EXPORT_TEMPLATE_BYTES, type ExportProfile, type ExportProfileCollection } from '../state/exportProfiles.ts';
import type { ResearchMediaAsset } from '../domain/researchMedia.ts';
import { userFontAccept, type PublicationFont } from '../domain/researchFonts.ts';
import { listUserFonts, importUserFont, readUserFont, decodeUserFont, userFontFile, subscribeUserFonts } from '../state/userFonts.ts';
import { resolvePublicationImage, renderPublicationVisual, publicationImageFromBlob } from '../state/publicationSource.ts';
import PublicationPopover from './PublicationPopover.tsx';
import PublicationInfo from './PublicationInfo.tsx';
import PublicationReadingSurface from './PublicationReadingSurface.tsx';
import { capturePublicationSurface } from '../state/publicationDomCapture.ts';
import { documentTheme } from '../styles/documentTheme.ts';
import { publicationAspect, publicationAspects, publicationClarity, publicationClarities, setPublicationAspect, setPublicationClarity, supportsPublicationClarity, type PublicationAspect } from '../domain/publicationCanvas.ts';
import PublicationSamplePreview from './PublicationSamplePreview.tsx';
import PublicationContentSelection from './PublicationContentSelection.tsx';
import PublicationTextureSettings from './PublicationTextureSettings.tsx';
import PublicationFrameSettings from './PublicationFrameSettings.tsx';
import { withPublicationTextureLayers } from '../domain/publicationTextures.ts';
import { usePublicationImages } from '../state/usePublicationImages.ts';
import { generatePublicationImages } from '../state/publicationImageBatch.ts';
import PublicationImageWorkspace from './PublicationImageWorkspace.tsx';
import { ResearchContentLibraryContext } from '../state/ResearchContentLibraryContext.ts';
import { defaultComposition, compositionFontIds, sharedComposition } from '../domain/publicationComposition.ts';
import { useCompositionEditor } from '../state/useCompositionEditor.ts';
import { useCompositionFonts } from '../state/useCompositionFonts.ts';
import { useCompositionLibrary, compositionBatchInputs } from '../state/useCompositionLibrary.ts';
import PublicationCompositionPanel from './PublicationCompositionPanel.tsx';
import PublicationCompositionLibrary from './PublicationCompositionLibrary.tsx';
import type { PublicationDraft, PublicationDraftScope } from '../state/publicationDrafts.ts';
import { usePublicationDraft } from '../state/usePublicationDraft.ts';
import './PublicationComposition.css';
import './PublicationDialog.css';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function bytes(data: string): Uint8Array { return Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), character => character.charCodeAt(0)); }

export default function PublicationDialog({ session, libraryId, directory, onClose, draftScope, tabId, initialDraft }: { session: PublicationSession; libraryId: string; directory: string | null; onClose: () => void; draftScope: PublicationDraftScope; tabId: string; initialDraft?: PublicationDraft }) {
  useLocale();
  const { snapshot, plugin, exporter } = session;
  const note = snapshot.notes.find(item => item.id === session.noteId)!;
  const [options, setOptions] = useState(() => {
    if (initialDraft) return initialDraft.options;
    const value = systemPublicationOptions(exporter.templates[0], exporter.presets[0]);
    return session.initialMode === 'images' ? { ...value, imageMode: { fit: 'contain' as const }, composition: defaultComposition() } : value;
  });
  const [textureEditorKey, setTextureEditorKey] = useState(0);
  const [pagedCanvas, setPagedCanvas] = useState(initialDraft?.pagedCanvas ?? { width: options.width, height: options.height, fontSize: options.fontSize, margin: options.margin });
  const [title, setTitle] = useState(initialDraft?.title ?? note.title);
  const [templateId, setTemplateId] = useState(exporter.templates.some(item => item.id === initialDraft?.templateId) ? initialDraft!.templateId : exporter.templates[0].id);
  const [selected, setSelected] = useState(() => new Set(initialDraft?.selected ?? note.blocks.map(block => block.id)));
  const [breaks, setBreaks] = useState(() => new Set(initialDraft?.breaks ?? []));
  const [allTabs, setAllTabs] = useState(initialDraft?.allTabs ?? false);
  const [selectedTabs, setSelectedTabs] = useState(() => ({ ...session.selectedTabs, ...initialDraft?.selectedTabs }));
  const [pdfPages, setPdfPages] = useState<Record<string, number>>(initialDraft?.pdfPages ?? {});
  const [view, setView] = useState<'style' | 'content' | 'result'>(initialDraft?.view ?? 'style');
  const [propertiesOpen, setPropertiesOpen] = useState(() => window.matchMedia('(min-width: 1101px)').matches);
  const propertiesToggle = useRef<HTMLButtonElement>(null);
  const [collection, setCollection] = useState<ExportProfileCollection | null>(null);
  const [profileId, setProfileId] = useState(initialDraft?.profileId ?? ''); const [profileName, setProfileName] = useState(initialDraft?.profileName ?? '');
  const [panel, setPanel] = useState<{ kind: 'actions' | 'save'; trigger: HTMLButtonElement } | null>(null);
  const templateFile = useRef<HTMLInputElement>(null);
  const fontFile = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState<ResearchMediaAsset[]>([]);
  const [font, setFont] = useState<PublicationFont>();
  const [fontError, setFontError] = useState('');
  const [fontRevision, setFontRevision] = useState(0);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [diagnostics, setDiagnostics] = useState<PublicationContentDiagnostic[]>([]);
  const [problemTarget, setProblemTarget] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<PublicationResult | null>(null); const [text, setText] = useState('');
  const [resultNames, setResultNames] = useState<string[]>([]);
  const [capture, setCapture] = useState<{ options: PublicationOptions; selected: string[]; allTabs: boolean; selectedTabs: Record<string, string>; pdfPages: Record<string, number> } | null>(null);
  const readingSurface = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null); const resources = useRef<AbortController | null>(null); const alive = useRef(true);
  useEffect(() => {
    alive.current = true; const abort = new AbortController(); resources.current = new AbortController();
    void readExportProfiles(libraryId, plugin.id, abort.signal).then(value => { if (alive.current) { setCollection(value); setProfileId(current => value.profiles.some(item => item.id === current) ? current : ''); } }).catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '个人模板读取失败。'); });
    const cancel = () => { alive.current = false; abort.abort(); controller.current?.abort(); resources.current?.abort(); };
    window.addEventListener('pagehide', cancel);
    return () => { window.removeEventListener('pagehide', cancel); cancel(); };
  }, [libraryId, plugin.id]);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => { void listUserFonts(libraryId, abort.signal).then(value => { if (!abort.signal.aborted) setFonts(value); }).catch(cause => { if (!abort.signal.aborted && alive.current) setError(cause instanceof Error ? cause.message : '无法读取已导入字体。'); }); };
    refresh(); window.addEventListener('focus', refresh);
    const unsubscribe = subscribeUserFonts(libraryId, refresh);
    return () => { abort.abort(); unsubscribe(); window.removeEventListener('focus', refresh); };
  }, [libraryId]);
  useEffect(() => {
    // A font restored from interface settings must also unblock an open export.
    // Keep already loaded resources stable while image generation is running.
    if (!options.fontAssetId || font?.id === options.fontAssetId) return;
    return subscribeUserFonts(libraryId, id => {
      if (!id || id === options.fontAssetId) setFontRevision(value => value + 1);
    });
  }, [libraryId, options.fontAssetId, font?.id]);
  useEffect(() => {
    const abort = new AbortController(); let face: FontFace | undefined;
    void (async () => {
      await Promise.resolve();
      if (abort.signal.aborted) return;
      setFont(undefined); setFontError('');
      if (!options.fontAssetId || options.imageMode) return;
      try {
        const resource = await readUserFont(libraryId, options.fontAssetId!, abort.signal);
        face = await decodeUserFont(resource, abort.signal);
        if (!abort.signal.aborted) { document.fonts.add(face); setFont(resource); }
      } catch (cause) { if (!abort.signal.aborted) setFontError(cause instanceof Error ? cause.message : '无法读取已导入字体。'); }
    })();
    return () => { abort.abort(); if (face) document.fonts.delete(face); };
  }, [libraryId, options.fontAssetId, options.imageMode, fontRevision]);
  const selectedFont = font?.id === options.fontAssetId ? font : undefined;
  const imageMode = !!options.imageMode;
  const invalidate = () => { setResult(null); setError(''); setNotice(''); setDiagnostics([]); setProblemTarget(null); setView(current => current === 'result' ? 'style' : current); };
  const images = usePublicationImages(snapshot, note.id, directory, invalidate, initialDraft?.images, libraryId, plugin.id);
  const editor = useCompositionEditor(options, setOptions, invalidate, initialDraft?.editor);
  const sceneFonts = useCompositionFonts(libraryId, options.composition, editor.items, images.selected.map(item => item.id));
  const designLibrary = useCompositionLibrary(libraryId, plugin.id, options, images, editor, setError, initialDraft?.design);
  const fontReady = imageMode ? sceneFonts.ready : !options.fontAssetId || !!selectedFont;
  const [modeOptions, setModeOptions] = useState<{ note?: PublicationOptions; images?: PublicationOptions }>(initialDraft?.modeOptions ?? {});
  const draftView = view === 'content' ? 'content' : 'style';
  const designDraft = designLibrary.draft;
  const inheritedOrder = initialDraft?.inheritedOrder;
  const draftValue = useMemo<PublicationDraft>(() => ({
    inheritedOrder, options, title, templateId, profileId, profileName, selected: [...selected], breaks: [...breaks], allTabs, selectedTabs, pdfPages,
    view: draftView, pagedCanvas, modeOptions,
    images: images.draft, editor: { items: editor.items, scope: editor.scope, selectedId: editor.selectedId }, design: designDraft,
  }), [inheritedOrder, options, title, templateId, profileId, profileName, selected, breaks, allTabs, selectedTabs, pdfPages, draftView, pagedCanvas, modeOptions, images.draft, editor.items, editor.scope, editor.selectedId, designDraft]);
  const draft = usePublicationDraft(draftScope, tabId, draftValue);
  const switchMode = (mode: string) => {
    if (mode === (imageMode ? 'images' : 'note')) return;
    setModeOptions(current => ({ ...current, [imageMode ? 'images' : 'note']: options }));
    const remembered = modeOptions[mode as 'images' | 'note'];
    let next = { ...(remembered ?? options) };
    if (!remembered && mode === 'images') { next.imageMode = { fit: 'contain' }; next.composition = defaultComposition(); if (next.mode === 'long') Object.assign(next, pagedCanvas); next.mode = 'pages'; }
    if (mode === 'note') { next = { ...next }; delete next.imageMode; delete next.composition; }
    editor.replace(next); setView('style');
  };
  const showView = (next: typeof view) => {
    setView(next);
    if (imageMode && next !== 'style' && window.matchMedia('(max-width: 1100px)').matches) setPropertiesOpen(false);
    if (imageMode) window.requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 760px)').matches) document.getElementById(`publication-panel-${next}`)?.scrollIntoView({ block: 'start' });
    });
  };
  const update = <K extends keyof PublicationOptions>(key: K, value: PublicationOptions[K]) => { if (imageMode) editor.replace({ ...options, [key]: value }); else { setOptions(current => ({ ...current, [key]: value })); invalidate(); } };
  const applyProfile = (profile: ExportProfile) => { setTextureEditorKey(current => current + 1); editor.applyTemplate(structuredClone(profile.options)); setTemplateId(profile.templateId); setProfileId(profile.id); setProfileName(profile.name); invalidate(); setView('style'); };
  const systemOptions = (id: string) => {
    const value = systemPublicationOptions(exporter.templates.find(item => item.id === id) ?? exporter.templates[0], exporter.presets[0]);
    return imageMode ? { ...value, imageMode: { fit: 'contain' as const }, composition: defaultComposition() } : value;
  };
  const applySystem = (id: string) => {
    const template = exporter.templates.find(item => item.id === id);
    if (!template) return;
    setTextureEditorKey(current => current + 1);
    editor.applyTemplate(systemOptions(id)); setTemplateId(id); setProfileId(''); setProfileName(''); invalidate(); setView('style');
  };
  const selectedProfile = collection?.profiles.find(profile => profile.id === profileId);
  const systemTemplate = exporter.templates.find(template => template.id === templateId) ?? exporter.templates[0];
  const templateName = selectedProfile?.name ?? t(systemTemplate.name);
  const selectedOptions = () => selectedProfile ? structuredClone(selectedProfile.options) : systemOptions(systemTemplate.id);
  const presetId = exporter.presets.find(preset => preset.width === options.width && preset.height === options.height)?.id ?? '';
  const closePanel = (restoreFocus = false) => { if (restoreFocus) panel?.trigger.focus({ preventScroll: true }); setPanel(null); };
  const currentProfile = (): ExportProfile => ({ id: profileId || crypto.randomUUID(), name: profileName.trim(), templateId: templateId || exporter.templates[0].id, templateVersion: plugin.version, options: parsePublicationOptions({ ...options, ...(options.composition ? { composition: sharedComposition(options.composition) } : {}) }) });
  const persist = async (profiles: ExportProfile[], selectedId: string, message: string) => {
    if (!collection) throw new Error('个人模板尚未读取完成。');
    setSaving(true); setError(''); setNotice('');
    try {
      const next = await saveExportProfiles(libraryId, plugin.id, { revision: collection.revision, profiles });
      if (alive.current) { setCollection(next); setProfileId(selectedId); setNotice(message); }
    } finally { if (alive.current) setSaving(false); }
  };
  const act = (action: () => Promise<void>) => { void action().catch(cause => { if (alive.current) setError(cause instanceof Error ? cause.message : '图文导出失败，请重试。'); }); };
  const generate = async (currentOnly = false) => {
    setResultNames([]);
    if (imageMode && window.matchMedia('(max-width: 1100px)').matches) setPropertiesOpen(false);
    if (imageMode) window.requestAnimationFrame(() => { if (window.matchMedia('(max-width: 760px)').matches) document.getElementById('publication-panel-result')?.scrollIntoView({ block: 'start' }); });
    setBusy(true); setView('result'); setResult(null); setError(''); setNotice(''); setDiagnostics([]); setProblemTarget(null); setProgress({ completed: 0, total: 0 });
    const abort = new AbortController(); controller.current = abort;
    let sourceIds = new Map<string, string>();
    try {
      const checked = parsePublicationOptions(options);
      if (checked.imageMode) {
        const batch = compositionBatchInputs(images, editor).filter(item => !currentOnly || item.id === images.current?.id);
        const names = batch.map(image => image.name || t`图片 ${images.items.findIndex(item => item.id === image.id) + 1}`);
        const rendered = await generatePublicationImages(batch, checked, abort.signal, (completed, total) => { if (alive.current) setProgress({ completed, total }); }, { fonts: sceneFonts.fonts });
        if (alive.current) { setResult(rendered); setResultNames(names); setText(''); }
        return;
      }
      if (checked.fontAssetId && selectedFont?.id !== checked.fontAssetId) throw new Error('所选字体尚未加载，请稍后重试或重新导入字体。');
      let document: PublicationDocument;
      if (checked.style === 'document') {
        flushSync(() => setCapture({ options: checked, selected: [...selected], allTabs, selectedTabs, pdfPages }));
        const content = await capturePublicationSurface(readingSurface.current!, abort.signal, checked.fontSize / documentTheme.fontSize);
        document = { title, ...content };
      } else document = await buildPublicationDocument(snapshot, note.id, [...selected], {
        allTabs, selectedTabs,
        resolveImage: source => resolvePublicationImage(source, directory, abort.signal),
        renderVisual: block => renderPublicationVisual(block, abort.signal),
      });
      document.title = title;
      sourceIds = new Map(document.blocks.flatMap(block => block.sourceId ? [[block.id, block.sourceId]] : []));
      for (const id of breaks) { const first = document.blocks.find(block => block.sourceId === id); if (first) first.breakBefore = true; }
      abort.signal.throwIfAborted();
      const rendered = await generatePublication({ document, options: checked, ...(selectedFont ? { font: selectedFont } : {}) }, abort.signal, (completed, total) => { if (alive.current) setProgress({ completed, total }); });
      if (alive.current) { setResult(rendered); setText([title, options.subtitle, options.author, document.text].filter(Boolean).join('\n\n')); }
    } catch (cause) {
      if (alive.current) {
        setError(abort.signal.aborted ? '导出已取消。' : cause instanceof Error ? cause.message : '图文导出失败，请重试。');
        if (imageMode && cause instanceof Error) {
          const match = /图片创作 → 第 (\d+) 张 → 第 (\d+) 个图层/.exec(cause.message);
          const item = match ? images.selected[Number(match[1]) - 1] : undefined;
          if (item && match) { images.setCurrentId(item.id); const layer = editor.effective(item.id).layers[Number(match[2]) - 1]; if (layer) editor.select(layer.id); setPropertiesOpen(true); setView('style'); }
        }
        if (!abort.signal.aborted && cause instanceof PublicationContentError) {
          const issues = readPublicationDiagnostics(cause.diagnostics.map(issue => ({ ...issue, blockId: sourceIds.get(issue.blockId) })), selected);
          setDiagnostics(issues);
          if (issues.length) { setView('content'); setProblemTarget({ id: issues[0].blockId }); }
        }
      }
    }
    finally { if (alive.current) { setBusy(false); setCapture(null); } }
  };
  const importProfile = async (file: File) => {
    if (file.size > MAX_EXPORT_TEMPLATE_BYTES) throw new Error('个人模板文件超过大小限制。');
    setSaving(true);
    try {
      const imported = importExportProfileFile(await file.text());
      const { profile } = imported;
      if (imported.font) {
        await importUserFont(libraryId, userFontFile(imported.font), resources.current!.signal);
        const available = await listUserFonts(libraryId, resources.current!.signal);
        if (alive.current) { setFonts(available); setFontRevision(current => current + 1); }
      }
      for (const resource of imported.fonts ?? []) await importUserFont(libraryId, userFontFile(resource), resources.current!.signal);
      if (!alive.current) return;
      profile.id = crypto.randomUUID();
      await persist([...(collection?.profiles ?? []), profile], profile.id, '个人模板已导入。');
      if (alive.current) { applyProfile(profile); setNotice('个人模板已导入。'); }
    } finally { if (alive.current) setSaving(false); }
  };
  const imageFile = async (file: File, key: 'logo' | 'coverImage') => {
    setSaving(true); setError('');
    try {
      const url = await publicationImageFromBlob(file, resources.current!.signal);
      if (alive.current) update(key, url);
    } finally { if (alive.current) setSaving(false); }
  };
  const addFont = async (file: File) => {
    setSaving(true); setError(''); setNotice('');
    try {
      const asset = await importUserFont(libraryId, file, resources.current!.signal);
      const available = await listUserFonts(libraryId, resources.current!.signal);
      if (alive.current) { setFonts(available); setFontRevision(current => current + 1); if (imageMode && editor.selectedId !== '$subject') editor.patchLayer(editor.selectedId, { fontAssetId: asset.id }, images.current?.id); else if (!imageMode) update('fontAssetId', asset.id); setNotice('字体已保存到当前资料库，可重复使用。'); }
    } finally { if (alive.current) setSaving(false); }
  };
  const filename = (title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100) || 'mewiki-publication');
  const pageFilename = (index: number) => {
    const number = String(index + 1).padStart(3, '0');
    const name = resultNames[index]?.replace(/\.(?:png|jpe?g|webp)$/i, '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
    return `${name ? `${number}-${name}` : `${filename}-${number}`}.${result?.format === 'jpeg' ? 'jpg' : 'png'}`;
  };
  const downloadAll = () => {
    if (!result) return;
    const files: Record<string, Uint8Array> = imageMode ? {} : { 'caption.txt': strToU8(text) };
    result.pages.forEach((image, index) => { files[imageMode ? pageFilename(index) : `${String(index + 1).padStart(3, '0')}.${result.format === 'jpeg' ? 'jpg' : 'png'}`] = bytes(image.dataUrl); });
    download(new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), filename + '.zip');
  };
  const numberField = (key: 'width' | 'height' | 'margin' | 'fontSize' | 'lineHeight' | 'quality', label: string, min: number, max: number, step = 1) => <label key={key}>{t(label)}<input type="number" min={min} max={max} step={step} value={options[key]} onChange={event => update(key, Number(event.target.value))} /></label>;
  const textField = (key: 'author' | 'subtitle' | 'header' | 'footer' | 'date', label: string) => <label key={key}>{t(label)}<input value={options[key]} maxLength={key === 'subtitle' ? 1000 : 200} onChange={event => update(key, event.target.value)} /></label>;
  const changeCanvas = (change: () => PublicationOptions) => { try { const value = change(); if (imageMode) editor.replace(value); else { setOptions(value); invalidate(); } } catch (cause) { setError(cause instanceof Error ? cause.message : '图文导出失败，请重试。'); } };
  const toggle = (current: ReadonlySet<string>, id: string, checked: boolean) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; };
  const views = ['style', 'content', 'result'] as const;
  const viewNames = imageMode ? ['画布编辑', '选择图片', '导出结果'] : ['样式预览', '选择内容', '导出结果'];
  const problemBlocks = note.blocks.flatMap((block, index) => diagnostics.some(issue => issue.blockId === block.id) ? [{ id: block.id, number: index + 1 }] : []);
  return <>{capture && createPortal(<PublicationReadingSurface state={snapshot} noteId={note.id} directory={directory} selected={capture.selected} options={capture.options} selectedTabs={capture.selectedTabs} pdfPages={capture.pdfPages} allTabs={capture.allTabs} surfaceRef={readingSurface} />, document.body)}<main aria-label={t('社交图文导出')} className="mewiki-publication-dialog mewiki-publication-page" data-testid="mewiki-publication-page" onKeyDown={event => {
    if (!imageMode || busy || saving || designLibrary.saving || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) { event.preventDefault(); if (key === 'y' || event.shiftKey) editor.redo(); else editor.undo(); }
  }}><div className="mewiki-publication-content">
    <div className="mewiki-publication-layout" data-image-mode={imageMode} data-properties-open={imageMode && propertiesOpen}>
      <section className="mewiki-publication-controls-pane" aria-label={t('导出设置')}>
        <header className="mewiki-publication-toolbar mewiki-publication-template-toolbar" role="toolbar" aria-label={t('模板工具栏')}>
          <select aria-label={t('选择模板')} disabled={busy || saving} value={profileId ? `personal:${profileId}` : `system:${templateId}`}
            onChange={event => { const value = event.target.value; closePanel(); if (value.startsWith('system:')) applySystem(value.slice(7)); else { const profile = collection?.profiles.find(item => item.id === value.slice(9)); if (profile) applyProfile(profile); } }}>
            <optgroup label={t('系统模板')}>{exporter.templates.map(template => <option key={template.id} value={`system:${template.id}`}>{t(template.name)}</option>)}</optgroup>
            <optgroup label={t('个人模板')}>{collection?.profiles.map(profile => <option key={profile.id} value={`personal:${profile.id}`}>{profile.name}</option>)}</optgroup>
          </select>
          <button type="button" data-ui="icon-action" aria-label={t('模板操作')} title={t('模板操作')} aria-haspopup="dialog" aria-expanded={!!panel} disabled={busy || saving}
            onClick={event => panel ? closePanel() : setPanel({ kind: 'actions', trigger: event.currentTarget })}
            onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setPanel({ kind: 'actions', trigger: event.currentTarget }); } }}><MoreHorizontal size={16} /></button>
          <PublicationInfo native={options.style === 'document'} imageMode={imageMode} />
          <button type="button" data-ui="icon-action" data-draft-state={draft.status} aria-label={t(draft.status === 'error' ? '重试保存导出草稿' : draft.status === 'pending' ? '正在保存导出草稿…' : '导出设置已自动保存')} title={t(draft.status === 'error' ? '重试保存导出草稿' : draft.status === 'pending' ? '正在保存导出草稿…' : '导出设置已自动保存')} onClick={() => { void draft.retry(); }}>
            {draft.status === 'error' ? <TriangleAlert size={16} /> : draft.status === 'pending' ? <LoaderCircle size={16} /> : <Check size={16} />}
          </button>
        </header>
        <input ref={templateFile} hidden type="file" accept=".json,application/json" aria-label={t('导入模板')} disabled={busy || saving || !collection}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) act(() => importProfile(file)); }} />
        <input ref={fontFile} hidden type="file" accept={userFontAccept} aria-label={t('导入字体文件')} disabled={busy || saving}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) act(() => addFont(file)); }} />
        {panel && <PublicationPopover key={panel.kind} trigger={panel.trigger} label={t(panel.kind === 'actions' ? '模板操作' : '保存模板')} toolbar={panel.kind === 'actions'} onClose={closePanel}>
          {panel.kind === 'actions' ? <>
            <button type="button" data-ui="menu-action" aria-label={t('保存当前配置为个人模板')} disabled={!collection}
              onClick={() => { setProfileName(templateName); setPanel({ ...panel, kind: 'save' }); }}><Save size={16} /><span>{t('保存当前配置为个人模板')}</span></button>
            <button type="button" data-ui="menu-action" aria-label={t('复制模板')} disabled={!collection} onClick={() => {
              closePanel(true); act(async () => { const suffix = t('副本'); const profile: ExportProfile = { id: crypto.randomUUID(), name: templateName.slice(0, 100 - suffix.length) + suffix, templateId, templateVersion: plugin.version, options: selectedOptions() };
                await persist([...(collection?.profiles ?? []), profile], profile.id, '个人模板已复制。'); if (alive.current) { applyProfile(profile); setNotice('个人模板已复制。'); } });
            }}><Copy size={16} /><span>{t('复制模板')}</span></button>
            <button type="button" data-ui="menu-action" data-tone="danger" aria-label={t('删除模板')} disabled={!selectedProfile} onClick={() => {
              closePanel(true); act(async () => { await persist(collection!.profiles.filter(item => item.id !== profileId), '', '个人模板已删除。'); if (alive.current) { applySystem(exporter.templates[0].id); setNotice('个人模板已删除。'); } });
            }}><Trash2 size={16} /><span>{t('删除模板')}</span></button>
            <button type="button" data-ui="menu-action" aria-label={t('导出模板')} onClick={() => {
              closePanel(true); act(async () => { const profile: ExportProfile = { id: profileId || crypto.randomUUID(), name: templateName, templateId, templateVersion: plugin.version, options: selectedOptions() };
                const resource = profile.options.fontAssetId ? await readUserFont(libraryId, profile.options.fontAssetId, resources.current!.signal) : undefined;
                const layerFonts: PublicationFont[] = []; for (const id of compositionFontIds(profile.options.composition)) layerFonts.push(await readUserFont(libraryId, id, resources.current!.signal));
                if (alive.current) download(new Blob([exportProfileFile(profile, resource, layerFonts)], { type: 'application/json' }), `${templateName.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.json`); });
            }}><Download size={16} /><span>{t('导出模板')}</span></button>
            <button type="button" data-ui="menu-action" aria-label={t('导入模板')} disabled={!collection} onClick={() => { closePanel(true); templateFile.current?.click(); }}><Upload size={16} /><span>{t('导入模板')}</span></button>
            <button type="button" data-ui="menu-action" aria-label={t('恢复模板样式')} onClick={() => { closePanel(true); setTextureEditorKey(current => current + 1); editor.applyTemplate(selectedOptions()); invalidate(); }}><RotateCcw size={16} /><span>{t('恢复模板样式')}</span></button>
          </> : <form onSubmit={event => { event.preventDefault(); if (!profileName.trim()) return; closePanel(true); act(async () => { const profile = currentProfile(); await persist([...(collection?.profiles.filter(item => item.id !== profile.id) ?? []), profile], profile.id, '个人模板已保存。'); }); }}>
            <label>{t('模板名称')}<input autoFocus maxLength={100} value={profileName} onChange={event => setProfileName(event.target.value)} /></label>
            <div className="mewiki-publication-save-actions"><button type="submit" data-ui="icon-action" aria-label={t('保存模板')} title={t('保存模板')} disabled={!profileName.trim()}><Save size={16} /></button>
              <button type="button" data-ui="icon-action" aria-label={t('取消')} title={t('取消')} onClick={() => closePanel(true)}><X size={16} /></button></div>
          </form>}
        </PublicationPopover>}
        <div className="mewiki-publication-controls">
        <div className="mewiki-publication-mode"><select aria-label={t('工作模式')} title={t('工作模式')} disabled={busy || saving || designLibrary.saving} value={imageMode ? 'images' : 'note'} onChange={event => switchMode(event.target.value)}><option value="note">{t('笔记导出')}</option><option value="images">{t('图片创作')}</option></select></div>
        <details className="mewiki-publication-settings-section" open aria-labelledby="publication-content-heading">
          <summary id="publication-content-heading"><ChevronRight size={16} aria-hidden="true" /><span>{t('内容')}</span></summary>
          <fieldset disabled={busy || saving}>
          {imageMode ? <>
            <label>{t('图片适配')}<select value={options.imageMode!.fit} onChange={event => update('imageMode', { fit: event.target.value as 'contain' | 'cover' })}><option value="contain">{t('完整显示')}</option><option value="cover">{t('铺满屏幕（裁切）')}</option></select></label>
          </> : <>
          <label>{t('导出标题')}<input value={title} maxLength={1000} onChange={event => { setTitle(event.target.value); invalidate(); }} /></label>
          <div className="mewiki-publication-content-choice">
            <button type="button" aria-controls="publication-panel-content" onClick={() => {
              setView('content');
              window.requestAnimationFrame(() => { document.getElementById('publication-tab-content')?.focus({ preventScroll: true }); document.getElementById('publication-panel-content')?.scrollIntoView({ block: 'nearest' }); });
            }}><ListChecks size={16} aria-hidden="true" />{t('选择导出内容与分页')}</button>
            <span className="mewiki-publication-hint">{t`已选择 ${selected.size} / ${note.blocks.length} 项`}</span>
          </div>
          <label className="mewiki-publication-check"><input type="checkbox" checked={options.cover} onChange={event => update('cover', event.target.checked)} />{t('单独生成封面')}</label>
          {textField('subtitle', '导出副标题')}{textField('author', '作者署名')}
          <div className="mewiki-publication-fields">{textField('header', '页眉文字')}{textField('footer', '页脚文字')}{textField('date', '显示日期')}</div>
          <label>{t('作者头像或 Logo')}<input type="file" accept="image/png,image/jpeg" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) act(() => imageFile(file, 'logo')); }} /></label>
          {!!options.logo && <button type="button" onClick={() => update('logo', '')}>{t('移除头像或 Logo')}</button>}
          <label className="mewiki-publication-check"><input type="checkbox" checked={options.showPageNumbers} onChange={event => update('showPageNumbers', event.target.checked)} />{t('显示页码')}</label>
          </>}
          </fieldset>
        </details>
        <details className="mewiki-publication-settings-section" open aria-labelledby="publication-canvas-heading">
          <summary id="publication-canvas-heading"><ChevronRight size={16} aria-hidden="true" /><span>{t('画幅')}</span></summary>
          <fieldset disabled={busy || saving}>
          <label>{t('平台预设')}<select value={presetId} onChange={event => { const preset = exporter.presets.find(item => item.id === event.target.value); if (preset) changeCanvas(() => ({ ...options, width: preset.width, height: preset.height })); }}><option value="">{t('自定义画幅')}</option>{exporter.presets.map(preset => <option key={preset.id} value={preset.id}>{t(preset.name)}</option>)}</select></label>
          <div className="mewiki-publication-fields">
            {!imageMode && <label>{t('导出形式')}<select value={options.mode} onChange={event => {
              const mode = event.target.value as PublicationOptions['mode'];
              if (mode === 'long') setPagedCanvas({ width: options.width, height: options.height, fontSize: options.fontSize, margin: options.margin });
              const paged = pagedCanvas;
              setOptions(current => mode === 'long' ? { ...current, mode, height: Math.min(12000, Math.floor(16_000_000 / current.width)) } : { ...current, mode, ...paged }); invalidate();
            }}><option value="pages">{t('多页图片')}</option><option value="long">{t('连续长图')}</option></select></label>}
            <label>{t('图片格式')}<select value={options.format} onChange={event => update('format', event.target.value as PublicationOptions['format'])}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
            {options.mode === 'pages' && <label>{t('画面比例')}<select value={publicationAspect(options)} onChange={event => { if (event.target.value !== 'custom') changeCanvas(() => setPublicationAspect(options, event.target.value as PublicationAspect)); }}>
              <option value="custom">{t('自定义比例')}</option>{publicationAspects.map(aspect => <option key={aspect} value={aspect}>{aspect} · {t(aspect === '1:1' ? '方形' : ['3:4', '9:16'].includes(aspect) ? '竖向' : '横向')}</option>)}
            </select></label>}
            <label>{t('清晰度')}<select value={publicationClarity(options)} onChange={event => { if (Number(event.target.value)) changeCanvas(() => setPublicationClarity(options, Number(event.target.value))); }}>
              <option value="0">{t('自定义清晰度')}</option>{publicationClarities.map(clarity => <option key={clarity} value={clarity} disabled={!supportsPublicationClarity(options, clarity)}>{t(clarity === 720 ? '标准（720p）' : clarity === 1080 ? '高清（1080p）' : '超清（1440p）')}</option>)}
            </select></label>
          </div>
          <details className="mewiki-publication-dimensions"><summary>{t('精确尺寸（高级）')}</summary><div className="mewiki-publication-fields">
            {numberField('width', '输出宽度', 480, 2160)}{numberField('height', options.mode === 'long' ? '长图最大高度' : '输出高度', 480, 12000)}
          </div><p className="mewiki-publication-hint">{t('精确尺寸使用像素；清晰度档位以短边计算，长图以宽度计算。单张最多 1600 万像素。')}</p></details>
          <PublicationFrameSettings value={options.frame} mode={options.mode} imageMode={imageMode} disabled={busy || saving} onChange={frame => changeCanvas(() => { const next = { ...options }; if (frame) next.frame = frame; else delete next.frame; return next; })} />
          </fieldset>
        </details>
        <details className="mewiki-publication-settings-section" open aria-labelledby="publication-style-heading">
          <summary id="publication-style-heading"><ChevronRight size={16} aria-hidden="true" /><span>{t('样式')}</span></summary>
          <fieldset disabled={busy || saving}><div className="mewiki-publication-fields">
          {!imageMode && <><div className="mewiki-publication-font-control"><label>{t('本地字体')}<select aria-label={t('本地字体')} value={options.fontAssetId ? `font:${options.fontAssetId}` : options.fontFamily} onChange={event => {
            const value = event.target.value;
            if (value.startsWith('font:')) update('fontAssetId', value.slice(5));
            else { setOptions(current => { const next = { ...current, fontFamily: value as PublicationOptions['fontFamily'] }; delete next.fontAssetId; return next; }); invalidate(); }
          }}><optgroup label={t('内置字体')}><option value="sans">{t(options.style === 'document' ? 'MeWiki 正文字体' : '思源风格黑体')}</option><option value="serif">{t('思源风格宋体')}</option></optgroup>
            <optgroup label={t('资料库字体')}>{fonts.map(item => <option key={item.id} value={`font:${item.id}`}>{item.name.replace(/\.(?:ttf|otf|woff2?)$/i, '')}</option>)}</optgroup>
            {options.fontAssetId && !fonts.some(item => item.id === options.fontAssetId) && <option value={`font:${options.fontAssetId}`}>{t('所选字体未在当前资料库找到')}</option>}
          </select></label><button type="button" data-ui="icon-action" aria-label={t('导入字体')} title={t('导入字体')} onClick={() => fontFile.current?.click()}><Upload size={16} /></button>
            <button type="button" data-ui="icon-action" aria-label={t('下载原字体')} title={t('下载原字体')} disabled={!selectedFont} onClick={() => { if (selectedFont) download(userFontFile(selectedFont), selectedFont.name); }}><Download size={16} /></button></div>
          {numberField('fontSize', '正文字号', 16, 80)}{numberField('lineHeight', '正文行距', 1.2, 2.4, 0.05)}{numberField('margin', '页面留白', 16, 200)}</>}
          {(['background', 'textColor', 'headingColor', 'accentColor'] as const).map((key, index) => (!imageMode || key === 'background') && <label key={key}>{t(['背景颜色', '正文颜色', '标题颜色', '强调颜色'][index])}<input type="color" value={options[key]} onChange={event => update(key, event.target.value)} /></label>)}
          {options.format === 'jpeg' && numberField('quality', 'JPEG 质量', 40, 100)}
          </div>
          {!imageMode && <><label>{t('封面图片')}<input type="file" accept="image/png,image/jpeg" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) act(() => imageFile(file, 'coverImage')); }} /></label>
          {!!options.coverImage && <button type="button" onClick={() => update('coverImage', '')}>{t('移除封面图片')}</button>}</>}
          <PublicationTextureSettings key={textureEditorKey} value={options.texture} layers={options.textureLayers} background={options.background} cover={!imageMode && options.cover} imageMode={imageMode} disabled={busy || saving} onChange={layers => changeCanvas(() => withPublicationTextureLayers(options, layers))} />
          </fieldset>
        </details>
        </div>
      </section>
      <section className="mewiki-publication-preview-pane" aria-label={t('导出预览')}>
        <header className="mewiki-publication-toolbar mewiki-publication-preview-toolbar" role="toolbar" aria-label={t('预览工具栏')}>
          <div role="tablist" aria-label={t('导出视图')} className="mewiki-publication-view-tabs" onKeyDown={event => {
            const index = views.indexOf(view); let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % views.length;
            else if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length;
            else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = views.length - 1; else return;
            event.preventDefault(); showView(views[next]); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus();
          }}>{views.map((name, index) => <button type="button" key={name} id={`publication-tab-${name}`} role="tab" title={t(viewNames[index])} aria-selected={view === name} aria-controls={`publication-panel-${name}`} tabIndex={view === name ? 0 : -1} onClick={() => showView(name)}><span>{t(viewNames[index])}</span></button>)}</div>
          <button type="button" data-ui="icon-action" className="mewiki-publication-generate" aria-label={t('生成预览')} title={t('生成预览')} disabled={busy || saving || designLibrary.saving || !(imageMode ? images.selected.length : selected.size) || !fontReady} onClick={() => { closePanel(); void generate(); }}><ImageIcon size={16} /></button>
          {imageMode && <PublicationCompositionLibrary library={designLibrary} disabled={busy || saving || designLibrary.saving} onError={setError} canGenerateCurrent={!!images.current && fontReady} onGenerateCurrent={() => void generate(true)} />}
          {busy && <button type="button" data-ui="icon-action" aria-label={t('取消导出')} title={t('取消导出')} onClick={() => controller.current?.abort()}><Square size={16} /></button>}
          <button type="button" data-ui="icon-action" aria-label={t('下载全部图片 ZIP')} title={t('下载全部图片 ZIP')} disabled={!result} onClick={downloadAll}><Download size={16} /></button>
          {!imageMode && <button type="button" data-ui="icon-action" aria-label={t('复制配套文案')} title={t('复制配套文案')} disabled={!result} onClick={() => act(async () => { await navigator.clipboard.writeText(text); setNotice('配套文案已复制。'); })}><Copy size={16} /></button>}
          {imageMode && <button ref={propertiesToggle} type="button" data-ui="icon-action" className="mewiki-publication-panel-toggle" aria-label={t('图层面板')} title={t(propertiesOpen ? '收起图层面板' : '展开图层面板')} aria-expanded={propertiesOpen} aria-controls="publication-composition-panel" onClick={() => setPropertiesOpen(value => !value)}><PanelRight size={16} /></button>}
          <button type="button" data-ui="icon-action" className="mewiki-publication-close" aria-label={t`关闭${t('社交图文导出')}`} title={t('关闭')} onClick={() => { void draft.flush().then(saved => { if (saved) onClose(); }); }}><X size={16} /></button>
        </header>
        <div className="mewiki-publication-preview-content" data-image-mode={imageMode}>
        {!!draft.error && <div role="alert" className="mewiki-publication-error"><p>{t(draft.error)}</p><button type="button" onClick={() => { void draft.retry(); }}>{t('重试保存导出草稿')}</button></div>}
        {busy && <p role="status">{progress.total ? t`正在生成图片：${progress.completed} / ${progress.total}` : t('正在整理内容并排版…')}</p>}
        {!!error && <div role="alert" className="mewiki-publication-error"><p>{localizePublicationError(error)}</p>
          {!!problemBlocks.length && <div className="mewiki-publication-problem-links" aria-label={t('问题内容定位')}><span>{t`已标记 ${problemBlocks.length} 项问题内容：`}</span>{problemBlocks.map(block => <button type="button" key={block.id} aria-label={t`定位到第 ${block.number} 项问题内容`} onClick={() => { setView('content'); setProblemTarget({ id: block.id }); }}>{t`第 ${block.number} 项`}</button>)}</div>}
        </div>}{!!notice && <p role="status">{t(notice)}</p>}
        {imageMode && designLibrary.notice && <p role="status">{t(designLibrary.notice)}</p>}
        {imageMode && designLibrary.saving && <p role="status">{t('正在保存图片设计…')}</p>}
        {imageMode && !!sceneFonts.error && <div role="alert" className="mewiki-publication-error"><p>{localizePublicationError(sceneFonts.error)}</p>{sceneFonts.target && <button type="button" onClick={() => { const target = sceneFonts.target!; if (target.index) images.setCurrentId(images.selected[target.index - 1].id); editor.select(target.layerId); setPropertiesOpen(true); setView('style'); }}>{t('定位字体图层')}</button>}</div>}
        {!imageMode && !!fontError && <p role="alert" className="mewiki-publication-error">{localizePublicationError(fontError)}</p>}
        {!fontReady && !fontError && <p role="status">{t('正在加载资料库字体…')}</p>}
        {!imageMode && <div role="tabpanel" id="publication-panel-style" aria-labelledby="publication-tab-style" hidden={view !== 'style'}><PublicationSamplePreview options={options} font={selectedFont} /></div>}
        {imageMode && <div role="tabpanel" className="mewiki-publication-image-panel" id={view === 'content' ? 'publication-panel-content' : 'publication-panel-style'} aria-labelledby={view === 'content' ? 'publication-tab-content' : 'publication-tab-style'} hidden={view === 'result'}>
          <ResearchContentLibraryContext.Provider value={{ notebook: snapshot, directory, busy: false, status: directory ? 'saved' : 'browser' }}><PublicationImageWorkspace workspace={images} options={options} showPicker={view === 'content'} disabled={busy || saving || designLibrary.saving} editor={editor} fonts={sceneFonts.fonts} onEdit={() => setPropertiesOpen(true)} /></ResearchContentLibraryContext.Provider>
        </div>}
        {!imageMode && view === 'content' && <div role="tabpanel" id="publication-panel-content" aria-labelledby="publication-tab-content"><PublicationContentSelection state={snapshot} noteId={note.id} directory={directory} selected={selected} breaks={breaks} allTabs={allTabs} selectedTabs={selectedTabs} pdfPages={pdfPages} paged={options.mode === 'pages'} disabled={busy || saving} diagnostics={diagnostics} problemTarget={problemTarget}
          onSelect={(id, checked) => { setSelected(current => toggle(current, id, checked)); invalidate(); }} onBreak={(id, checked) => { setBreaks(current => toggle(current, id, checked)); invalidate(); }}
          onAll={checked => { setSelected(new Set(checked ? note.blocks.map(block => block.id) : [])); invalidate(); }} onAllTabs={checked => { setAllTabs(checked); invalidate(); }} onSelectTab={(id, tabId) => { if (busy || saving) return; setSelectedTabs(current => ({ ...current, [id]: tabId })); invalidate(); }}
          onSelectPdfPage={(id, page) => { if (busy || saving) return; setPdfPages(current => ({ ...current, [id]: page })); invalidate(); }}
        /></div>}
        {view === 'result' && <div role="tabpanel" id="publication-panel-result" aria-labelledby="publication-tab-result">
        {!result && !busy && <p className="mewiki-publication-empty">{t(imageMode ? '选择图片后，点击生成预览查看全部成品。' : '选择原文内容后，点击生成预览查看最终图片。')}</p>}
        {result && <>
          <p className="mewiki-publication-hint">{imageMode ? t`共 ${result.pages.length} 张图片` : t`共 ${result.pages.length} 页`}</p>
          <div className="mewiki-publication-preview">{result.pages.map((image, index) => <figure key={index}><img src={image.dataUrl} alt={imageMode ? t`导出图片第 ${index + 1} 张` : t`导出预览第 ${index + 1} 页`} width={image.width} height={image.height} /><figcaption><span>{resultNames[index] ? `${resultNames[index]} · ` : ''}{image.width} × {image.height}</span><button type="button" data-ui="icon-action" aria-label={imageMode ? t`下载第 ${index + 1} 张图片` : t`下载第 ${index + 1} 页`} title={imageMode ? t`下载第 ${index + 1} 张图片` : t`下载第 ${index + 1} 页`} onClick={() => download(new Blob([bytes(image.dataUrl) as Uint8Array<ArrayBuffer>], { type: result.format === 'jpeg' ? 'image/jpeg' : 'image/png' }), pageFilename(index))}><Download size={16} /></button></figcaption></figure>)}</div>
        </>}
        </div>}
        </div>
      </section>
      {imageMode && <PublicationCompositionPanel editor={editor} workspace={images} fonts={fonts} libraryId={libraryId} pluginId={plugin.id} disabled={busy || saving || designLibrary.saving} hidden={!propertiesOpen} onClose={() => { setPropertiesOpen(false); propertiesToggle.current?.focus(); }} onFont={() => fontFile.current?.click()} onError={setError} stickers={designLibrary.collection?.stickers ?? []} onSticker={designLibrary.addSticker} onRemoveSticker={designLibrary.removeSticker} />}
    </div>
  </div></main></>;
}
