import { ArrowDown, ArrowUp, ChevronRight, Copy, Eye, EyeOff, Lock, Unlock, RotateCcw, Trash2, Type, Sticker, ImagePlus, Upload, Undo2, Redo2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { t } from '../i18n/locale.ts';
import { compositionStickers, type CompositionLayer } from '../domain/publicationComposition.ts';
import type { CompositionEditor } from '../state/useCompositionEditor.ts';
import type { ResearchMediaAsset } from '../domain/researchMedia.ts';
import type { PublicationImagesWorkspace } from '../state/usePublicationImages.ts';
import { publicationImageFromBlob } from '../state/publicationSource.ts';
import { imageWorkspaceClient } from '../state/imageWorkspaceClient.ts';
import type { PersonalSticker } from '../domain/imageWorkspace.ts';

const fieldLabels = { x: '水平（%）', y: '垂直（%）', width: '宽度（%）', height: '高度（%）', rotation: '旋转', opacity: '不透明度', fontSize: '字号（%）', lineHeight: '行距', letterSpacing: '字距', padding: '内边距', radius: '圆角' };
export default function PublicationCompositionPanel({ editor, workspace, fonts, libraryId, pluginId, disabled, hidden, onClose, onFont, onError, stickers, onSticker, onRemoveSticker }: {
  editor: CompositionEditor; workspace: PublicationImagesWorkspace; fonts: ResearchMediaAsset[]; libraryId: string; pluginId: string; disabled: boolean; hidden: boolean; onClose: () => void; onFont: () => void; onError: (error: string) => void; stickers: PersonalSticker[]; onSticker: (name: string, image: string) => Promise<void>; onRemoveSticker: (id: string) => Promise<void>;
}) {
  const currentId = workspace.current?.id, effective = editor.effective(currentId), selected = effective.layers.find(layer => layer.id === editor.selectedId);
  const upload = useRef<HTMLInputElement>(null), localAbort = useRef<AbortController | null>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const attributes = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (editor.textFocus && !hidden) { if (attributes.current) attributes.current.open = true; textInput.current?.focus(); textInput.current?.select(); } }, [editor.textFocus, hidden]);
  useEffect(() => () => localAbort.current?.abort(), []);
  const all = editor.scope === 'all', subject = effective.subject;
  const patch = (value: Partial<CompositionLayer>) => { if (selected) editor.patchLayer(selected.id, value, currentId); };
  const field = (key: keyof typeof fieldLabels, label: string, min: number, max: number, step = .5) => <label>{t(fieldLabels[key])}<input type="number" aria-label={t(label)} title={t(label)} value={selected![key]} min={min} max={max} step={step} onChange={event => patch({ [key]: Number(event.target.value) })} /></label>;
  const add = (type: CompositionLayer['type'], patch: Partial<CompositionLayer> = {}) => { if (editor.scene.layers.length >= 40) { onError(t('每个画布最多 40 个图层。')); return; } editor.add(type, currentId, patch); };
  const handle = async (file: File) => {
    const controller = new AbortController(); localAbort.current?.abort(); localAbort.current = controller;
    try { const image = await publicationImageFromBlob(file, controller.signal); if (image.length > 3 * 1024 * 1024) throw new Error('装饰图片过大，请缩小到 2 MiB 以内。'); add('image', { image, name: file.name.slice(0, 80) }); }
    catch (cause) { if (!controller.signal.aborted) onError(cause instanceof Error ? cause.message : '图片读取失败，请重新选择本地图片。'); }
  };
  return <aside id="publication-composition-panel" className="mewiki-composition-properties" aria-label={t('画布编辑与图层属性')} hidden={hidden}>
    <header className="mewiki-publication-toolbar mewiki-composition-toolbar" role="toolbar" aria-label={t('画布编辑工具栏')}>
      <button type="button" data-ui="icon-action" aria-label={t('添加文字')} title={t('添加文字')} disabled={disabled} onClick={() => add('text', { name: t('文字'), text: t('在这里输入文字') })}><Type size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('添加贴纸')} title={t('添加贴纸')} disabled={disabled} onClick={() => add('sticker', { name: t('贴纸') })}><Sticker size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('添加装饰图片')} title={t('添加装饰图片')} disabled={disabled} onClick={() => upload.current?.click()}><ImagePlus size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('撤销画布操作')} title={t('撤销画布操作')} disabled={disabled || !editor.canUndo} onClick={editor.undo}><Undo2 size={16} /></button>
      <button type="button" data-ui="icon-action" aria-label={t('重做画布操作')} title={t('重做画布操作')} disabled={disabled || !editor.canRedo} onClick={editor.redo}><Redo2 size={16} /></button>
      <button type="button" data-ui="icon-action" className="mewiki-composition-panel-close" aria-label={t('收起图层面板')} title={t('收起图层面板')} onClick={onClose}><X size={16} /></button>
    </header>
    <input ref={upload} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={t('上传装饰图片')} disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handle(file); }} />
    <div className="mewiki-composition-properties-content">
    <details className="mewiki-publication-settings-section" open>
      <summary><ChevronRight size={16} aria-hidden="true" /><span>{t('图层')}</span></summary>
    <fieldset disabled={disabled}>
      <div className="mewiki-composition-scope"><select aria-label={t('编辑范围')} title={t('编辑范围')} value={editor.scope} onChange={event => editor.setScope(event.target.value as 'all' | 'current')}><option value="all">{t('全部图片')}</option><option value="current" disabled={!currentId}>{t('当前图片')}</option></select>
      {!!currentId && editor.items[currentId]?.overrides && <button type="button" data-ui="icon-action" aria-label={t('恢复当前图片的共用设置')} title={t('恢复当前图片的共用设置')} onClick={() => editor.resetItem(currentId)}><RotateCcw size={14} /></button>}</div>
      <div className="mewiki-composition-layer-list" aria-label={t('图层列表')}>
        {[...effective.layers].reverse().map(layer => <div key={layer.id} data-current={layer.id === editor.selectedId}>
          <button type="button" data-ui="layer-select" aria-label={t`选择图层：${layer.name || t('图层')}`} onClick={() => editor.select(layer.id)}>{layer.name || t('图层')}{layer.space === 'screen' ? ` · ${t('屏幕内')}` : ''}</button>
          {layer.localOnly && <small title={t('此图层只属于当前图片，不会保存到个人模板。')}>{t('仅本图')}</small>}
          <button type="button" data-ui="icon-action" aria-label={layer.hidden ? t('显示图层') : t('隐藏图层')} title={layer.hidden ? t('显示图层') : t('隐藏图层')} onClick={() => editor.patchLayer(layer.id, { hidden: !layer.hidden }, currentId)}>{layer.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          <button type="button" data-ui="icon-action" aria-label={layer.locked ? t('解锁图层') : t('锁定图层')} title={layer.locked ? t('解锁图层') : t('锁定图层')} onClick={() => editor.patchLayer(layer.id, { locked: !layer.locked }, currentId)}>{layer.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
        </div>)}
        <div data-current={editor.selectedId === '$subject'}><button type="button" data-ui="layer-select" onClick={() => editor.select('$subject')}>{t('设备与主图')}</button><button type="button" data-ui="icon-action" aria-label={t('切换主体显示')} onClick={() => editor.patchSubject({ hidden: !subject.hidden }, currentId)}>{subject.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button><button type="button" data-ui="icon-action" aria-label={subject.locked ? t('解锁主体') : t('锁定主体')} onClick={() => editor.patchSubject({ locked: !subject.locked }, currentId)}>{subject.locked ? <Lock size={14} /> : <Unlock size={14} />}</button></div>
      </div>
    </fieldset>
    </details>
    <details key={editor.selectedId} ref={attributes} className="mewiki-publication-settings-section" open>
      <summary><ChevronRight size={16} aria-hidden="true" /><span>{t('属性')}</span></summary>
    <fieldset disabled={disabled}>
      {selected ? <>
        <label>{t('名称')}<input aria-label={t('图层名称')} maxLength={80} value={selected.name} onChange={event => patch({ name: event.target.value })} /></label>
        <label>{t('位置')}<select aria-label={t('图层位置')} value={selected.space} onChange={event => patch({ space: event.target.value as 'canvas' | 'screen' })}><option value="canvas">{t('画布上')}</option><option value="screen">{t('设备屏幕内')}</option></select></label>
        <fieldset disabled={selected.locked}>
        {selected.type !== 'image' && <><label>{t('文字')}<textarea ref={textInput} aria-label={t('图层文字')} rows={3} maxLength={4000} value={selected.text} onChange={event => patch({ text: event.target.value })} /></label>
          <select className="mewiki-composition-variables" aria-label={t('插入变量')} value="" onChange={event => { if (event.target.value) patch({ text: selected.text + `{{${event.target.value}}}` }); }}><option value="">{t('插入变量')}</option>{[['title', '本图标题'], ['subtitle', '本图副标题'], ['name', '图片名称'], ['index', '图片序号'], ['total', '图片总数']].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></>}
        {selected.type === 'sticker' && <label>{t('样式')}<select aria-label={t('系统贴纸')} value={selected.sticker} onChange={event => patch({ sticker: event.target.value as CompositionLayer['sticker'] })}>{compositionStickers.map((sticker, index) => <option key={sticker} value={sticker}>{t(['箭头', '圆圈', '重点标签', '对话气泡', '星形', '编号圆点'][index])}</option>)}</select></label>}
        {selected.type === 'text' && <><div className="mewiki-composition-font"><label>{t('字体')}<select aria-label={t('文字字体')} value={selected.fontAssetId ? `font:${selected.fontAssetId}` : selected.fontFamily} onChange={event => patch(event.target.value.startsWith('font:') ? { fontAssetId: event.target.value.slice(5) } : { fontFamily: event.target.value as 'sans' | 'serif', fontAssetId: '' })}><option value="sans">{t('思源风格黑体')}</option><option value="serif">{t('思源风格宋体')}</option>{fonts.map(font => <option key={font.id} value={`font:${font.id}`}>{font.name}</option>)}{selected.fontAssetId && !fonts.some(font => font.id === selected.fontAssetId) && <option value={`font:${selected.fontAssetId}`}>{t('所选字体未在当前资料库找到')}</option>}</select></label><button type="button" data-ui="icon-action" aria-label={t('导入字体')} title={t('导入字体')} onClick={onFont}><Upload size={15} /></button></div>
          <div className="mewiki-composition-fields">{field('fontSize', '文字大小（相对画布）', .5, 30)}<label>{t('字重')}<select aria-label={t('文字字重')} value={selected.fontWeight} onChange={event => patch({ fontWeight: Number(event.target.value) as 400 | 700 })}><option value="400">{t('常规')}</option><option value="700">{t('加粗')}</option></select></label>
            {field('lineHeight', '文字行距', 1, 3, .1)}{field('letterSpacing', '文字字间距', -1, 3, .05)}</div>
          <label>{t('对齐')}<select aria-label={t('文字对齐')} value={selected.align} onChange={event => patch({ align: event.target.value as CompositionLayer['align'] })}><option value="left">{t('左对齐')}</option><option value="center">{t('居中')}</option><option value="right">{t('右对齐')}</option></select></label>
          <label className="mewiki-composition-check"><input type="checkbox" checked={selected.autoShrink} onChange={event => patch({ autoShrink: event.target.checked })} />{t('文字过长时自动缩小')}</label></>}
        {selected.type !== 'image' && <label>{t('颜色')}<input type="color" aria-label={t('图层颜色')} value={selected.color} onChange={event => patch({ color: event.target.value })} /></label>}
        {selected.type === 'text' && <><label className="mewiki-composition-check"><input type="checkbox" checked={selected.background !== 'transparent'} onChange={event => patch({ background: event.target.checked ? '#ffffff' : 'transparent' })} />{t('显示文字底色')}</label>{selected.background !== 'transparent' && <label>{t('文字底色')}<input type="color" value={selected.background} onChange={event => patch({ background: event.target.value })} /></label>}</>}
        <div className="mewiki-composition-fields">{field('x', '图层水平位置（%）', -100, 200)}{field('y', '图层垂直位置（%）', -100, 200)}{field('width', '图层宽度（%）', 1, 200)}{field('height', '图层高度（%）', 1, 200)}{field('rotation', '图层旋转', -180, 180, 1)}{field('opacity', '图层透明度', 0, 100, 1)}{field('padding', '图层内边距', 0, 10)}{field('radius', '图层圆角', 0, 30)}</div>
        <div className="mewiki-composition-tools" role="toolbar" aria-label={t('图层操作')}>
          <button type="button" data-ui="icon-action" aria-label={t('复制图层')} title={t('复制图层')} onClick={() => add(selected.type, { ...selected, id: crypto.randomUUID(), x: selected.x + 2, y: selected.y + 2, name: (selected.name + t('副本')).slice(0, 80) })}><Copy size={15} /></button>
          <button type="button" data-ui="icon-action" aria-label={t('上移图层')} title={t('上移图层')} disabled={!all} onClick={() => editor.reorder(selected.id, 1)}><ArrowUp size={15} /></button>
          <button type="button" data-ui="icon-action" aria-label={t('下移图层')} title={t('下移图层')} disabled={!all} onClick={() => editor.reorder(selected.id, -1)}><ArrowDown size={15} /></button>
          <button type="button" data-ui="icon-action" aria-label={t('删除图层')} title={t('删除图层')} onClick={() => editor.remove(selected.id, currentId)}><Trash2 size={15} /></button>
        </div>
        {selected.type === 'image' && <button type="button" onClick={() => void onSticker(selected.name || t('个人贴纸'), selected.image).catch(cause => onError(cause instanceof Error ? cause.message : '图片设计保存失败。'))}>{t('加入我的贴纸')}</button>}
        </fieldset>
      </> : <div className="mewiki-composition-fields">
        {(['x', 'y', 'scale', 'rotation'] as const).map((key, index) => <label key={key}>{t(['水平（%）', '垂直（%）', '大小（%）', '旋转'][index])}<input aria-label={t(['主体水平位置（%）', '主体垂直位置（%）', '主体大小（%）', '主体旋转'][index])} disabled={subject.locked} type="number" min={key === 'scale' ? 20 : key === 'rotation' ? -180 : 0} max={key === 'scale' ? 150 : key === 'rotation' ? 180 : 100} value={subject[key]} onChange={event => editor.patchSubject({ [key]: Number(event.target.value) }, currentId)} /></label>)}
      </div>}
    </fieldset>
    </details>
      {!!currentId && <details className="mewiki-publication-settings-section"><summary><ChevronRight size={16} aria-hidden="true" /><span>{t('当前图片文案')}</span></summary><fieldset disabled={disabled}><label>{t('标题')}<input aria-label={t('本图标题')} maxLength={1000} value={editor.items[currentId]?.title ?? workspace.current?.name.replace(/\.[^.]+$/, '') ?? ''} onChange={event => editor.setItem(currentId, { title: event.target.value })} /></label><label>{t('副标题')}<input aria-label={t('本图副标题')} maxLength={1000} value={editor.items[currentId]?.subtitle ?? ''} onChange={event => editor.setItem(currentId, { subtitle: event.target.value })} /></label></fieldset></details>}
      <details className="mewiki-publication-settings-section"><summary><ChevronRight size={16} aria-hidden="true" /><span>{t('我的贴纸')}</span></summary><fieldset disabled={disabled}>{!stickers.length && <p className="mewiki-publication-empty">{t('还没有个人贴纸')}</p>}{stickers.map(sticker => <div key={sticker.id} className="mewiki-composition-personal-sticker"><button type="button" data-ui="menu-action" onClick={() => { void imageWorkspaceClient(libraryId, pluginId).asset(sticker.assetId).then(image => add('image', { image, name: sticker.name })).catch(cause => onError(cause.message)); }}><Sticker size={14} /><span>{sticker.name}</span></button><button type="button" data-ui="icon-action" aria-label={t`移除个人贴纸：${sticker.name}`} title={t('移除个人贴纸')} onClick={() => void onRemoveSticker(sticker.id).catch(cause => onError(cause.message))}><Trash2 size={14} /></button></div>)}</fieldset></details>
    </div>
  </aside>;
}
