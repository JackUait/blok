import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  CHART_HEIGHT_PX,
  chartMeasureKey,
  chartMeasureOptions,
  resolveChartSettings,
} from '../../../../src/tools/database/chart-settings';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a2' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a3' },
];

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1',
  name: 'Chart',
  type: 'chart',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

describe('chart settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a fresh chart view with the defaults', () => {
    expect(resolveChartSettings(view(), schema)).toEqual({
      type: 'column',
      measure: { kind: 'count' },
      sort: 'manual',
      omitZero: false,
      cumulative: false,
      color: 'auto',
      height: 'medium',
      gridLines: 'horizontal',
      axisNames: false,
      dataLabels: false,
      smooth: false,
      gradient: false,
      centerValue: true,
      legend: 'bottom',
    });
  });

  it('reads every stored setting', () => {
    const resolved = resolveChartSettings(view({
      chartType: 'line',
      chartMeasure: 'sum:p-points',
      chartSort: 'xAscending',
      chartOmitZero: true,
      chartCumulative: true,
      chartColor: 'purple',
      chartHeight: 'extraLarge',
      chartGridLines: 'both',
      chartAxisNames: true,
      chartDataLabels: true,
      chartSmooth: true,
      chartGradient: true,
      chartCenterValue: false,
      chartLegend: 'side',
    }), schema);

    expect(resolved).toEqual({
      type: 'line',
      measure: { kind: 'property', fn: 'sum', propertyId: 'p-points' },
      sort: 'xAscending',
      omitZero: true,
      cumulative: true,
      color: 'purple',
      height: 'extraLarge',
      gridLines: 'both',
      axisNames: true,
      dataLabels: true,
      smooth: true,
      gradient: true,
      centerValue: false,
      legend: 'side',
    });
  });

  it('falls back to Count when the measured property is gone or cannot take the function', () => {
    expect(resolveChartSettings(view({ chartMeasure: 'sum:p-gone' }), schema).measure).toEqual({ kind: 'count' });
    expect(resolveChartSettings(view({ chartMeasure: 'sum:p-status' }), schema).measure).toEqual({ kind: 'count' });
    expect(resolveChartSettings(view({ chartMeasure: 'earliest_date:p-due' }), schema).measure).toEqual({ kind: 'count' });
    expect(resolveChartSettings(view({ chartMeasure: 'garbage' as never }), schema).measure).toEqual({ kind: 'count' });
  });

  it('keeps cumulative only for Count or Sum with the X axis ascending (H-charts)', () => {
    expect(resolveChartSettings(view({ chartCumulative: true }), schema).cumulative).toBe(false);
    expect(resolveChartSettings(view({ chartCumulative: true, chartSort: 'xAscending' }), schema).cumulative).toBe(true);
    expect(resolveChartSettings(view({ chartCumulative: true, chartSort: 'xAscending', chartMeasure: 'average:p-points' }), schema).cumulative).toBe(false);
    expect(resolveChartSettings(view({ chartCumulative: true, chartSort: 'yDescending' }), schema).cumulative).toBe(false);
  });

  it('drops unknown enum values to the defaults', () => {
    const resolved = resolveChartSettings(view({
      chartType: 'pie' as never,
      chartColor: 'neon' as never,
      chartHeight: 'huge' as never,
      chartLegend: 'top' as never,
      chartGridLines: 'diagonal' as never,
      chartSort: 'random' as never,
    }), schema);

    expect(resolved).toMatchObject({ type: 'column', color: 'auto', height: 'medium', legend: 'bottom', gridLines: 'horizontal', sort: 'manual' });
  });

  it('lists Count first, then each property function that yields a number', () => {
    const keys = chartMeasureOptions(schema).map((option) => option.key);

    expect(keys[0]).toBe('count');
    expect(keys).toContain('sum:p-points');
    expect(keys).toContain('average:p-points');
    expect(keys).toContain('unique:p-status');
    expect(keys).not.toContain('sum:p-status');
    expect(keys).not.toContain('earliest_date:p-due');
    expect(keys).not.toContain('count:p-points');
  });

  it('writes a measure as one string, so two peers settle on one pick', () => {
    expect(chartMeasureKey({ kind: 'count' })).toBe('count');
    expect(chartMeasureKey({ kind: 'property', fn: 'median', propertyId: 'p-points' })).toBe('median:p-points');
  });

  it('grows the plot height from small to extra large', () => {
    expect(CHART_HEIGHT_PX.small).toBeLessThan(CHART_HEIGHT_PX.medium);
    expect(CHART_HEIGHT_PX.medium).toBeLessThan(CHART_HEIGHT_PX.large);
    expect(CHART_HEIGHT_PX.large).toBeLessThan(CHART_HEIGHT_PX.extraLarge);
  });
});
