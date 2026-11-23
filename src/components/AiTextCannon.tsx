import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import type { AiProposal } from '../ai/proposals.ts';
import type { AiReviewLocation } from '../ai/reviewDecisions.ts';
import { cannonEraseSteps, cannonFragment, cannonReplaySteps, cannonShot, type CannonPoint } from './aiTextCannon.ts';
import { cannonAdditions, cannonRemovals, cannonLeaves, cannonPair, cannonIsRemoval, cannonTextRange, cannonReplayTargets, createCannonTextReveal, type CannonReplayTarget } from './aiCannonTextReveal.ts';
import './AiTextCannon.css';

const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)';
const shotInterval = 320;
let cachedArtwork: string | undefined;
interface CueSnapshot { key: string; element: HTMLElement; text: string; blockId: string }
interface Cue extends CueSnapshot { batch?: CueSnapshot[] }
type Phrase = ReturnType<typeof cannonReplaySteps>[number];

function mountScene(layer: HTMLDivElement, scroll: HTMLDivElement, svg: SVGSVGElement, prefix: string, reveal: ReturnType<typeof createCannonTextReveal>, followScrollRef: RefObject<number | null>) {
  const dock = layer.querySelector<HTMLDivElement>('.mewiki-ai-cannon-dock')!;
  const aim = svg.querySelector<SVGGElement>(`#${prefix}aim`)!;
  const barrel = svg.querySelector<SVGGElement>(`#${prefix}barrel`)!;
  const origin = svg.querySelector<SVGGElement>(`#${prefix}muzzle-origin`)!;
  const px = Number(svg.dataset.pivotX), py = Number(svg.dataset.pivotY);
  aim.style.transformBox = 'view-box'; aim.style.transformOrigin = `${px}px ${py}px`;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set<Animation>();
  const seen = new Map<string, string>(), fired = new Map<string, string>();
  let pending: Cue | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let backlog: Cue[] = [], liveBusy = false;
  let nextShot = 0, turn: Animation | null = null, disposed = false;
  let aiming: { cue: Cue } | null = null;
  let preparing: { cue: Cue } | null = null, generation = 0, laserFrame = 0;
  let previousSize = '';
  let currentTarget: string | null = null;
  let replayRequested = false, replayActive = false, expectedScroll: number | null = null;
  let replayTimer: ReturnType<typeof setTimeout> | undefined, replayDone: (() => void) | undefined;
  // Explicit playback opts into motion for this replay only; live updates keep the system preference.
  const reduceMotion = () => media.matches && !replayActive;
  const releaseCue = (cue: Cue) => { for (const part of [cue, ...cue.batch ?? []]) reveal.release(part.element); };
  const point = (value: CannonPoint): CannonPoint => ({ x: value.x - layer.getBoundingClientRect().left, y: value.y - layer.getBoundingClientRect().top });
  const track = (animation: Animation, element?: Element) => {
    animations.add(animation);
    void animation.finished.then(() => { animations.delete(animation); element?.remove(); }, () => { animations.delete(animation); element?.remove(); });
    return animation;
  };
  const cancelMotion = (restore = true) => {
    aiming = null; preparing = null; liveBusy = false; generation++; cancelAnimationFrame(laserFrame);
    turn?.cancel(); turn = null;
    for (const animation of animations) animation.cancel();
    animations.clear();
    layer.querySelectorAll('.mewiki-ai-cannon-projectile, .mewiki-ai-cannon-impact, .mewiki-ai-cannon-laser, .mewiki-ai-cannon-laser-tip').forEach(element => element.remove());
    if (restore) reveal.clear();
  };
  const dropPending = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; pending = null; backlog = []; };
  const stopReplay = (notify = true) => {
    const wasActive = replayActive;
    replayActive = false; expectedScroll = null;
    if (replayTimer !== undefined) clearTimeout(replayTimer);
    replayTimer = undefined; layer.dataset.replay = 'false';
    cancelMotion(); dropPending();
    if (wasActive && notify && !disposed) replayDone?.();
  };
  const resize = () => {
    const box = layer.getBoundingClientRect();
    const sizeKey = `${box.width}:${box.height}`;
    if (sizeKey === previousSize) return;
    previousSize = sizeKey;
    stopReplay();
    const size = Math.min(144, Math.max(80, box.height * .24), box.width * .4);
    dock.style.width = `${size}px`; dock.style.height = `${size}px`;
    dock.hidden = box.height < 150 || box.width < 180;
  };
  const visibility = () => { stopReplay(); };
  const preference = () => {
    stopReplay();
    layer.dataset.reducedMotion = String(media.matches);
    if (media.matches) aim.style.transform = 'rotate(0deg)';
  };
  const targetPoint = (element: HTMLElement, phrase?: Pick<Phrase, 'start' | 'end'>, includeHidden = false) => {
    if (!element.isConnected || dock.hidden || document.hidden) return null;
    const viewport = scroll.getBoundingClientRect(), top = dock.getBoundingClientRect().top;
    if (!viewport.width || !viewport.height || !includeHidden && !element.checkVisibility({ checkVisibilityCSS: true })) return null;
    const range = cannonTextRange(element, phrase?.start, phrase?.end);
    const rects = [...range.getClientRects()];
    if (!rects.length) rects.push(element.getBoundingClientRect());
    const visible = rects.filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > viewport.top + 4
      && rect.top < Math.min(viewport.bottom, top) - 8 && rect.right > viewport.left && rect.left < viewport.right);
    const rect = visible.at(-1);
    return rect ? point({ x: Math.max(viewport.left + 12, Math.min(viewport.right - 12, (rect.left + rect.right) / 2)),
      y: Math.max(viewport.top + 12, Math.min(Math.min(viewport.bottom, top) - 12, (rect.top + rect.bottom) / 2)) }) : null;
  };
  const pivotPoint = () => {
    const matrix = svg.getScreenCTM();
    return matrix ? point(new DOMPoint(px, py).matrixTransform(matrix)) : null;
  };
  const impact = (target: CannonPoint) => {
    const glow = document.createElement('span'); glow.className = 'mewiki-ai-cannon-impact';
    glow.style.transform = `translate(${target.x - 14}px, ${target.y - 14}px)`;
    layer.append(glow);
    track(glow.animate([{ opacity: .65 }, { opacity: 0 }], { duration: 180, easing: easeOut }), glow);
  };
  const fire = (cue: Cue, phrase?: Phrase, done?: () => void) => {
    const skip = () => { releaseCue(cue); done?.(); };
    if (disposed || !cue.element.isConnected) { skip(); return; }
    const target = targetPoint(cue.element, phrase), pivot = pivotPoint();
    if (!target || !pivot) { skip(); return; }
    const text = phrase?.text ?? cannonFragment(fired.get(cue.key) ?? '', cue.text);
    if (!text) { skip(); return; }
    const matrix = svg.getScreenCTM();
    if (!matrix) { skip(); return; }
    // Streaming text can reflow while aiming. Keep the muzzle on the final ray.
    const distance = Math.abs(py - Number(svg.dataset.muzzleY)) * Math.hypot(matrix.a, matrix.b);
    const shot = cannonShot(pivot, target, distance);
    if (!shot) { skip(); return; }
    fired.set(cue.key, cue.text);
    for (const part of cue.batch ?? []) fired.set(part.key, part.text);
    layer.dataset.shots = String(Number(layer.dataset.shots ?? 0) + 1);
    layer.dataset.targetBlock = cue.blockId;
    if (reduceMotion()) { releaseCue(cue); impact(target); done?.(); return; }
    aim.style.transform = `rotate(${shot.angle}deg)`; layer.dataset.angle = String(shot.angle);
    const muzzleMatrix = origin.getScreenCTM();
    if (!muzzleMatrix) { skip(); return; }
    const start = point(new DOMPoint().matrixTransform(muzzleMatrix));
    layer.dataset.originX = String(start.x); layer.dataset.originY = String(start.y);
    layer.dataset.targetX = String(target.x); layer.dataset.targetY = String(target.y);
    const projectile = document.createElement('span'); projectile.className = 'mewiki-ai-cannon-projectile';
    projectile.textContent = text;
    layer.append(projectile);
    const width = projectile.offsetWidth, height = projectile.offsetHeight;
    const position = (x: number, y: number) => `translate(${x - width / 2}px, ${y - height / 2}px)`;
    const flight = track(projectile.animate([
      { transform: position(start.x, start.y), opacity: 0 },
      { transform: position(start.x + (target.x - start.x) * .12, start.y + (target.y - start.y) * .12), opacity: 1, offset: .12 },
      { transform: position(target.x, target.y), opacity: .95 },
    ], { duration: 260, easing: 'linear' }), projectile);
    void flight.finished.then(() => {
      if (!disposed) {
        reveal.land(cue.element, cue.text, phrase?.end);
        for (const part of cue.batch ?? []) reveal.land(part.element, part.text);
        impact(target);
        done?.();
      }
    }, () => {});
    track(barrel.animate([{ transform: 'translateY(0px)' }, { transform: 'translateY(12px)', offset: .28 }, { transform: 'translateY(0px)' }], { duration: 180, easing: easeOut }));
  };
  const launch = (cue: Cue, phrase?: Phrase, done?: () => void) => {
    const target = targetPoint(cue.element, phrase), pivot = pivotPoint(), matrix = svg.getScreenCTM();
    if (!target || !pivot || !matrix) { releaseCue(cue); done?.(); return; }
    const distance = Math.abs(py - Number(svg.dataset.muzzleY)) * Math.hypot(matrix.a, matrix.b);
    const shot = cannonShot(pivot, target, distance);
    if (!shot) { releaseCue(cue); done?.(); return; }
    if (reduceMotion()) { fire(cue, phrase, done); return; }
    const current = getComputedStyle(aim).transform;
    turn?.cancel();
    const transform = `rotate(${shot.angle}deg)`;
    aim.style.transform = transform; layer.dataset.angle = String(shot.angle);
    const active = { cue }; aiming = active;
    turn = track(aim.animate([{ transform: current === 'none' ? 'rotate(0deg)' : current }, { transform }], { duration: 160, easing: easeOut }));
    void turn.finished.then(() => {
      if (!disposed && aiming === active) { aiming = null; fire(active.cue, phrase, done); }
    }, () => {});
  };
  const locate = (element: HTMLElement, phrase?: Pick<Phrase, 'start' | 'end'>) => {
    if (!element.isConnected) return;
    if (targetPoint(element, phrase, true)) return;
    const before = scroll.scrollTop;
    scroll.scrollTop += cannonTextRange(element, phrase?.start, phrase?.end).getBoundingClientRect().top - scroll.getBoundingClientRect().top - 64;
    if (scroll.scrollTop !== before) expectedScroll = scroll.scrollTop;
  };
  const erase = (part: ReturnType<typeof reveal.deletions>[number], done: () => void) => {
    let steps = cannonEraseSteps(part.text).filter(step => step.end > part.start);
    if (!steps.length || reduceMotion()) { reveal.land(part.element, part.text); queueMicrotask(done); return; }
    locate(part.element, steps[0]);
    if (!targetPoint(part.element, steps[0])) {
      // Whitespace has no ink to erase; never skip the remaining original text with it.
      reveal.land(part.element, part.text, steps[0].end); queueMicrotask(done); return;
    }
    // Finish one visible page, then locate the next page before continuing the same deletion.
    const limit = Math.min(scroll.getBoundingClientRect().bottom, dock.getBoundingClientRect().top) - 8;
    let lo = 1, hi = steps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cannonTextRange(part.element, steps[mid].start, steps[mid].end).getBoundingClientRect().top < limit) lo = mid + 1;
      else hi = mid;
    }
    steps = steps.slice(0, lo);
    const end = steps.at(-1)!.end;
    const beam = document.createElement('span'); beam.className = 'mewiki-ai-cannon-laser';
    const tip = document.createElement('span'); tip.className = 'mewiki-ai-cannon-laser-tip';
    layer.append(beam, tip);
    layer.dataset.targetBlock = part.element.closest<HTMLElement>('[data-review-block-id]')?.dataset.reviewBlockId ?? '';
    const duration = Math.min(1000, Math.max(180, steps.length * 36));
    const animation = track(beam.animate([{ opacity: .65 }, { opacity: 1, offset: .15 }, { opacity: .85 }], { duration, easing: 'linear' }), beam);
    let erased = -1, frameId = 0;
    const draw = () => {
      const progress = Math.min(1, Number(animation.currentTime ?? 0) / duration), count = Math.floor(progress * steps.length);
      if (count !== erased) { erased = count; reveal.land(part.element, part.text, count ? steps[count - 1].end : part.start); }
      const target = targetPoint(part.element, steps[Math.min(count, steps.length - 1)]), pivot = pivotPoint();
      if (target && pivot) {
        const matrix = svg.getScreenCTM();
        const shot = matrix && cannonShot(pivot, target, Math.abs(py - Number(svg.dataset.muzzleY)) * Math.hypot(matrix.a, matrix.b));
        if (shot) {
          aim.style.transform = `rotate(${shot.angle}deg)`; layer.dataset.angle = String(shot.angle);
          const start = point(new DOMPoint().matrixTransform(origin.getScreenCTM()!));
          beam.style.transform = `translate(${start.x}px, ${start.y}px) rotate(${Math.atan2(target.y - start.y, target.x - start.x)}rad) scaleX(${Math.hypot(target.x - start.x, target.y - start.y)})`;
          tip.style.transform = `translate(${target.x - 3}px, ${target.y - 3}px)`;
          beam.style.visibility = 'visible'; tip.style.visibility = 'visible';
        }
      } else { beam.style.visibility = 'hidden'; tip.style.visibility = 'hidden'; }
    };
    const token = generation;
    const frame = () => { if (disposed || generation !== token || animation.playState !== 'running' && animation.playState !== 'paused') return; draw(); frameId = laserFrame = requestAnimationFrame(frame); };
    draw(); frameId = laserFrame = requestAnimationFrame(frame);
    void animation.finished.then(() => {
      cancelAnimationFrame(frameId); tip.remove();
      if (!disposed) { reveal.land(part.element, part.text, end); done(); }
    }, () => { cancelAnimationFrame(frameId); tip.remove(); });
  };
  const prepare = (cue: Cue, phrase?: Phrase, done?: () => void) => {
    const active = { cue }, token = generation; preparing = active;
    const advance = () => {
      if (disposed || preparing !== active || generation !== token) return;
      const current = active.cue, parts = [current, ...current.batch ?? []];
      if (!current.element.isConnected) { releaseCue(current); preparing = null; done?.(); return; }
      const deletion = parts.flatMap(part => reveal.deletions(part.element))[0];
      if (deletion) { erase(deletion, advance); return; }
      for (const part of parts) reveal.writing(part.element);
      preparing = null;
      if (cannonIsRemoval(current.element)) {
        for (const part of parts) fired.set(part.key, part.text);
        done?.();
      }
      else { locate(current.element, phrase); launch(current, phrase, done); }
    };
    advance();
  };
  const schedulePending = () => {
    if (timer !== undefined || liveBusy) return;
    if (!pending) pending = backlog.shift() ?? null;
    if (!pending) return;
    // Let the parent finish following the edited paragraph before measuring it.
    timer = setTimeout(() => {
      timer = undefined;
      const cue = pending; pending = null;
      nextShot = performance.now() + shotInterval;
      if (cue && !disposed) {
        liveBusy = true;
        prepare(cue, undefined, () => { liveBusy = false; schedulePending(); });
      }
    }, Math.max(60, nextShot - performance.now()));
  };
  const setReplay = (requested: boolean, done?: () => void, targets: CannonReplayTarget[] = []) => {
    replayDone = done;
    if (requested === replayRequested) return;
    replayRequested = requested; stopReplay(false);
    if (!requested) return;
    if (document.hidden || dock.hidden) { done?.(); return; }
    // Generate phrases only for the current target. Later changes must never be truncated.
    const queue = (function* () {
      for (const [index, { element, start }] of targets.entries()) {
        const cue: Cue = { key: `replay-${index}`, element, text: element.textContent ?? '',
          blockId: element.closest<HTMLElement>('[data-review-block-id]')?.dataset.reviewBlockId ?? '' };
        if (cannonIsRemoval(element)) yield { cue, phrase: { text: '', start, end: cue.text.length } };
        else for (const phrase of cannonReplaySteps(cue.text, start)) yield { cue, phrase };
      }
    })();
    reveal.holdMany(targets);
    replayActive = true; layer.dataset.replay = 'true';
    const earliestEnd = performance.now() + 2000;
    const step = () => {
      if (!replayActive || disposed) return;
      const shot = queue.next().value;
      if (!shot) { replayTimer = setTimeout(() => stopReplay(), Math.max(500, earliestEnd - performance.now())); return; }
      if (!shot.cue.element.isConnected) { stopReplay(); return; }
      const deletion = reveal.deletions(shot.cue.element)[0];
      if (deletion) {
        const first = cannonEraseSteps(deletion.text).find(part => part.end > deletion.start);
        if (first) locate(deletion.element, first);
      } else locate(shot.cue.element, shot.phrase);
      replayTimer = setTimeout(() => {
        if (!replayActive || disposed) return;
        prepare(shot.cue, shot.phrase, () => { replayTimer = setTimeout(step, 140); });
      }, 80);
    };
    if (!targets.length) { stopReplay(); return; }
    replayTimer = setTimeout(step, 400);
  };
  const update = (location: AiReviewLocation, targetId: string, baseline = false) => {
    if (currentTarget !== null && currentTarget !== targetId) {
      stopReplay(); seen.clear(); fired.clear();
    }
    currentTarget = targetId;
    if (replayActive) return;
    const block = location.blockId ? [...scroll.querySelectorAll<HTMLElement>('[data-review-block-id]')].find(element => element.dataset.reviewBlockId === location.blockId) : undefined;
    const tab = location.tabId ? [...(block ?? scroll).querySelectorAll<HTMLElement>('[data-review-tab-id]')].find(element => element.dataset.reviewTabId === location.tabId) : undefined;
    const field = location.field ? [...scroll.querySelectorAll<HTMLElement>('[data-review-field]')].find(element => element.dataset.reviewField === location.field) : undefined;
    const scope = tab ?? block ?? field ?? scroll;
    const additions = [...scope.querySelectorAll<HTMLElement>(cannonAdditions)];
    const removals = [...scope.querySelectorAll<HTMLElement>(cannonRemovals)].filter(element => {
      const pair = cannonPair(element);
      return !pair || !pair.querySelector(cannonAdditions);
    });
    const candidates = cannonLeaves([...additions, ...removals]).sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    let latest: Cue | null = null;
    const cues: Cue[] = [], changed: Cue[] = [];
    for (const [index, element] of candidates.entries()) {
      const blockId = element.closest<HTMLElement>('[data-review-block-id]')?.dataset.reviewBlockId ?? '';
      const key = JSON.stringify([blockId, location.tabId, location.field, index]);
      const text = element.textContent ?? '';
      const cue = { key, element, text, blockId };
      cues.push(cue);
      if (seen.get(key) !== text) { latest = cue; changed.push(cue); }
      seen.set(key, text);
      if (baseline) fired.set(key, text);
    }
    while (seen.size > 512) { const key = seen.keys().next().value!; seen.delete(key); fired.delete(key); }
    const groups = new Map<HTMLElement, Cue[]>();
    for (const cue of cues) {
      const group = cannonPair(cue.element) ?? cue.element;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(cue);
    }
    const queued: Cue[] = [];
    for (const [group, parts] of groups) {
      const cue = { ...parts.at(-1)!, batch: parts.slice(0, -1) };
      let active = false;
      for (const job of [preparing, aiming]) if (job && (cannonPair(job.cue.element) ?? job.cue.element) === group) { job.cue = cue; active = true; }
      if (!active && parts.some(part => fired.get(part.key) !== part.text)) queued.push(cue);
    }
    pending = queued.shift() ?? null; backlog = queued;
    if (baseline || !latest || document.hidden || dock.hidden) return;
    if (!reduceMotion()) for (const cue of changed) reveal.hold(cue.element);
    schedulePending();
  };
  resize(); preference(); layer.dataset.ready = 'true';
  const observer = new ResizeObserver(resize); observer.observe(layer);
  const scrolled = () => {
    if (expectedScroll !== null && Math.abs(scroll.scrollTop - expectedScroll) < 1) {
      expectedScroll = null; followScrollRef.current = null; return;
    }
    const followed = followScrollRef.current; followScrollRef.current = null;
    if (!replayActive && followed !== null && Math.abs(scroll.scrollTop - followed) < 1) {
      const current = preparing?.cue ?? aiming?.cue;
      const queued = [current, pending, ...backlog].filter((cue): cue is Cue => !!cue);
      cancelMotion(false);
      reveal.retain(queued.flatMap(cue => [cue.element, ...cue.batch?.map(part => part.element) ?? []]));
      pending = queued.shift() ?? null; backlog = queued;
      schedulePending();
      return;
    }
    cancelMotion(); dropPending();
    if (replayActive) stopReplay();
  };
  scroll.addEventListener('scroll', scrolled, { passive: true });
  document.addEventListener('visibilitychange', visibility); media.addEventListener('change', preference);
  return { update, setReplay, dispose() {
    disposed = true; stopReplay(false); observer.disconnect();
    scroll.removeEventListener('scroll', scrolled); document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', preference);
  } };
}

