import type { PublicationOptions } from './publicationTypes.ts';
/** Host-owned, optional template parameters. No paths, remote URLs or executable SVG input. */
export const PUBLICATION_MAX_TEXTURE_LAYERS = 6;
export const publicationTexturePresets = [
  { id: 'paper', name: '暖白纸纹', color: '#b6a38a', opacity: 18 },
  { id: 'fiber', name: '棉纸纤维', color: '#aa9d87', opacity: 18 },
  { id: 'dots', name: '点阵手帐', color: '#75839a', opacity: 22 },
  { id: 'grid', name: '工程方格', color: '#708a9f', opacity: 18 },
  { id: 'ruled', name: '横线稿纸', color: '#8296aa', opacity: 20 },
  { id: 'linen', name: '亚麻织纹', color: '#a4947b', opacity: 18 },
  { id: 'mist', name: '柔光雾面', color: '#a0aabe', opacity: 20 },
  { id: 'watercolor', name: '边缘水彩', color: '#b998a6', opacity: 24 },
] as const;
export type PublicationTexturePreset = typeof publicationTexturePresets[number]['id'];
export type PublicationTextureKind = PublicationTexturePreset | 'none' | 'custom';
export interface PublicationTexture {
  kind: PublicationTextureKind;
  color: string;
  opacity: number;
  scale: number;
  seed: number;
  character: 'fine' | 'natural' | 'rough';
  rotation: number;
  scope: 'all' | 'body' | 'cover' | 'margins';
  image: string;
  fit: 'tile' | 'cover';
}
export function defaultPublicationTexture(kind: PublicationTextureKind = 'none'): PublicationTexture {
  const preset = publicationTexturePresets.find(item => item.id === kind);
  return { kind, color: preset?.color ?? '#9c9386', opacity: preset?.opacity ?? 18, scale: 100, seed: 1, character: 'natural', rotation: 0, scope: 'all', image: '', fit: 'tile' };
}
export function nextTextureSeed(): number { return crypto.getRandomValues(new Uint32Array(1))[0]; }

/** Frontmost first, as displayed in the settings list. Old templates stay single-layer. */
export function publicationTextureLayers(options: Pick<PublicationOptions, 'texture' | 'textureLayers'>): PublicationTexture[] {
  return options.textureLayers ?? (options.texture ? [options.texture] : []);
}
export function withPublicationTextureLayers(options: PublicationOptions, layers: PublicationTexture[]): PublicationOptions {
  const { texture: _texture, textureLayers: _layers, ...base } = options;
  return layers.length === 1 ? { ...base, texture: layers[0] } : layers.length ? { ...base, textureLayers: layers } : base;
}

