import { layoutComposition } from '../src/domain/publicationCompositionLayout.ts';
/** Runs inside the isolated export browser; kept as source to avoid a DOM dependency in Node. */
export const publicationPagination = String.raw`(async ({ options:o, title }) => {
  await document.fonts.ready;
  if ([...document.fonts].some(font => font.status === 'error')) throw new Error('本地字体加载失败，请检查安装后重新导出。');
  await Promise.all([...document.images].map(image => image.decode()));
  const pages = document.getElementById('pages');
  if (o.imageMode) {
    const problems = (${layoutComposition.toString()})(document);
    if (problems.length) {
      const first = problems[0];
      throw new Error('图片创作 → 第 ' + first.index + ' 张 → 第 ' + (first.layerIndex + 1) + ' 个图层：' + (first.reason === 'outside' ? '图层超出画布或设备屏幕，请调整位置或大小。' : '文字超出文字框，请增大文字框、缩小字号或缩短文字。'));
    }
    const images = [...pages.querySelectorAll('.publication-page')];
    if (!images.length || images.length > 50) throw new Error('图片导出：每批请选择 1–50 张图片。');
    if (images.length * o.width * o.height > 80000000) throw new Error('图片导出：本批图片合计超过 8000 万像素，请降低清晰度或减少图片张数。');
    return images.map(page => {
      if (page.offsetWidth !== o.width || page.offsetHeight !== o.height) throw new Error('图片导出：图片画幅无效，请恢复模板样式。');
      return { width: o.width, height: o.height };
    });
  }
  const source = document.getElementById('source');
  const diagnostic = (node, code) => {
    const blockId = node.closest('[data-publication-block]')?.dataset.publicationBlock;
    return blockId ? { blockId, code } : undefined;
  };
  const contentError = (node, message) => {
    const issue = diagnostic(node, 'page-overflow');
    return Object.assign(new Error(message), issue ? { diagnostics: [issue] } : {});
  };
  const diagnostics = [], seenDiagnostics = new Set();
  const report = (node, code) => {
    const issue = diagnostic(node, code); if (!issue) return;
    const key = JSON.stringify([issue.blockId, issue.code]);
    if (!seenDiagnostics.has(key)) { seenDiagnostics.add(key); diagnostics.push(issue); }
  };
  let longOverflow = false;
  let current;
  const esc = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const createPage = (cover = false) => {
    if (pages.children.length >= 50) throw new Error('导出超过 50 页，请减少内容或增大画幅。');
    const page = document.createElement('article'); page.className = 'publication-page';
    const frame = document.getElementById('publication-device-frame');
    if (frame) page.append(frame.content.cloneNode(true));
    const sheet = page.querySelector('.publication-sheet') || page;
    const texture = document.getElementById('publication-texture-layers');
    if (texture) sheet.append(texture.content.cloneNode(true));
    const header = document.createElement('header'); header.className = 'page-header';
    header.innerHTML = '<span class="identity">' + (o.logo ? '<img alt="" src="' + o.logo + '">' : '') + '<span>' + esc(o.header) + '</span></span><span>' + esc(o.author) + '</span>';
    const body = document.createElement('main'); body.className = 'page-body' + (o.style === 'document' && !document.body.classList.contains('has-native-content') ? ' research-markdown' : '') + (cover ? ' cover-body' : '');
    const footer = document.createElement('footer'); footer.className = 'page-footer';
    footer.innerHTML = '<span>' + esc([o.footer, o.date].filter(Boolean).join(' · ')) + '</span><span class="page-number"></span>';
    sheet.append(header, body, footer); pages.append(page);
    if (body.clientHeight < o.fontSize * o.lineHeight * 2) throw new Error('画幅留白过大，正文空间不足，请调整尺寸或边距。');
    return body;
  };
  const bottom = body => body.getBoundingClientRect().bottom;
  const scale = body => body.getBoundingClientRect().width / body.clientWidth;
  const fits = (body, node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom <= bottom(body) + .5 * scale(body) && rect.right <= body.getBoundingClientRect().right + scale(body) && node.scrollWidth <= body.clientWidth + 1;
  };
  const place = node => { current.append(node); return fits(current, node); };
  const fresh = () => { current = createPage(); };
  const atomic = node => {
    if (place(node)) return;
    node.remove(); if (current.childElementCount) fresh();
    if (!place(node)) { node.remove(); throw contentError(node, '一项内容超出页面，请增大画幅、缩小字号或拆分超宽表格、公式及图片。'); }
  };
  const repeated = node => node.nodeType === Node.ELEMENT_NODE && node.matches('.research-callout-border,.research-callout-label,.research-examples-header,.research-examples-label,.research-code-toolbar,thead');
  const indivisible = node => node.nodeType === Node.ELEMENT_NODE && (node.matches('.katex,img,br,svg,video,audio,tr') || !node.childNodes.length);
  const weight = node => repeated(node) ? 0 : node.nodeType === Node.TEXT_NODE ? [...node.textContent].length : indivisible(node) ? 1 : [...node.childNodes].reduce((sum, child) => sum + weight(child), 0);
  const slice = (node, from, to) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode([...node.textContent].slice(from, to).join(''));
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode('');
    if (repeated(node)) return node.cloneNode(true);
    if (indivisible(node)) return from === 0 && to > 0 ? node.cloneNode(true) : document.createTextNode('');
    const copy = node.cloneNode(false); let offset = 0;
    if (node.tagName === 'OL') copy.start = node.start;
    for (const child of node.childNodes) {
      const size = weight(child);
      if (repeated(child) || to > offset && from < offset + size) copy.append(slice(child, Math.max(0, from-offset), Math.min(size, to-offset)));
      else if (node.tagName === 'OL' && child.nodeType === Node.ELEMENT_NODE && child.tagName === 'LI' && from >= offset + size) copy.start++;
      offset += size;
    }
    return copy;
  };
  const splitText = node => {
    let left = node; let remaining = weight(left);
    while (remaining) {
      if (place(left)) return;
      left.remove();
      let low = 0, high = remaining;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2); const candidate = slice(left, 0, mid); current.append(candidate);
        const ok = fits(current, candidate); candidate.remove(); if (ok) low = mid; else high = mid - 1;
      }
      if (!low) { if (current.childElementCount) { fresh(); continue; } throw contentError(node, '正文中有超出画幅的内容，请增大画幅或缩小字号。'); }
      current.append(slice(left, 0, low)); left = slice(left, low, remaining); remaining -= low; if (remaining) fresh();
    }
  };
  const splitTable = table => {
    const rows = [...table.querySelectorAll('tbody>tr')];
    if (!rows.length) {
      if (place(table)) return;
      table.remove(); if (current.childElementCount) fresh();
      if (!place(table)) { table.remove(); throw contentError(table, '表格表头超出页面，请增大画幅或减少表头内容。'); }
      return;
    }
    let part;
    const nextPart = () => { part = table.cloneNode(false); const head = table.querySelector('thead'); if (head) part.append(head.cloneNode(true)); part.append(document.createElement('tbody')); current.append(part); };
    nextPart();
    for (const row of rows) {
      part.tBodies[0].append(row.cloneNode(true));
      if (fits(current, part)) continue;
      part.tBodies[0].lastElementChild.remove();
      if (!part.tBodies[0].children.length) part.remove();
      if (!current.childElementCount) throw contentError(table, '表格某一行超出页面，请增大画幅或减少单元格内容。');
      fresh(); nextPart(); part.tBodies[0].append(row.cloneNode(true));
      if (!fits(current, part)) throw contentError(table, '表格某一行超出页面，请增大画幅或减少单元格内容。');
    }
  };
  const splitCode = pre => {
    const lines = (pre.textContent || '').split('\n'); let part, partLines, lineIndex = 0;
    const originalCode = pre.firstElementChild, fragments = [], offsets = [];
    let offset = 0; for (const line of lines) { offsets.push(offset); offset += [...line].length + 1; }
    const nextPart = () => { part = pre.cloneNode(false); part.append(originalCode ? originalCode.cloneNode(false) : document.createElement('code')); partLines = []; fragments.push({ node: part, firstLine: lineIndex }); current.append(part); };
    nextPart();
    for (const line of lines) {
      const code = part.firstElementChild; partLines.push(line); code.textContent = partLines.join('\n');
      if (fits(current, part)) { lineIndex++; continue; }
      partLines.pop(); code.textContent = partLines.join('\n');
      if (!partLines.length) part.remove();
      if (!current.childElementCount) throw contentError(pre, '代码行超出页面，请增大画幅或拆分过长代码行。');
      fresh(); nextPart(); partLines.push(line); part.firstElementChild.textContent = partLines.join('\n');
      if (!fits(current, part)) throw contentError(pre, '代码行超出页面，请增大画幅或拆分过长代码行。');
      lineIndex++;
    }
    if (originalCode) for (const fragment of fragments) {
      if (!fragment.node.isConnected || !fragment.node.textContent) continue;
      const from = offsets[fragment.firstLine], length = [...fragment.node.textContent].length;
      fragment.node.replaceChildren(slice(originalCode, from, from + length));
      if (!fits(fragment.node.closest('.page-body'), fragment.node)) throw contentError(pre, '代码行超出页面，请增大画幅或拆分过长代码行。');
    }
  };
  const splitList = list => {
    const items = [...list.children]; let index = 0, part;
    const nextPart = () => { part = list.cloneNode(false); if (list.tagName === 'OL') part.start = list.start + index; current.append(part); };
    nextPart();
    for (const item of items) {
      part.append(item.cloneNode(true));
      if (!fits(current, part)) {
        part.lastElementChild.remove(); if (!part.children.length) part.remove();
        if (!current.childElementCount) throw contentError(list, '列表某一项超出页面，请拆分内容或增大画幅。');
        fresh(); nextPart(); part.append(item.cloneNode(true));
        if (!fits(current, part)) throw contentError(list, '列表某一项超出页面，请拆分内容或增大画幅。');
      }
      index++;
    }
  };
  if (o.cover) {
    const cover = createPage(true); const heading = document.createElement('h1'); heading.className = 'document-title'; heading.textContent = title; cover.append(heading);
    if (o.subtitle) { const subtitle = document.createElement('p'); subtitle.className = 'subtitle'; subtitle.textContent = o.subtitle; cover.append(subtitle); }
    if (o.coverImage) { const image = document.createElement('img'); image.src = o.coverImage; cover.append(image); await image.decode(); }
    if (cover.scrollHeight > cover.clientHeight + 1) throw new Error('封面标题或图片超出画幅，请调整封面内容。');
  }
  fresh();
  const titleNode = document.createElement('h1'); titleNode.className = 'document-title'; titleNode.textContent = title;
  const units = [titleNode];
  if (!o.cover && o.subtitle) { const subtitle = document.createElement('p'); subtitle.className = 'subtitle'; subtitle.textContent = o.subtitle; units.push(subtitle); }
  for (const section of source.children) {
    let first = true;
    for (const child of [...section.children]) { child.dataset.break = first && section.dataset.break === 'true' ? 'true' : 'false'; child.dataset.publicationBlock = section.dataset.publicationBlock; units.push(child); first = false; }
  }
  if (o.mode === 'long') {
    current.parentElement.style.height = 'auto'; current.style.position = 'relative'; current.style.top = 'auto'; current.style.bottom = 'auto'; current.style.left = 'auto'; current.style.right = 'auto'; current.style.margin = (o.margin+o.fontSize) + 'px ' + o.margin + 'px';
    for (const unit of units) current.append(unit);
    await Promise.all([...current.querySelectorAll('img')].map(image => image.decode()));
    const height = Math.ceil(current.scrollHeight + 2 * (o.margin + o.fontSize));
    const maximumHeight = Math.min(o.height, 12000, Math.floor(16000000 / o.width));
    if (height > maximumHeight) throw new Error('长图超过所选最大高度或像素上限，请增大高度、改用分页图片或减少内容。');
    current.parentElement.style.height = height + 'px';
    for (const element of current.querySelectorAll('*')) if (element.scrollWidth > current.clientWidth + 1 && !element.closest('.katex')) { longOverflow = true; report(element, 'horizontal-overflow'); }
  } else {
    for (let index = 0; index < units.length; index++) {
      const unit = units[index];
      if (unit.dataset.break === 'true' && current.childElementCount) fresh();
      if (/^H[1-6]$/.test(unit.tagName) && current.childElementCount) {
        current.append(unit);
        if (unit.getBoundingClientRect().bottom + o.fontSize*o.lineHeight*2*scale(current) > bottom(current)) { unit.remove(); fresh(); } else unit.remove();
      }
      if (place(unit)) continue;
      const unitHeight = unit.getBoundingClientRect().height;
      unit.remove();
      if (unit.classList.contains('publication-dom')) {
        // A card that fits on an empty page must move intact, including its heading and controls.
        if (current.childElementCount && unitHeight <= current.getBoundingClientRect().height + .5 * scale(current)) {
          fresh();
          if (place(unit)) continue;
          unit.remove();
        }
        splitText(unit);
      }
      else if (unit.tagName === 'TABLE') splitTable(unit);
      else if (unit.tagName === 'PRE') splitCode(unit);
      else if (unit.tagName === 'UL' || unit.tagName === 'OL') splitList(unit);
      else if ((unit.tagName === 'P' || unit.tagName === 'BLOCKQUOTE') && !unit.querySelector('img')) splitText(unit);
      else atomic(unit);
    }
  }
  if (!current.childElementCount && pages.children.length > 1) current.parentElement.remove();
  source.remove();
  document.getElementById('font-probe').remove();
  const pageList = [...pages.children];
  for (const [index,page] of pageList.entries()) page.querySelector('.page-number').textContent = o.showPageNumbers ? (index+1) + ' / ' + pageList.length : '';
  let totalPixels = 0;
  for (const page of pageList) {
    const rect = page.getBoundingClientRect(); totalPixels += rect.width * rect.height;
    if (rect.width * rect.height > 16000000) throw new Error('单页图片超过像素上限，请调整尺寸。');
    const bodyRect = page.querySelector('.page-body').getBoundingClientRect();
    const headerRect = page.querySelector('.page-header').getBoundingClientRect();
    const footerRect = page.querySelector('.page-footer').getBoundingClientRect();
    const gap = 3 * scale(page.querySelector('.page-body'));
    if (headerRect.bottom > bodyRect.top - gap || footerRect.top < bodyRect.bottom + gap) throw new Error('页眉或页脚内容过长，请缩短文字或增加留白。');
  }
  if (totalPixels > 80000000) throw new Error('导出总像素超过上限，请减少内容或降低图片尺寸。');
  // Nested scroll containers must never silently hide content in a static image.
  for (const element of pages.querySelectorAll('.publication-dom *')) {
    if (!element.clientWidth || !element.clientHeight) continue;
    if (element.closest('.katex') && !element.classList.contains('katex')) continue;
    const style = getComputedStyle(element);
    if (style.overflowX !== 'visible' && element.scrollWidth > element.clientWidth + 1) report(element, 'horizontal-overflow');
    if (style.overflowY !== 'visible' && element.scrollHeight > element.clientHeight + 1) report(element, 'vertical-overflow');
  }
  if (longOverflow || diagnostics.length) throw Object.assign(new Error(longOverflow ? '长图中有超宽内容，请增大画幅或缩小字号。' : '正文中有超宽或超高的滚动内容，请增大画幅、缩小字号或拆分后重新导出。'), { diagnostics });
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.decode()));
  return pageList.map(page => ({ width: Math.round(page.getBoundingClientRect().width), height: Math.round(page.getBoundingClientRect().height) }));
})`;
