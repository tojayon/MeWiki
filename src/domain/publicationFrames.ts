import type { PublicationOptions } from './publicationTypes.ts';
import { publicationFields as fields, publicationContext as at, publicationObject, publicationChoice, publicationColor, publicationNumber } from './publicationValidation.ts';

export type PublicationFrameId = 'phone' | 'phone-landscape' | 'laptop' | 'browser';
export interface PublicationFrame {
  id: PublicationFrameId;
  background: string;
  scale: number;
  shadow: number;
  contentScale: number;
}
interface FrameRect { x: number; y: number; width: number; height: number; radius: number }
interface PublicationFrameDevice {
  id: PublicationFrameId; name: string; width: number; height: number;
  shell: FrameRect; screen: FrameRect;
}
const phoneFrame = (id: 'phone' | 'phone-landscape', name: string, width: number, height: number): PublicationFrameDevice => {
  const bezel = 12, radius = 44;
  return { id, name, width, height, shell: { x: 0, y: 0, width, height, radius }, screen: { x: bezel, y: bezel, width: width - 2 * bezel, height: height - 2 * bezel, radius: radius - bezel } };
};
/** Host-owned geometry only. No external artwork, device brands or executable templates. */
export const publicationFrames: readonly PublicationFrameDevice[] = [
  phoneFrame('phone', '手机（竖屏）', 420, 900),
  phoneFrame('phone-landscape', '手机（横屏）', 900, 420),
  { id: 'laptop', name: '笔记本电脑', width: 1280, height: 820, shell: { x: 40, y: 0, width: 1200, height: 754, radius: 28 }, screen: { x: 66, y: 36, width: 1148, height: 680, radius: 5 } },
  { id: 'browser', name: '浏览器窗口', width: 1200, height: 800, shell: { x: 0, y: 0, width: 1200, height: 800, radius: 12 }, screen: { x: 2, y: 58, width: 1196, height: 740, radius: 10 } },
];
export function defaultPublicationFrame(id: PublicationFrameId): PublicationFrame {
  return { id, background: '#edf0f4', scale: 100, shadow: 40, contentScale: 100 };
}
export function parsePublicationFrame(value: unknown): PublicationFrame {
  const frame = publicationObject(value, ['id', 'background', 'scale', 'shadow', 'contentScale'], fields.frame);
  return { id: publicationChoice(frame.id, publicationFrames.map(device => device.id), fields.frame), background: publicationColor(frame.background, at(fields.frame, fields.frameBackground)), scale: publicationNumber(frame.scale, 60, 100, at(fields.frame, fields.frameScale)), shadow: publicationNumber(frame.shadow, 0, 100, at(fields.frame, fields.shadow)), contentScale: publicationNumber(frame.contentScale, 75, 125, at(fields.frame, fields.contentScale)) };
}

/** Logical document pixels stay separate from the final, fixed-size output canvas. */
export function publicationFrameLayout(options: Pick<PublicationOptions, 'width' | 'height' | 'mode' | 'frame'>) {
  if (!options.frame || options.mode === 'long') return null;
  const device = publicationFrames.find(device => device.id === options.frame!.id)!;
  const unit = Math.min(options.width / device.width, options.height / device.height) * .86 * options.frame.scale / 100;
  const width = options.width * 100 / options.frame.contentScale;
  const height = width * device.screen.height / device.screen.width;
  return { device, unit, width, height, left: (options.width - device.width * unit) / 2, top: (options.height - device.height * unit) / 2, contentScale: device.screen.width / width };
}
export function publicationContentSize(options: Pick<PublicationOptions, 'width' | 'height' | 'mode' | 'frame'>): { width: number; height: number } {
  const layout = publicationFrameLayout(options);
  return layout ? { width: layout.width, height: layout.height } : { width: options.width, height: options.height };
}

/** Keep text rectangles inside the screen's rounded corners, even at tiny margins. */
export function publicationPageInsets(options: Pick<PublicationOptions, 'width' | 'height' | 'mode' | 'frame' | 'margin' | 'fontSize'>) {
  const layout = publicationFrameLayout(options);
  if (!layout) return { header: Math.max(8, options.margin / 2), body: options.margin + options.fontSize };
  const radius = layout.device.screen.radius / layout.contentScale;
  const horizontal = Math.max(0, radius - options.margin);
  const safeTop = radius - Math.sqrt(Math.max(0, radius * radius - horizontal * horizontal));
  const header = Math.max(8, options.margin / 2, Math.ceil(safeTop + 2));
  const headerHeight = Math.max(options.fontSize, Math.max(12, options.fontSize * .48) * 1.3);
  const body = Math.max(options.margin + options.fontSize, header + headerHeight + Math.max(4, options.fontSize * .25));
  return { header, body };
}

