import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, RotateCcw, Trash2, Upload, SquarePlus } from 'lucide-react';
import { t } from '../i18n/locale.ts';
import { localizePublicationError } from '../i18n/publicationError.ts';
import { parsePublicationOptions, defaultPublicationImageCrop, type PublicationImageCrop, type PublicationOptions } from '../domain/publicationTypes.ts';
import { publicationImagePages } from '../domain/publicationImagePages.ts';
import { publicationImageFromBlob } from '../state/publicationSource.ts';
import type { PublicationImagesWorkspace, PublicationWorkspaceImage } from '../state/usePublicationImages.ts';
import { useResearchMediaSource } from './useResearchMediaSource.ts';
import { imageHeaderInfo } from '../domain/researchMediaFormats.ts';
import sampleImage from '../../docs/wiki/assets/showcase-image.png?url';
import './PublicationImageWorkspace.css';
import PublicationCompositionCanvas from './PublicationCompositionCanvas.tsx';
import type { CompositionEditor } from '../state/useCompositionEditor.ts';
import { compositionBatchInputs } from '../state/useCompositionLibrary.ts';
import { publicationFontCss, type PublicationFont } from '../domain/researchFonts.ts';
import { type CompositionIssue } from '../domain/publicationCompositionLayout.ts';
import { resolveComposition } from '../domain/publicationComposition.ts';
import sansCss from '@fontsource-variable/noto-sans-sc/index.css?inline';
import serifCss from '@fontsource-variable/noto-serif-sc/index.css?inline';
const emptyFonts: PublicationFont[] = [];
function imagePreviewMarkup(optionsKey: string, previewId: string, loadedId: string, loadedUrl: string, imageDataKey: string | undefined, cropKey: string, fontCss: string) {
  try {
    const checked = parsePublicationOptions(JSON.parse(optionsKey));
    const imageData = imageDataKey ? JSON.parse(imageDataKey) : undefined;
    const html = loadedId === previewId && loadedUrl ? publicationImagePages({ title: '', text: '', blocks: [{ id: previewId, kind: 'image', content: loadedUrl, crop: JSON.parse(cropKey), ...(imageData ? { imageData } : {}) }] }, checked, fontCss).html.replace('font-src https://mewiki-publication.invalid data:', `font-src ${location.origin} data:`) : '';
    return { html, options: checked, scene: checked.composition ? resolveComposition(checked.composition, imageData?.overrides) : undefined, error: '' };
  } catch (cause) { return { html: '', options: undefined, scene: undefined, error: cause instanceof Error ? cause.message : '样板暂时无法显示，请检查导出设置。' }; }
}
function useImagePreviewMarkup(optionsKey: string, previewId: string, loadedId: string, loadedUrl: string, imageDataKey: string | undefined, cropKey: string, fontCss: string) {
  return useMemo(() => imagePreviewMarkup(optionsKey, previewId, loadedId, loadedUrl, imageDataKey, cropKey, fontCss), [optionsKey, previewId, loadedId, loadedUrl, imageDataKey, cropKey, fontCss]);
}

