import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseModel, NO_VALUE_GROUP_KEY } from '../../../../src/tools/database/database-model';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'num', name: 'Score', type: 'number', position: 'a1' },
  {
    id: 'status', name: 'Status', type: 'select', position: 'a2', config: {
      options: [
        { id: 'o-b', label: 'Build', position: 'a0' },
        { id: 'o-i', label: 'Idea', position: 'a1' },
      ],
    },
  },
];

const view = (overrides: Partial<DatabaseViewConfig>): DatabaseViewConfig => ({
  id: 'v', name: 'V', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const model = (): DatabaseModel => {
  const m = new DatabaseModel({ schema, views: [view({})], activeViewId: 'v' });

  m.setRows([
    { id: 'a', position: 'a0', properties: { title: 'Alpha', num: 1200, status: 'o-i' } },
    { id: 'b', position: 'a1', properties: { title: 'Bravo', num: 35.5, status: 'o-b' } },
    { id: 'c', position: 'a2', properties: { title: 'Charlie' } },
    { id: 'd', position: 'a3', properties: { title: 'Delta', num: -40, status: 'o-i' } },
  ]);

  return m;
};

describe('DatabaseModel — grouping by any type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries one number group', () => {
    const v = view({ groupBy: 'num' });

    expect(model().queryRows({ view: v, group: '35.5' }).rows.map((r) => r.id)).toEqual(['b']);
  });

  it('lists number groups in order, the no-value group first', () => {
    expect(model().listGroups(view({ groupBy: 'num' }))).toEqual([
      { key: NO_VALUE_GROUP_KEY, count: 1 },
      { key: '-40', count: 1 },
      { key: '35.5', count: 1 },
      { key: '1200', count: 1 },
    ]);
  });

  it('buckets numbers into ranges', () => {
    const v = view({ groupBy: 'num', groupSettings: { numberBy: 'range', rangeStart: 0, rangeEnd: 1000, rangeSize: 100 } });

    expect(model().listGroups(v).map((g) => g.key)).toEqual([NO_VALUE_GROUP_KEY, 'range:below', 'range:0', 'range:above']);
  });

  it('lists every select option, empty ones too, with the no-value group last', () => {
    const groups = model().listGroups(view({ groupBy: 'status' }));

    expect(groups).toEqual([
      { key: 'o-b', count: 1 },
      { key: 'o-i', count: 2 },
      { key: NO_VALUE_GROUP_KEY, count: 1 },
    ]);
  });

  it('drops empty groups when the view hides them', () => {
    const m = model();

    m.setRows([{ id: 'a', position: 'a0', properties: { status: 'o-i' } }]);

    expect(m.listGroups(view({ groupBy: 'status', groupSettings: { hideEmptyGroups: true } })).map((g) => g.key)).toEqual(['o-i']);
  });

  it('counts only rows the filters and the search let through', () => {
    const v = view({ groupBy: 'status', filters: [{ propertyId: 'num', operator: 'greater_than', value: 0 }] });

    expect(model().listGroups(v, { search: 'bra' })).toEqual([
      { key: 'o-b', count: 1 },
      { key: 'o-i', count: 0 },
      { key: NO_VALUE_GROUP_KEY, count: 0 },
    ]);
  });
});
