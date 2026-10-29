// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import type { ChartModel, ChartSeries } from './model';
import type { AxisScale } from './scale';
import type { Box } from './legend';
import type { TextStyle } from './svg';
import { formatValue } from './format';
import { drawMarker } from './marker';
import { areaValueAxis, autoValueAxis, desiredTickCount, niceAxisInterval } from './scale';
import { group, px, svg, text, textWidth } from './svg';

const PERCENT_AXIS: AxisScale = { min: 0, max: 1, major: 0.1 };
const MAX_TICKS = 200;

interface Frame {
  plot: Box;
  /** Value axis runs along x (horizontal bars, scatter x) or y. */
  valuePx: (v: number) => number;
  categoryPx: (i: number) => number;
  band: number;
  zero: number;
}

function tickCount(scale: AxisScale): number {
  return Math.round((scale.max - scale.min) / scale.major);
}

function usable(count: number): boolean {
  return Number.isFinite(count) && count >= 1 && count <= MAX_TICKS;
}

/** Tick values; a hostile major unit or range falls back to a nice step, then to the two ends. */
export function ticks(scale: AxisScale): number[] {
  const fallback = { ...scale, major: niceAxisInterval(scale.max, scale.min, 8) };
  const step = [scale, fallback].find((s) => usable(tickCount(s)));

  if (step === undefined) {
    return [scale.min, scale.max];
  }

  return Array.from({ length: tickCount(step) + 1 }, (_, k) => Number((step.min + k * step.major).toPrecision(12)));
}

function linear(scale: AxisScale, from: number, to: number, reversed: boolean): (v: number) => number {
  const [a, b] = reversed ? [to, from] : [from, to];

  return (v) => a + ((v - scale.min) / (scale.max - scale.min)) * (b - a);
}

function isStacked(model: ChartModel): boolean {
  return model.grouping === 'stacked' || model.grouping === 'percentStacked';
}

function pointCount(model: ChartModel): number {
  return Math.max(model.categories.length, ...model.series.map((s) => s.values.length));
}

/** Per-point values as plotted: raw, or each series' share of the category total for percent stacks. */
function plotted(model: ChartModel): number[][] {
  if (model.grouping !== 'percentStacked') {
    return model.series.map((s) => s.values);
  }
  const totals = Array.from({ length: pointCount(model) }, (_, i) => model.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0));

  return model.series.map((s) => s.values.map((v, i) => (totals[i] > 0 ? v / totals[i] : 0)));
}

/** Running stack bases per series: positives and negatives stack apart for bars. */
function stackBases(values: number[][], splitSigns: boolean): number[][] {
  const count = Math.max(0, ...values.map((v) => v.length));
  const pos = new Array<number>(count).fill(0);
  const neg = new Array<number>(count).fill(0);

  return values.map((series) => series.map((v, i) => {
    const below = v < 0 && splitSigns;
    const base = below ? neg[i] : pos[i];

    (below ? neg : pos)[i] = base + v;

    return base;
  }));
}

/** Plotted values the axis must reach: stack tops for stacked layers. */
function axisValues(model: ChartModel): number[] {
  const values = plotted(model);

  if (!isStacked(model)) {
    return values.flat();
  }
  const bases = stackBases(values, model.kind === 'bar');

  return values.flatMap((s, si) => s.map((v, i) => v + bases[si][i]));
}

/** One value axis shared by the given layers. */
function valueScale(layers: ChartModel[], spanPx: number, style: TextStyle): AxisScale {
  const axis = layers[0].valueAxis;

  if (layers.some((l) => l.grouping === 'percentStacked')) {
    return { ...PERCENT_AXIS, min: axis.min ?? 0, max: axis.max ?? 1 };
  }
  const bars = layers.some((l) => l.kind === 'bar');
  const desired = desiredTickCount(spanPx, style.size, bars);
  const input = { values: layers.flatMap(axisValues), desiredTicks: desired, stacked: layers.some(isStacked), min: axis.min, max: axis.max, major: axis.major };

  return layers.every((l) => l.kind === 'area') ? areaValueAxis(input) : autoValueAxis(input);
}

