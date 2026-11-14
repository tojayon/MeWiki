import { expect, test, type Page, type Locator } from '@playwright/test';
import sharp from 'sharp';
import { createNotebookFixture } from '../src/domain/testUtils/notebook.ts';
import { createNativeProposal } from '../src/ai/nativeProposals.ts';
import { createAiSession } from '../src/ai/session.ts';
import { expandAiProposalCards, openAiWorkspace } from './helpers/ai.ts';

type CannonWindow = Window & { cannonStream: { opened: boolean; cancelled: boolean; requests: number; push: (events: unknown[], close?: boolean) => void } };
const retained = '这是保留的前文，用于说明知识之间的关联及条件，让修改发生在段落右侧。';
async function setup(page: Page, mode = 'edit', waitForArtwork = true, beforeLeft = '左侧原文。') {
  const state = createNotebookFixture(); state.open = true; state.view = 'notes'; state.activeNoteId = 'fixture-definition';
  state.notes.find(note => note.id === state.activeNoteId)!.theory = { annotations: [], relations: [] };
  state.notes.find(note => note.id === state.activeNoteId)!.blocks = [
    { id: 'cannon-left', type: 'paragraph', text: beforeLeft },
    { id: 'cannon-right', type: 'paragraph', text: retained + '旧结尾。' },
    ...Array.from({ length: 14 }, (_, i) => ({ id: `cannon-tail-${i}`, type: 'paragraph' as const, text: `保留的第 ${i + 1} 段，用于验证长文滚动。` })),
  ];
  await page.addInitScript(({ state, mode }) => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', mode);
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
    const fetchOriginal = window.fetch.bind(window);
    let turn = 0, stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encode = (event: unknown) => new TextEncoder().encode(JSON.stringify(event) + '\n');
    const harness = { opened: false, cancelled: false, requests: 0, push(events: unknown[], close = false) {
      for (const event of events) stream?.enqueue(encode(event));
      if (close) { stream?.close(); stream = null; }
    } };
    (window as CannonWindow).cannonStream = harness;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/mewiki/ai/chat')) return fetchOriginal(input, init);
      harness.requests = ++turn;
      if (turn !== 2) return new Response(encode({ type: 'done', result: { message: turn === 1
        ? { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'read_note', arguments: '{"noteId":"fixture-definition"}' }] }
        : { role: 'assistant', content: '修改已准备，请审阅。' }, usage: { inputTokens: 1, outputTokens: 1 } } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        stream = controller; harness.opened = true;
        init?.signal?.addEventListener('abort', () => { harness.cancelled = true; stream?.error(new DOMException('cancelled', 'AbortError')); stream = null; }, { once: true });
      }, cancel() { stream = null; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  }, { state, mode });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: 'cannon', providers: [{ id: 'cannon', name: '动效测试', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat', model: 'cannon-test', hasApiKey: false }] } }));
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  const ai = await openAiWorkspace(page);
  await ai.getByLabel('任务要求', { exact: true }).fill('修改当前笔记中的文字');
  await ai.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as CannonWindow).cannonStream.opened)).toBe(true);
  const cannon = page.getByTestId('mewiki-ai-text-cannon');
  if (waitForArtwork) await expect(cannon).toHaveAttribute('data-ready', 'true');
  return { ai, cannon, review: page.getByTestId('mewiki-ai-review') };
}
async function push(page: Page, key: string, argumentsText: string) {
  await page.evaluate(({ key, argumentsText }) => (window as CannonWindow).cannonStream.push([{ type: 'tool', update: { key, name: 'propose_note', arguments: argumentsText } }]), { key, argumentsText });
}
function draft(blockId: string, content: string) { return JSON.stringify({ operation: 'replace-text', noteId: 'fixture-definition', blockId, content }).slice(0, -2); }
async function shots(page: Page) { return Number(await page.getByTestId('mewiki-ai-text-cannon').getAttribute('data-shots') ?? 0); }
async function unchanged(page: Page) {
  const texts = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition').blocks.map((block: { text: string }) => block.text));
  expect(texts.slice(0, 2)).toEqual(['左侧原文。', retained + '旧结尾。']);
}

/** Observe painted positions, rather than treating a shot counter as visible motion. */
function observeFlight(page: Page) {
  return page.evaluate(() => new Promise<{ frames: number; distance: number }>(resolve => {
    const frames: { x: number; y: number }[] = [];
    let projectile: HTMLElement | null = null, finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; observer.disconnect(); clearTimeout(timeout);
      const first = frames[0];
      resolve({ frames: frames.length, distance: first ? Math.max(...frames.map(point => Math.hypot(point.x - first.x, point.y - first.y))) : 0 });
    };
    const sample = () => {
      if (finished) return;
      if (!projectile?.isConnected) { finish(); return; }
      const box = projectile.getBoundingClientRect(), style = getComputedStyle(projectile);
      if (style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > .2
        && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth) {
        frames.push({ x: box.x, y: box.y });
      }
      requestAnimationFrame(sample);
    };
    const observer = new MutationObserver(() => {
      if (projectile) return;
      projectile = document.querySelector<HTMLElement>('.mewiki-ai-cannon-projectile');
      if (projectile) requestAnimationFrame(sample);
    });
    const timeout = setTimeout(finish, 3000);
    observer.observe(document.body, { childList: true, subtree: true });
  }));
}

async function textInk(element: Locator, path?: string) {
  const { data, info } = await sharp(await element.screenshot({ path })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] < 140 && data[offset + 1] < 150 && data[offset + 2] < 150) ink++;
  }
  return ink;
}

async function changePaint(element: Locator, path?: string) {
  const { data, info } = await sharp(await element.screenshot({ path,
    style: '.mewiki-ai-cannon-layer, .mewiki-ai-cannon-layer * { visibility: hidden !important; }',
  })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let redFill = 0, greenFill = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    if (r === 247 && g === 203 && b === 208) redFill++;
    if (r === 188 && g === 228 && b === 200) greenFill++;
  }
  return { redFill, greenFill };
}

