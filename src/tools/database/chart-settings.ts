import { CALCULATIONS_FOR_TYPE } from './database-calculations';
import type {
  CalculationFn,
  ChartColorTheme,
  ChartGridLines,
  ChartHeight,
  ChartLegend,
  ChartMeasure,
  ChartSort,
  ChartType,
  DatabaseViewConfig,
  PropertyDefinition,
} from './types';

export const CHART_TYPES: readonly ChartType[] = ['column', 'bar', 'line', 'donut', 'number'];

export const CHART_COLOR_THEMES: readonly ChartColorTheme[] = [
  'auto', 'colorful', 'gray', 'blue', 'yellow', 'green', 'purple', 'teal', 'orange', 'pink', 'red',
];

export const CHART_HEIGHTS: readonly ChartHeight[] = ['small', 'medium', 'large', 'extraLarge'];

/** Plot heights. Unmeasured: Notion's chart view is paywalled in the measured workspace (research/08). */
export const CHART_HEIGHT_PX: Readonly<Record<ChartHeight, number>> = {
  small: 200,
  medium: 300,
  large: 400,
  extraLarge: 520,
};

export const CHART_SORTS: readonly ChartSort[] = ['manual', 'xAscending', 'xDescending', 'yAscending', 'yDescending'];

export const CHART_GRID_LINES: readonly ChartGridLines[] = ['none', 'horizontal', 'vertical', 'both'];

export const CHART_LEGENDS: readonly ChartLegend[] = ['off', 'bottom', 'side'];

/** Notion's chart limits (H-charts). */
export const CHART_MAX_GROUPS = 200;
export const CHART_MAX_SUB_GROUPS = 50;

export type ResolvedChartMeasure =
  | { kind: 'count' }
  | { kind: 'property'; fn: CalculationFn; propertyId: string };

export interface ResolvedChartSettings {
  type: ChartType;
  measure: ResolvedChartMeasure;
  sort: ChartSort;
  omitZero: boolean;
  cumulative: boolean;
  color: ChartColorTheme;
  height: ChartHeight;
  gridLines: ChartGridLines;
  axisNames: boolean;
  dataLabels: boolean;
  smooth: boolean;
  gradient: boolean;
  centerValue: boolean;
  legend: ChartLegend;
}

/** Date results have no place on a value axis; `count` per property is the same as Count. */
const NOT_A_MEASURE: ReadonlySet<CalculationFn> = new Set(['count', 'earliest_date', 'latest_date', 'date_range']);

const measureFns = (property: PropertyDefinition): CalculationFn[] =>
  (CALCULATIONS_FOR_TYPE[property.type] ?? []).filter((fn) => !NOT_A_MEASURE.has(fn));

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.find((entry) => entry === value) ?? fallback;

const resolveMeasure = (stored: ChartMeasure | undefined, schema: PropertyDefinition[]): ResolvedChartMeasure => {
  if (typeof stored !== 'string') return { kind: 'count' };
  const at = stored.indexOf(':');

  if (at === -1) return { kind: 'count' };
  const fn = stored.slice(0, at);
  const propertyId = stored.slice(at + 1);
  const property = schema.find((p) => p.id === propertyId);
  const allowed = property === undefined ? undefined : measureFns(property).find((entry) => entry === fn);

  return allowed === undefined ? { kind: 'count' } : { kind: 'property', fn: allowed, propertyId };
};

export const chartMeasureKey = (measure: ResolvedChartMeasure): ChartMeasure =>
  measure.kind === 'count' ? 'count' : `${measure.fn}:${measure.propertyId}`;

/** Y axis choices: Count, then each property's number-valued calculations. */
export const chartMeasureOptions = (schema: PropertyDefinition[]): Array<{ key: ChartMeasure; measure: ResolvedChartMeasure }> => [
  { key: 'count', measure: { kind: 'count' } },
  ...[...schema]
    .sort((a, b) => (a.position < b.position ? -1 : 1))
    .flatMap((property) => measureFns(property).map((fn) => {
      const measure: ResolvedChartMeasure = { kind: 'property', fn, propertyId: property.id };

      return { key: chartMeasureKey(measure), measure };
    })),
];

/**
 * Every chart setting with its default. The defaults are Blok's: Notion's are
 * unmeasured (the chart view is paywalled in the measured workspace).
 */
export const resolveChartSettings = (view: DatabaseViewConfig, schema: PropertyDefinition[]): ResolvedChartSettings => {
  const measure = resolveMeasure(view.chartMeasure, schema);
  const sort = pick(CHART_SORTS, view.chartSort, 'manual');
  const cumulativeAllowed = sort === 'xAscending' && (measure.kind === 'count' || measure.fn === 'sum');

  return {
    type: pick(CHART_TYPES, view.chartType, 'column'),
    measure,
    sort,
    omitZero: view.chartOmitZero === true,
    cumulative: cumulativeAllowed && view.chartCumulative === true,
    color: pick(CHART_COLOR_THEMES, view.chartColor, 'auto'),
    height: pick(CHART_HEIGHTS, view.chartHeight, 'medium'),
    gridLines: pick(CHART_GRID_LINES, view.chartGridLines, 'horizontal'),
    axisNames: view.chartAxisNames === true,
    dataLabels: view.chartDataLabels === true,
    smooth: view.chartSmooth === true,
    gradient: view.chartGradient === true,
    centerValue: view.chartCenterValue !== false,
    legend: pick(CHART_LEGENDS, view.chartLegend, 'bottom'),
  };
};
