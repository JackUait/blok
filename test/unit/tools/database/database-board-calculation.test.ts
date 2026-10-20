import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import {
  groupCalculationHint,
  groupCalculationItems,
  groupCalculationText,
  type GroupCalculationMenuParams,
} from '../../../../src/tools/database/database-board-calculation';
import { groupCalculationCapped, groupCalculationFor, resolveGroupCalculation } from '../../../../src/tools/database/view-settings';

const i18n = { t: (key: string, vars?: Record<string, string>) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`) };

const SCHEMA: PropertyDefinition[] = [
  { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a1' },
  { id: 'p-when', name: 'When', type: 'date', position: 'a2' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a3' },
  { id: 'p-stage', name: 'Stage', type: 'status', position: 'a4' },
];

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const row = (id: string, properties: DatabaseRow['properties']): DatabaseRow => ({ id, position: 'a0', properties });

type Item = PopoverItemParams & { title?: string; isActive?: boolean | (() => boolean); onActivate?: () => void; children?: { items?: PopoverItemParams[] } };

const titled = (items: PopoverItemParams[] | undefined, title: string): Item => {
  const found = (items as Item[] | undefined)?.find((item) => item.title === title);

  if (found === undefined) throw new Error(`no item titled ${title}`);

  return found;
};

const titles = (items: PopoverItemParams[] | undefined): Array<string | undefined> => (items as Item[] | undefined ?? []).map((item) => item.title);

const menu = (overrides: Partial<GroupCalculationMenuParams> = {}): GroupCalculationMenuParams => ({
  i18n,
  schema: SCHEMA,
  groupBy: 'p-stage',
  current: { fn: 'count', capCounts: true },
  onPick: vi.fn(),
  onCapCounts: vi.fn(),
  ...overrides,
});

describe('board column calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveGroupCalculation', () => {
    it('is Count all with large counts capped when the view saves nothing', () => {
      expect(resolveGroupCalculation(view(), SCHEMA)).toEqual({ fn: 'count', capCounts: true });
    });

    it('reads a saved calculation on a property', () => {
      expect(resolveGroupCalculation(view({ groupCalculation: { id: 'p-points', fn: 'sum', capCounts: false } }), SCHEMA))
        .toEqual({ fn: 'sum', propertyId: 'p-points', capCounts: false });
    });

    it('falls back to Count all when the property is gone or its type does not offer the function', () => {
      expect(resolveGroupCalculation(view({ groupCalculation: { id: 'p-gone', fn: 'sum' } }), SCHEMA)).toEqual({ fn: 'count', capCounts: true });
      expect(resolveGroupCalculation(view({ groupCalculation: { id: 'p-link', fn: 'sum' } }), SCHEMA)).toEqual({ fn: 'count', capCounts: true });
    });

    it('keeps Count all with the cap turned off', () => {
      expect(resolveGroupCalculation(view({ groupCalculation: { id: 'p-name', fn: 'count', capCounts: false } }), SCHEMA))
        .toEqual({ fn: 'count', capCounts: false });
    });
  });

  describe('the saved field', () => {
    it('clears the field for Count all, so the default comes back', () => {
      expect(groupCalculationFor('count', undefined, 'p-name')).toBeUndefined();
    });

    it('saves a picked function with the cap off, as Notion turns it off after leaving Count all', () => {
      expect(groupCalculationFor('sum', 'p-points', 'p-name')).toEqual({ id: 'p-points', fn: 'sum', capCounts: false });
    });

    it('saves Count all only to remember the cap turned off', () => {
      expect(groupCalculationCapped({ fn: 'count', capCounts: true }, false, 'p-name')).toEqual({ id: 'p-name', fn: 'count', capCounts: false });
      expect(groupCalculationCapped({ fn: 'count', capCounts: false }, true, 'p-name')).toBeUndefined();
      expect(groupCalculationCapped({ fn: 'count_values', propertyId: 'p-link', capCounts: false }, true, 'p-name'))
        .toEqual({ id: 'p-link', fn: 'count_values', capCounts: true });
    });
  });

  describe('groupCalculationItems', () => {
    it('opens Count, Percent, More options and Date, with no None', () => {
      expect(titles(groupCalculationItems(menu()))).toEqual([
        'tools.database.calcCount', 'tools.database.calcPercent', 'tools.database.calcMoreOptions', 'tools.database.calcDate',
      ]);
    });

    it('starts Count with the 99+ switch, then Count all and the per-property counts', () => {
      const count = titled(groupCalculationItems(menu()), 'tools.database.calcCount');

      expect(titles(count.children?.items)).toEqual([
        'tools.database.calcShowLargeCounts', 'tools.database.calcCountAll', 'tools.database.calcCountValues',
        'tools.database.calcCountUnique', 'tools.database.calcCountEmpty', 'tools.database.calcCountNotEmpty',
      ]);
    });

    it('checks Count all and the 99+ switch by default', () => {
      const count = titled(groupCalculationItems(menu()), 'tools.database.calcCount');
      const active = (item: Item): boolean => (typeof item.isActive === 'function' ? item.isActive() : item.isActive === true);

      expect(active(titled(count.children?.items, 'tools.database.calcCountAll'))).toBe(true);
      expect(active(titled(count.children?.items, 'tools.database.calcShowLargeCounts'))).toBe(true);
    });

    // research/22 §5: the switch carries "This improves performance for large databases." under its name.
    it('shows a hint under the 99+ switch', () => {
      const count = titled(groupCalculationItems(menu()), 'tools.database.calcCount');
      const cap = titled(count.children?.items, 'tools.database.calcShowLargeCounts');
      const titleEl = 'titleEl' in cap ? cap.titleEl : undefined;

      expect(titleEl?.querySelector('[data-blok-database-calc-hint]')?.textContent).toBe('tools.database.calcShowLargeCountsHint');
      expect(titleEl?.firstChild?.textContent).toBe('tools.database.calcShowLargeCounts');
    });

    it('lists only number properties under Sum', () => {
      const more = titled(groupCalculationItems(menu()), 'tools.database.calcMoreOptions');

      expect(titles(titled(more.children?.items, 'tools.database.calcSum').children?.items)).toEqual(['Points']);
    });

    it('leaves the group-by property out of Count values', () => {
      const count = titled(groupCalculationItems(menu()), 'tools.database.calcCount');

      expect(titles(titled(count.children?.items, 'tools.database.calcCountValues').children?.items)).toEqual(['Name', 'Points', 'When', 'Link']);
    });

    it('picks a function on a property', () => {
      const onPick = vi.fn();
      const more = titled(groupCalculationItems(menu({ onPick })), 'tools.database.calcMoreOptions');

      titled(titled(more.children?.items, 'tools.database.calcSum').children?.items, 'Points').onActivate?.();

      expect(onPick).toHaveBeenCalledWith('sum', 'p-points');
    });

    it('turns the 99+ switch off', () => {
      const onCapCounts = vi.fn();
      const count = titled(groupCalculationItems(menu({ onCapCounts })), 'tools.database.calcCount');

      titled(count.children?.items, 'tools.database.calcShowLargeCounts').onActivate?.();

      expect(onCapCounts).toHaveBeenCalledWith(false);
    });

    it('drops More options when no property offers a number calculation', () => {
      const schema = SCHEMA.filter((p) => p.type !== 'number');

      expect(titles(groupCalculationItems(menu({ schema })))).not.toContain('tools.database.calcMoreOptions');
    });
  });

  describe('groupCalculationText', () => {
    const rows = [row('r1', { 'p-points': 3 }), row('r2', { 'p-points': 5, 'p-link': 'https://example.com' }), row('r3', { 'p-points': 7 })];

    it('counts every row for Count all', () => {
      expect(groupCalculationText({ fn: 'count', capCounts: true }, rows, SCHEMA, 'en')).toBe('3');
    });

    it('sums a number property, and shows 0 for a column with nothing to sum', () => {
      expect(groupCalculationText({ fn: 'sum', propertyId: 'p-points', capCounts: false }, rows, SCHEMA, 'en')).toBe('15');
      expect(groupCalculationText({ fn: 'sum', propertyId: 'p-points', capCounts: false }, [], SCHEMA, 'en')).toBe('0');
    });

    it('counts values of one property', () => {
      expect(groupCalculationText({ fn: 'count_values', propertyId: 'p-link', capCounts: false }, rows, SCHEMA, 'en')).toBe('1');
    });

    it('shows a count above 99 as 99+ while the cap is on', () => {
      const many = Array.from({ length: 120 }, (_, i) => row(`r${i}`, {}));

      expect(groupCalculationText({ fn: 'count', capCounts: true }, many, SCHEMA, 'en')).toBe('99+');
      expect(groupCalculationText({ fn: 'count', capCounts: false }, many, SCHEMA, 'en')).toBe('120');
    });

    // research/22 §5: Percent not empty, Earliest date and Date range in Due.
    it('shows Notion\'s results: whole percent, full date, date range as a duration', () => {
      const due = [row('a', { 'p-when': '2026-10-20' }), row('b', { 'p-when': '2026-10-28' }), row('c', {})];

      expect(groupCalculationText({ fn: 'percent_not_empty', propertyId: 'p-when', capCounts: false }, due.slice(0, 2), SCHEMA, 'en-US')).toBe('100%');
      expect(groupCalculationText({ fn: 'earliest_date', propertyId: 'p-when', capCounts: false }, due, SCHEMA, 'en-US')).toBe('October 20, 2026');
      expect(groupCalculationText({ fn: 'date_range', propertyId: 'p-when', capCounts: false }, due, SCHEMA, 'en-US')).toBe('8 days');
      expect(groupCalculationText({ fn: 'date_range', propertyId: 'p-when', capCounts: false }, due.slice(0, 1), SCHEMA, 'en-US')).toBe('0 minutes');
    });
  });

  describe('groupCalculationHint', () => {
    // research/23 §2a: Notion's Count all number has no hover hint.
    it('gives Count all no hint', () => {
      expect(groupCalculationHint({ fn: 'count', capCounts: true }, SCHEMA, i18n)).toBeUndefined();
    });

    it('reads "<calculation> in <property>" for a property calculation', () => {
      expect(groupCalculationHint({ fn: 'sum', propertyId: 'p-points', capCounts: false }, SCHEMA, i18n))
        .toBe('tools.database.groupCalculationHint:{"calculation":"tools.database.calcSum","property":"Points"}');
    });
  });
});