test('cannon aims from the real muzzle at left and right text and merges rapid deltas', async ({ page }, info) => {
  const { cannon } = await setup(page);
  const dock = cannon.locator('.mewiki-ai-cannon-dock');
  const layerBox = (await cannon.boundingBox())!, dockBox = (await dock.boundingBox())!;
  expect(dockBox.x + dockBox.width / 2).toBeCloseTo(layerBox.x + layerBox.width / 2, 0);
  expect(dockBox.y + dockBox.height).toBeCloseTo(layerBox.y + layerBox.height, 0);
  await expect(cannon).toHaveAttribute('aria-hidden', 'true');
  expect(await cannon.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  const base = await cannon.locator('[id$="carriage"]').evaluate(element => element.getBoundingClientRect().toJSON());
  await push(page, 'left', draft('cannon-left', '全新的左侧文字'));
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  expect(Number(await cannon.getAttribute('data-angle'))).toBeLessThan(0);
  await expect(cannon).toHaveAttribute('data-target-block', 'cannon-left');
  const firstShots = await shots(page);
  await push(page, 'right', draft('cannon-right', retained + '全新的右侧文字'));
  await expect.poll(() => shots(page)).toBeGreaterThan(firstShots);
  await expect.poll(() => cannon.getAttribute('data-target-block')).toBe('cannon-right');
  expect(Number(await cannon.getAttribute('data-angle'))).toBeGreaterThan(0);
  const geometry = await cannon.evaluate(layer => {
    const svg = layer.querySelector('svg')!, p = new DOMPoint(Number(svg.dataset.pivotX), Number(svg.dataset.pivotY)).matrixTransform(svg.getScreenCTM()!);
    const box = layer.getBoundingClientRect(), d = (layer as HTMLElement).dataset;
    return { px: p.x - box.left, py: p.y - box.top, ox: Number(d.originX), oy: Number(d.originY), tx: Number(d.targetX), ty: Number(d.targetY), angle: Number(d.angle) };
  });
  const { px, py, ox, oy, tx, ty, angle } = geometry;
  expect(angle).toBeCloseTo(Math.atan2(tx - px, py - ty) * 180 / Math.PI, 1);
  expect(Math.abs((ox - px) * (ty - py) - (oy - py) * (tx - px)) / Math.hypot(tx - px, ty - py)).toBeLessThan(1);
  const after = await cannon.locator('[id$="carriage"]').evaluate(element => element.getBoundingClientRect().toJSON());
  expect(after).toEqual(base);
  const count = await shots(page);
  for (const char of '连续生成的文字片段会合并发送') { await push(page, 'right', char); }
  await expect.poll(() => shots(page)).toBeGreaterThan(count);
  expect(await shots(page) - count).toBeLessThanOrEqual(3);
  await unchanged(page);
  await page.screenshot({ path: info.outputPath('cannon-desktop.png') });
});

async function finishImmediately(page: Page) {
  const args = draft('cannon-left', '这段完整修改会用文字炮弹逐段回放');
  await page.evaluate(args => (window as CannonWindow).cannonStream.push([{ type: 'done', result: { message: { role: 'assistant', content: '', toolCalls: [{ id: 'finished', name: 'propose_note', arguments: args + '"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } } }], true), args);
  await expect(page.getByTestId('mewiki-ai-review').locator('[data-review-block-id="cannon-left"] .mewiki-ai-diff-row[data-kind="add"]')).toContainText('这段完整修改会用文字炮弹逐段回放');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:library:default:ai-session:v1')!).status)).toBe('complete');
  await expect(page.getByTestId('mewiki-ai-text-cannon')).toHaveCount(0);
}

async function finishChanges(page: Page, changes: { blockId: string; content: string }[]) {
  await page.evaluate(changes => (window as CannonWindow).cannonStream.push([{ type: 'done', result: { message: { role: 'assistant', content: '',
    toolCalls: changes.map(({ blockId, content }, index) => ({ id: `finished-${index}`, name: 'propose_note', arguments: JSON.stringify({ operation: 'replace-text', noteId: 'fixture-definition', blockId, content }) })) }, usage: { inputTokens: 1, outputTokens: 1 } } }], true), changes);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:library:default:ai-session:v1')!).status)).toBe('complete');
  await expect(page.getByTestId('mewiki-ai-text-cannon')).toHaveCount(0);
}

async function pauseProjectiles(page: Page) {
  await page.evaluate(() => {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('mewiki-ai-cannon-projectile')) {
          for (const animation of node.getAnimations()) animation.pause();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function pauseLaserAndText(page: Page) {
  await page.evaluate(() => {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.matches('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-laser')) {
          for (const animation of node.getAnimations()) animation.pause();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

test('laser preserves two marked rows and turns old text red before cannon fills green text on impact', async ({ page }, info) => {
  const before = '完整前文甲乙丙丁完整后文。', after = '完整前文新内容完整后文。';
  const { cannon, review, ai } = await setup(page, 'edit', true, before);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: after }]);
  const block = review.locator('[data-review-block-id="cannon-left"]');
  const old = block.locator('del').first(), added = block.locator('ins').first();
  const originalRow = block.locator('.mewiki-ai-diff-row[data-kind="remove"]');
  const proposedRow = block.locator('.mewiki-ai-diff-row[data-kind="add"]');
  const rowBoxes = [await originalRow.boundingBox(), await proposedRow.boundingBox()];
  const persisted = await page.evaluate(() => ({ note: localStorage.getItem('mewiki:research-notebook'), session: localStorage.getItem('mewiki:library:default:ai-session:v1'), requests: (window as CannonWindow).cannonStream.requests }));
  await pauseLaserAndText(page);
  for (let replay = 0; replay < 2; replay++) {
    await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
    const laser = cannon.locator('.mewiki-ai-cannon-laser');
    await expect(laser).toHaveCount(1);
    await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
    await expect(block.locator('.mewiki-ai-review-before')).toContainText(before);
    await expect(originalRow.locator('.mewiki-ai-diff-sign')).toHaveCSS('background-color', 'rgb(251, 226, 227)');
    await expect(proposedRow.locator('.mewiki-ai-diff-sign')).toHaveCSS('background-color', 'rgb(220, 239, 225)');
    expect([await originalRow.boundingBox(), await proposedRow.boundingBox()]).toEqual(rowBoxes);
    await expect(block.locator('.mewiki-ai-review-after')).toHaveCSS('visibility', 'visible');
    expect(await old.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none');
    expect(await changePaint(old, info.outputPath(`scan-before-${replay}.png`))).toEqual({ redFill: 0, greenFill: 0 });
    expect(await changePaint(added)).toEqual({ redFill: 0, greenFill: 0 });
    expect(await textInk(added)).toBe(0);
    const originalInk = await textInk(old, info.outputPath(`original-${replay}.png`));
    expect(originalInk).toBeGreaterThan(80);
    if (!replay) await page.screenshot({ path: info.outputPath('laser-scene-original.png') });
    await laser.evaluate(element => { const animation = element.getAnimations()[0]; animation.currentTime = Number(animation.effect!.getTiming().duration) * .5; });
    await page.waitForTimeout(60);
    const partialPaint = await changePaint(old, info.outputPath(`laser-half-${replay}.png`));
    expect(partialPaint.redFill).toBeGreaterThan(10);
    expect(await textInk(old)).toBeGreaterThan(originalInk * .8);
    expect(await changePaint(added)).toEqual({ redFill: 0, greenFill: 0 });
    if (!replay) await page.screenshot({ path: info.outputPath('laser-scene-erasing.png') });
    await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
    await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    await expect(laser).toHaveCount(0);
    const projectile = cannon.locator('.mewiki-ai-cannon-projectile');
    await expect(projectile).toHaveCount(1);
    await expect(block.locator('.mewiki-ai-review-before')).toHaveCSS('visibility', 'visible');
    expect((await changePaint(old)).redFill).toBeGreaterThan(partialPaint.redFill);
    expect(await textInk(added)).toBe(0);
    expect((await changePaint(added)).greenFill).toBe(0);
    if (!replay) await page.screenshot({ path: info.outputPath('laser-scene-writing.png') });
    await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    await expect(projectile).toHaveCount(0);
    expect(await textInk(added)).toBeGreaterThan(10);
    expect((await changePaint(added)).greenFill).toBeGreaterThan(10);
    if (!replay) await page.screenshot({ path: info.outputPath('laser-scene-filled.png') });
    await review.getByRole('button', { name: '停止回放', exact: true }).click();
    await expect(cannon).toHaveCount(0);
    await expect(block.locator('[data-cannon-phase]')).toHaveCount(0);
    await expect(old).toBeVisible(); await expect(added).toBeVisible();
  }
  expect(await page.evaluate(() => ({ note: localStorage.getItem('mewiki:research-notebook'), session: localStorage.getItem('mewiki:library:default:ai-session:v1'), requests: (window as CannonWindow).cannonStream.requests }))).toEqual(persisted);
});

test('laser skips unchanged original words when replay only adds text', async ({ page }) => {
  const before = '保留完整原文。';
  const { cannon, review, ai } = await setup(page, 'edit', true, before);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: before + '新增内容' }]);
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  await expect(cannon.locator('.mewiki-ai-cannon-laser')).toHaveCount(0);
  await expect(review.locator('[data-review-block-id="cannon-left"] .mewiki-ai-review-after')).toContainText(before);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
});

test('laser handles a pure deletion before a separate addition in the same note', async ({ page }, info) => {
  const before = '保留第一行。\n待删除的独立原文。\n保留最后一行。';
  const { cannon, review, ai } = await setup(page, 'edit', true, before);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '保留第一行。\n保留最后一行。\n新增内容' }]);
  const block = review.locator('[data-review-block-id="cannon-left"]');
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  const laser = cannon.locator('.mewiki-ai-cannon-laser');
  await expect(laser).toHaveCount(1);
  expect(await shots(page)).toBe(0);
  await page.screenshot({ path: info.outputPath('pure-deletion-original.png') });
  await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(laser).toHaveCount(0);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  const added = block.locator('ins').first();
  expect(await textInk(added)).toBe(0);
  await cannon.locator('.mewiki-ai-cannon-projectile').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  expect(await textInk(added)).toBeGreaterThan(10);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(block.locator('del')).toBeVisible();
  await expect(block.locator('[data-cannon-phase]')).toHaveCount(0);
});

test('laser cancellation restores original and proposed text without a late projectile', async ({ page }) => {
  const before = '甲👨‍👩‍👧‍👦e\u0301乙';
  const { cannon, review, ai } = await setup(page, 'edit', true, before);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '新内容' }]);
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  const laser = cannon.locator('.mewiki-ai-cannon-laser');
  await expect(laser).toHaveCount(1);
  await laser.evaluate(element => { const animation = element.getAnimations()[0]; animation.currentTime = Number(animation.effect!.getTiming().duration) * .5; });
  await page.waitForTimeout(60);
  const removedOffsets = await review.locator('[data-review-block-id="cannon-left"] del').evaluate(element => [...CSS.highlights.values()]
    .flatMap(highlight => [...highlight].filter(range => element.contains(range.startContainer)).map(range => range.endOffset)));
  expect(removedOffsets).toEqual(['甲👨‍👩‍👧‍👦'.length]);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(review.locator('[data-cannon-phase]')).toHaveCount(0);
  await expect(review.locator('[data-review-block-id="cannon-left"] del')).toBeVisible();
  await expect(review.locator('[data-review-block-id="cannon-left"] ins')).toBeVisible();
  expect(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('mewiki-cannon-')))).toEqual([]);
});

test('live laser finishes deletion before sending the newest streamed text', async ({ page }) => {
  const { cannon, review, ai } = await setup(page, 'edit', true, '甲乙丙丁');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await pauseLaserAndText(page);
  await push(page, 'left', draft('cannon-left', '新结果'));
  const laser = cannon.locator('.mewiki-ai-cannon-laser'), projectile = cannon.locator('.mewiki-ai-cannon-projectile');
  await expect(laser).toHaveCount(1);
  await push(page, 'left', '继续到达');
  await expect(projectile).toHaveCount(0);
  await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(laser).toHaveCount(0);
  await expect(projectile).toHaveCount(1);
  await expect(projectile).toContainText('新结果继续到达');
  const added = review.locator('[data-review-block-id="cannon-left"] ins');
  expect(await textInk(added)).toBe(0);
  await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(projectile).toHaveCount(0);
  const landed = await textInk(added);
  expect(landed).toBeGreaterThan(80);
  await push(page, 'left', '再次抵达');
  await expect(projectile).toHaveCount(1);
  await expect(laser).toHaveCount(0);
  expect(await textInk(added)).toBe(landed);
});

test('live laser handles old text splitting into new deletion nodes while streaming', async ({ page }) => {
  const { cannon, review, ai } = await setup(page, 'edit', true, '甲乙丙丁');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await pauseLaserAndText(page);
  await push(page, 'left', draft('cannon-left', '甲'));
  const laser = cannon.locator('.mewiki-ai-cannon-laser');
  await expect(laser).toHaveCount(1);
  await push(page, 'left', '丙新');
  await expect(review.locator('[data-review-block-id="cannon-left"] del')).toHaveCount(2);
  for (let i = 0; i < 4; i++) {
    if (await cannon.locator('.mewiki-ai-cannon-projectile').count()) break;
    await expect(laser).toHaveCount(1);
    await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    await expect.poll(async () => await laser.count() + await cannon.locator('.mewiki-ai-cannon-projectile').count()).toBe(1);
  }
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toContainText('新');
});

test('live changes complete the first deletion and insertion group before the later group', async ({ page }) => {
  const { cannon, review, ai } = await setup(page, 'edit', true, '甲甲\n中间保留行。\n乙乙');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await pauseLaserAndText(page);
  await push(page, 'left', draft('cannon-left', '丙丙\n中间保留行。\n丁丁'));
  const laser = cannon.locator('.mewiki-ai-cannon-laser'), projectile = cannon.locator('.mewiki-ai-cannon-projectile');
  await expect(laser).toHaveCount(1);
  const activeRemoval = () => review.locator('[data-review-block-id="cannon-left"] .mewiki-ai-review-pair[data-cannon-phase="delete"] del');
  const firstBefore = await activeRemoval().first().boundingBox();
  const beamTarget = await cannon.locator('.mewiki-ai-cannon-laser-tip').boundingBox();
  expect(Math.abs(beamTarget!.y - firstBefore!.y)).toBeLessThan(25);
  await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(projectile).toHaveCount(1);
  await expect(projectile).toHaveText('丙丙');
  await expect(laser).toHaveCount(0);
  await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(laser).toHaveCount(1);
  await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(projectile).toHaveCount(1);
  await expect(projectile).toHaveText('丁丁');
});

test('long original deletion follows visible pages before any insertion starts', async ({ page }) => {
  const { cannon, review, ai } = await setup(page, 'edit', true, '甲乙丙丁'.repeat(400));
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '全新结果' }]);
  await page.setViewportSize({ width: 1200, height: 560 });
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await scroll.evaluate(element => { element.scrollTop = 0; });
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  const laser = cannon.locator('.mewiki-ai-cannon-laser');
  await expect(laser).toHaveCount(1);
  const position = await scroll.evaluate(element => element.scrollTop);
  await laser.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(laser, 'A long deletion must continue scanning instead of disappearing off screen').toHaveCount(1);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(position + 100);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
});