/** Decorative only: this component observes rendered changes and never writes notebook data. */
export default function AiTextCannon({ scrollRef, followScrollRef, proposal, location, targetId, replay = false, onReplayEnd }: {
  scrollRef: RefObject<HTMLDivElement | null>; followScrollRef: RefObject<number | null>; proposal: AiProposal | null; location: AiReviewLocation; targetId: string;
  replay?: boolean; onReplayEnd?: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof mountScene> | null>(null);
  const revealRef = useRef<ReturnType<typeof createCannonTextReveal> | null>(null);
  const replayTargetsRef = useRef<CannonReplayTarget[] | null>(null);
  const latest = useRef({ location, proposal, targetId, replay, onReplayEnd });
  const initialProposal = useRef(proposal);
  const id = useId().replace(/[^a-z0-9]/gi, '');
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const reveal = createCannonTextReveal(scroll, `mewiki-cannon-${id}`);
    revealRef.current = reveal;
    return () => { reveal.dispose(); revealRef.current = null; };
  }, [id, scrollRef]);
  useLayoutEffect(() => {
    latest.current = { location, proposal, targetId, replay, onReplayEnd };
    if (replay && !replayTargetsRef.current && scrollRef.current) replayTargetsRef.current = cannonReplayTargets(scrollRef.current);
    if (!replay) replayTargetsRef.current = null;
    // Stage the first frame before paint, including while the local SVG is loading.
    if (!sceneRef.current && revealRef.current && layerRef.current?.dataset.ready !== 'unavailable') {
      revealRef.current.clear();
      if ((replay || proposal && proposal !== initialProposal.current) && (replay || !matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        revealRef.current.holdMany(replay ? replayTargetsRef.current ?? []
          : cannonLeaves([...scrollRef.current?.querySelectorAll<HTMLElement>(cannonAdditions) ?? []]).map(element => ({ element, start: 0 })));
      }
    }
    sceneRef.current?.update(location, targetId); sceneRef.current?.setReplay(replay, onReplayEnd, replayTargetsRef.current ?? []);
  }, [proposal, location, targetId, replay, onReplayEnd, scrollRef]);
  useEffect(() => {
    const layer = layerRef.current, scroll = scrollRef.current;
    const reveal = revealRef.current;
    if (!layer || !scroll || !reveal) return;
    const abort = new AbortController();
    const unavailable = () => {
      if (!abort.signal.aborted) {
        reveal.clear(); layer.dataset.ready = 'unavailable';
        if (latest.current.replay) latest.current.onReplayEnd?.();
      }
    };
    // A captured origin is valid only while the reader stays there, including asset loading.
    const cancelLoadingReplay = () => {
      if (sceneRef.current || !latest.current.replay || abort.signal.aborted) return;
      reveal.clear(); latest.current.onReplayEnd?.(); abort.abort();
    };
    const loadingMedia = matchMedia('(prefers-reduced-motion: reduce)');
    const loadingBox = layer.getBoundingClientRect();
    const loadingResize = new ResizeObserver(() => {
      const box = layer.getBoundingClientRect();
      if (box.width !== loadingBox.width || box.height !== loadingBox.height) cancelLoadingReplay();
    });
    loadingResize.observe(layer);
    scroll.addEventListener('scroll', cancelLoadingReplay, { passive: true });
    document.addEventListener('visibilitychange', cancelLoadingReplay);
    loadingMedia.addEventListener('change', cancelLoadingReplay);
    const stopWaiting = () => {
      loadingResize.disconnect(); scroll.removeEventListener('scroll', cancelLoadingReplay);
      document.removeEventListener('visibilitychange', cancelLoadingReplay); loadingMedia.removeEventListener('change', cancelLoadingReplay);
    };
    const load = async () => {
      let markup = cachedArtwork;
      if (!markup) {
        const response = await fetch('/brand/mewiki-text-cannon.svg?v=20261120-me-palette', { signal: abort.signal });
        if (!response.ok) { unavailable(); return; }
        markup = await response.text(); cachedArtwork = markup;
      }
      if (abort.signal.aborted) return;
      const prefix = `cannon-${id}-`;
      const content = markup.replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`).replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`);
      const documentSvg = new DOMParser().parseFromString(content, 'image/svg+xml').documentElement;
      if (documentSvg.localName !== 'svg') { unavailable(); return; }
      const svg = document.importNode(documentSvg, true) as unknown as SVGSVGElement;
      svg.removeAttribute('aria-labelledby'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      layer.querySelector('.mewiki-ai-cannon-dock')!.append(svg);
      reveal.clear();
      sceneRef.current = mountScene(layer, scroll, svg, prefix, reveal, followScrollRef);
      sceneRef.current.update(latest.current.location, latest.current.targetId, !!latest.current.proposal && latest.current.proposal === initialProposal.current);
      sceneRef.current.setReplay(latest.current.replay, latest.current.onReplayEnd, replayTargetsRef.current ?? []);
      stopWaiting();
    };
    void load().catch(unavailable);
    return () => { abort.abort(); stopWaiting(); sceneRef.current?.dispose(); sceneRef.current = null; layer.querySelector('.mewiki-ai-cannon-dock')?.replaceChildren(); };
  }, [id, scrollRef, followScrollRef]);
  return <div ref={layerRef} className="mewiki-ai-cannon-layer" data-testid="mewiki-ai-text-cannon" aria-hidden="true"><div className="mewiki-ai-cannon-dock" /></div>;
}
