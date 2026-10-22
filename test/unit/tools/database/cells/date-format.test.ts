import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import enJson from '../../../../../src/components/i18n/locales/en.json';
import { applyDateDisplayChange, editorLocale, formatDateDisplay, formatDayField, formatShortDatePart, resolveHourCycle, resolveWeekStart, timeZones, toIsoDay, toLocalDate, zoneCity, zoneOffsetText } from '../../../../../src/tools/database/cells/date-format';

const en: Record<string, string> = enJson;
const t = (key: string): string => en[key] ?? key;

describe('date-format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('editorLocale', () => {
    const browser = (language: string): void => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    };

    it('keeps the browser\'s region when it speaks the editor\'s language', () => {
      browser('en-GB');

      expect(editorLocale({ getLocale: () => 'en' })).toBe('en-GB');
    });

    it('takes the editor\'s language when the browser speaks another one', () => {
      browser('en-US');

      expect(editorLocale({ getLocale: () => 'ru' })).toBe('ru');
    });

    it('matches the base language only: a zh-TW editor keeps a zh-HK browser', () => {
      browser('zh-HK');

      expect(editorLocale({ getLocale: () => 'zh-TW' })).toBe('zh-HK');
    });

    it('without getLocale it is the browser\'s locale', () => {
      browser('de-AT');

      expect(editorLocale({})).toBe('de-AT');
      expect(editorLocale(undefined)).toBe('de-AT');
    });
  });

  describe('resolveWeekStart', () => {
    it('reads getWeekInfo(), the only form Node 26 keeps', () => {
      expect(resolveWeekStart('de-DE', () => ({ getWeekInfo: () => ({ firstDay: 1 }) }))).toBe(1);
    });

    it('reads the weekInfo getter on engines that have only that', () => {
      expect(resolveWeekStart('de-DE', () => ({ weekInfo: { firstDay: 1 } }))).toBe(1);
    });

    it('maps Sunday (7) to 0', () => {
      expect(resolveWeekStart('en-US', () => ({ getWeekInfo: () => ({ firstDay: 7 }) }))).toBe(0);
    });

    it('falls back to Sunday when the engine has no week data', () => {
      expect(resolveWeekStart('en-US', () => ({}))).toBe(0);
    });

    it('falls back to Sunday for a tag Intl rejects', () => {
      expect(resolveWeekStart('en-US', () => {
        throw new RangeError('bad tag');
      })).toBe(0);
    });
  });

  it('resolveHourCycle gives one of the two cycles', () => {
    expect(['h12', 'h23']).toContain(resolveHourCycle('en-US'));
  });

  it('reads a stored day as local midnight', () => {
    const date = toLocalDate('2026-10-09');

    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 9, 0]);
    expect(toIsoDay(date)).toBe('2026-10-09');
  });

  it('reads a stored time as local wall time', () => {
    const date = toLocalDate('2026-10-09T14:05');

    expect([date.getHours(), date.getMinutes()]).toEqual([14, 5]);
  });

  describe('formatShortDatePart: the timeline resize readout (research/22 §9)', () => {
    it('writes a timed part as a short month, day and time in the locale', () => {
      expect(formatShortDatePart('2026-10-20T02:45', 'en-US')).toBe('Oct 20, 2:45 AM');
      expect(formatShortDatePart('2026-10-20T14:05', 'en-US', 'h23')).toBe('Oct 20, 14:05');
      expect(formatShortDatePart('2026-10-20T02:45', 'de-DE')).toBe(new Intl.DateTimeFormat('de-DE', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 9, 20, 2, 45)));
    });

    it('writes a part with no time as the short month and day', () => {
      expect(formatShortDatePart('2026-10-20', 'en-US')).toBe('Oct 20');
    });
  });

  // research/30 B6: today is Wednesday, Oct 21, 2026. Weeks run Monday to Sunday.
  describe('Relative date format', () => {
    const now = new Date(2026, 9, 21, 1, 0, 7);
    const relative = (value: string): string | null =>
      formatDateDisplay(value, 'en-US', { dateFormat: 'relative', timeFormat: '12_hour' }, now, undefined, { t });

    it.each([
      ['2026-10-26T02:00', 'Next Monday 2:00 AM'],
      ['2026-10-18T02:00', 'Last Sunday 2:00 AM'],
      ['2026-10-28T02:00', 'Next Wednesday 2:00 AM'],
      ['2026-10-31T02:00', 'Next Saturday 2:00 AM'],
      ['2026-11-01T02:00', 'Next Sunday 2:00 AM'],
      ['2026-10-14T02:00', 'Last Wednesday 2:00 AM'],
      ['2026-10-13T02:00', 'Last Tuesday 2:00 AM'],
      ['2026-10-23T02:00', 'Friday 2:00 AM'],
      ['2026-10-19T02:00', 'Monday 2:00 AM'],
      ['2026-10-25T02:00', 'Sunday 2:00 AM'],
      ['2026-10-21T02:00', 'Today 2:00 AM'],
      ['2026-10-22T02:00', 'Tomorrow 2:00 AM'],
      ['2026-10-20T02:00', 'Yesterday 2:00 AM'],
      ['2026-10-11T02:00', 'October 11, 2026 2:00 AM'],
      ['2026-12-02T02:00', 'December 2, 2026 2:00 AM'],
    ])('the cell shows %s as %s', (value, shown) => {
      expect(relative(value)).toBe(shown);
    });

    // Unmeasured edges: the ±1 day words win over the week rule.
    it('writes Yesterday on a Monday and Tomorrow on a Sunday', () => {
      const monday = new Date(2026, 9, 19, 12);
      const sunday = new Date(2026, 9, 25, 12);

      expect(formatDateDisplay('2026-10-18', 'en-US', { dateFormat: 'relative' }, monday, undefined, { t })).toBe('Yesterday');
      expect(formatDateDisplay('2026-10-26', 'en-US', { dateFormat: 'relative' }, sunday, undefined, { t })).toBe('Tomorrow');
      expect(formatDateDisplay('2026-10-12', 'en-US', { dateFormat: 'relative' }, monday, undefined, { t })).toBe('Last Monday');
      expect(formatDateDisplay('2026-10-27', 'en-US', { dateFormat: 'relative' }, sunday, undefined, { t })).toBe('Next Tuesday');
    });

    it('the picker field always shows the full date', () => {
      expect(formatDayField('2026-10-21', 'en-US', { dateFormat: 'relative' }, now)).toBe('Oct 21, 2026');
      expect(formatDayField('2026-10-22', 'en-US', { dateFormat: 'relative' }, now)).toBe('Oct 22, 2026');
      expect(formatDayField('2026-10-26', 'en-US', { dateFormat: 'relative' }, now)).toBe('Oct 26, 2026');
    });
  });

  describe('applyDateDisplayChange', () => {
    it('keeps the other settings, the default reminder included', () => {
      expect(applyDateDisplayChange({ timeZone: 'Asia/Tokyo', defaultReminder: '1_day_before' }, { dateFormat: 'relative' }))
        .toEqual({ timeZone: 'Asia/Tokyo', defaultReminder: '1_day_before', dateFormat: 'relative' });
    });

    it('"Your time zone" removes the key rather than storing undefined', () => {
      const next = applyDateDisplayChange({ timeZone: 'Asia/Tokyo', timeFormat: '24_hour' }, { timeZone: null });

      expect(next).toEqual({ timeFormat: '24_hour' });
      expect('timeZone' in next).toBe(false);
    });
  });

  // research/23 §1, 30 B25, 35 §13: 568 rows with the current zone; head, tail and "tok" hits as measured.
  // The full set was not dumped. The IANA 2026e names minus Factory, Etc/GMT±N, US/Samoa, Universal and
  // Zulu is the one rule found that hits 568 and every measured name.
  describe('timeZones', () => {
    it('lists the 568 zones in IANA id order, from Abidjan to WET', () => {
      const zones = timeZones();

      expect(zones).toHaveLength(568);
      expect(zones.slice(0, 10)).toEqual([
        'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers', 'Africa/Asmara', 'Africa/Asmera',
        'Africa/Bamako', 'Africa/Bangui', 'Africa/Banjul', 'Africa/Bissau',
      ]);
      expect(zones.slice(-5)).toEqual(['US/Mountain', 'US/Pacific', 'UTC', 'W-SU', 'WET']);
      expect(zones).toEqual([...zones].sort());
      expect(zones).toEqual(expect.arrayContaining(['Europe/Berlin', 'Pacific/Kanton', 'America/Kentucky/Louisville', 'Antarctica/Vostok']));
    });

    it('leaves out a name the engine rejects, so the menu still opens', async () => {
      const Real = Intl.DateTimeFormat;

      vi.resetModules();
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(class extends Real {
        constructor(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
          if (options?.timeZone === 'Pacific/Kanton') {
            throw new RangeError('Invalid time zone specified: Pacific/Kanton');
          }
          super(locales, options);
        }
      });
      const fresh = await import('../../../../../src/tools/database/cells/date-format');

      expect(fresh.timeZones()).toHaveLength(567);
      expect(fresh.timeZones()).not.toContain('Pacific/Kanton');
    });
  });

  describe('zoneCity', () => {
    it('drops the region, keeps the rest of the path, and reads "_" as a space', () => {
      expect(zoneCity('Africa/Addis_Ababa')).toBe('Addis Ababa');
      expect(zoneCity('America/Kentucky/Louisville')).toBe('Kentucky/Louisville');
      expect(zoneCity('UTC')).toBe('UTC');
      expect(zoneCity('W-SU')).toBe('W-SU');
    });

    it('writes a US zone as "Mountain (US)"', () => {
      expect(zoneCity('US/Mountain')).toBe('Mountain (US)');
      expect(zoneCity('US/Pacific')).toBe('Pacific (US)');
    });
  });

  describe('zoneOffsetText', () => {
    const at = new Date('2026-10-20T04:00:00Z');

    it('drops the hour\'s leading zero on a whole hour, and writes a zero offset as "GMT"', () => {
      expect(zoneOffsetText('Europe/Berlin', at)).toBe('GMT+2:00');
      expect(zoneOffsetText('America/Chicago', at)).toBe('GMT-5:00');
      expect(zoneOffsetText('Africa/Abidjan', at)).toBe('GMT');
      expect(zoneOffsetText('Pacific/Kanton', at)).toBe('GMT+13:00');
    });

    // research/23 §1: "GMT+05:30" for Kolkata next to "GMT+10:30". One padded sample only.
    it('keeps the leading zero when the offset has minutes', () => {
      expect(zoneOffsetText('Asia/Kolkata', at)).toBe('GMT+05:30');
      expect(zoneOffsetText('Australia/Broken_Hill', at)).toBe('GMT+10:30');
    });
  });
});