const rectCss = (rect: FrameRect, unit: number) => `left:${rect.x * unit}px;top:${rect.y * unit}px;width:${rect.width * unit}px;height:${rect.height * unit}px;border-radius:${rect.radius * unit}px;`;
/** Both page builders clone this exact shell; the screen receives the normal page layers. */
export function publicationFrameMarkup(options: PublicationOptions, content?: string): string {
  const layout = publicationFrameLayout(options);
  if (!layout) return '';
  const device = `<div class="publication-frame-device" data-device-frame="${layout.device.id}"><div class="publication-frame-shell" aria-hidden="true"></div><div class="publication-frame-screen"><div class="publication-sheet">${content ?? ''}</div></div><div class="publication-frame-detail" aria-hidden="true"></div></div>`;
  return content === undefined ? `<template id="publication-device-frame">${device}</template>` : device;
}
export function publicationFrameCss(options: PublicationOptions): string {
  const layout = publicationFrameLayout(options);
  if (!layout) return '';
  const { device, unit, width, height, contentScale, left, top } = layout;
  const insets = publicationPageInsets(options);
  const strength = options.frame!.shadow / 100;
  const phone = device.id.startsWith('phone');
  const px = (value: number) => `${value * unit}px`;
  const shadow = strength ? `drop-shadow(0 ${px(10)} ${px(16)} rgba(16,24,40,${strength * .55}))` : 'none';
  const detail = device.id === 'phone'
    ? `left:${px(176)};top:${px(4.5)};width:${px(68)};height:${px(3)};border-radius:${px(2)};background:#424852`
    : device.id === 'phone-landscape'
      ? `left:${px(4.5)};top:${px(176)};width:${px(3)};height:${px(68)};border-radius:${px(2)};background:#424852`
      : device.id === 'laptop'
        ? `left:0;top:${px(754)};width:${px(1280)};height:${px(52)};border:${px(1)} solid #9ba2ad;border-radius:${px(3)} ${px(3)} ${px(28)} ${px(28)};background:linear-gradient(#e2e5e9 0%,#b7bec9 70%,#8f98a5 100%)`
        : `left:${px(80)};top:${px(17)};width:${px(13)};height:${px(13)};border-radius:50%;background:#58b58a;box-shadow:${px(-23)} 0 #e1b14c,${px(-46)} 0 #dd766f`;
  return `.publication-page{background:${options.frame!.background};isolation:isolate}
.publication-frame-device{position:absolute;left:${left}px;top:${top}px;width:${px(device.width)};height:${px(device.height)};filter:${shadow}}
.publication-frame-shell{position:absolute;${rectCss(device.shell, unit)}background:${phone ? 'linear-gradient(145deg,#1c2027,#101319 48%,#191d24)' : device.id === 'laptop' ? '#282c34' : '#eef1f5'};border:${px(phone ? 1.5 : 2)} solid ${phone ? '#5a626e' : '#aab1bd'};box-shadow:inset 0 0 0 ${px(phone ? .7 : 2)} ${phone ? '#090b10' : '#e2e5e9'};corner-shape:superellipse(1.6)}
.publication-frame-screen{position:absolute;${rectCss(device.screen, unit)}overflow:hidden;background:${options.background};isolation:isolate;corner-shape:superellipse(1.6)}
.publication-sheet{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${options.background};transform:scale(${contentScale * unit});transform-origin:top left;isolation:isolate}
.publication-sheet .page-header{top:${insets.header}px}.publication-sheet .page-footer{bottom:${insets.header}px}.publication-sheet .page-body{top:${insets.body}px;bottom:${insets.body}px}
.publication-frame-detail{position:absolute;${detail};pointer-events:none}
${device.id === 'laptop' ? `.publication-frame-detail:before{content:"";position:absolute;left:${px(490)};top:0;width:${px(300)};height:${px(13)};border-radius:0 0 ${px(14)} ${px(14)};background:#8f98a5}.publication-frame-shell:after{content:"";position:absolute;top:${px(12)};left:50%;width:${px(7)};height:${px(7)};border-radius:50%;background:#10131a}` : ''}
${device.id === 'browser' ? `.publication-frame-shell:after{content:"";position:absolute;left:${px(142)};right:${px(82)};top:${px(10)};height:${px(30)};border:${px(1)} solid #d6dce4;border-radius:${px(4)};background:#fff}.publication-frame-screen{border-radius:0 0 ${px(10)} ${px(10)}}` : ''}`;
}
