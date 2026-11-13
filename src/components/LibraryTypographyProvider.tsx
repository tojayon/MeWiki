import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Type } from 'lucide-react';
import { useLocale } from '../i18n/react.ts';
import { t } from '../i18n/locale.ts';
import { InterfaceFontContext } from '../state/InterfaceFontContext.ts';
import { INTERFACE_FONT_CHANGED_EVENT, interfaceFontPreferenceKey, readInterfaceFontPreference, saveInterfaceFontPreference } from '../state/interfaceFonts.ts';
import { importUserFont, listUserFonts, loadUserFontFace, readUserFont, subscribeUserFonts, userFontFile } from '../state/userFonts.ts';
import { withFontLoadingLimit } from '../state/fontLoading.ts';
import type { ResearchMediaAsset } from '../domain/researchMedia.ts';
import { documentTheme } from '../styles/documentTheme.ts';
import { FONT_SIZES_CHANGED_EVENT, fontSizeLimits, fontSizesKey, readFontSizes, saveFontSize, type FontSizeTarget } from '../state/fontSizes.ts';

function preferenceStorage() { try { return localStorage; } catch { return undefined; } }
const message = (cause: unknown) => cause instanceof Error ? cause.message : '无法读取已导入字体。';

async function prepareDefaultGlyphs(signal: AbortSignal) {
  signal.throwIfAborted();
  const root = document.getElementById('root');
  const values = [...(root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea') ?? [])].map(field => field.value + field.placeholder).join('');
  const text = [...new Set((root?.innerText ?? '') + values)].join('') || 'MeWiki 字体';
  try { await document.fonts.load(`400 ${documentTheme.fontSize}px ${documentTheme.fontFamily}`, text); }
  catch {
    signal.throwIfAborted();
    throw new Error('内置字体未能加载，已使用系统备用字体。');
  }
  signal.throwIfAborted();
}

/** Shared appearance only: safe for standalone pages without a notebook controller. */
export default function LibraryTypographyProvider({ libraryId, directory, children }: { libraryId: string; directory: string | null; children: ReactNode }) {
  useLocale();
  const [selected, setSelected] = useState(() => readInterfaceFontPreference(libraryId, preferenceStorage()));
  const [sizes, setSizes] = useState(() => readFontSizes(libraryId, preferenceStorage()));
  const [fonts, setFonts] = useState<ResearchMediaAsset[]>([]);
  const [listRevision, setListRevision] = useState(0);
  const [fontRevision, setFontRevision] = useState(0);
  const [active, setActive] = useState<{ selection: string | null; face?: FontFace; fallbackReady: boolean } | null>(null);
  const [loading, setLoading] = useState(!!selected);
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);
  const [fontError, setFontError] = useState('');
  const [listError, setListError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  // Keep layout available for local subset fonts, but reveal no fallback text.
  useLayoutEffect(() => {
    if (visible) return;
    const root = document.getElementById('root');
    if (!root) return;
    const attributes = ['inert', 'aria-busy', 'aria-hidden', 'data-mewiki-font-loading'];
    const previous = attributes.map(name => root.getAttribute(name));
    root.setAttribute('inert', ''); root.setAttribute('aria-busy', 'true');
    root.setAttribute('aria-hidden', 'true'); root.setAttribute('data-mewiki-font-loading', '');
    return () => attributes.forEach((name, index) => { if (previous[index] === null) root.removeAttribute(name); else root.setAttribute(name, previous[index]); });
  }, [visible]);

  useEffect(() => {
    const refresh = () => setSizes(readFontSizes(libraryId, preferenceStorage()));
    const changed = (event: Event) => { if ((event as CustomEvent<{ libraryId: string }>).detail?.libraryId === libraryId) refresh(); };
    const stored = (event: StorageEvent) => { if (event.key === fontSizesKey(libraryId) || event.key === null) refresh(); };
    window.addEventListener(FONT_SIZES_CHANGED_EVENT, changed);
    window.addEventListener('storage', stored);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(FONT_SIZES_CHANGED_EVENT, changed);
      window.removeEventListener('storage', stored);
      window.removeEventListener('focus', refresh);
    };
  }, [libraryId]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const properties = {
      '--mewiki-interface-font-size': `${sizes.interface}px`,
      '--mewiki-interface-unit': `${sizes.interface / fontSizeLimits.interface.default}px`,
      '--mewiki-document-font-size': `${sizes.document}px`,
      '--mewiki-document-unit': `${sizes.document / documentTheme.fontSize}px`,
    };
    for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
    return () => { for (const name of Object.keys(properties)) root.style.removeProperty(name); };
  }, [sizes]);

  useEffect(() => {
    const preference = () => { setSelected(readInterfaceFontPreference(libraryId, preferenceStorage())); setNotice(''); };
    const localChange = (event: Event) => { if ((event as CustomEvent<{ libraryId: string }>).detail?.libraryId === libraryId) preference(); };
    const storedChange = (event: StorageEvent) => { if (event.key === interfaceFontPreferenceKey(libraryId) || event.key === null) preference(); };
    const focus = () => { preference(); setListRevision(value => value + 1); };
    const unsubscribe = subscribeUserFonts(libraryId, id => {
      setListRevision(value => value + 1);
      if (!id || id === selected) setFontRevision(value => value + 1);
    });
    window.addEventListener(INTERFACE_FONT_CHANGED_EVENT, localChange);
    window.addEventListener('storage', storedChange);
    window.addEventListener('focus', focus);
    return () => {
      unsubscribe();
      window.removeEventListener(INTERFACE_FONT_CHANGED_EVENT, localChange);
      window.removeEventListener('storage', storedChange);
      window.removeEventListener('focus', focus);
    };
  }, [libraryId, selected]);

  useEffect(() => {
    const abort = new AbortController();
    void listUserFonts(libraryId, abort.signal).then(value => {
      if (!abort.signal.aborted) { setFonts(value); setListError(''); }
    }).catch(cause => { if (!abort.signal.aborted) setListError(message(cause)); });
    return () => abort.abort();
  }, [libraryId, directory, listRevision]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      // StrictMode may immediately cancel the first setup.
      await Promise.resolve();
      if (abort.signal.aborted) return;
      setFontError(''); setLoading(true);
      try {
        // Prepare local fallback subsets before every switch as well. A complete
        // custom font may have kept those subsets unused until now.
        const [font, fallback] = await Promise.allSettled([
          selected ? withFontLoadingLimit(signal => loadUserFontFace(libraryId, selected, signal), abort.signal) : Promise.resolve(undefined),
          withFontLoadingLimit(prepareDefaultGlyphs, abort.signal),
        ]);
        if (!abort.signal.aborted) {
          setFontError(font.status === 'rejected' ? message(font.reason) : fallback.status === 'rejected' ? message(fallback.reason) : '');
          setActive({ selection: selected, face: font.status === 'fulfilled' ? font.value : undefined, fallbackReady: fallback.status === 'fulfilled' });
        }
      } catch (cause) {
        if (!abort.signal.aborted) { setFontError(message(cause)); setActive({ selection: selected, fallbackReady: false }); }
      }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  }, [libraryId, directory, selected, fontRevision]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const properties = ['--mewiki-interface-font-family', '--mewiki-document-font-family', '--mewiki-interface-font-synthesis'];
    if (!active) return;
    if (active.face) document.fonts.add(active.face);
    const family = active.face ? `"${active.face.family}", ${documentTheme.fontFamily}` : documentTheme.fontFamily;
    root.style.setProperty(properties[0], family);
    root.style.setProperty(properties[1], family);
    root.style.setProperty(properties[2], active.face ? 'weight' : 'none');
    return () => {
      if (active.face) document.fonts.delete(active.face);
      for (const property of properties) root.style.removeProperty(property);
    };
  }, [active]);

  useEffect(() => {
    if (visible || !active || active.selection !== selected) return;
    // A failed or expired CSS font request keeps FontFaceSet.ready pending.
    // Do not hide the page for a second deadline waiting for that same request.
    if (!active.fallbackReady) { setVisible(true); return; }
    const abort = new AbortController();
    void withFontLoadingLimit(async signal => {
      // Flush the actual text layout first, so FontFaceSet.ready includes all
      // local Chinese subsets needed by this page, including fallback glyphs.
      document.getElementById('root')?.getBoundingClientRect();
      await document.fonts.ready;
      signal.throwIfAborted();
    }, abort.signal).catch(cause => { if (!abort.signal.aborted) setFontError(message(cause)); })
      .finally(() => { if (!abort.signal.aborted) setVisible(true); });
    return () => abort.abort();
  }, [active, selected, visible]);

  const choose = (id: string | null) => {
    setOperationError(''); setNotice('');
    saveInterfaceFontPreference(libraryId, id, preferenceStorage());
    setSelected(id);
  };
  const setSize = (target: FontSizeTarget, size: number) => {
    saveFontSize(libraryId, target, size, preferenceStorage());
    setSizes(readFontSizes(libraryId, preferenceStorage()));
  };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    operation.current?.abort();
    const abort = new AbortController(); operation.current = abort;
    setWorking(true); setOperationError(''); setNotice('');
    try { await action(abort.signal); }
    catch (cause) { if (!abort.signal.aborted) setOperationError(message(cause)); }
    finally { if (!abort.signal.aborted) setWorking(false); }
  };
  const importFont = (file: File) => run(async signal => {
    const asset = await importUserFont(libraryId, file, signal);
    signal.throwIfAborted();
    choose(asset.id);
    setNotice('字体已保存到当前资料库，可在界面设置和图文导出中重复使用。');
  });
  const downloadFont = () => run(async signal => {
    if (!selected) return;
    const font = await readUserFont(libraryId, selected, signal);
    signal.throwIfAborted();
    const url = URL.createObjectURL(userFontFile(font));
    const link = document.createElement('a'); link.href = url; link.download = font.name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  return <InterfaceFontContext.Provider value={{ fonts, selected, loading, working, error: operationError || fontError || listError, notice, sizes, setSize, choose, importFont, downloadFont }}>
    {children}
    {!visible && createPortal(<div className="mewiki-font-loading" role="status" aria-label={t('正在准备显示字体…')}><Type size={24} aria-hidden="true" /></div>, document.body)}
  </InterfaceFontContext.Provider>;
}
