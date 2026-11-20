import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { groupLabel } from '../../../../src/tools/database/database-group-labels';
import { groupKeysFor } from '../../../../src/tools/database/group-keys';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const i18n = { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`) };
const amount: PropertyDefinition = { id: 'p-amount', name: 'Amount', type: 'number', position: 'a0' };

describe('groupLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // notion-motion.md Round 84b §3 (r84-n-grp-month.raw): Date by Month reads "Oct 2026".
  it('names a month group with the short month name in the editor locale', () => {
    const date: PropertyDefinition = { id: 'p-due', name: 'Due', type: 'date', position: 'a0' };

    expect(groupLabel(date, 'month:2026-10', { ...i18n, getLocale: () => 'en-US' }, { dateBy: 'month' })).toBe('Oct 2026');
    expect(groupLabel(date, 'month:2026-10', { ...i18n, getLocale: () => 'de' }, { dateBy: 'month' }))
      .toBe(new Intl.DateTimeFormat('de', { month: 'short', year: 'numeric' }).format(new Date(2026, 9, 1)));
  });

  // r84-n-grp-Date.raw: Date by Relative named a date past the last 30 days "Oct 2026" too.
  it('names a relative date past the last 30 days by its short month', () => {
    const date: PropertyDefinition = { id: 'p-due', name: 'Due', type: 'date', position: 'a0' };
    const [key] = groupKeysFor(date, '2026-10-15', {}, new Date(2026, 10, 20, 12));

    expect(groupLabel(date, key, { ...i18n, getLocale: () => 'en-US' })).toBe('Oct 2026');
  });

  // research/22 §7: Notion names number buckets "0 to 100", "900 to 1000".
  it('names a number range bucket "<start> to <end>"', () => {
    expect(groupLabel(amount, 'range:0', i18n, { numberBy: 'range' })).toBe('tools.database.groupRangeBucket:{"start":"0","end":"100"}');
    expect(groupLabel(amount, 'range:900', i18n, { numberBy: 'range', rangeSize: 100 })).toBe('tools.database.groupRangeBucket:{"start":"900","end":"1000"}');
  });

  // research/23 §2d: values below the start and past the last bucket share one group.
  it('names the one group outside the range "Out of range"', () => {
    expect(groupLabel(amount, 'range:out', i18n, { numberBy: 'range' })).toBe('tools.database.groupOutOfRange');
  });

  it('names the bucket at the range end "<end> to <end + size>"', () => {
    expect(groupLabel(amount, 'range:1000', i18n, { numberBy: 'range' })).toBe('tools.database.groupRangeBucket:{"start":"1000","end":"1100"}');
  });

  // A size below 1 is saved as typed, but the groups fall back to 100; the names must follow.
  it('names a bucket with the size the groups use when the saved size is invalid', () => {
    expect(groupLabel(amount, 'range:100', i18n, { numberBy: 'range', rangeSize: 0 })).toBe('tools.database.groupRangeBucket:{"start":"100","end":"200"}');
  });
});