test('long old and new rows keep the later reading position and fill only the visible new text', async ({ page }) => {
  const { cannon, review, ai } = await setup(page, 'edit', true, '甲乙丙丁'.repeat(300));
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '戊己庚辛'.repeat(300) }]);
  await page.setViewportSize({ width: 1200, height: 560 });
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await scroll.evaluate(element => {
    const text = element.querySelector('[data-review-block-id="cannon-left"] ins')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 650); range.setEnd(text, 651);
    element.scrollTop += range.getBoundingClientRect().top - element.getBoundingClientRect().top - 32;
  });
  const position = await scroll.evaluate(element => element.scrollTop);
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  await expect(cannon.locator('.mewiki-ai-cannon-laser')).toHaveCount(0);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(position - 1);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
});

test('a pure deletion above the viewport still restores and scans its nearest original', async ({ page }) => {
  const { cannon, review, ai } = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '。' }]);
  await page.setViewportSize({ width: 1200, height: 460 });
  await review.locator('.mewiki-ai-review-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon.locator('.mewiki-ai-cannon-laser')).toHaveCount(1);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await unchanged(page);
});

test('deleting an entire tab container scans its original body as well as its inner title', async ({ page }) => {
  const state = createNotebookFixture(); state.activeNoteId = 'fixture-definition'; state.view = 'notes'; state.open = true;
  state.notes.find(note => note.id === state.activeNoteId)!.blocks = [{ id: 'whole-tabs', type: 'examples', title: '待删除的标签组', tabs: [
    { id: 'only', title: '原标签', blocks: [{ id: 'nested-body', type: 'paragraph', text: '完整的嵌套原文应该随激光逐字消失，不能只删除标签标题。' }] },
  ] }];
  const proposal = createNativeProposal(state, 'default', { action: 'block-delete', noteId: 'fixture-definition', blockId: 'whole-tabs' });
  await page.addInitScript(({ state, session }) => {
    localStorage.setItem('mewiki:research-notebook', JSON.stringify(state));
    localStorage.setItem('mewiki:library:default:ai-session:v1', JSON.stringify(session));
    localStorage.setItem('mewiki:locale', 'zh-CN');
    localStorage.setItem('mewiki:research-notebook-mode', 'edit');
    localStorage.setItem('mewiki:research-notebook-outline-collapsed', 'true');
  }, { state, session: { ...createAiSession('default'), proposals: [proposal] } });
  await page.route('**/api/mewiki/ai/settings', route => route.fulfill({ json: { revision: '0', defaultProviderId: null, providers: [] } }));
  await page.goto('/');
  const ai = await openAiWorkspace(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '查看修改', exact: true }).click();
  const review = page.getByTestId('mewiki-ai-review'), cannon = page.getByTestId('mewiki-ai-text-cannon');
  const body = review.locator('[data-review-block-id="nested-body"] .research-markdown');
  const originalInk = await textInk(body);
  await pauseLaserAndText(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  const laser = cannon.locator('.mewiki-ai-cannon-laser');
  await expect(laser).toHaveCount(1);
  await laser.evaluate(element => { const animation = element.getAnimations()[0]; animation.currentTime = Number(animation.effect!.getTiming().duration) * .8; });
  await page.waitForTimeout(60);
  expect((await changePaint(body)).redFill).toBeGreaterThan(20);
  expect(await textInk(body)).toBeGreaterThan(originalInk * .8);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  expect(await textInk(body)).toBe(originalInk);
});

