// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
import type { SafeXmlNode } from '../../parser/XmlParser';
import type { RenderContext } from '../RenderContext';
import { parseOoxmlBool } from '../../parser/booleans';
import { ptToPx } from '../../parser/units';
import { cssFontFamilyStack, resolveThemeFontStack } from '../fontResolver';
import { resolveColorToCss } from '../StyleResolver';
import { extractFormatCode, extractNumericValuesWithBlanks, extractStringValues } from './format';

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'combo' | 'unsupported';
export type LegendPosition = 't' | 'b' | 'l' | 'r';

const KIND_BY_ELEMENT: Record<string, ChartKind> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'doughnut',
  scatterChart: 'scatter',
};

/** Plots that can share a category axis with another plot. */
const COMBO_KINDS = new Set<ChartKind>(['bar', 'line', 'area']);

const AUTO_MARKERS = ['diamond', 'square', 'triangle', 'circle'];
// Unverified Office default; python-pptx decks never set c:size.
const DEFAULT_MARKER_PT = 7;
const DEFAULT_FONT_PT = 10;

export interface DataLabels {
  showVal: boolean;
  showPercent: boolean;
  showCatName: boolean;
  showSerName: boolean;
  formatCode?: string;
}

export interface ChartSeries {
  name: string;
  categories: string[];
  values: number[];
  blanks: Set<number>;
  xValues: number[];
  formatCode?: string;
  color: string;
  /** Per-point fills: explicit c:dPt colours, else the palette when colours vary by point. */
  pointColors: string[];
  lineWidth: number;
  noLine: boolean;
  invertIfNegative: boolean;
  marker?: { symbol: string; size: number };
  smooth: boolean;
  explosion: number[];
  labels: DataLabels;
}

export interface ChartAxis {
  deleted: boolean;
  showLabels: boolean;
  numFmt?: string;
  min?: number;
  max?: number;
  major?: number;
  reversed: boolean;
  gridlines: boolean;
  lineColor: string;
  gridColor: string;
  /** midCat puts the first and last category on the plot edges. */
  betweenCategories: boolean;
}

export interface ChartModel {
  kind: ChartKind;
  title?: { text: string; size: number; bold: boolean };
  legend?: { position: LegendPosition };
  series: ChartSeries[];
  categories: string[];
  grouping: string;
  horizontal: boolean;
  varyColors: boolean;
  gapWidth: number;
  overlap: number;
  holeSize: number;
  firstSliceAngle: number;
  categoryAxis: ChartAxis;
  valueAxis: ChartAxis;
  text: { size: number; color: string; family: string };
  /** A combo chart's plots, in document order, sharing the category axis. */
  layers?: ChartModel[];
  /** The layer's values follow the secondary value axis, drawn on the right. */
  secondary?: boolean;
}

function bool(node: SafeXmlNode, fallback: boolean): boolean {
  return node.exists() ? parseOoxmlBool(node.attr('val'), true) : fallback;
}

function solidFillColor(parent: SafeXmlNode, ctx: RenderContext): string | undefined {
  const fill = parent.child('solidFill');

  return fill.exists() ? resolveColorToCss(fill, ctx) : undefined;
}

function hexOf(value: string): string {
  return value.startsWith('#') ? value : `#${value}`;
}

function buildPalette(ctx: RenderContext, chartPath?: string): string[] {
  const colorStyle = chartPath ? ctx.presentation.chartColorStyles?.get(chartPath) : undefined;
  const fromStyle = (colorStyle?.allChildren() ?? [])
    .filter((child) => child.localName.endsWith('Clr'))
    .map((child) => resolveColorToCss(child, ctx));

  if (fromStyle.length > 0) {
    return fromStyle;
  }
  const accents = [1, 2, 3, 4, 5, 6]
    .map((n) => ctx.theme.colorScheme.get(`accent${n}`))
    .filter((v): v is string => v !== undefined)
    .map(hexOf);

  return accents.length > 0 ? accents : ['#4472C4'];
}

/** Office 2007/2010 themes draw implicit axis and grid lines black; newer ones gray. */
function implicitAxisColor(ctx: RenderContext): string {
  const accent = (n: number): string => (ctx.theme.colorScheme.get(`accent${n}`) ?? '').replace('#', '').toUpperCase();

  return accent(1) === '4F81BD' && accent(2) === 'C0504D' ? '#000000' : '#898989';
}

function textDefaults(node: SafeXmlNode): SafeXmlNode {
  return node.child('txPr').child('p').child('pPr').child('defRPr');
}

