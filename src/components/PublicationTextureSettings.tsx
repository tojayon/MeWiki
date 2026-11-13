import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { t, localizeError } from '../i18n/locale.ts';
import { defaultPublicationTexture, nextTextureSeed, publicationTextureBackground, publicationTextureLayers, publicationTexturePresets, PUBLICATION_MAX_TEXTURE_LAYERS, type PublicationTexture, type PublicationTexturePreset } from '../domain/publicationTextures.ts';
import { textureCrop, type TextureImageMode } from '../domain/publicationTexturePixels.ts';
import { createTextureCandidates, readTextureSource, type TextureCropSettings, type TextureSource } from '../state/publicationTextureImage.ts';
import './PublicationTextureSettings.css';

const initialCrop: TextureCropSettings = { size: 70, x: 50, y: 50, flatten: true, seamless: true };
export default function PublicationTextureSettings({ value, layers, background, cover, imageMode = false, disabled, onChange }: {
  value?: PublicationTexture; layers?: PublicationTexture[]; background: string; cover: boolean; imageMode?: boolean; disabled: boolean; onChange: (layers: PublicationTexture[]) => void;
}) {
  const configured = publicationTextureLayers({ texture: value, textureLayers: layers });
  const stack = configured.length ? configured : [defaultPublicationTexture()];
  const [selected, setSelected] = useState(0), [editorVersion, setEditorVersion] = useState(0);
  const active = Math.min(selected, stack.length - 1);
  const select = (index: number) => { setSelected(index); setEditorVersion(current => current + 1); };
  const move = (offset: number) => {
    const target = active + offset;
    if (target < 0 || target >= stack.length || disabled) return;
    const next = [...stack]; [next[active], next[target]] = [next[target], next[active]];
    onChange(next); select(target);
  };
  return <section className="mewiki-publication-texture" aria-labelledby="publication-texture-heading">
    <div className="mewiki-texture-heading"><h3 id="publication-texture-heading">{t('笔记背景纹理')}</h3>
      <div className="mewiki-texture-layer-actions" role="toolbar" aria-label={t('纹理图层操作')}>
        <button type="button" data-ui="icon-action" aria-label={t('添加纹理图层')} title={t('添加纹理图层')} disabled={disabled || stack.length >= PUBLICATION_MAX_TEXTURE_LAYERS} onClick={() => {
          const existing = stack.length === 1 && stack[0].kind === 'none' ? [] : stack;
          onChange([defaultPublicationTexture('paper'), ...existing]); select(0);
        }}><Plus size={15} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('上移纹理图层')} title={t('上移纹理图层')} disabled={disabled || !active} onClick={() => move(-1)}><ArrowUp size={15} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('下移纹理图层')} title={t('下移纹理图层')} disabled={disabled || active === stack.length - 1} onClick={() => move(1)}><ArrowDown size={15} /></button>
        <button type="button" data-ui="icon-action" aria-label={t('移除纹理图层')} title={t('移除纹理图层')} disabled={disabled || !configured.length} onClick={() => { onChange(stack.filter((_, index) => index !== active)); select(Math.max(0, active - 1)); }}><Trash2 size={15} /></button>
      </div>
    </div>
    <div className="mewiki-texture-layers" role="group" aria-label={t('纹理图层列表')}>
      {stack.map((texture, index) => {
        const name = t(texture.kind === 'none' ? '无纹理' : texture.kind === 'custom' ? '自定义图片纹理' : publicationTexturePresets.find(preset => preset.id === texture.kind)!.name);
        return <button key={index} type="button" data-ui="menu-action" aria-label={t`编辑纹理图层 ${index + 1}：${name}`} aria-pressed={index === active} disabled={disabled} onClick={() => { if (index !== active) select(index); }}><span className="mewiki-texture-layer-number">{index + 1}</span><span>{name}</span></button>;
      })}
    </div>
    {!imageMode && <p className="mewiki-publication-hint">{t('上方图层显示在前，最多叠加 6 层。选择图层后调整其参数。')}</p>}
    <PublicationTextureLayerEditor key={editorVersion} value={stack[active]} background={background} cover={cover} imageMode={imageMode} disabled={disabled} onChange={texture => onChange(stack.map((layer, index) => index === active ? texture : layer))} />
  </section>;
}

