import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FILTER_OPERATORS,
  FILTER_OPERATOR_LABEL_KEYS,
  newRowValues,
  rowMatchesFilters,
  sortRows,
} from '../../../../src/tools/database/database-query';
import { DatabaseModel, NO_VALUE_GROUP_KEY } from '../../../../src/tools/database/database-model';
import { createDefaultStatusSettings, createDefaultStatusOptions } from '../../../../src/tools/database/property-values';
import type {
  DatabaseRow,
  DatabaseRowMeta,
  FilterConfig,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
} from '../../../../src/tools/database/types';

const statusOptions = [
  { id: 's-ns', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
  { id: 's-ip', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
  { id: 's-done', label: 'Done', color: 'green', position: 'a0', groupId: 'complete' },
  { id: 's-blocked', label: 'Blocked', color: 'red', position: 'a1', groupId: 'inProgress' },
];

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'st', name: 'Progress', type: 'status', position: 'a1', config: { options: statusOptions }, status: createDefaultStatusSettings() },
  { id: 'mail', name: 'Mail', type: 'email', position: 'a2' },
  { id: 'tel', name: 'Tel', type: 'phone', position: 'a3' },
  { id: 'who', name: 'Owner', type: 'person', position: 'a4' },
  { id: 'att', name: 'Attachment', type: 'files', position: 'a5' },
  { id: 'ct', name: 'Created', type: 'createdTime', position: 'a6' },
  { id: 'et', name: 'Edited', type: 'lastEditedTime', position: 'a7' },
  { id: 'cb', name: 'Creator', type: 'createdBy', position: 'a8' },
  { id: 'eb', name: 'Editor', type: 'lastEditedBy', position: 'a9' },
  { id: 'uid', name: 'Code', type: 'uniqueId', position: 'b0', uniqueId: { prefix: 'TASK' } },
];

const row = (id: string, position: string, properties: Record<string, PropertyValue> = {}, meta?: DatabaseRowMeta): DatabaseRow => ({
  id,
  position,
  properties,
  ...(meta !== undefined ? { meta } : {}),
});

const ids = (rows: DatabaseRow[]): string[] => rows.map((r) => r.id);
const matches = (r: DatabaseRow, filter: FilterConfig): boolean => rowMatchesFilters(r, [filter], schema);

const OCT_9 = Date.UTC(2026, 9, 9, 12);
const OCT_12 = Date.UTC(2026, 9, 12, 12);