function scatterScale(values: number[], axis: ChartModel['valueAxis']): AxisScale {
  const finite = values.filter((v) => Number.isFinite(v));
  const span = finite.length > 0 ? Math.max(...finite) - Math.min(0, ...finite) : 0;

  return autoValueAxis({ values: finite, desiredTicks: span <= 3 ? 3 : 8, stacked: true, min: axis.min, max: axis.max, major: axis.major });
}

function tickFormat(model: ChartModel, axis: ChartModel['valueAxis'], series?: ChartSeries): string | undefined {
  if (model.grouping === 'percentStacked' && model.kind !== 'scatter') {
    return '0%';
  }

  return axis.numFmt ?? series?.formatCode;
}

function line(parent: Element, x1: number, y1: number, x2: number, y2: number, stroke: string): void {
  if (stroke !== 'none') {
    svg('line', { x1: px(x1), y1: px(y1), x2: px(x2), y2: px(y2), stroke, 'stroke-width': 1 }, parent);
  }
}

interface AxisDraw {
  scale: AxisScale;
  format?: string;
  axis: ChartModel['valueAxis'];
  /** Position along the axis for a value. */
  at: (v: number) => number;
  horizontal: boolean;
  /** A secondary value axis sits on the right edge, labels outside it. */
  right?: boolean;
}

function drawValueAxis(root: Element, plot: Box, d: AxisDraw, style: TextStyle, part = 'value-axis'): void {
  const values = ticks(d.scale);

  if (d.axis.gridlines) {
    const grid = group('gridlines', root);

    values.forEach((v) => (d.horizontal
      ? line(grid, d.at(v), plot.y, d.at(v), plot.y + plot.h, d.axis.gridColor)
      : line(grid, plot.x, d.at(v), plot.x + plot.w, d.at(v), d.axis.gridColor)));
  }
  if (d.axis.deleted) {
    return;
  }
  const g = group(part, root);

  const edge = d.right ? plot.x + plot.w : plot.x;

  if (d.horizontal) {
    line(g, plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h, d.axis.lineColor);
  } else {
    line(g, edge, plot.y, edge, plot.y + plot.h, d.axis.lineColor);
  }
  if (!d.axis.showLabels) {
    return;
  }
  const labelX = d.right ? edge + style.size * 0.4 : edge - style.size * 0.4;

  values.forEach((v) => (d.horizontal
    ? text(g, d.at(v), plot.y + plot.h + style.size * 0.9, formatValue(v, d.format), style)
    : text(g, labelX, d.at(v), formatValue(v, d.format), style, d.right ? 'start' : 'end')));
}

function drawCategoryAxis(root: Element, model: ChartModel, f: Frame, horizontal: boolean, style: TextStyle): void {
  const axis = model.categoryAxis;

  if (axis.deleted) {
    return;
  }
  const g = group('category-axis', root);
  const { plot, zero } = f;

  if (horizontal) {
    line(g, zero, plot.y, zero, plot.y + plot.h, axis.lineColor);
  } else {
    line(g, plot.x, zero, plot.x + plot.w, zero, axis.lineColor);
  }
  if (!axis.showLabels) {
    return;
  }
  Array.from({ length: pointCount(model) }, (_, i) => model.categories[i] ?? String(i + 1)).forEach((label, i) => (horizontal
    ? text(g, zero - style.size * 0.4, f.categoryPx(i), label, style, 'end')
    : text(g, f.categoryPx(i), zero + style.size * 0.9, label, style)));
}

function labelFor(s: ChartSeries, i: number, category: string): string {
  const { labels } = s;
  const parts = [
    labels.showSerName ? s.name : '',
    labels.showCatName ? category : '',
    labels.showVal ? formatValue(s.values[i], labels.formatCode ?? s.formatCode) : '',
  ];

  return parts.filter((p) => p !== '').join('; ');
}

