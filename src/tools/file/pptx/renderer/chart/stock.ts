import type { ChartModel, ChartSeries } from './model';
import type { Frame } from './cartesian';
import { group, px, svg } from './svg';

function valueAt(s: ChartSeries, i: number): number | undefined {
  return i < s.values.length && !s.blanks.has(i) && Number.isFinite(s.values[i]) ? s.values[i] : undefined;
}

/**
 * The parts of a high-low-close or open-high-low-close plot that are not series:
 * a high-low line per category, and up/down bars from the first series (open) to the last (close).
 */
export function drawStock(model: ChartModel, f: Frame, root: Element): void {
  const { series, stock } = model;
  const count = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const g = group('stock', root);

  Array.from({ length: count }, (_, i) => i).forEach((i) => {
    const x = f.categoryPx(i);
    const values = series.map((s) => valueAt(s, i)).filter((v): v is number => v !== undefined);

    if (stock?.hiLowColor !== undefined && values.length >= 2) {
      const high = values.reduce((a, b) => Math.max(a, b));
      const low = values.reduce((a, b) => Math.min(a, b));

      svg('line', { 'data-pptx-chart': 'hi-low', x1: px(x), y1: px(f.valuePx(high)), x2: px(x), y2: px(f.valuePx(low)), stroke: stock.hiLowColor, 'stroke-width': 1 }, g);
    }
    const open = valueAt(series[0], i);
    const close = valueAt(series[series.length - 1], i);
    const bars = stock?.upDown;

    if (bars === undefined || series.length < 4 || open === undefined || close === undefined) {
      return;
    }
    const up = close > open;
    const width = f.band / (1 + Math.max(0, bars.gapWidth) / 100);
    const top = f.valuePx(Math.max(open, close));

    svg('rect', {
      'data-pptx-chart': up ? 'up-bar' : 'down-bar',
      x: px(x - width / 2),
      y: px(top),
      width: px(width),
      height: px(Math.abs(f.valuePx(Math.min(open, close)) - top)),
      fill: up ? bars.up : bars.down,
      stroke: '#000000',
      'stroke-width': 1,
    }, g);
  });
}
