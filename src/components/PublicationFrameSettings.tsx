import { t } from '../i18n/locale.ts';
import { defaultPublicationFrame, publicationFrames, type PublicationFrame, type PublicationFrameId } from '../domain/publicationFrames.ts';

export default function PublicationFrameSettings({ value, mode, imageMode = false, disabled, onChange }: {
  value?: PublicationFrame; mode: 'pages' | 'long'; imageMode?: boolean; disabled: boolean; onChange: (frame: PublicationFrame | undefined) => void;
}) {
  const inactive = mode === 'long';
  const change = <K extends keyof PublicationFrame>(key: K, setting: PublicationFrame[K]) => { if (value) onChange({ ...value, [key]: setting }); };
  return <section className="mewiki-publication-frame" aria-label={t('设备边框设置')}>
    <label>{t('设备边框')}<select disabled={disabled || inactive} value={value?.id ?? 'none'} onChange={event => {
      const id = event.target.value;
      onChange(id === 'none' ? undefined : value ? { ...value, id: id as PublicationFrameId } : defaultPublicationFrame(id as PublicationFrameId));
    }}><option value="none">{t('无设备边框')}</option>{publicationFrames.map(device => <option key={device.id} value={device.id}>{t(device.name)}</option>)}</select></label>
    {inactive && <p className="mewiki-publication-hint">{t('连续长图暂不套用设备边框，切回多页图片后恢复。')}</p>}
    {!!value && !inactive && <>
      <div className="mewiki-publication-fields">
        <label>{t('设备外背景')}<input type="color" value={value.background} disabled={disabled} onChange={event => change('background', event.target.value)} /></label>
        <label>{t('设备大小')} · {value.scale}%<input aria-label={t('设备大小')} type="range" min={60} max={100} value={value.scale} disabled={disabled} onChange={event => change('scale', Number(event.target.value))} /></label>
        <label>{t('设备阴影')} · {value.shadow}%<input aria-label={t('设备阴影')} type="range" min={0} max={100} value={value.shadow} disabled={disabled} onChange={event => change('shadow', Number(event.target.value))} /></label>
        {!imageMode && <label>{t('屏幕内容缩放')} · {value.contentScale}%<input aria-label={t('屏幕内容缩放')} type="range" min={75} max={125} value={value.contentScale} disabled={disabled} onChange={event => change('contentScale', Number(event.target.value))} /></label>}
      </div>
      {!imageMode && <p className="mewiki-publication-hint">{t('每页独立套用边框，输出比例与清晰度保持当前设置。内容缩放调整屏幕内的文字大小与分页；背景纹理保留在屏幕内。')}</p>}
    </>}
  </section>;
}