function readText(chartSpace: SafeXmlNode, ctx: RenderContext): ChartModel['text'] {
  const defRPr = textDefaults(chartSpace);
  const sz = defRPr.numAttr('sz');
  const typeface = defRPr.child('latin').attr('typeface') ?? '+mn-lt';

  return {
    size: ptToPx(sz !== undefined && sz > 0 ? sz / 100 : DEFAULT_FONT_PT),
    color: solidFillColor(defRPr, ctx) ?? '#000000',
    family: cssFontFamilyStack([...resolveThemeFontStack([typeface], ctx), 'sans-serif']),
  };
}

function readAxis(ax: SafeXmlNode, ctx: RenderContext): ChartAxis {
  const scaling = ax.child('scaling');
  const num = (node: SafeXmlNode): number | undefined => node.numAttr('val');
  const numFmt = ax.child('numFmt').attr('formatCode');
  const implicit = implicitAxisColor(ctx);
  const ln = ax.child('spPr').child('ln');
  const gridLn = ax.child('majorGridlines').child('spPr').child('ln');

  return {
    deleted: bool(ax.child('delete'), false),
    showLabels: ax.child('tickLblPos').attr('val') !== 'none',
    numFmt: numFmt && numFmt !== 'General' ? numFmt : undefined,
    min: num(scaling.child('min')),
    max: num(scaling.child('max')),
    major: num(ax.child('majorUnit')),
    reversed: scaling.child('orientation').attr('val') === 'maxMin',
    gridlines: ax.child('majorGridlines').exists(),
    lineColor: ln.child('noFill').exists() ? 'none' : solidFillColor(ln, ctx) ?? implicit,
    gridColor: solidFillColor(gridLn, ctx) ?? implicit,
    betweenCategories: ax.child('crossBetween').attr('val') !== 'midCat',
  };
}

function findAxis(plotArea: SafeXmlNode, names: string[], id: string | undefined): SafeXmlNode {
  const axes = names.flatMap((name) => plotArea.children(name));

  return axes.find((ax) => id !== undefined && ax.child('axId').attr('val') === id) ?? axes[0] ?? plotArea.child('');
}

function readLabels(node: SafeXmlNode): Partial<DataLabels> | undefined {
  const dLbls = node.child('dLbls');

  if (!dLbls.exists()) {
    return undefined;
  }
  if (bool(dLbls.child('delete'), false)) {
    return { showVal: false, showPercent: false, showCatName: false, showSerName: false };
  }
  const flag = (name: string): boolean | undefined => (dLbls.child(name).exists() ? bool(dLbls.child(name), false) : undefined);
  const entries = Object.entries({
    showVal: flag('showVal'),
    showPercent: flag('showPercent'),
    showCatName: flag('showCatName'),
    showSerName: flag('showSerName'),
    formatCode: dLbls.child('numFmt').attr('formatCode'),
  }).filter(([, v]) => v !== undefined);

  return Object.fromEntries(entries);
}

function readTitleText(title: SafeXmlNode): string | undefined {
  const rich = title.child('tx').child('rich');
  const paragraphs = rich
    .children('p')
    .map((p) => p.allChildren().filter((c) => c.localName === 'r' || c.localName === 'fld').map((r) => r.child('t').text()).join(''))
    .filter((p) => p !== '');

  if (paragraphs.length > 0) {
    return paragraphs.join('\n');
  }
  const cached = title.child('tx').child('strRef').child('strCache').child('pt').child('v');

  return cached.exists() ? cached.text() : undefined;
}

function readTitle(chart: SafeXmlNode, series: ChartSeries[], baseSize: number): ChartModel['title'] {
  const autoDeleted = chart.child('autoTitleDeleted');
  const title = chart.child('title');

  if (bool(autoDeleted, false)) {
    return undefined;
  }
  const explicit = title.exists() ? readTitleText(title) : undefined;
  // Office names a one-series chart after its series when the title is automatic.
  const auto = (title.exists() || autoDeleted.exists()) && series.length === 1 && series[0].name ? series[0].name : undefined;
  const text = explicit ?? auto;

  if (text === undefined) {
    return undefined;
  }
  const rPr = title.child('tx').child('rich').child('p').child('r').child('rPr');
  const defRPr = textDefaults(title).exists() ? textDefaults(title) : title.child('tx').child('rich').child('p').child('pPr').child('defRPr');
  const sz = rPr.numAttr('sz') ?? defRPr.numAttr('sz');

  return {
    text,
    size: sz !== undefined && sz > 0 ? ptToPx(sz / 100) : baseSize,
    bold: parseOoxmlBool(rPr.attr('b') ?? defRPr.attr('b'), true),
  };
}

