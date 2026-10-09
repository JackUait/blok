import type { I18n } from '../../../types';
import type { ChartData, ChartPoint, ChartSeries } from './chart-data';
import { CHART_HEIGHT_PX } from './chart-settings';
import type { ResolvedChartSettings } from './chart-settings';
import type { DatabaseViewRenderer } from './database-view-renderer';
import type { ChartColorTheme } from './types';
import { hide as hideHint, show as showHint } from '../../components/utils/tooltip';

const NS = 'http://www.w3.org/2000/svg';

/** Hues for the categorical order and the one-hue themes. Validated with the dataviz skill's checker on Blok's surfaces. */
const HUES = ['blue', 'orange', 'teal', 'yellow', 'pink', 'green', 'purple', 'red'] as const;

/** Light values, so an export or a host without database.css still has color. Keep in step with database.css. */
const HUE_FALLBACK: Readonly<Record<string, string>> = {
  blue: '#2a78d6',
  orange: '#eb6834',
  teal: '#1baf7a',
  yellow: '#eda100',
  pink: '#e87ba4',
  green: '#008300',
  purple: '#4a3aa7',
  red: '#e34948',
  gray: '#8e8b86',
};

const hueVar = (hue: string): string => `var(--blok-database-chart-${hue}, ${HUE_FALLBACK[hue]})`;
const SURFACE = 'var(--blok-bg-primary, #ffffff)';
const INK = 'var(--blok-text-primary, #2c2c2b)';
const MUTED_INK = 'var(--blok-database-table-header-text, #7d7a75)';
const GRID = 'var(--blok-database-table-border, rgba(42, 28, 0, 0.07))';

/** Mark specs from the dataviz skill: thin bars, 4px data end, 2px line, 4px marker radius, 2px surface gap. */
const MAX_BAR = 24;
const BAR_RADIUS = 4;
const LINE_WIDTH = 2;
const MARKER_RADIUS = 4;
const GAP = 2;
const FONT_SIZE = 12;
/** Average glyph width at 12px, to size labels before they exist. */
const CHAR_WIDTH = 6.5;
const DEFAULT_WIDTH = 640;

export interface ChartColor {
  color: string;
  /** One-hue themes tell entries apart by strength. */
  opacity: number;
}

/**
 * Each entry's color. Auto and Colorful take the categorical order; a one-hue
 * theme steps its strength. Notion's own palettes are unmeasured (research/08).
 */
export const chartColors = (theme: ChartColorTheme, count: number): ChartColor[] => {
  if (theme === 'auto' || theme === 'colorful') {
    return Array.from({ length: count }, (_, i) => ({ color: hueVar(HUES[i % HUES.length]), opacity: 1 }));
  }

  return Array.from({ length: count }, (_, i) => ({
    color: hueVar(theme === 'gray' ? 'gray' : theme),
    opacity: count === 1 ? 1 : 1 - (0.6 * i) / (count - 1),
  }));
};

export interface ChartViewHandlers {
  /** A click on a group (a series' segment passes the series). */
  drilldown: (point: ChartPoint, series: ChartSeries | undefined) => void;
  /** A legend click: hide or show that group or series. */
  toggle: (key: string) => void;
}

export interface ChartViewOptions {
  settings: ResolvedChartSettings;
  data: ChartData;
  xName: string;
  yName: string;
  i18n: Pick<I18n, 't'>;
  formatValue: (value: number) => string;
  handlers: ChartViewHandlers;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(NS, tag);

  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, String(value));
  }

  return el;
};

const niceStep = (raw: number): number => {
  const power = 10 ** Math.floor(Math.log10(raw));
  const n = raw / power;
  const nice = [1, 2, 5].find((step) => n <= step) ?? 10;

  return nice * power;
};

/** Round ticks from zero past the highest value. */
export const valueTicks = (max: number): number[] => {
  if (!(max > 0)) return [0, 1];
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;

  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Number((i * step).toPrecision(12)));
};