function PublicationTextureLayerEditor({ value, background, cover, imageMode, disabled, onChange }: {
  value?: PublicationTexture; background: string; cover: boolean; imageMode: boolean; disabled: boolean; onChange: (texture: PublicationTexture) => void;
}) {
  const texture = value ?? defaultPublicationTexture();
  const [variants, setVariants] = useState<PublicationTexture[]>([]);
  const [source, setSource] = useState<TextureSource | null>(null);
  const [crop, setCrop] = useState(initialCrop);
  const [candidates, setCandidates] = useState<{ mode: TextureImageMode; image: string }[]>([]);
  const [processing, setProcessing] = useState(false), [error, setError] = useState('');
  const work = useRef<AbortController | null>(null), current = useRef(value), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const cancel = () => { alive.current = false; work.current?.abort(); };
    window.addEventListener('pagehide', cancel);
    return () => { window.removeEventListener('pagehide', cancel); cancel(); };
  }, []);
  useLayoutEffect(() => { current.current = value; if (disabled) work.current?.abort(); }, [value, disabled]);
  const cancelEditor = () => { work.current?.abort(); setSource(null); setCandidates([]); setProcessing(false); setError(''); };
  const change = <K extends keyof PublicationTexture>(key: K, setting: PublicationTexture[K]) => { setVariants([]); onChange({ ...texture, [key]: setting }); };
  const run = async (action: (signal: AbortSignal, valid: () => boolean) => Promise<void>) => {
    work.current?.abort(); const abort = new AbortController(); work.current = abort;
    const before = current.current;
    const valid = () => alive.current && !abort.signal.aborted && current.current === before;
    setProcessing(true); setError('');
    try { await action(abort.signal, valid); }
    catch (cause) { if (valid()) setError(cause instanceof Error ? cause.message : '无法处理纹理图片。'); }
    finally { if (alive.current && work.current === abort) setProcessing(false); }
  };
  const cropChange = (key: 'size' | 'x' | 'y', value: number) => { work.current?.abort(); setProcessing(false); setCandidates([]); setCrop(current => ({ ...current, [key]: value })); };
  const cropArea = source ? textureCrop(source.image.naturalWidth, source.image.naturalHeight, crop.size, crop.x, crop.y) : null;
  const active = texture.kind !== 'none';
  return <div className="mewiki-publication-texture-editor">
    <label>{t('纹理预设')}<select value={texture.kind} onChange={event => {
      cancelEditor(); setVariants([]);
      onChange(defaultPublicationTexture(event.target.value as PublicationTexturePreset | 'none'));
    }}>
      <option value="none">{t('无纹理')}</option>
      {publicationTexturePresets.map(preset => <option key={preset.id} value={preset.id}>{t(preset.name)}</option>)}
      {texture.kind === 'custom' && <option value="custom">{t('自定义图片纹理')}</option>}
    </select></label>
    {active && <>
      <div className="mewiki-publication-fields">
        {texture.kind !== 'custom' && <label>{t('纹理颜色')}<input type="color" value={texture.color} onChange={event => change('color', event.target.value)} /></label>}
        <label>{t('纹理强度')} · {texture.opacity}%<input aria-label={t('纹理强度')} type="range" min={0} max={50} value={texture.opacity} onChange={event => change('opacity', Number(event.target.value))} /></label>
        {!(texture.kind === 'custom' && texture.fit === 'cover') && <label>{t('纹理大小')} · {texture.scale}%<input aria-label={t('纹理大小')} type="range" min={50} max={200} step={5} value={texture.scale} onChange={event => change('scale', Number(event.target.value))} /></label>}
        {texture.kind !== 'custom' && <label>{t('纹理质感')}<select value={texture.character} onChange={event => change('character', event.target.value as PublicationTexture['character'])}><option value="fine">{t('细腻')}</option><option value="natural">{t('自然')}</option><option value="rough">{t('粗粝')}</option></select></label>}
        {texture.kind === 'custom' && <label>{t('纹理铺放')}<select value={texture.fit} onChange={event => change('fit', event.target.value as PublicationTexture['fit'])}><option value="tile">{t('重复平铺')}</option><option value="cover">{t('整页铺满')}</option></select></label>}
      </div>
      {texture.kind !== 'custom' && <>
        <button type="button" onClick={() => { setVariants(Array.from({ length: 3 }, () => ({ ...texture, seed: nextTextureSeed() }))); }}><Shuffle size={14} aria-hidden="true" />{t('生成三个变体')}</button>
        {!!variants.length && <div className="mewiki-texture-candidates" role="group" aria-label={t('纹理变体候选')}>{variants.map((candidate, index) => <button key={candidate.seed} type="button" aria-label={t`应用变体 ${index + 1}`} aria-pressed={texture.seed === candidate.seed} onClick={() => onChange(candidate)}>
          <span className="mewiki-texture-swatch" style={{ backgroundColor: background }}><span style={publicationTextureBackground(candidate)} /></span><span>{t`变体 ${index + 1}`}</span>
        </button>)}</div>}
      </>}
      <details className="mewiki-publication-dimensions"><summary>{t('纹理位置与范围')}</summary>
        {['fiber', 'dots', 'grid', 'ruled', 'linen'].includes(texture.kind) && <label>{t('纹理方向')} · {texture.rotation}°<input aria-label={t('纹理方向')} type="range" min={0} max={180} step={15} value={texture.rotation} onChange={event => change('rotation', Number(event.target.value))} /></label>}
        {!imageMode && <label>{t('纹理应用范围')}<select value={texture.scope} onChange={event => change('scope', event.target.value as PublicationTexture['scope'])}><option value="all">{t('全部页面')}</option><option value="body">{t('仅正文页')}</option><option value="cover">{t('仅封面')}</option><option value="margins">{t('仅页面内边距')}</option></select></label>}
        {!imageMode && texture.scope === 'cover' && !cover && <p className="mewiki-publication-hint">{t('仅封面需要在“内容”中开启“单独生成封面”。')}</p>}
        {!imageMode && texture.scope === 'margins' && <p className="mewiki-publication-hint">{t('只铺在四周页面留白，宽度跟随“页面留白”；中央正文区域不铺纹理。')}</p>}
      </details>
    </>}
    <details className="mewiki-publication-dimensions mewiki-texture-image-editor"><summary>{t('从本地图片制作纹理')}</summary>
      <label>{t('上传纹理图片')}<input type="file" accept="image/png,image/jpeg" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        void run(async (signal, valid) => { const next = await readTextureSource(file, signal); if (valid()) { setSource(next); setCrop(initialCrop); setCandidates([]); } });
      }} /></label>
      <p className="mewiki-publication-hint">{t('图片仅在本地处理。先选取干净区域，生成候选后点击应用；上传不会替换当前纹理。')}</p>
      {source && cropArea && <>
        <div className="mewiki-texture-crop" style={{ maxWidth: Math.min(340, 280 * source.image.naturalWidth / source.image.naturalHeight) }}><img src={source.dataUrl} alt={t('纹理裁切原图')} /><span aria-hidden="true" style={{ left: `${cropArea.x / source.image.naturalWidth * 100}%`, top: `${cropArea.y / source.image.naturalHeight * 100}%`, width: `${cropArea.size / source.image.naturalWidth * 100}%`, height: `${cropArea.size / source.image.naturalHeight * 100}%` }} /></div>
        <label>{t('裁切区域大小')} · {crop.size}%<input aria-label={t('裁切区域大小')} type="range" min={20} max={100} value={crop.size} onChange={event => cropChange('size', Number(event.target.value))} /></label>
        <div className="mewiki-publication-fields">
          <label>{t('裁切水平位置')}<input type="range" min={0} max={100} value={crop.x} onChange={event => cropChange('x', Number(event.target.value))} /></label>
          <label>{t('裁切垂直位置')}<input type="range" min={0} max={100} value={crop.y} onChange={event => cropChange('y', Number(event.target.value))} /></label>
        </div>
        <label className="mewiki-publication-check"><input type="checkbox" checked={crop.flatten} disabled={processing} onChange={event => { setCandidates([]); setCrop(current => ({ ...current, flatten: event.target.checked })); }} />{t('弱化光照不均')}</label>
        <label className="mewiki-publication-check"><input type="checkbox" checked={crop.seamless} disabled={processing} onChange={event => { setCandidates([]); setCrop(current => ({ ...current, seamless: event.target.checked })); }} />{t('镜像柔化平铺接缝')}</label>
        <div className="mewiki-texture-editor-actions"><button type="button" disabled={processing} onClick={() => void run(async (signal, valid) => { const next = await createTextureCandidates(source, crop, background, signal); if (valid()) setCandidates(next); })}>{t('生成处理候选')}</button>
          <button type="button" data-ui="icon-action" aria-label={t('取消图片制纹理')} title={t('取消图片制纹理')} onClick={cancelEditor}><X size={16} /></button></div>
        {!!candidates.length && <div className="mewiki-texture-candidates" role="group" aria-label={t('图片纹理候选')}>{candidates.map(candidate => <button type="button" key={candidate.mode} aria-pressed={texture.kind === 'custom' && texture.image === candidate.image} onClick={() => { setVariants([]); onChange({ ...texture, kind: 'custom', image: candidate.image, seed: 1, rotation: 0, opacity: texture.opacity || 18 }); }}>
          <span className="mewiki-texture-swatch" style={{ backgroundColor: background }}><span style={publicationTextureBackground({ ...texture, kind: 'custom', image: candidate.image, opacity: texture.opacity || 18 })} /></span>
          <span>{t(candidate.mode === 'original' ? '保留原色' : candidate.mode === 'gray' ? '灰度纹理' : '跟随背景色')}</span>
        </button>)}</div>}
      </>}
      {processing && !disabled && <p role="status" className="mewiki-publication-hint">{t('正在本地处理纹理…')}</p>}
      {!!error && <p role="alert" className="mewiki-publication-error">{localizeError(error)}</p>}
    </details>
    {!imageMode && <p className="mewiki-publication-hint">{t('纹理随个人模板保存。建议保持低强度，让正文清晰可读。')}</p>}
  </div>;
}
