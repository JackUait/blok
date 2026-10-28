import type { ChartAxis, ChartModel, ChartSeries } from '../../../../../../../src/tools/file/pptx/renderer/chart/model';

export const STYLE = { size: 10, color: '#000', family: 'sans-serif' };

const axis: ChartAxis = {
  deleted: false, showLabels: true, reversed: false, gridlines: false,
  lineColor: '#000', gridColor: '#ccc', betweenCategories: true,
};

export const series = (values: number[], extra: Partial<ChartSeries> = {}): ChartSeries => ({
  name: 'S', categories: values.map((_, i) => `c${i}`), values, blanks: new Set(), xValues: [],
  color: '#123456', pointColors: [], lineWidth: 1, noLine: false, invertIfNegative: false,
  smooth: false, explosion: values.map(() => 0),
  labels: { showVal: false, showPercent: false, showCatName: false, showSerName: false },
  ...extra,
});

export const model = (kind: ChartModel['kind'], list: ChartSeries[], extra: Partial<ChartModel> = {}): ChartModel => ({
  kind, series: list, categories: [], grouping: 'standard', horizontal: false, varyColors: false,
  gapWidth: 150, overlap: 0, holeSize: 50, firstSliceAngle: 0, categoryAxis: axis, valueAxis: axis,
  text: STYLE, ...extra,
});
