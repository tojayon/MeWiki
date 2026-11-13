import { parsePublicationOptions, type PublicationOptions } from './publicationTypes.ts';

export const publicationAspects = ['3:4', '1:1', '4:3', '9:16', '16:9'] as const;
export type PublicationAspect = typeof publicationAspects[number];
export const publicationClarities = [720, 1080, 1440] as const;
const edge = (options: PublicationOptions) => options.mode === 'long' ? options.width : Math.min(options.width, options.height);
export function publicationAspect(options: PublicationOptions): PublicationAspect | 'custom' | 'long' {
  if (options.mode === 'long') return 'long';
  return publicationAspects.find(value => {
    const [width, height] = value.split(':').map(Number);
    return Math.abs(options.width / options.height - width / height) < .002;
  }) ?? 'custom';
}
export function publicationClarity(options: PublicationOptions): number {
  return publicationClarities.find(value => Math.abs(edge(options) - value) <= 1) ?? 0;
}
function dimensions(options: PublicationOptions, clarity: number, ratio = options.width / options.height) {
  if (options.mode === 'long') return { width: clarity, height: Math.min(12000, Math.floor(16_000_000 / clarity)) };
  return ratio >= 1 ? { width: Math.round(clarity * ratio), height: clarity } : { width: clarity, height: Math.round(clarity / ratio) };
}
export function supportsPublicationClarity(options: PublicationOptions, clarity: number): boolean {
  const { width, height } = dimensions(options, clarity);
  return publicationClarities.some(value => value === clarity) && width >= 480 && width <= 2160 && height >= 480 && height <= 12000 && width * height <= 16_000_000;
}
function resize(options: PublicationOptions, size: { width: number; height: number }) {
  const factor = edge({ ...options, ...size }) / edge(options);
  return parsePublicationOptions({ ...options, ...size, fontSize: Math.min(80, Math.max(16, Math.round(options.fontSize * factor))), margin: Math.min(200, Math.max(16, Math.round(options.margin * factor))) });
}
export function setPublicationClarity(options: PublicationOptions, clarity: number): PublicationOptions {
  if (!supportsPublicationClarity(options, clarity)) throw new Error('此清晰度超出当前画幅上限，请选择其他清晰度或比例。');
  return resize(options, dimensions(options, clarity));
}
export function setPublicationAspect(options: PublicationOptions, aspect: PublicationAspect): PublicationOptions {
  const [width, height] = aspect.split(':').map(Number);
  const target = { ...options, mode: 'pages' as const, width, height };
  const preferred = publicationClarity(options) || Math.min(1080, edge(options));
  const size = dimensions(target, preferred);
  const clarity = size.width <= 2160 ? preferred : [...publicationClarities].reverse().find(value => value <= preferred && supportsPublicationClarity(target, value))!;
  return resize({ ...options, mode: 'pages' }, dimensions(target, clarity));
}
