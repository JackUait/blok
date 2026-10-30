import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wallTime } from '../../../../../src/shared/database/formula/dates';
import type * as DatesModule from '../../../../../src/shared/database/formula/dates';

const MODULE = '../../../../../src/shared/database/formula/dates';

type Dates = typeof DatesModule;

/**
 * goja, the Go server's engine, has no Intl. Formula dates still read in UTC
 * and in the host's own zone there; a named zone reads as an invalid date.
 */
describe('formula wall time without Intl', () => {
  // Leap day, a DST-sensitive hour, the epoch, and a date before 1970.
  const instants = [
    Date.UTC(2024, 1, 29, 13, 5, 7, 9),
    Date.UTC(2024, 2, 31, 1, 30, 0, 0),
    0,
    Date.UTC(1969, 11, 31, 23, 59, 59, 999),
  ];

  let expectedUtc: ReturnType<typeof wallTime>[];
  let expectedLocal: ReturnType<typeof wallTime>[];
  let withoutIntl: Dates;

  beforeEach(async () => {
    vi.clearAllMocks();
    expectedUtc = instants.map((ms) => wallTime(ms, 'UTC'));
    expectedLocal = instants.map((ms) => wallTime(ms, undefined));
    vi.stubGlobal('Intl', undefined);
    // A fresh copy, so no formatter cached while Intl existed answers for it.
    vi.resetModules();
    withoutIntl = await import(MODULE) as Dates;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads UTC like Intl does', () => {
    expect(instants.map((ms) => withoutIntl.wallTime(ms, 'UTC'))).toStrictEqual(expectedUtc);
  });

  it('reads the host zone like Intl does', () => {
    expect(instants.map((ms) => withoutIntl.wallTime(ms, undefined))).toStrictEqual(expectedLocal);
  });

  it('reads a named zone as an invalid date', () => {
    expect(() => withoutIntl.wallTime(0, 'Asia/Yekaterinburg')).toThrow(withoutIntl.InvalidDate);
  });
});
