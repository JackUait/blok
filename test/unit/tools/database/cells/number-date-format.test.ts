import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  CURRENCY_CODES,
  NUMBER_FORMATS,
  formatNumberValue,
  numberFill,
} from '../../../../../src/tools/database/cells/number-format';
import { formatDateDisplay } from '../../../../../src/tools/database/cells/date-format';

const nf = (options: Intl.NumberFormatOptions, value: number): string => new Intl.NumberFormat('en-US', options).format(value);

describe('number-format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists all 45 Notion API formats, number formats first', () => {
    expect(NUMBER_FORMATS).toHaveLength(45);
    expect(NUMBER_FORMATS.slice(0, 3)).toEqual(['number', 'number_with_commas', 'percent']);
    expect(NUMBER_FORMATS.at(-1)).toBe('bitcoin');
    expect(new Set(NUMBER_FORMATS).size).toBe(45);
  });

  it('maps every currency format but bitcoin to an ISO 4217 code Intl accepts', () => {
    for (const format of NUMBER_FORMATS.slice(3, -1)) {
      const code = CURRENCY_CODES[format];

      expect(code, format).toMatch(/^[A-Z]{3}$/);
      expect(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: code })).not.toThrow();
    }
  });

  it('shows a plain number without separators', () => {
    expect(formatNumberValue(1234567.5, {}, 'en-US')).toBe(nf({ useGrouping: false, maximumFractionDigits: 10 }, 1234567.5));
  });

  it('shows separators for number_with_commas', () => {
    expect(formatNumberValue(1234567.5, { format: 'number_with_commas' }, 'en-US')).toBe(nf({ maximumFractionDigits: 10 }, 1234567.5));
  });

  it('reads 0.25 as 25% for percent', () => {
    expect(formatNumberValue(0.25, { format: 'percent' }, 'en-US')).toBe(nf({ style: 'percent', maximumFractionDigits: 10 }, 0.25));
  });

  it('formats a currency with its own code', () => {
    expect(formatNumberValue(-40, { format: 'dollar' }, 'en-US')).toBe(nf({ style: 'currency', currency: 'USD' }, -40));
    expect(formatNumberValue(1200, { format: 'euro' }, 'en-US')).toBe(nf({ style: 'currency', currency: 'EUR' }, 1200));
  });

  it('applies fixed decimal places', () => {
    expect(formatNumberValue(35.5, { format: 'dollar', decimals: 0 }, 'en-US'))
      .toBe(nf({ style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }, 35.5));
    expect(formatNumberValue(2, { decimals: 2 }, 'en-US')).toBe(nf({ useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }, 2));
  });

  it('prefixes bitcoin with ₿', () => {
    expect(formatNumberValue(0.5, { format: 'bitcoin' }, 'en-US')).toBe(`₿${nf({ maximumFractionDigits: 8 }, 0.5)}`);
  });

  it('falls back to a plain number for a format from a newer client', () => {
    expect(formatNumberValue(3, { format: 'doubloon' as never }, 'en-US')).toBe('3');
  });

  it('fills a bar or ring by divide-by, clamped to 0..1', () => {
    expect(numberFill(50, {})).toBe(0.5);
    expect(numberFill(30, { divideBy: 60 })).toBe(0.5);
    expect(numberFill(0.4, { format: 'percent' })).toBe(0.4);
    expect(numberFill(500, {})).toBe(1);
    expect(numberFill(-3, {})).toBe(0);
    expect(numberFill(5, { divideBy: 0 })).toBe(0);
  });
});

describe('formatDateDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const day = '2026-10-09';
  const at = '2026-10-09T15:05';
  const now = new Date(2026, 9, 9, 12);

  it('defaults to the full date, as before', () => {
    expect(formatDateDisplay(day, 'en-US', {}, now)).toBe(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(2026, 9, 9)));
  });

  it('writes the fixed-order formats with padded parts', () => {
    expect(formatDateDisplay(day, 'en-US', { dateFormat: 'month_day_year' }, now)).toBe('10/09/2026');
    expect(formatDateDisplay(day, 'en-US', { dateFormat: 'day_month_year' }, now)).toBe('09/10/2026');
    expect(formatDateDisplay(day, 'en-US', { dateFormat: 'year_month_day' }, now)).toBe('2026/10/09');
  });

  it('writes the short format through the locale', () => {
    expect(formatDateDisplay(day, 'de-DE', { dateFormat: 'short' }, now))
      .toBe(new Intl.DateTimeFormat('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(2026, 9, 9)));
  });

  it('writes relative days near today and the full date further away', () => {
    const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

    expect(formatDateDisplay(day, 'en-US', { dateFormat: 'relative' }, now)).toBe(rtf.format(0, 'day'));
    expect(formatDateDisplay('2026-10-07', 'en-US', { dateFormat: 'relative' }, now)).toBe(rtf.format(-2, 'day'));
    expect(formatDateDisplay('2026-12-25', 'en-US', { dateFormat: 'relative' }, now))
      .toBe(formatDateDisplay('2026-12-25', 'en-US', { dateFormat: 'full' }, now));
  });

  it('follows the time format', () => {
    const date = new Date(2026, 9, 9, 15, 5);
    const h23 = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(date);
    const h12 = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(date);

    expect(formatDateDisplay(at, 'en-US', { timeFormat: '24_hour' }, now)).toContain(h23);
    expect(formatDateDisplay(at, 'en-US', { timeFormat: '12_hour' }, now)).toContain(h12);
    expect(formatDateDisplay(at, 'en-US', { timeFormat: 'hidden' }, now)).toBe(formatDateDisplay(day, 'en-US', {}, now));
  });

  it('shows an instant in the property time zone', () => {
    const instant = '2026-10-09T23:30:00.000Z';
    const tokyo = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(instant));

    expect(formatDateDisplay(instant, 'en-US', { timeZone: 'Asia/Tokyo', timeFormat: 'hidden' }, now)).toBe(tokyo);
  });

  it('joins a range with an arrow', () => {
    expect(formatDateDisplay('2026-10-09/2026-10-12', 'en-US', { dateFormat: 'year_month_day' }, now)).toBe('2026/10/09 → 2026/10/12');
  });

  it('gives null for a value that is not a date', () => {
    expect(formatDateDisplay('soon', 'en-US', {}, now)).toBeNull();
  });
});
