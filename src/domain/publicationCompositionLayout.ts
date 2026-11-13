export interface CompositionIssue { index: number; layerId: string; layerIndex: number; reason: 'text-overflow' | 'outside' }

/** Self-contained: the export browser runs this same function from its source. */
export function layoutComposition(doc: Document): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  for (const page of doc.querySelectorAll<HTMLElement>('.publication-page')) {
    const index = Number(page.dataset.imageIndex ?? 0) + 1;
    const layers = [...page.querySelectorAll<HTMLElement>('[data-composition-layer]')];
    for (const [domIndex, layer] of layers.entries()) {
      const layerIndex = layer.dataset.compositionIndex === undefined ? domIndex : Number(layer.dataset.compositionIndex);
      const parent = layer.parentElement!;
      if (doc.defaultView?.getComputedStyle(layer).visibility === 'hidden') continue;
      const text = layer.querySelector<HTMLElement>('.composition-text');
      if (text) {
        const style = doc.defaultView!.getComputedStyle(layer);
        const base = parseFloat(style.fontSize), min = Number(text.dataset.minFont);
        text.style.fontSize = base + 'px';
        const fits = () => text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1;
        if (!fits() && text.dataset.autoShrink === 'true') {
          let low = min, high = base;
          for (let n = 0; n < 9; n++) { const middle = (low + high) / 2; text.style.fontSize = middle + 'px'; if (fits()) low = middle; else high = middle; }
          text.style.fontSize = low + 'px';
        }
        if (!fits()) issues.push({ index, layerId: layer.dataset.compositionLayer!, layerIndex, reason: 'text-overflow' });
      }
      const matrix = doc.defaultView!.getComputedStyle(layer).transform;
      const coefficients = matrix.startsWith('matrix(') ? matrix.slice(7, -1).split(',').map(Number) : [1, 0, 0, 1, 0, 0];
      const spanX = Math.abs(coefficients[0]) * layer.offsetWidth + Math.abs(coefficients[2]) * layer.offsetHeight;
      const spanY = Math.abs(coefficients[1]) * layer.offsetWidth + Math.abs(coefficients[3]) * layer.offsetHeight;
      const x = layer.offsetLeft + layer.offsetWidth / 2, y = layer.offsetTop + layer.offsetHeight / 2;
      if (x - spanX / 2 < -1 || x + spanX / 2 > parent.clientWidth + 1 || y - spanY / 2 < -1 || y + spanY / 2 > parent.clientHeight + 1) issues.push({ index, layerId: layer.dataset.compositionLayer!, layerIndex, reason: 'outside' });
    }
  }
  return issues;
}
