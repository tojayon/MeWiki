import { describe, expect, it } from 'vitest';
import { publicationChartSvg } from './publicationVisual.ts';

describe('static publication charts', () => {
  it('draws all selected numeric points and escapes user labels', () => {
    const svg = publicationChartSvg({ id: 'd', type: 'dataset', title: '<私有脚本>', columns: ['横轴', '<纵轴>'], rows: [['1', '2'], ['2', '4']], chart: { kind: 'scatter', x: 0, ys: [1] } });
    expect(svg).toContain('&lt;私有脚本&gt;');
    expect(svg).toContain('&lt;纵轴&gt;');
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).not.toContain('<私有脚本>');
  });
  it('keeps extreme finite numbers from overflowing SVG coordinates', () => {
    const svg = publicationChartSvg({ id: 'd', type: 'dataset', columns: ['x', 'y'], rows: [['-1e308', '-1e308'], ['1e308', '1e308']], chart: { kind: 'line', x: 0, ys: [1] } });
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('<path ');
  });
  it('refuses a chart with no drawable data rather than exporting blank axes', () => {
    expect(() => publicationChartSvg({ id: 'd', type: 'dataset', columns: ['x', 'y'], rows: [['a', 'b']], chart: { kind: 'line', x: 0, ys: [1] } })).toThrow('数值');
  });
});
