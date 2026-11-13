import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/locale.ts';
import { useLocale } from '../i18n/react.ts';
import { layoutComposition, type CompositionIssue } from '../domain/publicationCompositionLayout.ts';
import { compositionLayerRect, type PublicationComposition } from '../domain/publicationComposition.ts';
import type { PublicationImageCrop, PublicationOptions } from '../domain/publicationTypes.ts';
import type { CompositionEditor } from '../state/useCompositionEditor.ts';
import { publicationFrameLayout } from '../domain/publicationFrames.ts';

/** Preserve decoded images and font faces while applying the shared static scene. */
function reconcile(target: Node, source: Node) {
  if (target.nodeType === 3) { if (target.textContent !== source.textContent) target.textContent = source.textContent; return; }
  if (target.nodeType === 1 && source.nodeType === 1) {
    // The preview document belongs to another window, so instanceof Element is not reliable.
    const element = target as Element, next = source as Element;
    for (const attribute of [...element.attributes]) if (!next.hasAttribute(attribute.name)) element.removeAttribute(attribute.name);
    for (const attribute of [...next.attributes]) if (element.getAttribute(attribute.name) !== attribute.value) element.setAttribute(attribute.name, attribute.value);
  }
  let index = 0;
  for (const child of [...source.childNodes]) {
    let current = target.childNodes[index];
    const key = child.nodeType === 1 ? (child as Element).getAttribute('data-composition-layer') : null;
    if (key) { const match = [...target.childNodes].find(node => node.nodeType === 1 && (node as Element).getAttribute('data-composition-layer') === key); if (match && match !== current) { target.insertBefore(match, current ?? null); current = match; } }
    if (!current || current.nodeType !== child.nodeType || current.nodeName !== child.nodeName || key && (current as Element).getAttribute('data-composition-layer') !== key) {
      const copy = target.ownerDocument!.importNode(child, true); target.insertBefore(copy, current ?? null); current = copy;
    } else reconcile(current, child);
    index++;
  }
  while (target.childNodes.length > index) target.lastChild!.remove();
}
interface Box { id: string; label: string; left: number; top: number; width: number; height: number; angle: number; locked: boolean; parentWidth: number; parentHeight: number; parentScale: number; parentAngle: number }
type Drag = { kind: 'move' | 'resize' | 'rotate' | 'crop'; pointer: number; x: number; y: number; id: string; box: Box; original: { x: number; y: number; width: number; height: number; rotation: number; scale: number }; crop: PublicationImageCrop; overflowX: number; overflowY: number; angle: number };
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value * 100) / 100));

