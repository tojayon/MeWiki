import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { t } from '../i18n/locale.ts';

export default function PublicationInfo({ native, imageMode = false }: { native: boolean; imageMode?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div ref={ref} className="mewiki-publication-info" onPointerLeave={() => setOpen(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <button type="button" data-ui="icon-action" aria-label={t('导出说明')} aria-describedby={open ? id : undefined}
      onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}><Info size={16} /></button>
    {open && <div className="mewiki-publication-tooltip" role="tooltip" id={id}>
      <p>{t('设置、内容选择和图片创作会自动保留在当前浏览器。刷新或从同一笔记重新打开可继续编辑；成品图片需要重新生成。草稿不替代个人模板、图片设计或备份。')}</p>
      {imageMode ? <>
      <p>{t('画布直接使用左侧设定的画幅。文字、贴纸和设备均在此画幅内编辑；切换清晰度会同比缩放。')}</p>
      <p>{t('拖动画布对象移动，右下角调整大小，上方手柄旋转。双击主图取景，方向键微调。')}</p>
      <p>{t('网络图片请先保存到资料库。支持 PNG、JPEG、WebP，单张原件最大 8 MiB、1600 万像素；每批最多 50 张，总画幅最多 8000 万像素。')}</p>
      <p>{t('个人模板保存共用样式、图层、固定装饰和所用字体，不包含本批主图、文案或逐图调整。图片设计另外保存这些内容，首次手动保存后自动记录修改。')}</p>
      <p>{t('使用“图片设计操作”导出作品备份 ZIP，包含画布、本批原图和字体，可导入为新设计。图片设计和贴纸按资料库保存，独立于笔记资料备份，请另行备份。')}</p>
      </> : <>
      <p>{t('个人模板按资料库保存。模板文件包含样式、作者图片和所用字体，不包含笔记正文；请单独备份。')}</p>
      <p>{t('可导入 TTF、OTF、WOFF 或 WOFF2 字体，单个最大 100 MiB。字体保存在当前资料库，可重复选择或下载原件。')}</p>
      {native && <p>{t('使用与 MeWiki 正文共用的基础样式。更新应用后重新生成图片，即可跟随新的正文排版；个人模板保存的参数保持不变。')}</p>}
      <p>{t('先选择模板，再调整内容与画幅。生成预览后下载图片，排版不会改变原笔记。')}</p>
      </>}
    </div>}
  </div>;
}
