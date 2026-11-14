import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check, Database, FolderCog, Languages, Plug, X } from 'lucide-react';
import { localizeError, t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { useLibraryWorkspace } from '../state/LibraryWorkspaceContext.ts';
import { useIntegration } from '../integrations/IntegrationContext.ts';
import { useSettingsNavigation } from '../state/useSettingsNavigation.ts';
import { pluginStatus } from '../plugins/registry.ts';
import LanguageSettings from './LanguageSettings.tsx';
import { useFormulaPopover } from './useFormulaPopover.ts';
import './ResearchFooterQuickSettings.css';

type QuickPanel = 'libraries' | 'language' | 'plugins';

function QuickCard({ id, label, triggerRef, onClose, children }: {
  id: string; label: string; triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useCallback(() => triggerRef.current!.getBoundingClientRect(), [triggerRef]);
  useFormulaPopover({ ref, triggerRef, getAnchor: anchor, onCancel: onClose, side: 'top' });
  useEffect(() => {
    const control = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]:not(:disabled), input:checked:not(:disabled)')
      ?? ref.current?.querySelector<HTMLElement>('input:not(:disabled), button[data-ui="menu-action"]:not(:disabled)') ?? ref.current;
    control?.focus({ preventScroll: true });
  }, []);
  return <div ref={ref} id={id} role="dialog" aria-label={label} aria-modal="false" popover="manual"
    className="mewiki-footer-quick-panel" tabIndex={-1} onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !triggerRef.current?.contains(event.relatedTarget)) onClose();
    }}>
    <header><strong>{label}</strong><button type="button" data-ui="icon-action" aria-label={t('关闭卡片')} title={t('关闭卡片')} onClick={() => onClose(true)}><X size={14} aria-hidden="true" /></button></header>
    {children}
  </div>;
}

export default function ResearchFooterQuickSettings({ scope, disabled = false }: { scope: string; disabled?: boolean }) {
  useLocale();
  const workspace = useLibraryWorkspace(), integration = useIntegration(), settings = useSettingsNavigation();
  const [opened, setOpened] = useState<{ panel: QuickPanel; scope: string } | null>(null);
  const [switchError, setSwitchError] = useState('');
  const active = !disabled && !settings && opened?.scope === scope ? opened.panel : null;
  if (opened && !active) setOpened(null);
  const triggerRef = useRef<HTMLButtonElement>(null), id = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpened(null);
    if (restoreFocus && triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
  }, []);
  const toggle = (panel: QuickPanel, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger; setSwitchError(''); setOpened(active === panel ? null : { panel, scope });
  };
  const manage = (open: () => void) => {
    close(true); open();
  };
  const libraryName = t`当前资料库：${workspace.profile.name}，切换资料库`;
  return <>
    <button type="button" data-ui="icon-action" className="mewiki-library-switcher" aria-label={libraryName} title={libraryName}
      aria-haspopup="dialog" aria-expanded={active === 'libraries'} aria-controls={active === 'libraries' ? id : undefined} disabled={disabled || workspace.switching}
      onClick={event => toggle('libraries', event.currentTarget)}><Database size={16} aria-hidden="true" /></button>
    <button type="button" data-ui="icon-action" aria-label={t('界面语言')} title={t('选择界面语言')}
      aria-haspopup="dialog" aria-expanded={active === 'language'} aria-controls={active === 'language' ? id : undefined} disabled={disabled}
      onClick={event => toggle('language', event.currentTarget)}><Languages size={16} aria-hidden="true" /></button>
    <button type="button" data-ui="icon-action" aria-label={t('插件管理')} title={t('插件管理')}
      aria-haspopup="dialog" aria-expanded={active === 'plugins'} aria-controls={active === 'plugins' ? id : undefined} disabled={disabled}
      onClick={event => toggle('plugins', event.currentTarget)}><Plug size={16} aria-hidden="true" /></button>
    {active && <QuickCard key={active} id={id} triggerRef={triggerRef} label={active === 'libraries' ? t('切换资料库') : active === 'language' ? t('界面语言') : t('插件管理')} onClose={close}>
      {active === 'language' ? <div className="mewiki-footer-quick-content"><LanguageSettings groupName={`${id}-language`} /></div>
        : active === 'libraries' ? <>
          <div className="mewiki-footer-quick-content" aria-busy={workspace.switching}>
            {workspace.catalog.libraries.map(profile => <button key={profile.id} type="button" data-ui="menu-action"
              aria-label={t`切换到${profile.name}`} aria-pressed={profile.id === workspace.profile.id} disabled={workspace.switching}
              title={profile.directory ?? profile.name} onClick={() => {
                if (profile.id === workspace.profile.id) { close(true); return; }
                setSwitchError('');
                void workspace.switchLibrary(profile.id).then(() => {
                  close();
                  // A library switch remounts the notebook, including its footer.
                  requestAnimationFrame(() => {
                    const visible = (button: HTMLButtonElement) => button.getClientRects().length > 0 && !button.disabled;
                    const trigger = [...document.querySelectorAll<HTMLButtonElement>('.research-sidebar-footer .mewiki-library-switcher')].find(visible)
                      ?? [...document.querySelectorAll<HTMLButtonElement>('.research-notebook-sidebar-toggle')].find(visible);
                    trigger?.focus({ preventScroll: true });
                  });
                }).catch(cause => setSwitchError(cause instanceof Error ? cause.message : '资料库操作失败。'));
              }}><Database size={16} aria-hidden="true" /><span>{profile.name}</span>{profile.id === workspace.profile.id && <Check size={15} aria-hidden="true" />}</button>)}
            {switchError && <p role="alert">{localizeError(switchError)}</p>}
          </div>
          <footer><button type="button" data-ui="menu-action" disabled={workspace.switching} onClick={() => manage(workspace.showManager)}><FolderCog size={16} aria-hidden="true" /><span>{t('管理资料库')}</span></button></footer>
        </> : <>
          <div className="mewiki-footer-quick-content" aria-busy={!integration.catalogReady}>
            {integration.catalog.map(plugin => <label key={plugin.id} className="mewiki-footer-quick-plugin" title={t(plugin.description)}>
              <Plug size={16} aria-hidden="true" /><span>{t(plugin.name)}</span><input type="checkbox" role="switch" aria-label={t(plugin.name)}
                checked={pluginStatus(integration.plugins, plugin.id) === 'enabled'} disabled={!integration.catalogReady}
                onChange={event => integration.setPlugin(plugin.id, event.target.checked ? 'enabled' : 'disabled')} />
            </label>)}
            {integration.error && <p role="alert">{localizeError(integration.error)}</p>}
          </div>
          <footer><button type="button" data-ui="menu-action" onClick={() => manage(integration.showManager)}><Plug size={16} aria-hidden="true" /><span>{t('管理插件')}</span></button></footer>
        </>}
    </QuickCard>}
  </>;
}