test('replay includes every changed phrase beyond eight shots and restores the full review', async ({ page }, info) => {
  const before = Array.from({ length: 12 }, (_, i) => `条件${i + 1}：旧；`).join('');
  const { cannon, review, ai } = await setup(page, 'edit', true, before);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: before.replaceAll('旧', '新') }]);
  const changed = review.locator('[data-review-block-id="cannon-left"] ins');
  await expect(changed).toHaveCount(12);
  const persisted = await page.evaluate(() => ({ notebook: localStorage.getItem('mewiki:research-notebook'), session: localStorage.getItem('mewiki:library:default:ai-session:v1'), requests: (window as CannonWindow).cannonStream.requests }));
  await pauseProjectiles(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await textInk(changed.nth(8), info.outputPath('ninth-before.png')), 'The ninth change must wait for its hit too').toBe(0);
  for (let i = 0; i < 12; i++) {
    const projectile = cannon.locator('.mewiki-ai-cannon-projectile');
    await expect(projectile, `Change ${i + 1} must have a projectile`).toHaveCount(1);
    expect(await textInk(changed.nth(i))).toBe(0);
    await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    await expect(projectile).toHaveCount(0);
    await expect(cannon.locator('.mewiki-ai-cannon-impact')).toHaveCount(0);
    expect(await textInk(changed.nth(i))).toBeGreaterThan(10);
  }
  expect(await shots(page)).toBe(12);
  await page.screenshot({ path: info.outputPath('all-twelve-landed.png') });
  await expect(cannon).toHaveCount(0);
  expect(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('mewiki-cannon-')))).toEqual([]);
  expect(await page.evaluate(() => ({ notebook: localStorage.getItem('mewiki:research-notebook'), session: localStorage.getItem('mewiki:library:default:ai-session:v1'), requests: (window as CannonWindow).cannonStream.requests }))).toEqual(persisted);
});

