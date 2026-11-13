import { describe, expect, it } from 'vitest';
import { defaultPublicationOptions, parsePublicationRequest } from './publicationTypes.ts';

const request = (tree: unknown) => ({ document: { title: '原生正文', text: '引用', blocks: [{ id: 'a', kind: 'native', content: JSON.stringify(tree) }] }, options: { ...defaultPublicationOptions(), style: 'document' } });
describe('native publication DOM boundary', () => {
  it('retains a static link icon, heading number and custom appearance without link targets', () => {
    const tree = { tag: 'section', attrs: { class: 'research-note-block' }, children: [
      { tag: 'h2', children: [{ tag: 'span', attrs: { class: 'research-heading-number' }, children: ['1.2.'] }, ' 标题'] },
      { tag: 'a', attrs: { class: 'research-note-link' }, children: [{ tag: 'svg', attrs: { viewBox: '0 0 24 24' }, children: [{ tag: 'path', attrs: { d: 'M4 4h16v16H4z' }, children: [] }] }, '引用'] },
      { tag: 'span', attrs: { class: 'research-callout-label' }, style: { 'background-color': '#cc4422', color: '#ffffff' }, children: ['注意'] },
    ] };
    expect(parsePublicationRequest(request(tree)).document.blocks[0].content).toBe(JSON.stringify(tree));
  });
  it.each([
    { tag: 'script', children: ['alert(1)'] },
    { tag: 'img', attrs: { src: 'https://example.com/private.png' }, children: [] },
    { tag: 'a', attrs: { href: 'javascript:alert(1)' }, children: ['链接'] },
    { tag: 'div', attrs: { onclick: 'alert(1)' }, children: [] },
    { tag: 'div', style: { background: 'url(https://example.com/x)' }, children: [] },
    { tag: 'div', style: { color: 'red;}</style><script>1</script>' }, children: [] },
    { tag: 'svg', attrs: { preserveAspectRatio: 'url(https://example.com/x)' }, children: [] },
  ])('rejects executable nodes and resource-bearing attributes: %j', tree => {
    expect(() => parsePublicationRequest(request(tree))).toThrow();
  });
  it('preserves the SVG stretch mode, mathematical rules and footnote marker', () => {
    const tree = { tag: 'section', attrs: { 'data-footnotes': 'true' }, children: [
      { tag: 'svg', attrs: { preserveAspectRatio: 'xMinYMin slice' }, children: [] },
      { tag: 'span', style: { 'border-bottom-width': '0.04em', 'border-right-width': '0.04em', 'border-right-style': 'solid' }, children: [] },
    ] };
    expect(parsePublicationRequest(request(tree)).document.blocks[0].content).toBe(JSON.stringify(tree));
  });
  it('rejects excessive nesting and native content in a parameter template', () => {
    let tree: unknown = '正文';
    for (let index = 0; index < 70; index++) tree = { tag: 'div', children: [tree] };
    expect(() => parsePublicationRequest(request(tree))).toThrow();
    const legacy = request({ tag: 'div', children: ['正文'] });
    delete (legacy.options as { style?: string }).style;
    expect(() => parsePublicationRequest(legacy)).toThrow();
  });
});
