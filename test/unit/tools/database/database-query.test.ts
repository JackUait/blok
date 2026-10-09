import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FILTER_OPERATORS,
  queryGroups,
  queryRows,
  rowMatchesFilters,
  sortRows,
} from '../../../../src/tools/database/database-query';
import type { QuerySource } from '../../../../src/tools/database/database-query';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import type {
  DatabaseRow,
  DatabaseViewConfig,
  FilterConfig,
  PropertyDefinition,
  PropertyValue,
  SortConfig,
} from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'text', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'num', name: 'Score', type: 'number', position: 'a2' },
  {
    id: 'status', name: 'Status', type: 'select', position: 'a3', config: {
      options: [
        { id: 'opt-late', label: 'Late', position: 'a2' },
        { id: 'opt-early', label: 'Early', position: 'a0' },
        { id: 'opt-mid', label: 'Mid', position: 'a1' },
      ],
    },
  },
  {
    id: 'tags', name: 'Tags', type: 'multiSelect', position: 'a4', config: {
      options: [
        { id: 'tag-b', label: 'B', position: 'a1' },
        { id: 'tag-a', label: 'A', position: 'a0' },
      ],
    },
  },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a5' },
  { id: 'due', name: 'Due', type: 'date', position: 'a6' },
  { id: 'link', name: 'Link', type: 'url', position: 'a7' },
  { id: 'body', name: 'Body', type: 'richText', position: 'a8' },
];

const row = (id: string, position: string, properties: Record<string, PropertyValue> = {}): DatabaseRow => ({
  id,
  position,
  properties,
});

const ids = (rows: DatabaseRow[]): string[] => rows.map((r) => r.id);

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v',
  name: 'V',
  type: 'list',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

const matches = (r: DatabaseRow, filter: FilterConfig): boolean => rowMatchesFilters(r, [filter], schema);

