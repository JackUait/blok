// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import type { ChartModel, ChartSeries } from './model';
import type { TextStyle } from './svg';
import { group, px, svg, text, textWidth } from './svg';
import { drawMarker } from './marker';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Entry {
  label: string;
  color: string;
  series?: ChartSeries;
  /** Kind of the plot the entry belongs to; picks a line or a swatch key. */
  kind: string;
}

function entries(model: ChartModel): Entry[] {
  if (model.layers) {
    return model.layers.flatMap(entries);
  }
  if (model.kind === 'pie' || model.kind === 'doughnut') {
    const first = model.series[0];

    return (first?.categories ?? []).map((label, i) => ({ label, color: first.pointColors[i] ?? first.color, kind: model.kind }));
  }

  // A filled radar keys its series with swatches, as areas do.
  const kind = model.radarStyle === 'filled' ? 'area' : model.kind;
  const list = model.series.map((s) => ({ label: s.name, color: s.color, series: s, kind }));
  const stacked = model.grouping === 'stacked' || model.grouping === 'percentStacked';

  return stacked && (model.kind === 'line' || model.kind === 'area') ? list.reverse() : list;
}

function drawKey(g: Element, entry: Entry, x: number, y: number, size: number): void {
  const s = entry.series;
  const lineLike = (entry.kind === 'line' || entry.kind === 'scatter' || entry.kind === 'radar' || entry.kind === 'stock') && s !== undefined;

  if (!lineLike) {
    svg('rect', { x: px(x + size * 0.2), y: px(y - size * 0.3), width: px(size * 0.6), height: px(size * 0.6), fill: entry.color }, g);

    return;
  }
  if (!s.noLine) {
    svg('line', { x1: px(x), y1: px(y), x2: px(x + size), y2: px(y), stroke: s.color, 'stroke-width': s.lineWidth }, g);
  }
  if (s.marker) {
    drawMarker(g, s.marker.symbol, x + size / 2, y, Math.min(s.marker.size, size * 0.6), s.color);
  }
}

/**
 * Draws the legend inside `area` on the side the deck names and returns the area
 * left for the plot.
 */
export function drawLegend(model: ChartModel, area: Box, root: Element, style: TextStyle): Box {
  const position = model.legend?.position;
  const items = entries(model);

  if (position === undefined || items.length === 0) {
    return area;
  }
  const g = group('legend', root);
  const key = style.size * 1.2;
  const gap = style.size * 0.4;
  const rowH = style.size * 1.4;
  const widths = items.map((e) => key + gap + textWidth(e.label, style.size));
  const pad = style.size * 0.5;

  if (position === 't' || position === 'b') {
    const total = widths.reduce((a, b) => a + b, 0) + pad * (items.length - 1);
    const y = position === 't' ? area.y + rowH / 2 : area.y + area.h - rowH / 2;
    const x0 = area.x + Math.max(0, (area.w - total) / 2);
    const offset = { value: 0 };

    items.forEach((e, i) => {
      const x = x0 + offset.value;

      offset.value = offset.value + widths[i] + pad;
      drawKey(g, e, x, y, key);
      text(g, x + key + gap, y, e.label, style, 'start');
    });

    return { x: area.x, y: position === 't' ? area.y + rowH + pad : area.y, w: area.w, h: area.h - rowH - pad };
  }
  const colW = widths.reduce((max, w) => Math.max(max, w), -Infinity);
  const x = position === 'r' ? area.x + area.w - colW : area.x;
  const y0 = area.y + (area.h - rowH * items.length) / 2 + rowH / 2;

  items.forEach((e, i) => {
    drawKey(g, e, x, y0 + i * rowH, key);
    text(g, x + key + gap, y0 + i * rowH, e.label, style, 'start');
  });

  return { x: position === 'l' ? area.x + colW + pad : area.x, y: area.y, w: area.w - colW - pad, h: area.h };
}
