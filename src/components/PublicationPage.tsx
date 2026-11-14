import { useEffect, useMemo, useState } from 'react';
import { t, localizeError } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { useIntegration } from '../integrations/IntegrationContext.ts';
import { readPublicationTab } from '../state/publicationNavigation.ts';
import PublicationDialog from './PublicationDialog.tsx';
import LibraryTypographyProvider from './LibraryTypographyProvider.tsx';
import { readPublicationDraft, reconcilePublicationDraft, type PublicationDraft, type PublicationDraftScope } from '../state/publicationDrafts.ts';

/** A standalone export page never starts a notebook controller or writes notebook state. */
export default function PublicationPage() {
  useLocale();
  const integration = useIntegration();
  const [initial] = useState(() => {
    try { return { value: readPublicationTab(new URL(location.href), sessionStorage), error: '' }; }
    catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : '图文导出失败，请重试。' }; }
  });
  const value = initial.value;
  const scope = useMemo<PublicationDraftScope | null>(() => value ? { libraryId: value.libraryId, pluginId: value.pluginId, exporterId: value.exporterId, noteId: value.noteId, entry: value.initialMode ?? 'note' } : null, [value]);
  const [tabId] = useState(() => new URL(location.href).searchParams.get('publication') ?? '');
  const [draft, setDraft] = useState<{ value?: PublicationDraft; error: string } | null>(null);
  const [draftAttempt, setDraftAttempt] = useState(0);
  useEffect(() => {
    if (!scope) return;
    let active = true;
    void readPublicationDraft(scope, tabId).then(draft => { if (active) setDraft({ value: draft && reconcilePublicationDraft(draft, value!.snapshot, value!.noteId), error: '' }); })
      .catch(cause => { if (active) setDraft({ error: cause instanceof Error ? cause.message : '导出草稿无法读取，请重试。原草稿未被替换。' }); });
    return () => { active = false; };
  }, [scope, tabId, value, draftAttempt]);
  const plugin = value && integration.catalog.find(item => item.id === value.pluginId && item.version === value.pluginVersion);
  const exporter = plugin?.exporters?.find(item => item.id === value?.exporterId);
  const loading = !initial.error && (!integration.catalogReady || !draft);
  const available = value && plugin && exporter && integration.plugins[plugin.id] === 'enabled';
  useEffect(() => {
    document.title = `${t('社交图文导出')}${value ? ` · ${value.snapshot.notes.find(note => note.id === value.noteId)?.title}` : ''} — ${t('觅维')}`;
  });
  const content = loading ? <main className="mewiki-publication-state" role="status">{t('正在加载…')}</main>
    : !available ? <main className="mewiki-publication-state"><p role="alert">{localizeError(initial.error || '导出插件已停用或发生变更，请回到笔记重新打开图文导出。')}</p></main>
    : draft?.error ? <main className="mewiki-publication-state"><p role="alert">{localizeError(draft.error)}</p><button type="button" onClick={() => { setDraft(null); setDraftAttempt(current => current + 1); }}>{t('重新读取导出草稿')}</button></main>
    : <PublicationDialog session={{ plugin, exporter, snapshot: value.snapshot, noteId: value.noteId, selectedTabs: value.selectedTabs, initialMode: value.initialMode }}
      libraryId={value.libraryId} directory={value.directory} draftScope={scope!} tabId={tabId} initialDraft={draft?.value} onClose={() => window.close()} />;
  return value ? <LibraryTypographyProvider key={value.libraryId} libraryId={value.libraryId} directory={value.directory}>{content}</LibraryTypographyProvider> : content;
}
