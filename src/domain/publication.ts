import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { renderedFormulaTex, type ResearchNotebookBlock, type ResearchNotebookState } from './researchNotebook.ts';
import { findResearchBlock } from './researchBlockTree.ts';
import { orderedNoteEmbedIds, resolveNoteEmbed } from './researchNoteEmbed.ts';
import { resolveSymbolEntry } from './researchDictionary.ts';
import { formatTermReference, resolveDictionaryReference, termReferenceSelection } from './researchTerms.ts';
import { researchNoteLinkId } from './researchNoteLinks.ts';
import { defaultDatasetChart, type ResearchDatasetBlock } from './researchDataset.ts';
import type { ResearchDiagramBlock } from './researchDiagram.ts';
import { mediaAssetIdPattern, type ResearchMediaSource } from './researchMedia.ts';
import { publicationImage, type PublicationBlock, type PublicationDocument } from './publicationTypes.ts';

export interface PublicationSnapshotOptions {
  allTabs?: boolean;
  selectedTabs?: Record<string, string>;
  resolveImage: (source: ResearchMediaSource) => Promise<string>;
  renderVisual: (block: ResearchDiagramBlock | ResearchDatasetBlock) => Promise<string>;
}
type TextNode = { type: string; value?: string; url?: string; alt?: string | null; identifier?: string; children?: TextNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const literal = (value: string) => value.replace(/[\\`*_{}[\]<>#!|]/g, '\\$&').replace(/\r?\n/g, ' ');
function plain(node: TextNode): string {
  if (node.type === 'html' || node.type === 'definition') return '';
  return node.value ?? node.alt ?? node.children?.map(plain).join(['root', 'list', 'table', 'tableRow'].includes(node.type) ? '\n' : '') ?? '';
}

/** Freeze exactly the selected readable content; never serialize private block snapshots. */
export async function buildPublicationDocument(state: ResearchNotebookState, noteId: string, selectedIds: readonly string[] | undefined, options: PublicationSnapshotOptions): Promise<PublicationDocument> {
  const note = state.notes.find(item => item.id === noteId);
  if (!note) throw new Error('要导出的笔记不存在。');
  const selected = selectedIds === undefined ? note.blocks : orderedNoteEmbedIds(note, selectedIds).map(id => findResearchBlock(note.blocks, id)!.block);
  if (selectedIds?.some(id => !findResearchBlock(note.blocks, id))) throw new Error('所选内容已改变，请重新选择导出范围。');
  if (!selected.length) throw new Error('请至少选择一个内容块。');
  const blocks: PublicationBlock[] = [];
  let visited = 0, size = 0;
  const append = (root: string, kind: PublicationBlock['kind'], content: string, caption?: string) => {
    if (!content.trim()) return;
    size += kind === 'image' ? 0 : content.length;
    if (blocks.length >= 1000 || size > 200000) throw new Error('导出内容过多，请缩小范围或拆分笔记。');
    blocks.push({ id: `${root}:${blocks.length}`, sourceId: root, kind, content, ...(caption ? { caption } : {}) });
  };
  const image = async (root: string, source: ResearchMediaSource, caption?: string) => {
    if (source.type !== 'asset') throw new Error('网络图片需先保存到本地资料库，再导出社交图文。');
    append(root, 'image', await options.resolveImage(source), caption);
  };
  const prose = async (root: string, source: string) => {
    const tree = markdown.parse(source) as TextNode;
    const definitions = new Map<string, string>();
    const collect = (node: TextNode) => { if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url); node.children?.forEach(collect); };
    collect(tree);
    const changes: { start: number; end: number; value: string }[] = [];
    const containsImage = (node: TextNode): boolean => node.type === 'image' || node.type === 'imageReference' || (!['code', 'inlineCode', 'math', 'inlineMath', 'html'].includes(node.type) && (node.children?.some(containsImage) ?? false));
    const visit = (node: TextNode) => {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      if (node.type === 'html') { changes.push({ start, end, value: '' }); return; }
      if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'math' || node.type === 'inlineMath') return;
      const url = node.type === 'link' || node.type === 'image' ? node.url : node.type === 'linkReference' || node.type === 'imageReference' ? definitions.get(node.identifier ?? '') : undefined;
      if (node.type === 'link' || node.type === 'linkReference') {
        // Drop only the link wrapper around images, keeping the pixels at their original position.
        if (containsImage(node) && node.children?.length) {
          const first = node.children[0].position?.start.offset, last = node.children.at(-1)?.position?.end.offset;
          if (first !== undefined && last !== undefined) {
            changes.push({ start, end: first, value: '' }, { start: last, end, value: '' });
            node.children.forEach(visit); return;
          }
        }
        const reference = resolveDictionaryReference(url, state.symbols, state.terms ?? []);
        const targetId = researchNoteLinkId(url);
        if (reference.kind === 'term' && reference.entry && !('notation' in reference.entry)) changes.push({ start, end, value: literal(formatTermReference(reference.entry, termReferenceSelection(url))) });
        else if (reference.kind === 'symbol' && reference.entry && 'notation' in reference.entry) {
          const entry = reference.entry;
          const bindings = { ...Object.fromEntries(entry.slots.map(slot => [slot.key, slot.defaultValue])), ...reference.bindings };
          changes.push({ start, end, value: `$${resolveSymbolEntry(entry, bindings).tex}$` });
        } else if (reference.kind || targetId !== null || url?.startsWith('webbench-asset:')) {
          const title = targetId !== null ? state.notes.find(item => item.id === targetId)?.title : undefined;
          changes.push({ start, end, value: literal(title || plain(node)) });
        } else if (node.type === 'linkReference') changes.push({ start, end, value: literal(plain(node)) });
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
    const rewrite = (start: number, end: number, extra: typeof changes = []) => {
      let result = source.slice(start, end);
      const within = [...changes, ...extra].filter(change => change.start >= start && change.end <= end);
      const disjoint = within.filter(change => !within.some(other => other !== change && other.start <= change.start && other.end >= change.end && (other.start < change.start || other.end > change.end)));
      for (const change of disjoint.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start - start) + change.value + result.slice(change.end - start);
      return result.trim();
    };
    for (const top of tree.children ?? []) {
      if (top.type === 'html' || top.type === 'definition') continue;
      const start = top.position?.start.offset ?? 0, end = top.position?.end.offset ?? source.length;
      const images: { node: TextNode; url: string; start: number; end: number }[] = [];
      const findImages = (node: TextNode) => {
        if (['code', 'inlineCode', 'math', 'inlineMath', 'html'].includes(node.type)) return;
        if (node.type === 'image' || node.type === 'imageReference') {
          const url = node.type === 'image' ? node.url : definitions.get(node.identifier ?? '');
          if (!url) throw new Error('图片引用没有有效来源，请先修复笔记中的图片。');
          images.push({ node, url, start: node.position!.start.offset!, end: node.position!.end.offset! });
        } else node.children?.forEach(findImages);
      };
      findImages(top);
      if (!images.length) { append(root, 'markdown', rewrite(start, end)); continue; }
      const localized: (typeof images[number] & { content: string })[] = [];
      for (const item of images) {
        const assetId = item.url.startsWith('webbench-asset:') ? item.url.slice(15) : '';
        if (!mediaAssetIdPattern.test(assetId)) throw new Error('网络图片需先保存到本地资料库，再导出社交图文。');
        localized.push({ ...item, content: publicationImage(await options.resolveImage({ type: 'asset', assetId }), false) });
      }
      const simpleParagraph = top.type === 'paragraph' && top.children?.every(child => ['image', 'imageReference', 'text'].includes(child.type));
      if (simpleParagraph) {
        // Only split paragraphs whose inline syntax cannot be cut in half.
        let cursor = start;
        for (const item of localized) {
          append(root, 'markdown', rewrite(cursor, item.start));
          append(root, 'image', item.content, item.node.alt || undefined);
          cursor = item.end;
        }
        append(root, 'markdown', rewrite(cursor, end));
      } else {
        // Lists, tables, links and formatting own their images; localize the source in place.
        const replacements = localized.map(item => ({ start: item.start, end: item.end, value: `![${literal(item.node.alt || '')}](${item.content})` }));
        const content = rewrite(start, end, replacements);
        if (content.length > 180000 || size + content.length > 200000) throw new Error('嵌入正文结构的图片过大，请压缩图片或改成独立图片内容块后导出。');
        append(root, 'markdown', content);
      }
    }
  };
  const walk = async (items: readonly ResearchNotebookBlock[], ownerId: string, root: string, path: readonly string[]) => {
    for (const block of items) {
      if (++visited > 1000 || path.length > 8) throw new Error('引用展开的内容过多，请缩小导出范围。');
      const address = JSON.stringify([ownerId, block.id]);
      if (path.includes(address)) throw new Error('循环引用无法导出，请调整引用范围。');
      const next = [...path, address];
      switch (block.type) {
        case 'paragraph': case 'markdown': await prose(root, block.text); break;
        case 'heading': await prose(root, `${'#'.repeat(block.level)} ${block.text}`); break;
        case 'list': await prose(root, block.items.map(item => `- ${item}`).join('\n')); break;
        case 'formula':
          append(root, 'formula', renderedFormulaTex(block, state.symbols).tex, block.caption);
          if (block.conditions) await prose(root, block.conditions);
          break;
        case 'callout': await prose(root, [`> **${literal(block.title)}**`, ...block.text.split(/\r?\n/).map(line => `> ${line}`)].join('\n')); break;
        case 'external': await prose(root, [literal(block.title), block.summary, block.note].filter(Boolean).join('\n\n')); break;
        case 'evidence': await prose(root, [literal(block.runTitle), `t = ${block.time} s`, block.eventLabel, block.note].filter(Boolean).join('\n\n')); break;
        case 'bookmark': await prose(root, [block.title, block.description, block.siteName].filter(Boolean).join('\n\n')); break;
        case 'citation': await prose(root, [block.title, block.authors, block.year, block.venue, block.doi, block.notes].filter(Boolean).join('\n\n')); break;
        case 'media':
          if (block.kind === 'image') {
            if (!block.source) throw new Error('图片原件缺失，请先重新关联本地图片。');
            await image(root, block.source, block.caption || block.alt);
          } else {
            if (block.kind === 'video' && block.poster) await image(root, block.poster, block.caption || block.alt);
            await prose(root, [({ audio: '音频', video: '视频', pdf: 'PDF 文档', file: '附件' })[block.kind], block.alt, block.caption].filter(Boolean).join('\n\n'));
          }
          break;
        case 'diagram': append(root, 'image', await options.renderVisual(block), block.title); break;
        case 'dataset': {
          if (block.chart || defaultDatasetChart(block)) append(root, 'image', await options.renderVisual(block), block.title);
          const cell = (value: string) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ↵ ');
          const table = [block.columns, block.columns.map(() => '---'), ...block.rows].map(row => `| ${row.map(cell).join(' | ')} |`).join('\n');
          await prose(root, [block.title ? `### ${literal(block.title)}` : '', block.columns.length ? table : '数据待导入'].filter(Boolean).join('\n\n'));
          break;
        }
        case 'examples': {
          const tabs = options.allTabs ? block.tabs : [block.tabs.find(tab => tab.id === options.selectedTabs?.[block.id]) ?? block.tabs[0]].filter(Boolean);
          for (const tab of tabs) {
            if (tab.title) await prose(root, `### ${literal(tab.title)}`);
            await walk(tab.blocks, ownerId, root, next);
          }
          break;
        }
        case 'noteEmbed': {
          const source = resolveNoteEmbed(state.notes, block);
          if (!source.note || source.items.some(item => !item.block)) throw new Error('引用来源笔记或内容已移除，请重新选择来源后导出。');
          await walk(source.items.map(item => item.block!), source.note.id, root, next);
          break;
        }
        default: throw new Error('此内容类型尚不能导出，请缩小选择范围。');
      }
    }
  };
  for (const block of selected) await walk([block], note.id, block.id, []);
  if (!blocks.length) throw new Error('所选内容没有可导出的正文或图像。');
  const text = blocks.map(block => block.kind === 'image' ? block.caption || '' : block.kind === 'formula' ? [block.content, block.caption].filter(Boolean).join('\n') : plain(markdown.parse(block.content) as TextNode)).filter(Boolean).join('\n\n');
  return { title: note.title, text, blocks };
}
