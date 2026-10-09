import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GROUPABLE_TYPES,
  defaultGroupSort,
  groupKeysFor,
  groupValueForKey,
  orderGroupKeys,
} from '../../../../src/tools/database/group-keys';
import { NO_VALUE_GROUP_KEY } from '../../../../src/tools/database/database-model';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const NOW = new Date(2026, 9, 9, 12, 0);

const prop = (type: PropertyDefinition['type'], extra: Partial<PropertyDefinition> = {}): PropertyDefinition =>
  ({ id: 'p', name: 'P', type, position: 'a0', ...extra });

const select = prop('select', {
  config: {
    options: [
      { id: 'o-b', label: 'Banana', position: 'a0' },
      { id: 'o-a', label: 'apple', position: 'a1' },
      { id: 'o-c', label: 'Cherry', position: 'a2' },
    ],
  },
});

describe('group-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cannot group by rich text', () => {
    expect(GROUPABLE_TYPES).not.toContain('richText');
    expect(GROUPABLE_TYPES).toContain('date');
  });

  describe('keys', () => {
    it('puts an empty value in the no-value group', () => {
      expect(groupKeysFor(prop('text'), '', {}, NOW)).toEqual([NO_VALUE_GROUP_KEY]);
      expect(groupKeysFor(prop('number'), null, {}, NOW)).toEqual([NO_VALUE_GROUP_KEY]);
      expect(groupKeysFor(prop('date'), undefined, {}, NOW)).toEqual([NO_VALUE_GROUP_KEY]);
    });

    it('groups a select by option and a multi-select by every option', () => {
      expect(groupKeysFor(select, 'o-a', {}, NOW)).toEqual(['o-a']);
      expect(groupKeysFor(prop('multiSelect'), ['x', 'y'], {}, NOW)).toEqual(['x', 'y']);
    });

    it('groups a checkbox into checked and unchecked, a missing value unchecked', () => {
      expect(groupKeysFor(prop('checkbox'), true, {}, NOW)).toEqual(['true']);
      expect(groupKeysFor(prop('checkbox'), undefined, {}, NOW)).toEqual(['false']);
    });

    it.each([
      ['day', '2026-10-12', 'day:2026-10-12'],
      ['week', '2026-10-09', 'week:2026-10-04'],
      ['month', '2026-10-31T10:00', 'month:2026-10'],
      ['year', '2026-01-01', 'year:2026'],
    ] as const)('groups a date by %s', (dateBy, value, key) => {
      expect(groupKeysFor(prop('date'), value, { dateBy }, NOW)).toEqual([key]);
    });

    it('starts a week on Monday when asked', () => {
      expect(groupKeysFor(prop('date'), '2026-10-04', { dateBy: 'week', weekStart: 1 }, NOW)).toEqual(['week:2026-09-28']);
    });

    it.each([
      ['2026-10-09', 'rel:today'],
      ['2026-10-03', 'rel:last_7_days'],
      ['2026-10-12', 'rel:next_7_days'],
      ['2026-10-20', 'rel:next_30_days'],
      ['2026-09-20', 'rel:last_30_days'],
      ['2026-12-25', 'month:2026-12'],
    ])('groups %s relative to today as %s', (value, key) => {
      expect(groupKeysFor(prop('date'), value, {}, NOW)).toEqual([key]);
    });

    it('groups numbers by value or by range', () => {
      expect(groupKeysFor(prop('number'), 35.5, {}, NOW)).toEqual(['35.5']);
      expect(groupKeysFor(prop('number'), 135, { numberBy: 'range' }, NOW)).toEqual(['range:100']);
      expect(groupKeysFor(prop('number'), 135, { numberBy: 'range', rangeStart: 0, rangeEnd: 100, rangeSize: 10 }, NOW)).toEqual(['range:above']);
      expect(groupKeysFor(prop('number'), -5, { numberBy: 'range' }, NOW)).toEqual(['range:below']);
    });

    it('groups text by the whole value or its first letter', () => {
      expect(groupKeysFor(prop('text'), 'banana', {}, NOW)).toEqual(['banana']);
      expect(groupKeysFor(prop('text'), 'banana', { textBy: 'alphabet' }, NOW)).toEqual(['alpha:B']);
      expect(groupKeysFor(prop('text'), '42 things', { textBy: 'alphabet' }, NOW)).toEqual(['alpha:#']);
    });
  });

  describe('order', () => {
    it('orders select groups by option, label or reverse label, the no-value group last', () => {
      const keys = [NO_VALUE_GROUP_KEY, 'o-c', 'o-a', 'o-b'];

      expect(orderGroupKeys(select, keys, {})).toEqual(['o-b', 'o-a', 'o-c', NO_VALUE_GROUP_KEY]);
      expect(orderGroupKeys(select, keys, { sort: 'ascending' })).toEqual(['o-a', 'o-b', 'o-c', NO_VALUE_GROUP_KEY]);
      expect(orderGroupKeys(select, keys, { sort: 'descending' })).toEqual(['o-c', 'o-b', 'o-a', NO_VALUE_GROUP_KEY]);
    });

    it('puts the no-value group first for number, text and date', () => {
      expect(orderGroupKeys(prop('number'), ['10', NO_VALUE_GROUP_KEY, '-2'], {})).toEqual([NO_VALUE_GROUP_KEY, '-2', '10']);
      expect(orderGroupKeys(prop('number'), ['10', '-2'], { sort: 'descending' })).toEqual(['10', '-2']);
      expect(orderGroupKeys(prop('date'), ['rel:next_7_days', 'rel:today', 'month:2026-01', 'rel:last_7_days'], {}))
        .toEqual(['month:2026-01', 'rel:last_7_days', 'rel:today', 'rel:next_7_days']);
      expect(orderGroupKeys(prop('text'), ['b', 'a'], {})).toEqual(['b', 'a']);
      expect(orderGroupKeys(prop('text'), ['b', 'a'], { sort: 'ascending' })).toEqual(['a', 'b']);
    });

    it('gives each type its Notion default sort', () => {
      expect(defaultGroupSort('select')).toBe('manual');
      expect(defaultGroupSort('date')).toBe('ascending');
      expect(defaultGroupSort('number')).toBe('ascending');
      expect(defaultGroupSort('text')).toBe('manual');
    });
  });

  describe('value of a group', () => {
    it('gives the value a row takes in an exact group, nothing for a bucket', () => {
      expect(groupValueForKey(select, 'o-a', {})).toBe('o-a');
      expect(groupValueForKey(prop('checkbox'), 'true', {})).toBe(true);
      expect(groupValueForKey(prop('number'), '7', {})).toBe(7);
      expect(groupValueForKey(prop('text'), 'x', {})).toBe('x');
      expect(groupValueForKey(prop('date'), 'day:2026-10-12', { dateBy: 'day' })).toBe('2026-10-12');
      expect(groupValueForKey(prop('date'), 'rel:today', {})).toBeUndefined();
      expect(groupValueForKey(prop('number'), 'range:100', { numberBy: 'range' })).toBeUndefined();
      expect(groupValueForKey(prop('text'), NO_VALUE_GROUP_KEY, {})).toBeNull();
    });
  });
});