function drawBars(model: ChartModel, f: Frame, root: Element, labels: Element, style: TextStyle): void {
  const values = plotted(model);
  const stacked = isStacked(model);
  const bases = stacked ? stackBases(values, true) : values.map((s) => s.map(() => 0));
  const lanes = stacked ? 1 : Math.max(1, model.series.length);
  const overlap = stacked ? 1 : Math.min(Math.max(model.overlap, -100), 100) / 100;
  const gap = Math.max(0, model.gapWidth) / 100;
  const barW = f.band / (lanes - (lanes - 1) * overlap + gap);

  model.series.forEach((s, si) => {
    const g = group('series', root);
    const lane = stacked ? 0 : si;

    values[si].forEach((v, i) => {
      if (s.blanks.has(i)) {
        return;
      }
      const offset = (gap * barW) / 2 + lane * barW * (1 - overlap);
      const center = f.categoryPx(i);
      // Horizontal bands run bottom-up, so the first series sits lowest.
      const across = model.horizontal ? center + f.band / 2 - offset - barW : center - f.band / 2 + offset;
      const from = f.valuePx(bases[si][i]);
      const to = f.valuePx(bases[si][i] + v);
      const fill = v < 0 && s.invertIfNegative ? '#FFFFFF' : s.pointColors[i] ?? s.color;
      const rect = model.horizontal
        ? { x: Math.min(from, to), y: across, width: Math.abs(to - from), height: barW }
        : { x: across, y: Math.min(from, to), width: barW, height: Math.abs(to - from) };

      svg('rect', { x: px(rect.x), y: px(rect.y), width: px(rect.width), height: px(rect.height), fill, ...(fill === '#FFFFFF' ? { stroke: '#000000', 'stroke-width': 1 } : {}) }, g);
      const content = labelFor(s, i, model.categories[i] ?? '');

      if (content === '') {
        return;
      }
      const end = stacked ? (from + to) / 2 : to + Math.sign(to - from || 1) * style.size * 0.7;

      text(labels, model.horizontal ? end : rect.x + barW / 2, model.horizontal ? rect.y + barW / 2 : end, content, style);
    });
  });
}

/** Catmull-Rom through the points as cubic Béziers. */
function smoothPath(points: number[][]): string {
  return points.map(([x, y], i) => {
    if (i === 0) {
      return `M${px(x)} ${px(y)}`;
    }
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p3 = points[Math.min(points.length - 1, i + 1)];
    const c1 = [p1[0] + (x - p0[0]) / 6, p1[1] + (y - p0[1]) / 6];
    const c2 = [x - (p3[0] - p1[0]) / 6, y - (p3[1] - p1[1]) / 6];

    return `C${px(c1[0])} ${px(c1[1])} ${px(c2[0])} ${px(c2[1])} ${px(x)} ${px(y)}`;
  }).join(' ');
}

/** Splits at blank points so a gap shows where Office shows one. */
function runs(points: (number[] | undefined)[]): number[][][] {
  return points.reduce<number[][][]>((acc, p) => {
    if (p === undefined) {
      return [...acc, []];
    }
    acc[acc.length - 1].push(p);

    return acc;
  }, [[]]).filter((r) => r.length > 0);
}