function NoteThumbnail({ item }: { item: PublicationWorkspaceImage }) {
  const media = useResearchMediaSource(item.noteImage!.source);
  const asset = media.asset;
  const original = asset && asset.size <= 8 * 1024 * 1024 && asset.width && asset.height && asset.width * asset.height <= 16_000_000 ? media.originalUrl : undefined;
  const url = media.previewUrl || original;
  return url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <ImageIcon size={26} aria-hidden="true" />;
}
function FileThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      let bitmap: ImageBitmap | undefined;
      try {
        const header = imageHeaderInfo(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
        if (!active || !header.width || !header.height || header.width * header.height > 16_000_000) return;
        const scale = Math.min(1, 240 / Math.max(header.width, header.height));
        const width = Math.max(1, Math.round(header.width * scale)), height = Math.max(1, Math.round(header.height * scale));
        bitmap = await createImageBitmap(file, { resizeWidth: width, resizeHeight: height });
        if (!active) return;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d'); if (!context) return;
        context.drawImage(bitmap, 0, 0); const value = canvas.toDataURL('image/png'); canvas.width = 0; canvas.height = 0;
        if (active) setUrl(value);
      } catch { /* The selected source reports its decoding error in the main preview. */ }
      finally { bitmap?.close(); }
    })();
    return () => { active = false; };
  }, [file]);
  return url ? <img src={url} alt="" loading="lazy" /> : <ImageIcon size={26} aria-hidden="true" />;
}
function Thumbnail({ item }: { item: PublicationWorkspaceImage }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } });
    observer.observe(ref.current!); return () => observer.disconnect();
  }, []);
  return <span className="mewiki-publication-image-thumb-content" ref={ref}>{visible ? item.file ? <FileThumbnail file={item.file} /> : item.noteImage ? <NoteThumbnail item={item} /> : <SavedThumbnail item={item} /> : <ImageIcon size={26} aria-hidden="true" />}</span>;
}
function SavedThumbnail({ item }: { item: PublicationWorkspaceImage }) {
  const [file, setFile] = useState<File>();
  useEffect(() => { const abort = new AbortController(); void item.load(abort.signal).then(url => fetch(url).then(response => response.blob())).then(blob => { if (!abort.signal.aborted) setFile(new File([blob], item.name)); }).catch(() => {}); return () => abort.abort(); }, [item]);
  return file ? <FileThumbnail file={file} /> : <ImageIcon size={26} aria-hidden="true" />;
}

