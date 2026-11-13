import { useRef } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { useLocale } from '../i18n/react.ts';
import { localizeError, t } from '../i18n/locale.ts';
import { useInterfaceFont } from '../state/InterfaceFontContext.ts';
import { userFontAccept } from '../domain/researchFonts.ts';
import { fontSizeLimits } from '../state/fontSizes.ts';
import './InterfaceFontSettings.css';

export default function InterfaceFontSettings() {
  useLocale();
  const font = useInterfaceFont();
  const input = useRef<HTMLInputElement>(null);
  const missing = font.selected && !font.fonts.some(item => item.id === font.selected);
  return <div className="mewiki-interface-font-settings">
    <div className="mewiki-setting-row mewiki-interface-font-row">
      <label htmlFor="mewiki-interface-font"><strong>{t('界面与正文字体')}</strong><small id="mewiki-interface-font-description">{t('使用当前资料库的字体，按资料库记住选择。')}</small></label>
      <div className="mewiki-interface-font-control">
        <select id="mewiki-interface-font" aria-label={t('界面与正文字体')} aria-describedby="mewiki-interface-font-description" value={font.selected ? `font:${font.selected}` : 'default'} disabled={font.working} onChange={event => font.choose(event.target.value === 'default' ? null : event.target.value.slice(5))}>
          <optgroup label={t('内置字体')}><option value="default">{t('MeWiki 默认字体')}</option></optgroup>
          <optgroup label={t('资料库字体')}>
            {missing && <option value={`font:${font.selected}`} disabled>{t('所选字体原件不可用')}</option>}
            {font.fonts.map(item => <option key={item.id} value={`font:${item.id}`}>{item.name}</option>)}
          </optgroup>
        </select>
        <button type="button" data-ui="icon-action" aria-label={t('导入字体')} title={t('导入字体')} disabled={font.working} onClick={() => input.current?.click()}><Upload size={16} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('下载原字体')} title={t('下载原字体')} disabled={!font.selected || font.loading || font.working || !!missing} onClick={() => { void font.downloadFont(); }}><Download size={16} /></button>
        <input ref={input} hidden type="file" aria-label={t('导入字体文件')} accept={userFontAccept} disabled={font.working} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void font.importFont(file); }} />
      </div>
    </div>
    <div className="mewiki-interface-font-detail">
      <p>{t('界面、菜单、笔记普通文字和行内代码即时使用所选字体；公式、多行代码块、PDF 内嵌文字和专用图形保留各自字体。')}</p>
      <p>{t('默认使用本地随附的思源黑体。小字不易辨认时，可将界面字号调至 15–16 px、正文字号调至 16–18 px。')}</p>
      <p>{t('导出页面的操作界面与原文阅读使用这里的设置，样板和图片仍使用导出模板。')}</p>
      <p>{t('支持 TTF、OTF、WOFF、WOFF2，单个最大 100 MiB。已在图文导出中导入的字体可直接选择。')}</p>
      {(font.loading || font.working) && <p role="status">{font.working ? t('正在处理字体…') : t('正在加载界面字体…')}</p>}
      {font.notice && <p role="status">{localizeError(font.notice)}</p>}
      {font.error && <p className="mewiki-interface-font-error" role="alert">{localizeError(font.error)} {t('可重新导入原字体，或选择 MeWiki 默认字体继续使用。')}</p>}
    </div>
    {(['interface', 'document'] as const).map(target => {
      const limits = fontSizeLimits[target];
      const label = target === 'interface' ? t('界面字号') : t('正文字号');
      const reset = target === 'interface' ? t('恢复默认界面字号') : t('恢复默认正文字号');
      return <div className="mewiki-font-size-setting" key={target}>
        <div className="mewiki-setting-row mewiki-interface-font-row">
          <label htmlFor={`mewiki-${target}-font-size`}><strong>{label}</strong><small>{target === 'interface' ? t('调整菜单、侧栏和设置文字，不改变工具栏高度。') : t('调整笔记正文及标题、表格和标签页，不改变导出模板。')}</small></label>
          <div className="mewiki-font-size-control">
            <select id={`mewiki-${target}-font-size`} aria-label={label} value={font.sizes[target]} onChange={event => font.setSize(target, Number(event.target.value))}>
              {Array.from({ length: limits.max - limits.min + 1 }, (_, index) => limits.min + index).map(size => <option key={size} value={size}>{size} px{size === limits.default ? ` · ${t('默认')}` : ''}</option>)}
            </select>
            <button type="button" data-ui="icon-action" aria-label={reset} title={reset} disabled={font.sizes[target] === limits.default} onClick={() => font.setSize(target, limits.default)}><RotateCcw size={16} /></button>
          </div>
        </div>
        <p className={`mewiki-font-size-sample is-${target}`}>{target === 'interface' ? t('界面预览：菜单与侧栏 ABC 0123456789') : t('正文预览：让知识清晰可读。ABC abc 0123456789')}</p>
      </div>;
    })}
  </div>;
}
