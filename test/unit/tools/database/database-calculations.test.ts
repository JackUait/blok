import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CALCULATIONS_FOR_TYPE, computeCalculation } from '../../../../src/tools/database/database-calculations';
import type { PropertyDefinition, PropertyType, PropertyValue } from '../../../../src/tools/database/types';

const prop = (type: PropertyType): PropertyDefinition => ({ id: `p-${type}`, name: type, type, position: 'a0' });

const text = prop('text');
const num = prop('number');
const date = prop('date');
const box = prop('checkbox');
const multi = prop('multiSelect');

const texts: Array<PropertyValue | undefined> = ['a', '', 'b', null, undefined, 'a'];
const numbers: Array<PropertyValue | undefined> = [4, null, 1, 10, undefined, 5];
const dates: Array<PropertyValue | undefined> = ['2026-03-01', '', '2026-01-15', '2026-02-01T10:00:00Z', 'not a date'];
const boxes: Array<PropertyValue | undefined> = [true, false, undefined, true];

describe('computeCalculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('count: every row, empty ones included', () => {
    expect(computeCalculation('count', texts, text)).toEqual({ kind: 'number', value: 6 });
  });

  it('count_values: each value of a multi-select counts', () => {
    expect(computeCalculation('count_values', texts, text)).toEqual({ kind: 'number', value: 3 });
    expect(computeCalculation('count_values', [['o1', 'o2'], [], ['o1']], multi)).toEqual({ kind: 'number', value: 3 });
  });

  it('unique: distinct values, multi-select items counted one by one', () => {
    expect(computeCalculation('unique', texts, text)).toEqual({ kind: 'number', value: 2 });
    expect(computeCalculation('unique', [['o1', 'o2'], ['o1'], null], multi)).toEqual({ kind: 'number', value: 2 });
  });

  it('empty and not_empty: an empty string, null, a missing value and an empty list are empty', () => {
    expect(computeCalculation('empty', texts, text)).toEqual({ kind: 'number', value: 3 });
    expect(computeCalculation('not_empty', texts, text)).toEqual({ kind: 'number', value: 3 });
    expect(computeCalculation('empty', [[], ['o1']], multi)).toEqual({ kind: 'number', value: 1 });
  });

  it('percent_empty and percent_not_empty: share of all rows, 0 when there are none', () => {
    expect(computeCalculation('percent_empty', ['a', '', null, 'b'], text)).toEqual({ kind: 'percent', value: 50 });
    expect(computeCalculation('percent_not_empty', ['a', '', 'b', 'c'], text)).toEqual({ kind: 'percent', value: 75 });
    expect(computeCalculation('percent_empty', [], text)).toEqual({ kind: 'percent', value: 0 });
  });

  it('sum skips empty cells', () => {
    expect(computeCalculation('sum', numbers, num)).toEqual({ kind: 'number', value: 20 });
  });

  it('average divides by the cells that hold a number', () => {
    expect(computeCalculation('average', numbers, num)).toEqual({ kind: 'number', value: 5 });
  });

  it('median: middle value, or the mean of the two middle values', () => {
    expect(computeCalculation('median', [3, 1, 2], num)).toEqual({ kind: 'number', value: 2 });
    expect(computeCalculation('median', numbers, num)).toEqual({ kind: 'number', value: 4.5 });
  });

  it('min, max and range', () => {
    expect(computeCalculation('min', numbers, num)).toEqual({ kind: 'number', value: 1 });
    expect(computeCalculation('max', numbers, num)).toEqual({ kind: 'number', value: 10 });
    expect(computeCalculation('range', numbers, num)).toEqual({ kind: 'number', value: 9 });
  });

  it('number functions have nothing to show when no cell holds a number', () => {
    expect(computeCalculation('sum', [null, undefined], num)).toEqual({ kind: 'none' });
    expect(computeCalculation('average', [], num)).toEqual({ kind: 'none' });
    expect(computeCalculation('median', [], num)).toEqual({ kind: 'none' });
    expect(computeCalculation('min', [], num)).toEqual({ kind: 'none' });
    expect(computeCalculation('max', [], num)).toEqual({ kind: 'none' });
    expect(computeCalculation('range', [], num)).toEqual({ kind: 'none' });
  });

  it('reads a number stored as a numeric string', () => {
    expect(computeCalculation('sum', ['2', 3, 'x'], num)).toEqual({ kind: 'number', value: 5 });
  });

  it('earliest_date and latest_date return the stored value, skipping what does not parse', () => {
    expect(computeCalculation('earliest_date', dates, date)).toEqual({ kind: 'date', value: '2026-01-15' });
    expect(computeCalculation('latest_date', dates, date)).toEqual({ kind: 'date', value: '2026-03-01' });
  });

  it('date_range spans earliest to latest', () => {
    expect(computeCalculation('date_range', dates, date)).toEqual({ kind: 'dateRange', start: '2026-01-15', end: '2026-03-01' });
  });

  it('date functions have nothing to show without a date', () => {
    expect(computeCalculation('earliest_date', ['', null], date)).toEqual({ kind: 'none' });
    expect(computeCalculation('latest_date', [], date)).toEqual({ kind: 'none' });
    expect(computeCalculation('date_range', [], date)).toEqual({ kind: 'none' });
  });

  it('checked and unchecked: a missing value is unchecked', () => {
    expect(computeCalculation('checked', boxes, box)).toEqual({ kind: 'number', value: 2 });
    expect(computeCalculation('unchecked', boxes, box)).toEqual({ kind: 'number', value: 2 });
  });

  it('percent_checked and percent_unchecked', () => {
    expect(computeCalculation('percent_checked', [true, false, false, false], box)).toEqual({ kind: 'percent', value: 25 });
    expect(computeCalculation('percent_unchecked', [true, false, false, false], box)).toEqual({ kind: 'percent', value: 75 });
    expect(computeCalculation('percent_checked', [], box)).toEqual({ kind: 'percent', value: 0 });
  });

  it('treats rich text with no blocks as empty', () => {
    const rich = prop('richText');

    expect(computeCalculation('empty', [{ blocks: [] }, { blocks: [{ type: 'paragraph', data: { text: 'x' } }] }], rich)).toEqual({ kind: 'number', value: 1 });
  });
});

describe('CALCULATIONS_FOR_TYPE', () => {
  const generic = ['count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty'];

  it('offers the generic counts on text-like columns only', () => {
    for (const type of ['title', 'text', 'richText', 'select', 'multiSelect', 'url'] as const) {
      expect(CALCULATIONS_FOR_TYPE[type]).toEqual(generic);
    }
  });

  it('adds the number functions on number columns', () => {
    expect(CALCULATIONS_FOR_TYPE.number).toEqual([...generic, 'sum', 'average', 'median', 'min', 'max', 'range']);
  });

  it('adds the date functions on date columns', () => {
    expect(CALCULATIONS_FOR_TYPE.date).toEqual([...generic, 'earliest_date', 'latest_date', 'date_range']);
  });

  it('offers the checked functions on checkbox columns and nowhere else', () => {
    expect(CALCULATIONS_FOR_TYPE.checkbox).toEqual(['count', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked']);

    const others = Object.entries(CALCULATIONS_FOR_TYPE).filter(([type]) => type !== 'checkbox');

    for (const [, fns] of others) {
      expect(fns).not.toContain('checked');
    }
  });
});