describe('property types — query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FILTER_OPERATORS', () => {
    it('lists Notion API operator names for every new type', () => {
      expect(FILTER_OPERATORS.status).toEqual(['equals', 'does_not_equal', 'is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.email).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.phone).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.person).toEqual(['contains', 'does_not_contain', 'is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.createdBy).toEqual(FILTER_OPERATORS.person);
      expect(FILTER_OPERATORS.lastEditedBy).toEqual(FILTER_OPERATORS.person);
      expect(FILTER_OPERATORS.files).toEqual(['is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.createdTime).toEqual(FILTER_OPERATORS.date);
      expect(FILTER_OPERATORS.lastEditedTime).toEqual(FILTER_OPERATORS.date);
      expect(FILTER_OPERATORS.uniqueId).toEqual([
        'equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to',
      ]);
    });

    it('gives every operator of every type a UI label key', () => {
      for (const [type, operators] of Object.entries(FILTER_OPERATORS)) {
        for (const operator of operators) {
          expect(FILTER_OPERATOR_LABEL_KEYS[type as PropertyType][operator], `${type} ${operator}`).toMatch(/^tools\.database\.filterOperator\./);
        }
      }
    });

    it('labels number operators with symbols and text operators with words, as research/08 measured', () => {
      expect(FILTER_OPERATOR_LABEL_KEYS.number.equals).toBe('tools.database.filterOperator.numberEquals');
      expect(FILTER_OPERATOR_LABEL_KEYS.text.equals).toBe('tools.database.filterOperator.is');
      expect(FILTER_OPERATOR_LABEL_KEYS.person.contains).toBe('tools.database.filterOperator.contains');
    });
  });

  describe('status', () => {
    const r = row('r', 'a0', { st: 's-blocked' });

    it('matches an option id', () => {
      expect(matches(r, { propertyId: 'st', operator: 'equals', value: 's-blocked' })).toBe(true);
      expect(matches(r, { propertyId: 'st', operator: 'equals', value: 's-done' })).toBe(false);
      expect(matches(r, { propertyId: 'st', operator: 'does_not_equal', value: 's-done' })).toBe(true);
    });

    it('matches a group id against every option in the group', () => {
      expect(matches(r, { propertyId: 'st', operator: 'equals', value: 'inProgress' })).toBe(true);
      expect(matches(r, { propertyId: 'st', operator: 'equals', value: 'complete' })).toBe(false);
      expect(matches(r, { propertyId: 'st', operator: 'does_not_equal', value: 'todo' })).toBe(true);
    });

    it('sorts by group, then by option order inside the group', () => {
      const rows = [
        row('done', 'a0', { st: 's-done' }),
        row('blocked', 'a1', { st: 's-blocked' }),
        row('ip', 'a2', { st: 's-ip' }),
        row('ns', 'a3', { st: 's-ns' }),
        row('none', 'a4'),
      ];

      expect(ids(sortRows(rows, [{ propertyId: 'st', direction: 'asc' }], schema))).toEqual(['ns', 'ip', 'blocked', 'done', 'none']);
      expect(ids(sortRows(rows, [{ propertyId: 'st', direction: 'desc' }], schema))).toEqual(['done', 'blocked', 'ip', 'ns', 'none']);
    });

    it('gives a new row the option an equals filter asks for', () => {
      expect(newRowValues([{ propertyId: 'st', operator: 'equals', value: 's-ip' }], schema)).toEqual({ st: 's-ip' });
    });

    it('ships the three Notion defaults in the three default groups', () => {
      const settings = createDefaultStatusSettings();
      const options = createDefaultStatusOptions({ notStarted: 'Not started', inProgress: 'In progress', done: 'Done' });

      expect(settings.groups.map((g) => [g.id, g.kind])).toEqual([['todo', 'todo'], ['inProgress', 'inProgress'], ['complete', 'complete']]);
      expect(options.map((o) => [o.label, o.groupId, o.color])).toEqual([
        ['Not started', 'todo', 'gray'],
        ['In progress', 'inProgress', 'blue'],
        ['Done', 'complete', 'green'],
      ]);
      expect(new Set(options.map((o) => o.id)).size).toBe(3);
    });
  });

  describe('email and phone', () => {
    it('filter as text', () => {
      const r = row('r', 'a0', { mail: 'Ada@Example.com', tel: '+1 555 0100' });

      expect(matches(r, { propertyId: 'mail', operator: 'ends_with', value: 'example.com' })).toBe(true);
      expect(matches(r, { propertyId: 'tel', operator: 'contains', value: '555' })).toBe(true);
      expect(matches(r, { propertyId: 'tel', operator: 'is_empty', value: null })).toBe(false);
    });

    it('sort alphabetically with empties last', () => {
      const rows = [row('b', 'a0', { mail: 'b@x.io' }), row('none', 'a1'), row('a', 'a2', { mail: 'a@x.io' })];

      expect(ids(sortRows(rows, [{ propertyId: 'mail', direction: 'asc' }], schema))).toEqual(['a', 'b', 'none']);
    });
  });

  describe('person', () => {
    const r = row('r', 'a0', { who: [{ id: 'u1' }, { id: 'u2' }] });

    it('contains / does not contain a person id', () => {
      expect(matches(r, { propertyId: 'who', operator: 'contains', value: 'u2' })).toBe(true);
      expect(matches(r, { propertyId: 'who', operator: 'contains', value: ['u9', 'u1'] })).toBe(true);
      expect(matches(r, { propertyId: 'who', operator: 'does_not_contain', value: 'u1' })).toBe(false);
      expect(matches(row('e', 'a0', { who: [] }), { propertyId: 'who', operator: 'is_empty', value: null })).toBe(true);
    });

    it('gives a new row the person a contains filter asks for', () => {
      expect(newRowValues([{ propertyId: 'who', operator: 'contains', value: 'u1' }], schema)).toEqual({ who: [{ id: 'u1' }] });
    });
  });

  describe('files', () => {
    it('is empty / is not empty', () => {
      const withFile = row('f', 'a0', { att: [{ id: 'f1', name: 'a.pdf', url: 'https://x.io/a.pdf' }] });

      expect(matches(withFile, { propertyId: 'att', operator: 'is_not_empty', value: null })).toBe(true);
      expect(matches(row('n', 'a0'), { propertyId: 'att', operator: 'is_empty', value: null })).toBe(true);
    });
  });

  describe('created and last edited', () => {
    const early = row('early', 'a1', {}, { createdAt: OCT_9, createdBy: 'u1', lastEditedAt: OCT_12, lastEditedBy: 'u2' });
    const late = row('late', 'a0', {}, { createdAt: OCT_12, createdBy: 'u2', lastEditedAt: OCT_9, lastEditedBy: 'u1' });
    const legacy = row('legacy', 'a2');

    it('filters the times as dates read from row metadata', () => {
      expect(matches(early, { propertyId: 'ct', operator: 'before', value: '2026-10-10' })).toBe(true);
      expect(matches(late, { propertyId: 'ct', operator: 'before', value: '2026-10-10' })).toBe(false);
      expect(matches(legacy, { propertyId: 'ct', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(early, { propertyId: 'et', operator: 'on_or_after', value: '2026-10-12' })).toBe(true);
    });

    it('filters the people as person values read from row metadata', () => {
      expect(matches(early, { propertyId: 'cb', operator: 'contains', value: 'u1' })).toBe(true);
      expect(matches(early, { propertyId: 'eb', operator: 'contains', value: 'u1' })).toBe(false);
      expect(matches(legacy, { propertyId: 'cb', operator: 'is_empty', value: null })).toBe(true);
    });

    it('sorts by the time, empties last', () => {
      expect(ids(sortRows([late, legacy, early], [{ propertyId: 'ct', direction: 'asc' }], schema))).toEqual(['early', 'late', 'legacy']);
      expect(ids(sortRows([late, legacy, early], [{ propertyId: 'et', direction: 'asc' }], schema))).toEqual(['late', 'early', 'legacy']);
    });

    it('never takes a value from a filter on a new row', () => {
      expect(newRowValues([{ propertyId: 'ct', operator: 'equals', value: '2026-10-09' }], schema)).toEqual({});
    });
  });

  describe('unique id', () => {
    it('filters and sorts by number', () => {
      const rows = [row('r3', 'a0', { uid: 3 }), row('r1', 'a1', { uid: 1 }), row('r2', 'a2', { uid: 2 })];

      expect(matches(rows[0], { propertyId: 'uid', operator: 'greater_than', value: 2 })).toBe(true);
      expect(matches(rows[1], { propertyId: 'uid', operator: 'greater_than_or_equal_to', value: '2' })).toBe(false);
      expect(ids(sortRows(rows, [{ propertyId: 'uid', direction: 'desc' }], schema))).toEqual(['r3', 'r2', 'r1']);
    });
  });

  describe('grouping', () => {
    const model = (): DatabaseModel => {
      const m = new DatabaseModel({ schema, views: [{ id: 'v', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' });

      m.setRows([
        row('ns', 'a0', { st: 's-ns', who: [{ id: 'u1' }] }),
        row('blocked', 'a1', { st: 's-blocked', who: [{ id: 'u1' }, { id: 'u2' }] }),
        row('ip', 'a2', { st: 's-ip' }, { createdBy: 'u3' }),
      ]);

      return m;
    };

    it('groups status by option', () => {
      const groups = model().getRowsGroupedBy('st');

      expect([...groups.keys()]).toEqual(['s-ns', 's-blocked', 's-ip']);
    });

    it('groups status by group when asked', () => {
      const groups = model().getRowsGroupedBy('st', { statusBy: 'group' });

      expect(ids(groups.get('inProgress') ?? [])).toEqual(['blocked', 'ip']);
      expect(ids(groups.get('todo') ?? [])).toEqual(['ns']);
    });

    it('lists status columns per option in group order, or one per group', () => {
      expect(model().getSelectOptions('st').map((o) => o.id)).toEqual(['s-ns', 's-ip', 's-blocked', 's-done']);
      expect(model().getSelectOptions('st', { statusBy: 'group' }).map((o) => [o.id, o.label])).toEqual([
        ['todo', 'To-do'], ['inProgress', 'In progress'], ['complete', 'Complete'],
      ]);
    });

    it('drops a card into a status group as the group\'s first option, or keeps its option when it is already there', () => {
      const m = model();

      expect(m.statusValueForGroup('st', 'complete', 's-ns')).toBe('s-done');
      expect(m.statusValueForGroup('st', 'inProgress', 's-blocked')).toBe('s-blocked');
      expect(m.statusValueForGroup('st', 'inProgress', null)).toBe('s-ip');
    });

    it('puts a row in every person group it names', () => {
      const groups = model().getRowsGroupedBy('who');

      expect(ids(groups.get('u1') ?? [])).toEqual(['ns', 'blocked']);
      expect(ids(groups.get('u2') ?? [])).toEqual(['blocked']);
      expect(ids(groups.get(NO_VALUE_GROUP_KEY) ?? [])).toEqual(['ip']);
    });

    it('groups created by from row metadata', () => {
      const groups = model().getRowsGroupedBy('cb');

      expect(ids(groups.get('u3') ?? [])).toEqual(['ip']);
      expect(ids(groups.get(NO_VALUE_GROUP_KEY) ?? [])).toEqual(['ns', 'blocked']);
    });
  });
});

describe('property types — calculations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts unique people by id, not by object', async () => {
    const { computeCalculation } = await import('../../../../src/tools/database/database-calculations');
    const who = schema.find((p) => p.id === 'who') as PropertyDefinition;

    expect(computeCalculation('unique', [[{ id: 'u1' }], [{ id: 'u1' }, { id: 'u2' }]], who)).toEqual({ kind: 'number', value: 2 });
  });

  it('offers the date calculations on created and last edited time', async () => {
    const { CALCULATIONS_FOR_TYPE } = await import('../../../../src/tools/database/database-calculations');

    expect(CALCULATIONS_FOR_TYPE.createdTime).toContain('earliest_date');
    expect(CALCULATIONS_FOR_TYPE.status).not.toContain('sum');
  });
});

describe('property types — formulas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = async (source: string, r: DatabaseRow): Promise<unknown> => {
    const { compileFormula, evaluateFormula } = await import('../../../../src/tools/database/formula');
    const compiled = compileFormula(source, schema);

    if (!compiled.ok) throw new Error(compiled.error.message);

    return evaluateFormula(compiled.formula, r, { now: new Date(OCT_12), schema, timeZone: 'UTC' });
  };

  it('reads a status as its label, an email as text and an ID with its prefix', async () => {
    const r = row('r', 'a0', { st: 's-done', mail: 'a@b.io', uid: 7 });

    expect(await run('prop("Progress")', r)).toBe('Done');
    expect(await run('prop("Mail")', r)).toBe('a@b.io');
    expect(await run('prop("Code")', r)).toBe('TASK-7');
  });

  it('reads people as person refs and created time from row metadata', async () => {
    const r = row('r', 'a0', { who: [{ id: 'u1' }] }, { createdAt: OCT_9, createdBy: 'u3' });

    expect(await run('prop("Owner")', r)).toEqual([{ kind: 'person', id: 'u1' }]);
    expect(await run('prop("Creator")', r)).toEqual({ kind: 'person', id: 'u3' });
    expect(await run('dateBetween(prop("Created"), prop("Created"), "days")', r)).toBe(0);
  });
});

describe('unique id assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const idOf = (rows: DatabaseRow[], id: string): PropertyValue | undefined => rows.find((r) => r.id === id)?.properties.uid;

  it('numbers rows without an id in creation order, after the highest stored one', async () => {
    const { assignUniqueIds } = await import('../../../../src/tools/database/property-values');
    const rows = [
      row('c', 'a2', {}, { createdAt: 30 }),
      row('a', 'a0', { uid: 4 }, { createdAt: 10 }),
      row('b', 'a1', {}, { createdAt: 20 }),
    ];
    const out = assignUniqueIds(rows, 'uid');

    expect([idOf(out, 'a'), idOf(out, 'b'), idOf(out, 'c')]).toEqual([4, 5, 6]);
  });

  it('numbers rows made before creation stamps existed first, by position', async () => {
    const { assignUniqueIds } = await import('../../../../src/tools/database/property-values');
    const out = assignUniqueIds([row('new', 'a0', {}, { createdAt: 5 }), row('old2', 'a2'), row('old1', 'a1')], 'uid');

    expect([idOf(out, 'old1'), idOf(out, 'old2'), idOf(out, 'new')]).toEqual([1, 2, 3]);
  });

  it('gives the later of two rows two peers numbered alike the next free number, the same on every peer', async () => {
    const { assignUniqueIds } = await import('../../../../src/tools/database/property-values');
    const rows = [
      row('mine', 'a1', { uid: 5 }, { createdAt: 200 }),
      row('theirs', 'a2', { uid: 5 }, { createdAt: 100 }),
      row('x', 'a0', { uid: 4 }, { createdAt: 50 }),
    ];
    const a = assignUniqueIds(rows, 'uid');
    const b = assignUniqueIds([...rows].reverse(), 'uid');

    expect([idOf(a, 'theirs'), idOf(a, 'mine')]).toEqual([5, 6]);
    expect([idOf(b, 'theirs'), idOf(b, 'mine')]).toEqual([5, 6]);
  });

  it('breaks a creation-time tie by row id, so peers agree', async () => {
    const { assignUniqueIds } = await import('../../../../src/tools/database/property-values');
    const out = assignUniqueIds([row('zz', 'a0', { uid: 1 }, { createdAt: 9 }), row('aa', 'a0', { uid: 1 }, { createdAt: 9 })], 'uid');

    expect([idOf(out, 'aa'), idOf(out, 'zz')]).toEqual([1, 2]);
  });

  it('keeps every stored number after a row is deleted', async () => {
    const { assignUniqueIds } = await import('../../../../src/tools/database/property-values');
    const out = assignUniqueIds([row('a', 'a0', { uid: 1 }, { createdAt: 1 }), row('c', 'a2', { uid: 3 }, { createdAt: 3 })], 'uid');

    expect([idOf(out, 'a'), idOf(out, 'c')]).toEqual([1, 3]);
  });

  it('returns the same row objects when nothing changes', async () => {
    const { assignUniqueIds } = await import('../../../../src/tools/database/property-values');
    const rows = [row('a', 'a0', { uid: 1 }, { createdAt: 1 })];

    expect(assignUniqueIds(rows, 'uid')[0]).toBe(rows[0]);
  });
});

describe('model property operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fresh = (): DatabaseModel => new DatabaseModel({
    schema: [
      { id: 'title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'n', name: 'Amount', type: 'number', position: 'a1', config: { options: [] } },
      { id: 'z', name: 'Zed', type: 'text', position: 'a2' },
    ],
    views: [{ id: 'v', name: 'V', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'v',
  });

  it('merges settings and removes a setting given as undefined', () => {
    const model = fresh();

    model.updateProperty('n', { number: { format: 'euro' }, description: 'Spend' });
    model.updateProperty('n', { description: undefined });

    expect(model.getProperty('n')).toMatchObject({ number: { format: 'euro' } });
    expect(model.getProperty('n')).not.toHaveProperty('description');
  });

  it('replaces a whole property for a type change, keeping its place', () => {
    const model = fresh();

    model.replaceProperty({ id: 'n', name: 'Amount', type: 'text', position: 'a1' });

    expect(model.getSchema().map((p) => [p.id, p.type])).toEqual([['title', 'title'], ['n', 'text'], ['z', 'text']]);
  });

  it('adds a property right after another', () => {
    const model = fresh();
    const added = model.addProperty('Owner', 'person', undefined, { afterId: 'n' });

    expect(model.getSchema().map((p) => p.id)).toEqual(['title', 'n', added.id, 'z']);
  });

  it('adds a property right before another', () => {
    const model = fresh();
    const added = model.addProperty('First', 'text', undefined, { beforeId: 'n' });

    expect(model.getSchema().map((p) => p.id)).toEqual(['title', added.id, 'n', 'z']);
  });
});

describe('status group localization', () => {
  it('shows a default group name in the editor language and keeps a renamed one', async () => {
    const { localizeDatabaseSchema } = await import('../../../../src/tools/database/database-localization');
    const i18n = { t: (key: string) => `«${key}»` } as never;
    const settings = createDefaultStatusSettings();
    const renamed = { ...settings, groups: settings.groups.map((g) => (g.id === 'complete' ? { ...g, name: 'Shipped' } : g)) };
    const [localized] = localizeDatabaseSchema([{ id: 'st', name: 'S', type: 'status', position: 'a0', status: renamed }], i18n);

    expect(localized.status?.groups.map((g) => g.name)).toEqual(['«tools.database.statusGroupTodo»', '«tools.database.statusGroupInProgress»', 'Shipped']);
  });
});