describe('database-query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FILTER_OPERATORS', () => {
    it('lists the Notion API operator names per property type', () => {
      expect(FILTER_OPERATORS.text).toEqual([
        'equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
      ]);
      expect(FILTER_OPERATORS.title).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.url).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.richText).toEqual(FILTER_OPERATORS.text);
      expect(FILTER_OPERATORS.number).toEqual([
        'equals', 'does_not_equal', 'greater_than', 'greater_than_or_equal_to', 'less_than', 'less_than_or_equal_to', 'is_empty', 'is_not_empty',
      ]);
      expect(FILTER_OPERATORS.select).toEqual(['equals', 'does_not_equal', 'is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.multiSelect).toEqual(['contains', 'does_not_contain', 'is_empty', 'is_not_empty']);
      expect(FILTER_OPERATORS.checkbox).toEqual(['equals', 'does_not_equal']);
      expect(FILTER_OPERATORS.date).toEqual(['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty']);
    });
  });

  describe('rowMatchesFilters — text', () => {
    const r = row('r', 'a0', { text: 'Hello World' });

    it.each([
      ['equals', 'hello world', true],
      ['equals', 'hello', false],
      ['does_not_equal', 'hello', true],
      ['does_not_equal', 'HELLO WORLD', false],
      ['contains', 'LO wo', true],
      ['contains', 'xyz', false],
      ['does_not_contain', 'xyz', true],
      ['does_not_contain', 'world', false],
      ['starts_with', 'hel', true],
      ['starts_with', 'world', false],
      ['ends_with', 'WORLD', true],
      ['ends_with', 'hello', false],
    ])('%s %s → %s (case-insensitive)', (operator, value, expected) => {
      expect(matches(r, { propertyId: 'text', operator, value })).toBe(expected);
    });

    it('treats a missing or blank value as empty', () => {
      const blank = row('b', 'a0', { text: '' });
      const missing = row('m', 'a0');

      expect(matches(blank, { propertyId: 'text', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(missing, { propertyId: 'text', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'text', operator: 'is_empty', value: null })).toBe(false);
      expect(matches(r, { propertyId: 'text', operator: 'is_not_empty', value: null })).toBe(true);
      expect(matches(missing, { propertyId: 'text', operator: 'is_not_empty', value: null })).toBe(false);
    });

    it('applies text operators to title and url', () => {
      const r2 = row('r2', 'a0', { title: 'Launch plan', link: 'https://example.com' });

      expect(matches(r2, { propertyId: 'title', operator: 'contains', value: 'PLAN' })).toBe(true);
      expect(matches(r2, { propertyId: 'link', operator: 'ends_with', value: '.com' })).toBe(true);
    });

    it('lets a text filter with no value through, so a half-built filter hides nothing', () => {
      expect(matches(r, { propertyId: 'text', operator: 'contains', value: '' })).toBe(true);
      expect(matches(r, { propertyId: 'text', operator: 'equals', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — richText', () => {
    it('matches a string value as text', () => {
      expect(matches(row('r', 'a0', { body: 'Some notes' }), { propertyId: 'body', operator: 'contains', value: 'notes' })).toBe(true);
    });

    it('counts a body document with no blocks as empty and one with blocks as not empty', () => {
      const emptyDoc = row('e', 'a0', { body: { blocks: [] } });
      const fullDoc = row('f', 'a0', { body: { blocks: [{ type: 'paragraph', data: { text: 'x' } }] } });

      expect(matches(emptyDoc, { propertyId: 'body', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(fullDoc, { propertyId: 'body', operator: 'is_empty', value: null })).toBe(false);
      expect(matches(fullDoc, { propertyId: 'body', operator: 'is_not_empty', value: null })).toBe(true);
    });

    it('lets text operators through on a body document, which has no plain text yet', () => {
      const fullDoc = row('f', 'a0', { body: { blocks: [{ type: 'paragraph', data: { text: 'x' } }] } });

      expect(matches(fullDoc, { propertyId: 'body', operator: 'contains', value: 'zzz' })).toBe(true);
    });
  });

  describe('rowMatchesFilters — number', () => {
    const r = row('r', 'a0', { num: 5 });

    it.each([
      ['equals', 5, true],
      ['equals', '5', true],
      ['equals', 4, false],
      ['does_not_equal', 4, true],
      ['greater_than', 4, true],
      ['greater_than', 5, false],
      ['greater_than_or_equal_to', 5, true],
      ['less_than', 6, true],
      ['less_than', 5, false],
      ['less_than_or_equal_to', 5, true],
      ['less_than_or_equal_to', 4, false],
    ])('%s %s → %s', (operator, value, expected) => {
      expect(matches(r, { propertyId: 'num', operator, value })).toBe(expected);
    });

    it('treats a blank string as empty, not as 0', () => {
      const blank = row('b', 'a0', { num: '' });

      expect(matches(blank, { propertyId: 'num', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(blank, { propertyId: 'num', operator: 'equals', value: 0 })).toBe(false);
      expect(matches(row('z', 'a0', { num: 0 }), { propertyId: 'num', operator: 'is_empty', value: null })).toBe(false);
    });

    it('lets a number filter with a blank or non-numeric value through', () => {
      expect(matches(r, { propertyId: 'num', operator: 'equals', value: '' })).toBe(true);
      expect(matches(r, { propertyId: 'num', operator: 'greater_than', value: 'abc' })).toBe(true);
    });
  });

  describe('rowMatchesFilters — select', () => {
    const r = row('r', 'a0', { status: 'opt-mid' });

    it('equals and does_not_equal compare the option id', () => {
      expect(matches(r, { propertyId: 'status', operator: 'equals', value: 'opt-mid' })).toBe(true);
      expect(matches(r, { propertyId: 'status', operator: 'equals', value: 'opt-late' })).toBe(false);
      expect(matches(r, { propertyId: 'status', operator: 'does_not_equal', value: 'opt-late' })).toBe(true);
    });

    it('accepts a list of option ids as any-match', () => {
      expect(matches(r, { propertyId: 'status', operator: 'equals', value: ['opt-late', 'opt-mid'] })).toBe(true);
      expect(matches(r, { propertyId: 'status', operator: 'does_not_equal', value: ['opt-late', 'opt-mid'] })).toBe(false);
    });

    it('is_empty matches a row with no option', () => {
      expect(matches(row('e', 'a0'), { propertyId: 'status', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'status', operator: 'is_not_empty', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — multiSelect', () => {
    const r = row('r', 'a0', { tags: ['tag-a'] });

    it('contains and does_not_contain take one id or a list (any-match)', () => {
      expect(matches(r, { propertyId: 'tags', operator: 'contains', value: 'tag-a' })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'contains', value: ['tag-b', 'tag-a'] })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'contains', value: 'tag-b' })).toBe(false);
      expect(matches(r, { propertyId: 'tags', operator: 'does_not_contain', value: 'tag-b' })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'does_not_contain', value: 'tag-a' })).toBe(false);
    });

    it('is_empty matches an empty or missing list', () => {
      expect(matches(row('e', 'a0', { tags: [] }), { propertyId: 'tags', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(row('m', 'a0'), { propertyId: 'tags', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'tags', operator: 'is_not_empty', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — checkbox', () => {
    it('reads a missing value as unchecked', () => {
      expect(matches(row('m', 'a0'), { propertyId: 'done', operator: 'equals', value: false })).toBe(true);
      expect(matches(row('t', 'a0', { done: true }), { propertyId: 'done', operator: 'equals', value: true })).toBe(true);
      expect(matches(row('t', 'a0', { done: true }), { propertyId: 'done', operator: 'does_not_equal', value: true })).toBe(false);
    });
  });

  describe('rowMatchesFilters — date', () => {
    const r = row('r', 'a0', { due: '2026-10-09T15:00:00.000Z' });

    it.each([
      ['equals', '2026-10-09', true],
      ['equals', '2026-10-10', false],
      ['before', '2026-10-10', true],
      ['before', '2026-10-09', false],
      ['after', '2026-10-08', true],
      ['after', '2026-10-09', false],
      ['on_or_before', '2026-10-09', true],
      ['on_or_after', '2026-10-09', true],
      ['on_or_after', '2026-10-10', false],
    ])('%s %s → %s (compares the calendar day)', (operator, value, expected) => {
      expect(matches(r, { propertyId: 'due', operator, value })).toBe(expected);
    });

    it('is_empty matches a row with no date', () => {
      expect(matches(row('e', 'a0'), { propertyId: 'due', operator: 'is_empty', value: null })).toBe(true);
      expect(matches(r, { propertyId: 'due', operator: 'is_not_empty', value: null })).toBe(true);
    });
  });

  describe('rowMatchesFilters — forward compatibility', () => {
    const r = row('r', 'a0', { text: 'abc', status: 'opt-mid' });

    it('lets a row through an operator it does not know', () => {
      expect(matches(r, { propertyId: 'text', operator: 'matches_regex', value: 'zzz' })).toBe(true);
    });

    it('lets a row through an operator that does not fit the property type', () => {
      expect(matches(r, { propertyId: 'status', operator: 'greater_than', value: 'zzz' })).toBe(true);
    });

    it('lets a row through a filter on a deleted property', () => {
      expect(matches(r, { propertyId: 'gone', operator: 'equals', value: 'zzz' })).toBe(true);
    });

    it('combines filters with AND', () => {
      const filters: FilterConfig[] = [
        { propertyId: 'text', operator: 'contains', value: 'a' },
        { propertyId: 'status', operator: 'equals', value: 'opt-late' },
      ];

      expect(rowMatchesFilters(r, filters, schema)).toBe(false);
      expect(rowMatchesFilters(r, [filters[0]], schema)).toBe(true);
    });
  });

  describe('sortRows', () => {
    const sort = (rows: DatabaseRow[], sorts: SortConfig[]): string[] => ids(sortRows(rows, sorts, schema));

    it('keeps position order when there are no sorts, comparing like getOrderedRows', () => {
      const rows = [row('b', 'a1'), row('c', 'Zz'), row('a', 'a0')];
      const model = new DatabaseModel({ schema });

      model.setRows(rows);

      expect(sort(rows, [])).toEqual(ids(model.getOrderedRows()));
    });

    it('sorts numbers numerically in both directions', () => {
      const rows = [row('ten', 'a0', { num: 10 }), row('two', 'a1', { num: 2 }), row('five', 'a2', { num: 5 })];

      expect(sort(rows, [{ propertyId: 'num', direction: 'asc' }])).toEqual(['two', 'five', 'ten']);
      expect(sort(rows, [{ propertyId: 'num', direction: 'desc' }])).toEqual(['ten', 'five', 'two']);
    });

    it('puts empty values last in both directions', () => {
      const rows = [row('empty', 'a0', { num: '' }), row('two', 'a1', { num: 2 }), row('none', 'a2'), row('five', 'a3', { num: 5 })];

      expect(sort(rows, [{ propertyId: 'num', direction: 'asc' }])).toEqual(['two', 'five', 'empty', 'none']);
      expect(sort(rows, [{ propertyId: 'num', direction: 'desc' }])).toEqual(['five', 'two', 'empty', 'none']);
    });

    it('sorts text alphabetically', () => {
      const rows = [row('b', 'a0', { title: 'banana' }), row('a', 'a1', { title: 'Apple' }), row('c', 'a2', { title: 'cherry' })];

      expect(sort(rows, [{ propertyId: 'title', direction: 'asc' }])).toEqual(['a', 'b', 'c']);
    });

    it('sorts select by option order, not by label or id', () => {
      const rows = [row('late', 'a0', { status: 'opt-late' }), row('early', 'a1', { status: 'opt-early' }), row('mid', 'a2', { status: 'opt-mid' })];

      expect(sort(rows, [{ propertyId: 'status', direction: 'asc' }])).toEqual(['early', 'mid', 'late']);
      expect(sort(rows, [{ propertyId: 'status', direction: 'desc' }])).toEqual(['late', 'mid', 'early']);
    });

    it('sorts multiSelect by its options in option order', () => {
      const rows = [row('b', 'a0', { tags: ['tag-b'] }), row('ab', 'a1', { tags: ['tag-b', 'tag-a'] }), row('a', 'a2', { tags: ['tag-a'] })];

      expect(sort(rows, [{ propertyId: 'tags', direction: 'asc' }])).toEqual(['a', 'ab', 'b']);
    });

    it('sorts checkbox unchecked first when ascending', () => {
      const rows = [row('on', 'a0', { done: true }), row('off', 'a1', { done: false })];

      expect(sort(rows, [{ propertyId: 'done', direction: 'asc' }])).toEqual(['off', 'on']);
    });

    it('applies sorts in list order and breaks ties on position', () => {
      const rows = [
        row('x', 'a3', { status: 'opt-mid', num: 1 }),
        row('y', 'a2', { status: 'opt-early', num: 9 }),
        row('z', 'a1', { status: 'opt-mid', num: 1 }),
        row('w', 'a0', { status: 'opt-mid', num: 7 }),
      ];

      expect(sort(rows, [
        { propertyId: 'status', direction: 'asc' },
        { propertyId: 'num', direction: 'desc' },
      ])).toEqual(['y', 'w', 'z', 'x']);
    });

    it('ignores a sort on a deleted property', () => {
      const rows = [row('b', 'a1'), row('a', 'a0')];

      expect(sort(rows, [{ propertyId: 'gone', direction: 'desc' }])).toEqual(['a', 'b']);
    });

    it('does not reorder the input array', () => {
      const rows = [row('b', 'a1'), row('a', 'a0')];

      sortRows(rows, [], schema);

      expect(ids(rows)).toEqual(['b', 'a']);
    });
  });

  describe('queryRows / queryGroups', () => {
    const rows = [
      row('r1', 'a0', { status: 'opt-early', num: 3 }),
      row('r2', 'a1', { status: 'opt-late', num: 1 }),
      row('r3', 'a2', { status: 'opt-early', num: 2 }),
      row('r4', 'a3', { num: 9 }),
    ];
    const source: QuerySource = {
      schema,
      rows,
      groupKeysOf: (r) => [typeof r.properties.status === 'string' ? r.properties.status : ''],
    };

    it('returns every row in position order for a plain view, with a total', () => {
      const result = queryRows(source, { view: view() });

      expect(ids(result.rows)).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect(result.total).toBe(4);
      expect(result.nextCursor).toBeUndefined();
    });

    it('filters, then sorts', () => {
      const result = queryRows(source, {
        view: view({
          filters: [{ propertyId: 'num', operator: 'less_than', value: 5 }],
          sorts: [{ propertyId: 'num', direction: 'asc' }],
        }),
      });

      expect(ids(result.rows)).toEqual(['r2', 'r3', 'r1']);
      expect(result.total).toBe(3);
    });

    it('returns one group after filtering', () => {
      const result = queryRows(source, {
        view: view({ filters: [{ propertyId: 'num', operator: 'greater_than', value: 2 }] }),
        group: 'opt-early',
      });

      expect(ids(result.rows)).toEqual(['r1']);
    });

    it('pages with limit and cursor', () => {
      const first = queryRows(source, { view: view(), limit: 3 });

      expect(ids(first.rows)).toEqual(['r1', 'r2', 'r3']);
      expect(first.nextCursor).toBeDefined();

      const second = queryRows(source, { view: view(), limit: 3, cursor: first.nextCursor });

      expect(ids(second.rows)).toEqual(['r4']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('counts groups after filtering, without returning rows', () => {
      const groups = queryGroups(source, view({ filters: [{ propertyId: 'num', operator: 'less_than', value: 3 }] }));

      expect(groups).toEqual([
        { key: 'opt-late', count: 1 },
        { key: 'opt-early', count: 1 },
      ]);
    });

    it('counts a row under every key it reports', () => {
      const multi: QuerySource = { ...source, groupKeysOf: () => ['k1', 'k2'] };

      expect(queryGroups(multi, view())).toEqual([
        { key: 'k1', count: 4 },
        { key: 'k2', count: 4 },
      ]);
    });
  });
});
