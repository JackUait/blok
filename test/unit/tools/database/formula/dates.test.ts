import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formulaDateToStored } from '../../../../../src/tools/database/formula';
import type { FormulaValue } from '../../../../../src/tools/database/formula';
import { compileError, run, text } from './helpers';

const LA = { timeZone: 'America/Los_Angeles' };
const NY = { timeZone: 'America/New_York' };
const KOLKATA = { timeZone: 'Asia/Kolkata' };

const startOf = (value: FormulaValue): number => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'date') throw new Error('not a date');

  return value.start;
};

describe('formula date functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('help page examples, on the help page clock in Los Angeles', () => {
    it.each([
      ['format(now())', 'August 30, 2023 17:55'],
      ['today()', 'August 30, 2023'],
      ['dateAdd(now(), 1, "days")', 'August 31, 2023 17:55'],
      ['dateAdd(now(), 2, "months")', 'October 30, 2023 17:55'],
      ['dateAdd(now(), 3, "years")', 'August 30, 2026 17:55'],
      ['dateSubtract(now(), 1, "days")', 'August 29, 2023 17:55'],
      ['dateSubtract(now(), 2, "months")', 'June 30, 2023 17:55'],
      ['dateSubtract(now(), 3, "years")', 'August 30, 2020 17:55'],
      ['fromTimestamp(1689024900000)', 'July 10, 2023 14:35'],
      ['parseDate("2022-01-01")', 'January 1, 2022'],
      ['parseDate("2022-01-01T00:00Z")', 'December 31, 2021 16:00'],
      ['formatDate(now(), "MMMM D, Y")', 'August 30, 2023'],
      ['formatDate(now(), "MM/DD/YYYY")', '08/30/2023'],
      ['formatDate(now(), "h:mm A")', '17:55 PM'],
    ])('%s renders as %s', (source, expected) => {
      expect(text(source, LA)).toBe(expected);
    });

    it.each([
      ['year(now())', 2023],
      ['timestamp(now())', 1693443300000],
      ['dateBetween(now(), parseDate("2022-09-07"), "days")', 357],
      ['dateBetween(parseDate("2030-01-01"), now(), "years")', 6],
      ['minute(parseDate("2023-07-10T17:35Z"))', 35],
      ['day(parseDate("2023-07-10T17:35Z"))', 1],
      ['date(parseDate("2023-07-10T17:35Z"))', 10],
      ['month(parseDate("2023-07-10T17:35Z"))', 7],
      ['week(parseDate("2023-01-02"))', 1],
    ])('%s = %s', (source, expected) => {
      expect(run(source, LA)).toBe(expected);
    });

    it('reads hour() of a UTC time in the time zone it runs in', () => {
      expect(run('hour(parseDate("2023-07-10T17:35Z"))', { timeZone: 'UTC' })).toBe(17);
      expect(run('hour(parseDate("2023-07-10T17:35Z"))', LA)).toBe(10);
    });

    it('builds and splits a date range', () => {
      const properties = { start: '2022-09-07', end: '2023-09-07' };

      expect(text('dateRange(prop("Start Date"), prop("End Date"))', { ...LA, properties }))
        .toBe('September 7, 2022 → September 7, 2023');
      expect(run('dateBetween(dateStart(dateRange(prop("Start Date"), prop("End Date"))), dateEnd(dateRange(prop("Start Date"), prop("End Date"))), "days")', { ...LA, properties })).toBe(-365);
      expect(run('dateBetween(dateEnd(prop("Date Range")), dateStart(prop("Date Range")), "days")', { ...LA, properties: { range: '2022-09-07/2023-09-07' } })).toBe(365);
      expect(text('dateStart(prop("Date Range"))', { ...LA, properties: { range: '2022-09-07/2023-09-07' } })).toBe('September 7, 2022');
    });
  });

  describe('time zones', () => {
    it('renders now() and today() in the context zone', () => {
      expect(text('now()', KOLKATA)).toBe('August 31, 2023 06:25');
      expect(text('today()', KOLKATA)).toBe('August 31, 2023');
      expect(text('now()', { timeZone: 'UTC' })).toBe('August 31, 2023 00:55');
    });

    it('starts today() at local midnight', () => {
      expect(startOf(run('today()', KOLKATA))).toBe(Date.UTC(2023, 7, 30, 18, 30));
      expect(startOf(run('today()', LA))).toBe(Date.UTC(2023, 7, 30, 7, 0));
    });

    it('keeps wall time when adding days across a DST change, but not hours', () => {
      const base = 'parseDate("2023-03-11T12:00")';

      expect(text(`dateAdd(${base}, 1, "days")`, NY)).toBe('March 12, 2023 12:00');
      expect(run(`timestamp(dateAdd(${base}, 1, "days")) - timestamp(${base})`, NY)).toBe(23 * 3600000);
      expect(text(`dateAdd(${base}, 24, "hours")`, NY)).toBe('March 12, 2023 13:00');
      expect(run(`dateBetween(dateAdd(${base}, 1, "days"), ${base}, "days")`, NY)).toBe(1);
      expect(run(`dateBetween(dateAdd(${base}, 1, "days"), ${base}, "hours")`, NY)).toBe(23);
    });

    it('reads a stored local time in the context zone', () => {
      expect(run('hour(prop("Due"))', { ...KOLKATA, properties: { due: '2023-08-30T09:15' } })).toBe(9);
      expect(run('timestamp(prop("Due"))', { ...KOLKATA, properties: { due: '2023-08-30T09:15' } }))
        .toBe(Date.UTC(2023, 7, 30, 3, 45));
    });
  });

  describe('units and edges', () => {
    it.each([
      ['dateBetween(parseDate("2023-03-31"), parseDate("2023-02-28"), "months")', 1],
      ['dateBetween(parseDate("2024-01-01"), parseDate("2023-01-01"), "quarters")', 4],
      ['dateBetween(parseDate("2023-01-15"), parseDate("2023-01-01"), "weeks")', 2],
      ['dateBetween(parseDate("2023-01-01T01:30"), parseDate("2023-01-01"), "minutes")', 90],
      ['dateBetween(parseDate("2023-01-01"), parseDate("2023-01-02T12:00"), "days")', -1],
      ['week(parseDate("2023-01-01"))', 52],
      ['day(parseDate("2023-07-09"))', 7],
      ['timestamp(fromTimestamp(1689024945123))', 1689024900000],
      ['parseDate("2024-01-01") > parseDate("2023-01-01")', true],
      ['parseDate("2024-01-01") == parseDate("2024-01-01")', true],
    ])('%s = %s', (source, expected) => {
      expect(run(source, { timeZone: 'UTC' })).toBe(expected);
    });

    it.each([
      ['dateAdd(parseDate("2023-01-31"), 1, "months")', 'February 28, 2023'],
      ['dateSubtract(parseDate("2023-05-15"), 1, "quarters")', 'February 15, 2023'],
      ['dateAdd(parseDate("2023-01-01"), 2, "week")', 'January 15, 2023'],
      ['dateAdd(parseDate("2023-01-01T10:00"), 90, "minutes")', 'January 1, 2023 11:30'],
      ['formatDate(parseDate("2023-07-09T08:05"), "dddd, MMM Do YYYY HH:mm")', 'Sunday, Jul 9th 2023 08:05'],
      ['"Due: " + parseDate("2023-01-01")', 'Due: January 1, 2023'],
    ])('%s renders as %s', (source, expected) => {
      expect(text(source, { timeZone: 'UTC' })).toBe(expected);
    });

    it('returns empty for an unknown unit or unparsable text', () => {
      expect(run('dateAdd(now(), 1, "fortnights")')).toBeNull();
      expect(run('parseDate("soon")')).toBeNull();
    });
  });

  describe('empty dates', () => {
    it('propagates an empty date through date functions', () => {
      expect(run('dateAdd(prop("Due"), 1, "days")')).toBeNull();
      expect(run('year(prop("Due"))')).toBeNull();
      expect(run('dateBetween(prop("Due"), now(), "days")')).toBeNull();
    });

    it('compares an empty date as false', () => {
      expect(run('prop("Due") > now()')).toBe(false);
      expect(run('prop("Due") < now()')).toBe(false);
    });
  });

  describe('stored form', () => {
    it('writes a date back in the stored ISO form, including a range', () => {
      const range = run('dateRange(prop("Start Date"), prop("End Date"))', { ...LA, properties: { start: '2022-09-07', end: '2023-09-07' } });

      expect(range !== null && typeof range === 'object' && !Array.isArray(range) && range.kind === 'date'
        && formulaDateToStored(range, 'America/Los_Angeles')).toBe('2022-09-07/2023-09-07');

      const timed = run('now()', LA);

      expect(timed !== null && typeof timed === 'object' && !Array.isArray(timed) && timed.kind === 'date'
        && formulaDateToStored(timed, 'America/Los_Angeles')).toBe('2023-08-30T17:55');
    });
  });

  it.each([
    ['start(now())', 'Unknown function "start"'],
    ['end(now())', 'Unknown function "end"'],
    ['dateAdd("2023-01-01", 1, "days")', 'Argument 1 of dateAdd() expects Date, got Text'],
    ['now() + 1', 'Operator "+" cannot combine Date and Number'],
    [
      'if(prop("Due"), prop("Due").dateAdd(1, "day"), "")',
      'if() branches return different types: Date and Text',
    ],
  ])('%s fails with "%s"', (source, message) => {
    expect(compileError(source)).toBe(message);
  });

  it('accepts the empty() fix from the common errors page', () => {
    expect(compileError('if(prop("Due"), prop("Due").dateAdd(1, "day"), empty())')).toBe('compiled');
  });
});
