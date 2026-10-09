import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { chartLayoutItems } from '../../../../src/tools/database/chart-layout-items';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a2' },
  { id: 'p-files', name: 'Files', type: 'files', position: 'a3' },
];

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Chart', type: 'chart', position: 'a0', sorts: [], filters: [], visibleProperties: [], groupBy: 'p-status', ...overrides,
});

const i18n = { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`) };

interface Item {
  name?: string;
  title?: string;
  isActive?: boolean;
  onActivate?: () => void;
  children?: { items: Item[] };
}

const items = (fields: Partial<DatabaseViewConfig> = {}, update = vi.fn()): Item[] =>
  chartLayoutItems(view(fields), schema, i18n, update) as unknown as Item[];

const byName = (list: Item[], name: string): Item | undefined => list.find((item) => item.name === name);

const names = (list: Item[]): Array<string | undefined> => list.map((item) => item.name);

describe('chartLayoutItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the column chart rows', () => {
    expect(names(items())).toEqual([
      'chart-type', 'chart-x', 'chart-y', 'chart-group-by', 'chart-sort', 'chart-omit-zero',
      'chart-color', 'chart-height', 'chart-grid-lines', 'chart-axis-names', 'chart-data-labels', 'chart-legend',
    ]);
  });

  it('adds smooth line and gradient area for a line chart, and cumulative once it applies', () => {
    const list = names(items({ chartType: 'line', chartSort: 'xAscending' }));

    expect(list).toContain('chart-smooth');
    expect(list).toContain('chart-gradient');
    expect(list).toContain('chart-cumulative');
    expect(names(items())).not.toContain('chart-cumulative');
  });

  it('calls the X axis "Each slice represents" on a donut and offers the center value', () => {
    const list = items({ chartType: 'donut' });

    expect(byName(list, 'chart-x')?.title).toBe('tools.database.chartSlices');
    expect(names(list)).toContain('chart-center-value');
    expect(names(list)).not.toContain('chart-group-by');
    expect(names(list)).not.toContain('chart-grid-lines');
  });

  it('keeps only what a number chart uses', () => {
    expect(names(items({ chartType: 'number' }))).toEqual(['chart-type', 'chart-y', 'chart-color']);
  });

  it('writes the picked chart type', () => {
    const update = vi.fn();

    byName(items({}, update), 'chart-type')?.children?.items.find((item) => item.name === 'chart-type-donut')?.onActivate?.();
    expect(update).toHaveBeenCalledWith({ chartType: 'donut' });
  });

  it('lists only groupable properties for the X axis and writes groupBy', () => {
    const update = vi.fn();
    const x = byName(items({}, update), 'chart-x');

    expect(x?.children?.items.map((item) => item.name)).toEqual(['chart-x-p-title', 'chart-x-p-status', 'chart-x-p-points']);
    x?.children?.items.find((item) => item.name === 'chart-x-p-points')?.onActivate?.();
    expect(update).toHaveBeenCalledWith({ groupBy: 'p-points' });
  });

  it('offers Count and each property function on the Y axis, with the active one marked', () => {
    const update = vi.fn();
    const y = byName(items({ chartMeasure: 'sum:p-points' }, update), 'chart-y');
    const sum = y?.children?.items.find((item) => item.name === 'chart-y-sum:p-points');

    expect(y?.children?.items[0]).toMatchObject({ name: 'chart-y-count', title: 'tools.database.calcCount' });
    expect(sum).toMatchObject({ title: 'tools.database.chartMeasure(tools.database.calcSum,Points)', isActive: true });
    y?.children?.items[0].onActivate?.();
    expect(update).toHaveBeenCalledWith({ chartMeasure: 'count' });
  });

  it('groups the series by another property, or none', () => {
    const update = vi.fn();
    const group = byName(items({ subGroupBy: 'p-points' }, update), 'chart-group-by');

    expect(group?.children?.items.map((item) => item.name)).toEqual(['chart-group-by-none', 'chart-group-by-p-title', 'chart-group-by-p-points']);
    group?.children?.items[0].onActivate?.();
    expect(update).toHaveBeenCalledWith({ subGroupBy: undefined });
  });

  it('flips a switch row', () => {
    const update = vi.fn();

    byName(items({ chartOmitZero: true }, update), 'chart-omit-zero')?.onActivate?.();
    expect(update).toHaveBeenCalledWith({ chartOmitZero: false });
  });

  it('offers every Notion palette', () => {
    expect(byName(items(), 'chart-color')?.children?.items.map((item) => item.name)).toEqual([
      'chart-color-auto', 'chart-color-colorful', 'chart-color-gray', 'chart-color-blue', 'chart-color-yellow', 'chart-color-green',
      'chart-color-purple', 'chart-color-teal', 'chart-color-orange', 'chart-color-pink', 'chart-color-red',
    ]);
  });
});
