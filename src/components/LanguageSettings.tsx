import { Languages } from 'lucide-react';
import { setLocale, t, type Locale } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './LanguageSettings.css';

export default function LanguageSettings() {
  const locale = useLocale();
  const choose = (next: Locale) => {
    try { setLocale(next, localStorage); } catch { setLocale(next); }
  };
  return <section data-testid="mewiki-language-settings" className="mewiki-language-settings" aria-label={t('界面语言')}>
    <div className="mewiki-language-intro"><Languages size={28} aria-hidden="true" /><p>{t('跟随浏览器首次选择；切换不会翻译笔记内容。')}</p></div>
    <fieldset><legend>{t('界面语言')}</legend>
      {([{ value: 'zh-CN', name: '简体中文', detail: 'Chinese · Simplified' }, { value: 'en', name: 'English', detail: '英文' }] as const).map(option =>
        <label key={option.value} lang={option.value}><input type="radio" name="mewiki-language" value={option.value} checked={locale === option.value} onChange={() => choose(option.value)} /><span><strong>{option.name}</strong><small>{option.detail}</small></span></label>)}
    </fieldset>
  </section>;
}