function polyline(points: number[][], smooth: boolean): string {
  return smooth ? smoothPath(points) : points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)} ${px(y)}`).join(' ');
}

function drawSeriesLine(g: Element, s: ChartSeries, points: (number[] | undefined)[]): void {
  const d = runs(points).map((r) => polyline(r, s.smooth)).join(' ');

  if (!s.noLine && d !== '') {
    svg('path', { 'data-pptx-chart': 'line', d, fill: 'none', stroke: s.color, 'stroke-width': px(s.lineWidth), 'stroke-linejoin': 'round' }, g);
  }
  const { marker } = s;

  if (marker === undefined) {
    return;
  }
  points.forEach((p, i) => p && drawMarker(g, marker.symbol, p[0], p[1], marker.size, s.pointColors[i] ?? s.color));
}

function drawLabels(labels: Element, s: ChartSeries, points: (number[] | undefined)[], categories: string[], style: TextStyle): void {
  points.forEach((p, i) => {
    const content = p ? labelFor(s, i, categories[i] ?? '') : '';

    if (p && content !== '') {
      text(labels, p[0], p[1] - style.size * 0.8, content, style);
    }
  });
}

function drawLinesOrAreas(model: ChartModel, f: Frame, root: Element, labels: Element, style: TextStyle): void {
  const values = plotted(model);
  const stacked = isStacked(model);
  const bases = stacked ? stackBases(values, false) : values.map((s) => s.map(() => 0));
  const area = model.kind === 'area';

  model.series.forEach((s, si) => {
    const g = group('series', root);
    const at = (i: number, v: number): number[] => [f.categoryPx(i), f.valuePx(v)];
    const tops = values[si].map((v, i) => (s.blanks.has(i) && !area ? undefined : at(i, bases[si][i] + v)));

    if (area) {
      const top = tops.filter((p): p is number[] => p !== undefined);
      const floor = values[si].map((_, i) => at(i, bases[si][i])).reverse();
      const flat = stacked ? floor : floor.map(([x]) => [x, f.zero]);
      const d = [...top, ...flat].map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${px(x)} ${px(y)}`).join(' ');

      svg('path', { 'data-pptx-chart': 'area', d: `${d} Z`, fill: s.color }, g);
    } else {
      drawSeriesLine(g, s, tops);
    }
    drawLabels(labels, s, tops, model.categories, style);
  });
}

function drawScatter(model: ChartModel, f: Frame, xPx: (v: number) => number, root: Element, labels: Element, style: TextStyle): void {
  model.series.forEach((s) => {
    const g = group('series', root);
    const points = s.values.map((v, i) => (s.blanks.has(i) ? undefined : [xPx(s.xValues[i] ?? i + 1), f.valuePx(v)]));

    drawSeriesLine(g, s, points);
    drawLabels(labels, s, points, model.categories, style);
  });
}

function plotBox(area: Box, left: number, bottom: number, style: TextStyle, right = style.size): Box {
  const top = style.size * 0.5;

  return { x: area.x + left, y: area.y + top, w: Math.max(1, area.w - left - right), h: Math.max(1, area.h - top - bottom) };
}

function labelWidth(scale: AxisScale, format: string | undefined, style: TextStyle): number {
  return Math.max(...ticks(scale).map((v) => textWidth(formatValue(v, format), style.size))) + style.size * 0.6;
}

function categoryFrame(model: ChartModel, plot: Box, scale: AxisScale): Frame {
  const count = Math.max(1, pointCount(model));
  const horizontal = model.kind === 'bar' && model.horizontal;
  const between = layersOf(model).some((l) => l.kind === 'bar') || model.valueAxis.betweenCategories;
  const len = horizontal ? plot.h : plot.w;
  const band = len / count;
  const offset = (i: number): number => (between || count === 1 ? (i + 0.5) * band : (i * len) / (count - 1));
  const reversed = model.categoryAxis.reversed;
  const valuePx = horizontal
    ? linear(scale, plot.x, plot.x + plot.w, model.valueAxis.reversed)
    : linear(scale, plot.y + plot.h, plot.y, model.valueAxis.reversed);
  const categoryPx = (i: number): number => {
    const along = reversed ? len - offset(i) : offset(i);

    return horizontal ? plot.y + plot.h - along : plot.x + along;
  };

  return { plot, valuePx, categoryPx, band, zero: valuePx(Math.min(Math.max(0, scale.min), scale.max)) };
}

function plotFrameRect(root: Element, plot: Box): void {
  svg('rect', { 'data-pptx-chart': 'plot', x: px(plot.x), y: px(plot.y), width: px(plot.w), height: px(plot.h), fill: 'none' }, root);
}

