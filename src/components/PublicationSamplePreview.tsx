import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t, translate, type Locale } from '../i18n/locale.ts';
import { localizePublicationError } from '../i18n/publicationError.ts';
import { useLocale } from '../i18n/react.ts';
import type { ResearchNotebookState } from '../domain/researchNotebook.ts';
import { defaultCalloutAppearance } from '../domain/researchCallout.ts';
import { buildPublicationDocument } from '../domain/publication.ts';
import { parsePublicationOptions, type PublicationOptions, type PublicationRequest } from '../domain/publicationTypes.ts';
import { publicationMarkup } from '../domain/publicationMarkup.ts';
import type { PublicationFont } from '../domain/researchFonts.ts';
import { capturePublicationSurface } from '../state/publicationDomCapture.ts';
import { documentTheme } from '../styles/documentTheme.ts';
import PublicationReadingSurface from './PublicationReadingSurface.tsx';
import sansCss from '@fontsource-variable/noto-sans-sc/index.css?inline';
import serifCss from '@fontsource-variable/noto-serif-sc/index.css?inline';
import mathCss from 'katex/dist/katex.min.css?inline';
import syntaxCss from 'highlight.js/styles/github-dark.css?inline';

const fontCss = [sansCss, serifCss, mathCss, syntaxCss].join('\n');
let builtStyles: Promise<string> | undefined;
/** Cache application CSS only; no user content or settings enter this cache. */
function samplePageStyles(): Promise<string> {
  if (!import.meta.env.PROD) return Promise.resolve([...document.styleSheets].map(sheet => [...sheet.cssRules].map(rule => rule.cssText).join('\n')).join('\n'));
  return builtStyles ??= fetch(new URL('mewiki-publication.css', new URL(import.meta.env.BASE_URL, location.href))).then(async response => {
    if (!response.ok) throw new Error('原生导出样式尚未生成，请重新构建 MeWiki 后重试。');
    return response.text();
  }).catch(cause => { builtStyles = undefined; throw cause; });
}

/** A deliberately small fictional note, never content from a user's library. */
function sampleNotebook(locale: Locale): ResearchNotebookState {
  const sample = (message: string) => translate(message, [], locale);
  return { version: 8, open: true, view: 'notes', activeSymbolId: '', symbols: [], terms: [], activeNoteId: 'publication-sample', notes: [{
    id: 'publication-sample', title: sample('MeWiki 样板笔记'), createdAt: '2026-11-11', updatedAt: '2026-11-11', blocks: [
      { id: 'sample-heading', type: 'heading', level: 2, text: sample('把知识分享得更清晰') },
      { id: 'sample-paragraph', type: 'paragraph', text: sample('这是一段样板内容。**重点文字**、行内代码 `MeWiki` 与行内公式 $E=mc^2$，展示当前字体、配色与留白。') },
      { id: 'sample-callout', type: 'callout', title: sample('分享提示'), text: sample('先调整样式，再选择原文内容；生成后即可下载图片。'), appearance: { ...defaultCalloutAppearance } },
      { id: 'sample-list', type: 'paragraph', text: sample('1. 选择适合的平台与比例\n2. 使用清晰度档位调整画质\n3. 在原文中勾选要分享的内容') },
      { id: 'sample-table', type: 'markdown', kind: 'table', text: sample('| 内容 | 展示效果 |\n| --- | --- |\n| 正文与公式 | 清晰阅读 |\n| 配色与留白 | 跟随当前配置 |') },
      { id: 'sample-code', type: 'markdown', kind: 'code', text: '```javascript\nconst message = "Hello, MeWiki";\nconsole.log(message);\n```' },
    ],
  }] };
}

