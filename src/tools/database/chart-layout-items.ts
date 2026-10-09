import type { I18n } from '../../../types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import {
  CHART_COLOR_THEMES,
  CHART_GRID_LINES,
  CHART_HEIGHTS,
  CHART_LEGENDS,
  CHART_SORTS,
  CHART_TYPES,
  chartMeasureOptions,
  resolveChartSettings,
} from './chart-settings';
import type { ResolvedChartMeasure } from './chart-settings';
import type { ViewChanges } from './database-model';
import { CALCULATION_LABEL_KEYS } from './database-table-menus';
import { GROUPABLE_TYPES } from './group-keys';
import type { DatabaseViewConfig, PropertyDefinition } from './types';

type T = Pick<I18n, 't'>;

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const choice = (name: string, title: string, isActive: boolean, onActivate: () => void): PopoverItemParams => ({
  type: PopoverItemType.Default,
  name,
  title,
  isActive,
  onActivate,
});

const page = (name: string, title: string, items: PopoverItemParams[]): PopoverItemParams => ({
  type: PopoverItemType.Default,
  name,
  title,
  children: { items },
});

const COLOR_KEYS: Readonly<Record<string, string>> = {
  auto: 'tools.database.chartColorAuto',
  colorful: 'tools.database.chartColorColorful',
  teal: 'tools.database.chartColorTeal',
};

/** How a measure reads: Count, or "Sum of Points". */
export const chartMeasureLabel = (measure: ResolvedChartMeasure, schema: PropertyDefinition[], i18n: T): string => {
  if (measure.kind === 'count') return i18n.t('tools.database.calcCount');
  const property = schema.find((p) => p.id === measure.propertyId);

  return i18n.t('tools.database.chartMeasure', { fn: i18n.t(CALCULATION_LABEL_KEYS[measure.fn]), property: property?.name ?? '' });
};

/**
 * The chart's rows in the view settings Layout page (H-charts: X axis, Y
 * axis, Style). The X axis groups (shown / hidden) live on the Group page:
 * the X axis is the view's `groupBy`.
 */
export const chartLayoutItems = (
  view: DatabaseViewConfig,
  schema: PropertyDefinition[],
  i18n: T,
  update: (changes: ViewChanges) => void
): PopoverItemParams[] => {
  const s = resolveChartSettings(view, schema);
  const t = (key: string): string => i18n.t(`tools.database.${key}`);
  const ordered = [...schema].sort((a, b) => (a.position < b.position ? -1 : 1));
  const groupable = ordered.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const switchRow = (name: string, key: string, on: boolean, field: keyof ViewChanges): PopoverItemParams =>
    choice(name, t(key), on, () => update({ [field]: !on }));
  const enumPage = <V extends string>(name: string, key: string, values: readonly V[], active: V, labelKey: (v: V) => string, field: keyof ViewChanges): PopoverItemParams =>
    page(name, t(key), values.map((value) => choice(`${name}-${value}`, i18n.t(labelKey(value)), active === value, () => update({ [field]: value }))));
  const isNumber = s.type === 'number';
  const isDonut = s.type === 'donut';
  const hasAxes = !isNumber && !isDonut;
  const measureKey = s.measure.kind === 'count' ? 'count' : `${s.measure.fn}:${s.measure.propertyId}`;
  const rows: Array<PopoverItemParams | false> = [
    enumPage('chart-type', 'chartType', CHART_TYPES, s.type, (v) => `tools.database.chartType${capital(v)}`, 'chartType'),
    !isNumber && page('chart-x', t(isDonut ? 'chartSlices' : 'chartXAxis'), groupable.map((p) =>
      choice(`chart-x-${p.id}`, p.name, view.groupBy === p.id, () => update({ groupBy: p.id })))),
    page('chart-y', t('chartYAxis'), chartMeasureOptions(schema).map(({ key, measure }) =>
      choice(`chart-y-${key}`, chartMeasureLabel(measure, schema, i18n), key === measureKey, () => update({ chartMeasure: key })))),
    hasAxes && page('chart-group-by', t('chartGroupBy'), [
      choice('chart-group-by-none', t('settingsNone'), view.subGroupBy === undefined, () => update({ subGroupBy: undefined })),
      ...groupable.filter((p) => p.id !== view.groupBy).map((p) =>
        choice(`chart-group-by-${p.id}`, p.name, view.subGroupBy === p.id, () => update({ subGroupBy: p.id }))),
    ]),
    !isNumber && enumPage('chart-sort', 'chartSort', CHART_SORTS, s.sort, (v) => `tools.database.chartSort${capital(v)}`, 'chartSort'),
    !isNumber && switchRow('chart-omit-zero', 'chartOmitZero', s.omitZero, 'chartOmitZero'),
    hasAxes && s.sort === 'xAscending' && (s.measure.kind === 'count' || s.measure.fn === 'sum')
      && switchRow('chart-cumulative', 'chartCumulative', s.cumulative, 'chartCumulative'),
    enumPage('chart-color', 'chartColor', CHART_COLOR_THEMES, s.color, (v) => COLOR_KEYS[v] ?? `tools.database.color${capital(v)}`, 'chartColor'),
    !isNumber && enumPage('chart-height', 'chartHeight', CHART_HEIGHTS, s.height, (v) => `tools.database.chartHeight${capital(v)}`, 'chartHeight'),
    hasAxes && enumPage('chart-grid-lines', 'chartGridLines', CHART_GRID_LINES, s.gridLines, (v) => `tools.database.chartGrid${capital(v)}`, 'chartGridLines'),
    hasAxes && switchRow('chart-axis-names', 'chartAxisNames', s.axisNames, 'chartAxisNames'),
    !isNumber && switchRow('chart-data-labels', 'chartDataLabels', s.dataLabels, 'chartDataLabels'),
    s.type === 'line' && switchRow('chart-smooth', 'chartSmooth', s.smooth, 'chartSmooth'),
    s.type === 'line' && switchRow('chart-gradient', 'chartGradient', s.gradient, 'chartGradient'),
    isDonut && switchRow('chart-center-value', 'chartCenterValue', s.centerValue, 'chartCenterValue'),
    !isNumber && enumPage('chart-legend', 'chartLegendPosition', CHART_LEGENDS, s.legend, (v) => `tools.database.chartLegend${capital(v)}`, 'chartLegend'),
  ];

  return rows.filter((row): row is PopoverItemParams => row !== false);
};