function readMarker(ser: SafeXmlNode, index: number, plot: SafeXmlNode, kind: ChartKind): ChartSeries['marker'] {
  const marker = ser.child('marker');
  const symbol = marker.child('symbol').attr('val');
  const plotShowsMarkers = bool(plot.child('marker'), true);

  if ((kind !== 'line' && kind !== 'scatter') || plot.localName === 'line3DChart' || symbol === 'none') {
    return undefined;
  }
  if (!plotShowsMarkers && symbol === undefined) {
    return undefined;
  }
  const sizePt = marker.child('size').numAttr('val') ?? DEFAULT_MARKER_PT;

  return { symbol: symbol ?? AUTO_MARKERS[index % AUTO_MARKERS.length], size: ptToPx(sizePt) };
}

function readExplosion(ser: SafeXmlNode, count: number): number[] {
  const base = ser.child('explosion').numAttr('val') ?? 0;
  const explosion = new Array<number>(count).fill(base);

  for (const dPt of ser.children('dPt')) {
    const idx = dPt.child('idx').numAttr('val');
    const value = dPt.child('explosion').numAttr('val');

    if (idx !== undefined && idx >= 0 && idx < count && value !== undefined) {
      explosion[idx] = value;
    }
  }

  return explosion;
}

function readPointColors(ser: SafeXmlNode, count: number, fallback: (i: number) => string, ctx: RenderContext): string[] {
  const colors = Array.from({ length: count }, (_, i) => fallback(i));

  for (const dPt of ser.children('dPt')) {
    const idx = dPt.child('idx').numAttr('val');
    const color = solidFillColor(dPt.child('spPr'), ctx);

    if (idx !== undefined && idx >= 0 && idx < count && color !== undefined) {
      colors[idx] = color;
    }
  }

  return colors;
}

interface SeriesContext {
  ctx: RenderContext;
  plot: SafeXmlNode;
  kind: ChartKind;
  palette: string[];
  plotLabels: Partial<DataLabels>;
  varyByPoint: boolean;
}

function readSeries(ser: SafeXmlNode, index: number, sc: SeriesContext): ChartSeries {
  const { ctx, palette } = sc;
  const isXY = ser.child('yVal').exists();
  const valNode = isXY ? ser.child('yVal') : ser.child('val');
  const { values, blankIndices } = extractNumericValuesWithBlanks(valNode);
  const spPr = ser.child('spPr');
  const ln = spPr.child('ln');
  const color = solidFillColor(spPr, ctx) ?? solidFillColor(ln, ctx) ?? palette[index % palette.length];
  const pointFallback = (i: number): string => (sc.varyByPoint ? palette[i % palette.length] : color);
  const widthEmu = ln.numAttr('w');

  return {
    name: extractStringValues(ser.child('tx'))[0] ?? ser.child('tx').child('v').text(),
    categories: extractStringValues(ser.child('cat')),
    values,
    blanks: blankIndices,
    xValues: isXY ? extractNumericValuesWithBlanks(ser.child('xVal')).values : [],
    formatCode: extractFormatCode(valNode),
    color,
    pointColors: readPointColors(ser, values.length, pointFallback, ctx),
    lineWidth: widthEmu !== undefined && widthEmu > 0 ? Math.max(1, widthEmu / 9525) : 3,
    noLine: ln.child('noFill').exists(),
    // Absent means invert, as the reference renderer draws it.
    invertIfNegative: bool(ser.child('invertIfNegative'), true),
    marker: readMarker(ser, index, sc.plot, sc.kind),
    smooth: bool(ser.child('smooth'), false),
    explosion: readExplosion(ser, values.length),
    labels: { showVal: false, showPercent: false, showCatName: false, showSerName: false, ...sc.plotLabels, ...readLabels(ser) },
  };
}

function plotNodes(plotArea: SafeXmlNode): SafeXmlNode[] {
  return plotArea.allChildren().filter((child) => child.localName.endsWith('Chart'));
}

/**
 * Office varies colours by point on pies and doughnuts, and on a lone bar series
 * when c:varyColors is absent (as python-pptx writes it).
 */
