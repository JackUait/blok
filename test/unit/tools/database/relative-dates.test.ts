import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRelativeSpan, relativeWindow } from '../../../../src/tools/database/relative-dates';
import { matchCondition } from '../../../../src/tools/database/database-query';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

// Thursday 2026-10-22, local time.
const now = new Date(2026, 9, 22, 12);

const schema: PropertyDefinition[] = [{ id: 'due', name: 'Due', type: 'date', position: 'a0' }];

const row = (due: string): DatabaseRow => ({ id: 'r', position: 'a0', properties: { due } });

describe('relative dates (Notion "Is relative to today" and "Is between")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a "this" span: the current day, week, month or year', () => {
    expect(parseRelativeSpan('this:1:month')).toEqual({ direction: 'this', count: 1, unit: 'month' });
    expect(relativeWindow('relative_to_today', 'this:1:day', now)).toEqual({ from: '2026-10-22', to: '2026-10-22' });
    expect(relativeWindow('relative_to_today', 'this:1:week', now)).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(relativeWindow('relative_to_today', 'this:1:month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(relativeWindow('relative_to_today', 'this:1:year', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('reads "is between" as the inclusive window of a stored date range', () => {
    expect(relativeWindow('is_between', '2026-10-01/2026-10-07', now)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(relativeWindow('is_between', '2026-10-07/2026-10-01', now)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(relativeWindow('is_between', 'today', now)).toBeUndefined();
  });

  it('filters rows with "is between" and lets every row through while the range is unset', () => {
    const between = { propertyId: 'due', operator: 'is_between', value: '2026-10-01/2026-10-07' };

    expect(matchCondition(row('2026-10-03'), between, schema, now)).toBe(true);
    expect(matchCondition(row('2026-10-09'), between, schema, now)).toBe(false);
    expect(matchCondition(row('2026-10-09'), { ...between, value: null }, schema, now)).toBeUndefined();
  });

  it('keeps old saved filters working: "is not" a day and "within" a window', () => {
    expect(matchCondition(row('2026-10-22'), { propertyId: 'due', operator: 'does_not_equal', value: 'today' }, schema, now)).toBe(false);
    expect(matchCondition(row('2026-10-21'), { propertyId: 'due', operator: 'does_not_equal', value: 'today' }, schema, now)).toBe(true);
    expect(matchCondition(row('2026-10-01'), { propertyId: 'due', operator: 'past_month', value: null }, schema, now)).toBe(true);
    expect(matchCondition(row('2026-08-01'), { propertyId: 'due', operator: 'past_month', value: null }, schema, now)).toBe(false);
  });
});