test('replay starts at the visible later change and continues forward without jumping to the first edit', async ({ page }, info) => {
  await page.setViewportSize({ width: 1200, height: 620 });
  const { cannon, review, ai } = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '甲' }, { blockId: 'cannon-tail-8', content: '乙' }, { blockId: 'cannon-tail-13', content: '丙' }]);
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await scroll.evaluate(element => {
    const target = element.querySelector('[data-review-block-id="cannon-tail-8"]')!;
    element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 64;
  });
  const beforeScroll = await scroll.evaluate(element => element.scrollTop);
  expect(beforeScroll).toBeGreaterThan(150);
  await pauseProjectiles(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  const projectile = cannon.locator('.mewiki-ai-cannon-projectile');
  await expect(projectile).toHaveCount(1);
  expect(await cannon.getAttribute('data-target-block'), 'The first flight must stay at the currently visible later change').toBe('cannon-tail-8');
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(beforeScroll - 1);
  const current = review.locator('[data-review-block-id="cannon-tail-8"] ins').first();
  expect(await textInk(current)).toBe(0);
  await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(projectile).toHaveCount(0);
  await expect(cannon.locator('.mewiki-ai-cannon-impact')).toHaveCount(0);
  expect(await textInk(current)).toBeGreaterThan(10);
  await page.screenshot({ path: info.outputPath('later-start.png') });
  await expect(projectile).toHaveCount(1);
  await expect(cannon).toHaveAttribute('data-target-block', 'cannon-tail-13');
  await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(projectile).toHaveCount(0);
  await expect(cannon.locator('.mewiki-ai-cannon-impact')).toHaveCount(0);
  expect(await textInk(review.locator('[data-review-block-id="cannon-tail-13"] ins').first())).toBeGreaterThan(10);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(beforeScroll);
  await expect(cannon).toHaveCount(0);
  await unchanged(page);
});

test('replay finds the next change from an unchanged gap', async ({ page }) => {
  const { cannon, review, ai } = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '甲' }, { blockId: 'cannon-tail-13', content: '乙' }]);
  await page.setViewportSize({ width: 1200, height: 460 });
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await scroll.evaluate(element => {
    const target = element.querySelector('[data-review-block-id="cannon-tail-13"]')!;
    element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight - 70;
  });
  const before = await scroll.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(150);
  expect(await scroll.locator('ins').evaluateAll(elements => {
    const viewport = document.querySelector('.mewiki-ai-review-scroll')!.getBoundingClientRect();
    return elements.filter(element => { const box = element.getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom; }).length;
  })).toBe(0);
  await pauseProjectiles(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await cannon.getAttribute('data-target-block')).toBe('cannon-tail-13');
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0); await unchanged(page);
});