function variesByPoint(plot: SafeXmlNode, kind: ChartKind, serNodes: SafeXmlNode[], stacked: boolean): boolean {
  if (kind === 'pie' || kind === 'doughnut') {
    return bool(plot.child('varyColors'), true);
  }
  if (kind !== 'bar' || serNodes.length !== 1) {
    return false;
  }
  const lone = serNodes[0];
  const fallback = !stacked && extractNumericValuesWithBlanks(lone.child('val')).values.length > 1 && !lone.child('spPr').child('solidFill').exists();

  return bool(plot.child('varyColors'), fallback);
}

interface PlotContext {
  ctx: RenderContext;
  plotArea: SafeXmlNode;
  palette: string[];
  /** Series drawn by earlier plots; colours continue after them. */
  offset: number;
}

/** One plot element (c:barChart, c:lineChart…) as a model of its own. */
function readPlot(plot: SafeXmlNode, pc: PlotContext): Omit<ChartModel, 'title' | 'legend' | 'text'> {
  const { ctx, plotArea } = pc;
  const kind = KIND_BY_ELEMENT[plot.localName] ?? 'unsupported';
  const grouping = plot.child('grouping').attr('val') ?? (kind === 'bar' ? 'clustered' : 'standard');
  const stacked = grouping === 'stacked' || grouping === 'percentStacked';
  const serNodes = plot.children('ser')
    .map((ser, i) => ({ ser, order: ser.child('order').numAttr('val') ?? i }))
    .sort((a, b) => a.order - b.order)
    .map(({ ser }) => ser);
  const varyByPoint = variesByPoint(plot, kind, serNodes, stacked);
  const sc: SeriesContext = { ctx, plot, kind, palette: pc.palette, plotLabels: readLabels(plot) ?? {}, varyByPoint };
  const series = serNodes.map((ser, i) => readSeries(ser, pc.offset + i, sc));
  const axisIds = plot.children('axId').map((ax) => ax.attr('val'));

  return {
    kind,
    series,
    categories: series.find((s) => s.categories.length > 0)?.categories ?? [],
    grouping,
    horizontal: plot.child('barDir').attr('val') === 'bar',
    varyColors: varyByPoint,
    gapWidth: plot.child('gapWidth').numAttr('val') ?? 150,
    overlap: plot.child('overlap').numAttr('val') ?? (stacked ? 100 : 0),
    holeSize: plot.child('holeSize').numAttr('val') ?? 50,
    firstSliceAngle: plot.child('firstSliceAng').numAttr('val') ?? 0,
    categoryAxis: readAxis(findAxis(plotArea, kind === 'scatter' ? ['valAx'] : ['catAx', 'dateAx'], axisIds[0]), ctx),
    valueAxis: readAxis(findAxis(plotArea, ['valAx'], axisIds[1]), ctx),
  };
}

export function readChart(chartSpace: SafeXmlNode, ctx: RenderContext, chartPath?: string): ChartModel {
  const chart = chartSpace.child('chart');
  const plotArea = chart.child('plotArea');
  const plots = plotNodes(plotArea);
  const palette = buildPalette(ctx, chartPath);
  const text = readText(chartSpace, ctx);
  const layers = plots.reduce<ChartModel[]>((acc, node) => {
    const offset = acc.reduce((sum, l) => sum + l.series.length, 0);

    return [...acc, { ...readPlot(node, { ctx, plotArea, palette, offset }), text }];
  }, []);
  const first = layers[0] ?? { ...readPlot(plotArea.child(''), { ctx, plotArea, palette, offset: 0 }), text };
  const valueAxisIds = plots.map((node) => node.children('axId')[1]?.attr('val'));
  const series = layers.flatMap((l) => l.series);
  const legend = chart.child('legend');
  const legendPos = legend.child('legendPos').attr('val');
  const position: LegendPosition = legendPos === 't' || legendPos === 'b' || legendPos === 'l' ? legendPos : 'r';
  const combo = layers.length > 1
    ? {
      kind: layers.every((l) => COMBO_KINDS.has(l.kind)) ? 'combo' as const : 'unsupported' as const,
      series,
      categories: series.find((s) => s.categories.length > 0)?.categories ?? [],
      layers: layers.map((l, i) => ({ ...l, secondary: valueAxisIds[i] !== undefined && valueAxisIds[i] !== valueAxisIds[0] })),
    }
    : {};

  return {
    ...first,
    ...combo,
    title: readTitle(chart, series, text.size),
    legend: legend.exists() ? { position } : undefined,
    text,
  };
}
