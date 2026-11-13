import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultPublicationOptions, type PublicationRequest } from '../src/domain/publicationTypes.ts';
import { publicationHtml } from './publicationHtml.ts';
import { renderPublication } from './publicationRenderer.ts';
import { publicationPagination } from './publicationPagination.ts';
import { applyPublicationTemplate } from '../src/domain/publicationTheme.ts';
import { defaultPublicationFrame } from '../src/domain/publicationFrames.ts';

const fixture = (): PublicationRequest => ({ document: { title: '知识分享 · 公式与中文', text: '测量与分析', blocks: [{ id: 'intro', kind: 'markdown', content: '## 测量与分析\n\n这是一个用于排版验收的通用示例。**保留重点**与行内公式 $x^2+y^2=z^2$。' }, { id: 'formula', kind: 'formula', content: '\\int_0^1 x^2\\,dx = \\frac{1}{3}', caption: '积分示例' }] }, options: { ...defaultPublicationOptions(), width: 600, height: 800, margin: 40, fontSize: 24 } });
describe('static publication HTML', () => {
  it('preserves escaped static identities for layout diagnostics', async () => {
    const request = fixture(); request.document.blocks[0].id = 'source:with:"<br>';
    expect(await publicationHtml(request)).toContain('data-publication-block="source:with:&quot;&lt;br&gt;"');
  });
  it('identifies the source of a resource decode or formula failure', async () => {
    const request = fixture();
    request.document.blocks.push({ id: 'bad-image', kind: 'image', content: 'data:image/png;base64,aW52YWxpZA==' });
    await expect(publicationHtml(request)).rejects.toThrow(/导出内容.*第 3 项.*图片.*有效的静态 PNG/);
    request.document.blocks.pop();
    request.options.logo = 'data:image/png;base64,bG9nbw==';
    await expect(publicationHtml(request)).rejects.toThrow(/内容 → 作者头像或 Logo.*有效的静态 PNG/);
    request.options.logo = '';
    request.document.blocks[1].content = '\\unknownMeWikiCommand';
    await expect(publicationHtml(request)).rejects.toThrow(/导出内容.*第 2 项.*公式.*无法排版/);
  });
  it('provides a shared local device shell and preserves the normal document layers', async () => {
    const request = fixture(); request.options.frame = defaultPublicationFrame('laptop');
    const html = await publicationHtml(request);
    expect(html).toContain('id="publication-device-frame"');
    expect(html).toContain('data-device-frame="laptop"');
    expect(html).toContain('class="publication-sheet"');
    expect(html).toContain('class="source-block"');
    request.options.mode = 'long';
    expect(await publicationHtml(request)).not.toContain('id="publication-device-frame"');
  });
  it('shares safe syntax highlighting across native and parameter templates', async () => {
    const request = fixture();
    request.document.blocks = [{ id: 'code', kind: 'markdown', content: '```ts\nconst value = "<script>";\n```' }];
    const legacy = await publicationHtml(request);
    expect(legacy).toContain('hljs-keyword');
    expect(legacy).toContain('&lt;script&gt;');
    expect(legacy).not.toContain('<script>');
    request.options.style = 'document';
    const native = await publicationHtml(request);
    expect(native).toContain('hljs-keyword');
    expect(native).toContain('&lt;script&gt;');
    expect(native).not.toContain('<script>');
  });
  it('escapes user content and removes executable markup and external link targets', async () => {
    const request = fixture(); request.document.title = '<script>bad()</script>';
    request.document.blocks = [{ id: 'a', kind: 'markdown', content: '<script>bad()</script>\n\n[说明](https://example.com/private)\n\n文字 <img src="https://example.com/x">' }];
    const html = await publicationHtml(request);
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('https://example.com');
    expect(html).toContain('说明');
  });
  it('reports unresolved Markdown images instead of exporting an empty placeholder', async () => {
    const request = fixture(); request.document.blocks = [{ id: 'a', kind: 'markdown', content: '![图](https://example.com/private.png)' }];
    await expect(publicationHtml(request)).rejects.toThrow('图片');
  });
  it('keeps footnote explanations in the static publication', async () => {
    const request = fixture(); request.document.blocks = [{ id: 'a', kind: 'markdown', content: '正文引用[^a]。\n\n[^a]: 这里是必须保留的补充解释。' }];
    expect(await publicationHtml(request)).toContain('这里是必须保留的补充解释。');
  });
  it('settles invalid raster validations when another block fails without terminating the process', async () => {
    const request = fixture();
    request.document.blocks = [{ id: 'bad-image', kind: 'image', content: 'data:image/png;base64,aW52YWxpZA==' }, { id: 'bad-formula', kind: 'formula', content: '\\unknownMeWikiCommand' }];
    const source = `import { publicationHtml } from './server/publicationHtml.ts';\ntry { await publicationHtml(${JSON.stringify(request)}); console.log('unexpected success'); } catch (error) { console.log(error.message); }\nawait new Promise(resolve => setTimeout(resolve, 80));`;
    const outcome = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], { cwd: process.cwd(), timeout: 10000 }).then(result => result.stdout, error => `process exited: ${error.code}`);
    expect(outcome).toContain('公式');
    expect(outcome).not.toContain('process exited');
  }, 15000);
  it('settles both invalid logo and cover image validations without unhandled rejections', async () => {
    const request = fixture(); request.options.logo = 'data:image/png;base64,bG9nbw=='; request.options.coverImage = 'data:image/png;base64,Y292ZXI=';
    const source = `import { publicationHtml } from './server/publicationHtml.ts';\ntry { await publicationHtml(${JSON.stringify(request)}); console.log('unexpected success'); } catch (error) { console.log(error.message); }\nawait new Promise(resolve => setTimeout(resolve, 80));`;
    const outcome = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', source], { cwd: process.cwd(), timeout: 10000 }).then(result => result.stdout, error => `process exited: ${error.code}`);
    expect(outcome).toContain('有效的静态 PNG');
    expect(outcome).not.toContain('process exited');
  }, 15000);
});
describe('local publication renderer', () => {
  it('uses the shared document heading, quote and table styles at the chosen export scale', async () => {
    const request = fixture();
    request.options = { ...applyPublicationTemplate(request.options, { id: 'native', name: '原生', style: 'document' }), fontSize: 30, headingColor: '#f1f5fb' };
    request.document.blocks = [{ id: 'content', kind: 'markdown', content: '## 共享标题\n\n> ## 引用标题\n>\n> 引用说明\n\n| 项目 | 数值 |\n| --- | --- |\n| 示例 | 42 |\n\n`代码`' }];
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort('blockedbyclient'));
      await page.setContent(await publicationHtml(request));
      await page.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
      const styles = await page.evaluate(() => {
        const style = (selector: string) => getComputedStyle(document.querySelector('.page-body ' + selector)!);
        return { heading: style('h2').fontSize, quoteHeading: style('blockquote h2').color, quoteBorder: style('blockquote').borderLeftWidth, quoteBackground: style('blockquote').backgroundColor, tableSize: style('table').fontSize, headerColor: style('thead tr > :first-child').backgroundColor, headerText: style('thead tr > :first-child').color, tableBorder: style('td + td').borderLeftColor, inlineColor: style('p code').color };
      });
      expect(styles).toMatchObject({ heading: '40px', quoteHeading: 'rgb(69, 86, 110)', quoteBorder: '6px', quoteBackground: 'rgb(248, 250, 252)', tableSize: '28px', headerColor: 'rgb(23, 52, 84)', headerText: 'rgb(248, 251, 255)', tableBorder: 'rgb(23, 52, 84)', inlineColor: 'rgb(230, 237, 243)' });
    } finally { await browser.close(); }
  }, 30000);
  it('renders local Chinese fonts, a formula, header and a real PNG at the requested size', async () => {
    const request = fixture(); request.options.header = '通用知识'; request.options.author = '作者';
    const progress: number[] = [];
    const result = await renderPublication(request, undefined, value => progress.push(value.completed));
    expect(result.pages).toHaveLength(1); expect(result.format).toBe('png');
    const metadata = await sharp(Buffer.from(result.pages[0].dataUrl.split(',')[1], 'base64')).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 600, height: 800 });
    expect(progress.at(-1)).toBe(1);
  }, 30000);
  it('paginates long paragraphs, tables and code without an oversized or empty page', async () => {
    const request = fixture();
    request.document.blocks = [
      { id: 'text', kind: 'markdown', content: '知识需要通过清晰的解释与例子传播。'.repeat(100) },
      { id: 'table', kind: 'markdown', content: '| 名称 | 数值 |\n| --- | --- |\n' + Array.from({ length: 25 }, (_, index) => `| 示例 ${index} | ${index} |`).join('\n') },
      { id: 'code', kind: 'markdown', content: '```ts\n' + Array.from({ length: 30 }, (_, index) => `const value${index} = ${index};`).join('\n') + '\n```' },
    ];
    const result = await renderPublication(request);
    expect(result.pages.length).toBeGreaterThan(3); expect(result.pages.length).toBeLessThan(15);
    for (const page of result.pages) expect(page).toMatchObject({ width: 600, height: 800 });
  }, 30000);
  it('produces JPEG and a bounded long image, and accepts cancellation', async () => {
    const request = fixture(); request.options.format = 'jpeg'; request.options.mode = 'long';
    const result = await renderPublication(request);
    expect(result.pages).toHaveLength(1);
    const metadata = await sharp(Buffer.from(result.pages[0].dataUrl.split(',')[1], 'base64')).metadata();
    expect(metadata.format).toBe('jpeg'); expect(metadata.width).toBe(600); expect(metadata.height).toBeLessThanOrEqual(12000);
    const controller = new AbortController(); controller.abort();
    await expect(renderPublication(request, controller.signal)).rejects.toThrow();
  }, 30000);
  it('keeps a cover and explicit content breaks as distinct pages with valid raster images', async () => {
    const request = fixture(); request.options.cover = true;
    const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#245fa5' } }).png().toBuffer();
    request.options.logo = `data:image/png;base64,${image.toString('base64')}`;
    request.options.coverImage = request.options.logo;
    request.document.blocks = [{ id: 'first', kind: 'markdown', content: '第一页' }, { id: 'second', kind: 'image', content: request.options.logo, caption: '独立图页', breakBefore: true }];
    const result = await renderPublication(request);
    expect(result.pages).toHaveLength(3);
    for (const page of result.pages) expect((await sharp(Buffer.from(page.dataUrl.split(',')[1], 'base64')).metadata()).format).toBe('png');
  }, 30000);
  it('rejects overlapping headers and oversized formulas instead of clipping them', async () => {
    const header = fixture(); header.options.author = '过长的作者或栏目说明'.repeat(20); header.options.header = header.options.author;
    await expect(renderPublication(header)).rejects.toThrow('页眉');
    const formula = fixture(); formula.document.blocks = [{ id: 'large', kind: 'formula', content: 'x+'.repeat(70) + 'x' }];
    await expect(renderPublication(formula)).rejects.toMatchObject({ message: expect.stringContaining('超出'), diagnostics: [{ blockId: 'large', code: 'page-overflow' }] });
  }, 30000);
  it.each(['pages', 'long'] as const)('reports every clipped native source in %s mode without duplicating nested scroll containers', async mode => {
    const request = fixture(); request.options.style = 'document';
    request.options.mode = mode;
    request.document.blocks = [
      { id: 'normal', kind: 'native', content: JSON.stringify({ tag: 'p', children: ['正常内容'] }) },
      { id: 'wide:source:native', kind: 'native', content: JSON.stringify({ tag: 'div', style: { 'overflow-x': 'auto' }, children: [{ tag: 'div', style: { 'min-width': '900px', 'overflow-x': 'auto' }, children: [{ tag: 'div', style: { width: '1200px' }, children: ['超宽内容'] }] }] }) },
      { id: 'tall:native', kind: 'native', content: JSON.stringify({ tag: 'div', style: { height: '30px', 'overflow-y': 'auto' }, children: [{ tag: 'div', style: { height: '200px' }, children: ['超高内容'] }] }) },
    ];
    await expect(renderPublication(request)).rejects.toMatchObject({
      message: expect.stringMatching(/超宽|超高/),
      diagnostics: [{ blockId: 'wide:source:native', code: 'horizontal-overflow' }, { blockId: 'tall:native', code: 'vertical-overflow' }],
    });
  }, 30000);
  it('keeps one source diagnostic when an overflowing native container is sliced across pages', async () => {
    const request = fixture(); request.options.style = 'document';
    request.document.blocks = [{ id: 'sliced:source:native', kind: 'native', content: JSON.stringify({ tag: 'div', children: [
      ...Array.from({ length: 12 }, () => ({ tag: 'p', children: ['连续内容用于跨页并保留所属来源。'.repeat(10)] })),
      { tag: 'div', style: { 'overflow-x': 'auto' }, children: [{ tag: 'div', style: { width: '1000px' }, children: ['超宽内容'] }] },
    ] }) }];
    await expect(renderPublication(request)).rejects.toMatchObject({ diagnostics: [{ blockId: 'sliced:source:native', code: 'horizontal-overflow' }] });
  }, 30000);
  it('cancels an active renderer before producing image results', async () => {
    const controller = new AbortController();
    await expect(renderPublication(fixture(), controller.signal, () => controller.abort())).rejects.toThrow('取消');
  }, 30000);
  it('enforces the selected maximum height of a long image', async () => {
    const request = fixture(); request.options.mode = 'long'; request.options.height = 800;
    request.document.blocks = [{ id: 'long', kind: 'markdown', content: '这是一个不应被截断的通用段落。'.repeat(35) }];
    const outcome = await renderPublication(request).then(() => 'unexpected success', cause => cause instanceof Error ? cause.message : 'unknown error');
    expect(outcome).toContain('最大高度');
  }, 30000);
  it('rejects an oversized table header even when the table has no data rows', async () => {
    const request = fixture();
    request.document.blocks = [{ id: 'head-only', kind: 'markdown', content: `| ${'表头说明'.repeat(180)} |\n| --- |` }];
    const outcome = await renderPublication(request).then(() => 'unexpected success', cause => cause instanceof Error ? cause.message : 'unknown error');
    expect(outcome).toContain('表头');
  }, 30000);
  it.each([undefined, 'document'] as const)('preserves code lines and markup when a %s code block spans pages', async style => {
    const request = fixture();
    if (style) request.options.style = style;
    const lines = ['', '', ...Array.from({ length: 70 }, (_, index) => index % 5 === 0 ? '' : `const value${index} = ${index};`), '', ''];
    const code = lines.join('\n');
    request.document.blocks = [{ id: 'code', kind: 'markdown', content: `\`\`\`ts\n${code}\n\`\`\`` }];
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 600, height: 800 } });
      await context.route('**/*', route => route.abort('blockedbyclient'));
      const page = await context.newPage();
      await page.setContent(await publicationHtml(request));
      await page.evaluate(`${publicationPagination}(${JSON.stringify({ options: request.options, title: request.document.title })})`);
      const fragments = await page.locator('.publication-page pre').allTextContents();
      expect(fragments.length).toBeGreaterThan(1);
      expect(fragments.join('\n')).toBe(code);
      if (style) expect(await page.locator('.publication-page pre .hljs-keyword').count()).toBe(lines.filter(line => line.startsWith('const')).length);
    } finally { await browser.close(); }
  }, 30000);
});