const fit = (text: string, width: number): string => {
  const chars = Math.max(1, Math.floor(width / CHAR_WIDTH));

  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`;
};

/** A bar with a curved data end and a square foot on the baseline. */
const barPath = (x: number, y: number, w: number, h: number, horizontal: boolean, round: boolean): string => {
  const r = round ? Math.min(BAR_RADIUS, w / 2, h / 2) : 0;

  if (horizontal) {
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

/** Catmull-Rom through the points, as cubic curves. */
const linePath = (pts: Array<[number, number]>, smooth: boolean): string => {
  if (pts.length === 0) return '';
  const [first, ...rest] = pts;

  if (!smooth || pts.length < 3) {
    return `M${first[0]},${first[1]}${rest.map(([x, y]) => `L${x},${y}`).join('')}`;
  }

  return `M${first[0]},${first[1]}${rest.map((p, i) => {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
    const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];

    return `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p[0]},${p[1]}`;
  }).join('')}`;
};

const arcPath = (cx: number, cy: number, outer: number, inner: number, start: number, end: number): string => {
  const at = (r: number, a: number): string => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`;
  const large = end - start > Math.PI ? 1 : 0;

  return `M${at(outer, start)}A${outer},${outer} 0 ${large} 1 ${at(outer, end)}L${at(inner, end)}A${inner},${inner} 0 ${large} 0 ${at(inner, start)}Z`;
};

const counter = { next: 0 };

/**
 * Notion's chart view (research/03 §8): column, bar, line, donut and number.
 * Drawn as DOM-built SVG; Notion's own pixels are unmeasured (research/08:
 * paywalled), so marks follow the dataviz skill and Blok's tokens.
 */
export class DatabaseChartView implements DatabaseViewRenderer {
  private readonly options: ChartViewOptions;
  private readonly id = `blok-chart-${(counter.next += 1)}`;
  private root: HTMLDivElement | null = null;
  private plot: HTMLDivElement | null = null;
  private anchor: HTMLDivElement | null = null;
  private observer: ResizeObserver | null = null;
  private width = 0;

  constructor(options: ChartViewOptions) {
    this.options = options;
  }

  createView(): HTMLDivElement {
    const { settings, data, i18n } = this.options;
    const root = document.createElement('div');

    root.setAttribute('data-blok-database-chart', '');
    root.setAttribute('data-chart-type', settings.type);
    this.root = root;

    if (settings.type === 'number') {
      root.appendChild(this.createNumber());

      return root;
    }
    if (data.points.every((p) => p.hidden) || data.points.length === 0) {
      const empty = document.createElement('div');

      empty.setAttribute('data-blok-database-chart-empty', '');
      empty.textContent = i18n.t('tools.database.chartEmpty');
      root.appendChild(empty);

      return root;
    }

    const body = document.createElement('div');
    const plot = document.createElement('div');
    const anchor = document.createElement('div');

    body.setAttribute('data-blok-database-chart-body', '');
    plot.setAttribute('data-blok-database-chart-plot', '');
    anchor.setAttribute('data-blok-database-chart-anchor', '');
    anchor.setAttribute('aria-hidden', 'true');
    this.plot = plot;
    this.anchor = anchor;
    body.appendChild(plot);
    root.append(body, anchor);

    const legend = this.createLegend();

    if (legend !== null) {
      root.setAttribute('data-legend', settings.legend);
      body.appendChild(legend);
    }
    if (data.truncated) {
      const note = document.createElement('div');

      note.setAttribute('data-blok-database-chart-truncated', '');
      note.textContent = i18n.t('tools.database.chartTruncated');
      root.appendChild(note);
    }
    this.draw(DEFAULT_WIDTH);
    this.observe(plot);

    return root;
  }

  appendRow(): void {
    // The tool redraws the whole chart on a row change.
  }

  removeRow(): void {
    // The tool redraws the whole chart on a row change.
  }

  updateRowTitle(): void {
    // Titles are not drawn.
  }

  destroy(): void {
    hideHint();
    this.observer?.disconnect();
    this.observer = null;
  }

