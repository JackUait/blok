import type { ResolvedChartMeasure } from './chart-settings';
import { CHART_MAX_GROUPS, CHART_MAX_SUB_GROUPS } from './chart-settings';
import { computeCalculation } from './database-calculations';
import { NO_VALUE_GROUP_KEY } from './group-keys';
import { readPropertyValue } from './property-values';
import type { CalculationFn, ChartSort, DatabaseRow, PropertyDefinition } from './types';

/** One X group (donut: one slice) with the rows the view query put in it. */
export interface ChartGroupInput {
  key: string;
  label: string;
  /** What X sorts compare: the label for option groups, the key for date and number buckets. */
  sortKey: string;
  /** An option color name. */
  color?: string;
  rows: DatabaseRow[];
}

/** One series (the Y axis "Group by"): the rows in it, by id. */
export interface ChartSeriesInput {
  key: string;
  label: string;
  color?: string;
  rowIds: ReadonlySet<string>;
}

export interface ChartDataInput {
  groups: ChartGroupInput[];
  series?: ChartSeriesInput[];
  measure: ResolvedChartMeasure;
  schema: PropertyDefinition[];
  sort: ChartSort;
  omitZero: boolean;
  cumulative: boolean;
  /** Group or series keys turned off in the legend. Session only. */
  hidden?: ReadonlySet<string>;
}

export interface ChartPoint {
  key: string;
  label: string;
  color?: string;
  value: number;
  /** Per series key. Empty without series. */
  values: Record<string, number>;
  rowIds: string[];
  hidden: boolean;
}

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
  hidden: boolean;
}

export interface ChartData {
  points: ChartPoint[];
  series: ChartSeries[];
  /** Bars stack their series; otherwise they stand side by side. */
  stacked: boolean;
  /** The highest bar, stack or point among the shown ones. */
  max: number;
  /** The measure over every row: the number chart and the donut center. */
  total: number;
  /** More than 200 groups or 50 series: the rest are not drawn. */
  truncated: boolean;
}

/** Measures whose parts add up to the whole, so stacking them is honest. */
const ADDITIVE: ReadonlySet<CalculationFn> = new Set(['sum', 'count_values', 'empty', 'not_empty', 'checked', 'unchecked']);

const measureRows = (rows: DatabaseRow[], measure: ResolvedChartMeasure, schema: PropertyDefinition[]): number => {
  if (measure.kind === 'count') return rows.length;
  const property = schema.find((p) => p.id === measure.propertyId);

  if (property === undefined) return 0;
  const result = computeCalculation(measure.fn, rows.map((row) => readPropertyValue(row, property)), property);

  return result.kind === 'number' || result.kind === 'percent' ? result.value : 0;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const sortPoints = (points: Array<ChartPoint & { sortKey: string }>, sort: ChartSort): Array<ChartPoint & { sortKey: string }> => {
  const compare: Record<Exclude<ChartSort, 'manual'>, (a: ChartPoint & { sortKey: string }, b: ChartPoint & { sortKey: string }) => number> = {
    xAscending: (a, b) => collator.compare(a.sortKey, b.sortKey),
    xDescending: (a, b) => collator.compare(b.sortKey, a.sortKey),
    yAscending: (a, b) => a.value - b.value,
    yDescending: (a, b) => b.value - a.value,
  };

  if (sort === 'manual') return points;
  const noValue = points.filter((p) => p.key === NO_VALUE_GROUP_KEY);

  return [...points.filter((p) => p.key !== NO_VALUE_GROUP_KEY).sort(compare[sort]), ...noValue];
};

const runningTotals = <P extends { value: number; values: Record<string, number> }>(points: P[]): P[] => {
  const totals: Record<string, number> = { '': 0 };

  return points.map((point) => {
    totals[''] += point.value;
    for (const [key, value] of Object.entries(point.values)) {
      totals[`s:${key}`] = (totals[`s:${key}`] ?? 0) + value;
    }

    return {
      ...point,
      value: totals[''],
      values: Object.fromEntries(Object.keys(point.values).map((key) => [key, totals[`s:${key}`]])),
    };
  });
};

/**
 * The numbers a chart draws, from the rows the view query grouped. Pure: the
 * renderer and the tests share it.
 */
export const buildChartData = (input: ChartDataInput): ChartData => {
  const { measure, schema, hidden = new Set<string>() } = input;
  const allSeries = input.series ?? [];
  const series: ChartSeries[] = allSeries.slice(0, CHART_MAX_SUB_GROUPS).map((s) => ({
    key: s.key,
    label: s.label,
    ...(s.color !== undefined ? { color: s.color } : {}),
    hidden: hidden.has(s.key),
  }));
  const measured = input.groups.map((group) => ({
    key: group.key,
    label: group.label,
    sortKey: group.sortKey,
    ...(group.color !== undefined ? { color: group.color } : {}),
    value: measureRows(group.rows, measure, schema),
    values: Object.fromEntries(allSeries.slice(0, CHART_MAX_SUB_GROUPS).map((s) => [
      s.key,
      measureRows(group.rows.filter((row) => s.rowIds.has(row.id)), measure, schema),
    ])),
    rowIds: group.rows.map((row) => row.id),
    hidden: hidden.has(group.key),
  }));
  const sorted = sortPoints(input.omitZero ? measured.filter((p) => p.value !== 0) : measured, input.sort);
  const kept = input.cumulative ? runningTotals(sorted) : sorted;

  const points: ChartPoint[] = kept.slice(0, CHART_MAX_GROUPS).map(({ sortKey: _sortKey, ...point }) => point);
  const stacked = measure.kind === 'count' || ADDITIVE.has(measure.fn);
  const shownSeries = series.filter((s) => !s.hidden);
  const heightOf = (point: ChartPoint): number => {
    if (series.length === 0) return point.value;
    const parts = shownSeries.map((s) => point.values[s.key] ?? 0);

    return stacked ? parts.reduce((sum, part) => sum + part, 0) : Math.max(0, ...parts);
  };
  const max = Math.max(0, ...points.filter((p) => !p.hidden).map(heightOf));

  return {
    points,
    series,
    stacked,
    max,
    // A multi-select row sits in several groups; count it once.
    total: measureRows([...new Map(input.groups.flatMap((g) => g.rows).map((row) => [row.id, row])).values()], measure, schema),
    truncated: kept.length > CHART_MAX_GROUPS || allSeries.length > CHART_MAX_SUB_GROUPS,
  };
};