test('replay begins on the visible line inside a long change rather than its hidden first line', async ({ page }, info) => {
  const { cannon, review, ai } = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '甲乙丙丁'.repeat(300) }]);
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await scroll.evaluate(element => {
    const text = element.querySelector('[data-review-block-id="cannon-left"] ins')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 600); range.setEnd(text, 601);
    element.scrollTop += range.getBoundingClientRect().top - element.getBoundingClientRect().top - 32;
  });
  const before = await scroll.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(200);
  await pauseProjectiles(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(before - 1);
  const offsets = await page.evaluate(() => [...CSS.highlights.values()].flatMap(highlight => [...highlight].map(range => range.startOffset)));
  expect(Math.max(...offsets)).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath('long-change-current-line.png') });
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0); await unchanged(page);
});

test('replay at the end chooses the nearest preceding change instead of the first change', async ({ page }) => {
  const { cannon, review, ai } = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishChanges(page, [{ blockId: 'cannon-left', content: '甲' }, { blockId: 'cannon-tail-2', content: '乙' }]);
  await page.setViewportSize({ width: 1200, height: 460 });
  const scroll = review.locator('.mewiki-ai-review-scroll');
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await scroll.locator('ins').evaluateAll(elements => {
    const viewport = document.querySelector('.mewiki-ai-review-scroll')!.getBoundingClientRect();
    return elements.every(element => element.getBoundingClientRect().bottom < viewport.top);
  })).toBe(true);
  await pauseProjectiles(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await cannon.getAttribute('data-target-block')).toBe('cannon-tail-2');
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0); await unchanged(page);
});

test('scrolling while replay artwork is loading cancels the captured origin without jumping back', async ({ page }) => {
  let release!: () => void;
  const artwork = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/brand/mewiki-text-cannon.svg*', async route => { await artwork; await route.continue(); });
  const { cannon, review } = await setup(page, 'edit', false);
  await finishChanges(page, [{ blockId: 'cannon-left', content: '甲' }, { blockId: 'cannon-tail-13', content: '乙' }]);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon).toHaveCount(1);
  await expect(cannon).not.toHaveAttribute('data-ready', 'true');
  await review.locator('.mewiki-ai-review-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(cannon, 'A user scroll must stop replay even before the SVG arrives').toHaveCount(0);
  const position = await review.locator('.mewiki-ai-review-scroll').evaluate(element => element.scrollTop);
  release();
  await expect(review.getByRole('button', { name: '回放大炮动效', exact: true })).toBeVisible();
  expect(await review.locator('.mewiki-ai-review-scroll').evaluate(element => element.scrollTop)).toBe(position);
  expect(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('mewiki-cannon-')))).toEqual([]);
  await unchanged(page);
});

test('failed replay artwork restores the normal replay button and all text', async ({ page }) => {
  await page.route('**/brand/mewiki-text-cannon.svg*', route => route.fulfill({ status: 404, body: 'missing' }));
  const { cannon, review } = await setup(page, 'edit', false);
  await expect(cannon).toHaveAttribute('data-ready', 'unavailable');
  await finishChanges(page, [{ blockId: 'cannon-left', content: '甲' }]);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon, 'An unavailable effect must finish its local replay state').toHaveCount(0);
  await expect(review.getByRole('button', { name: '回放大炮动效', exact: true })).toBeEnabled();
  expect(await textInk(review.locator('[data-review-block-id="cannon-left"] ins').first())).toBeGreaterThan(10);
  expect(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('mewiki-cannon-')))).toEqual([]);
  await unchanged(page);
});

test('cannon reveals each phrase after landing and restores the full review when stopped', async ({ page }, info) => {
  const { cannon, review } = await setup(page);
  await finishImmediately(page);
  const changed = review.locator('[data-review-block-id="cannon-left"] ins').first();
  const laterOld = review.locator('[data-review-block-id="cannon-left"] del').last();
  const laterOldInk = await textInk(laterOld);
  expect(laterOldInk).toBeGreaterThan(0);
  const fullInk = await textInk(changed);
  expect(fullInk).toBeGreaterThan(100);
  // Pause the actual flight to inspect the destination before and after its finish event.
  await page.evaluate(() => {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('mewiki-ai-cannon-projectile')) {
          for (const animation of node.getAnimations()) animation.pause();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await textInk(changed, info.outputPath('arrival-before.png')), 'New text must not be painted ahead of the projectile').toBe(0);
  expect((await changePaint(changed)).greenFill).toBe(0);
  await cannon.locator('.mewiki-ai-cannon-projectile').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  await expect(cannon.locator('.mewiki-ai-cannon-impact')).toHaveCount(0);
  const firstInk = await textInk(changed, info.outputPath('arrival-first-phrase.png'));
  const firstGreen = (await changePaint(changed)).greenFill;
  expect(firstInk).toBeGreaterThan(20);
  expect(firstGreen).toBeGreaterThan(20);
  expect(firstInk).toBeLessThan(fullInk * .7);
  await expect(laterOld, 'Scanned original wording remains available for comparison').toBeVisible();
  expect((await changePaint(laterOld)).redFill).toBeGreaterThan(0);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect((await changePaint(changed)).greenFill).toBe(firstGreen);
  await cannon.locator('.mewiki-ai-cannon-projectile').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  await expect(cannon.locator('.mewiki-ai-cannon-impact')).toHaveCount(0);
  const secondInk = await textInk(changed, info.outputPath('arrival-second-phrase.png'));
  expect(secondInk).toBeGreaterThan(firstInk);
  expect((await changePaint(changed)).greenFill).toBeGreaterThan(firstGreen);
  expect(secondInk).toBeLessThan(fullInk);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  expect(await textInk(changed)).toBe(fullInk);
  expect(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('mewiki-cannon-')))).toEqual([]);
  await unchanged(page);
});

