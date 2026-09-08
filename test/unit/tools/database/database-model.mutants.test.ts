import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import type {
  DatabaseRow,
  DatabaseViewConfig,
  PropertyDefinition,
  SelectOption,
} from '../../../../src/tools/database/types';

const makeProperty = (overrides: Partial<PropertyDefinition> = {}): PropertyDefinition => ({
  id: 'prop',
  name: 'Property',
  type: 'text',
  position: 'a0',
  ...overrides,
});

const makeRow = (overrides: Partial<DatabaseRow> = {}): DatabaseRow => ({
  id: 'row',
  position: 'a0',
  properties: {},
  ...overrides,
});

const makeView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'view',
  name: 'Board',
  type: 'board',
  position: 'a0',
  groupBy: 'prop-status',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

describe('DatabaseModel — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor defaults', () => {
    // `this.views.length > 0` on the activeViewId line is invariantly true: the
    // views branch above it either maps a non-empty `data.views` or installs one
    // default view, so that ternary and its '' arm can never be observed.
    it('falls back to the two-property default schema when the data carries an empty schema', () => {
      const model = new DatabaseModel({ schema: [], views: [], activeViewId: '' });

      expect(model.getSchema()).toStrictEqual([
        {
          id: expect.any(String),
          name: 'Title',
          type: 'title',
          position: 'a0',
        },
        {
          id: expect.any(String),
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: expect.any(String), label: 'Not started', color: 'gray', position: 'a0' },
              { id: expect.any(String), label: 'In progress', color: 'blue', position: 'a1' },
              { id: expect.any(String), label: 'Done', color: 'green', position: 'a2' },
            ],
          },
        },
      ]);
    });

    it('falls back to a single default board view when the data carries an empty views array', () => {
      const model = new DatabaseModel({ schema: [], views: [], activeViewId: '' });
      const statusProperty = model.getSchema().find((property) => property.type === 'select');

      expect(model.getViews()).toStrictEqual([
        {
          id: expect.any(String),
          name: 'Board',
          type: 'board',
          position: 'a0',
          groupBy: statusProperty?.id,
          sorts: [],
          filters: [],
          visibleProperties: [],
        },
      ]);
    });

    it('carries the sorts, filters and visible properties of every provided view', () => {
      const view = makeView({
        id: 'v1',
        name: 'Table',
        type: 'table',
        sorts: [{ propertyId: 'p1', direction: 'asc' }],
        filters: [{ propertyId: 'p1', operator: 'is', value: 'done' }],
        visibleProperties: ['p1', 'p2'],
      });
      const model = new DatabaseModel({ schema: [], views: [view], activeViewId: 'v1' });

      expect(model.getViews()).toStrictEqual([view]);
    });
  });

  describe('addProperty', () => {
    it('appends after the last schema entry and omits the config key when none is given', () => {
      const model = new DatabaseModel({
        schema: [makeProperty({ id: 'p1', position: 'a5' })],
        views: [],
        activeViewId: '',
      });

      expect(model.addProperty('Priority', 'select')).toStrictEqual({
        id: expect.any(String),
        name: 'Priority',
        type: 'select',
        position: 'a6',
      });
    });

    it('starts a fresh key run once every property has been deleted', () => {
      const model = new DatabaseModel();

      for (const property of model.getSchema()) {
        model.deleteProperty(property.id);
      }
      expect(model.getSchema()).toStrictEqual([]);

      const add = (): PropertyDefinition => model.addProperty('First', 'text');

      expect(add).not.toThrow();
      expect(model.getSchema()).toStrictEqual([
        { id: expect.any(String), name: 'First', type: 'text', position: 'a0' },
      ]);
    });
  });

  describe('updateProperty', () => {
    const twoProperties = (): DatabaseModel => new DatabaseModel({
      schema: [
        makeProperty({ id: 'p1', name: 'Title', type: 'title', position: 'a0' }),
        makeProperty({ id: 'p2', name: 'Notes', type: 'text', position: 'a1' }),
      ],
      views: [],
      activeViewId: '',
    });

    it('leaves the whole schema untouched when the id matches nothing', () => {
      const model = twoProperties();

      expect(() => model.updateProperty('missing', { name: 'Renamed' })).not.toThrow();
      expect(model.getSchema()).toStrictEqual([
        { id: 'p1', name: 'Title', type: 'title', position: 'a0' },
        { id: 'p2', name: 'Notes', type: 'text', position: 'a1' },
      ]);
    });

    it('renames only the addressed property', () => {
      const model = twoProperties();

      model.updateProperty('p2', { name: 'Renamed' });

      expect(model.getSchema()).toStrictEqual([
        { id: 'p1', name: 'Title', type: 'title', position: 'a0' },
        { id: 'p2', name: 'Renamed', type: 'text', position: 'a1' },
      ]);
    });

    it('keeps the existing name when only the config changes', () => {
      const option: SelectOption = { id: 'o1', label: 'Done', position: 'a0' };
      const model = new DatabaseModel({
        schema: [makeProperty({ id: 'p1', name: 'Status', type: 'select', position: 'a0' })],
        views: [],
        activeViewId: '',
      });

      model.updateProperty('p1', { config: { options: [option] } });

      expect(model.getSchema()).toStrictEqual([
        {
          id: 'p1',
          name: 'Status',
          type: 'select',
          position: 'a0',
          config: { options: [option] },
        },
      ]);
    });
  });

  describe('rows', () => {
    it('returns undefined rather than the first row when the id matches nothing', () => {
      const first = makeRow({ id: 'r1', position: 'a0' });
      const second = makeRow({ id: 'r2', position: 'a1' });
      const model = new DatabaseModel({ schema: [], views: [], activeViewId: '' });

      model.setRows([first, second]);

      expect(model.getRow('missing')).toBeUndefined();
      expect(model.getRow('r2')).toBe(second);
    });

    it('places a new row after the last ordered row', () => {
      const model = new DatabaseModel({ schema: [], views: [], activeViewId: '' });

      model.setRows([makeRow({ id: 'r1', position: 'a5' })]);

      expect(model.createRowData()).toStrictEqual({
        id: expect.any(String),
        position: 'a6',
        properties: {},
      });
    });

    // The undefined/null guard in `toGroupKey` is a shortcut, not a decision:
    // typeof undefined is 'undefined' and typeof null is 'object', so both fall
    // through the string/boolean/number checks to the same '' return.
    it('stringifies numbers and drops list values into the empty-key group', () => {
      const numeric = makeRow({ id: 'r1', position: 'a0', properties: { score: 5 } });
      const list = makeRow({ id: 'r2', position: 'a1', properties: { score: ['x', 'y'] } });
      const missing = makeRow({ id: 'r3', position: 'a2', properties: {} });
      const model = new DatabaseModel({ schema: [], views: [], activeViewId: '' });

      model.setRows([numeric, list, missing]);

      expect(model.getRowsGroupedBy('score')).toStrictEqual(new Map([
        ['5', [numeric]],
        ['', [list, missing]],
      ]));
    });
  });

  describe('getSelectOptions', () => {
    const modelWith = (property: PropertyDefinition): DatabaseModel =>
      new DatabaseModel({ schema: [property], views: [], activeViewId: '' });

    it('returns an empty array for a select property that carries no config', () => {
      const model = modelWith(makeProperty({ id: 'p1', type: 'select' }));
      const read = (): SelectOption[] => model.getSelectOptions('p1');

      expect(read).not.toThrow();
      expect(read()).toStrictEqual([]);
    });

    it('ignores the options of a property that is neither select nor multiSelect', () => {
      const model = modelWith(makeProperty({
        id: 'p1',
        type: 'text',
        config: { options: [{ id: 'o1', label: 'A', position: 'a0' }] },
      }));

      expect(model.getSelectOptions('p1')).toStrictEqual([]);
    });

    it('returns the sorted options of a multiSelect property', () => {
      const first: SelectOption = { id: 'a', label: 'A', position: 'a0' };
      const second: SelectOption = { id: 'b', label: 'B', position: 'a1' };
      const model = modelWith(makeProperty({
        id: 'p1',
        type: 'multiSelect',
        config: { options: [second, first] },
      }));

      expect(model.getSelectOptions('p1')).toStrictEqual([first, second]);
    });

    // The comparator never returns 0, so options sharing a position are ordered
    // by the sort's own tie handling rather than by stability — which is exactly
    // what makes `<` distinguishable from `<=` here.
    it('orders options that share a position by the strict comparison', () => {
      const x: SelectOption = { id: 'x', label: 'X', position: 'a1' };
      const y: SelectOption = { id: 'y', label: 'Y', position: 'a1' };
      const z: SelectOption = { id: 'z', label: 'Z', position: 'a0' };
      const model = modelWith(makeProperty({
        id: 'p1',
        type: 'select',
        config: { options: [x, y, z] },
      }));

      expect(model.getSelectOptions('p1')).toStrictEqual([z, x, y]);
    });
  });

  describe('addView', () => {
    // Only `sorted[last].position` is read, and `<` and `<=` differ only on
    // pairs whose positions are equal, so the maximum position still lands last
    // either way (98 000 random arrays up to length 50, zero divergence) — the
    // `<=` mutant on this comparator is unobservable.
    it('appends after the highest view position, not the last one in the array', () => {
      const model = new DatabaseModel({
        schema: [],
        views: [
          makeView({ id: 'v1', position: 'a1' }),
          makeView({ id: 'v2', position: 'a2' }),
          makeView({ id: 'v3', position: 'a0' }),
        ],
        activeViewId: 'v1',
      });

      expect(model.addView('Table', 'table')).toStrictEqual({
        id: expect.any(String),
        name: 'Table',
        type: 'table',
        position: 'a3',
        groupBy: undefined,
        sorts: [],
        filters: [],
        visibleProperties: [],
      });
    });

    it('starts a fresh key run once every view has been deleted', () => {
      const model = new DatabaseModel();

      for (const view of model.getViews()) {
        model.deleteView(view.id);
      }
      expect(model.getViews()).toStrictEqual([]);

      const create = (): DatabaseViewConfig => model.addView('Board', 'board');

      expect(create).not.toThrow();
      expect(model.getViews()).toStrictEqual([
        {
          id: expect.any(String),
          name: 'Board',
          type: 'board',
          position: 'a0',
          groupBy: undefined,
          sorts: [],
          filters: [],
          visibleProperties: [],
        },
      ]);
    });
  });

  describe('updateView', () => {
    const twoViews = (): DatabaseModel => new DatabaseModel({
      schema: [],
      views: [
        makeView({ id: 'v1', name: 'One', position: 'a0' }),
        makeView({ id: 'v2', name: 'Two', position: 'a1' }),
      ],
      activeViewId: 'v1',
    });

    it('leaves every view untouched when the id matches nothing', () => {
      const model = twoViews();

      expect(() => model.updateView('missing', { name: 'Renamed' })).not.toThrow();
      expect(model.getViews()).toStrictEqual([
        makeView({ id: 'v1', name: 'One', position: 'a0' }),
        makeView({ id: 'v2', name: 'Two', position: 'a1' }),
      ]);
    });

    it('updates only the addressed view', () => {
      const model = twoViews();

      model.updateView('v2', { name: 'Renamed' });

      expect(model.getViews()).toStrictEqual([
        makeView({ id: 'v1', name: 'One', position: 'a0' }),
        makeView({ id: 'v2', name: 'Renamed', position: 'a1' }),
      ]);
    });
  });

  describe('positionBetween', () => {
    it('rejects out-of-order keys instead of letting the library swap them', () => {
      expect(() => DatabaseModel.positionBetween('a2', 'a1')).toThrowError(
        new Error('DatabaseModel.positionBetween: keys out of order (a2 >= a1)')
      );
    });

    it('rejects two equal keys', () => {
      expect(() => DatabaseModel.positionBetween('a1', 'a1')).toThrowError(
        new Error('DatabaseModel.positionBetween: keys out of order (a1 >= a1)')
      );
    });

    it('generates the first key when both neighbours are null', () => {
      expect(DatabaseModel.positionBetween(null, null)).toBe('a0');
    });

    // `'0' >= null` and `null >= '0'` are both true under numeric coercion, so a
    // guard that stops requiring BOTH neighbours claims an ordering fault on a
    // key the library alone should reject.
    it('leaves an invalid trailing neighbour to the library', () => {
      expect(() => DatabaseModel.positionBetween('0', null)).toThrowError(
        new Error('invalid order key head: 0')
      );
    });

    it('leaves an invalid leading neighbour to the library', () => {
      expect(() => DatabaseModel.positionBetween(null, '0')).toThrowError(
        new Error('invalid order key head: 0')
      );
    });
  });
});