/** Use the same static markup and CSS as the real output, without a browser image job. */
async function sampleHtml(request: PublicationRequest): Promise<string> {
  const { html } = await publicationMarkup(request, fontCss, request.options.style === 'document' ? await samplePageStyles() : '');
  const output = new DOMParser().parseFromString(html, 'text/html');
  output.querySelector('meta[http-equiv="Content-Security-Policy"]')!.setAttribute('content', `default-src 'none'; style-src 'unsafe-inline' ${location.origin}; font-src ${location.origin} data:; img-src data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`);
  const { options: o } = request;
  const source = output.getElementById('source')!;
  const page = output.createElement('article'); page.className = 'publication-page';
  const frame = output.getElementById('publication-device-frame') as HTMLTemplateElement | null;
  if (frame) page.append(frame.content.cloneNode(true));
  const sheet = page.querySelector('.publication-sheet') ?? page;
  const texture = output.getElementById('publication-texture-layers') as HTMLTemplateElement | null;
  if (texture) sheet.append(texture.content.cloneNode(true));
  const header = output.createElement('header'); header.className = 'page-header';
  const identity = output.createElement('span'); identity.className = 'identity';
  if (o.logo) { const logo = output.createElement('img'); logo.src = o.logo; logo.alt = ''; identity.append(logo); }
  identity.append(output.createTextNode(o.header));
  const author = output.createElement('span'); author.textContent = o.author; header.append(identity, author);
  const body = output.createElement('main'); body.className = 'page-body' + (o.style === 'document' && !output.body.classList.contains('has-native-content') ? ' research-markdown' : '') + (o.cover ? ' cover-body' : '');
  const heading = output.createElement('h1'); heading.className = 'document-title'; heading.textContent = request.document.title; body.append(heading);
  if (o.subtitle) { const subtitle = output.createElement('p'); subtitle.className = 'subtitle'; subtitle.textContent = o.subtitle; body.append(subtitle); }
  if (o.cover) {
    if (o.coverImage) { const cover = output.createElement('img'); cover.src = o.coverImage; cover.alt = ''; body.append(cover); }
  } else for (const section of [...source.children]) body.append(...section.children);
  const footer = output.createElement('footer'); footer.className = 'page-footer';
  const caption = output.createElement('span'); caption.textContent = [o.footer, o.date].filter(Boolean).join(' · ');
  const number = output.createElement('span'); number.className = 'page-number'; number.textContent = o.showPageNumbers ? '1 / 1' : ''; footer.append(caption, number);
  sheet.append(header, body, footer); output.getElementById('pages')!.append(page);
  source.remove(); output.getElementById('font-probe')?.remove();
  if (o.mode === 'long' && !o.cover) {
    page.style.height = 'auto'; body.style.position = 'relative'; body.style.inset = 'auto'; body.style.margin = `${o.margin + o.fontSize}px ${o.margin}px`;
    body.style.display = 'flow-root';
  }
  return '<!doctype html>' + output.documentElement.outerHTML;
}

export default function PublicationSamplePreview({ options, font }: { options: PublicationOptions; font?: PublicationFont }) {
  const locale = useLocale();
  const state = useMemo(() => sampleNotebook(locale), [locale]);
  const note = state.notes[0];
  const surface = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [availableWidth, setAvailableWidth] = useState(600);
  const [size, setSize] = useState({ width: options.width, height: options.height });
  useEffect(() => {
    const element = container.current!;
    const measure = () => setAvailableWidth(element.clientWidth);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    if (options.fontAssetId && font?.id !== options.fontAssetId) return () => abort.abort();
    const timer = setTimeout(() => { void (async () => {
      try {
        const checked = parsePublicationOptions(options);
        const document = checked.style === 'document'
          ? { title: note.title, ...await capturePublicationSurface(surface.current!, abort.signal, checked.fontSize / documentTheme.fontSize) }
          : await buildPublicationDocument(state, note.id, note.blocks.map(block => block.id), {
            resolveImage: async () => { throw new Error('样板不包含外部图片。'); },
            renderVisual: async () => { throw new Error('样板不包含外部图形。'); },
          });
        const preview = await sampleHtml({ document, options: checked, ...(font ? { font } : {}) });
        if (!abort.signal.aborted) { setHtml(preview); setSize({ width: checked.width, height: checked.height }); setError(''); }
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : t('样板暂时无法显示，请检查导出设置。')); }
    })(); }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [options, state, note, font]);
  const scale = Math.min(1, availableWidth / size.width);
  return <div className="mewiki-publication-sample" ref={container}>
    {createPortal(<PublicationReadingSurface state={state} noteId={note.id} directory={null} selected={note.blocks.map(block => block.id)} options={options} selectedTabs={{}} allTabs={false} surfaceRef={surface} />, document.body)}
    <p className="mewiki-publication-hint">{t('样板随配置自动更新。实际内容与分页请生成预览后查看。')}</p>
    {!!error && <p className="mewiki-publication-error" role="status">{localizePublicationError(error)}</p>}
    <div className="mewiki-publication-sample-canvas" style={{ width: size.width * scale, height: size.height * scale, background: options.background }}>
      {html && (!options.fontAssetId || font?.id === options.fontAssetId) && <iframe title={t('样板内容预览')} sandbox="allow-same-origin" srcDoc={html} width={size.width} height={size.height}
        style={{ transform: `scale(${scale})` }} onLoad={event => {
          const frame = event.currentTarget, loaded = frame.contentDocument;
          if (options.mode === 'long' && !options.cover) void loaded?.fonts.ready.then(() => {
            if (frame.contentDocument !== loaded) return;
            const height = Math.ceil(loaded.querySelector('.publication-page')!.getBoundingClientRect().height);
            setSize(current => height === current.height ? current : { ...current, height });
          });
        }} />}
    </div>
  </div>;
}
