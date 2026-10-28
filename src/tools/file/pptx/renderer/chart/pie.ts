import type { ChartModel } from './model';
import type { TextStyle } from './svg';
import { formatValue } from './format';
import { group, px, svg, text } from './svg';
import type { Box } from './legend';

export interface Slice {
  start: number;
  end: number;
}

export interface Ring {
  cx: number;
  cy: number;
  outer: number;
  inner: number;
}

/** Slice angles in degrees, clockwise from 12 o'clock. */
export function pieSlices(values: number[], firstSliceAngle: number): Slice[] {
  const sizes = values.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0));
  const total = sizes.reduce((a, b) => a + b, 0);
  const running = { sum: 0 };

  return sizes.map((size) => {
    running.sum += size;

    return {
      start: firstSliceAngle + (total > 0 ? ((running.sum - size) / total) * 360 : 0),
      end: firstSliceAngle + (total > 0 ? (running.sum / total) * 360 : 0),
    };
  });
}

function point(cx: number, cy: number, r: number, deg: number): string {
  const rad = (deg * Math.PI) / 180;

  return `${px(cx + r * Math.sin(rad))} ${px(cy - r * Math.cos(rad))}`;
}

export function slicePath(ring: Ring, slice: Slice): string {
  const { cx, cy, outer, inner } = ring;
  const sweep = slice.end - slice.start;

  if (sweep >= 359.999) {
    const full = `M${point(cx, cy, outer, 0)} A${outer} ${outer} 0 1 1 ${point(cx, cy, outer, 180)} A${outer} ${outer} 0 1 1 ${point(cx, cy, outer, 0)} Z`;

    return inner > 0 ? `${full} M${point(cx, cy, inner, 0)} A${inner} ${inner} 0 1 0 ${point(cx, cy, inner, 180)} A${inner} ${inner} 0 1 0 ${point(cx, cy, inner, 0)} Z` : full;
  }
  const large = sweep > 180 ? 1 : 0;
  const outerArc = `${point(cx, cy, outer, slice.start)} A${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, slice.end)}`;

  if (inner <= 0) {
    return `M${px(cx)} ${px(cy)} L${outerArc} Z`;
  }

  return `M${outerArc} L${point(cx, cy, inner, slice.end)} A${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, slice.start)} Z`;
}

function labelText(model: ChartModel, seriesIndex: number, i: number, share: number): string {
  const s = model.series[seriesIndex];
  const parts = [
    s.labels.showSerName ? s.name : '',
    s.labels.showCatName ? s.categories[i] ?? '' : '',
    s.labels.showVal ? formatValue(s.values[i], s.labels.formatCode ?? s.formatCode) : '',
    s.labels.showPercent ? formatValue(share, '0%') : '',
  ];

  return parts.filter((p) => p !== '').join('; ');
}

// Pies draw only the first series; doughnuts one ring per series, the first innermost.
// Unverified against Office: no test deck has a second series.
export function drawPie(model: ChartModel, box: Box, root: Element, style: TextStyle): void {
  const doughnut = model.kind === 'doughnut';
  const drawn = doughnut ? model.series : model.series.slice(0, 1);
  // A spread over a huge list overflows the call stack.
  const maxExplosion = drawn.reduce((max, s) => s.explosion.reduce((m, e) => Math.max(m, e), max), 0) / 100;
  const radius = (Math.min(box.w, box.h) / 2) / (1 + maxExplosion);
  const hole = doughnut ? radius * Math.min(Math.max(model.holeSize, 10), 90) / 100 : 0;
  const ringWidth = drawn.length > 0 ? (radius - hole) / drawn.length : 0;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const labels = group('data-labels', root);

  drawn.forEach((s, si) => {
    const g = group('series', root);
    const inner = hole + ringWidth * si;
    const outer = inner + ringWidth;
    const total = s.values.reduce((a, v) => a + Math.abs(v), 0);

    pieSlices(s.values, model.firstSliceAngle).forEach((slice, i) => {
      const mid = (((slice.start + slice.end) / 2) * Math.PI) / 180;
      const shift = (s.explosion[i] / 100) * radius;
      const dx = Math.sin(mid) * shift;
      const dy = -Math.cos(mid) * shift;
      const ring = { cx: cx + dx, cy: cy + dy, outer, inner };
      const content = labelText(model, si, i, total > 0 ? Math.abs(s.values[i]) / total : 0);

      svg('path', { d: slicePath(ring, slice), fill: s.pointColors[i] ?? s.color }, g);
      if (content !== '' && slice.end > slice.start) {
        const r = inner > 0 ? (inner + outer) / 2 : outer * 0.65;

        text(labels, ring.cx + Math.sin(mid) * r, ring.cy - Math.cos(mid) * r, content, style);
      }
    });
  });
  root.appendChild(labels);
}