function textureSvg(t: PublicationTexture): string {
  let seed = t.seed >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const n = (value: number) => value.toFixed(2);
  const size = 256, detail = t.character === 'fine' ? .6 : t.character === 'rough' ? 1.7 : 1;
  // Only this generator creates SVG. User-supplied SVG is never accepted.
  const noise = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="${n(.7 / detail)}" numOctaves="3" seed="${t.seed % 65536}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .28 .28 .28 0 0"/><feComposite in="SourceGraphic" operator="in"/></filter><rect width="256" height="256" fill="${t.color}" filter="url(#grain)"/>`;
  const offset = n(random() * 32);
  let shapes = '';
  switch (t.kind) {
    case 'paper': shapes = `<rect width="256" height="256" fill="${t.color}" opacity=".15"/>${noise}`; break;
    case 'fiber': {
      const paths = Array.from({ length: 150 }, () => {
        const x = random() * size, y = random() * size, length = (3 + random() * 17) * detail;
        return `<path d="M${n(x)} ${n(y)}q${n(length * .4)} ${n(random() * 5 - 2.5)} ${n(length)} ${n(random() * 6 - 3)}" opacity="${n(.2 + random() * .65)}"/>`;
      }).join('');
      shapes = `<g stroke="${t.color}" stroke-width="${n(.6 * detail)}" fill="none" transform="rotate(${t.rotation} 128 128)">${paths}</g>${noise}`; break;
    }
    case 'dots': shapes = `<pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse" x="${offset}" y="${offset}" patternTransform="rotate(${t.rotation})"><circle cx="16" cy="16" r="${n(1.4 * detail)}" fill="${t.color}"/></pattern><rect width="256" height="256" fill="url(#p)"/>`; break;
    case 'grid': shapes = `<pattern id="p" width="128" height="128" patternUnits="userSpaceOnUse" x="${offset}" y="${offset}" patternTransform="rotate(${t.rotation})"><path d="M0 32H128M0 64H128M0 96H128M32 0V128M64 0V128M96 0V128" stroke="${t.color}" stroke-width="${n(.7 * detail)}" opacity=".5"/><path d="M0 0H128M0 0V128" stroke="${t.color}" stroke-width="${n(1.5 * detail)}"/></pattern><rect width="256" height="256" fill="url(#p)"/>`; break;
    case 'ruled': shapes = `<pattern id="p" width="256" height="32" patternUnits="userSpaceOnUse" y="${offset}" patternTransform="rotate(${t.rotation})"><path d="M0 16H256" stroke="${t.color}" stroke-width="${n(detail)}"/></pattern><rect width="256" height="256" fill="url(#p)"/>`; break;
    case 'linen': shapes = `<pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse" x="${offset}" y="${offset}" patternTransform="rotate(${t.rotation})"><path d="M0 2H8M2 0V8" stroke="${t.color}" stroke-width="${n(detail)}" opacity=".8"/><path d="M0 6H8M6 0V8" stroke="${t.color}" stroke-width="${n(detail * .5)}" opacity=".35"/></pattern><rect width="256" height="256" fill="url(#p)"/>${noise}`; break;
    case 'mist': case 'watercolor': {
      const edge = t.kind === 'watercolor', spread = t.scale / 100;
      shapes = Array.from({ length: edge ? 8 : 4 }, (_, i) => {
        const x = edge ? i % 2 ? 256 : 0 : random() * 256, y = edge ? i * 36 : random() * 256;
        return `<radialGradient id="g${i}"><stop stop-color="${t.color}" stop-opacity="${n(.5 + random() * .5)}"/><stop offset="1" stop-color="${t.color}" stop-opacity="0"/></radialGradient><ellipse cx="${n(x)}" cy="${n(y)}" rx="${n((edge ? 68 : 170) * detail * spread)}" ry="${n((80 + random() * 90) * spread)}" fill="url(#g${i})"/>`;
      }).join('');
      shapes += `<g opacity="${edge ? '.15' : '.3'}">${noise}</g>`; break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" preserveAspectRatio="none">${shapes}</svg>`;
}
export function publicationTextureBackground(texture: PublicationTexture) {
  const full = texture.kind === 'custom' ? texture.fit === 'cover' : ['mist', 'watercolor'].includes(texture.kind);
  const image = texture.kind === 'custom' ? texture.image : `data:image/svg+xml,${encodeURIComponent(textureSvg(texture))}`;
  const tile = Math.round(256 * texture.scale / 100);
  return { backgroundImage: `url("${image}")`, backgroundSize: full ? texture.kind === 'custom' ? 'cover' : '100% 100%' : `${tile}px ${tile}px`, backgroundRepeat: full ? 'no-repeat' : 'repeat', backgroundPosition: 'center', opacity: texture.opacity / 100 };
}
/** Shared by the sample iframe and the isolated image renderer. */
export function publicationTextureCss(texture?: PublicationTexture | readonly PublicationTexture[], margin = 0): string {
  const layers = !texture ? [] : Array.isArray(texture) ? texture : [texture as PublicationTexture];
  if (!layers.some(layer => layer.kind !== 'none' && layer.opacity)) return '';
  const rules = layers.map((layer, index) => {
    const style = publicationTextureBackground(layer);
    const clip = layer.scope === 'margins' ? `clip-path:polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${margin}px ${margin}px,${margin}px calc(100% - ${margin}px),calc(100% - ${margin}px) calc(100% - ${margin}px),calc(100% - ${margin}px) ${margin}px,${margin}px ${margin}px);` : '';
    return `.publication-texture-layer[data-texture-layer="${index}"]{background-image:${style.backgroundImage};background-size:${style.backgroundSize};background-repeat:${style.backgroundRepeat};background-position:center;opacity:${style.opacity};${clip}}`;
  }).join('');
  return `.publication-page{isolation:isolate}.publication-texture-background{position:absolute;inset:0;pointer-events:none;z-index:0}.publication-texture-layer{display:block;position:absolute;inset:0;pointer-events:none}.page-body,.page-header,.page-footer{z-index:1}.publication-page:has(.cover-body) .publication-texture-layer[data-texture-scope="body"],.publication-page:not(:has(.cover-body)) .publication-texture-layer[data-texture-scope="cover"]{display:none}${rules}`;
}
/** Cloned by both page builders; the list's first layer is painted last. */
export function publicationTextureMarkup(layers: readonly PublicationTexture[], inline = false): string {
  const markup = layers.map((layer, index) => layer.kind === 'none' || !layer.opacity ? '' : `<span class="publication-texture-layer" data-texture-layer="${index}" data-texture-scope="${layer.scope}"></span>`).reverse().join('');
  const content = markup ? `<div class="publication-texture-background" aria-hidden="true">${markup}</div>` : '';
  return inline || !content ? content : `<template id="publication-texture-layers">${content}</template>`;
}
