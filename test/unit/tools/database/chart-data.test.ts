import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildChartData } from '../../../../src/tools/database/chart-data';
import type { ChartGroupInput } from '../../../../src/tools/database/chart-data';
import type { ResolvedChartMeasure } from '../../../../src/tools/database/chart-settings';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

const points: PropertyDefinition = { id: 'p-points', name: 'Points', type: 'number', position: 'a1' };
const schema: PropertyDefinition[] = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }, points];

const row = (id: string, value?: number): DatabaseRow => ({
  id,
  position: id,
  properties: value === undefined ? {} : { 'p-points': value },
});

const COUNT: ResolvedChartMeasure = { kind: 'count' };
const SUM: ResolvedChartMeasure = { kind: 'property', fn: 'sum', propertyId: 'p-points' };
const AVERAGE: ResolvedChartMeasure = { kind: 'property', fn: 'average', propertyId: 'p-points' };

const groups = (): ChartGroupInput[] => [
  { key: 'b', label: 'Beta', sortKey: 'Beta', rows: [row('r1', 3), row('r2', 4)] },
  { key: 'a', label: 'Alpha', sortKey: 'Alpha', rows: [row('r3', 10)] },
  { key: 'c', label: 'Gamma', sortKey: 'Gamma', rows: [] },
];

const base = { schema, sort: 'manual' as const, omitZero: false, cumulative: false };

describe('buildChartData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts rows per group, in the group order', () => {
    const data = buildChartData({ ...base, groups: groups(), measure: COUNT });

    expect(data.points.map((p) => [p.key, p.value])).toEqual([['b', 2], ['a', 1], ['c', 0]]);
    expect(data.points[0].rowIds).toEqual(['r1', 'r2']);
    expect(data.total).toBe(3);
  });

  it('aggregates a property with the database calculations', () => {
    expect(buildChartData({ ...base, groups: groups(), measure: SUM }).points.map((p) => p.value)).toEqual([7, 10, 0]);
    expect(buildChartData({ ...base, groups: groups(), measure: AVERAGE }).points.map((p) => p.value)).toEqual([3.5, 10, 0]);
  });

  it('omits groups whose value is zero', () => {
    const data = buildChartData({ ...base, groups: groups(), measure: COUNT, omitZero: true });

    expect(data.points.map((p) => p.key)).toEqual(['b', 'a']);
  });

  it('sorts by the X label or by the Y value', () => {
    const order = (sort: 'xAscending' | 'xDescending' | 'yAscending' | 'yDescending'): string[] =>
      buildChartData({ ...base, groups: groups(), measure: SUM, sort }).points.map((p) => p.key);

    expect(order('xAscending')).toEqual(['a', 'b', 'c']);
    expect(order('xDescending')).toEqual(['c', 'b', 'a']);
    expect(order('yAscending')).toEqual(['c', 'b', 'a']);
    expect(order('yDescending')).toEqual(['a', 'b', 'c']);
  });

  it('sorts numbered labels by number, so 10 comes after 9', () => {
    const data = buildChartData({
      ...base,
      measure: COUNT,
      sort: 'xAscending',
      groups: [
        { key: 'x10', label: '10', sortKey: '10', rows: [] },
        { key: 'x9', label: '9', sortKey: '9', rows: [] },
      ],
    });

    expect(data.points.map((p) => p.label)).toEqual(['9', '10']);
  });

  it('keeps the no-value group last whatever the sort', () => {
    const data = buildChartData({
      ...base,
      measure: COUNT,
      sort: 'yDescending',
      groups: [{ key: '__blok-no-value-group__', label: 'No Points', sortKey: '', rows: [row('r9'), row('r8'), row('r7')] }, ...groups()],
    });

    expect(data.points.at(-1)?.key).toBe('__blok-no-value-group__');
  });

  it('adds a running total when cumulative', () => {
    const data = buildChartData({ ...base, groups: groups(), measure: SUM, sort: 'xAscending', cumulative: true });

    expect(data.points.map((p) => p.value)).toEqual([10, 17, 17]);
  });

  it('splits each group into series, stacked for additive measures', () => {
    const data = buildChartData({
      ...base,
      groups: groups(),
      measure: SUM,
      series: [
        { key: 's1', label: 'One', rowIds: new Set(['r1', 'r3']) },
        { key: 's2', label: 'Two', rowIds: new Set(['r2']) },
      ],
    });

    expect(data.stacked).toBe(true);
    expect(data.series.map((s) => s.key)).toEqual(['s1', 's2']);
    expect(data.points[0].values).toEqual({ s1: 3, s2: 4 });
    expect(data.points[1].values).toEqual({ s1: 10, s2: 0 });
    expect(data.max).toBe(10);
  });

  it('places averages side by side: a stack of averages means nothing', () => {
    const data = buildChartData({
      ...base,
      groups: groups(),
      measure: AVERAGE,
      series: [{ key: 's1', label: 'One', rowIds: new Set(['r1']) }],
    });

    expect(data.stacked).toBe(false);
  });

  it('hides a group or a series a person turned off in the legend, and leaves it listed', () => {
    const data = buildChartData({
      ...base,
      groups: groups(),
      measure: COUNT,
      hidden: new Set(['b', 's2']),
      series: [
        { key: 's1', label: 'One', rowIds: new Set(['r1', 'r3']) },
        { key: 's2', label: 'Two', rowIds: new Set(['r2']) },
      ],
    });

    expect(data.points.find((p) => p.key === 'b')?.hidden).toBe(true);
    expect(data.series.find((s) => s.key === 's2')?.hidden).toBe(true);
    expect(data.max).toBe(1);
  });

  it('stops at 200 groups and 50 series (H-charts)', () => {
    const many = Array.from({ length: 205 }, (_, i): ChartGroupInput => ({ key: `g${i}`, label: `G${i}`, sortKey: `G${i}`, rows: [] }));
    const series = Array.from({ length: 55 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, rowIds: new Set<string>() }));
    const data = buildChartData({ ...base, groups: many, measure: COUNT, series });

    expect(data.points).toHaveLength(200);
    expect(data.series).toHaveLength(50);
    expect(data.truncated).toBe(true);
  });

  it('measures the whole view for the number chart', () => {
    const data = buildChartData({ ...base, groups: groups(), measure: SUM });

    expect(data.total).toBe(17);
  });
});
