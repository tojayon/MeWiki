import { datasetChartSeries, normalizeDatasetBlock, type ResearchDatasetBlock } from './researchDataset.ts';
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const n = (value: number) => value.toFixed(2);
const label = (value: number) => Math.abs(value) >= 1e5 || value !== 0 && Math.abs(value) < .001 ? value.toExponential(2) : Number(value.toPrecision(5)).toString();
/** Scale before subtracting so valid extreme research values keep finite coordinates. */
function axis(values: number[], start: number, end: number, zero = false) {
  let min = zero ? 0 : Infinity, max = zero ? 0 : -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  const magnitude = Math.max(Math.abs(min), Math.abs(max)) || 1;
  let low = min / magnitude, high = max / magnitude;
  const pad = (high - low || Math.abs(low) * .1 || 1) * .06;
  low = Math.max(-Number.MAX_VALUE / magnitude, low - pad); high = Math.min(Number.MAX_VALUE / magnitude, high + pad);
  return { at: (value: number) => start + (value / magnitude - low) / (high - low) * (end - start), ticks: Array.from({ length: 6 }, (_, index) => ({ at: start + index / 5 * (end - start), value: ((1 - index / 5) * low + index / 5 * high) * magnitude })) };
}

/** A static SVG built from validated values, without application controls or source URLs. */
export function publicationChartSvg(input: ResearchDatasetBlock): string {
  const block = normalizeDatasetBlock(input), { chart, series, numericX } = datasetChartSeries(block);
  if (!chart || !series.some(item => item.points.length)) throw new Error('所选图表没有可绘制的数值，请检查图表列。');
  const width = 960, height = 540 + Math.ceil(series.length / 3) * 26;
  const left = 108, right = 932, top = 42 + Math.ceil(series.length / 3) * 26, bottom = height - 84;
  const xs = axis(series.flatMap(item => item.points.map(point => point.x)), left, right);
  const ys = axis(series.flatMap(item => item.points.map(point => point.y)), bottom, top, chart.kind === 'bar');
  const colors = ['#245fa5', '#c45235', '#aa7714', '#39745e', '#77529d'];
  const body: string[] = [`<rect width="${width}" height="${height}" fill="#ffffff"/>`, `<title>${escape(block.title || '数据图表')}</title>`];
  for (const tick of ys.ticks) body.push(`<line x1="${left}" x2="${right}" y1="${n(tick.at)}" y2="${n(tick.at)}" stroke="#dde5ef"/><text x="${left - 12}" y="${n(tick.at + 6)}" text-anchor="end">${escape(label(tick.value))}</text>`);
  for (const tick of xs.ticks) {
    const text = numericX ? label(tick.value) : block.rows[Math.max(0, Math.min(block.rows.length - 1, Math.round(tick.value)))]?.[chart.x] ?? '';
    body.push(`<line x1="${n(tick.at)}" x2="${n(tick.at)}" y1="${top}" y2="${bottom}" stroke="#eef2f7"/><text x="${n(tick.at)}" y="${bottom + 32}" text-anchor="middle">${escape(text.slice(0, 24))}</text>`);
  }
  body.push(`<path d="M${left},${top}V${bottom}H${right}" fill="none" stroke="#526780"/>`);
  series.forEach((item, index) => {
    const color = colors[index % colors.length];
    body.push(`<line x1="${left + index % 3 * 270}" x2="${left + index % 3 * 270 + 24}" y1="${22 + Math.floor(index / 3) * 26}" y2="${22 + Math.floor(index / 3) * 26}" stroke="${color}" stroke-width="4"/><text x="${left + index % 3 * 270 + 30}" y="${28 + Math.floor(index / 3) * 26}">${escape(item.label.slice(0, 30))}</text>`);
    if (chart.kind === 'scatter') for (const point of item.points) body.push(`<circle cx="${n(xs.at(point.x))}" cy="${n(ys.at(point.y))}" r="3.5" fill="${color}"/>`);
    else if (chart.kind === 'bar') {
      const slot = (right - left) / Math.max(1, block.rows.length + 1), barWidth = Math.max(.4, Math.min(48, slot * .8 / series.length));
      for (const point of item.points) {
        const x = xs.at(point.x) + (index - series.length / 2) * barWidth, y = ys.at(point.y), zero = ys.at(0);
        body.push(`<rect x="${n(x)}" y="${n(Math.min(y, zero))}" width="${n(barWidth)}" height="${n(Math.abs(zero - y))}" fill="${color}"/>`);
      }
    } else {
      let previous = -2;
      const path = item.points.map(point => { const command = point.row === previous + 1 ? 'L' : 'M'; previous = point.row; return `${command}${n(xs.at(point.x))},${n(ys.at(point.y))}`; }).join('');
      body.push(`<path d="${path}" stroke="${color}" stroke-width="3" fill="none"/>`);
      for (const point of item.points) body.push(`<circle cx="${n(xs.at(point.x))}" cy="${n(ys.at(point.y))}" r="3" fill="${color}"/>`);
    }
  });
  const skipped = series.reduce((total, item) => total + item.skipped, 0);
  body.push(`<text x="${(left + right) / 2}" y="${height - 36}" text-anchor="middle">${escape(block.columns[chart.x])}</text>`);
  if (skipped) body.push(`<text x="${left}" y="${height - 8}">${skipped} 个空值或非数值项；折线在缺失处断开。</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-size="17" fill="#20252b">${body.join('')}</svg>`;
}