for (const [name, content, delta] of [['one range', '崭新结果', '逐个抵达'], ['split ranges', '这段完整修改会用文字炮弹逐段回放', '继续抵达']]) {
test(`live cannon text waits for landing and keeps previously landed text with ${name}`, async ({ page }) => {
  const { cannon, review } = await setup(page);
  await page.evaluate(() => {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('mewiki-ai-cannon-projectile')) {
          for (const animation of node.getAnimations()) animation.pause();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await push(page, 'left', draft('cannon-left', content));
  const changed = review.locator('[data-review-block-id="cannon-left"] ins');
  const ink = async () => {
    let total = 0;
    for (const element of await changed.all()) total += await textInk(element);
    return total;
  };
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await ink()).toBe(0);
  await cannon.locator('.mewiki-ai-cannon-projectile').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(cannon.locator('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-impact')).toHaveCount(0);
  const landedInk = await ink();
  expect(landedInk).toBeGreaterThan(50);
  await push(page, 'left', delta);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(1);
  expect(await ink()).toBe(landedInk);
  await cannon.locator('.mewiki-ai-cannon-projectile').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(cannon.locator('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-impact')).toHaveCount(0);
  expect(await ink()).toBeGreaterThan(landedInk);
  await unchanged(page);
});
}

test('an unavailable cannon asset always leaves complete streaming text readable', async ({ page }) => {
  await page.route('**/brand/mewiki-text-cannon.svg*', route => route.fulfill({ status: 404, body: 'missing' }));
  const { cannon, review } = await setup(page, 'edit', false);
  await expect(cannon).toHaveAttribute('data-ready', 'unavailable');
  await push(page, 'left', draft('cannon-left', '崭新结果'));
  const changed = review.locator('[data-review-block-id="cannon-left"] ins').first();
  await expect(changed).toContainText('崭新结果');
  expect(await textInk(changed)).toBeGreaterThan(50);
  await push(page, 'left', '继续生成');
  await expect(changed).toContainText('继续生成');
  expect(await textInk(changed)).toBeGreaterThan(100);
  await unchanged(page);
});

test('automatic following cancels an old flight while preserving the next landing reveal', async ({ page }, info) => {
  const { cannon, review, ai } = await setup(page);
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await page.evaluate(() => {
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('mewiki-ai-cannon-projectile')) {
          for (const animation of node.getAnimations()) animation.pause();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await push(page, 'left', draft('cannon-left', '崭新结果'));
  const projectile = cannon.locator('.mewiki-ai-cannon-projectile');
  await expect(projectile).toHaveCount(1);
  const old = (await projectile.elementHandle())!;
  await push(page, 'right', draft('cannon-right', retained + '更新后的条件'));
  await expect.poll(() => old.evaluate(element => element.isConnected)).toBe(false);
  await expect(cannon).toHaveAttribute('data-target-block', 'cannon-right');
  await expect(projectile).toHaveCount(1);
  const changed = review.locator('[data-review-block-id="cannon-right"] ins').first();
  expect(await textInk(changed)).toBe(0);
  await projectile.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(cannon.locator('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-impact')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('follow-landed.png') });
  expect(await textInk(changed, info.outputPath('follow-text.png'))).toBeGreaterThan(50);
  await unchanged(page);
});

test('cannon replay works after an instant response and can finish and repeat without another request or write', async ({ page }, info) => {
  const { cannon, review, ai } = await setup(page);
  await finishImmediately(page);
  const before = await page.evaluate(() => ({ note: localStorage.getItem('mewiki:research-notebook'), session: localStorage.getItem('mewiki:library:default:ai-session:v1'), requests: (window as CannonWindow).cannonStream.requests }));
  const replay = review.getByRole('button', { name: '回放大炮动效', exact: true });
  await expect(replay).toBeEnabled();
  await replay.click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await expect(review.getByRole('button', { name: '停止回放', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('cannon-replay-desktop.png') });
  await expect(cannon).toHaveCount(0, { timeout: 10000 });
  await expect(replay).toBeEnabled();
  await replay.click();
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  expect(await page.evaluate(() => ({ note: localStorage.getItem('mewiki:research-notebook'), session: localStorage.getItem('mewiki:library:default:ai-session:v1'), requests: (window as CannonWindow).cannonStream.requests }))).toEqual(before);
  await replay.click(); await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('这段完整修改会用文字炮弹逐段回放');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await unchanged(page);
});

test('cannon replay stops on Escape, scroll, source mode and leaving the preview', async ({ page }) => {
  const { cannon, review } = await setup(page);
  await finishImmediately(page);
  const replay = review.getByRole('button', { name: '回放大炮动效', exact: true });
  await review.locator('.mewiki-ai-review-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await replay.click();
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(cannon).toHaveCount(0); await expect(review).toBeVisible();
  await replay.click(); await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await review.locator('.mewiki-ai-review-scroll').evaluate(element => { element.scrollTop += 170; });
  await expect(cannon).toHaveCount(0);
  await replay.click(); await expect(cannon).toHaveAttribute('data-ready', 'true');
  await review.getByRole('button', { name: '查看源码差异', exact: true }).click();
  await expect(cannon).toHaveCount(0); await expect(replay).toHaveCount(0);
  await review.getByRole('button', { name: '查看渲染差异', exact: true }).click();
  await expect(cannon).toHaveCount(0); await replay.click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(cannon).toHaveCount(0); await unchanged(page);
});

test('explicit cannon replay visibly moves in a narrow read-only preview with reduced system motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { cannon, review, ai } = await setup(page, 'read');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await finishImmediately(page);
  const flight = observeFlight(page);
  await review.getByRole('button', { name: '回放大炮动效', exact: true }).click();
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await expect(cannon).toHaveAttribute('data-reduced-motion', 'true');
  const motion = await flight;
  expect(motion.frames, 'Explicit replay must paint the text projectile across multiple frames').toBeGreaterThanOrEqual(3);
  expect(motion.distance, 'The text must actually travel toward the edit').toBeGreaterThan(24);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeDisabled();
  await expect(review.getByRole('button', { name: '停止回放', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('cannon-replay-mobile-reduced.png') });
  await review.getByRole('button', { name: '停止回放', exact: true }).click();
  await expect(cannon).toHaveCount(0); await unchanged(page);
});

test('cannon clears flights on scroll, navigation, source mode and stop without saving', async ({ page }) => {
  const { cannon, review, ai } = await setup(page);
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition'));
  await push(page, 'left', draft('cannon-left', '仅供动效预览的内容'));
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await review.locator('.mewiki-ai-review-scroll').evaluate(element => { element.scrollTop += 180; });
  await expect(cannon.locator('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-impact')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...CSS.highlights.values()].reduce((count, highlight) => count + highlight.size, 0))).toBe(0);
  await review.getByRole('button', { name: '查看源码差异', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await review.getByRole('button', { name: '查看渲染差异', exact: true }).click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  expect(await shots(page)).toBe(0);
  await page.locator('#research-notebook-sidebar').getByText('结果摘要', { exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await expect(review).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mewiki:research-notebook')!).notes.find((note: { id: string }) => note.id === 'fixture-definition'))).toEqual(original);
  await ai.getByRole('button', { name: '跟随 AI 修改', exact: true }).click();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  expect(await shots(page)).toBe(0);
  await push(page, 'left', '继续生成');
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await review.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as CannonWindow).cannonStream.cancelled)).toBe(true);
  await unchanged(page);
});

test('cannon fits a narrow viewport and removes every effect on exit', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 680 });
  const { cannon, review, ai } = await setup(page, 'read');
  await ai.getByRole('button', { name: '嵌入右侧栏', exact: true }).click();
  await push(page, 'left', draft('cannon-left', '手机上的文字炮弹'));
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  const dock = (await cannon.locator('.mewiki-ai-cannon-dock').boundingBox())!, box = (await cannon.boundingBox())!;
  expect(dock.x).toBeGreaterThanOrEqual(0); expect(dock.x + dock.width).toBeLessThanOrEqual(390);
  expect(dock.y + dock.height).toBeCloseTo(box.y + box.height, 0);
  expect(await review.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(review.getByRole('button', { name: '停止任务', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('cannon-mobile.png') });
  await page.setViewportSize({ width: 390, height: 380 });
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  await review.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(cannon).toHaveCount(0);
  await unchanged(page);
});

test('cannon respects reduced motion and leaves completed edits for approval and undo', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { cannon, review, ai } = await setup(page);
  await expect(cannon).toHaveAttribute('data-reduced-motion', 'true');
  const args = draft('cannon-left', '审阅通过之后才写入');
  await push(page, 'left', args);
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  expect(await cannon.locator('[id$="aim"]').evaluate(element => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  expect(await cannon.locator('[id$="barrel"]').evaluate(element => element.getAnimations().length)).toBe(0);
  expect(await textInk(review.locator('[data-review-block-id="cannon-left"] ins').first())).toBeGreaterThan(50);
  await unchanged(page);
  await page.screenshot({ path: info.outputPath('cannon-reduced-motion.png') });
  await page.evaluate(args => (window as CannonWindow).cannonStream.push([{ type: 'done', result: { message: { role: 'assistant', content: '', toolCalls: [{ id: 'finished', name: 'propose_note', arguments: args + '"}' }] }, usage: { inputTokens: 1, outputTokens: 1 } } }], true), args);
  await expect(cannon).toHaveCount(0);
  await expect(review.getByRole('button', { name: '应用建议', exact: true })).toBeEnabled();
  await unchanged(page);
  await review.getByRole('button', { name: '应用建议', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mewiki:research-notebook'))).toContain('审阅通过之后才写入');
  await expandAiProposalCards(ai);
  await ai.getByRole('button', { name: '撤回此修改', exact: true }).click();
  await unchanged(page);
});

test('cannon keeps firing through sustained streaming and cancels motion when preferences change', async ({ page }) => {
  const { cannon } = await setup(page);
  await push(page, 'left', draft('cannon-left', '持续'));
  await page.evaluate(async () => {
    for (const letter of '生成中的片段会按节奏合并，不会每一个字都发射，也不会因为连续更新而停止发射。') {
      (window as CannonWindow).cannonStream.push([{ type: 'tool', update: { key: 'left', name: 'propose_note', arguments: letter } }]);
      await new Promise(resolve => setTimeout(resolve, 35));
    }
  });
  await expect.poll(() => shots(page)).toBeGreaterThanOrEqual(3);
  expect(await shots(page)).toBeLessThanOrEqual(8);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(cannon).toHaveAttribute('data-reduced-motion', 'true');
  await expect(cannon.locator('.mewiki-ai-cannon-projectile')).toHaveCount(0);
  await expect.poll(() => cannon.locator('[id$="aim"]').evaluate(element => ({
    computed: getComputedStyle(element).transform,
    inline: (element as SVGElement).style.transform,
    animations: element.getAnimations().length,
  }))).toEqual({ computed: 'matrix(1, 0, 0, 1, 0, 0)', inline: 'rotate(0deg)', animations: 0 });
  expect(await cannon.locator('[id$="barrel"]').evaluate(element => element.getAnimations().length)).toBe(0);
  const count = await shots(page);
  await push(page, 'left', '静态落点');
  await expect.poll(() => shots(page)).toBeGreaterThan(count);
  await page.setViewportSize({ width: 390, height: 180 });
  await expect(cannon.locator('.mewiki-ai-cannon-dock')).toBeHidden();
  await expect(cannon.locator('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-impact')).toHaveCount(0);
  await unchanged(page);
});

test('cannon fires the first live change even when its artwork loads after the text', async ({ page }) => {
  let release!: () => void;
  const artwork = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/brand/mewiki-text-cannon.svg*', async route => { await artwork; await route.continue(); });
  const { cannon, review } = await setup(page, 'edit', false);
  await push(page, 'left', draft('cannon-left', '先收到的修改片段'));
  await expect(review.locator('ins')).toContainText('先收到的修改片段');
  release();
  await expect(cannon).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => shots(page)).toBeGreaterThan(0);
  await unchanged(page);
});
