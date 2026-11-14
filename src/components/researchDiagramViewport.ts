export interface DiagramSize { width: number; height: number }
export interface DiagramPoint { x: number; y: number }
export interface DiagramViewport extends DiagramPoint { zoom: number }
export const MIN_DIAGRAM_ZOOM = 0.000001;
export const MAX_DIAGRAM_ZOOM = 64;

export function fitDiagramViewport(image: DiagramSize, canvas: DiagramSize): DiagramViewport {
  if (image.width <= 0 || image.height <= 0 || canvas.width <= 0 || canvas.height <= 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.min(1, Math.max(1, canvas.width - 40) / image.width, Math.max(1, canvas.height - 40) / image.height);
  return { x: (canvas.width - image.width * zoom) / 2, y: (canvas.height - image.height * zoom) / 2, zoom };
}

export function zoomDiagramViewport(view: DiagramViewport, target: number, anchor: DiagramPoint): DiagramViewport {
  if (!Number.isFinite(target) || target <= 0) return view;
  const zoom = Math.max(MIN_DIAGRAM_ZOOM, Math.min(MAX_DIAGRAM_ZOOM, target));
  return { x: anchor.x - (anchor.x - view.x) * zoom / view.zoom, y: anchor.y - (anchor.y - view.y) * zoom / view.zoom, zoom };
}

export function resizeDiagramViewport(view: DiagramViewport, previous: DiagramSize, next: DiagramSize): DiagramViewport {
  return { ...view, x: view.x + (next.width - previous.width) / 2, y: view.y + (next.height - previous.height) / 2 };
}