export default function PublicationImageWorkspace({ workspace, options, showPicker, disabled, editor, fonts = emptyFonts, onEdit }: { workspace: PublicationImagesWorkspace; options: PublicationOptions; showPicker: boolean; disabled: boolean; editor?: CompositionEditor; fonts?: PublicationFont[]; onEdit?: () => void }) {
  const { items, selected, selectedIds } = workspace;
  const current = workspace.current ? { ...workspace.current, crop: editor?.items[workspace.current.id]?.crop ?? workspace.current.crop } : undefined;
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState({ id: '', url: '' });
  const [loading, setLoading] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(600);
  const [cropMode, setCropMode] = useState(!editor);
  const [issues, setIssues] = useState<CompositionIssue[]>([]);
  const container = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLDivElement>(null);
  const crop = current?.crop ?? defaultPublicationImageCrop();
  const currentLoad = current?.load;
  const fit = options.imageMode!.fit;
  const previewId = current?.id ?? 'sample';
  const currentIndex = current ? selected.findIndex(item => item.id === current.id) : -1;
  const currentInput = current && editor ? compositionBatchInputs(workspace, editor).find(item => item.id === current.id) : undefined;
  const imageDataKey = JSON.stringify(currentInput?.imageData);
  const cropKey = JSON.stringify(crop);
  const optionsKey = JSON.stringify(options);
  const loadedId = loaded.id, loadedUrl = loaded.url;
  const fontCss = useMemo(() => [sansCss, serifCss, ...fonts.map(font => publicationFontCss({ ...font }))].join('\n'), [fonts]);
  useEffect(() => {
    const element = container.current!;
    const resize = () => { const style = getComputedStyle(element); setAvailableWidth(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (abort.signal.aborted) return;
      setLoading(true); setError(''); setLoaded({ id: '', url: '' });
      try {
        const url = currentLoad ? await currentLoad(abort.signal) : await publicationImageFromBlob(await (await fetch(sampleImage, { signal: abort.signal })).blob(), abort.signal);
        if (!abort.signal.aborted) setLoaded({ id: previewId, url });
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '图片读取失败，请重新选择本地图片。'); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    })();
    return () => abort.abort();
  }, [previewId, currentLoad]);
  const markup = useImagePreviewMarkup(optionsKey, previewId, loadedId, loadedUrl, imageDataKey, cropKey, fontCss);
  const scale = Math.min(1, Math.max(1, availableWidth - 2) / options.width);
  const perform = (action: () => void) => { try { action(); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '图片读取失败，请重新选择本地图片。'); } };
  const changeCrop = (value: PublicationImageCrop) => { if (current && !disabled) { if (editor) editor.setItem(current.id, { crop: value }); else workspace.crop(current.id, value); } };
  const imageName = (item: PublicationWorkspaceImage, index: number) => item.name || t`图片 ${index + 1}`;
  const showError = markup.error || error;
  useEffect(() => {
    const rail = album.current, card = rail?.querySelector<HTMLElement>('[data-current="true"]');
    if (!rail || !card) return;
    const bounds = rail.getBoundingClientRect(), current = card.getBoundingClientRect();
    if (current.right > bounds.right) rail.scrollLeft += current.right - bounds.right + 4;
    else if (current.left < bounds.left) rail.scrollLeft -= bounds.left - current.left + 4;
  }, [workspace.current?.id, showPicker]);
  return <div className="mewiki-publication-images">
    <div ref={container} className="mewiki-publication-image-stage" role="region" aria-label={t('图片画布')}>
    <div className="mewiki-publication-image-actions" role="toolbar" aria-label={t('图片预览工具栏')}>
      <button type="button" data-ui="icon-action" aria-label={t('上一张图片')} title={t('上一张图片')} disabled={disabled || currentIndex <= 0} onClick={() => workspace.setCurrentId(selected[currentIndex - 1].id)}><ChevronLeft size={16} /></button>
      <span title={current?.name}>{current ? `${currentIndex + 1} / ${selected.length} · ${imageName(current, items.findIndex(item => item.id === current.id))}` : t('示例图片（不参与导出）')}</span>
      <button type="button" data-ui="icon-action" aria-label={t('下一张图片')} title={t('下一张图片')} disabled={disabled || currentIndex < 0 || currentIndex >= selected.length - 1} onClick={() => workspace.setCurrentId(selected[currentIndex + 1].id)}><ChevronRight size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('重置当前图片取景')} title={t('重置当前图片取景')} disabled={disabled || !current || fit !== 'cover'} onClick={() => changeCrop(defaultPublicationImageCrop())}><RotateCcw size={16} /></button>
      {editor && <button type="button" data-ui="icon-action" aria-label={t('切换主图取景')} title={t('切换主图取景')} aria-pressed={cropMode} disabled={disabled || !current || fit !== 'cover'} onClick={() => setCropMode(value => !value)}><ImageIcon size={16} /></button>}
    </div>
    {!!showError && <p role="alert" className="mewiki-publication-error">{localizePublicationError(showError)}</p>}
    {loading && <p role="status">{t('正在读取图片…')}</p>}
    {!!issues.length && <div role="status" className="mewiki-composition-issues">{issues.slice(0, 8).map((issue, index) => <button key={`${issue.layerId}-${index}`} type="button" onClick={() => { editor?.select(issue.layerId); setCropMode(false); onEdit?.(); }}>{t`第 ${issue.index} 张 · 第 ${issue.layerIndex + 1} 个图层`}：{t(issue.reason === 'outside' ? '图层超出画布或设备屏幕，请调整位置或大小。' : '文字超出文字框，请增大文字框、缩小字号或缩短文字。')}</button>)}</div>}
    {!showError && markup.html && markup.options && <PublicationCompositionCanvas html={markup.html} options={markup.options} scene={markup.scene} editor={editor} currentId={current?.id} crop={crop} scale={scale} disabled={disabled} cropMode={cropMode} onCrop={changeCrop} onIssues={setIssues} onEdit={id => { onEdit?.(); if (id === '$subject' && current && fit === 'cover') setCropMode(true); else { setCropMode(false); editor?.editText(id); } }} />}
    {current && fit === 'cover' && <fieldset className="mewiki-publication-image-crop-controls" disabled={disabled} aria-label={t('当前图片取景设置')}>
      <label>{t('图片缩放')} · {crop.zoom}%<input aria-label={t('图片缩放')} type="range" min={100} max={300} value={crop.zoom} onChange={event => changeCrop({ ...crop, zoom: Number(event.target.value) })} /></label>
      <label>{t('水平位置')}<input type="range" min={0} max={100} value={crop.x} onChange={event => changeCrop({ ...crop, x: Number(event.target.value) })} /></label>
      <label>{t('垂直位置')}<input type="range" min={0} max={100} value={crop.y} onChange={event => changeCrop({ ...crop, y: Number(event.target.value) })} /></label>
    </fieldset>}
    </div>
    {showPicker && <section className="mewiki-publication-image-picker" aria-label={t('选择图片')}>
      <div className="mewiki-publication-image-actions" role="toolbar" aria-label={t('图片选择工具栏')}>
        <label><input type="checkbox" aria-label={t('全选图片')} checked={!!items.length && selected.length === items.length} disabled={disabled || !items.length} onChange={event => perform(() => workspace.all(event.target.checked))} />{t('全选')}</label>
        <span aria-label={t`已选择 ${selected.length} 张图片`}>{selected.length} / {items.length}</span>
        <button type="button" data-ui="icon-action" aria-label={t('从电脑添加图片')} title={t('从电脑添加图片')} disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={16} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('添加空白画布')} title={t('添加空白画布')} disabled={disabled} onClick={() => { void workspace.addBlank().catch(cause => setError(cause.message)); }}><SquarePlus size={16} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('清空图片选择')} title={t('清空图片选择')} disabled={disabled || !selected.length} onClick={() => workspace.all(false)}><Trash2 size={16} /></button>
      </div>
      <input ref={fileInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={t('添加本地图片')} disabled={disabled} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; perform(() => workspace.addFiles(files)); }} />
      <div ref={album} className="mewiki-publication-image-album" role="region" aria-label={t('图片相册')} tabIndex={disabled ? -1 : 0} onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const rail = event.currentTarget;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); rail.scrollLeft = event.key === 'Home' ? 0 : event.key === 'End' ? rail.scrollWidth : rail.scrollLeft + (event.key === 'ArrowLeft' ? -160 : 160);
      }}>
        {!items.length && <p className="mewiki-publication-empty">{t('尚未添加图片')}</p>}
        {items.map((item, index) => <div key={item.id} className="mewiki-publication-image-card" data-selected={selectedIds.has(item.id)} data-current={current?.id === item.id}>
          <button type="button" className="mewiki-publication-image-thumb" data-ui="image-preview" disabled={disabled} aria-label={t`预览图片：${imageName(item, index)}`} onClick={() => perform(() => { if (!selectedIds.has(item.id)) workspace.select(item.id, true); workspace.setCurrentId(item.id); })}><Thumbnail item={item} /></button>
          <label title={item.noteImage?.location.join(' / ') || t(item.file ? '本地图片' : '设计素材')}><input type="checkbox" disabled={disabled} checked={selectedIds.has(item.id)} aria-label={t`导出图片：${imageName(item, index)}`} onChange={event => perform(() => workspace.select(item.id, event.target.checked))} /><span title={imageName(item, index)}>{imageName(item, index)}</span></label>
          {selectedIds.has(item.id) && <span className="mewiki-publication-image-order" aria-hidden="true">{selected.findIndex(value => value.id === item.id) + 1}</span>}
          {!item.noteImage && <button type="button" data-ui="icon-action" className="mewiki-publication-image-remove" disabled={disabled} aria-label={t`移除图片：${item.name}`} title={t('移除图片')} onClick={() => workspace.remove(item.id)}><Trash2 size={13} /></button>}
        </div>)}
      </div>
    </section>}
    {!showPicker && editor && !!selected.length && <div className="mewiki-composition-filmstrip" aria-label={t('批次图片')}>
      {selected.map((item, index) => <button key={item.id} type="button" data-ui="image-preview" data-current={item.id === current?.id} aria-label={t`切换到第 ${index + 1} 张图片`} disabled={disabled} onClick={() => workspace.setCurrentId(item.id)}><Thumbnail item={item} /><span>{index + 1} · {imageName(item, index)}</span>{editor.items[item.id]?.overrides && <small>{t('已单独调整')}</small>}</button>)}
    </div>}
  </div>;
}
