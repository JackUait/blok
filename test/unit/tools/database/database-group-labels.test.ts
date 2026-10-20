import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { groupLabel } from '../../../../src/tools/database/database-group-labels';
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

  // research/22 §7: Notion names number buckets "0 to 100", "900 to 1000".
  it('names a number range bucket "<start> to <end>"', () => {
    expect(groupLabel(amount, 'range:0', i18n, { numberBy: 'range' })).toBe('tools.database.groupRangeBucket:{"start":"0","end":"100"}');
    expect(groupLabel(amount, 'range:900', i18n, { numberBy: 'range', rangeSize: 100 })).toBe('tools.database.groupRangeBucket:{"start":"900","end":"1000"}');
  });

  // A size below 1 is saved as typed, but the groups fall back to 100; the names must follow.
  it('names a bucket with the size the groups use when the saved size is invalid', () => {
    expect(groupLabel(amount, 'range:100', i18n, { numberBy: 'range', rangeSize: 0 })).toBe('tools.database.groupRangeBucket:{"start":"100","end":"200"}');
  });
});
