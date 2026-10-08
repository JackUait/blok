import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { formatDateValue, parseDateValue } from '../../../../../src/tools/database/cells/date-value';

describe('date-value', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseDateValue', () => {
    it('reads a single day', () => {
      expect(parseDateValue('2026-10-09')).toEqual({ start: '2026-10-09', hasTime: false });
    });

    it('reads a day with a time', () => {
      expect(parseDateValue('2026-10-09T14:30')).toEqual({ start: '2026-10-09T14:30', hasTime: true });
    });

    it('reads a full ISO timestamp written by older code', () => {
      expect(parseDateValue('2026-10-09T15:00:00.000Z')).toEqual({ start: '2026-10-09T15:00:00.000Z', hasTime: true });
    });

    it('reads a range as start and end', () => {
      expect(parseDateValue('2026-10-01/2026-10-05')).toEqual({ start: '2026-10-01', end: '2026-10-05', hasTime: false });
    });

    it('reads a range with times', () => {
      expect(parseDateValue('2026-10-01T09:00/2026-10-01T17:30')).toEqual({
        start: '2026-10-01T09:00',
        end: '2026-10-01T17:30',
        hasTime: true,
      });
    });

    it.each([null, undefined, '', 'tomorrow', 42, true, ['2026-10-09'], '2026-10-01/', '/2026-10-01', '2026-10-01/soon'])(
      'gives null for %j',
      (value) => {
        expect(parseDateValue(value)).toBeNull();
      }
    );
  });

  describe('formatDateValue', () => {
    it('writes a single day', () => {
      expect(formatDateValue({ start: '2026-10-09' })).toBe('2026-10-09');
    });

    it('writes a range joined by a slash', () => {
      expect(formatDateValue({ start: '2026-10-01', end: '2026-10-05' })).toBe('2026-10-01/2026-10-05');
    });

    it('round-trips through parseDateValue', () => {
      const value = '2026-10-01T09:00/2026-10-02T10:15';
      const parsed = parseDateValue(value);

      expect(parsed === null ? null : formatDateValue(parsed)).toBe(value);
    });
  });
});