export default function PublicationCompositionCanvas({ html, options, scene, editor, currentId, crop, scale, disabled, cropMode, onCrop, onIssues, onEdit }: {
  html: string; options: PublicationOptions; scene?: PublicationComposition; editor?: CompositionEditor; currentId?: string; crop: PublicationImageCrop; scale: number; disabled: boolean; cropMode: boolean; onCrop: (crop: PublicationImageCrop) => void; onIssues: (issues: CompositionIssue[]) => void; onEdit: (id: string) => void;
}) {
  const locale = useLocale();
  const [initialHtml] = useState(html);
  const iframe = useRef<HTMLIFrameElement>(null), host = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), sequence = useRef(0);
  const [ready, setReady] = useState(0), [boxes, setBoxes] = useState<Box[]>([]), [screenBox, setScreenBox] = useState<{ left: number; top: number; width: number; height: number }>();
  const frame = useMemo(() => publicationFrameLayout(options), [options]);
  const parentUnit = frame ? frame.contentScale * frame.unit : 1;
  const subject = scene?.subject;
  useLayoutEffect(() => {
    const doc = iframe.current?.contentDocument; if (!doc?.body || doc.location.href === 'about:blank' && !doc.querySelector('.publication-page')) return;
    const next = new DOMParser().parseFromString(html, 'text/html');
    reconcile(doc.head, next.head); reconcile(doc.body, next.body);
  }, [html, ready]);
  useEffect(() => {
    const seq = ++sequence.current;
    const doc = iframe.current?.contentDocument; if (!doc || !ready) return;
    let active = true;
    void (async () => {
      await Promise.all([doc.fonts.ready, ...[...doc.images].map(image => image.decode().catch(() => {}))]);
      if (!active || sequence.current !== seq) return;
      const problems = layoutComposition(doc); onIssues(problems);
      const cropRect = doc.querySelector<HTMLElement>('.publication-image-body')?.getBoundingClientRect();
      if (cropRect) setScreenBox({ left: cropRect.left, top: cropRect.top, width: cropRect.width, height: cropRect.height });
      const nextBoxes: Box[] = [];
      const s = scene?.subject ?? { x: 50, y: 50, scale: 100, rotation: 0, hidden: false, locked: false };
      const main = doc.querySelector<HTMLElement>('.publication-frame-device') ?? doc.querySelector<HTMLElement>('.publication-image-body');
      if (main && !s.hidden) {
        const rect = main.getBoundingClientRect();
        const width = (frame ? frame.device.width * frame.unit : options.width) * s.scale / 100;
        const height = (frame ? frame.device.height * frame.unit : options.height) * s.scale / 100;
        nextBoxes.push({ id: '$subject', label: t('设备与主图'), left: (rect.left + rect.width / 2 - width / 2) * scale, top: (rect.top + rect.height / 2 - height / 2) * scale, width: width * scale, height: height * scale, angle: s.rotation, locked: s.locked, parentWidth: options.width, parentHeight: options.height, parentScale: 1, parentAngle: 0 });
      }
      for (const space of ['screen', 'canvas']) for (const layer of scene?.layers.filter(layer => layer.space === space && !layer.hidden) ?? []) {
        const element = [...doc.querySelectorAll<HTMLElement>('[data-composition-layer]')].find(node => node.dataset.compositionLayer === layer.id);
        if (!element || layer.space === 'screen' && s.hidden) continue;
        const rect = element.getBoundingClientRect(), factor = layer.space === 'screen' ? parentUnit * s.scale / 100 : 1;
        const pw = layer.space === 'screen' ? frame?.width ?? options.width : options.width, ph = layer.space === 'screen' ? frame?.height ?? options.height : options.height;
        const local = compositionLayerRect(layer, pw, ph), width = local.width * factor * scale, height = local.height * factor * scale;
        nextBoxes.push({ id: layer.id, label: layer.name || t('图层'), left: (rect.left + rect.width / 2) * scale - width / 2, top: (rect.top + rect.height / 2) * scale - height / 2, width, height, angle: layer.rotation + (layer.space === 'screen' ? s.rotation : 0), locked: layer.locked, parentWidth: pw, parentHeight: ph, parentScale: factor, parentAngle: layer.space === 'screen' ? s.rotation : 0 });
      }
      setBoxes(nextBoxes);
    })();
    return () => { active = false; };
  }, [html, ready, scale, options.width, options.height, scene, frame, parentUnit, onIssues, locale]);
  const begin = (event: React.PointerEvent<HTMLElement>, box: Box, kind: Drag['kind']) => {
    if (disabled || box.locked || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); editor?.select(box.id); editor?.begin();
    const layer = scene?.layers.find(layer => layer.id === box.id), image = iframe.current?.contentDocument?.querySelector<HTMLImageElement>('.publication-image-body img');
    const screenWidth = frame?.width ?? options.width, screenHeight = frame?.height ?? options.height;
    const cover = Math.max(screenWidth / Math.max(1, image?.naturalWidth ?? 1), screenHeight / Math.max(1, image?.naturalHeight ?? 1)) * crop.zoom / 100;
    const origin = host.current!.getBoundingClientRect(), centerX = origin.left + box.left + box.width / 2, centerY = origin.top + box.top + box.height / 2;
    drag.current = { kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, id: box.id, box, original: { x: layer?.x ?? subject?.x ?? 50, y: layer?.y ?? subject?.y ?? 50, width: layer?.width ?? 100, height: layer?.height ?? 100, rotation: layer?.rotation ?? subject?.rotation ?? 0, scale: subject?.scale ?? 100 }, crop, overflowX: Math.max(0, (image?.naturalWidth ?? 1) * cover - screenWidth) * parentUnit * (subject?.scale ?? 100) / 100, overflowY: Math.max(0, (image?.naturalHeight ?? 1) * cover - screenHeight) * parentUnit * (subject?.scale ?? 100) / 100, angle: Math.atan2(event.clientY - centerY, event.clientX - centerX) };
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
    const dx = (event.clientX - start.x) / scale, dy = (event.clientY - start.y) / scale;
    const radians = (start.kind === 'crop' ? subject?.rotation ?? 0 : start.box.parentAngle) * Math.PI / 180;
    const localX = (dx * Math.cos(radians) + dy * Math.sin(radians)), localY = (-dx * Math.sin(radians) + dy * Math.cos(radians));
    if (start.kind === 'crop') { onCrop({ ...start.crop, x: start.overflowX > 1 ? Math.round(bounded(start.crop.x - localX / start.overflowX * 100, 0, 100)) : start.crop.x, y: start.overflowY > 1 ? Math.round(bounded(start.crop.y - localY / start.overflowY * 100, 0, 100)) : start.crop.y }); return; }
    if (start.kind === 'rotate') {
      const origin = host.current!.getBoundingClientRect(), x = origin.left + start.box.left + start.box.width / 2, y = origin.top + start.box.top + start.box.height / 2;
      const rotation = bounded(start.original.rotation + (Math.atan2(event.clientY - y, event.clientX - x) - start.angle) * 180 / Math.PI, -180, 180);
      if (start.id === '$subject') editor?.patchSubject({ rotation }, currentId); else editor?.patchLayer(start.id, { rotation }, currentId); return;
    }
    const x = localX / start.box.parentScale / start.box.parentWidth * 100, y = localY / start.box.parentScale / start.box.parentHeight * 100;
    if (start.id === '$subject') { editor?.patchSubject(start.kind === 'resize' ? { scale: bounded(start.original.scale * (1 + dx * scale / Math.max(1, start.box.width)), 20, 150) } : { x: bounded(start.original.x + x, 0, 100), y: bounded(start.original.y + y, 0, 100) }, currentId); return; }
    let patch;
    if (start.kind === 'resize') {
      const ownAngle = start.original.rotation * Math.PI / 180;
      const widthDelta = (localX * Math.cos(ownAngle) + localY * Math.sin(ownAngle)) / start.box.parentScale / start.box.parentWidth * 100;
      const heightDelta = (-localX * Math.sin(ownAngle) + localY * Math.cos(ownAngle)) / start.box.parentScale / start.box.parentHeight * 100;
      patch = { width: bounded(start.original.width + widthDelta, 1, 200), height: bounded(start.original.height + heightDelta, 1, 200) };
    } else {
      const snap = (value: number) => Math.abs(value - 50) < .7 ? 50 : Math.abs(value) < .7 ? 0 : value;
      patch = { x: bounded(snap(start.original.x + x), -100, 200), y: bounded(snap(start.original.y + y), -100, 200) };
    }
    editor?.patchLayer(start.id, patch, currentId);
  };
  const finish = () => { if (drag.current) { drag.current = null; editor?.end(); } };
  const key = (event: React.KeyboardEvent<HTMLElement>, box: Box, cropping = false) => {
    if (disabled || box.locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? 5 : .5, x = (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y = (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
    if (cropping) { onCrop({ ...crop, x: Math.round(bounded(crop.x - x * 2, 0, 100)), y: Math.round(bounded(crop.y - y * 2, 0, 100)) }); return; }
    const layer = scene?.layers.find(layer => layer.id === box.id);
    if (layer) editor?.patchLayer(box.id, { x: bounded(layer.x + x, -100, 200), y: bounded(layer.y + y, -100, 200) }, currentId);
    else editor?.patchSubject({ x: bounded((subject?.x ?? 50) + x, 0, 100), y: bounded((subject?.y ?? 50) + y, 0, 100) }, currentId);
  };
  const mainBox = boxes.find(box => box.id === '$subject');
  const cropBox = screenBox;
  const cropWidth = (frame ? frame.device.screen.width * frame.unit : options.width) * (subject?.scale ?? 100) / 100 * scale;
  const cropHeight = (frame ? frame.device.screen.height * frame.unit : options.height) * (subject?.scale ?? 100) / 100 * scale;
  return <div ref={host} className="mewiki-publication-sample-canvas mewiki-publication-image-canvas" data-testid="image-creation-canvas" style={{ width: options.width * scale, height: options.height * scale }}>
    <iframe ref={iframe} title={t('图片效果预览')} sandbox="allow-same-origin" srcDoc={initialHtml} width={options.width} height={options.height} style={{ transform: `scale(${scale})` }} onLoad={() => setReady(value => value + 1)} />
    {editor && boxes.map(box => <div key={box.id} className="mewiki-composition-object" data-selected={editor.selectedId === box.id} data-locked={box.locked} style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: `rotate(${box.angle}deg)` }}>
      <button type="button" data-ui="canvas-object" aria-label={t`编辑图层：${box.label}`} disabled={disabled || box.locked} className="mewiki-composition-hit" onDoubleClick={() => onEdit(box.id)} onPointerDown={event => begin(event, box, 'move')} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} onKeyDown={event => key(event, box)} />
      {editor.selectedId === box.id && !box.locked && <><button type="button" data-ui="canvas-handle" aria-label={t('调整图层大小')} className="mewiki-composition-resize" disabled={disabled} onPointerDown={event => begin(event, box, 'resize')} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} /><button type="button" data-ui="canvas-handle" aria-label={t('旋转图层')} className="mewiki-composition-rotate" disabled={disabled} onPointerDown={event => begin(event, box, 'rotate')} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} /></>}
    </div>)}
    {!!currentId && cropMode && options.imageMode?.fit === 'cover' && mainBox && cropBox && <div role="group" aria-label={t('图片取景')} tabIndex={disabled ? -1 : 0} aria-disabled={disabled} className="mewiki-publication-image-crop" style={{ left: (cropBox.left + cropBox.width / 2) * scale - cropWidth / 2, top: (cropBox.top + cropBox.height / 2) * scale - cropHeight / 2, width: cropWidth, height: cropHeight, transform: `rotate(${subject?.rotation ?? 0}deg)` }}
      onPointerDown={event => begin(event, mainBox, 'crop')} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} onKeyDown={event => key(event, mainBox, true)} />}
  </div>;
}