function drawXY(model: ChartModel, area: Box, root: Element, style: TextStyle): void {
  const xAxis = model.categoryAxis;
  const yAxis = model.valueAxis;
  const xScale = scatterScale(model.series.flatMap((s) => s.xValues), xAxis);
  const yScale = scatterScale(model.series.flatMap((s) => s.values.filter((_, i) => !s.blanks.has(i))), yAxis);
  const yFormat = tickFormat(model, yAxis, model.series[0]);
  const xFormat = xAxis.numFmt;
  const left = yAxis.deleted || !yAxis.showLabels ? 0 : labelWidth(yScale, yFormat, style);
  const bottom = xAxis.deleted || !xAxis.showLabels ? 0 : style.size * 1.6;
  const plot = plotBox(area, left, bottom, style);
  const xPx = linear(xScale, plot.x, plot.x + plot.w, xAxis.reversed);
  const yPx = linear(yScale, plot.y + plot.h, plot.y, yAxis.reversed);
  const frame: Frame = { plot, valuePx: yPx, categoryPx: xPx, band: 0, zero: yPx(yScale.min) };

  plotFrameRect(root, plot);
  drawValueAxis(root, plot, { scale: xScale, format: xFormat, axis: xAxis, at: xPx, horizontal: true }, style, 'category-axis');
  drawValueAxis(root, plot, { scale: yScale, format: yFormat, axis: yAxis, at: yPx, horizontal: false }, style);
  const labels = group('data-labels', root);

  drawScatter(model, frame, xPx, root, labels, style);
  root.appendChild(labels);
}

function layersOf(model: ChartModel): ChartModel[] {
  return model.layers ?? [model];
}

function drawLayer(layer: ChartModel, f: Frame, root: Element, labels: Element, style: TextStyle): void {
  if (layer.kind === 'bar') {
    drawBars(layer, f, root, labels, style);
  } else {
    drawLinesOrAreas(layer, f, root, labels, style);
  }
}

export function drawCartesian(model: ChartModel, area: Box, root: Element, style: TextStyle): void {
  if (model.kind === 'scatter') {
    drawXY(model, area, root, style);

    return;
  }
  const horizontal = model.kind === 'bar' && model.horizontal;
  const layers = layersOf(model);
  const primary = layers.filter((l) => !l.secondary);
  const secondary = layers.filter((l) => l.secondary);
  const catShown = !model.categoryAxis.deleted && model.categoryAxis.showLabels;
  const valShown = !model.valueAxis.deleted && model.valueAxis.showLabels;
  const categories = Array.from({ length: pointCount(model) }, (_, i) => model.categories[i] ?? String(i + 1));
  const catWidth = Math.max(0, ...categories.map((c) => textWidth(c, style.size))) + style.size * 0.6;
  // Tick density follows the whole area, labels included, as the reference does.
  const span = horizontal ? area.w : area.h;
  const scale = valueScale(primary.length > 0 ? primary : layers, span, style);
  const format = tickFormat(model, model.valueAxis, model.series[0]);
  const valueRoom = valShown ? labelWidth(scale, format, style) : 0;
  const second = secondary.length > 0 ? secondary[0] : undefined;
  const secondScale = second ? valueScale(secondary, span, style) : undefined;
  const secondFormat = second ? tickFormat(second, second.valueAxis, second.series[0]) : undefined;
  const secondShown = second !== undefined && !second.valueAxis.deleted && second.valueAxis.showLabels;
  const rightRoom = secondShown && secondScale ? labelWidth(secondScale, secondFormat, style) : undefined;
  const plot = horizontal
    ? plotBox(area, catShown ? catWidth : 0, valShown ? style.size * 1.6 : 0, style)
    : plotBox(area, valueRoom, catShown ? style.size * 1.6 : 0, style, rightRoom);
  const frame = categoryFrame(model, plot, scale);

  plotFrameRect(root, plot);
  drawValueAxis(root, plot, { scale, format, axis: model.valueAxis, at: frame.valuePx, horizontal }, style);
  const secondFrame = second && secondScale ? categoryFrame(second, plot, secondScale) : frame;

  if (second && secondScale) {
    drawValueAxis(root, plot, { scale: secondScale, format: secondFormat, axis: second.valueAxis, at: secondFrame.valuePx, horizontal: false, right: true }, style, 'secondary-value-axis');
  }
  const labels = group('data-labels', root);

  layers.forEach((layer) => drawLayer(layer, layer.secondary ? { ...secondFrame, categoryPx: frame.categoryPx, band: frame.band } : frame, root, labels, style));
  drawCategoryAxis(root, model, frame, horizontal, style);
  root.appendChild(labels);
}
