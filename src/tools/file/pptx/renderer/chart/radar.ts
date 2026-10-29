import type { ChartModel } from './model';
import type { Box } from './legend';
import type { TextStyle } from './svg';
import { ticks } from './cartesian';
import { formatValue } from './format';
import { drawMarker } from './marker';
import { autoValueAxis } from './scale';
import { group, px, svg, text, textWidth } from './svg';

/** Unit vector of spoke `i` of `count`, clockwise from 12 o'clock. */
function spoke(i: number, count: number): [number, number] {
  const angle = (i * 2 * Math.PI) / count;

  return [Math.sin(angle), -Math.cos(angle)];
}

function polygon(points: number[][]): string {
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)} ${px(y)}`).join(' ')} Z`;
}

export function drawRadar(model: ChartModel, box: Box, root: Element, style: TextStyle): void {
  const count = Math.max(model.categories.length, model.series.reduce((m, s) => Math.max(m, s.values.length), 0));

  if (count === 0) {
    return;
  }
  const axis = model.valueAxis;
  const values = model.series.flatMap((s) => s.values.filter((_, i) => !s.blanks.has(i)));
  // stacked: true turns off the zoom above zero; radars start at zero in the reference.
  const scale = autoValueAxis({ values, desiredTicks: 5, stacked: true, min: axis.min, max: axis.max, major: axis.major });
  const labels = Array.from({ length: count }, (_, i) => model.categories[i] ?? String(i + 1));
  const labelRoom = labels.reduce((m, l) => Math.max(m, textWidth(l, style.size)), 0) + style.size * 0.6;
  const radius = Math.max(1, Math.min(box.w / 2 - labelRoom, box.h / 2 - style.size * 1.5));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const at = (i: number, v: number): number[] => {
    const [dx, dy] = spoke(i, count);
    const r = (Math.min(Math.max(v, scale.min), scale.max) - scale.min) / (scale.max - scale.min) * radius;

    return [cx + dx * r, cy + dy * r];
  };
  const levels = ticks(scale);
  const grid = group('gridlines', root);

  if (axis.gridlines) {
    levels.slice(1).forEach((v) => svg('path', { 'data-pptx-chart': 'radar-ring', d: polygon(labels.map((_, i) => at(i, v))), fill: 'none', stroke: axis.gridColor, 'stroke-width': 1 }, grid));
  }
  labels.forEach((_, i) => {
    const [x2, y2] = at(i, scale.max);

    svg('line', { 'data-pptx-chart': 'radar-spoke', x1: px(cx), y1: px(cy), x2: px(x2), y2: px(y2), stroke: model.categoryAxis.gridColor, 'stroke-width': 1 }, grid);
  });
  const filled = model.radarStyle === 'filled';

  model.series.forEach((s) => {
    const g = group('series', root);
    const points = s.values.slice(0, count).map((v, i) => at(i, s.blanks.has(i) ? scale.min : v));

    if (points.length === 0) {
      return;
    }
    svg('path', {
      'data-pptx-chart': 'radar-shape',
      d: polygon(points),
      fill: filled ? s.color : 'none',
      stroke: s.noLine || filled ? 'none' : s.color,
      'stroke-width': px(s.lineWidth),
      'stroke-linejoin': 'round',
    }, g);
    const { marker } = s;

    if (marker !== undefined) {
      points.forEach(([x, y], i) => drawMarker(g, marker.symbol, x, y, marker.size, s.pointColors[i] ?? s.color));
    }
  });
  if (!model.categoryAxis.deleted && model.categoryAxis.showLabels) {
    const g = group('category-axis', root);

    labels.forEach((label, i) => {
      const [dx, dy] = spoke(i, count);
      // Labels above and below need more room than the side ones: text is centred on its line.
      const r = radius + style.size * (0.6 + 0.6 * Math.abs(dy));
      const side = dx > 0 ? 'start' : 'end';
      const anchor = Math.abs(dx) < 0.1 ? 'middle' : side;

      text(g, cx + dx * r, cy + dy * r, label, style, anchor);
    });
  }
  if (axis.deleted || !axis.showLabels) {
    return;
  }
  const g = group('value-axis', root);
  const format = axis.numFmt ?? model.series[0]?.formatCode;

  levels.forEach((v) => text(g, cx - style.size * 0.4, at(0, v)[1], formatValue(v, format), style, 'end'));
}