  /** A standalone SVG of the chart, colors and fonts resolved, for "Save chart as". */
  toSvgString(): string {
    const svg = this.plot?.querySelector('svg');

    if (svg === null || svg === undefined) return '';
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const host = this.root ?? svg;
    const resolve = (text: string): string => text.replace(/var\((--[a-z0-9-]+),\s*([^()]*(?:\([^()]*\))?[^()]*)\)/gi, (_, name: string, fallback: string) => {
      const value = getComputedStyle(host).getPropertyValue(name).trim();

      return value !== '' ? value : fallback.trim();
    });

    clone.querySelectorAll('[data-blok-database-chart-hit]').forEach((el) => {
      if (el.getAttribute('data-blok-database-chart-mark') === null) el.remove();
    });
    clone.querySelectorAll('*').forEach((el) => {
      ['data-blok-database-chart-hit', 'tabindex', 'role', 'aria-label'].forEach((name) => el.removeAttribute(name));
      const style = el.getAttribute('style');

      if (style !== null) el.setAttribute('style', resolve(style));
      ['fill', 'stroke', 'stop-color'].forEach((name) => {
        const value = el.getAttribute(name);

        if (value !== null) el.setAttribute(name, resolve(value));
      });
    });
    clone.setAttribute('xmlns', NS);
    const family = getComputedStyle(host).fontFamily;

    clone.setAttribute('style', `font-family:${family === '' ? 'system-ui, sans-serif' : family}`);
    const background = svgEl('rect', { width: '100%', height: '100%', fill: resolve(SURFACE) });

    clone.insertBefore(background, clone.firstChild);

    return new XMLSerializer().serializeToString(clone);
  }

