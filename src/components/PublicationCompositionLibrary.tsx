import { useRef, useState } from 'react';
import { Save, FolderOpen, X, Copy, Download, Upload, Trash2, Ellipsis, Square } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import PublicationPopover from './PublicationPopover.tsx';
import type { CompositionLibrary } from '../state/useCompositionLibrary.ts';
export default function PublicationCompositionLibrary({ library, disabled, onError, onGenerateCurrent, canGenerateCurrent }: { library: CompositionLibrary; disabled: boolean; onError: (error: string) => void; onGenerateCurrent: () => void; canGenerateCurrent: boolean }) {
  const [panel, setPanel] = useState<{ type: 'actions' | 'save' | 'saveAs' | 'open' | 'delete'; trigger: HTMLButtonElement } | null>(null);
  const [draft, setDraft] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const close = () => { panel?.trigger.focus(); setPanel(null); };
  const open = (type: NonNullable<typeof panel>['type']) => { if (type === 'save' || type === 'saveAs') setDraft(library.name); if (panel) setPanel({ ...panel, type }); };
  const report = (cause: unknown) => onError(cause instanceof Error ? cause.message : '图片设计保存失败。');
  const backup = async () => {
    try {
      const result = await library.backup(); if (!result) return;
      const url = URL.createObjectURL(result.blob), link = document.createElement('a');
      link.href = url; link.download = result.name.replace(/[\\/:*?"<>|]/g, '_') + '.mewiki-design.zip'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { report(cause); }
  };
  const title = panel?.type === 'open' ? '打开图片设计' : panel?.type === 'delete' ? '删除当前图片设计' : panel?.type === 'saveAs' ? '图片设计另存为' : panel?.type === 'save' ? '保存图片设计' : '图片设计操作';
  return <>
    <button type="button" data-ui="icon-action" className="mewiki-composition-toolbar-menu" aria-label={t('图片设计操作')} title={t('图片设计操作')} disabled={disabled} onClick={event => setPanel({ type: 'actions', trigger: event.currentTarget })}><Ellipsis size={16} /></button>
    <input ref={file} type="file" hidden accept=".zip,application/zip" aria-label={t('选择作品备份 ZIP')} disabled={disabled} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) { close(); void library.restore(selected).catch(report); } }} />
    {panel && <PublicationPopover key={panel.type} trigger={panel.trigger} label={t(title)} onClose={() => setPanel(null)} toolbar={panel.type === 'actions' || panel.type === 'open'}>
      {panel.type === 'actions' ? <>
        <button type="button" data-ui="menu-action" disabled={disabled || !library.collection} onClick={() => open('save')}><Save size={16} /><span>{t('保存图片设计')}</span></button>
        <button type="button" data-ui="menu-action" disabled={disabled} onClick={() => { open('open'); void library.refresh().catch(report); }}><FolderOpen size={16} /><span>{t('打开图片设计')}</span></button>
        <button type="button" data-ui="menu-action" disabled={disabled || !library.designId} onClick={() => open('saveAs')}><Copy size={16} /><span>{t('图片设计另存为')}</span></button>
        <button type="button" data-ui="menu-action" disabled={disabled || !library.designId} onClick={() => { close(); void backup(); }}><Download size={16} /><span>{t('导出作品备份')}</span></button>
        <button type="button" data-ui="menu-action" disabled={disabled || !library.collection} onClick={() => file.current?.click()}><Upload size={16} /><span>{t('导入作品备份')}</span></button>
        <button type="button" data-ui="menu-action" disabled={disabled || !library.designId} onClick={() => open('delete')}><Trash2 size={16} /><span>{t('删除当前图片设计')}</span></button>
        <button type="button" data-ui="menu-action" disabled={disabled || !canGenerateCurrent} onClick={() => { close(); onGenerateCurrent(); }}><Square size={16} /><span>{t('生成当前图片')}</span></button>
      </> : panel.type === 'save' || panel.type === 'saveAs' ? <form onSubmit={event => { event.preventDefault(); void library.save(draft, true, panel.type === 'saveAs').then(close).catch(report); }}>
        <label>{t('设计名称')}<input autoFocus aria-label={t('设计名称')} maxLength={100} value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <p className="mewiki-publication-hint">{t('保存当前画布、本批图片、文案和逐图调整。保存后自动记录修改；作品与个人模板分开保存。')}</p>
        <div className="mewiki-publication-save-actions"><button type="submit" data-ui="icon-action" aria-label={t('确认保存设计')} title={t('确认保存设计')} disabled={disabled || !draft.trim()}><Save size={16} /></button><button type="button" data-ui="icon-action" aria-label={t('取消')} onClick={close}><X size={16} /></button></div>
      </form> : panel.type === 'delete' ? <>
        <p>{t('删除这份设计后，当前画布与原图素材仍会保留。')}</p>
        <div className="mewiki-publication-save-actions"><button type="button" data-ui="menu-action" disabled={disabled} onClick={() => void library.removeDesign().then(close).catch(report)}><Trash2 size={16} /><span>{t('确认删除设计')}</span></button><button type="button" data-ui="icon-action" aria-label={t('取消')} onClick={close}><X size={16} /></button></div>
      </> : <>{!library.collection?.designs.length && <p>{t('还没有保存的图片设计。')}</p>}{library.collection?.designs.slice().reverse().map(design => <button key={design.id} type="button" data-ui="menu-action" disabled={disabled} onClick={() => { library.load(design); close(); }}><FolderOpen size={16} /><span>{design.name}</span></button>)}</>}
    </PublicationPopover>}
  </>;
}
