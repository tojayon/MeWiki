import { setLocale, t, type Locale } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import './LanguageSettings.css';

export default function LanguageSettings({ groupName = 'mewiki-language' }: { groupName?: string } = {}) {
  const locale = useLocale();
  const choose = (next: Locale) => {
    try { setLocale(next, localStorage); } catch { setLocale(next); }
  };
  return <section data-testid="mewiki-language-settings" className="mewiki-language-settings" aria-label={t('界面语言')}>
    <fieldset><legend className="visually-hidden">{t('界面语言')}</legend>
      {([{ value: 'zh-CN', name: '简体中文' }, { value: 'en', name: 'English' }] as const).map(option =>
        <label key={option.value} lang={option.value}><input type="radio" name={groupName} value={option.value} checked={locale === option.value} onChange={() => choose(option.value)} /><span><strong>{option.name}</strong></span></label>)}
    </fieldset>
  </section>;
}