  /** The chart as a PNG at twice its size. Null when the browser cannot paint it. */
  async toPngBlob(): Promise<Blob | null> {
    const svg = this.plot?.querySelector('svg');
    const text = this.toSvgString();

    if (svg === null || svg === undefined || text === '') return null;
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));

    try {
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('chart image failed'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');

      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');

      if (context === null) return null;
      context.scale(2, 2);
      context.drawImage(image, 0, 0, width, height);

      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private observe(plot: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);

      if (width > 0 && Math.abs(width - this.width) > 1) this.draw(width);
    });
    this.observer.observe(plot);
  }

  private createNumber(): HTMLElement {
    const box = document.createElement('div');
    const value = document.createElement('div');
    const caption = document.createElement('div');

    box.setAttribute('data-blok-database-chart-number-box', '');
    value.setAttribute('data-blok-database-chart-number', '');
    caption.setAttribute('data-blok-database-chart-number-caption', '');
    value.textContent = this.options.formatValue(this.options.data.total);
    caption.textContent = this.options.yName;
    box.append(value, caption);

    return box;
  }

  /** Legend entries: the slices of a donut, else the series. One series needs none. */
  private legendEntries(): Array<{ key: string; label: string; hidden: boolean; color: ChartColor }> {
    const { settings, data } = this.options;

    if (settings.type === 'donut') {
      const colors = chartColors(settings.color, data.points.length);

      return data.points.map((p, i) => ({ key: p.key, label: p.label, hidden: p.hidden, color: colors[i] }));
    }
    const colors = chartColors(settings.color, data.series.length);

    return data.series.length < 2 ? [] : data.series.map((s, i) => ({ key: s.key, label: s.label, hidden: s.hidden, color: colors[i] }));
  }

  private createLegend(): HTMLElement | null {
    const entries = this.legendEntries();

    if (this.options.settings.legend === 'off' || entries.length === 0) return null;
    const legend = document.createElement('div');

    legend.setAttribute('data-blok-database-chart-legend', '');
    legend.setAttribute('role', 'group');
    legend.setAttribute('aria-label', this.options.i18n.t('tools.database.chartLegend'));
    for (const entry of entries) {
      const button = document.createElement('button');
      const swatch = document.createElement('span');

      button.type = 'button';
      button.setAttribute('data-blok-database-chart-legend-entry', '');
      button.setAttribute('data-key', entry.key);
      button.setAttribute('aria-pressed', String(!entry.hidden));
      swatch.setAttribute('data-blok-database-chart-swatch', '');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.backgroundColor = entry.color.color;
      swatch.style.opacity = String(entry.color.opacity);
      button.append(swatch, entry.label);
      button.addEventListener('click', () => this.options.handlers.toggle(entry.key));
      legend.appendChild(button);
    }

    return legend;
  }

  private draw(width: number): void {
    const plot = this.plot;

    if (plot === null) return;
    this.width = width;
    const { settings, xName, yName } = this.options;
    const height = CHART_HEIGHT_PX[settings.height];
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });

    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', this.options.i18n.t('tools.database.chartLabel', { x: xName, y: yName }));
    svg.setAttribute('font-size', FONT_SIZE);
    if (settings.type === 'donut') {
      this.drawDonut(svg, width, height);
    } else {
      this.drawAxes(svg, width, height);
    }
    plot.replaceChildren(svg);
  }

  private shownSeries(): Array<{ series: ChartSeries; color: ChartColor }> {
    const { settings, data } = this.options;
    const colors = chartColors(settings.color, Math.max(1, data.series.length));

    return data.series.map((series, i) => ({ series, color: colors[i] })).filter((entry) => !entry.series.hidden);
  }

  private drawAxes(svg: SVGSVGElement, width: number, height: number): void {
    const { settings, data, formatValue } = this.options;
    const horizontal = settings.type === 'bar';
    const points = data.points.filter((p) => !p.hidden);
    const ticks = valueTicks(data.max);
    const top = ticks[ticks.length - 1];
    const tickText = ticks.map((t) => formatValue(t));
    const nameRoom = settings.axisNames ? 18 : 0;
    const valueRoom = Math.max(...tickText.map((t) => t.length)) * CHAR_WIDTH + 8;
    const categoryRoom = Math.min(140, Math.max(...points.map((p) => p.label.length)) * CHAR_WIDTH + 8);
    const box = {
      left: nameRoom + (horizontal ? categoryRoom : valueRoom),
      right: settings.dataLabels && horizontal ? 40 : 12,
      top: settings.dataLabels && !horizontal ? 20 : 10,
      bottom: nameRoom + 22,
    };
    const plotW = Math.max(10, width - box.left - box.right);
    const plotH = Math.max(10, height - box.top - box.bottom);
    const band = (horizontal ? plotH : plotW) / points.length;
    const scale = (value: number): number => (value / top) * (horizontal ? plotW : plotH);
    const bandStart = (i: number): number => (horizontal ? box.top : box.left) + i * band;
    const valueAt = (value: number): { x: number; y: number } => (horizontal
      ? { x: box.left + scale(value), y: 0 }
      : { x: 0, y: box.top + plotH - scale(value) });
    const grid = settings.gridLines;
    const valueLines = horizontal ? grid === 'vertical' || grid === 'both' : grid === 'horizontal' || grid === 'both';
    const categoryLines = horizontal ? grid === 'horizontal' || grid === 'both' : grid === 'vertical' || grid === 'both';
    const layer = svgEl('g');

    ticks.forEach((tick, i) => {
      const at = valueAt(tick);
      const label = svgEl('text', horizontal
        ? { x: at.x, y: box.top + plotH + 16, 'text-anchor': 'middle' }
        : { x: box.left - 6, y: at.y + 4, 'text-anchor': 'end' });

      label.setAttribute('data-blok-database-chart-tick', '');
      label.setAttribute('style', `fill:${MUTED_INK}`);
      label.textContent = tickText[i];
      layer.appendChild(label);
      if (valueLines && tick !== 0) {
        layer.appendChild(this.gridLine(horizontal ? [at.x, box.top, at.x, box.top + plotH] : [box.left, at.y, box.left + plotW, at.y]));
      }
    });
    points.forEach((p, i) => {
      const center = bandStart(i) + band / 2;
      const every = Math.max(1, Math.ceil((CHAR_WIDTH * 3) / band));

      if (categoryLines) {
        layer.appendChild(this.gridLine(horizontal ? [box.left, center, box.left + plotW, center] : [center, box.top, center, box.top + plotH]));
      }
      if (!horizontal && i % every !== 0) return;
      const label = svgEl('text', horizontal
        ? { x: box.left - 6, y: center + 4, 'text-anchor': 'end' }
        : { x: center, y: box.top + plotH + 16, 'text-anchor': 'middle' });

      label.setAttribute('data-blok-database-chart-category', '');
      label.setAttribute('style', `fill:${MUTED_INK}`);
      label.textContent = fit(p.label, horizontal ? categoryRoom - 8 : band * every - 4);
      layer.appendChild(label);
    });
    layer.appendChild(svgEl('line', {
      'data-blok-database-chart-axis': '',
      ...(horizontal
        ? { x1: box.left, y1: box.top, x2: box.left, y2: box.top + plotH }
        : { x1: box.left, y1: box.top + plotH, x2: box.left + plotW, y2: box.top + plotH }),
      style: `stroke:${GRID};stroke-width:1`,
    }));
    if (settings.axisNames) this.axisNames(layer, width, box, plotH, plotW);
    svg.appendChild(layer);

    const geometry = { horizontal, band, bandStart, scale, base: horizontal ? box.left : box.top + plotH, plotH, plotW, box };

    if (settings.type === 'line') {
      this.drawLines(svg, points, geometry);
    } else {
      this.drawBars(svg, points, geometry);
    }
  }

  private gridLine([x1, y1, x2, y2]: number[]): SVGLineElement {
    return svgEl('line', { 'data-blok-database-chart-grid': '', x1, y1, x2, y2, style: `stroke:${GRID};stroke-width:1` });
  }

  private axisNames(layer: SVGGElement, width: number, box: { left: number; bottom: number }, plotH: number, plotW: number): void {
    const { xName, yName, settings } = this.options;
    const [bottomName, sideName] = settings.type === 'bar' ? [yName, xName] : [xName, yName];
    const x = svgEl('text', { x: box.left + plotW / 2, y: box.bottom + plotH + 6, 'text-anchor': 'middle' });
    const middle = 10 + plotH / 2;
    const y = svgEl('text', { x: 12, y: middle, 'text-anchor': 'middle', transform: `rotate(-90 12 ${middle})` });

    for (const [el, text] of [[x, bottomName], [y, sideName]] as const) {
      el.setAttribute('data-blok-database-chart-axis-name', '');
      el.setAttribute('style', `fill:${MUTED_INK}`);
      el.textContent = fit(text, width / 2);
      layer.appendChild(el);
    }
  }

  private drawBars(svg: SVGSVGElement, points: ChartPoint[], g: {
    horizontal: boolean; band: number; bandStart: (i: number) => number; scale: (v: number) => number; base: number;
  }): void {
    const { settings, data } = this.options;
    const series = this.shownSeries();
    const single = chartColors(settings.color, 1)[0];
    const marks = svgEl('g');

    points.forEach((p, i) => {
      const parts = data.series.length === 0
        ? [{ series: undefined, color: single, value: p.value }]
        : series.map((entry) => ({ series: entry.series, color: entry.color, value: p.values[entry.series.key] ?? 0 }));
      const stacked = data.stacked || parts.length === 1;
      const thickness = Math.min(MAX_BAR, (g.band * 0.7) / (stacked ? 1 : parts.length));
      const groupStart = g.bandStart(i) + (g.band - thickness * (stacked ? 1 : parts.length)) / 2;
      const lastFilled = parts.map((part) => part.value > 0).lastIndexOf(true);

      parts.reduce((offset, part, j) => {
        const length = g.scale(Math.max(0, part.value));
        const along = stacked ? groupStart : groupStart + j * thickness;
        const isEnd = !stacked || j === lastFilled;
        // The 2px surface gap between touching marks: a stack's segments, or side-by-side bars.
        const drawn = Math.max(0, length - (stacked && !isEnd ? GAP : 0));
        const crossGap = !stacked && j > 0 ? GAP : 0;

        if (drawn > 0) {
          const d = g.horizontal
            ? barPath(g.base + offset, along + crossGap, drawn, thickness - crossGap, true, isEnd)
            : barPath(along + crossGap, g.base - offset - drawn, thickness - crossGap, drawn, false, isEnd);
          const mark = svgEl('path', { d, style: `fill:${part.color.color};fill-opacity:${part.color.opacity}` });

          mark.setAttribute('data-blok-database-chart-mark', '');
          mark.setAttribute('data-key', p.key);
          if (part.series !== undefined) mark.setAttribute('data-series', part.series.key);
          marks.appendChild(mark);
        }

        return stacked ? offset + length : offset;
      }, 0);
      if (settings.dataLabels) {
        const total = stacked ? parts.reduce((sum, part) => sum + Math.max(0, part.value), 0) : Math.max(...parts.map((part) => part.value));
        const center = g.bandStart(i) + g.band / 2;
        const label = svgEl('text', g.horizontal
          ? { x: g.base + g.scale(total) + 6, y: center + 4, 'text-anchor': 'start' }
          : { x: center, y: g.base - g.scale(total) - 6, 'text-anchor': 'middle' });

        label.setAttribute('data-blok-database-chart-data-label', '');
        label.setAttribute('style', `fill:${INK}`);
        label.textContent = this.options.formatValue(data.series.length === 0 ? p.value : total);
        marks.appendChild(label);
      }
    });
    svg.appendChild(marks);
    this.drawHits(svg, points, g);
  }

  private drawLines(svg: SVGSVGElement, points: ChartPoint[], g: {
    band: number; bandStart: (i: number) => number; scale: (v: number) => number; base: number;
  }): void {
    const { settings, data } = this.options;
    const lines = data.series.length === 0
      ? [{ series: undefined, color: chartColors(settings.color, 1)[0], value: (p: ChartPoint) => p.value }]
      : this.shownSeries().map((entry) => ({ ...entry, value: (p: ChartPoint) => p.values[entry.series.key] ?? 0 }));
    const layer = svgEl('g');
    const defs = svgEl('defs');

    lines.forEach((line, n) => {
      const pts = points.map((p, i): [number, number] => [g.bandStart(i) + g.band / 2, g.base - g.scale(Math.max(0, line.value(p)))]);
      const d = linePath(pts, settings.smooth);

      if (settings.gradient && pts.length > 0) {
        const id = `${this.id}-area-${n}`;
        const gradient = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });

        gradient.append(
          svgEl('stop', { offset: 0, 'stop-color': line.color.color, 'stop-opacity': 0.1 * line.color.opacity * 2 }),
          svgEl('stop', { offset: 1, 'stop-color': line.color.color, 'stop-opacity': 0 })
        );
        defs.appendChild(gradient);
        const area = svgEl('path', {
          d: `${d}L${pts[pts.length - 1][0]},${g.base}L${pts[0][0]},${g.base}Z`,
          fill: `url(#${id})`,
        });

        area.setAttribute('data-blok-database-chart-area', '');
        layer.appendChild(area);
      }
      const path = svgEl('path', {
        d,
        fill: 'none',
        style: `stroke:${line.color.color};stroke-opacity:${line.color.opacity};stroke-width:${LINE_WIDTH};stroke-linejoin:round;stroke-linecap:round`,
      });

      path.setAttribute('data-blok-database-chart-line', '');
      if (line.series !== undefined) path.setAttribute('data-series', line.series.key);
      layer.appendChild(path);
      pts.forEach(([x, y], i) => {
        const marker = svgEl('circle', {
          cx: x,
          cy: y,
          r: MARKER_RADIUS,
          style: `fill:${line.color.color};fill-opacity:${line.color.opacity};stroke:${SURFACE};stroke-width:${GAP}`,
        });

        marker.setAttribute('data-blok-database-chart-mark', '');
        marker.setAttribute('data-key', points[i].key);
        if (line.series !== undefined) marker.setAttribute('data-series', line.series.key);
        layer.appendChild(marker);
        if (settings.dataLabels) {
          const label = svgEl('text', { x, y: y - 8, 'text-anchor': 'middle', style: `fill:${INK}` });

          label.setAttribute('data-blok-database-chart-data-label', '');
          label.textContent = this.options.formatValue(line.value(points[i]));
          layer.appendChild(label);
        }
      });
    });
    if (defs.childElementCount > 0) svg.appendChild(defs);
    svg.appendChild(layer);
    this.drawHits(svg, points, { ...g, horizontal: false });
  }

  /** One transparent target per group, the whole band: bigger than the mark, as the dataviz skill asks. */
  private drawHits(svg: SVGSVGElement, points: ChartPoint[], g: {
    horizontal: boolean; band: number; bandStart: (i: number) => number; base: number; scale: (v: number) => number;
  }): void {
    const reach = g.scale(valueTicks(this.options.data.max).at(-1) ?? 1);
    const layer = svgEl('g');

    points.forEach((p, i) => {
      const hit = svgEl('rect', g.horizontal
        ? { x: g.base, y: g.bandStart(i), width: reach, height: g.band }
        : { x: g.bandStart(i), y: g.base - reach, width: g.band, height: reach });

      hit.setAttribute('fill', 'transparent');
      this.wireHit(hit, p);
      layer.appendChild(hit);
    });
    svg.appendChild(layer);
  }

  private drawDonut(svg: SVGSVGElement, width: number, height: number): void {
    const { settings, data, formatValue } = this.options;
    const colors = chartColors(settings.color, data.points.length);
    const shown = data.points.map((p, i) => ({ p, color: colors[i] })).filter((entry) => !entry.p.hidden && entry.p.value > 0);
    const sum = shown.reduce((total, entry) => total + entry.p.value, 0);
    const outer = Math.max(10, Math.min(width, height) / 2 - (settings.dataLabels ? 28 : 8));
    const inner = outer * 0.62;
    const cx = width / 2;
    const cy = height / 2;
    const layer = svgEl('g');

    shown.reduce((start, { p, color }) => {
      // A full ring cannot be one arc: stop just short of the start.
      const end = Math.min(start + (p.value / sum) * Math.PI * 2, start + Math.PI * 2 - 0.0001);
      const slice = svgEl('path', {
        d: arcPath(cx, cy, outer, inner, start, end),
        style: `fill:${color.color};fill-opacity:${color.opacity};stroke:${SURFACE};stroke-width:${shown.length > 1 ? GAP : 0}`,
      });

      slice.setAttribute('data-blok-database-chart-mark', '');
      slice.setAttribute('data-key', p.key);
      this.wireHit(slice, p);
      layer.appendChild(slice);
      if (settings.dataLabels) {
        const middle = (start + end) / 2;
        const label = svgEl('text', {
          x: cx + (outer + 14) * Math.sin(middle),
          y: cy - (outer + 14) * Math.cos(middle) + 4,
          'text-anchor': Math.sin(middle) >= 0 ? 'start' : 'end',
          style: `fill:${INK}`,
        });

        label.setAttribute('data-blok-database-chart-data-label', '');
        label.textContent = formatValue(p.value);
        layer.appendChild(label);
      }

      return end;
    }, 0);
    if (settings.centerValue) {
      const center = svgEl('text', { x: cx, y: cy + 8, 'text-anchor': 'middle', 'font-size': 24, 'font-weight': 600, style: `fill:${INK}` });

      center.setAttribute('data-blok-database-chart-center', '');
      center.textContent = formatValue(data.total);
      layer.appendChild(center);
    }
    svg.appendChild(layer);
  }

  private wireHit(hit: SVGElement, point: ChartPoint): void {
    const label = `${point.label}: ${this.options.formatValue(point.value)}`;

    hit.setAttribute('data-blok-database-chart-hit', '');
    hit.setAttribute('data-key', point.key);
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('role', 'button');
    hit.setAttribute('aria-label', label);
    hit.addEventListener('click', () => this.options.handlers.drilldown(point, undefined));
    hit.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.options.handlers.drilldown(point, undefined);
    });
    // Hover only, never focus: a hint waits its delay on every bar (CLAUDE.md), unlike the usual chart readout.
    hit.addEventListener('mouseenter', () => this.showReadout(hit, point));
    hit.addEventListener('mouseleave', () => hideHint());
  }

  /**
   * The value under the pointer, through the shared hint. The anchor is an
   * HTML box laid over the mark: SVG shapes have no client size to place
   * a hint against.
   */
  private showReadout(mark: SVGElement, point: ChartPoint): void {
    const anchor = this.anchor;
    const root = this.root;

    if (anchor === null || root === null) return;
    const box = mark.getBoundingClientRect();
    const frame = root.getBoundingClientRect();

    anchor.style.left = `${box.left - frame.left}px`;
    anchor.style.top = `${box.top - frame.top}px`;
    anchor.style.width = `${box.width}px`;
    anchor.style.height = `${box.height}px`;
    showHint(anchor, this.readout(point));
  }

  private readout(point: ChartPoint): HTMLElement {
    const content = document.createElement('div');
    const title = document.createElement('div');

    content.setAttribute('data-blok-database-chart-readout', '');
    title.setAttribute('data-blok-database-chart-readout-title', '');
    title.textContent = point.label;
    content.appendChild(title);
    const rows = this.options.data.series.length === 0
      ? [{ label: this.options.yName, value: point.value, color: undefined }]
      : this.shownSeries().map((entry) => ({ label: entry.series.label, value: point.values[entry.series.key] ?? 0, color: entry.color }));

    for (const row of rows) {
      const line = document.createElement('div');

      line.setAttribute('data-blok-database-chart-readout-row', '');
      if (row.color !== undefined) {
        const swatch = document.createElement('span');

        swatch.setAttribute('data-blok-database-chart-swatch', '');
        swatch.style.backgroundColor = row.color.color;
        swatch.style.opacity = String(row.color.opacity);
        line.appendChild(swatch);
      }
      line.append(`${row.label}: ${this.options.formatValue(row.value)}`);
      content.appendChild(line);
    }

    return content;
  }
}
