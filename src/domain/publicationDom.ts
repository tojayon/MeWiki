/** A bounded, inert reading tree. This is internal host data, never plugin HTML/CSS. */
export type PublicationDomNode = string | {
  tag: string;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  children: PublicationDomNode[];
};
export const publicationDomTags = new Set('div section article header footer main aside span p h1 h2 h3 h4 h5 h6 strong b em i s del u a button ul ol li blockquote pre code table thead tbody tfoot tr th td figure figcaption img br hr sup sub small time label input select option audio video svg g path rect circle ellipse line polyline polygon'.split(' '));
export const publicationDomAttributes = new Set('class title role aria-label aria-hidden aria-selected aria-pressed aria-disabled data-ui data-kind data-plain-text data-label-position data-player-kind data-active data-tone data-align data-footnotes start colspan rowspan checked disabled type value placeholder min max step controls preload poster src alt width height viewBox preserveAspectRatio fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity d x y x1 x2 y1 y2 cx cy r rx ry points transform'.split(' '));
const properties = new Set('display position inset top right bottom left width height min-width min-height max-width max-height box-sizing margin margin-top margin-right margin-bottom margin-left margin-inline margin-block padding padding-top padding-right padding-bottom padding-left padding-inline padding-block border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-collapse border-spacing border-bottom-color border-top-color border-right-color border-left-color border-bottom-width border-top-width border-right-width border-left-width border-bottom-style border-top-style border-right-style border-left-style background background-color color font font-family font-size font-weight font-style font-synthesis font-variant-numeric line-height letter-spacing white-space overflow overflow-x overflow-y overflow-wrap word-break text-align text-decoration text-indent vertical-align tab-size opacity visibility flex flex-direction flex-wrap flex-basis flex-grow flex-shrink align-items align-self align-content justify-items justify-content justify-self gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow order transform transform-origin object-fit object-position aspect-ratio float clear list-style list-style-type text-overflow box-shadow fill stroke stroke-width stroke-dasharray'.split(' '));
const fail = (): never => { throw new Error('原生导出内容无效，请重新生成预览。'); };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail();
  return value as Record<string, unknown>;
};
export function publicationDomStyle(name: string, value: string): boolean {
  return (properties.has(name) || /^--[a-z][a-z\d-]{0,100}$/.test(name)) && value.length <= 2000 && !/[<>;{}\\]/.test(value) && ![...value].some(character => character.charCodeAt(0) < 32) && !/(?:url|image-set|expression|attr|paint|element)\s*\(|@|javascript:|binding|behavior/i.test(value);
}
export function parsePublicationDom(content: string): { tree: PublicationDomNode; images: string[]; textLength: number } {
  let input: unknown; try { input = JSON.parse(content); } catch { return fail(); }
  let count = 0, textLength = 0;
  const images: string[] = [];
  const visit = (value: unknown, depth: number): PublicationDomNode => {
    if (++count > 30000 || depth > 64) return fail();
    if (typeof value === 'string') { textLength += value.length; if (textLength > 200000) return fail(); return value; }
    const node = record(value);
    if (Object.keys(node).some(key => !['tag', 'attrs', 'style', 'children'].includes(key)) || typeof node.tag !== 'string' || !publicationDomTags.has(node.tag) || !Array.isArray(node.children)) return fail();
    const attrs: Record<string, string> = {}, style: Record<string, string> = {};
    if (node.attrs !== undefined) for (const [name, raw] of Object.entries(record(node.attrs))) {
      if (!publicationDomAttributes.has(name) || typeof raw !== 'string' || raw.length > (name === 'src' || name === 'poster' ? 12 * 1024 * 1024 : name === 'd' || name === 'points' ? 100000 : 4000)) return fail();
      if (name === 'src' || name === 'poster') {
        if ((name === 'src' && node.tag !== 'img') || (name === 'poster' && node.tag !== 'video') || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) return fail();
        images.push(raw);
      } else if (name === 'preserveAspectRatio' && !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(raw)) return fail();
      else if (/^(fill|stroke)$/.test(name) && !/^(?:none|currentColor|transparent|#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(raw)) return fail();
      else if (name === 'type' && !['checkbox', 'text', 'number', 'search', 'range', 'button'].includes(raw)) return fail();
      else if (name === 'class' && !/^[\w\s-]*$/.test(raw)) return fail();
      else if (['d', 'points', 'transform', 'viewBox', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'opacity'].includes(name) && /[<>"';{}\\]|(?:url|javascript)/i.test(raw)) return fail();
      attrs[name] = raw;
    }
    if (node.style !== undefined) for (const [name, raw] of Object.entries(record(node.style))) {
      if (typeof raw !== 'string' || !publicationDomStyle(name, raw)) return fail(); style[name] = raw;
    }
    return { tag: node.tag, ...(node.attrs === undefined ? {} : { attrs }), ...(node.style === undefined ? {} : { style }), children: node.children.map(child => visit(child, depth + 1)) };
  };
  return { tree: visit(input, 0), images, get textLength() { return textLength; } };
}
